//! 提示音管理模块
//!
//! 管理消息提示音文件：
//! - 列出所有可用的提示音
//! - 上传自定义提示音
//! - 删除提示音
//! - 获取提示音文件路径
//!
//! 提示音存储在 Notification-Sounds/ 目录（与 data 目录并列）

use crate::user_data::get_notification_sounds_dir;
use serde::{Deserialize, Serialize};
use std::fs;

// ============================================================================
// 类型定义
// ============================================================================

/// 提示音信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SoundInfo {
    /// 显示名称（不含扩展名）
    pub name: String,
    /// 文件名（含扩展名）
    pub filename: String,
    /// 完整文件路径
    pub path: String,
}

// ============================================================================
// Tauri 命令
// ============================================================================

/// 列出所有可用的提示音
#[tauri::command]
pub fn list_notification_sounds() -> Result<Vec<SoundInfo>, String> {
    let sounds_dir = get_notification_sounds_dir();

    // 确保目录存在
    if !sounds_dir.exists() {
        fs::create_dir_all(&sounds_dir)
            .map_err(|e| format!("创建提示音目录失败: {}", e))?;
        return Ok(Vec::new());
    }

    let mut sounds = Vec::new();

    let entries = fs::read_dir(&sounds_dir)
        .map_err(|e| format!("读取提示音目录失败: {}", e))?;

    for entry in entries.flatten() {
        let path = entry.path();

        // 只处理 mp3 文件
        if path.is_file()
            && let Some(ext) = path.extension()
            && ext.to_string_lossy().to_lowercase() == "mp3"
            && let Some(filename) = path.file_name()
        {
            let filename_str = filename.to_string_lossy().to_string();
            let name = path
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| filename_str.clone());

            sounds.push(SoundInfo {
                name,
                filename: filename_str,
                path: path.to_string_lossy().to_string(),
            });
        }
    }

    // 按名称排序，但确保 water 在最前面
    sounds.sort_by(|a, b| {
        if a.name == "water" {
            std::cmp::Ordering::Less
        } else if b.name == "water" {
            std::cmp::Ordering::Greater
        } else {
            a.name.cmp(&b.name)
        }
    });

    println!(
        "[Sounds] 列出提示音: {} 个, 目录: {:?}",
        sounds.len(),
        sounds_dir
    );

    Ok(sounds)
}

/// 保存上传的提示音
#[tauri::command]
pub fn save_notification_sound(source_path: String, name: String) -> Result<SoundInfo, String> {
    let sounds_dir = get_notification_sounds_dir();

    // 确保目录存在
    fs::create_dir_all(&sounds_dir)
        .map_err(|e| format!("创建提示音目录失败: {}", e))?;

    // 生成目标文件名
    let filename = format!("{}.mp3", name);
    let target_path = sounds_dir.join(&filename);

    // 检查是否已存在
    if target_path.exists() {
        return Err(format!("提示音 '{}' 已存在", name));
    }

    // 复制文件
    fs::copy(&source_path, &target_path)
        .map_err(|e| format!("复制文件失败: {}", e))?;

    println!(
        "[Sounds] 保存提示音: {} -> {:?}",
        name, target_path
    );

    Ok(SoundInfo {
        name: name.clone(),
        filename,
        path: target_path.to_string_lossy().to_string(),
    })
}

/// 删除提示音
#[tauri::command]
pub fn delete_notification_sound(name: String) -> Result<(), String> {
    // 不允许删除默认提示音
    if name == "water" {
        return Err("不能删除默认提示音".to_string());
    }

    let sounds_dir = get_notification_sounds_dir();
    let filename = format!("{}.mp3", name);
    let file_path = sounds_dir.join(&filename);

    if !file_path.exists() {
        return Err(format!("提示音 '{}' 不存在", name));
    }

    fs::remove_file(&file_path)
        .map_err(|e| format!("删除文件失败: {}", e))?;

    println!("[Sounds] 删除提示音: {}", name);

    Ok(())
}

/// 获取提示音完整路径
#[tauri::command]
pub fn get_notification_sound_path(name: String) -> Result<String, String> {
    let sounds_dir = get_notification_sounds_dir();
    let filename = format!("{}.mp3", name);
    let file_path = sounds_dir.join(&filename);

    if !file_path.exists() {
        return Err(format!("提示音 '{}' 不存在", name));
    }

    Ok(file_path.to_string_lossy().to_string())
}

/// 确保提示音目录存在
#[tauri::command]
pub fn ensure_sounds_directory() -> Result<String, String> {
    let sounds_dir = get_notification_sounds_dir();

    fs::create_dir_all(&sounds_dir)
        .map_err(|e| format!("创建提示音目录失败: {}", e))?;

    println!("[Sounds] 提示音目录: {:?}", sounds_dir);

    Ok(sounds_dir.to_string_lossy().to_string())
}

