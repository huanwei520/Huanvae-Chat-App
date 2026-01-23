package com.github.huanwei520.huanvae_chat_app

import android.os.Bundle
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge

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
}
