//! Android 更新模块
//!
//! 提供 Android 平台专属的更新功能：
//! - 获取应用版本号
//! - 获取版本检测 JSON（支持超时）
//! - 下载 APK 文件（带进度通知）
//!
//! 注意：此模块仅在 Android 平台编译，桌面端使用 tauri-plugin-updater

use tauri::AppHandle;
#[cfg(target_os = "android")]
use tauri::Emitter;
#[cfg(target_os = "android")]
use tauri::Manager;

/// 获取应用版本号
///
/// 从 tauri.conf.json 中读取版本号
#[tauri::command]
pub fn get_app_version(app: AppHandle) -> String {
    let version = app.config().version.clone().unwrap_or_else(|| "0.0.0".to_string());
    println!("[Android Update] get_app_version: {}", version);
    version
}

/// 获取更新检测 JSON
///
/// 从指定 URL 获取版本信息 JSON，支持超时设置
#[tauri::command]
pub async fn fetch_update_json(url: String, timeout_secs: u64) -> Result<String, String> {
    use std::time::Duration;

    println!("[Android Update] fetch_update_json 开始");
    println!("[Android Update] URL: {}", url);
    println!("[Android Update] 超时: {} 秒", timeout_secs);

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .build()
        .map_err(|e| {
            eprintln!("[Android Update] 创建 HTTP 客户端失败: {}", e);
            format!("创建 HTTP 客户端失败: {}", e)
        })?;

    println!("[Android Update] 发送请求...");
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| {
            eprintln!("[Android Update] 请求失败: {}", e);
            format!("请求失败: {}", e)
        })?;

    println!("[Android Update] 响应状态: {}", response.status());
    if !response.status().is_success() {
        let err = format!("HTTP 错误: {}", response.status());
        eprintln!("[Android Update] {}", err);
        return Err(err);
    }

    let text = response
        .text()
        .await
        .map_err(|e| {
            eprintln!("[Android Update] 读取响应失败: {}", e);
            format!("读取响应失败: {}", e)
        })?;

    println!("[Android Update] 响应长度: {} 字节", text.len());
    println!("[Android Update] 响应内容: {}", &text[..text.len().min(200)]);
    Ok(text)
}

/// 下载 APK 文件（仅 Android）
///
/// 下载 APK 到应用缓存目录（无需权限），并通过事件发送进度
#[cfg(target_os = "android")]
#[tauri::command]
pub async fn download_apk(url: String, app: AppHandle) -> Result<String, String> {
    use futures_util::StreamExt;
    use std::io::Write;

    println!("[Android Update] ========== download_apk 开始 ==========");
    println!("[Android Update] 下载 URL: {}", url);

    let client = reqwest::Client::new();
    println!("[Android Update] 发送下载请求...");
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| {
            eprintln!("[Android Update] 下载请求失败: {}", e);
            format!("下载请求失败: {}", e)
        })?;

    println!("[Android Update] 响应状态: {}", response.status());
    if !response.status().is_success() {
        let err = format!("下载失败: HTTP {}", response.status());
        eprintln!("[Android Update] {}", err);
        return Err(err);
    }

    let total = response.content_length().unwrap_or(0);
    println!("[Android Update] 文件大小: {} bytes", total);
    let mut downloaded: u64 = 0;

    // 使用应用缓存目录（无需任何权限）
    // tauri-plugin-android-package-install 会自动处理 FileProvider
    let cache_dir = app
        .path()
        .cache_dir()
        .map_err(|e| format!("获取缓存目录失败: {}", e))?;
    let file_path = cache_dir.join("huanvae-chat-update.apk");
    let file_path_str = file_path.to_string_lossy().to_string();
    println!("[Android Update] 保存路径: {}", file_path_str);

    // 确保缓存目录存在
    if let Err(e) = std::fs::create_dir_all(&cache_dir) {
        eprintln!("[Android Update] 创建缓存目录失败（可能已存在）: {}", e);
        // 继续尝试，目录可能已存在
    }

    // 创建文件
    println!("[Android Update] 创建文件...");
    let mut file =
        std::fs::File::create(&file_path).map_err(|e| {
            eprintln!("[Android Update] 创建文件失败: {}", e);
            format!("创建文件失败: {}", e)
        })?;
    println!("[Android Update] 文件创建成功");

    // 流式下载
    println!("[Android Update] 开始流式下载...");
    let mut stream = response.bytes_stream();
    let mut last_log_percent: u8 = 0;
    
    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| {
            eprintln!("[Android Update] 下载数据失败: {}", e);
            format!("下载数据失败: {}", e)
        })?;

        file.write_all(&chunk)
            .map_err(|e| {
                eprintln!("[Android Update] 写入文件失败: {}", e);
                format!("写入文件失败: {}", e)
            })?;

        downloaded += chunk.len() as u64;

        // 发送进度事件
        let percent = if total > 0 {
            (downloaded * 100 / total) as u8
        } else {
            0
        };

        // 每 10% 输出一次日志
        if percent >= last_log_percent + 10 {
            println!("[Android Update] 下载进度: {}% ({}/{})", percent, downloaded, total);
            last_log_percent = percent;
        }

        let _ = app.emit("apk-download-progress", (percent, downloaded, total));
    }

    // 确保写入完成
    println!("[Android Update] 刷新缓冲区...");
    file.flush().map_err(|e| {
        eprintln!("[Android Update] 刷新文件失败: {}", e);
        format!("刷新文件失败: {}", e)
    })?;

    println!(
        "[Android Update] ✓ 下载完成: {} ({} bytes)",
        file_path_str, downloaded
    );
    Ok(file_path_str)
}

/// 下载 APK 文件（非 Android 平台的存根）
///
/// 桌面端不需要此功能，返回错误
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn download_apk(_url: String, _app: AppHandle) -> Result<String, String> {
    Err("APK 下载仅支持 Android 平台".to_string())
}
