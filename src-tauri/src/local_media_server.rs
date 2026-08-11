//! 移动端本地媒体服务器
//!
//! ## 背景
//!
//! Android WebView 无法通过 Tauri 的 `asset://` 协议正确播放本地视频文件，
//! 这是 Tauri v2 的已知问题（参考 GitHub Issue #12019）。
//!
//! ## 解决方案
//!
//! 在 Rust 端启动一个本地 HTTP 服务器（仅移动端），提供：
//! - 本地视频文件的 HTTP 访问
//! - 本地音频文件的 HTTP 访问（提示音试听）
//! - Range 请求支持（HTTP 206 Partial Content）
//! - 流式传输，低内存占用
//!
//! ## 使用方式
//!
//! 1. 应用启动时调用 `start_server()` 启动服务器
//! 2. 前端通过 `get_local_video_url` 命令获取本地视频的 HTTP URL
//! 3. 使用该 URL 作为 `<video>` 或 `<audio>` 元素的 `src`
//!
//! ## 端点
//!
//! - `/video/{file_hash}` - 视频文件（从缓存目录）
//! - `/audio/{name}` - 音频文件（从提示音目录）
//! - `/health` - 健康检查
//!
//! ## 端口
//!
//! 默认使用端口 9527，如果被占用会自动尝试其他端口
//!
//! ## 平台限制
//!
//! 此模块仅在 Android/iOS 平台编译和使用，桌面端不包含此代码。

use axum::{
    body::Body,
    extract::{Path, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use std::sync::Arc;
use tokio::fs::File;
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio::sync::RwLock;
use tokio_util::io::ReaderStream;

use crate::download;
use crate::user_data::get_notification_sounds_dir;

/// 服务器状态
///
/// 目前为空结构体，预留用于未来扩展（如动态配置、日志等）
#[allow(dead_code)]
struct ServerState {
    /// 应用数据目录（预留）
    data_dir: String,
}

/// 服务器端口（启动后设置）
static SERVER_PORT: RwLock<Option<u16>> = RwLock::const_new(None);

/// 默认起始端口
const DEFAULT_PORT: u16 = 9527;

/// 最大尝试端口数
const MAX_PORT_ATTEMPTS: u16 = 10;

/// 启动本地媒体服务器
///
/// # 参数
/// - `data_dir`: 应用数据目录路径
///
/// # 返回
/// - `Ok(port)`: 成功启动，返回实际使用的端口
/// - `Err(msg)`: 启动失败
pub async fn start_server(data_dir: String) -> Result<u16, String> {
    let state = Arc::new(ServerState { data_dir });

    let app = Router::new()
        .route("/video/{file_hash}", get(serve_video))
        .route("/audio/{name}", get(serve_audio))
        .route("/health", get(health_check))
        .with_state(state);

    // 尝试绑定端口
    let mut port = DEFAULT_PORT;
    let listener = loop {
        match tokio::net::TcpListener::bind(format!("127.0.0.1:{}", port)).await {
            Ok(listener) => break listener,
            Err(_) if port < DEFAULT_PORT + MAX_PORT_ATTEMPTS => {
                port += 1;
                continue;
            }
            Err(e) => {
                return Err(format!("无法绑定端口: {}", e));
            }
        }
    };

    // 保存实际使用的端口
    {
        let mut server_port = SERVER_PORT.write().await;
        *server_port = Some(port);
    }

    // 后台运行服务器
    tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, app).await {
            eprintln!("[MobileMediaServer] 服务器错误: {}", e);
        }
    });

    println!("[MobileMediaServer] 已启动，端口: {}", port);
    Ok(port)
}

/// 获取服务器端口
pub async fn get_server_port() -> Option<u16> {
    let port = SERVER_PORT.read().await;
    *port
}

/// 健康检查端点
async fn health_check() -> &'static str {
    "OK"
}

