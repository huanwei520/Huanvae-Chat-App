// Copyright (c) 2024-2026 HuanvaeGuard contributors.
// SPDX-License-Identifier: BSD-3-Clause

package dev.huanvae.guard

/**
 * Rust 桥 Kotlin wrapper — 手工 JNI(方案 §3.2/§3.3 采定形态),M2 控制面 v3。
 *
 * 库名裁自 `client/android/Cargo.toml` 的 `[lib] name = "hg_android"`
 * (cdylib → libhg_android.so);Rust 侧符号与状态码见
 * `client/android/src/jni.rs`(状态码契约镜像 [HgStatus])。
 *
 * 编组策略(与 Rust 侧对齐,零 JNI 函数表偏移风险):
 * * 配置/凭据不走 jstring 入站 —— [startTunnel]/[controlStart]/
 *   [applyPeers]/[controlLogin] 的 JSON 与密码都收**管道读端 fd**
 *   (调用方用 [android.os.ParcelFileDescriptor.createPipe] 写入后关写端);
 *   Rust 读到 EOF 即得完整内容,读毕即关(所有权移交)。
 * * 字符串出口 [statusJson] 与控制面结果信封(Rust 侧 NewStringUTF,
 *   jni.h 索引 167)。[controlLogin] 的成功结果**含 token 会话 JSON**:
 *   一次性交 [HgCredentialStore] 加密落盘,任何路径不打日志(redact)。
 */
object HgNative {
    /** 桥面版本(与 Rust 侧 `jni::BRIDGE_VERSION` 镜像;加载自检用)。 */
    const val BRIDGE_VERSION: Int = 3

    init {
        System.loadLibrary("hg_android")
    }

    /** 加载自检:应返回 [BRIDGE_VERSION]。 */
    external fun bridgeVersion(): Int

    /**
     * 建立隧道。
     * @param tunFd VpnService.establish() 的 TUN fd(**已 detachFd 移交**;
     *   成功后归 Rust/core 所有并在 stop 时关闭;失败时调用方自行关闭)
     * @param cfgFd 写有 cfgJson 的管道读端(写端已关;读毕即被 Rust 关闭)
     * @return [HgStatus.STATUS_CONNECTED] 或 HgStatus 错误码
     */
    external fun startTunnel(tunFd: Int, cfgFd: Int): Int

    /** 幂等停桥;返回 [HgStatus.STATUS_STOPPED]。 */
    external fun stopTunnel(): Int

    /** 当前状态码([HgStatus] 契约)。 */
    external fun status(): Int

    /**
     * 状态 JSON(镜像桌面 TunnelStatus 字段:active/interface_name/
     * address/listen_port/peers/control_plane + status_code/last_error;
     * redact 纪律:不含 token/URL/密钥值)。加载失败或桥未就绪时返回 null。
     */
    external fun statusJson(): String?

    /**
     * core 出站 UDP socket fd(方案 §9 O-2 采定:core 建套接字后回吐)。
     * 仅 [HgStatus.STATUS_CONNECTED] 时 >= 0;拿到后必须立即
     * [android.net.VpnService.protect] 防路由环。
     */
    external fun udp4SocketFd(): Int

    /** fd 合法性校验助手(fcntl);真实 protect 由 VpnService.protect 承担。 */
    external fun protectSocketFd(fd: Int): Boolean

    // ---- M2 控制面(方案 §6 M2;信封 JSON 契约见 Rust jni.rs) ----

    /**
     * 登录(`POST /api/auth/login`,Rust 侧对齐 hg-cli 流)。
     * @param masterUrl master 源(唯一 jstring 入站;非凭据)
     * @param userFd user_id 管道读端
     * @param passFd 密码管道读端(凭据走管道不走字符串)
     * @return 信封 JSON:成功 `{"ok":true,"session":{...}}`(session 含
     *   token,须立即加密存储);失败 `{"ok":false,"error":"<redact 安全>"}`
     */
    external fun controlLogin(masterUrl: String, userFd: Int, passFd: Int): String

    /** 设备注册(`POST /api/hg/devices/register`):读 sessionFd 返回带
     *  device_id 的会话信封(形态同 [controlLogin])。 */
    external fun controlRegisterDevice(sessionFd: Int): String

    /** 拉取设备配置(`GET /api/hg/devices/{id}/config`,已归一化为
     *  StartConfig):返回 `{"ok":true,"config":{...}}` 信封。 */
    external fun controlFetchConfig(sessionFd: Int): String

    /**
     * 启动控制面(daemon 拉起:claim + WS 推送 + 兜底轮询 + 401 刷新)。
     * @param sessionFd 会话 JSON 管道读端
     * @return 0 成功;[HgStatus.ERR_INVALID_CONFIG] / [HgStatus.ERR_CONTROL_FAILED]
     */
    external fun controlStart(sessionFd: Int): Int

    /** 幂等停控制面(尽力 release 后归零,镜像桌面 stop 语义);恒 0。 */
    external fun controlStop(): Int

    /**
     * 拓扑热更直控口(镜像桌面 `POST /api/tunnel/peers`):从 peersFd 读
     * peers JSON 数组,活隧道上热更(**不重建**)。
     * @param replace true=拓扑 resync, false=merge
     * @return 0 成功;HgStatus 负数错误码
     */
    external fun applyPeers(peersFd: Int, replace: Boolean): Int
}
