//! 用户数据目录管理模块
//!
//! 按用户和服务器分隔本地数据存储：
//!
//! ```text
//! data/
//!   └── {用户ID}_{服务器地址}/
//!       ├── chat/           # 聊天数据（SQLite数据库）
//!       │   └── chat_data.db
//!       └── file/           # 下载的文件
//!           ├── videos/     # 视频文件
//!           ├── pictures/   # 图片文件
//!           └── documents/  # 文档文件
//! ```
//!
//! ## 平台差异
//! - 桌面端：使用可执行文件目录或用户 home 目录
//! - Android：使用 Tauri app.path().app_data_dir() API 获取可写目录
//!
//! ## 更新日志
//! - 2026-01-21: Android 路径修复，使用 Tauri API 替代 current_exe()

use once_cell::sync::Lazy;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
#[cfg(target_os = "android")]
use std::sync::OnceLock;

// ============================================================================
// Android 专属：全局应用数据根目录
// ============================================================================

/// Android 平台的应用数据根目录（由 Tauri API 初始化）
#[cfg(target_os = "android")]
static ANDROID_APP_ROOT: OnceLock<PathBuf> = OnceLock::new();

/// 初始化 Android 应用数据根目录
///
/// 必须在应用启动时（setup 阶段）调用一次
/// 使用 Tauri 的 app.path().app_data_dir() 获取正确的可写目录
#[cfg(target_os = "android")]
pub fn init_android_app_root(path: PathBuf) -> Result<(), String> {
    let app_root = path.join("data");

    // 确保目录存在
    if !app_root.exists() {
        fs::create_dir_all(&app_root).map_err(|e| {
            format!("Android 创建数据根目录失败 {:?}: {}", app_root, e)
        })?;
    }

    // 设置全局变量（只能设置一次）
    let _ = ANDROID_APP_ROOT.set(app_root.clone());

    println!("[UserData] Android 数据根目录初始化: {:?}", app_root);
    Ok(())
}

// ============================================================================
// 当前用户上下文
// ============================================================================

/// 用户上下文信息
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct UserContext {
    /// 用户 ID
    pub user_id: String,
    /// 服务器地址
    pub server_url: String,
}

/// 全局当前用户上下文（线程安全）
static CURRENT_USER: Lazy<RwLock<Option<UserContext>>> = Lazy::new(|| RwLock::new(None));

// ============================================================================
// 目录路径管理
// ============================================================================

/// 获取应用数据根目录
///
/// ## 平台差异
/// - Android：使用 init_android_app_root() 初始化的全局变量
/// - 桌面端开发模式：相对于 src-tauri 的 ../data（项目根目录）
/// - 桌面端生产模式：
///   - Linux 系统安装: ~/huanvae-chat-app/data/（用户 home 目录，可见且可写）
///   - Windows/macOS: 可执行文件旁边的 data 目录
pub fn get_app_root() -> PathBuf {
    // Android: 使用预初始化的全局变量
    #[cfg(target_os = "android")]
    {
        if let Some(path) = ANDROID_APP_ROOT.get() {
            return path.clone();
        }
        // 备用：如果未初始化，尝试使用默认路径（不应该发生）
        eprintln!("[UserData] 警告: Android 数据根目录未初始化");
        PathBuf::from("/data/local/tmp/huanvae-chat/data")
    }

    // 桌面端: 使用可执行文件路径
    #[cfg(not(target_os = "android"))]
    {
        // 获取可执行文件所在目录
        let Ok(exe_path) = std::env::current_exe() else {
            return PathBuf::from("data");
        };

        let Some(exe_dir) = exe_path.parent() else {
            return PathBuf::from("data");
        };

        // 检查是否在 target/debug 或 target/release 目录（开发模式）
        let exe_dir_str = exe_dir.to_string_lossy();
        let is_dev_mode = exe_dir_str.contains("target\\debug")
            || exe_dir_str.contains("target/debug")
            || exe_dir_str.contains("target\\release")
            || exe_dir_str.contains("target/release");

        if is_dev_mode {
            // 开发模式：往上跳到项目根目录
            // src-tauri/target/debug -> src-tauri -> 项目根目录
            if let Some(project_root) = exe_dir
                .parent()
                .and_then(|p| p.parent())
                .and_then(|p| p.parent())
            {
                return project_root.join("data");
            }
        }

        // Linux 生产模式：检查是否安装在系统目录（/opt, /usr, /snap 等）
        // 如果是，则使用用户 home 目录存储数据
        #[cfg(target_os = "linux")]
        {
            let exe_dir_lower = exe_dir_str.to_lowercase();
            let is_system_install = exe_dir_lower.starts_with("/opt")
                || exe_dir_lower.starts_with("/usr")
                || exe_dir_lower.starts_with("/snap");

            if is_system_install {
                // 使用用户 home 目录：~/huanvae-chat-app/data/
                if let Some(home_dir) = dirs::home_dir() {
                    return home_dir.join("huanvae-chat-app").join("data");
                }
            }
        }

        // Windows/macOS 生产模式：可执行文件旁边的 data 目录
        exe_dir.join("data")
    }
}

