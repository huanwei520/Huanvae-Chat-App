# libhg_android.so 的 JNI 绑定按方法名绑定（Java_dev_huanvae_guard_HgNative_*），
# R8 release 构建下必须保留 native 方法名不被混淆。
-keepclasseswithmembernames class dev.huanvae.guard.** {
    native <methods>;
}

# 桥数据类经 org.json/Jackson 反射路径使用，保守整体保留（体积代价可忽略）。
-keep class dev.huanvae.guard.HgStatus { *; }
-keep class dev.huanvae.guard.HgTunnelConfig { *; }
-keep class dev.huanvae.guard.PeerEntry { *; }
-keep class dev.huanvae.guard.HgSession { *; }
-keep class dev.huanvae.guard.HgSession$* { *; }

# HgVpnService 由 Manifest 组件规则保留；这里补 service action 常量引用面。
-keep class dev.huanvae.guard.HgVpnService { *; }
