package dev.huanvae.screen.capture

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.Image
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.util.Base64
import android.util.Log
import app.tauri.plugin.JSObject
import app.tauri.plugin.Channel
import java.io.ByteArrayOutputStream

/**
 * ScreenCaptureService — 屏幕共享采集前台服务（mediaProjection 类型）。
 *
 * 协议（tauri-plugin-screen-capture 契约，Android 14 实测口径）：
 * ```
 * startForegroundService(Intent(ACTION_START).putExtra(resultCode, resultData, …))
 *   → onStartCommand：startForeground(NOTIF_ID, notif, FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
 *     → MediaProjectionManager.getMediaProjection(resultCode, resultData)  // Android 14 要求授权 Intent 未消费
 *     → MediaProjection.createVirtualDisplay + ImageReader(RGBA_8888)
 *     → onImageAvailable（HandlerThread，按 1/fps 节流）
 *        → acquireLatestImage → rowPadding 归整 → Bitmap → JPEG → Base64
 *        → channel.send({ type:'frame', width, height, data })
 *   → 用户/前端停止：ACTION_STOP 或 projection.registerCallback onStop
 *        → 全量 release + stopForeground + stopSelf
 *        → channel.send({ type:'stopped' })
 * ```
 * 帧数据只经内存通道流动，不落盘、不打日志（redact 纪律，同 hg-guard）。
 */
class ScreenCaptureService : Service() {

    private var projection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var imageReader: ImageReader? = null
    private var callbackThread: HandlerThread? = null
    private var callbackHandler: Handler? = null

    private var outWidth = 0
    private var outHeight = 0
    private var frameIntervalMs = 100L
    private var jpegQuality = 60
    private var lastFrameAt = 0L
    private var stopped = false
    private var frameCount = 0L
    private var channelNullLogged = false

