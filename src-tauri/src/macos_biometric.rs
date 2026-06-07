//! macOS 生物识别（Touch ID / LocalAuthentication 的 LAContext）共享门禁。
//!
//! 同时被两处复用：
//! - `macos_credential_store`：解锁已保存的登录密码前验证。
//! - `biometric_authenticate` 命令：打开 VPN 前验证（前端 HuanvaeGuardPage.handleConnect）。
//!
//! 返回三态，由各调用方决定语义（如"无 Touch ID 硬件"时凭据走手动登录、VPN 直接放行）。
//! 未签名 / ad-hoc dev 包能否真正弹出 Touch ID 取决于系统对该二进制的判定，调用方需有回退。

use std::sync::mpsc;
use std::time::Duration;

/// 生物识别结果三态。
pub enum BiometricResult {
    /// 验证通过。
    Authenticated,
    /// 本机无 Touch ID 硬件 / 未录入指纹（canEvaluatePolicy 为否）。
    Unavailable,
    /// 可用但未通过（取消 / 失败 / 超时），附原因。
    Failed(String),
}

/// LAPolicyDeviceOwnerAuthenticationWithBiometrics = 1（仅生物识别，不回退系统密码）。
const LA_POLICY_BIOMETRICS: objc2_local_authentication::LAPolicy =
    objc2_local_authentication::LAPolicy::DeviceOwnerAuthenticationWithBiometrics;

/// 弹 Touch ID 验证。`reason` 显示在系统验证框上。
pub fn authenticate(reason: &str) -> BiometricResult {
    use block2::RcBlock;
    use objc2::runtime::Bool;
    use objc2_foundation::NSString;
    use objc2_local_authentication::LAContext;

    let context = unsafe { LAContext::new() };

    // canEvaluatePolicy:error: —— 无 Touch ID 硬件 / 未录入指纹时返回 Err
    if unsafe { context.canEvaluatePolicy_error(LA_POLICY_BIOMETRICS) }.is_err() {
        return BiometricResult::Unavailable;
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
        Ok(true) => BiometricResult::Authenticated,
        Ok(false) => BiometricResult::Failed("biometric_failed：Touch ID 验证未通过".to_string()),
        Err(_) => BiometricResult::Failed("biometric_timeout：Touch ID 验证超时".to_string()),
    }
}
