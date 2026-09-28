package com.github.huanwei520.huanvae_chat_app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.os.Bundle
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import kotlin.random.Random

/**
 * MainActivity - 应用主入口
 *
 * 覆盖 onWebViewCreate 以配置 WebChromeClient，
 * 处理 WebRTC 的摄像头和麦克风权限请求。
 *
 * 注意：Android WebView 默认不处理 getUserMedia 权限请求，
 * 需要通过 onPermissionRequest 回调手动授权。
 *
 * ## 通知会话深链（C1/C2/C3）
 *
 * 链路：通知发布（[postMessageNotification]，经 JS 桥调用，content intent 携带
 * [EXTRA_DEEPLINK]）→ 点击通知：
 * - 热启动（singleTask，Activity 存活）：[onNewIntent] → 暂存 + evaluateJavascript
 *   poke → 前端 `window.__huanvaeOnNotificationDeepLink` 回调 → 经 JS 桥
 *   [DeepLinkBridge.takePendingDeepLink] 原子取走 → 路由跳转对应会话；
 * - 冷启动（进程/Activity 已死）：[onCreate] intent 暂存 → 前端登录且好友/群列表
 *   加载完成后 boot-pull 经 JS 桥取走 → 跳转。WebView/前端未就绪前深链滞留
 *   静态槽，不丢不重（take-once）。
 *
 * 为什么不直接用 tauri-plugin-notification 的 sendNotification 带自定义数据：
 * 该插件 content intent 里的 `LocalNotficationObject` 取自 Kotlin `Notification.sourceJson`，
 * 而 tauri 2.11.1 的 run_mobile_plugin 只透传 NotificationData 序列化结果，
 * sourceJson 无赋值来源恒为 null —— 插件路径的点击 intent 带不上任何自定义 extra。
 *
 * 登出/切账号：前端 clearSession 统一调用 [DeepLinkBridge.clearPendingDeepLink]，
 * 防止 A 账号的通知深链跳进 B 账号的会话。
 */
class MainActivity : TauriActivity() {
  companion object {
    private const val TAG = "HuanvaeDeeplink"

    /** 通知点击 intent 携带的会话深链 JSON extra（{"sourceType":"friend|group","sourceId":"..."}） */
    private const val EXTRA_DEEPLINK = "huanvae_deeplink"

    /**
     * 深链暂存槽（跨 Activity 重建存活，companion 静态）。
     * 只存最近一条、消费即清：重复通知覆盖旧值（最后一条优先），与聊天应用惯例一致。
     */
    @Volatile
    private var pendingDeepLinkJson: String? = null
    private val stashLock = Any()

    private fun stashDeepLink(json: String) {
      synchronized(stashLock) { pendingDeepLinkJson = json }
    }

    /** 原子取走（take-once）：消费与清理同锁完成，热/冷两路并发只会有一个消费者拿到值 */
    private fun takePendingDeepLink(): String? {
      synchronized(stashLock) {
        val v = pendingDeepLinkJson
        pendingDeepLinkJson = null
        return v
      }
    }

    private fun clearPendingDeepLink() {
      synchronized(stashLock) { pendingDeepLinkJson = null }
    }
  }

