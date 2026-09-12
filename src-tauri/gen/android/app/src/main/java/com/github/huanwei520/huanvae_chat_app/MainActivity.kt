package com.github.huanwei520.huanvae_chat_app

import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

/**
 * MainActivity - 应用主入口
 *
 * 覆盖 onWebViewCreate 以配置 WebChromeClient，
 * 处理 WebRTC 的摄像头和麦克风权限请求。
 *
 * 注意：Android WebView 默认不处理 getUserMedia 权限请求，
 * 需要通过 onPermissionRequest 回调手动授权。
 */
class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  /**
   * WebView 创建钩子
   * 配置 WebChromeClient 以处理 WebRTC 权限请求
   */
  override fun onWebViewCreate(webView: WebView) {
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
