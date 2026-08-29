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
//! 下载已接入统一下载引擎（`unified_download`）：
//! - **钉 CA + mTLS + HTTP/1.1 Client**: 与 secure_net 同套信任(连源站 IP / 无 SNI / 内置 CA)
//! - **Range 分片并发**: ≥4MB 走 8 片并发，支持断点续传（sidecar 清单）与每片重试
//! - **超时拆分**: connect 15s + 读 idle 60s，不设含 body 读完的总时长
//! - **完整性校验**: 下载完成后自算采样 SHA-256（`content_hash` 算法），有期望值时对账

use tauri::{Emitter, Window};

use crate::db;
use crate::user_data;

/// 下载进度事件
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    /// 下载任务的键（**不是内容哈希**）：消息面 = `file_uuid`，个人文件面 = 服务端下发的 `file_hash`。
    /// 见 `download_and_save_file` 的 `cache_key` 参数说明。
    pub cache_key: String,
    /// 已下载字节数
    pub downloaded: u64,
    /// 总字节数
    pub total: u64,
    /// 下载百分比
    pub percent: f64,
    /// 状态: "downloading" | "completed" | "failed"
    pub status: String,
    /// 本地路径（仅在 status="completed" 时填充，供前端 listener 直接 completeDownload）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_path: Option<String>,
    /// 错误信息（仅在 status="failed" 时填充）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// 下载文件并保存到本地
///
/// 底层走统一下载引擎（`unified_download`）：Range 分片并发、断点续传、每片重试、
/// 采样哈希校验，适合局域网大文件传输。
///
/// # 两层键（2026-08-16 起）
///
/// 后端接收面已不再下发 `file_hash` ⇒ **开下载这一刻，内容哈希是未知的**。所以本命令
/// 不再要求调用方给哈希，改为：
///
/// 1. 用调用方给的 `cache_key` 做**下载任务的键**（进度事件、去重判定都用它）；
/// 2. 下载完成后由本机 `content_hash::sampled_sha256_of_file` **自算**内容哈希；
/// 3. 用自算的哈希写 `file_mappings`（该表主键仍是内容哈希，**结构一个字没动**），
///    并在 `cache_key` 不是哈希本身时补一行 `file_uuid_hash(cache_key -> hash)`，
///    让下一次可以由 uuid 直接命中本地文件。
///
/// # 参数
/// - `url`: 预签名下载 URL
/// - `cache_key`: **下载任务的键，不是内容哈希**。消息面 = `file_uuid`（后端不再下发哈希），
///   个人文件面（`GET /api/storage/files`）= 服务端仍在下发的 `file_hash`。两者都在各自来源下
///   稳定唯一，且键空间不相交（uuid 带连字符 / 哈希是 64 位十六进制）。
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
    // presigned 按 host 签名(SigV4 SignedHeaders=host):url 已被 JS 改写成源站 IP,需带【改写前的
    // 原始 host】(=签名时的逻辑域名)当 Host 头,否则签名 host 不匹配 → MinIO 403。前端 downloadAndSaveFile 传入。
    host: Option<String>,
    cache_key: String,
    file_name: String,
    file_type: String,
    file_size: Option<u64>,
    window: Window,
) -> Result<String, String> {
    // 1. 检查是否已有本地缓存。
    //    两跳：先把 cache_key 当 uuid 解析成内容哈希（消息面），解析不到就把它自己当哈希
    //    （个人文件面，服务端下发的就是哈希）。两个键空间不相交，不会互相误命中。
    let known_hash = db::get_file_hash_by_uuid(&cache_key)
        .ok()
        .flatten()
        .unwrap_or_else(|| cache_key.clone());
    if let Ok(Some(mapping)) = db::get_file_mapping(&known_hash) {
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

    // 4. 先落到临时文件：**最终文件名要用内容哈希前 8 位**，而哈希此刻还不知道
    //    （两层键：哈希由本机在下载完成后自算）。临时名用 cache_key，不参与任何索引。
    let safe_filename = sanitize_filename(&file_name);
    let temp_path = save_dir.join(format!("{}.hvpart", sanitize_filename(&cache_key)));
    let temp_path_str = temp_path.to_string_lossy().to_string();

    println!("[Download] 开始下载: {} -> {}", file_name, temp_path_str);

    // 5. 发送开始事件
    let _ = window.emit(
        "download-progress",
        DownloadProgress {
            cache_key: cache_key.clone(),
            downloaded: 0,
            total: file_size.unwrap_or(0),
            percent: 0.0,
            status: "downloading".to_string(),
            local_path: None,
            error: None,
        },
    );

    // 6. 统一下载引擎（unified_download）：Range 分片 + 断点续传（sidecar）+ 重试 +
    //    采样哈希校验 + 降级单流。信任栈与旧单流相同（内置 CA + mTLS + 显式 Host +
    //    强制 HTTP/1.1，理由见引擎模块头），超时改为 connect 15s + 读 idle 60s，
    //    不再设含 body 读完的总时长（GB 级文件任何总时长门都会误杀）。
    //    续传身份键 = cache_key（消息面 file_uuid / 个人文件面 file_hash，均稳定唯一，
    //    不随预签名 URL 3h 轮换而变）。进度事件语义不变：仍按 1% 节流发 "download-progress"。
    let total_hint = file_size.unwrap_or(0);
    let last_emit_percent = std::sync::Arc::new(std::sync::Mutex::new(0.0f64));
    let progress_window = window.clone();
    let progress_key = cache_key.clone();
    let on_progress: crate::unified_download::ProgressSink =
        std::sync::Arc::new(move |done: u64, total: u64| {
            let total = if total > 0 { total } else { total_hint };
            let percent = if total > 0 {
                (done as f64 / total as f64) * 100.0
            } else {
                0.0
            };
            let mut last = last_emit_percent.lock().unwrap();
            if percent - *last >= 1.0 || done == total {
                *last = percent;
                let _ = progress_window.emit(
                    "download-progress",
                    DownloadProgress {
                        cache_key: progress_key.clone(),
                        downloaded: done,
                        total,
                        percent,
                        status: "downloading".to_string(),
                        local_path: None,
                        error: None,
                    },
                );
            }
        });
    let mut dl_req =
        crate::unified_download::DownloadRequest::new(url, cache_key.clone(), temp_path.clone());
    dl_req.host = host;
    dl_req.expected_size = file_size;
    // 个人文件面的 cache_key 本身就是服务端下发的采样哈希（64 位小写十六进制）⇒ 交给引擎对账；
    // 消息面的 uuid（带连字符、36 字符）不是哈希 ⇒ 不对账，自算结果仅作身份/去重。
    if cache_key.len() == 64 && cache_key.chars().all(|c| c.is_ascii_hexdigit()) {
        dl_req.expected_sampled_hash = Some(cache_key.clone());
    }
    dl_req.on_progress = Some(on_progress);
    let outcome = crate::unified_download::download(dl_req)
        .await
        .map_err(|e| e.to_string())?;

    let downloaded = outcome.bytes;
    let total_size = if outcome.bytes > 0 { outcome.bytes } else { total_hint };
    let content_type = outcome
        .content_type
        .unwrap_or_else(|| "application/octet-stream".to_string());

    // 7. 内容身份哈希已由引擎在收口时自算（有 expected 时已对账一致）——
    //    算法与上传侧 TS 同源（见 content_hash / unified_download 模块头）。
    let content_hash = outcome.sampled_hash;

    // 8.1 内容去重：这份字节本机已经有了（可能来自另一个 uuid / 自己上传的原件）⇒
    //     丢掉刚下的副本，直接复用既有路径。这正是"用内容哈希当身份"换来的东西。
    let local_path_str = match db::get_file_mapping(&content_hash) {
        Ok(Some(mapping)) if std::path::Path::new(&mapping.local_path).exists() => {
            let _ = std::fs::remove_file(&temp_path);
            println!("[Download] 内容已存在，复用本地文件: {}", mapping.local_path);
            mapping.local_path
        }
        _ => {
            // 8.2 用内容哈希前 8 位定名（与上传侧落盘命名规则一致），再把临时文件改名过去
            let final_path = save_dir.join(format!("{}_{}", &content_hash[..8], safe_filename));
            if final_path != temp_path {
                std::fs::rename(&temp_path, &final_path)
                    .map_err(|e| format!("重命名下载文件失败: {}", e))?;
            }
            let final_path_str = final_path.to_string_lossy().to_string();

            // 8.3 保存文件映射到数据库（主键仍是内容哈希，表结构未变）
            let now = chrono::Utc::now().to_rfc3339();
            db::save_file_mapping(db::LocalFileMapping {
                file_hash: content_hash.clone(),
                local_path: final_path_str.clone(),
                original_path: None,  // 下载的文件不需要原始路径
                is_large_file: false, // 下载的文件都缓存到本地
                file_size: downloaded as i64,
                file_name: file_name.clone(),
                content_type,
                source: "downloaded".to_string(),
                last_verified: now,
                created_at: None,
            })?;
            final_path_str
        }
    };

    // 8.4 补上 uuid -> hash 这一跳，下次由 file_uuid 就能直接命中本地文件。
    //     cache_key 本身就是内容哈希时（个人文件面）不写：那会是一条 (hash, hash) 的废行。
    if cache_key != content_hash {
        db::save_file_uuid_hash(&cache_key, &content_hash)?;
    }

    // 9. 发送完成事件（携带 local_path，让前端 listener 直接驱动 completeDownload，
    //    不再依赖 triggerBackgroundDownload 的 await 回调；解决 HMR / fire-and-forget /
    //    跨窗口场景下进度环卡 100% 的问题）
    let _ = window.emit(
        "download-progress",
        DownloadProgress {
            cache_key: cache_key.clone(),
            downloaded,
            total: total_size,
            percent: 100.0,
            status: "completed".to_string(),
            local_path: Some(local_path_str.clone()),
            error: None,
        },
    );

    println!(
        "[Download] 下载完成: {} ({} bytes, hash={})",
        local_path_str, downloaded, content_hash
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
