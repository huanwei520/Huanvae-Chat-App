// Copyright (c) 2024-2026 HuanvaeGuard contributors.
// SPDX-License-Identifier: BSD-3-Clause

package dev.huanvae.guard.tauri

import android.app.Activity
import android.content.Intent
import android.os.Build
import android.os.ParcelFileDescriptor
import android.util.Log
import android.webkit.WebView
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import dev.huanvae.guard.HgNative
import dev.huanvae.guard.HgSession
import dev.huanvae.guard.HgStatus
import dev.huanvae.guard.HgVpnService
import org.json.JSONException
import org.json.JSONObject

/**
 * HgGuardPlugin — tauri 插件适配层（阶段 2a，路径 C）。
 *
 * 职责边界：
 * * 把 tauri 命令面（Rust `#[tauri::command]` hg_status/hg_connect/hg_disconnect/
 *   hg_prepare_vpn/hg_control_start/hg_control_stop 经 run_mobile_plugin 到本类
 *   `@Command`）翻译为 Guard 桥调用（dev.huanvae.guard 包，JNI 符号契约原样）；
 * * 会话凭据在本层只做进程内搬运：合并 master_url → 管道 fd（[callViaPipe]）
 *   → HgNative JNI。不打日志、不落盘（日志一律 redact 安全文案/错误码）；
 * * 授权链走 tauri 插件框架自带的 `startActivityForResult` + `@ActivityCallback`
 *   （PluginManager 在 TauriActivity onCreate 时 registerForActivityResult），
 *   不要求宿主 MainActivity 覆写 onActivityResult。
 *
 * 桥可用性：libhg_android.so 由本插件 android module 的 jniLibs 打包；
 * [load] 做 BRIDGE_VERSION 自检（Guard 契约 =3），失败则全部桥命令拒绝为
 * hg_guard_bridge_unavailable（HgNative 类初始化失败后再触碰会抛
 * NoClassDefFoundError，故所有桥调用必须在 [bridgeReady] 门后）。
 */
@TauriPlugin
class HgGuardPlugin(private val activity: Activity) : Plugin(activity) {

    // ---- 桥自检 ----

    private var bridgeCheckError: String? = null

    private val bridgeOk: Boolean by lazy {
        try {
            val v = HgNative.bridgeVersion()
            if (v == HgNative.BRIDGE_VERSION) {
                true
            } else {
                val err = "BRIDGE_VERSION mismatch: lib=$v expected=${HgNative.BRIDGE_VERSION}"
                bridgeCheckError = err
                Log.e(TAG, err)
                false
            }
        } catch (t: Throwable) {
            // ExceptionInInitializerError / UnsatisfiedLinkError / NoClassDefFoundError
            val err = "bridge load failed: ${t.javaClass.simpleName}"
            bridgeCheckError = err
            Log.e(TAG, err)
            false
        }
    }

    /** 桥未就绪时拒绝并返回 false（调用方直接 return）。 */
    private fun bridgeReady(invoke: Invoke): Boolean {
        if (bridgeOk) return true
        invoke.reject("$ERR_BRIDGE_UNAVAILABLE:${bridgeCheckError ?: "unknown"}")
        return false
    }

    override fun load(webView: WebView) {
        super.load(webView)
        // 触发 System.loadLibrary + BRIDGE_VERSION 自检；结果进 bridgeOk 缓存。
        bridgeOk
    }

    // ---- hg_status：状态投影（statusJson 等价物） ----

    @Command
    fun hgStatus(invoke: Invoke) {
        if (!bridgeReady(invoke)) return
        try {
            val ret = JSObject()
            ret.put("available", true)
            ret.put("bridgeVersion", HgNative.bridgeVersion())
            ret.put("statusCode", HgNative.status())
            // statusJson 原文（redact 安全）；null 用 JSONObject.NULL 保键位。
            ret.put("statusJson", HgNative.statusJson() ?: JSONObject.NULL)
            invoke.resolve(ret)
        } catch (t: Throwable) {
            bridgeFailure(invoke, t)
        }
    }

    // ---- hg_connect：StartConfig 获取链 + 隧道启动 ----

    @InvokeArg
    class SessionArgs {
        var masterUrl: String? = null
        var session: String? = null
    }