    /** 当前会话的投影停止回调（unregister 需持引用；teardown 时先注销防级联停服） */
    private var projectionCallback: MediaProjection.Callback? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopCapture()
                return START_NOT_STICKY
            }
            ACTION_START -> {
                val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, Int.MIN_VALUE)
                @Suppress("DEPRECATION")
                val resultData = intent.getParcelableExtra<Intent>(EXTRA_RESULT_DATA)
                if (resultCode == Int.MIN_VALUE || resultData == null) {
                    Log.e(TAG, "start: missing consent result")
                    notifyError("missing consent result")
                    stopSelf()
                    return START_NOT_STICKY
                }
                Log.i(TAG, "start: consent ok channel=${frameChannel != null}")
                // ⓪ 残留会话先拆（幂等）：Android 同一 app 只容一条活跃投影，新
                // getMediaProjection 会令系统立刻停掉旧投影；旧回调若走 stopCapture
                // 会把整个服务（含新会话依赖的 FGS 态）一起收尾，新投影随即被系统
                // 回收（2026-09-10 模拟器实测：新 VirtualDisplay 存活仅 16ms）。
                // 故先静默拆旧会话（不动 FGS、不发通知；旧通道已随旧 JS 失效），
                // 并重置会话标志，再按全新会话起投影。
                if (projection != null || virtualDisplay != null || imageReader != null) {
                    Log.i(TAG, "start: stale session detected — teardown before new capture")
                    teardownSession()
                }
                stopped = false
                frameCount = 0L
                lastFrameAt = 0L
                channelNullLogged = false
                // 参数（width/height/fps/quality 由前端透传，带安全缺省与钳制）
                val reqW = intent.getIntExtra(EXTRA_WIDTH, 1280).coerceIn(160, 1920)
                val reqH = intent.getIntExtra(EXTRA_HEIGHT, 720).coerceIn(120, 1920)
                val fps = intent.getIntExtra(EXTRA_FPS, 10).coerceIn(1, 30)
                jpegQuality = intent.getIntExtra(EXTRA_QUALITY, 60).coerceIn(20, 90)
                outWidth = reqW
                outHeight = reqH
                frameIntervalMs = (1000L / fps)

                // ① 前台先行（Android 14：mediaProjection 类型 FGS 必须先于 getMediaProjection 就绪）
                startAsForeground()

                // ② 授权态投影（resultData 为 createScreenCaptureIntent 的一次性授权凭据）
                val mgr = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
                try {
                    projection = mgr.getMediaProjection(resultCode, resultData)
                } catch (e: Exception) {
                    Log.e(TAG, "getMediaProjection failed: ${e.javaClass.simpleName}")
                    notifyError("getMediaProjection failed: ${e.javaClass.simpleName}")
                    stopSelf()
                    return START_NOT_STICKY
                }

                // ③ 用户从系统投影条停止 → 同一收尾链路（持引用便于 teardown 先注销）
                val cb = object : MediaProjection.Callback() {
                    override fun onStop() {
                        stopCapture()
                    }
                }
                projectionCallback = cb
                projection?.registerCallback(cb, mainHandler)

                // ④ 虚拟显示 + 帧读取
                startProjection()
                sendSimple("started")
                return START_NOT_STICKY
            }
            else -> {
                stopSelf()
                return START_NOT_STICKY
            }
        }
    }

    // lazy：属性初始化器在 Service 构造期运行（Context 尚未 attach），
    // 直接 Handler(this.mainLooper) 会 NPE 崩服务（2026-09-10 模拟器实测）。
    private val mainHandler: Handler by lazy { Handler(this.mainLooper) }

    private fun startAsForeground() {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= 26) {
            manager.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_ID,
                    "屏幕共享",
                    NotificationManager.IMPORTANCE_LOW,
                ),
            )
        }
        val builder = if (Build.VERSION.SDK_INT >= 26) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION") Notification.Builder(this)
        }
        builder.setContentTitle("屏幕共享进行中")
            .setContentText("您的屏幕正在共享给会议参会者")
            .setSmallIcon(android.R.drawable.ic_menu_view)
            .setOngoing(true)
        val notif: Notification = builder.build()
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(
                NOTIF_ID,
                notif,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION,
            )
        } else {
            startForeground(NOTIF_ID, notif)
        }
    }

    private fun startProjection() {
        callbackThread = HandlerThread("hg-screencap").also { it.start() }
        callbackHandler = Handler(callbackThread!!.looper)

        imageReader = ImageReader.newInstance(
            outWidth,
            outHeight,
            PixelFormat.RGBA_8888,
            MAX_IMAGES,
        ).also { reader ->
            reader.setOnImageAvailableListener({ onImageAvailable(reader) }, callbackHandler)
        }

        val displayMetrics = resources.displayMetrics
        virtualDisplay = projection?.createVirtualDisplay(
            "hg-screen-share",
            outWidth,
            outHeight,
            displayMetrics.densityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            imageReader!!.surface,
            null,
            callbackHandler,
        )
        Log.i(TAG, "virtualDisplay=${virtualDisplay != null} ${outWidth}x${outHeight} fps=${1000L / frameIntervalMs} q=$jpegQuality")
    }

    /** 帧回调：按 fps 节流；acquireLatestImage 丢弃积压帧（延迟优先）。 */
    private fun onImageAvailable(reader: ImageReader) {
        if (stopped) return
        val now = System.currentTimeMillis()
        if (now - lastFrameAt < frameIntervalMs) return
        var image: Image? = null
        try {
            image = reader.acquireLatestImage() ?: return
            lastFrameAt = now
            val bitmap = imageToBitmap(image)
            image.close()
            image = null
            if (bitmap != null) {
                frameCount++
                if (frameCount == 1L || frameCount % 30L == 0L) {
                    Log.i(TAG, "frame #$frameCount ${bitmap.width}x${bitmap.height} emitted")
                }
                emitFrame(bitmap)
                bitmap.recycle()
            }
        } catch (e: Exception) {
            Log.e(TAG, "frame error: ${e.javaClass.simpleName}")
            try {
                image?.close()
            } catch (_: Exception) {
            }
        }
    }

    /** Image(RGBA_8888) → Bitmap：处理 rowPadding（stride 与 width*4 不一致时逐行拷贝）。 */
    private fun imageToBitmap(image: Image): Bitmap? {
        val planes = image.planes
        if (planes.isEmpty()) return null
        val plane = planes[0]
        val buffer = plane.buffer
        val rowStride = plane.rowStride
        val pixelStride = plane.pixelStride
        val rowPadding = rowStride - pixelStride * outWidth
        val bitmap = Bitmap.createBitmap(
            outWidth + rowPadding / pixelStride,
            outHeight,
            Bitmap.Config.ARGB_8888,
        )
        bitmap.copyPixelsFromBuffer(buffer)
        return if (rowPadding == 0) {
            bitmap
        } else {
            // 裁掉 rowPadding 尾巴
            val cropped = Bitmap.createBitmap(bitmap, 0, 0, outWidth, outHeight)
            bitmap.recycle()
            cropped
        }
    }

    /** Bitmap → JPEG → Base64 → Channel（帧消息协议见类头注释）。 */
    private fun emitFrame(bitmap: Bitmap) {
        val channel = frameChannel
        if (channel == null) {
            if (!channelNullLogged) {
                Log.w(TAG, "emitFrame: frameChannel null（JS 侧未传通道？）")
                channelNullLogged = true
            }
            return
        }
        try {
            val out = ByteArrayOutputStream()
            bitmap.compress(Bitmap.CompressFormat.JPEG, jpegQuality, out)
            val data = Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
            val msg = JSObject()
            msg.put("type", "frame")
            msg.put("width", bitmap.width)
            msg.put("height", bitmap.height)
            msg.put("data", data)
            // Channel 底层要向 WebView 注入脚本，切主线程发送（后台采集线程直发在
            // 部分机型上静默丢失，2026-09-10 模拟器实测防守）。
            mainHandler.post {
                try {
                    channel.send(msg)
                } catch (e: Exception) {
                    Log.e(TAG, "channel send failed: ${e.javaClass.simpleName}")
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "emit frame failed: ${e.javaClass.simpleName}")
        }
    }

    /**
     * 会话级拆解（幂等）：释放投影/显示/读取器/采集线程；**不动前台态、不发通知、
     * 不停服务**。旧投影回调先注销再 stop，避免其 onStop 把整只服务（可能正在
     * 起新会话）级联收尾。返回是否存在活跃会话。
     */
    private fun teardownSession(): Boolean {
        val hadSession = projection != null || virtualDisplay != null || imageReader != null
        projectionCallback?.let { cb ->
            try {
                projection?.unregisterCallback(cb)
            } catch (_: Exception) {
            }
        }
        projectionCallback = null
        try {
            virtualDisplay?.release()
        } catch (_: Exception) {
        }
        virtualDisplay = null
        try {
            imageReader?.close()
        } catch (_: Exception) {
        }
        imageReader = null
        try {
            projection?.stop()
        } catch (_: Exception) {
        }
        projection = null
        callbackThread?.quitSafely()
        callbackThread = null
        callbackHandler = null
        return hadSession
    }

    /** 统一收尾：幂等，会话级拆解 + 前台态释放 + 停服，并通知 JS 'stopped'。 */
    private fun stopCapture() {
        synchronized(this) {
            if (stopped) return
            stopped = true
        }
        teardownSession()
        sendSimple("stopped")
        if (Build.VERSION.SDK_INT >= 24) {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION") stopForeground(true)
        }
        stopSelf()
        instance = null
    }

    private fun notifyError(message: String) {
        try {
            frameChannel?.let { ch ->
                val msg = JSObject()
                msg.put("type", "error")
                msg.put("message", message)
                ch.send(msg)
            }
        } catch (_: Exception) {
        }
    }

    private fun sendSimple(type: String) {
        try {
            frameChannel?.let { ch ->
                val msg = JSObject()
                msg.put("type", type)
                ch.send(msg)
            }
        } catch (_: Exception) {
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        instance = null
    }

    companion object {
        private const val TAG = "ScreenCaptureService"
        private const val CHANNEL_ID = "hg_screen_capture"
        private const val NOTIF_ID = 0x5C01
        private const val MAX_IMAGES = 4

        const val ACTION_START = "dev.huanvae.screen.capture.START"
        const val ACTION_STOP = "dev.huanvae.screen.capture.STOP"
        const val EXTRA_RESULT_CODE = "resultCode"
        const val EXTRA_RESULT_DATA = "resultData"
        const val EXTRA_WIDTH = "width"
        const val EXTRA_HEIGHT = "height"
        const val EXTRA_FPS = "fps"
        const val EXTRA_QUALITY = "quality"

        /** 帧通道（同进程；插件授权回调里写入，服务读取）。 */
        @Volatile
        var frameChannel: Channel? = null

        /** 服务存活探针（capture_status 投影）。 */
        @Volatile
        var instance: ScreenCaptureService? = null
            private set
    }

    override fun onCreate() {
        super.onCreate()
        instance = this
    }
}