  /** onWebViewCreate 保留的 WebView 引用，深链 poke 与 JS 桥注册用 */
  private var webViewRef: WebView? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    stashAndDispatch(intent, "onCreate(cold)")
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    stashAndDispatch(intent, "onNewIntent(hot)")
  }

  override fun onDestroy() {
    webViewRef = null
    super.onDestroy()
  }

  /**
   * WebView 创建钩子
   * 配置 WebChromeClient 以处理 WebRTC 权限请求
   */
  override fun onWebViewCreate(webView: WebView) {
    webViewRef = webView
    // 注册通知深链 JS 桥（前端经 window.HuanvaeDeepLink 调用）
    webView.addJavascriptInterface(DeepLinkBridge(), "HuanvaeDeepLink")
    installImeKeyboardFollow(webView)
    webView.webChromeClient = object : WebChromeClient() {
      /**
       * 处理来自 Web 内容的权限请求（如 getUserMedia）
       * 自动授权摄像头和麦克风访问
       */
      override fun onPermissionRequest(request: PermissionRequest) {
        // 在 UI 线程中授权请求
        runOnUiThread {
          // 授权所有请求的资源（VIDEO_CAPTURE, AUDIO_CAPTURE 等）
          request.grant(request.resources)
        }
      }

      /**
       * 处理权限请求被取消
       */
      override fun onPermissionRequestCanceled(request: PermissionRequest) {
        runOnUiThread {
          super.onPermissionRequestCanceled(request)
        }
      }
    }
    super.onWebViewCreate(webView)
    // 冷启动：此时前端 React 多半还没 boot（poke 是无害 no-op），
    // 深链留在暂存槽，由前端登录+列表就绪后的 boot-pull 消费
    pokeWebView("onWebViewCreate")
  }

  /**
   * 从 intent 提取会话深链 → 暂存 → 尝试 poke 前端。
   * 热/冷启动共用；extra 缺失（普通启动器点击）直接忽略。
   */
  private fun stashAndDispatch(intent: Intent?, source: String) {
    val json = intent?.getStringExtra(EXTRA_DEEPLINK)
    if (json == null) {
      Log.d(TAG, "[$source] intent 无深链 extra，忽略")
      return
    }
    stashDeepLink(json)
    Log.d(TAG, "[$source] 暂存会话深链: $json")
    pokeWebView(source)
  }

  /**
   * 通知前端来深链了（前端回调里自己经 JS 桥原子取走）。
   * WebView 未就绪时静默跳过：暂存槽兜底，前端就绪后 boot-pull 仍能取到。
   */
  private fun pokeWebView(source: String) {
    val wv = webViewRef
    if (wv == null) {
      Log.d(TAG, "[$source] WebView 未就绪，深链留在暂存槽等前端 boot-pull")
      return
    }
    wv.post {
      wv.evaluateJavascript(
        "window.__huanvaeOnNotificationDeepLink && window.__huanvaeOnNotificationDeepLink();",
        null
      )
      Log.d(TAG, "[$source] 已向前端发送深链 poke")
    }
  }

  /**
   * 发布带会话深链的消息通知（C1）。前端 notifyNewMessage 经 JS 桥调用。
   *
   * 声音/振动走与插件相同的通知渠道（huanvae_messages，water.mp3），行为不变；
   * content intent 附带 [EXTRA_DEEPLINK]，launchMode=singleTask 下热启动走
   * onNewIntent、冷启动走 onCreate，任务栈不重建。
   *
   * @return true 已发布；false 失败（如未授权），前端回退插件无深链路径
   */
  private fun postMessageNotification(
    title: String,
    body: String,
    channelId: String,
    deepLinkJson: String?
  ): Boolean {
    return try {
      val nm = NotificationManagerCompat.from(this)
      // 渠道兜底：正常路径下前端启动时 initNotificationChannels 已建渠道；
      // 渠道缺失时 O+ 会静默丢通知，这里补建一个默认渠道保证通知不丢
      if (nm.getNotificationChannel(channelId) == null) {
        nm.createNotificationChannel(
          NotificationChannel(channelId, "消息通知", NotificationManager.IMPORTANCE_DEFAULT)
        )
      }
      val intent = Intent(this, MainActivity::class.java).apply {
        action = Intent.ACTION_MAIN
        addCategory(Intent.CATEGORY_LAUNCHER)
        // singleTask：热启动 onNewIntent / 冷启动 onCreate，不重建任务栈（小窗同路径）
        addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        if (deepLinkJson != null) {
          putExtra(EXTRA_DEEPLINK, deepLinkJson)
        }
      }
      val notifId = Random.nextInt()
      val pendingIntent = PendingIntent.getActivity(
        this,
        notifId,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )
      val notification = NotificationCompat.Builder(this, channelId)
        .setContentTitle(title)
        .setContentText(body)
        .setSmallIcon(android.R.drawable.ic_dialog_info) // 与插件默认 small icon 一致
        .setContentIntent(pendingIntent)
        .setAutoCancel(true) // 点击跳会话后通知自动清除
        .build()
      nm.notify(notifId, notification)
      Log.d(TAG, "已发布消息通知: channel=$channelId deeplink=$deepLinkJson")
      true
    } catch (e: SecurityException) {
      Log.w(TAG, "POST_NOTIFICATIONS 未授权，发布失败", e)
      false
    } catch (e: Exception) {
      Log.w(TAG, "发布消息通知失败", e)
      false
    }
  }

  /**
   * 通知深链 JS 桥（前端命名空间 window.HuanvaeDeepLink）。
   * 方法都在 WebView 的 JavaBridge 线程回调，暂存槽访问经 companion 同锁，线程安全。
   */
  private inner class DeepLinkBridge {
    @JavascriptInterface
    fun takePendingDeepLink(): String? {
      val v = Companion.takePendingDeepLink()
      Log.d(TAG, "[bridge] 前端取走深链: $v")
      return v
    }

    @JavascriptInterface
    fun clearPendingDeepLink() {
      Companion.clearPendingDeepLink()
      Log.d(TAG, "[bridge] 前端清空深链暂存（登出/切账号）")
    }

    @JavascriptInterface
    fun postMessageNotification(
      title: String,
      body: String,
      channelId: String,
      deepLinkJson: String?
    ): Boolean = this@MainActivity.postMessageNotification(title, body, channelId, deepLinkJson)
  }

  /**
   * 软键盘跟随（修「键盘弹起输入框不跟随/被遮挡」）：
   *
   * 根因链：enableEdgeToEdge() → setDecorFitsSystemWindows(false) → 窗口不再因 IME 缩放
   * （adjustResize 在 API 30+ 的 edge-to-edge 下失效），而 WebView 的视口 meta 未声明
   * interactive-widget，Chromium WebView 也不做 ime-inset 驱动的重排 → 三方（系统窗口 /
   * Chromium / 页面 JS）没有任何一方在键盘弹起时缩小页面，输入框停在原位被键盘盖住。
   *
   * 修法：监听 ime() insets，把键盘高度从 WebView 的实际高度里减掉（窗口 edge-to-edge
   * 不变，WebView 视口变矮）→ 弹起时输入框必贴键盘上沿，收起时必回落。监听挂在 WebView
   * 的【父容器】上且 insets 原样返回，不碰 WebView 自身的 insets 派发槽位，
   * env(safe-area-inset-*) 原生链路不变；Chromium 的 IME 视口行为由 viewport meta
   * interactive-widget=overlays-content 显式关闭（index.html），避免双通道缩放导致输入框
   * 悬空一个键盘距。
   *
   * API 28/29 上 ime() insets 不可用（本监听自然空转），由 Manifest 的
   * windowSoftInputMode=adjustResize 经典窗口缩放兜底。
   */
  private fun installImeKeyboardFollow(webView: WebView) {
    webView.addOnAttachStateChangeListener(object : View.OnAttachStateChangeListener {
      override fun onViewAttachedToWindow(v: View) {
        val container = v.parent as? ViewGroup ?: return
        ViewCompat.setOnApplyWindowInsetsListener(container) { _, insets ->
          applyImeHeight(webView, insets)
          insets // 不消费：继续原样下发（WebView 侧 safe-area env 等保持原生行为）
        }
      }

      override fun onViewDetachedFromWindow(v: View) {}
    })
  }

  /** ime() insets → WebView 实际高度：键盘弹起 = 容器高 - 键盘高，收起 = MATCH_PARENT。 */
  private fun applyImeHeight(webView: WebView, insets: WindowInsetsCompat) {
    val imeBottom = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
    val lp = webView.layoutParams ?: return
    val container = webView.parent as? ViewGroup
    val containerH = container?.height?.takeIf { it > 0 } ?: webView.rootView.height
    val target =
      if (imeBottom in 1 until containerH) containerH - imeBottom
      else ViewGroup.LayoutParams.MATCH_PARENT
    if (lp.height != target) {
      lp.height = target
      webView.layoutParams = lp
    }
  }
}
