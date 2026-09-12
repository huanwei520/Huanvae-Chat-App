package dev.huanvae.screen.capture.tauri

import android.app.Activity
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.content.Context
import android.os.Build
import android.util.Log
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Channel
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import dev.huanvae.screen.capture.ScreenCaptureService

/**
 * ScreenCapturePlugin — tauri 插件适配层（屏幕共享采集，hg-guard 同模式先例）。
 *
 * 职责边界：
 * * captureStart：发起系统授权弹窗（MediaProjectionManager.createScreenCaptureIntent，
 *   用户可拒绝）→ 授权回调里起 mediaProjection 前台服务（Android 14 硬性顺序：
 *   服务 startForeground 就绪后才允许 getMediaProjection）；
 * * captureStop：幂等停止（ACTION_STOP → 服务统一收尾链路）；
 * * captureStatus：服务存活投影 `{ active }`。
 *
 * 授权流走 tauri 插件框架自带 startActivityForResult + @ActivityCallback
 * （PluginManager 在 TauriActivity onCreate 时 registerForActivityResult），
 * 不要求宿主 MainActivity 覆写 onActivityResult（hg-guard vpnPermissionResult 同例）。
 */
@TauriPlugin
class ScreenCapturePlugin(private val activity: Activity) : Plugin(activity) {

    /** captureStart 暂存的启动参数（授权回调里消费；框架回调无法携带闭包状态）。 */
    private var pendingArgs: StartArgs? = null

    @InvokeArg
    class StartArgs {
        var channel: Channel? = null
        var width: Int? = null
        var height: Int? = null
        var fps: Int? = null
        var quality: Int? = null
    }

    @Command
    fun captureStart(invoke: Invoke) {
        val args = invoke.parseArgs(StartArgs::class.java)
        val channel = args.channel
        if (channel == null) {
            invoke.reject("$ERR_INVALID_ARGS:channel required")
            return
        }
        // 通道先存静态槽（同进程），授权回调直接可用；启动参数暂存成员
        ScreenCaptureService.frameChannel = channel
        pendingArgs = args

        val mgr = activity.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        val consentIntent = mgr.createScreenCaptureIntent()
        activity.runOnUiThread {
            startActivityForResult(invoke, consentIntent, "captureConsentResult")
        }
    }

    @ActivityCallback
    fun captureConsentResult(invoke: Invoke, result: ActivityResult) {
        val authorized = result.resultCode == Activity.RESULT_OK
        val ret = JSObject().put("ok", true).put("authorized", authorized)
        if (!authorized) {
            // 用户拒绝：立即归还结果，通道发 consent:false + stopped
            val ch = ScreenCaptureService.frameChannel
            if (ch != null) {
                try {
                    val msg = JSObject()
                    msg.put("type", "consent")
                    msg.put("authorized", false)
                    ch.send(msg)
                } catch (_: Exception) {
                }
            }
            invoke.resolve(ret)
            return
        }
        val data = result.data
        if (data == null) {
            invoke.reject("$ERR_CONSENT_MISSING:result data null")
            return
        }
        val args = pendingArgs ?: StartArgs()
        pendingArgs = null
        val intent = Intent(activity, ScreenCaptureService::class.java)
            .setAction(ScreenCaptureService.ACTION_START)
            .putExtra(ScreenCaptureService.EXTRA_RESULT_CODE, result.resultCode)
            .putExtra(ScreenCaptureService.EXTRA_RESULT_DATA, data)
        args.width?.let { intent.putExtra(ScreenCaptureService.EXTRA_WIDTH, it) }
        args.height?.let { intent.putExtra(ScreenCaptureService.EXTRA_HEIGHT, it) }
        args.fps?.let { intent.putExtra(ScreenCaptureService.EXTRA_FPS, it) }
        args.quality?.let { intent.putExtra(ScreenCaptureService.EXTRA_QUALITY, it) }
        try {
            if (Build.VERSION.SDK_INT >= 26) {
                activity.startForegroundService(intent)
            } else {
                activity.startService(intent)
            }
        } catch (e: Exception) {
            invoke.reject("$ERR_START_SERVICE:${e.javaClass.simpleName}")
            return
        }
        invoke.resolve(ret)
    }

    @Command
    fun captureStop(invoke: Invoke) {
        val intent = Intent(activity, ScreenCaptureService::class.java)
            .setAction(ScreenCaptureService.ACTION_STOP)
        val viaService = runCatching { activity.startService(intent) }.isSuccess
        if (!viaService) {
            // App 退后台 startService 被平台拒绝（Android 12+）时，直接停服务实例（幂等兜底）
            runCatching { activity.stopService(intent) }
        }
        invoke.resolve(JSObject().put("ok", true))
    }

    @Command
    fun captureStatus(invoke: Invoke) {
        invoke.resolve(JSObject().put("active", ScreenCaptureService.instance != null))
    }

    companion object {
        private const val TAG = "ScreenCapturePlugin"

        /** 拒绝前缀（前端按前缀分流；文案 redact 安全）。 */
        const val ERR_INVALID_ARGS = "screen_capture_invalid_args"
        const val ERR_CONSENT_MISSING = "screen_capture_consent_missing"
        const val ERR_START_SERVICE = "screen_capture_start_service_failed"
    }
}
