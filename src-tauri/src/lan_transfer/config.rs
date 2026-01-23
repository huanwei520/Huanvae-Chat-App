/*!
 * 局域网传输配置管理模块
 *
 * 管理局域网传输的配置，包括：
 * - 接收文件保存目录
 * - 临时文件目录（断点续传用）
 * - 信任设备列表
 * - 自动接受设置
 */

use chrono::Utc;
use once_cell::sync::OnceCell;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use thiserror::Error;

// ============================================================================
// Android 数据目录（全局变量）
// ============================================================================

/// Android 上使用 Tauri 提供的应用数据目录（用于配置文件）
/// 必须在应用启动时通过 init_android_data_dir 初始化
#[cfg(target_os = "android")]
static ANDROID_DATA_DIR: OnceCell<PathBuf> = OnceCell::new();

/// Android 公共 Download 目录（用于接收文件，用户可访问）
#[cfg(target_os = "android")]
static ANDROID_PUBLIC_DIR: OnceCell<PathBuf> = OnceCell::new();

/// 初始化 Android 数据目录
/// 必须在应用启动时（setup 阶段）调用一次
#[cfg(target_os = "android")]
pub fn init_android_data_dir(path: PathBuf) -> Result<(), String> {
    // 应用内部目录（用于配置文件）
    let lan_transfer_dir = path.join("LanTransfer");
    if !lan_transfer_dir.exists() {
        fs::create_dir_all(&lan_transfer_dir).map_err(|e| {
            format!(
                "Android 创建 LanTransfer 目录失败 {:?}: {}",
                lan_transfer_dir, e
            )
        })?;
    }

    ANDROID_DATA_DIR
        .set(lan_transfer_dir)
        .map_err(|_| "Android LanTransfer 数据目录已初始化".to_string())?;

    // 公共 Download 目录（用于接收文件，用户可在文件管理器中访问）
    // 路径: /storage/emulated/0/Download/HuanvaeChat
    let public_download = PathBuf::from("/storage/emulated/0/Download/HuanvaeChat");
    if !public_download.exists() {
        if let Err(e) = fs::create_dir_all(&public_download) {
            // 如果无法创建公共目录，使用应用外部存储目录
            eprintln!(
                "[LanTransfer] 警告: 无法创建公共 Download 目录 {:?}: {}",
                public_download, e
            );
            eprintln!("[LanTransfer] 将使用应用外部存储目录作为备选");
            // 备选: /storage/emulated/0/Android/data/{package}/files/LanTransfer
            let fallback = PathBuf::from("/storage/emulated/0/Android/data/com.github.huanwei520.huanvae_chat_app/files/LanTransfer");
            let _ = fs::create_dir_all(&fallback);
            let _ = ANDROID_PUBLIC_DIR.set(fallback);
            return Ok(());
        }
    }

    let _ = ANDROID_PUBLIC_DIR.set(public_download);
    Ok(())
}

/// 获取 Android 公共保存目录
#[cfg(target_os = "android")]
pub fn get_android_public_save_dir() -> PathBuf {
    ANDROID_PUBLIC_DIR
        .get()
        .cloned()
        .unwrap_or_else(|| PathBuf::from("/storage/emulated/0/Download/HuanvaeChat"))
}

// ============================================================================
// 错误类型
// ============================================================================

#[derive(Error, Debug)]
pub enum ConfigError {
    #[error("配置文件写入失败: {0}")]
    WriteFailed(String),
    #[error("目录创建失败: {0}")]
    DirectoryCreationFailed(String),
    #[error("无效的路径: {0}")]
    InvalidPath(String),
}

// ============================================================================
// 配置结构
// ============================================================================

/// 局域网传输配置
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LanTransferConfig {
    /// 接收文件保存目录
    pub save_directory: PathBuf,
    /// 临时文件目录（用于断点续传）
    pub temp_directory: PathBuf,
    /// 是否按日期分组保存文件
    pub group_by_date: bool,
    /// 自动接受来自已信任设备的传输
    pub auto_accept_trusted: bool,
    /// 已信任的设备 ID 列表
    pub trusted_devices: Vec<TrustedDevice>,
    /// 最大同时传输数
    pub max_concurrent_transfers: u32,
    /// 配置版本
    pub version: String,
}

/// 信任的设备
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrustedDevice {
    /// 设备 ID
    pub device_id: String,
    /// 设备名称
    pub device_name: String,
    /// 添加时间
    pub added_at: String,
}

