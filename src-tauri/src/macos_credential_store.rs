//! macOS 凭据存储（App 私有 AES-256-GCM 加密文件 + Touch ID 门禁）
//!
//! ## 为什么不用系统钥匙串
//! 未签名 / ad-hoc 签名的 App 在 macOS 上每次读系统钥匙串都会弹 ACL 授权框
//! （`SecKeychainFindGenericPassword` 对"非本签名创建的条目"弹框，dev 每次重构签名都变）。
//! 本模块改为把密码加密写进 App 私有目录文件，读取前用 LocalAuthentication（Touch ID）门禁，
//! 从而 **0 系统钥匙串弹框**。详见 `.claude/rules/common.md` 的钥匙串段。
//!
//! ## 安全取舍（未签名硬限制，已与用户确认）
//! 拿不到 Secure Enclave / 数据保护钥匙串（那要签名 + entitlement）。AES 密钥必须能被 App
//! **无提示**派生（否则无法自动登录），故密钥 = `SHA256(内置 salt ‖ 设备 host UUID)`：
//! - 换一台机器无法解密（host UUID 不同）→ 防"只拷走密文文件"。
//! - 同机能读该文件 + 跑本 App 代码者，可自行派生密钥 → 本质是"强混淆 + Touch ID 体验门禁"，
//!   **非 Secure Enclave 级强加密**。这比系统钥匙串安全性下降，换来的是 0 弹框 + Touch ID。
//!
//! ## Touch ID
//! 读取前 `LAContext.evaluatePolicy(DeviceOwnerAuthenticationWithBiometrics)`；
//! 失败 / 取消 / 无 Touch ID 硬件 → 返回错误，由前端 desktop 分支转手动输密码登录（回退）。

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::mpsc;
use std::time::Duration;

use aes_gcm::aead::Aead;
use aes_gcm::{Aes256Gcm, Key, KeyInit, Nonce};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::storage::StorageError;

/// 密钥派生 salt（内置常量；混淆而非保密，见模块注释的安全取舍）。
const APP_SALT: &[u8] = b"huanvae-chat::macos-credential-store::v1";
/// 密文文件名（放 App 私有数据目录）。
const CRED_FILE: &str = "credentials.enc";
/// AES-256-GCM nonce 长度。
const NONCE_LEN: usize = 12;

/// 单条加密凭据（nonce + 密文，明文 server/user 作为 map key 不入密文）。
#[derive(Serialize, Deserialize)]
struct StoredEntry {
    nonce: Vec<u8>,
    ciphertext: Vec<u8>,
}

type CredMap = HashMap<String, StoredEntry>;

// ============================================================================
// 密钥派生：SHA256(host UUID ‖ salt)
// ============================================================================

/// 取本机 host UUID（16 字节）。换机即变 → 密文不可跨机解密。
/// 直接用 libc 已导出的 `gethostuuid`（Darwin: `int gethostuuid(uuid_t, const struct timespec *)`）。
fn host_uuid() -> Result<[u8; 16], StorageError> {
    let mut id = [0u8; 16];
    // timeout 5s 兜底（host UUID 本地通常立即返回）
    let wait = libc::timespec { tv_sec: 5, tv_nsec: 0 };
    let rc = unsafe { libc::gethostuuid(id.as_mut_ptr(), &wait) };
    if rc != 0 {
        return Err(StorageError::Crypto(format!("gethostuuid 失败 rc={rc}")));
    }
    Ok(id)
}

/// 由设备 UUID + 内置 salt 派生 256-bit AES 密钥。
fn derive_key() -> Result<Key<Aes256Gcm>, StorageError> {
    let uuid = host_uuid()?;
    let mut hasher = Sha256::new();
    hasher.update(APP_SALT);
    hasher.update(uuid);
    let digest = hasher.finalize(); // 32 bytes
    Ok(*Key::<Aes256Gcm>::from_slice(&digest))
}

// ============================================================================
// 加解密
// ============================================================================

fn encrypt(plaintext: &str) -> Result<StoredEntry, StorageError> {
    let key = derive_key()?;
    let cipher = Aes256Gcm::new(&key);

    let mut nonce_bytes = [0u8; NONCE_LEN];
    getrandom::getrandom(&mut nonce_bytes)
        .map_err(|e| StorageError::Crypto(format!("nonce 随机数失败: {e}")))?;
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| StorageError::Crypto(format!("加密失败: {e}")))?;

    Ok(StoredEntry {
        nonce: nonce_bytes.to_vec(),
        ciphertext,
    })
}

fn decrypt(entry: &StoredEntry) -> Result<String, StorageError> {
    if entry.nonce.len() != NONCE_LEN {
        return Err(StorageError::Crypto("nonce 长度非法".to_string()));
    }
    let key = derive_key()?;
    let cipher = Aes256Gcm::new(&key);
    let nonce = Nonce::from_slice(&entry.nonce);

    let plaintext = cipher
        .decrypt(nonce, entry.ciphertext.as_ref())
        .map_err(|e| StorageError::Crypto(format!("解密失败（可能换机或文件损坏）: {e}")))?;
    String::from_utf8(plaintext).map_err(|e| StorageError::Crypto(format!("UTF-8 解码失败: {e}")))
}

// ============================================================================
// 文件读写（明文 map 结构，value 为各自加密的密文）
// ============================================================================

fn cred_file_path() -> Result<PathBuf, StorageError> {
    Ok(crate::storage::get_app_data_dir()?.join(CRED_FILE))
}

