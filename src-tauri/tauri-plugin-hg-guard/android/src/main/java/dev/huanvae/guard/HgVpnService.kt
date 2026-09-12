// Copyright (c) 2024-2026 HuanvaeGuard contributors.
// SPDX-License-Identifier: BSD-3-Clause

package dev.huanvae.guard

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import android.os.Handler
import android.os.Looper
import android.util.Log

/**
 * HgVpnService — establish 闭环(方案 §6 M1、§2.2、§5.1)。
 *
 * [阶段 2a 搬运件] 原件:HuanvaeGuard client/android/app/.../HgVpnService.kt
 * (HEAD 0c6f882)。包名 dev.huanvae.guard 原样保持(JNI 符号契约)。相对原件的
 * 唯一改动:前台通知的 contentIntent 由 Guard 自家 MainActivity(dev.huanvae.
 * guard.MainActivity,不随桥搬运)改为宿主包 launch intent,语义不变(点通知
 * 回应用前台)。其余逐行同原件。
 *
 * 数据流:onStartCommand(ACTION_CONNECT, extra 带 cfgJson)→
 * Builder 组装(addAddress(/32) + 逐条 addRoute(/32 精确,红线) +
 * addDnsServer + setMtu)→ establish() → fd **detachFd 移交** JNI
 * startTunnel(cfgJson 经管道 fd 递入)→ 成功后 `udp4SocketFd()` 回吐
 * core 出站 socket → `protect()` 防路由环(方案 §9 O-2 采定通路)。
 *
 * 前台服务:API 34 起 foregroundServiceType=**specialUse**
 * (`FOREGROUND_SERVICE_SPECIAL_USE` 权限 + PROPERTY_SPECIAL_USE_FGS_SUBTYPE
 * 声明,见 AndroidManifest)。注:Play 政策下 VPN 应用另有
 * systemExempted 等选项与专项审核,M4 发布链时随政策定稿——本块按任务令
 * 先落 specialUse。
 *
 * fd 所有权契约(见 Rust vpn.rs 模块头):establish 的 tun fd 一经
 * detachFd 即归 Rust;stop 时由 core 关闭一次,Kotlin 不得重复 close。
 * onRevoke(用户/系统撤回授权,方案 §5.1)→ stopTunnel 归零 → Disconnected。
 */
class HgVpnService : VpnService() {

    private val handler = Handler(Looper.getMainLooper())

    /** 周期看门狗:worker 死亡(状态回落 STOPPED)→ 自愈停服。 */
    private val watchdog = object : Runnable {
        override fun run() {
            val code = HgNative.status()
            if (tunHandleFd >= 0 && code == HgStatus.STATUS_STOPPED) {
                // core 侧自愈清理已发生(镜像桌面 get_status 死亡语义);
                // tun fd 已被 core 关闭,只需收尾服务。
                Log.w(TAG, "tunnel reported stopped while service active; tearing down")
                tunHandleFd = -1
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
                return
            }
            handler.postDelayed(this, WATCHDOG_INTERVAL_MS)
        }
    }

    /** establish() 移交给 Rust 的 tun fd;-1 = 未持有(所有权已出 Kotlin)。 */
    private var tunHandleFd: Int = -1