    @Command
    fun hgConnect(invoke: Invoke) {
        if (!bridgeReady(invoke)) return
        val args = invoke.parseArgs(SessionArgs::class.java)
        val sessionJson = args.session
        if (sessionJson.isNullOrBlank()) {
            invoke.reject("$ERR_INVALID_ARGS:session required")
            return
        }
        val merged = withMasterUrl(sessionJson, args.masterUrl)

        // ① 拉取并归一化 StartConfig（Rust 核心 redact 纪律；/32、listen_port=0 红线）。
        val envelope = try {
            HgSession.parseEnvelope(callViaPipe(merged) { fd -> HgNative.controlFetchConfig(fd) })
        } catch (e: Exception) {
            invoke.reject("$ERR_FETCH_CONFIG:${e.javaClass.simpleName}")
            return
        }
        val configJson = when (envelope) {
            is HgSession.Envelope.Err -> {
                invoke.reject("$ERR_FETCH_CONFIG:${envelope.error}")
                return
            }
            is HgSession.Envelope.Ok -> HgSession.payload(envelope, "config")?.toString()
        }
        if (configJson.isNullOrBlank()) {
            invoke.reject("$ERR_FETCH_CONFIG:empty config")
            return
        }

        // ② 授权闸：prepare 返回非 null = 尚未授权（前端先走 hg_prepare_vpn）。
        if (HgVpnService.prepareIntent(activity) != null) {
            invoke.reject(ERR_VPN_NOT_PREPARED)
            return
        }

        // ③ 起服务：establish() + startTunnel(tunFd, cfgFd) 在 HgVpnService 内闭环。
        val intent = Intent(activity, HgVpnService::class.java)
            .setAction(HgVpnService.ACTION_CONNECT)
            .putExtra(HgVpnService.EXTRA_CONFIG, configJson)
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
        invoke.resolve(JSObject().put("ok", true).put("statusCode", HgNative.status()))
    }

    // ---- hg_disconnect：幂等断开 ----

    @Command
    fun hgDisconnect(invoke: Invoke) {
        if (!bridgeReady(invoke)) return
        // 控制面先停（幂等；尽力 release）。
        runCatching { HgNative.controlStop() }
        // 服务收尾：ACTION_DISCONNECT → disconnect() → stopTunnel + 前台撤除。
        // App 退后台时 startService 可能被平台拒绝（Android 12+ 后台服务启动限制），
        // 此时直调桥 stopTunnel（幂等），服务侧 watchdog（2s 轮询）自愈收尾。
        val svc = Intent(activity, HgVpnService::class.java)
            .setAction(HgVpnService.ACTION_DISCONNECT)
        val viaService = runCatching { activity.startService(svc) }.isSuccess
        if (!viaService && runCatching { HgNative.status() }.getOrDefault(HgStatus.STATUS_STOPPED) != HgStatus.STATUS_STOPPED) {
            runCatching { HgNative.stopTunnel() }
        }
        invoke.resolve(JSObject().put("ok", true).put("statusCode", HgNative.status()))
    }

    // ---- hg_prepare_vpn：VpnService 系统授权 ----

    @Command
    fun hgPrepareVpn(invoke: Invoke) {
        // 授权流不触碰桥，无需 bridgeReady 门槛。
        val prepareIntent = HgVpnService.prepareIntent(activity)
        if (prepareIntent == null) {
            // 已授权：静默直连分支（Guard MainActivity.kt:154 同语义）。
            invoke.resolve(JSObject().put("authorized", true))
            return
        }
        // startActivityForResult 要求主线程；插件框架经 PluginManager 内部
        // registerForActivityResult 的 launcher 启动系统授权对话框，
        // 结果回调 [vpnPermissionResult]。
        activity.runOnUiThread {
            startActivityForResult(invoke, prepareIntent, "vpnPermissionResult")
        }
    }

    @ActivityCallback
    fun vpnPermissionResult(invoke: Invoke, result: ActivityResult) {
        val authorized = result.resultCode == Activity.RESULT_OK
        invoke.resolve(JSObject().put("authorized", authorized))
    }

    // ---- hg_control_start / hg_control_stop：控制面 daemon ----