/// 清理服务器地址，生成安全的目录名
fn sanitize_server_url(server_url: &str) -> String {
    server_url
        .replace("https://", "")
        .replace("http://", "")
        .replace(['/', ':', '.', '?', '&', '='], "_")
        .trim_matches('_')
        .to_string()
}

/// 生成用户数据目录名
/// 格式: {user_id}_{server}
fn make_user_dir_name(user_id: &str, server_url: &str) -> String {
    let server_clean = sanitize_server_url(server_url);
    format!("{}_{}", user_id, server_clean)
}

/// 获取用户数据根目录
pub fn get_user_data_dir(user_id: &str, server_url: &str) -> PathBuf {
    let app_root = get_app_root();
    let user_dir_name = make_user_dir_name(user_id, server_url);
    app_root.join(user_dir_name)
}

/// 获取 Notification-Sounds 目录
/// 开发模式：项目根目录/Notification-Sounds/
/// 生产模式（Windows/Linux）：可执行文件目录/Notification-Sounds/
/// 生产模式（macOS）：App Bundle/Contents/Resources/Notification-Sounds/
pub fn get_notification_sounds_dir() -> PathBuf {
    let Ok(exe_path) = std::env::current_exe() else {
        return PathBuf::from("Notification-Sounds");
    };

    let Some(exe_dir) = exe_path.parent() else {
        return PathBuf::from("Notification-Sounds");
    };

    let exe_dir_str = exe_dir.to_string_lossy();

    // 开发模式检测
    let is_dev_mode = exe_dir_str.contains("target\\debug")
        || exe_dir_str.contains("target/debug")
        || exe_dir_str.contains("target\\release")
        || exe_dir_str.contains("target/release");

    if is_dev_mode {
        // 开发模式：项目根目录/Notification-Sounds/
        if let Some(project_root) = exe_dir
            .parent()
            .and_then(|p| p.parent())
            .and_then(|p| p.parent())
        {
            return project_root.join("Notification-Sounds");
        }
    }

    // macOS 生产模式：检查 Bundle Resources 目录
    #[cfg(target_os = "macos")]
    {
        // exe 在 App.app/Contents/MacOS/ 下
        // 资源在 App.app/Contents/Resources/ 下
        if let Some(contents_dir) = exe_dir.parent() {
            let resources_dir = contents_dir.join("Resources").join("Notification-Sounds");
            if resources_dir.exists() {
                return resources_dir;
            }
        }
    }

    // Windows/Linux 生产模式：可执行文件旁边
    exe_dir.join("Notification-Sounds")
}

/// 获取用户聊天数据目录
pub fn get_user_chat_dir(user_id: &str, server_url: &str) -> PathBuf {
    get_user_data_dir(user_id, server_url).join("chat")
}

/// 获取用户文件下载目录
pub fn get_user_file_dir(user_id: &str, server_url: &str) -> PathBuf {
    get_user_data_dir(user_id, server_url).join("file")
}

/// 获取视频下载目录
pub fn get_user_videos_dir(user_id: &str, server_url: &str) -> PathBuf {
    get_user_file_dir(user_id, server_url).join("videos")
}

/// 获取图片下载目录
pub fn get_user_pictures_dir(user_id: &str, server_url: &str) -> PathBuf {
    get_user_file_dir(user_id, server_url).join("pictures")
}

/// 获取文档下载目录
pub fn get_user_documents_dir(user_id: &str, server_url: &str) -> PathBuf {
    get_user_file_dir(user_id, server_url).join("documents")
}

/// 获取用户数据库文件路径
pub fn get_user_db_path(user_id: &str, server_url: &str) -> PathBuf {
    get_user_chat_dir(user_id, server_url).join("chat_data.db")
}

// ============================================================================
// 用户上下文管理
// ============================================================================

/// 设置当前用户上下文
pub fn set_current_user(user_id: &str, server_url: &str) -> Result<(), String> {
    // 创建用户目录结构
    ensure_user_directories(user_id, server_url)?;

    // 设置当前用户
    let mut current = CURRENT_USER.write();
    *current = Some(UserContext {
        user_id: user_id.to_string(),
        server_url: server_url.to_string(),
    });

    println!(
        "[UserData] 设置当前用户: {} @ {}",
        user_id,
        sanitize_server_url(server_url)
    );

    Ok(())
}