fn read_map() -> Result<CredMap, StorageError> {
    let path = cred_file_path()?;
    if !path.exists() {
        return Ok(CredMap::new());
    }
    let content = std::fs::read_to_string(&path)?;
    if content.trim().is_empty() {
        return Ok(CredMap::new());
    }
    Ok(serde_json::from_str(&content)?)
}

fn write_map(map: &CredMap) -> Result<(), StorageError> {
    use std::os::unix::fs::PermissionsExt;
    let path = cred_file_path()?;
    let content = serde_json::to_string_pretty(map)?;
    std::fs::write(&path, content)?;
    // 收紧权限至仅属主可读写(0600)，降低同机其他本地用户读取密文的门槛
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
    Ok(())
}

// ============================================================================
// Touch ID（LocalAuthentication / LAContext）
// ============================================================================

/// LAPolicyDeviceOwnerAuthenticationWithBiometrics = 1（仅生物识别，不回退系统密码）。
const LA_POLICY_BIOMETRICS: objc2_local_authentication::LAPolicy =
    objc2_local_authentication::LAPolicy::DeviceOwnerAuthenticationWithBiometrics;

/// 弹 Touch ID 验证；通过返回 Ok，否则 Err（前端据此转手动登录）。
fn touch_id_gate(reason: &str) -> Result<(), StorageError> {
    use block2::RcBlock;
    use objc2::runtime::Bool;
    use objc2_foundation::NSString;
    use objc2_local_authentication::LAContext;

    let context = unsafe { LAContext::new() };

    // canEvaluatePolicy:error: —— 无 Touch ID 硬件 / 未录入指纹时返回 Err
    if unsafe { context.canEvaluatePolicy_error(LA_POLICY_BIOMETRICS) }.is_err() {
        return Err(StorageError::Biometric(
            "biometric_unavailable：本机不支持或未启用 Touch ID".to_string(),
        ));
    }

    let reason_ns = NSString::from_str(reason);
    let (tx, rx) = mpsc::channel::<bool>();
    let reply = RcBlock::new(move |success: Bool, _err: *mut objc2_foundation::NSError| {
        let _ = tx.send(success.as_bool());
    });

    unsafe {
        context.evaluatePolicy_localizedReason_reply(LA_POLICY_BIOMETRICS, &reason_ns, &reply);
    }

    // evaluatePolicy 异步回调；阻塞等待结果（reply 在私有队列触发，不会死锁）
    match rx.recv_timeout(Duration::from_secs(60)) {
        Ok(true) => Ok(()),
        Ok(false) => Err(StorageError::Biometric("biometric_failed：Touch ID 验证未通过".to_string())),
        Err(_) => Err(StorageError::Biometric("biometric_timeout：Touch ID 验证超时".to_string())),
    }
}

// ============================================================================
// 对外 API（storage.rs 的 macOS 分支调用）
// ============================================================================

/// 保存密码（加密写文件，不需 Touch ID —— 此刻用户刚用密码登录成功）。
pub fn save_password(server_url: &str, user_id: &str, password: &str) -> Result<(), StorageError> {
    let key = crate::storage::make_keyring_key(server_url, user_id);
    let mut map = read_map()?;
    map.insert(key, encrypt(password)?);
    write_map(&map)
}

/// 读取密码（先 Touch ID 门禁，再解密）。
/// 未保存 → "未找到保存的密码"（前端转手动登录）；Touch ID 失败 → Biometric 错误（前端转手动登录）。
pub fn get_password(server_url: &str, user_id: &str) -> Result<String, StorageError> {
    let key = crate::storage::make_keyring_key(server_url, user_id);
    let map = read_map()?;
    let Some(entry) = map.get(&key) else {
        return Err(StorageError::AccountNotFound);
    };
    touch_id_gate("解锁已保存的登录密码")?;
    decrypt(entry)
}

/// 删除密码（移除该条目，不需 Touch ID）。
pub fn delete_password(server_url: &str, user_id: &str) -> Result<(), StorageError> {
    let key = crate::storage::make_keyring_key(server_url, user_id);
    let mut map = read_map()?;
    if map.remove(&key).is_some() {
        write_map(&map)?;
    }
    Ok(())
}

// ============================================================================
// 测试（纯函数：派生确定性 + 加解密 roundtrip；Touch ID/文件 IO 不在单测覆盖）
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derive_key_is_deterministic() {
        // 同机两次派生应一致（host UUID + salt 固定）
        let k1 = derive_key().expect("derive 1");
        let k2 = derive_key().expect("derive 2");
        assert_eq!(k1.as_slice(), k2.as_slice());
        assert_eq!(k1.len(), 32);
    }

    #[test]
    fn encrypt_decrypt_roundtrip() {
        let secret = "p@ssw0rd-中文-🔐";
        let entry = encrypt(secret).expect("encrypt");
        assert_eq!(entry.nonce.len(), NONCE_LEN);
        assert_ne!(entry.ciphertext, secret.as_bytes()); // 确为密文
        let back = decrypt(&entry).expect("decrypt");
        assert_eq!(back, secret);
    }

    #[test]
    fn different_nonce_each_encrypt() {
        // 随机 nonce → 同明文两次密文不同
        let a = encrypt("same").expect("a");
        let b = encrypt("same").expect("b");
        assert_ne!(a.nonce, b.nonce);
        assert_ne!(a.ciphertext, b.ciphertext);
    }

    #[test]
    fn tampered_ciphertext_fails() {
        // GCM 认证：篡改密文应解密失败
        let mut entry = encrypt("secret").expect("enc");
        if let Some(byte) = entry.ciphertext.first_mut() {
            *byte ^= 0xFF;
        }
        assert!(decrypt(&entry).is_err());
    }
}
