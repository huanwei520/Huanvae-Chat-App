// Copyright (c) 2024-2026 HuanvaeGuard contributors.
// SPDX-License-Identifier: BSD-3-Clause

package dev.huanvae.guard

import org.json.JSONException
import org.json.JSONObject

/**
 * 控制面会话逻辑(纯 Kotlin,JVM 单测可覆盖;native 不进 JVM)。
 *
 * 职责边界(方案 §6 M2"Kotlin 控制面客户端"):
 * * 解析 Rust 控制面入口的信封 JSON(`{"ok":...,"session"/"error"}`);
 * * 把会话摘要成 redact 安全的展示文本(token 值不进 UI、不进日志);
 * * 从存储的会话提取 `ControlCredentials` JSON 供 [HgNative.controlStart]
 *   的管道 fd(这是唯一允许携带 token 的出口 —— 管道是进程内传输,不是
 *   日志/展示面)。
 *
 * 持久化由 [HgCredentialStore](AndroidKeyStore AES/GCM)承担;token 值
 * 在内存的生命周期 = 登录会话,绝不写 SharedPreferences 明文、不打 Log。
 */
object HgSession {

    /** 控制面入口的结果信封。 */
    sealed class Envelope {
        /** 成功;[json] 为**完整信封 JSON**,载荷字段按入口取:
         *  controlLogin/controlRegisterDevice → "session";
         *  controlFetchConfig → "config"。 */
        data class Ok(val json: String) : Envelope()

        /** 失败;`error` 是 Rust 侧 redact 后的安全文案(不含凭据值)。 */
        data class Err(val error: String) : Envelope()
    }

    /** 从成功信封取载荷对象(键不存在返回 null)。 */
    fun payload(ok: Envelope.Ok, field: String): JSONObject? = try {
        JSONObject(ok.json).optJSONObject(field)
    } catch (_: JSONException) {
        null
    }

    /** 解析控制面入口的信封 JSON;畸形输入按 Err 处理(文案 redact 安全)。 */
    fun parseEnvelope(json: String?): Envelope = try {
        val o = JSONObject(json ?: "")
        when {
            o.optBoolean("ok", false) ->
                // Ok 携带完整信封;载荷字段由 [payload] 按入口取
                // (session / config),这里不做键位假设。
                Envelope.Ok(o.toString())
            else -> Envelope.Err(
                o.optString("error", "").ifBlank { "控制面操作失败" }
            )
        }
    } catch (_: JSONException) {
        Envelope.Err("控制面返回无法解析")
    }

    /**
     * 会话摘要(redact 安全):只含 master 主机、user、device、VIP;
     * 任何 token 值不出现在返回串里。供 UI 展示与日志。
     */
    fun redactedSummary(sessionJson: String): String = try {
        val o = JSONObject(sessionJson)
        val host = o.optString("master_url", "")
            .removePrefix("https://").removePrefix("http://")
        buildString {
            append("master=")
            append(host.ifBlank { "-" })
            append(" user=").append(o.optString("user_id", "-"))
            append(" device=").append(o.optString("device_id", "未注册"))
            append(" vip=").append(o.optString("virtual_ip", "-"))
        }
    } catch (_: JSONException) {
        "会话数据无法解析"
    }

    /**
     * 是否已有可用的已注册会话(device_id 在位 = 已完成设备注册,
     * 控制面才能寻址 config/WS)。
     * [阶段 2a 适配] 块体化(宿主 Kotlin 1.9.25 不允许表达式体函数内 return,
     * 语义与原件逐字等价)。
     */
    fun isRegistered(sessionJson: String?): Boolean {
        val json = sessionJson ?: return false
        return try {
            val o = JSONObject(json)
            o.optString("device_id", "").isNotBlank()
        } catch (_: JSONException) {
            false
        }
    }

    /**
     * 从会话提取 `ControlCredentials` JSON(Rust daemon.rs 的凭据契约:
     * master_url/device_id/access_token/refresh_token)。
     * 未注册设备返回 null(控制面必须拒绝无 device_id 的会话)。
     *
     * 返回值只允许写入 [HgNative.controlStart] 的管道;不得日志/落盘。
     */
    fun controlCredentialsJson(sessionJson: String): String? = try {
        val o = JSONObject(sessionJson)
        val deviceId = o.optString("device_id", "")
        if (deviceId.isBlank()) {
            null
        } else {
            JSONObject().apply {
                put("master_url", o.optString("master_url", ""))
                put("device_id", deviceId)
                put("access_token", o.optString("access_token", ""))
                putOpt("refresh_token", o.opt("refresh_token"))
            }.toString()
        }
    } catch (_: JSONException) {
        null
    }
}