/// 获取当前用户上下文
pub fn get_current_user() -> Option<UserContext> {
    CURRENT_USER.read().clone()
}

/// 清除当前用户上下文（登出时调用）
pub fn clear_current_user() {
    let mut current = CURRENT_USER.write();
    *current = None;
    println!("[UserData] 已清除当前用户");
}

/// 获取当前用户的数据库路径
pub fn get_current_user_db_path() -> Result<PathBuf, String> {
    let current = CURRENT_USER.read();
    match current.as_ref() {
        Some(ctx) => Ok(get_user_db_path(&ctx.user_id, &ctx.server_url)),
        None => Err("未设置当前用户".to_string()),
    }
}

/// 获取当前用户的文件下载目录
pub fn get_current_user_file_dir() -> Result<PathBuf, String> {
    let current = CURRENT_USER.read();
    match current.as_ref() {
        Some(ctx) => Ok(get_user_file_dir(&ctx.user_id, &ctx.server_url)),
        None => Err("未设置当前用户".to_string()),
    }
}

// ============================================================================
// 目录创建
// ============================================================================

/// 确保用户目录结构存在
pub fn ensure_user_directories(user_id: &str, server_url: &str) -> Result<(), String> {
    let dirs_to_create = [
        get_user_chat_dir(user_id, server_url),
        get_user_videos_dir(user_id, server_url),
        get_user_pictures_dir(user_id, server_url),
        get_user_documents_dir(user_id, server_url),
    ];

    for dir in &dirs_to_create {
        fs::create_dir_all(dir).map_err(|e| format!("创建目录失败 {:?}: {}", dir, e))?;
    }

    println!(
        "[UserData] 用户目录已创建: {:?}",
        get_user_data_dir(user_id, server_url)
    );

    Ok(())
}

/// 根据文件类型获取下载目录
pub fn get_download_dir_for_type(
    user_id: &str,
    server_url: &str,
    file_type: &str,
) -> PathBuf {
    match file_type.to_lowercase().as_str() {
        "video" | "videos" => get_user_videos_dir(user_id, server_url),
        "image" | "images" | "picture" | "pictures" => {
            get_user_pictures_dir(user_id, server_url)
        }
        "document" | "documents" | "file" | "files" => {
            get_user_documents_dir(user_id, server_url)
        }
        _ => get_user_documents_dir(user_id, server_url), // 默认放文档目录
    }
}

/// 根据 MIME 类型获取下载目录
#[allow(dead_code)]
pub fn get_download_dir_for_mime(
    user_id: &str,
    server_url: &str,
    mime_type: &str,
) -> PathBuf {
    if mime_type.starts_with("video/") {
        get_user_videos_dir(user_id, server_url)
    } else if mime_type.starts_with("image/") {
        get_user_pictures_dir(user_id, server_url)
    } else {
        get_user_documents_dir(user_id, server_url)
    }
}

// ============================================================================
// 文件路径辅助
// ============================================================================

/// 生成下载文件的完整路径
#[allow(dead_code)]
pub fn make_download_path(
    user_id: &str,
    server_url: &str,
    file_type: &str,
    filename: &str,
) -> PathBuf {
    let dir = get_download_dir_for_type(user_id, server_url, file_type);
    dir.join(filename)
}

/// 列出用户的所有下载文件
pub fn list_user_files(user_id: &str, server_url: &str) -> Result<Vec<PathBuf>, String> {
    let file_dir = get_user_file_dir(user_id, server_url);

    if !file_dir.exists() {
        return Ok(Vec::new());
    }

    let mut files = Vec::new();

    for subdir in ["videos", "pictures", "documents"] {
        let subdir_path = file_dir.join(subdir);
        if subdir_path.exists() && let Ok(entries) = fs::read_dir(&subdir_path) {
            for entry in entries.flatten() {
                if entry.path().is_file() {
                    files.push(entry.path());
                }
            }
        }
    }

    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_server_url() {
        assert_eq!(
            sanitize_server_url("https://api.huanvae.cn:8080/"),
            "api_huanvae_cn_8080"
        );
        assert_eq!(
            sanitize_server_url("http://localhost:3000"),
            "localhost_3000"
        );
    }

    #[test]
    fn test_make_user_dir_name() {
        let name = make_user_dir_name("user123", "https://api.huanvae.cn");
        assert_eq!(name, "user123_api_huanvae_cn");
    }
}

