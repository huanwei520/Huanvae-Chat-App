//! 文件下载模块
//!
//! 提供从远程 URL 下载文件并保存到本地的功能
//! 支持进度回调，用于前端显示下载进度

use futures_util::StreamExt;
use std::io::Write;
use tauri::{Emitter, Window};

use crate::db;
use crate::user_data;

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

    // 6. 下载文件
    let client = reqwest::Client::new();
    let response = client
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

    // 7. 流式写入文件
    let mut file = std::fs::File::create(&local_path)
        .map_err(|e| format!("创建文件失败: {}", e))?;

    let mut downloaded: u64 = 0;
    let mut stream = response.bytes_stream();
    let mut last_emit_percent: f64 = 0.0;

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| format!("下载数据失败: {}", e))?;

        file.write_all(&chunk)
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

    // 8. 保存文件映射到数据库
    let now = chrono::Utc::now().to_rfc3339();
    db::save_file_mapping(db::LocalFileMapping {
        file_hash: file_hash.clone(),
        local_path: local_path_str.clone(),
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
#[tauri::command(rename_all = "camelCase")]
pub fn is_file_cached(file_hash: String) -> Result<bool, String> {
    match db::get_file_mapping(&file_hash) {
        Ok(Some(mapping)) => {
            // 验证文件是否存在
            let exists = std::path::Path::new(&mapping.local_path).exists();
            if !exists {
                // 文件不存在，删除无效映射
                let _ = db::delete_file_mapping(&file_hash);
            }
            Ok(exists)
        }
        Ok(None) => Ok(false),
        Err(e) => Err(e),
    }
}

/// 获取已缓存文件的本地路径
#[tauri::command(rename_all = "camelCase")]
pub fn get_cached_file_path(file_hash: String) -> Result<Option<String>, String> {
    match db::get_file_mapping(&file_hash) {
        Ok(Some(mapping)) => {
            if std::path::Path::new(&mapping.local_path).exists() {
                Ok(Some(mapping.local_path))
            } else {
                // 文件不存在，删除无效映射
                let _ = db::delete_file_mapping(&file_hash);
                Ok(None)
            }
        }
        Ok(None) => Ok(None),
        Err(e) => Err(e),
    }
}

/// 复制文件到缓存目录
///
/// 用于上传文件后将原始文件复制到统一的缓存目录
/// 这样即使原始文件被移动/删除，缓存仍然可用
///
/// # 参数
/// - `source_path`: 源文件路径
/// - `file_hash`: 文件哈希
/// - `file_name`: 原始文件名
/// - `file_type`: 文件类型 ("image" | "video" | "document")
///
/// # 返回
/// - 成功：缓存文件路径
/// - 失败：错误信息
#[tauri::command(rename_all = "camelCase")]
pub fn copy_file_to_cache(
    source_path: String,
    file_hash: String,
    file_name: String,
    file_type: String,
) -> Result<String, String> {
    // 1. 检查源文件是否存在
    let source = std::path::Path::new(&source_path);
    if !source.exists() {
        return Err(format!("源文件不存在: {}", source_path));
    }

    // 2. 获取当前用户上下文（需要先获取，用于判断缓存目录）
    let user_ctx = user_data::get_current_user()
        .ok_or_else(|| "未登录，无法缓存文件".to_string())?;

    // 3. 计算预期的缓存目录
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

    // 4. 检查是否已有缓存（只有当映射路径在缓存目录中时才跳过）
    if let Ok(Some(mapping)) = db::get_file_mapping(&file_hash) {
        let existing_path = std::path::Path::new(&mapping.local_path);
        // 检查文件是否存在且在正确的缓存目录中
        if existing_path.exists() && mapping.local_path.contains(&expected_cache_dir_str) {
            println!("[CopyCache] 文件已在缓存目录: {}", mapping.local_path);
            return Ok(mapping.local_path);
        }
        // 文件存在但不在缓存目录，需要复制
        if existing_path.exists() {
            println!(
                "[CopyCache] 文件存在但不在缓存目录，将复制: {} -> {}",
                mapping.local_path, expected_cache_dir_str
            );
        }
    }

    // 5. 确定保存目录（复用 expected_cache_dir）
    let save_dir = expected_cache_dir;

    // 6. 确保目录存在
    std::fs::create_dir_all(&save_dir)
        .map_err(|e| format!("创建缓存目录失败: {}", e))?;

    // 7. 生成缓存文件名（hash前8位_原始文件名）
    let safe_filename = sanitize_filename(&file_name);
    let cache_filename = format!("{}_{}", &file_hash[..8.min(file_hash.len())], safe_filename);
    let cache_path = save_dir.join(&cache_filename);
    let cache_path_str = cache_path.to_string_lossy().to_string();

    // 8. 复制文件
    std::fs::copy(&source_path, &cache_path)
        .map_err(|e| format!("复制文件失败: {}", e))?;

    // 9. 获取文件信息
    let metadata = std::fs::metadata(&cache_path)
        .map_err(|e| format!("获取文件信息失败: {}", e))?;
    let file_size = metadata.len() as i64;

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

    // 10. 保存文件映射到数据库（覆盖旧映射）
    let now = chrono::Utc::now().to_rfc3339();
    db::save_file_mapping(db::LocalFileMapping {
        file_hash: file_hash.clone(),
        local_path: cache_path_str.clone(),
        file_size,
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
