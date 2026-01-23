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

/// 获取应用版本号
///
/// 从 tauri.conf.json 中读取版本号
#[tauri::command]
pub fn get_app_version(app: AppHandle) -> String {
    app.config().version.clone().unwrap_or_else(|| "0.0.0".to_string())
}

/// 获取更新检测 JSON
///
/// 从指定 URL 获取版本信息 JSON，支持超时设置
#[tauri::command]
pub async fn fetch_update_json(url: String, timeout_secs: u64) -> Result<String, String> {
    use std::time::Duration;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("HTTP 错误: {}", response.status()));
    }

    response
        .text()
        .await
        .map_err(|e| format!("读取响应失败: {}", e))
}

/// 下载 APK 文件（仅 Android）
///
/// 下载 APK 到公共 Download 目录，并通过事件发送进度
#[cfg(target_os = "android")]
#[tauri::command]
pub async fn download_apk(url: String, app: AppHandle) -> Result<String, String> {
    use futures_util::StreamExt;
    use std::io::Write;

    println!("[Android Update] 开始下载 APK: {}", url);

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("下载请求失败: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("下载失败: HTTP {}", response.status()));
    }

    let total = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;

    // 保存到公共 Download 目录
    let download_dir = "/storage/emulated/0/Download";
    let file_path = format!("{}/huanvae-chat-update.apk", download_dir);

    // 确保目录存在
    if let Err(e) = std::fs::create_dir_all(download_dir) {
        eprintln!("[Android Update] 创建目录失败: {}", e);
        // 继续尝试，目录可能已存在
    }

    // 创建文件
    let mut file =
        std::fs::File::create(&file_path).map_err(|e| format!("创建文件失败: {}", e))?;

    // 流式下载
    let mut stream = response.bytes_stream();
    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| format!("下载数据失败: {}", e))?;

        file.write_all(&chunk)
            .map_err(|e| format!("写入文件失败: {}", e))?;

        downloaded += chunk.len() as u64;

        // 发送进度事件
        let percent = if total > 0 {
            (downloaded * 100 / total) as u8
        } else {
            0
        };

        let _ = app.emit("apk-download-progress", (percent, downloaded, total));
    }

    // 确保写入完成
    file.flush().map_err(|e| format!("刷新文件失败: {}", e))?;

    println!(
        "[Android Update] 下载完成: {} ({} bytes)",
        file_path, downloaded
    );
    Ok(file_path)
}

/// 下载 APK 文件（非 Android 平台的存根）
///
/// 桌面端不需要此功能，返回错误
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn download_apk(_url: String, _app: AppHandle) -> Result<String, String> {
    Err("APK 下载仅支持 Android 平台".to_string())
}