    @Command
    fun hgControlStart(invoke: Invoke) {
        if (!bridgeReady(invoke)) return
        val args = invoke.parseArgs(SessionArgs::class.java)
        val sessionJson = args.session
        if (sessionJson.isNullOrBlank()) {
            invoke.reject("$ERR_INVALID_ARGS:session required")
            return
        }
        val merged = withMasterUrl(sessionJson, args.masterUrl)
        // ControlCredentials 契约抽取仅作 device_id 预检（未注册快速失败）。
        // 管道载荷必须是**完整会话 JSON**（control.rs StoredSession 契约：
        // "序列化为 JSON…再经管道 fd 原样递回给 JNI 控制面入口"）——
        // control_start_fd 侧按 StoredSession::from_json 反序列化，user_id 为
        // 必填字段；实测定（2026-09-08）抽薄后的 ControlCredentials（无
        // user_id）必得 ERR_INVALID_CONFIG(-4)，控制面永远起不来。与
        // hgConnect 的管道载荷（merged 原文）对齐。
        val creds = HgSession.controlCredentialsJson(merged)
        if (creds == null) {
            invoke.reject("$ERR_CONTROL_FAILED:session has no device_id (register device first)")
            return
        }
        val rc = try {
            callViaPipe(merged) { fd -> HgNative.controlStart(fd) }
        } catch (e: Exception) {
            invoke.reject("$ERR_CONTROL_FAILED:${e.javaClass.simpleName}")
            return
        }
        if (rc == 0) {
            invoke.resolve(JSObject().put("ok", true))
        } else {
            // 失败细节只走码 + redact 文案（HgStatus.ERR_INVALID_CONFIG/-5 等）。
            invoke.reject("$ERR_CONTROL_FAILED:code=$rc lastError=${HgNative.statusJson()}")
        }
    }

    @Command
    fun hgControlStop(invoke: Invoke) {
        if (!bridgeReady(invoke)) return
        runCatching { HgNative.controlStop() }
            .onFailure { t -> bridgeFailure(invoke, t) }
            .onSuccess {
                invoke.resolve(JSObject().put("ok", true))
            }
    }

    // ---- 内部助手 ----

    /**
     * 管道 fd 语义（与 Guard LoginActivity.kt:258-266 同构）：payload 写入
     * 管道写端并关闭（Rust 读到 EOF），读端 detachFd 移交 JNI；Rust 读毕即关。
     * 这是凭据进 Rust 核心的唯一通道（不以 jstring 入站）。
     */
    private fun <T> callViaPipe(payload: String, call: (readFd: Int) -> T): T {
        val (readFd, writeFd) = ParcelFileDescriptor.createPipe()
        try {
            ParcelFileDescriptor.AutoCloseOutputStream(writeFd).use { w ->
                w.write(payload.toByteArray(Charsets.UTF_8))
            }
        } catch (e: Exception) {
            // 写失败 = 管道未消费，读端 fd 仍归 Kotlin，回收。
            runCatching { readFd.close() }
            throw e
        }
        return call(readFd.detachFd())
    }

    /** 会话缺 master_url 时并入命令参数的 masterUrl（明文字段，非凭据）。 */
    private fun withMasterUrl(sessionJson: String, masterUrl: String?): String = try {
        val o = JSONObject(sessionJson)
        if (o.optString("master_url", "").isBlank() && !masterUrl.isNullOrBlank()) {
            o.put("master_url", masterUrl)
        }
        o.toString()
    } catch (_: JSONException) {
        sessionJson
    }

    /** 桥调用中途抛错（如类初始化失败后的 NoClassDefFoundError）。 */
    private fun bridgeFailure(invoke: Invoke, t: Throwable) {
        Log.e(TAG, "bridge call failed: ${t.javaClass.simpleName}")
        invoke.reject("$ERR_BRIDGE_UNAVAILABLE:${t.javaClass.simpleName}")
    }

    companion object {
        private const val TAG = "HgGuardPlugin"

        /** 拒绝前缀（前端按前缀分流；文案 redact 安全）。 */
        const val ERR_BRIDGE_UNAVAILABLE = "hg_guard_bridge_unavailable"
        const val ERR_INVALID_ARGS = "hg_guard_invalid_args"
        const val ERR_FETCH_CONFIG = "hg_guard_fetch_config_failed"
        const val ERR_VPN_NOT_PREPARED = "hg_guard_vpn_not_prepared"
        const val ERR_START_SERVICE = "hg_guard_start_service_failed"
        const val ERR_CONTROL_FAILED = "hg_guard_control_failed"
    }
}