impl Default for LanTransferConfig {
    fn default() -> Self {
        let base_dir = get_base_directory();

        // Android：使用公共 Download 目录保存接收的文件
        // 其他平台：使用应用数据目录
        #[cfg(target_os = "android")]
        let save_dir = get_android_public_save_dir().join("Received");

        #[cfg(not(target_os = "android"))]
        let save_dir = base_dir.join("Received");

        Self {
            save_directory: save_dir,
            temp_directory: base_dir.join(".temp"),
            group_by_date: true,
            auto_accept_trusted: false,
            trusted_devices: vec![],
            max_concurrent_transfers: 3,
            version: "1.0".to_string(),
        }
    }
}

// ============================================================================
// 全局配置管理
// ============================================================================

/// 全局配置单例
static CONFIG_MANAGER: OnceCell<Arc<RwLock<ConfigManager>>> = OnceCell::new();

/// 配置管理器
pub struct ConfigManager {
    config: LanTransferConfig,
    config_path: PathBuf,
}

impl ConfigManager {
    /// 创建新的配置管理器
    fn new() -> Self {
        let config_path = get_config_file_path();
        let config = Self::load_or_default(&config_path);

        Self { config, config_path }
    }

    /// 加载配置或使用默认值
    fn load_or_default(path: &PathBuf) -> LanTransferConfig {
        if path.exists() {
            match fs::read_to_string(path) {
                Ok(content) => match serde_json::from_str(&content) {
                    Ok(config) => {
                        println!("[LanTransfer] 配置已加载: {:?}", path);
                        return config;
                    }
                    Err(e) => {
                        eprintln!("[LanTransfer] 配置解析失败，使用默认配置: {}", e);
                    }
                },
                Err(e) => {
                    eprintln!("[LanTransfer] 配置读取失败，使用默认配置: {}", e);
                }
            }
        }

        let config = LanTransferConfig::default();
        println!("[LanTransfer] 使用默认配置");
        config
    }

    /// 保存配置
    pub fn save(&self) -> Result<(), ConfigError> {
        // 确保父目录存在
        if let Some(parent) = self.config_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| ConfigError::DirectoryCreationFailed(e.to_string()))?;
        }

        let content = serde_json::to_string_pretty(&self.config)
            .map_err(|e| ConfigError::WriteFailed(e.to_string()))?;

        fs::write(&self.config_path, content)
            .map_err(|e| ConfigError::WriteFailed(e.to_string()))?;

        println!("[LanTransfer] 配置已保存: {:?}", self.config_path);
        Ok(())
    }

    /// 获取配置
    pub fn get_config(&self) -> &LanTransferConfig {
        &self.config
    }

    /// 获取可变配置
    pub fn get_config_mut(&mut self) -> &mut LanTransferConfig {
        &mut self.config
    }

    /// 设置保存目录
    pub fn set_save_directory(&mut self, path: PathBuf) -> Result<(), ConfigError> {
        // 验证路径
        if path.to_string_lossy().is_empty() {
            return Err(ConfigError::InvalidPath("路径不能为空".to_string()));
        }

        // 尝试创建目录
        fs::create_dir_all(&path)
            .map_err(|e| ConfigError::DirectoryCreationFailed(e.to_string()))?;

        self.config.save_directory = path;
        self.save()
    }

    /// 添加信任设备
    pub fn add_trusted_device(
        &mut self,
        device_id: String,
        device_name: String,
    ) -> Result<(), ConfigError> {
        // 检查是否已存在
        if self
            .config
            .trusted_devices
            .iter()
            .any(|d| d.device_id == device_id)
        {
            return Ok(());
        }

        self.config.trusted_devices.push(TrustedDevice {
            device_id,
            device_name,
            added_at: Utc::now().to_rfc3339(),
        });

        self.save()
    }

    /// 移除信任设备
    pub fn remove_trusted_device(&mut self, device_id: &str) -> Result<(), ConfigError> {
        self.config
            .trusted_devices
            .retain(|d| d.device_id != device_id);
        self.save()
    }

    /// 检查设备是否受信任
    pub fn is_device_trusted(&self, device_id: &str) -> bool {
        self.config
            .trusted_devices
            .iter()
            .any(|d| d.device_id == device_id)
    }

    /// 获取保存目录（根据日期分组设置）
    pub fn get_save_path(&self, file_name: &str) -> PathBuf {
        let base_dir = &self.config.save_directory;

        if self.config.group_by_date {
            let date = Utc::now().format("%Y-%m-%d").to_string();
            base_dir.join(date).join(file_name)
        } else {
            base_dir.join(file_name)
        }
    }

    /// 获取临时文件路径
    pub fn get_temp_file_path(&self, file_id: &str) -> PathBuf {
        self.config.temp_directory.join(format!("{}.part", file_id))
    }

    /// 获取断点续传信息文件路径
    pub fn get_resume_info_path(&self, file_id: &str) -> PathBuf {
        self.config
            .temp_directory
            .join(format!("{}.resume", file_id))
    }

    /// 确保所有必要目录存在
    pub fn ensure_directories(&self) -> Result<(), ConfigError> {
        fs::create_dir_all(&self.config.save_directory)
            .map_err(|e| ConfigError::DirectoryCreationFailed(e.to_string()))?;

        fs::create_dir_all(&self.config.temp_directory)
            .map_err(|e| ConfigError::DirectoryCreationFailed(e.to_string()))?;

        Ok(())
    }
}