    override fun onCreate() {
        super.onCreate()
        ensureNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_DISCONNECT -> {
                disconnect()
                return START_NOT_STICKY
            }
            ACTION_CONNECT -> {
                val cfgJson = intent.getStringExtra(EXTRA_CONFIG)
                if (cfgJson.isNullOrBlank()) {
                    Log.e(TAG, "connect without config")
                    stopSelf()
                    return START_NOT_STICKY
                }
                startForegroundWithNotification()
                connect(cfgJson)
                return START_STICKY
            }
            else -> {
                stopSelf()
                return START_NOT_STICKY
            }
        }
    }

    /** establish 闭环(方案 §2.2 表 Android 列的 Kotlin 侧四件)。 */
    private fun connect(cfgJson: String) {
        // 红线校验前置:/32、mtu、dns;失败即断(错误条文案 redact 安全)。
        val cfg = try {
            HgTunnelConfig.fromJson(cfgJson)
        } catch (e: IllegalArgumentException) {
            Log.e(TAG, "config rejected: ${e.message}")
            disconnect()
            return
        }

        // ① Builder 组装:地址 /32 + 逐条路由（前缀取条目自身，/32 精确路由与
        //    hub 网段聚合路由均受支持，校验已拒 /0）+ DNS + MTU。
        val builder = Builder()
            .setSession("HuanvaeGuard")
            .setMtu(cfg.mtu)
            // 红线:TUN 地址一律 /32。
            .addAddress(cfg.address, 32)
        HgTunnelConfig.routesOf(cfg).forEach { route ->
            val ip = route.substringBefore('/')
            val prefix = route.substringAfter('/').toIntOrNull() ?: 32
            builder.addRoute(ip, prefix)
        }
        cfg.dnsServers.forEach { builder.addDnsServer(it) }

        // ② establish():TUN 由系统分配,本进程不 root、不开 /dev/net/tun。
        val pfd = try {
            builder.establish()
        } catch (e: Exception) {
            Log.e(TAG, "establish failed (permission revoked?)")
            null
        }
        if (pfd == null) {
            disconnect()
            return
        }

        // ③ fd 移交 + 配置经管道递入 JNI(cfgJson 不走 jstring)。
        val tunFd = pfd.detachFd() // 所有权 → Rust/core(stop 时由 core 关闭)
        val (cfgReadFd, cfgWriteFd) = ParcelFileDescriptor.createPipe()
        try {
            ParcelFileDescriptor.AutoCloseOutputStream(cfgWriteFd).use { w ->
                w.write(cfgJson.toByteArray(Charsets.UTF_8))
            } // 关写端 → Rust 读到 EOF
            val rc = HgNative.startTunnel(tunFd, cfgReadFd.detachFd())
            if (rc != HgStatus.STATUS_CONNECTED) {
                // M2 契约反转:startTunnel 一经调用,tun fd 已由 Rust 侧恰好
                // 关闭一次(成功移交 core / 失败 Rust 关);Kotlin 再 close
                // = fdsan double-close → SIGABRT(AVD 实测)。lastError 为
                // redact 安全文案,进日志帮助定位失败阶段。
                Log.e(TAG, "startTunnel rejected: code=$rc lastError=${HgNative.statusJson()}")
                disconnect()
                return
            }
        } catch (e: Exception) {
            Log.e(TAG, "config pipe write or bridge call failed")
            // 此路径 startTunnel 未被调用到(管道/桥异常),tun fd 仍归 Kotlin,
            // 由本地回收;一旦已进入 Rust 则不得再碰(见上方契约注释)。
            adoptAndClose(tunFd)
            runCatching { cfgReadFd.close() }
            runCatching { cfgWriteFd.close() }
            disconnect()
            return
        }
        tunHandleFd = tunFd

        // ④ protect 防路由环(方案 §9 O-2:core 建套接字后回吐 fd)。
        val udpFd = HgNative.udp4SocketFd()
        if (udpFd >= 0) {
            if (!protect(udpFd)) {
                Log.e(TAG, "protect(udp fd) failed — routing loop risk, tearing down")
                disconnect()
                return
            }
        } else {
            Log.e(TAG, "no udp socket fd from core — tearing down")
            disconnect()
            return
        }

        handler.post(watchdog)
    }

    /** 断开:stopTunnel 幂等;core 关闭 tun fd;归零回 Disconnected(§5.1)。 */
    private fun disconnect() {
        handler.removeCallbacks(watchdog)
        runCatching { HgNative.stopTunnel() }
        tunHandleFd = -1
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    /** 失败路径回收:tun fd 从未移交成功,由 Kotlin close 一次。 */
    private fun adoptAndClose(fd: Int) {
        runCatching { ParcelFileDescriptor.adoptFd(fd).close() }
    }

    override fun onRevoke() {
        // 方案 §5.1:授权被用户/系统撤回 → 归零 Disconnected。
        // 桥面 stop 幂等;core 关闭 tun fd。
        disconnect()
        super.onRevoke()
    }

    override fun onDestroy() {
        handler.removeCallbacks(watchdog)
        super.onDestroy()
    }

    // ---- 前台服务 + 常驻通知(方案 §5.4:不含任何凭据字段) ----

    private fun ensureNotificationChannel() {
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        if (nm.getNotificationChannel(CHANNEL_ID) == null) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "VPN 隧道", NotificationManager.IMPORTANCE_LOW)
            )
        }
    }

    private fun startForegroundWithNotification() {
        // 阶段 2a 适配:宿主 launch intent 替代 Guard 壳 MainActivity 引用。
        val contentIntent = packageManager.getLaunchIntentForPackage(packageName)?.let { launch ->
            PendingIntent.getActivity(
                this, 0,
                launch,
                PendingIntent.FLAG_IMMUTABLE,
            )
        }
        val notification: Notification = Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("HuanvaeGuard")
            .setContentText("隧道服务运行中")
            .setSmallIcon(android.R.drawable.stat_notify_sync_noanim)
            .setContentIntent(contentIntent)
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(
                NOTIFICATION_ID, notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    companion object {
        private const val TAG = "HgVpnService"
        private const val CHANNEL_ID = "hg_vpn"
        private const val NOTIFICATION_ID = 1
        private const val WATCHDOG_INTERVAL_MS = 2000L

        const val ACTION_CONNECT = "dev.huanvae.guard.CONNECT"
        const val ACTION_DISCONNECT = "dev.huanvae.guard.DISCONNECT"
        const val EXTRA_CONFIG = "config_json"

        /** 系统授权意图(方案 §5.1 RequestingVpnPermission 支;已授权返回 null)。 */
        fun prepareIntent(context: android.content.Context): Intent? = VpnService.prepare(context)
    }
}
