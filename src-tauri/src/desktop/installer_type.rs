//! Windows 安装类型检测模块
//!
//! 用于检测当前应用是通过 MSI 还是 NSIS 安装的，
//! 以便更新器使用正确的更新包类型。
//!
//! ## 检测原理
//! - NSIS 安装：在 `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\{ProductName}`
//!   创建注册表项，`UninstallString` 包含 `uninstall.exe`
//! - MSI 安装：同样位置创建注册表项，但 `UninstallString` 包含 `MsiExec.exe`
//!
//! ## 使用场景
//! 前端调用 `check()` 更新检查时，需要根据安装类型传递正确的 `target` 参数：
//! - MSI 安装：`target: "windows-x86_64-msi"`
//! - NSIS 安装：`target: "windows-x86_64"` 或不传（默认）
//!
//! ## 参考文档
//! - Tauri 2 Updater Custom Target: https://v2.tauri.app/plugin/updater/#custom-target
//! - GitHub Discussion: https://github.com/orgs/tauri-apps/discussions/8963
//!
//! ## 更新日志
//! - 2026-01-24: 创建模块，解决 MSI 安装用户更新成 EXE 包的问题

/// 安装类型枚举
///
/// 在非 Windows 平台上，只使用 Unknown 变体
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)] // Nsis 和 Msi 仅在 Windows 上使用
pub enum InstallerType {
    /// NSIS 安装包 (.exe)
    Nsis,
    /// MSI 安装包 (.msi)
    Msi,
    /// 未知类型（可能是开发模式或便携版）
    Unknown,
}

impl InstallerType {
    /// 转换为字符串，用于前端
    pub fn as_str(&self) -> &'static str {
        match self {
            InstallerType::Nsis => "nsis",
            InstallerType::Msi => "msi",
            InstallerType::Unknown => "unknown",
        }
    }
}

/// 检测当前应用的安装类型（仅 Windows）
///
/// 通过查询注册表中的卸载信息来判断安装类型：
/// - 如果 `UninstallString` 包含 `MsiExec`，则为 MSI 安装
/// - 如果 `UninstallString` 包含 `uninstall.exe`，则为 NSIS 安装
/// - 否则返回 Unknown
#[cfg(target_os = "windows")]
pub fn detect_installer_type() -> InstallerType {
    use winreg::enums::*;
    use winreg::RegKey;

    // 产品名称（与 tauri.conf.json 中的 productName 一致）
    const PRODUCT_NAME: &str = "Huanvae-Chat-App";

    // 尝试查找注册表项的路径列表
    // NSIS currentUser 模式安装在 HKCU
    // MSI 或 NSIS perMachine 模式安装在 HKLM
    let search_paths = [
        (
            HKEY_CURRENT_USER,
            format!(
                r"Software\Microsoft\Windows\CurrentVersion\Uninstall\{}",
                PRODUCT_NAME
            ),
        ),
        (
            HKEY_LOCAL_MACHINE,
            format!(
                r"Software\Microsoft\Windows\CurrentVersion\Uninstall\{}",
                PRODUCT_NAME
            ),
        ),
        // 有时 MSI 使用产品 GUID 作为键名，尝试遍历查找
    ];

    for (hkey, path) in &search_paths {
        if let Ok(key) = RegKey::predef(*hkey).open_subkey(path) {
            // 检查 UninstallString
            if let Ok(uninstall_string) = key.get_value::<String, _>("UninstallString") {
                let uninstall_lower = uninstall_string.to_lowercase();

                if uninstall_lower.contains("msiexec") {
                    return InstallerType::Msi;
                } else if uninstall_lower.contains("uninstall.exe") {
                    return InstallerType::Nsis;
                }
            }

            // 备用检查：WindowsInstaller 值（MSI 特有）
            if let Ok(windows_installer) = key.get_value::<u32, _>("WindowsInstaller") {
                if windows_installer == 1 {
                    return InstallerType::Msi;
                }
            }
        }
    }

    // 如果上述方法都没找到，尝试遍历 Uninstall 下的所有子键查找包含产品名的项
    for hkey in [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE] {
        if let Ok(uninstall_key) =
            RegKey::predef(hkey).open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Uninstall")
        {
            for subkey_name in uninstall_key.enum_keys().filter_map(|r| r.ok()) {
                if let Ok(subkey) = uninstall_key.open_subkey(&subkey_name) {
                    // 检查 DisplayName 是否匹配
                    if let Ok(display_name) = subkey.get_value::<String, _>("DisplayName") {
                        if display_name.contains(PRODUCT_NAME) || display_name.contains("Huanvae") {
                            // 找到了，检查安装类型
                            if let Ok(uninstall_string) =
                                subkey.get_value::<String, _>("UninstallString")
                            {
                                let uninstall_lower = uninstall_string.to_lowercase();
                                if uninstall_lower.contains("msiexec") {
                                    return InstallerType::Msi;
                                } else if uninstall_lower.contains("uninstall.exe") {
                                    return InstallerType::Nsis;
                                }
                            }

                            // 备用检查
                            if let Ok(windows_installer) =
                                subkey.get_value::<u32, _>("WindowsInstaller")
                            {
                                if windows_installer == 1 {
                                    return InstallerType::Msi;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    InstallerType::Unknown
}

/// 非 Windows 平台的存根实现
#[cfg(not(target_os = "windows"))]
pub fn detect_installer_type() -> InstallerType {
    InstallerType::Unknown
}

/// 获取 Windows 安装类型（供 Tauri 命令调用）
///
/// 返回值：
/// - `"msi"`: MSI 安装包
/// - `"nsis"`: NSIS 安装包 (.exe)
/// - `"unknown"`: 未知类型
///
/// 注意：Tauri 命令在 lib.rs 中定义（使用条件编译支持移动端存根）
pub fn get_windows_installer_type() -> String {
    detect_installer_type().as_str().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_installer_type_as_str() {
        assert_eq!(InstallerType::Nsis.as_str(), "nsis");
        assert_eq!(InstallerType::Msi.as_str(), "msi");
        assert_eq!(InstallerType::Unknown.as_str(), "unknown");
    }

    #[test]
    fn test_detect_installer_type_returns_valid_type() {
        let result = detect_installer_type();
        // 在非 Windows 平台或未安装的情况下应返回 Unknown
        // 在已安装的 Windows 上应返回 Msi 或 Nsis
        assert!(matches!(
            result,
            InstallerType::Nsis | InstallerType::Msi | InstallerType::Unknown
        ));
    }
}