// ============================================================================
// 公共函数
// ============================================================================

/// 获取基础目录
fn get_base_directory() -> PathBuf {
    // Android：使用 Tauri 提供的应用数据目录
    #[cfg(target_os = "android")]
    {
        ANDROID_DATA_DIR
            .get()
            .cloned()
            .unwrap_or_else(|| {
                eprintln!("[LanTransfer] 警告: Android 数据目录未初始化，使用临时目录");
                PathBuf::from("/data/local/tmp/HuanvaeChat/LanTransfer")
            })
    }

    // 其他平台：使用 dirs crate
    #[cfg(not(target_os = "android"))]
    {
        dirs::data_local_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("HuanvaeChat")
            .join("LanTransfer")
    }
}

/// 获取配置文件路径
fn get_config_file_path() -> PathBuf {
    get_base_directory().join("config.json")
}

/// 获取全局配置管理器
pub fn get_config_manager() -> Arc<RwLock<ConfigManager>> {
    CONFIG_MANAGER
        .get_or_init(|| Arc::new(RwLock::new(ConfigManager::new())))
        .clone()
}

/// 获取当前保存目录
pub fn get_save_directory() -> PathBuf {
    let manager = get_config_manager();
    let config = manager.read();
    config.get_config().save_directory.clone()
}

/// 设置保存目录
pub fn set_save_directory(path: PathBuf) -> Result<(), ConfigError> {
    let manager = get_config_manager();
    let mut config = manager.write();
    config.set_save_directory(path)
}

/// 获取文件保存路径（考虑日期分组）
pub fn get_file_save_path(file_name: &str) -> PathBuf {
    let manager = get_config_manager();
    let config = manager.read();
    config.get_save_path(file_name)
}

/// 获取临时文件路径
pub fn get_temp_file_path(file_id: &str) -> PathBuf {
    let manager = get_config_manager();
    let config = manager.read();
    config.get_temp_file_path(file_id)
}

/// 获取断点续传信息文件路径
pub fn get_resume_info_path(file_id: &str) -> PathBuf {
    let manager = get_config_manager();
    let config = manager.read();
    config.get_resume_info_path(file_id)
}

/// 确保所有目录存在
pub fn ensure_directories() -> Result<(), ConfigError> {
    let manager = get_config_manager();
    let config = manager.read();
    config.ensure_directories()
}

/// 检查设备是否受信任
pub fn is_device_trusted(device_id: &str) -> bool {
    let manager = get_config_manager();
    let config = manager.read();
    config.is_device_trusted(device_id)
}

/// 添加信任设备
pub fn add_trusted_device(device_id: String, device_name: String) -> Result<(), ConfigError> {
    let manager = get_config_manager();
    let mut config = manager.write();
    config.add_trusted_device(device_id, device_name)
}

/// 移除信任设备
pub fn remove_trusted_device(device_id: &str) -> Result<(), ConfigError> {
    let manager = get_config_manager();
    let mut config = manager.write();
    config.remove_trusted_device(device_id)
}

/// 获取信任设备列表
pub fn get_trusted_devices() -> Vec<TrustedDevice> {
    let manager = get_config_manager();
    let config = manager.read();
    config.get_config().trusted_devices.clone()
}

/// 获取完整配置（用于前端）
pub fn get_full_config() -> LanTransferConfig {
    let manager = get_config_manager();
    let config = manager.read();
    config.get_config().clone()
}

/// 设置自动接受信任设备
pub fn set_auto_accept_trusted(enabled: bool) -> Result<(), ConfigError> {
    let manager = get_config_manager();
    let mut config = manager.write();
    config.get_config_mut().auto_accept_trusted = enabled;
    config.save()
}

/// 设置按日期分组
pub fn set_group_by_date(enabled: bool) -> Result<(), ConfigError> {
    let manager = get_config_manager();
    let mut config = manager.write();
    config.get_config_mut().group_by_date = enabled;
    config.save()
}
