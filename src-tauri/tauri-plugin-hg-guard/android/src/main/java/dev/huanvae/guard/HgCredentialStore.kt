// Copyright (c) 2024-2026 HuanvaeGuard contributors.
// SPDX-License-Identifier: BSD-3-Clause

package dev.huanvae.guard

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.Log
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * 控制面凭据存储 — AndroidKeyStore AES/GCM(方案 §6 M2 凭据件)。
 *
 * 分层红线(vpn.rs 模块头 + 方案 §4.2):
 * * **APK 签名 keystore 与凭据加密密钥分层**:本类只用 AndroidKeyStore 里
 *   自建的 AES 密钥(hardware-backed,不可导出),与 APK 签名身份、
 *   minisign 配置分发身份互不混用,三者都不入仓库;
 * * SharedPreferences 文件里只有 **Keystore 加密后的密文**(随机 IV 前缀
 *   + base64),密钥材料永不离开 AndroidKeyStore;
 * * 运行时存储:随应用卸载/清数据一并销毁;不进系统备份
 *   (manifest `allowBackup=false`)。
 *
 * 实现说明:等价于 androidx EncryptedSharedPreferences 的最小自含版
 * (AES-256/GCM/无关联数据/12B IV),不引入已停更的 security-crypto 依赖。
 */
object HgCredentialStore {

    private const val TAG = "HgCredentialStore"
    private const val ANDROID_KEYSTORE = "AndroidKeyStore"
    private const val KEY_ALIAS = "hg_session_key"
    private const val PREF_FILE = "hg_credentials"
    private const val PREF_FIELD = "session_blob"
    private const val GCM_IV_BYTES = 12
    private const val GCM_TAG_BITS = 128

    /** 保存会话 JSON(整条覆盖;token 只以密文形态落盘)。 */
    fun save(context: Context, sessionJson: String) {
        try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
            val iv = cipher.iv
            val ct = cipher.doFinal(sessionJson.toByteArray(Charsets.UTF_8))
            val blob = Base64.encodeToString(iv + ct, Base64.NO_WRAP)
            context.getSharedPreferences(PREF_FILE, Context.MODE_PRIVATE)
                .edit().putString(PREF_FIELD, blob).apply()
        } catch (e: Exception) {
            // redact 纪律:异常不携带明文(异常对象只进类型名)。
            Log.e(TAG, "credential store save failed: ${e.javaClass.simpleName}")
        }
    }

    /** 读取会话 JSON;无存储/解密失败(如密钥被系统清除)返回 null。 */
    fun load(context: Context): String? {
        return try {
            val blob = context.getSharedPreferences(PREF_FILE, Context.MODE_PRIVATE)
                .getString(PREF_FIELD, null) ?: return null
            val raw = Base64.decode(blob, Base64.NO_WRAP)
            if (raw.size <= GCM_IV_BYTES) return null
            val iv = raw.copyOfRange(0, GCM_IV_BYTES)
            val ct = raw.copyOfRange(GCM_IV_BYTES, raw.size)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(GCM_TAG_BITS, iv))
            String(cipher.doFinal(ct), Charsets.UTF_8)
        } catch (e: Exception) {
            Log.e(TAG, "credential store load failed: ${e.javaClass.simpleName}")
            null
        }
    }

    /** 清除会话(退出登录)。密钥本身保留(无害:无密文即无凭据)。 */
    fun clear(context: Context) {
        context.getSharedPreferences(PREF_FILE, Context.MODE_PRIVATE)
            .edit().remove(PREF_FIELD).apply()
    }

    /** 取 AndroidKeyStore 内的会话加密密钥;不存在则生成(AES-256,GCM 专用)。 */
    private fun getOrCreateKey(): SecretKey {
        val ks = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        (ks.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        gen.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return gen.generateKey()
    }
}
