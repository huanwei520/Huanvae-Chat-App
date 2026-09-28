# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# 通知深链 JS 桥（MainActivity$DeepLinkBridge，window.HuanvaeDeepLink）：
# release 构建 isMinifyEnabled=true，未 keep 会被 R8 裁掉/改名，前端调用全部 undefined
-keepclassmembers class com.github.huanwei520.huanvae_chat_app.MainActivity$* {
  @android.webkit.JavascriptInterface <methods>;
}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile