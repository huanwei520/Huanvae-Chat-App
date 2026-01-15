//! 文件下载与缓存模块
//!
//! 提供文件下载、缓存和管理功能：
//! - 从远程 URL 下载文件并保存到本地缓存目录
//! - 复制上传的文件到缓存目录（小于阈值的文件）
//! - 大文件优化：≥阈值的文件不复制，记录原始路径
//! - 检查文件缓存状态（支持 local_path 和 original_path 回退）
//! - 在系统文件管理器中显示本地文件
//!
//! ## 大文件处理策略
//!
//! 大文件阈值由用户在设置中配置（默认 100MB），对于 ≥阈值的文件：
//! 1. 上传时不复制到缓存目录，记录 `original_path`
//! 2. 读取时优先使用 `original_path`
//! 3. 若 `original_path` 失效，返回 None 触发前端从服务器下载
//! 4. 下载后保存到缓存目录，更新 `local_path`
//!
//! ## 性能优化
//!
//! 下载采用以下优化策略提升大文件下载速度：
//! - **全局 HTTP Client**: 复用连接池，避免重复 TCP 握手
//! - **异步文件 IO**: 使用 `tokio::fs` 避免阻塞 async 运行时
//! - **缓冲写入**: 8MB 缓冲区减少磁盘 IO 次数（约 128 倍）

use futures_util::StreamExt;
use once_cell::sync::Lazy;
use tauri::{Emitter, Window};
use tokio::io::AsyncWriteExt;

use crate::db;
use crate::user_data;

/// 下载缓冲区大小 (8MB)
///
/// 使用较大的缓冲区可显著减少磁盘 IO 次数：
/// - 211MB 文件：从约 3300 次 IO 减少到约 26 次
/// - 提升下载速度 10-100 倍（取决于磁盘性能）
const DOWNLOAD_BUFFER_SIZE: usize = 8 * 1024 * 1024;

/// 全局 HTTP Client（复用连接池）
///
/// 避免每次下载都创建新的 Client，复用 TCP 连接
static HTTP_CLIENT: Lazy<reqwest::Client> = Lazy::new(|| {
    reqwest::Client::builder()
        .pool_max_idle_per_host(5)
        .build()
        .expect("Failed to create HTTP client")
});

/// 下载进度事件
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    /// 文件哈希（用于标识下载任务）
    pub file_hash: String,
    /// 已下载字节数
    pub downloaded: u64,
    /// 总字节数
    pub total: u64,
    /// 下载百分比
    pub percent: f64,
    /// 状态: "downloading" | "completed" | "failed"
    pub status: String,
}

/// 下载文件并保存到本地
///
/// 使用异步 IO 和 8MB 缓冲区优化下载性能，适合局域网大文件传输。
///
/// ## 性能优化
/// - 全局 HTTP Client 复用连接池
/// - 异步文件 IO 不阻塞 tokio 运行时
/// - 8MB 缓冲写入减少磁盘 IO 次数
///
/// # 参数
/// - `url`: 预签名下载 URL
/// - `file_hash`: 文件哈希（用于映射和去重）
/// - `file_name`: 原始文件名
/// - `file_type`: 文件类型 ("image" | "video" | "document")
/// - `file_size`: 文件大小（可选，用于进度计算）
/// - `window`: Tauri 窗口（用于发送进度事件）
///
/// # 返回
/// - 成功：本地文件路径
/// - 失败：错误信息
#[tauri::command(rename_all = "camelCase")]
pub async fn download_and_save_file(
    url: String,
    file_hash: String,
    file_name: String,
    file_type: String,
    file_size: Option<u64>,
    window: Window,
) -> Result<String, String> {
    // 1. 检查是否已有本地缓存
    if let Ok(Some(mapping)) = db::get_file_mapping(&file_hash) {
        // 验证文件是否存在
        if std::path::Path::new(&mapping.local_path).exists() {
            println!("[Download] 文件已缓存: {}", mapping.local_path);
            return Ok(mapping.local_path);
        }
    }

    // 2. 获取当前用户上下文
    let user_ctx = user_data::get_current_user()
        .ok_or_else(|| "未登录，无法下载文件".to_string())?;

    // 3. 确定保存目录
    let save_dir = match file_type.as_str() {
        "image" | "images" | "picture" | "pictures" => {
            user_data::get_user_pictures_dir(&user_ctx.user_id, &user_ctx.server_url)
        }
        "video" | "videos" => {
            user_data::get_user_videos_dir(&user_ctx.user_id, &user_ctx.server_url)
        }
        _ => user_data::get_user_documents_dir(&user_ctx.user_id, &user_ctx.server_url),
    };

    // 确保目录存在
    std::fs::create_dir_all(&save_dir)
        .map_err(|e| format!("创建下载目录失败: {}", e))?;

    // 4. 生成本地文件名（hash_原始文件名）
    let safe_filename = sanitize_filename(&file_name);
    let local_filename = format!("{}_{}", &file_hash[..8], safe_filename);
    let local_path = save_dir.join(&local_filename);
    let local_path_str = local_path.to_string_lossy().to_string();

    println!("[Download] 开始下载: {} -> {}", file_name, local_path_str);

    // 5. 发送开始事件
    let _ = window.emit(
        "download-progress",
        DownloadProgress {
            file_hash: file_hash.clone(),
            downloaded: 0,
            total: file_size.unwrap_or(0),
            percent: 0.0,
            status: "downloading".to_string(),
        },
    );

    // 6. 使用全局 HTTP Client 发起下载请求（复用连接池）
    let response = HTTP_CLIENT
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("下载失败: HTTP {}", response.status()));
    }

    // 获取文件大小
    let total_size = response.content_length().or(file_size).unwrap_or(0);
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();

    // 7. 异步流式写入文件（使用 8MB 缓冲区优化 IO 性能）
    let file = tokio::fs::File::create(&local_path)
        .await
        .map_err(|e| format!("创建文件失败: {}", e))?;
    let mut writer = tokio::io::BufWriter::with_capacity(DOWNLOAD_BUFFER_SIZE, file);

    let mut downloaded: u64 = 0;
    let mut stream = response.bytes_stream();
    let mut last_emit_percent: f64 = 0.0;

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| format!("下载数据失败: {}", e))?;

        writer
            .write_all(&chunk)
            .await
            .map_err(|e| format!("写入文件失败: {}", e))?;

        downloaded += chunk.len() as u64;

        // 每 1% 发送一次进度事件（避免过于频繁）
        let percent = if total_size > 0 {
            (downloaded as f64 / total_size as f64) * 100.0
        } else {
            0.0
        };

        if percent - last_emit_percent >= 1.0 || downloaded == total_size {
            last_emit_percent = percent;
            let _ = window.emit(
                "download-progress",
                DownloadProgress {
                    file_hash: file_hash.clone(),
                    downloaded,
                    total: total_size,
                    percent,
                    status: "downloading".to_string(),
                },
            );
        }
    }

    // 确保缓冲区数据全部写入磁盘
    writer
        .flush()
        .await
        .map_err(|e| format!("刷新缓冲区失败: {}", e))?;

    // 8. 保存文件映射到数据库
    let now = chrono::Utc::now().to_rfc3339();
    db::save_file_mapping(db::LocalFileMapping {
        file_hash: file_hash.clone(),
        local_path: local_path_str.clone(),
        original_path: None, // 下载的文件不需要原始路径
        is_large_file: false, // 下载的文件都缓存到本地
        file_size: downloaded as i64,
        file_name: file_name.clone(),
        content_type,
        source: "downloaded".to_string(),
        last_verified: now,
        created_at: None,
    })?;

    // 9. 发送完成事件
    let _ = window.emit(
        "download-progress",
        DownloadProgress {
            file_hash: file_hash.clone(),
            downloaded,
            total: total_size,
            percent: 100.0,
            status: "completed".to_string(),
        },
    );

    println!(
        "[Download] 下载完成: {} ({} bytes)",
        local_path_str, downloaded
    );

    Ok(local_path_str)
}

/// 清理文件名中的非法字符
fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => c,
        })
        .collect()
}

/// 检查文件是否已缓存
///
/// 支持两种路径：
/// 1. local_path: 缓存目录中的路径
/// 2. original_path: 大文件的原始路径（回退）
#[tauri::command(rename_all = "camelCase")]
pub fn is_file_cached(file_hash: String) -> Result<bool, String> {
    match db::get_file_mapping(&file_hash) {
        Ok(Some(mapping)) => {
            // 优先检查缓存路径
            if std::path::Path::new(&mapping.local_path).exists() {
                return Ok(true);
            }
            // 回退检查原始路径（大文件）
            if let Some(ref orig_path) = mapping.original_path
                && std::path::Path::new(orig_path).exists()
            {
                return Ok(true);
            }
            // 两个路径都无效，删除映射
            let _ = db::delete_file_mapping(&file_hash);
            Ok(false)
        }
        Ok(None) => Ok(false),
        Err(e) => Err(e),
    }
}

/// 获取已缓存文件的本地路径
///
/// 返回有效的本地路径：
/// 1. 优先返回 local_path（缓存目录）
/// 2. 若 local_path 无效，回退到 original_path（大文件原始路径）
/// 3. 若都无效，返回 None 并清理数据库映射
#[tauri::command(rename_all = "camelCase")]
pub fn get_cached_file_path(file_hash: String) -> Result<Option<String>, String> {
    match db::get_file_mapping(&file_hash) {
        Ok(Some(mapping)) => {
            // 优先返回缓存路径
            if std::path::Path::new(&mapping.local_path).exists() {
                return Ok(Some(mapping.local_path));
            }
            // 回退到原始路径（大文件）
            if let Some(ref orig_path) = mapping.original_path
                && std::path::Path::new(orig_path).exists()
            {
                return Ok(Some(orig_path.clone()));
            }
            // 两个路径都无效，删除映射（文件将从服务器重新下载）
            let _ = db::delete_file_mapping(&file_hash);
            Ok(None)
        }
        Ok(None) => Ok(None),
        Err(e) => Err(e),
    }
}

/// 默认大文件阈值（100MB）
const DEFAULT_LARGE_FILE_THRESHOLD: u64 = 100 * 1024 * 1024;

/// 复制文件到缓存目录（或记录大文件原始路径）
///
/// 用于上传文件后将原始文件复制到统一的缓存目录
/// 这样即使原始文件被移动/删除，缓存仍然可用
///
/// 对于大文件（≥阈值），不进行复制，而是记录原始路径
/// 读取时若原始路径失效，再从服务器下载到缓存目录
///
/// # 参数
/// - `source_path`: 源文件路径
/// - `file_hash`: 文件哈希
/// - `file_name`: 原始文件名
/// - `file_type`: 文件类型 ("image" | "video" | "document")
/// - `file_size`: 文件大小（字节），用于判断是否为大文件
/// - `large_file_threshold`: 大文件阈值（字节），可选，默认 100MB
///
/// # 返回
/// - 成功：本地文件路径（缓存路径或原始路径）
/// - 失败：错误信息
#[tauri::command(rename_all = "camelCase")]
pub fn copy_file_to_cache(
    source_path: String,
    file_hash: String,
    file_name: String,
    file_type: String,
    file_size: Option<u64>,
    large_file_threshold: Option<u64>,
) -> Result<String, String> {
    // 1. 检查源文件是否存在
    let source = std::path::Path::new(&source_path);
    if !source.exists() {
        return Err(format!("源文件不存在: {}", source_path));
    }

    // 2. 获取文件大小并判断是否为大文件
    let actual_size = file_size.unwrap_or_else(|| {
        std::fs::metadata(&source_path)
            .map(|m| m.len())
            .unwrap_or(0)
    });
    let threshold = large_file_threshold.unwrap_or(DEFAULT_LARGE_FILE_THRESHOLD);
    let is_large_file = actual_size >= threshold;

    // 3. 获取当前用户上下文
    let user_ctx = user_data::get_current_user()
        .ok_or_else(|| "未登录，无法缓存文件".to_string())?;

    // 4. 计算预期的缓存目录
    let expected_cache_dir = match file_type.as_str() {
        "image" | "images" | "picture" | "pictures" => {
            user_data::get_user_pictures_dir(&user_ctx.user_id, &user_ctx.server_url)
        }
        "video" | "videos" => {
            user_data::get_user_videos_dir(&user_ctx.user_id, &user_ctx.server_url)
        }
        _ => user_data::get_user_documents_dir(&user_ctx.user_id, &user_ctx.server_url),
    };
    let expected_cache_dir_str = expected_cache_dir.to_string_lossy().to_string();

    // 5. 检查是否已有缓存
    if let Ok(Some(mapping)) = db::get_file_mapping(&file_hash) {
        // 检查缓存路径
        let existing_path = std::path::Path::new(&mapping.local_path);
        if existing_path.exists() && mapping.local_path.contains(&expected_cache_dir_str) {
            println!("[CopyCache] 文件已在缓存目录: {}", mapping.local_path);
            return Ok(mapping.local_path);
        }
        // 检查原始路径（大文件）
        if let Some(ref orig_path) = mapping.original_path
            && std::path::Path::new(orig_path).exists()
        {
            println!("[CopyCache] 大文件原始路径有效: {}", orig_path);
            return Ok(orig_path.clone());
        }
    }

    // 推断 content_type
    let content_type = match file_type.as_str() {
        "image" | "images" | "picture" | "pictures" => {
            if file_name.to_lowercase().ends_with(".png") {
                "image/png"
            } else if file_name.to_lowercase().ends_with(".gif") {
                "image/gif"
            } else if file_name.to_lowercase().ends_with(".webp") {
                "image/webp"
            } else {
                "image/jpeg"
            }
        }
        "video" | "videos" => {
            if file_name.to_lowercase().ends_with(".webm") {
                "video/webm"
            } else {
                "video/mp4"
            }
        }
        _ => "application/octet-stream",
    };

    let now = chrono::Utc::now().to_rfc3339();

    // 6. 大文件处理：不复制，记录原始路径
    if is_large_file {
        println!(
            "[CopyCache] 大文件({}MB)，记录原始路径: {}",
            actual_size / 1024 / 1024,
            source_path
        );

        db::save_file_mapping(db::LocalFileMapping {
            file_hash: file_hash.clone(),
            local_path: source_path.clone(), // 暂时使用原始路径
            original_path: Some(source_path.clone()),
            is_large_file: true,
            file_size: actual_size as i64,
            file_name: file_name.clone(),
            content_type: content_type.to_string(),
            source: "uploaded".to_string(),
            last_verified: now,
            created_at: None,
        })?;

        return Ok(source_path);
    }

    // 7. 小文件处理：复制到缓存目录
    let save_dir = expected_cache_dir;
    std::fs::create_dir_all(&save_dir)
        .map_err(|e| format!("创建缓存目录失败: {}", e))?;

    let safe_filename = sanitize_filename(&file_name);
    let cache_filename = format!("{}_{}", &file_hash[..8.min(file_hash.len())], safe_filename);
    let cache_path = save_dir.join(&cache_filename);
    let cache_path_str = cache_path.to_string_lossy().to_string();

    std::fs::copy(&source_path, &cache_path)
        .map_err(|e| format!("复制文件失败: {}", e))?;

    db::save_file_mapping(db::LocalFileMapping {
        file_hash: file_hash.clone(),
        local_path: cache_path_str.clone(),
        original_path: None,
        is_large_file: false,
        file_size: actual_size as i64,
        file_name: file_name.clone(),
        content_type: content_type.to_string(),
        source: "uploaded".to_string(),
        last_verified: now,
        created_at: None,
    })?;

    println!(
        "[CopyCache] 文件已缓存: {} -> {}",
        source_path, cache_path_str
    );

    Ok(cache_path_str)
}

/// 在文件管理器中显示文件
///
/// 打开系统文件管理器并定位到指定文件
///
/// # 参数
/// - `path`: 要显示的文件路径
///
/// # 平台支持
/// - Windows: 使用 explorer /select,
/// - macOS: 使用 open -R
/// - Linux: 使用 xdg-open 打开父目录（无法选中文件）
#[tauri::command]
pub fn show_in_folder(path: String) -> Result<(), String> {
    let file_path = std::path::Path::new(&path);

    if !file_path.exists() {
        return Err("文件不存在或已被移动".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .args(["/select,", &path])
            .spawn()
            .map_err(|e| format!("打开文件管理器失败: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| format!("打开 Finder 失败: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        // Linux 下 xdg-open 只能打开目录，无法选中文件
        if let Some(parent) = file_path.parent() {
            std::process::Command::new("xdg-open")
                .arg(parent)
                .spawn()
                .map_err(|e| format!("打开文件管理器失败: {}", e))?;
        } else {
            return Err("无法获取父目录".to_string());
        }
    }

    Ok(())
}

/// 检查文件是否存在
#[tauri::command]
pub fn is_file_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_filename() {
        assert_eq!(sanitize_filename("test.jpg"), "test.jpg");
        assert_eq!(sanitize_filename("test/file.jpg"), "test_file.jpg");
        assert_eq!(sanitize_filename("test:file?.jpg"), "test_file_.jpg");
    }
}
