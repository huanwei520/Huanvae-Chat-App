// Copyright (c) 2024-2026 HuanvaeGuard contributors.
// SPDX-License-Identifier: BSD-3-Clause

package dev.huanvae.guard

/**
 * 桥面状态码契约 — 与 Rust 侧 `client/android/src/jni.rs` 逐值镜像。
 * (两侧数字必须同步修改;Rust 侧 `status_code_contract_is_stable` 单测钉值。)
 *
 * 本对象是纯 Kotlin 逻辑,JVM 单测(`app/src/test`)不触及 native。
 */
object HgStatus {
    const val STATUS_STOPPED = 0
    const val STATUS_CONNECTING = 1
    const val STATUS_CONNECTED = 2
    const val ERR_INVALID_FD = -1
    const val ERR_INVALID_STATE = -2
    /** start 失败(设备组建/UAPI 注入失败;细节见状态 JSON last_error)。 */
    const val ERR_START_FAILED = -3
    /** cfgJson 非法(JSON 解析失败/必填字段缺失/私钥格式错)。 */
    const val ERR_INVALID_CONFIG = -4
    /** 控制面启动失败(TLS profile/重复启动/会话缺 device_id;M2)。 */
    const val ERR_CONTROL_FAILED = -5

    /**
     * 状态码 → 状态条文案(方案 §5.2"状态条")。
     * 错误文案不回显 token/URL/配置值(redact 纪律,方案 §3.3)。
     */
    fun text(code: Int): String = when (code) {
        STATUS_STOPPED -> "Disconnected"
        STATUS_CONNECTING -> "Connecting"
        STATUS_CONNECTED -> "Connected"
        ERR_INVALID_FD -> "错误:非法 TUN fd"
        ERR_INVALID_STATE -> "错误:状态机不允许该操作"
        ERR_START_FAILED -> "错误:隧道启动失败"
        ERR_INVALID_CONFIG -> "错误:配置无效"
        ERR_CONTROL_FAILED -> "错误:控制面启动失败"
        else -> "未知状态码:$code"
    }
}
