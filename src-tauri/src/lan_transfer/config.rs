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
    if !public_download.exists() && let Err(e) = fs::create_dir_all(&public_download) {
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
    // TODO: Wire into handle_peer_connection_request for auto-accept when auto_accept_trusted is enabled
    pub fn is_device_trusted(&self, device_id: &str) -> bool {
        self.config
            .trusted_devices
            .iter()
            .any(|d| d.device_id == device_id)
    }

    /// 获取保存目录（根据日期分组设置）
    ///
    /// 🔴 `file_name` 来自**未认证的局域网对端**（`FileMetadata.file_name`，走
    /// `/api/prepare-upload` 的 JSON 体），所以这里**必须**先过
    /// [`sanitize_incoming_file_name`] 再 `join`，不合法一律返回 `None`：
    /// Rust 的 `Path::join` 语义是「参数是绝对路径就整个丢弃 base」，
    /// 于是 `file_name = "/Users/victim/Library/LaunchAgents/evil.plist"` 会精确落在
    /// 攻击者指定的位置；`"../../../.zshrc"` 同样逃逸出接收目录。
    ///
    /// 这道闸是**纵深防御**的最后一层：调用侧（`handle_prepare_upload` /
    /// `handle_batch_prepare`）已经在收到请求那一刻就拒了，这里再拒一次是为了让
    /// **将来任何新的调用点**都不可能绕过它 —— 返回 `Option` 而不是静默回退到某个
    /// 安全名字，正是为了逼调用方显式处理。
    pub fn get_save_path(&self, file_name: &str) -> Option<PathBuf> {
        let safe = sanitize_incoming_file_name(file_name)?;
        let base_dir = &self.config.save_directory;

        if self.config.group_by_date {
            let date = Utc::now().format("%Y-%m-%d").to_string();
            Some(base_dir.join(date).join(safe))
        } else {
            Some(base_dir.join(safe))
        }
    }

    /// 获取临时文件路径
    ///
    /// 🔴 与 [`Self::get_save_path`] 同一条理由：`file_id` 也来自局域网对端
    ///（`FileMetadata.file_id` / `?fileId=` 查询参数），`format!` 之后照样进 `join`，
    /// 所以绝对路径同样会**整个丢弃 base**、`..` 同样逃逸出临时目录。
    /// 而且这一路比文件名那一路更重：续传清理会 `fs::remove_file` 这两个路径
    ///（见 `resume::ResumeManager::clear_resume_info`），**既能写也能删**。
    /// 判据见 [`sanitize_incoming_file_id`]，不合法返回 `None` 逼调用方显式处理。
    pub fn get_temp_file_path(&self, file_id: &str) -> Option<PathBuf> {
        let safe = sanitize_incoming_file_id(file_id)?;
        Some(self.config.temp_directory.join(format!("{}.part", safe)))
    }

    /// 获取断点续传信息文件路径
    ///
    /// 与 [`Self::get_temp_file_path`] 同一道闸，理由见那里。
    pub fn get_resume_info_path(&self, file_id: &str) -> Option<PathBuf> {
        let safe = sanitize_incoming_file_id(file_id)?;
        Some(
            self.config
                .temp_directory
                .join(format!("{}.resume", safe)),
        )
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
///
/// `file_name` 非法（路径分隔符 / `..` / 控制字符 / Windows 保留设备名 …）时返回 `None`，
/// 判据见 [`sanitize_incoming_file_name`]。
pub fn get_file_save_path(file_name: &str) -> Option<PathBuf> {
    let manager = get_config_manager();
    let config = manager.read();
    config.get_save_path(file_name)
}

// ============================================================================
// 对端文件名校验
// ============================================================================

/// 接收侧文件名允许的最大长度（字节）。
///
/// 常见文件系统单个路径分量上限是 255 字节（ext4 / APFS / NTFS 同量级），
/// 超过它的名字本来就写不下去，早拒比写到一半再失败干净。
const MAX_INCOMING_FILE_NAME_BYTES: usize = 255;

/// Windows 保留设备名（不区分大小写；带任意扩展名同样被系统当设备处理）。
const WINDOWS_RESERVED_STEMS: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// 校验局域网对端给的文件名，安全则原样返回，不安全返回 `None`。
///
/// 🔴 **拒绝而不是改写**：改写会把两个不同的输入折叠成同一个文件名
///（与 `video_poster::poster_file_name` 同一条理由），而且改写过的名字给用户看时
/// 与他在发送端看到的对不上。合法文件名走到这里本来就一个字节都不该动。
///
/// 判据（任一命中即拒绝）：
/// 1. 空 / 超过 [`MAX_INCOMING_FILE_NAME_BYTES`] 字节；
/// 2. 含 `/` 或 `\` —— **两种分隔符都拒**，不按本机平台分流：接收端是 Linux/macOS 时
///    `"a\..\b"` 在本机是**合法单个文件名**，可它一旦被同步/解包到 Windows 就还原成穿越；
/// 3. 含 NUL 或任何控制字符（`< 0x20`、`0x7F`）；
/// 4. 含 `:` —— Windows 上是盘符 / NTFS 备用数据流（`x.txt:evil.exe`）分隔符；
/// 5. 名字是 `.` 或 `..`；
/// 6. 以 `.` 或空格结尾 —— Windows 会静默剥掉，`"x.txt."` 与 `"x.txt"` 落到同一个文件；
/// 7. 主干（第一个 `.` 之前）是 Windows 保留设备名。
///
/// 非 ASCII（中文 / emoji 文件名）**不拒**：它们是完全正常的文件名，
/// 白名单式过滤会把它们误伤成不可用。
pub fn sanitize_incoming_file_name(file_name: &str) -> Option<&str> {
    if file_name.is_empty() || file_name.len() > MAX_INCOMING_FILE_NAME_BYTES {
        return None;
    }
    if file_name.contains('/') || file_name.contains('\\') {
        return None;
    }
    if file_name.contains(':') {
        return None;
    }
    if file_name.chars().any(|c| c.is_control()) {
        return None;
    }
    if file_name == "." || file_name == ".." {
        return None;
    }
    if file_name.ends_with('.') || file_name.ends_with(' ') {
        return None;
    }
    let stem = file_name.split('.').next().unwrap_or("");
    if WINDOWS_RESERVED_STEMS
        .iter()
        .any(|r| stem.eq_ignore_ascii_case(r))
    {
        return None;
    }
    Some(file_name)
}

/// 接收侧 `file_id` 允许的最大长度（字节）。
///
/// 本仓发送端给的是 UUID v4 字符串（36 字节，见 `transfer.rs` 的 `Uuid::new_v4()`），
/// 128 字节留了足够余量给任何别的不透明 ID 形态，同时把「超长名把文件系统撑爆」挡在门外。
const MAX_INCOMING_FILE_ID_BYTES: usize = 128;

/// 校验局域网对端给的 `file_id`，安全则原样返回，不安全返回 `None`。
///
/// 🔴 **为什么不复用 [`sanitize_incoming_file_name`]**：那一条是给**用户可见的文件名**写的，
/// 必须放行空格、中文、emoji、多点扩展名 —— 因为那些是完全正常的文件名。
/// `file_id` 不是文件名，它是**机器生成的不透明标识**（本仓发送端就是 UUID v4），
/// 从不展示给用户、也不需要保真。对这种值该用**字符白名单**而不是「文件名净化」：
/// 白名单是**列举允许**，新出现的攻击形态默认被拒；净化是**列举禁止**，
/// 漏掉一类就是一个洞。两者的失效方向相反，这是选它的全部理由。
///
/// ⚠️ **但字符白名单挡不住"每个字符都合法、名字本身有毒"这一类** ——
/// Windows 保留设备名（`CON` / `NUL` / `COM1`…）全是 ASCII 字母数字，
/// 上面那套字符判据一条都拦不住。**【推断，本仓无 Windows 机器可验】**
/// `file_id = "CON"` ⇒ 临时路径 `…\CON.part`；Win32 把**带任意扩展名**的保留名
/// 当设备处理 ⇒ 写入落到控制台 / `NUL` 直接丢弃，随后 `fs::remove_file` 失败。
/// 落点仍在临时目录内、**不是路径逃逸**，严重度低 —— 加这一条的理由是**口径一致**：
/// 同一个文件的 [`sanitize_incoming_file_name`] 判据 7 已经拒了它，
/// `resume::ResumeError::UnsafeFileName` 的文档也把「Windows 保留设备名」列为拒绝理由，
/// 两条闸不该对同一类风险给出相反判定。
///
/// 判据（全部满足才放行）：
/// 1. 非空且 ≤ [`MAX_INCOMING_FILE_ID_BYTES`] 字节；
/// 2. 每个字符都属于 `A-Z a-z 0-9 . _ -` —— 于是 `/`、`\\`、`:`、NUL、控制字符、
///    空格、非 ASCII **一律进不来**，绝对路径与盘符形态在这一条就被拒；
/// 3. 不含 `..` —— 上一条已经挡掉分隔符，这一条把 `..` 这个名字本身也挡掉，
///    免得将来有人放宽字符集时留下现成的穿越素材；
/// 4. 不以 `.` 开头 —— 避免在临时目录里造出隐藏文件；
/// 5. 主干（第一个 `.` 之前）不是 [`WINDOWS_RESERVED_STEMS`] 里的保留设备名 ——
///    与 [`sanitize_incoming_file_name`] 判据 7 共用同一份表、同一条口径。
///
/// 放行集合是 UUID 的**超集**：连字符与十六进制字符都在白名单里，
/// 所以本仓现有的 UUID v4 `file_id` 一个都不受影响（单测 `sanitize_file_id_accepts_uuid_v4` 钉住）。
/// 判据 5 同样误伤不到它：`file_id` 的唯一生成点是 `transfer.rs` 的 `Uuid::new_v4().to_string()`，
/// 产出 36 字符且不含 `.`，主干就是整串，而保留名全是 3–4 字符 —— 长度上就不可能相等
/// （单测 `sanitize_file_id_rejects_windows_reserved_stems` 里带正对照钉住）。
pub fn sanitize_incoming_file_id(file_id: &str) -> Option<&str> {
    if file_id.is_empty() || file_id.len() > MAX_INCOMING_FILE_ID_BYTES {
        return None;
    }
    if !file_id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
    {
        return None;
    }
    if file_id.contains("..") {
        return None;
    }
    if file_id.starts_with('.') {
        return None;
    }
    let stem = file_id.split('.').next().unwrap_or("");
    if WINDOWS_RESERVED_STEMS
        .iter()
        .any(|r| stem.eq_ignore_ascii_case(r))
    {
        return None;
    }
    Some(file_id)
}

/// 获取临时文件路径
///
/// `file_id` 非法（含路径分隔符 / `..` / 非白名单字符 …）时返回 `None`，
/// 判据见 [`sanitize_incoming_file_id`]。
pub fn get_temp_file_path(file_id: &str) -> Option<PathBuf> {
    let manager = get_config_manager();
    let config = manager.read();
    config.get_temp_file_path(file_id)
}

/// 获取断点续传信息文件路径
///
/// `file_id` 非法时返回 `None`，判据见 [`sanitize_incoming_file_id`]。
pub fn get_resume_info_path(file_id: &str) -> Option<PathBuf> {
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

#[cfg(test)]
mod tests {
    use super::*;

    /// 正对照：普通名字（含中文 / 空格 / 多点扩展名）必须原样通过。
    ///
    /// 🔴 这条不是凑数：它证明拒绝判据**会放行**，
    /// 否则「全都拒绝」也能让下面那批穿越用例全绿（恒真判据）。
    #[test]
    fn sanitize_accepts_ordinary_names() {
        for ok in [
            "report.pdf",
            "我的照片 2026.jpg",
            "archive.tar.gz",
            "no-extension",
            "..hidden-but-not-dotdot.txt",
            "a.b.CONtrived.txt",
        ] {
            assert_eq!(sanitize_incoming_file_name(ok), Some(ok), "应放行: {ok}");
        }
    }

    /// 绝对路径：`Path::join` 会**整个丢弃 base**，必须在进 join 之前拒掉。
    #[test]
    fn sanitize_rejects_absolute_paths() {
        for bad in [
            "/Users/victim/Library/LaunchAgents/evil.plist",
            "/etc/passwd",
            "C:\\Users\\victim\\Startup\\x.bat",
            "\\\\server\\share\\x.dll",
        ] {
            assert_eq!(sanitize_incoming_file_name(bad), None, "应拒绝: {bad}");
        }
    }

    /// 相对穿越：两种分隔符都要拒（接收端平台不同不改变判定）。
    #[test]
    fn sanitize_rejects_traversal() {
        for bad in [
            "../../../.zshrc",
            "..\\..\\autoexec.bat",
            "sub/dir/file.txt",
            ".",
            "..",
        ] {
            assert_eq!(sanitize_incoming_file_name(bad), None, "应拒绝: {bad}");
        }
    }

    /// NTFS 备用数据流 / 盘符、控制字符、Windows 保留设备名、尾点尾空格。
    #[test]
    fn sanitize_rejects_platform_specific_traps() {
        for bad in [
            "notes.txt:evil.exe",
            "D:file.txt",
            "bad\u{0}name.txt",
            "line\nbreak.txt",
            "CON",
            "con.txt",
            "LPT9.log",
            "trailing.",
            "trailing ",
            "",
        ] {
            assert_eq!(sanitize_incoming_file_name(bad), None, "应拒绝: {bad:?}");
        }
    }

    #[test]
    fn sanitize_rejects_over_length_names() {
        let long = "a".repeat(MAX_INCOMING_FILE_NAME_BYTES + 1);
        assert_eq!(sanitize_incoming_file_name(&long), None);
        let ok = "a".repeat(MAX_INCOMING_FILE_NAME_BYTES);
        assert_eq!(sanitize_incoming_file_name(&ok), Some(ok.as_str()));
    }

    /// 纵深防御那一层：`get_save_path` 自己也必须拒，
    /// 而不是靠调用方记得先校验。
    #[test]
    fn get_save_path_refuses_unsafe_names_and_keeps_base() {
        let mut manager = ConfigManager {
            config: LanTransferConfig {
                save_directory: PathBuf::from("/tmp/lan-inbox"),
                group_by_date: false,
                ..Default::default()
            },
            config_path: PathBuf::from("/tmp/lan-inbox/config.json"),
        };

        assert_eq!(
            manager.get_save_path("ok.txt"),
            Some(PathBuf::from("/tmp/lan-inbox/ok.txt")),
        );
        assert_eq!(manager.get_save_path("/etc/passwd"), None);
        assert_eq!(manager.get_save_path("../../../.zshrc"), None);

        // 日期分组开启时同样成立（多一层子目录不改变判定）。
        manager.config.group_by_date = true;
        assert_eq!(manager.get_save_path("/etc/passwd"), None);
        let dated = manager.get_save_path("ok.txt").expect("合法名应放行");
        assert!(
            dated.starts_with("/tmp/lan-inbox"),
            "落点必须仍在接收目录内: {dated:?}"
        );
    }

    // ------------------------------------------------------------------
    // file_id 同族入口（临时文件 / 续传信息）
    // ------------------------------------------------------------------

    /// 正对照：本仓发送端真正在用的形态（UUID v4）必须原样放行。
    ///
    /// 🔴 这条不是凑数：白名单式判据最容易写成"全都拒"，
    /// 那样下面那批穿越用例会全绿（恒真判据），却把正常传输一起打死。
    #[test]
    fn sanitize_file_id_accepts_uuid_v4() {
        for ok in [
            "550e8400-e29b-41d4-a716-446655440000",
            "0f8fad5b-d9cb-469f-a165-70867728950e",
            "simple_id-123",
            "a",
            "chunk.0001",
        ] {
            assert_eq!(sanitize_incoming_file_id(ok), Some(ok), "应放行: {ok}");
        }
    }

    /// 绝对路径 / 相对穿越 / 分隔符 / 盘符：`Path::join` 会整个丢弃 base，必须在进 join 之前拒。
    #[test]
    fn sanitize_file_id_rejects_path_shapes() {
        for bad in [
            "/Users/victim/Library/LaunchAgents/evil",
            "/etc/passwd",
            "../../../.zshrc",
            "..\\..\\autoexec",
            "sub/dir/id",
            "C:\\Windows\\System32\\drivers\\etc\\hosts",
            "id:stream",
            "..",
            ".",
            ".hidden",
        ] {
            assert_eq!(sanitize_incoming_file_id(bad), None, "应拒绝: {bad:?}");
        }
    }

    /// 白名单之外的字符（空格 / 中文 / 控制字符 / NUL）一律拒 —— `file_id` 是不透明标识，
    /// 不需要放行这些，放行等于给将来的绕法留素材。
    #[test]
    fn sanitize_file_id_rejects_non_whitelisted_chars() {
        for bad in [
            "id with space",
            "中文id",
            "id\u{0}nul",
            "id\nbreak",
            "id%2fescaped",
            "",
        ] {
            assert_eq!(sanitize_incoming_file_id(bad), None, "应拒绝: {bad:?}");
        }
    }

    /// 保留设备名：字符全合法、名字本身在 Windows 上是设备 ——
    /// 白名单式判据结构上拦不住这一类，所以单列一条，与 `sanitize_incoming_file_name` 同一口径。
    #[test]
    fn sanitize_file_id_rejects_windows_reserved_stems() {
        for bad in [
            "CON",
            "con",
            "Con",
            "NUL",
            "AUX",
            "PRN",
            "COM1",
            "LPT9",
            "CON.part",
            "nul.0001",
            "com1.resume",
        ] {
            assert_eq!(sanitize_incoming_file_id(bad), None, "应拒绝: {bad:?}");
        }

        // 🔴 正对照（这条判据最容易写成"沾边就拒"，那样会误伤正常 `file_id`）：
        // 只是**以保留名开头 / 含保留名**、但主干不等于保留名的，必须仍然放行。
        for ok in ["CONSOLE", "connect-1", "com10", "nulls", "a-CON", "CON-1", "con_1"] {
            assert_eq!(sanitize_incoming_file_id(ok), Some(ok), "应放行: {ok}");
        }
    }

    #[test]
    fn sanitize_file_id_rejects_over_length() {
        let long = "a".repeat(MAX_INCOMING_FILE_ID_BYTES + 1);
        assert_eq!(sanitize_incoming_file_id(&long), None);
        let ok = "a".repeat(MAX_INCOMING_FILE_ID_BYTES);
        assert_eq!(sanitize_incoming_file_id(&ok), Some(ok.as_str()));
    }

    /// 纵深防御那一层：两个路径函数自己必须拒，而不是靠调用方记得先校验。
    ///
    /// 🔴 断言里显式钉住"绝对路径会丢弃 base"这个 Rust 语义：
    /// 不做闸时 `PathBuf::from("/tmp/lan-tmp").join("/etc/cron.d/evil.part")`
    /// 得到的是 `/etc/cron.d/evil.part` —— 落点完全由对端指定。
    #[test]
    fn temp_and_resume_paths_refuse_unsafe_file_ids_and_keep_base() {
        let manager = ConfigManager {
            config: LanTransferConfig {
                temp_directory: PathBuf::from("/tmp/lan-tmp"),
                ..Default::default()
            },
            config_path: PathBuf::from("/tmp/lan-tmp/config.json"),
        };

        let uuid = "550e8400-e29b-41d4-a716-446655440000";
        assert_eq!(
            manager.get_temp_file_path(uuid),
            Some(PathBuf::from("/tmp/lan-tmp/550e8400-e29b-41d4-a716-446655440000.part")),
        );
        assert_eq!(
            manager.get_resume_info_path(uuid),
            Some(PathBuf::from("/tmp/lan-tmp/550e8400-e29b-41d4-a716-446655440000.resume")),
        );

        // 负对照：没有闸时这两个输入会逃逸出临时目录 —— 先把这件事本身钉住，
        // 证明本组用例守的是真失效而不是一个恒真断言。
        //
        // 🔴 这里**故意**把绝对路径喂给 `join`，被演示的就是 clippy::join_absolute_paths
        // 警告的那个语义本身（"joining a path starting with separator will replace the path"）。
        // 按 clippy 的建议改写会把这条负对照变成一句同义反复，所以就地 allow 并写明理由。
        #[allow(clippy::join_absolute_paths)]
        let escaped = PathBuf::from("/tmp/lan-tmp").join("/etc/cron.d/evil.part");
        assert!(
            !escaped.starts_with("/tmp/lan-tmp"),
            "Path::join 对绝对路径应当丢弃 base，实际: {escaped:?}"
        );

        for bad in ["/etc/cron.d/evil", "../../../.zshrc", "..", "id/../../x", "CON"] {
            assert_eq!(manager.get_temp_file_path(bad), None, "应拒绝: {bad:?}");
            assert_eq!(manager.get_resume_info_path(bad), None, "应拒绝: {bad:?}");
        }
    }
}
