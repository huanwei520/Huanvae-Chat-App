//! 剪贴板图片处理模块（桌面端专属）
//!
//! ## 功能
//! - 将剪贴板中的 RGBA 图片数据保存为 PNG 文件
//! - 返回本地文件路径，供前端使用
//!
//! ## 使用场景
//! 用户在聊天输入框中按 Ctrl+V 粘贴截图时：
//! 1. 前端通过 @tauri-apps/plugin-clipboard-manager 读取剪贴板图片
//! 2. 调用此模块将 RGBA 数据保存为 PNG 文件
//! 3. 返回本地路径，前端使用此路径上传文件
//!
//! ## 平台支持
//! - 仅桌面端 (Windows/macOS/Linux)
//! - 移动端剪贴板图片功能不支持

use chrono::Local;
use png::{BitDepth, ColorType, Encoder};
use std::fs::{self, File};
use std::io::BufWriter;
use std::path::PathBuf;

/// 获取剪贴板图片临时保存目录
fn get_clipboard_temp_dir() -> Result<PathBuf, String> {
    let temp_dir = std::env::temp_dir().join("huanvae-clipboard");
    fs::create_dir_all(&temp_dir).map_err(|e| format!("创建临时目录失败: {}", e))?;
    Ok(temp_dir)
}

/// 将 RGBA 图片数据保存为 PNG 文件
///
/// # 参数
/// - `rgba_data`: RGBA 格式的图片像素数据（每像素 4 字节）
/// - `width`: 图片宽度
/// - `height`: 图片高度
///
/// # 返回
/// - 成功：保存的 PNG 文件本地路径
/// - 失败：错误信息
///
/// # 示例
/// ```javascript
/// import { invoke } from '@tauri-apps/api/core';
///
/// const localPath = await invoke('save_clipboard_image', {
///   rgbaData: Array.from(imageData),
///   width: 800,
///   height: 600,
/// });
/// ```
#[tauri::command(rename_all = "camelCase")]
pub async fn save_clipboard_image(
    rgba_data: Vec<u8>,
    width: u32,
    height: u32,
) -> Result<String, String> {
    // 验证数据大小
    let expected_size = (width * height * 4) as usize;
    if rgba_data.len() != expected_size {
        return Err(format!(
            "RGBA 数据大小不匹配: 期望 {} 字节 ({}x{}x4)，实际 {} 字节",
            expected_size,
            width,
            height,
            rgba_data.len()
        ));
    }

    // 获取临时目录
    let temp_dir = get_clipboard_temp_dir()?;

    // 生成唯一文件名（使用时间戳）
    let timestamp = Local::now().format("%Y%m%d_%H%M%S_%3f");
    let filename = format!("clipboard_{}.png", timestamp);
    let file_path = temp_dir.join(&filename);

    // 在后台线程执行 IO 操作
    let file_path_clone = file_path.clone();
    tokio::task::spawn_blocking(move || {
        // 创建 PNG 文件
        let file = File::create(&file_path_clone)
            .map_err(|e| format!("创建文件失败: {}", e))?;
        let writer = BufWriter::new(file);

        // 配置 PNG 编码器
        let mut encoder = Encoder::new(writer, width, height);
        encoder.set_color(ColorType::Rgba);
        encoder.set_depth(BitDepth::Eight);
        // 使用较快的压缩级别（6 是默认值，对于截图足够好）
        encoder.set_compression(png::Compression::Default);

        // 写入图片数据
        let mut png_writer = encoder
            .write_header()
            .map_err(|e| format!("写入 PNG 头失败: {}", e))?;
        png_writer
            .write_image_data(&rgba_data)
            .map_err(|e| format!("写入 PNG 数据失败: {}", e))?;

        Ok::<_, String>(())
    })
    .await
    .map_err(|e| format!("后台任务失败: {}", e))??;

    // 返回文件路径
    Ok(file_path.to_string_lossy().to_string())
}

/// 清理过期的剪贴板临时文件
///
/// 删除超过指定时间的临时文件，避免磁盘空间占用过大
///
/// # 参数
/// - `max_age_hours`: 文件最大保留时间（小时），默认 24 小时
#[tauri::command(rename_all = "camelCase")]
pub async fn cleanup_clipboard_temp_files(max_age_hours: Option<u64>) -> Result<u32, String> {
    let max_age = std::time::Duration::from_secs((max_age_hours.unwrap_or(24)) * 3600);
    let temp_dir = get_clipboard_temp_dir()?;

    let mut deleted_count = 0u32;

    let entries = fs::read_dir(&temp_dir).map_err(|e| format!("读取目录失败: {}", e))?;

    for entry in entries.flatten() {
        let path = entry.path();

        // 检查是否为 PNG 文件且超过最大保留时间
        let should_delete = path.extension().is_some_and(|ext| ext == "png")
            && fs::metadata(&path)
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| std::time::SystemTime::now().duration_since(t).ok())
                .is_some_and(|age| age > max_age);

        if should_delete && fs::remove_file(&path).is_ok() {
            deleted_count += 1;
        }
    }

    Ok(deleted_count)
}