/// 处理视频请求
///
/// 支持 Range 请求，实现视频流式播放和进度条拖动
async fn serve_video(
    Path(file_hash): Path<String>,
    headers: HeaderMap,
    State(_state): State<Arc<ServerState>>,
) -> Response {
    // 1. 根据 file_hash 查询数据库获取本地路径
    let local_path = match get_cached_file_path(&file_hash) {
        Some(path) => path,
        None => {
            return (StatusCode::NOT_FOUND, "文件未找到").into_response();
        }
    };

    // 2. 打开文件
    let mut file = match File::open(&local_path).await {
        Ok(f) => f,
        Err(e) => {
            eprintln!(
                "[MobileMediaServer] 无法打开文件 {}: {}",
                local_path, e
            );
            return (StatusCode::INTERNAL_SERVER_ERROR, "无法打开文件").into_response();
        }
    };

    // 3. 获取文件大小
    let file_size = match file.metadata().await {
        Ok(meta) => meta.len(),
        Err(_) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, "无法获取文件信息").into_response();
        }
    };

    // 4. 猜测 MIME 类型
    let content_type = mime_guess::from_path(&local_path)
        .first_or_octet_stream()
        .to_string();

    // 5. 解析 Range 请求头
    let range = headers
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| parse_range(s, file_size));

    match range {
        Some((start, end)) => {
            // 6a. Range 请求 - 返回 206 Partial Content
            let length = end - start + 1;

            // 移动到起始位置
            if let Err(e) = file.seek(std::io::SeekFrom::Start(start)).await {
                eprintln!("[MobileMediaServer] Seek 失败: {}", e);
                return (StatusCode::INTERNAL_SERVER_ERROR, "Seek 失败").into_response();
            }

            // 创建有限长度的流
            let limited_reader = file.take(length);
            let stream = ReaderStream::new(limited_reader);
            let body = Body::from_stream(stream);

            Response::builder()
                .status(StatusCode::PARTIAL_CONTENT)
                .header(header::CONTENT_TYPE, content_type)
                .header(header::CONTENT_LENGTH, length.to_string())
                .header(
                    header::CONTENT_RANGE,
                    format!("bytes {}-{}/{}", start, end, file_size),
                )
                .header(header::ACCEPT_RANGES, "bytes")
                .body(body)
                .unwrap()
        }
        None => {
            // 6b. 普通请求 - 返回完整文件
            let stream = ReaderStream::new(file);
            let body = Body::from_stream(stream);

            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, content_type)
                .header(header::CONTENT_LENGTH, file_size.to_string())
                .header(header::ACCEPT_RANGES, "bytes")
                .body(body)
                .unwrap()
        }
    }
}

/// 解析 Range 请求头
///
/// 支持格式: `bytes=start-end` 或 `bytes=start-`
fn parse_range(range_header: &str, file_size: u64) -> Option<(u64, u64)> {
    let range_str = range_header.strip_prefix("bytes=")?;

    let parts: Vec<&str> = range_str.split('-').collect();
    if parts.len() != 2 {
        return None;
    }

    let start: u64 = parts[0].parse().ok()?;
    let end: u64 = if parts[1].is_empty() {
        file_size - 1
    } else {
        parts[1].parse().ok()?
    };

    if start <= end && end < file_size {
        Some((start, end))
    } else {
        None
    }
}

/// 从数据库获取缓存文件路径
fn get_cached_file_path(file_hash: &str) -> Option<String> {
    // 使用 download 模块的缓存查询函数
    download::get_cached_file_path(file_hash.to_string())
        .ok()
        .flatten()
}

// ============================================
// 公共函数（供 lib.rs 的 Tauri 命令调用）
// ============================================

/// 获取本地视频的 HTTP URL
///
/// 如果视频已缓存到本地，返回本地服务器 URL；否则返回 None
///
/// 注意：此函数由 lib.rs 中的 Tauri 命令调用，不直接标记为 tauri::command
pub async fn get_local_video_url(file_hash: String) -> Option<String> {
    // 1. 检查服务器是否已启动
    let port = get_server_port().await?;

    // 2. 检查文件是否已缓存
    let _local_path = get_cached_file_path(&file_hash)?;

    // 3. 返回本地服务器 URL
    Some(format!("http://127.0.0.1:{}/video/{}", port, file_hash))
}

/// 获取本地音频（提示音）的 HTTP URL
///
/// 用于 Android 端提示音试听功能
#[allow(dead_code)]
pub async fn get_local_audio_url(name: String) -> Option<String> {
    // 1. 检查服务器是否已启动
    let port = get_server_port().await?;

    // 2. 检查音频文件是否存在
    let sounds_dir = get_notification_sounds_dir();
    let file_path = sounds_dir.join(format!("{}.mp3", name));
    if !file_path.exists() {
        return None;
    }

    // 3. 返回本地服务器 URL
    Some(format!("http://127.0.0.1:{}/audio/{}", port, name))
}

// ============================================
// 音频处理
// ============================================

/// 处理音频请求（提示音试听）
///
/// 音频文件较小，直接返回完整内容，不使用 Range 请求
async fn serve_audio(
    Path(name): Path<String>,
    State(_state): State<Arc<ServerState>>,
) -> Response {
    println!("[MobileMediaServer] 收到音频请求: {}", name);

    // 1. 获取音频文件路径
    let sounds_dir = get_notification_sounds_dir();
    let file_path = sounds_dir.join(format!("{}.mp3", name));

    if !file_path.exists() {
        println!("[MobileMediaServer] 音频文件不存在: {:?}", file_path);
        return (StatusCode::NOT_FOUND, "Audio not found").into_response();
    }

    // 2. 读取文件内容
    let file_data = match tokio::fs::read(&file_path).await {
        Ok(data) => data,
        Err(e) => {
            println!("[MobileMediaServer] 读取音频文件失败: {}", e);
            return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to read audio").into_response();
        }
    };

    let file_size = file_data.len();
    println!("[MobileMediaServer] 返回音频: {} ({} bytes)", name, file_size);

    // 3. 返回音频内容
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "audio/mpeg")
        .header(header::CONTENT_LENGTH, file_size)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(Body::from(file_data))
        .unwrap()
}
