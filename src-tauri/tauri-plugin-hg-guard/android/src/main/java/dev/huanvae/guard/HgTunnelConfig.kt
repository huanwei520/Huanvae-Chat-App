// Copyright (c) 2024-2026 HuanvaeGuard contributors.
// SPDX-License-Identifier: BSD-3-Clause

package dev.huanvae.guard

import org.json.JSONException
import org.json.JSONObject

/**
 * 一条 peer 的配置(镜像桌面 PeerConfig / Rust vpn::PeerConfig)。
 * 纯数据类,JSON 编组由 [HgTunnelConfig] 承担。
 */
data class PeerEntry(
    val publicKey: String,
    val endpoint: String?,
    val allowedIps: String,
    val keepalive: Int?,
    val presharedKey: String?,
)

/**
 * 隧道配置(镜像桌面 StartTunnelRequest / Rust vpn::StartConfig)。
 *
 * 红线落地点:
 * * [address] 必须是精确 /32(Kotlin 侧 addAddress(address, 32));
 * * 每条 [PeerEntry.allowedIps] 的每个前缀必须是精确 /32
 *   (addRoute 逐条声明;非 /32 直接拒配,不做静默收窄);
 * * JSON 里的 listen_port 即便非零也被 Rust 侧强制为 0(红线:client
 *   只用 ephemeral 出口端口),Kotlin 侧根本不读它。
 *
 * JSON 解析用平台自带 org.json;[/32 校验][isExactV4Cidr32] 是纯字符串
 * 逻辑,JVM 单测可覆盖。凭据(私钥/PSK)只在内存,**不落盘不打日志**。
 */
data class HgTunnelConfig(
    val address: String,
    val dnsServers: List<String>,
    val mtu: Int,
    val privateKey: String,
    val peers: List<PeerEntry>,
    val obfuscation: JSONObject,
) {
    companion object {
        /**
         * 精确 IPv4 /32 判定(纯字符串逻辑):`a.b.c.d/32`,每段 0-255,
         * 无前导零宽容——直接按十进制数值校验。v6 前缀首版不支持(方案 O-3:
         * 安卓首版 v4-only 收窄)。
         */
        fun isExactV4Cidr32(s: String): Boolean {
            val parts = s.trim().split("/")
            if (parts.size != 2 || parts[1] != "32") return false
            val octets = parts[0].split(".")
            if (octets.size != 4) return false
            return octets.all {
                it.length in 1..3 && it.all(Char::isDigit) && it.toInt() in 0..255
            }
        }

        /**
         * 合法 IPv4 CIDR 网段判定（前缀 0..32；形态合法即真，不含 /32 独占判断）。
         * 生产 hub 会下发聚合网段路由（实测 2026-09-08；桌面 network.rs:61 同款先例：
         * "10.64.0.0/10 may appear in a peer's allowed_ips"）。
         */
        fun isV4Cidr(s: String): Boolean {
            val parts = s.trim().split("/")
            if (parts.size != 2) return false
            val prefix = parts[1].toIntOrNull() ?: return false
            if (prefix !in 0..32) return false
            val octets = parts[0].split(".")
            if (octets.size != 4) return false
            return octets.all {
                it.length in 1..3 && it.all(Char::isDigit) && it.toInt() in 0..255
            }
        }

        /** 纯 IPv4 地址判定(无前缀;TUN 地址与 DNS 用)。 */
        fun isPlainV4(s: String): Boolean = isExactV4Cidr32("$s/32")

        /**
         * 从 cfgJson 解析并做红线校验。任何校验失败抛 [IllegalArgumentException]
         * (消息 redact 安全:不含配置值本身)。
         */
        fun fromJson(json: String): HgTunnelConfig {
            val root = try {
                JSONObject(json)
            } catch (e: JSONException) {
                throw IllegalArgumentException("config is not valid JSON", e)
            }
            val address = root.optString("address", "")
            if (!isPlainV4(address)) {
                throw IllegalArgumentException("tun address must be an exact IPv4 /32 (v4-only first release)")
            }
            val mtu = root.optInt("mtu", 1280)
            if (mtu !in 576..1500) {
                throw IllegalArgumentException("mtu out of range")
            }
            val privateKey = root.optString("private_key", "")
            if (privateKey.isBlank()) {
                throw IllegalArgumentException("private_key missing")
            }
            val dns = root.optString("dns", "")
                .split(',').map(String::trim).filter(String::isNotEmpty)
                // v4-only first release：非 v4 条目（实测生产 master 会下发含非 v4 段的 dns）
                // 不采用而非拒配 —— dns 是解析增强不是数据面必要件，桌面 daemon 同字段
                // 甚至不应用；因它拒掉整条隧道与红线哲学（allowed_ips /32 等必要件才拒）不符。
                .filter { isPlainV4(it) }
            if (!root.has("obfuscation")) {
                throw IllegalArgumentException("obfuscation params missing")
            }
            val peersJson = root.optJSONArray("peers")
                ?: throw IllegalArgumentException("peers missing")
            val peers = buildList {
                for (i in 0 until peersJson.length()) {
                    val p = peersJson.getJSONObject(i)
                    val pk = p.optString("public_key", "")
                    if (pk.isBlank()) throw IllegalArgumentException("peer public_key missing")
                    val allowed = p.optString("allowed_ips", "")
                    // 红线(修订 2026-09-08):逐条须为合法 IPv4 CIDR；/0 全路由拒收（防全流量接管），
                    // 其余网段与 /32 同收 —— 生产 hub 下发聚合网段路由，桌面侧历来接受（network.rs:61），
                    // 原「非 /32 即拒配」实测把生产配置全部拒死，与生产现实不符。
                    val prefixes = allowed.split(',').map(String::trim).filter(String::isNotEmpty)
                    if (prefixes.isEmpty()) throw IllegalArgumentException("peer allowed_ips empty")
                    prefixes.forEach {
                        if (!isV4Cidr(it)) {
                            throw IllegalArgumentException("allowed_ips must be valid IPv4 CIDR prefixes (red line)")
                        }
                        if (it.endsWith("/0")) {
                            throw IllegalArgumentException("allowed_ips /0 default route rejected (red line)")
                        }
                    }
                    val endpoint = p.optString("endpoint", "")
                    add(
                        PeerEntry(
                            publicKey = pk,
                            endpoint = endpoint.ifBlank { null },
                            allowedIps = allowed,
                            keepalive = if (p.has("persistent_keepalive")) p.getInt("persistent_keepalive") else null,
                            presharedKey = if (p.has("preshared_key")) p.getString("preshared_key") else null,
                        )
                    )
                }
            }
            return HgTunnelConfig(
                address = address,
                dnsServers = dns,
                mtu = mtu,
                privateKey = privateKey,
                peers = peers,
                obfuscation = root.getJSONObject("obfuscation"),
            )
        }

        /** 全部路由前缀(已由 [fromJson] 保证逐条 /32)。 */
        fun routesOf(cfg: HgTunnelConfig): List<String> =
            cfg.peers.flatMap { p ->
                p.allowedIps.split(',').map(String::trim).filter(String::isNotEmpty)
            }.distinct()
    }
}
