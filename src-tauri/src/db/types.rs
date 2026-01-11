//! 数据库类型定义
//!
//! 定义本地存储使用的数据结构，包括：
//! - `LocalConversation`: 本地会话记录
//! - `LocalMessage`: 本地消息记录
//! - `LocalFileMapping`: 本地文件映射（hash -> 本地路径）
//!
//! 所有类型都实现了 Serialize/Deserialize，可通过 Tauri Commands 传输

use serde::{Deserialize, Serialize};

/// 本地会话记录
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalConversation {
    pub id: String,
    #[serde(rename = "type")]
    pub conv_type: String,
    pub name: String,
    pub avatar_url: Option<String>,
    pub last_message: Option<String>,
    pub last_message_time: Option<String>,
    pub last_seq: i64,
    pub unread_count: i64,
    pub is_muted: bool,
    pub is_pinned: bool,
    pub updated_at: String,
    pub synced_at: Option<String>,
}

/// 本地消息记录
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalMessage {
    pub message_uuid: String,
    pub conversation_id: String,
    pub conversation_type: String,
    pub sender_id: String,
    pub sender_name: Option<String>,
    pub sender_avatar: Option<String>,
    pub content: String,
    pub content_type: String,
    pub file_uuid: Option<String>,
    pub file_url: Option<String>,
    pub file_size: Option<i64>,
    pub file_hash: Option<String>,
    /// 图片宽度（像素），仅图片类型消息有值
    pub image_width: Option<i32>,
    /// 图片高度（像素），仅图片类型消息有值
    pub image_height: Option<i32>,
    pub seq: i64,
    pub reply_to: Option<String>,
    pub is_recalled: bool,
    pub is_deleted: bool,
    pub send_time: String,
    pub created_at: Option<String>,
}

/// 本地文件映射
///
/// 支持两种缓存模式：
/// 1. 小文件（<100MB）：复制到缓存目录，使用 `local_path`
/// 2. 大文件（≥100MB）：不复制，记录原始路径 `original_path`
///
/// 读取时优先使用 `local_path`，若不存在则尝试 `original_path`
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalFileMapping {
    pub file_hash: String,
    /// 缓存路径（小文件复制后的路径，或大文件下载后的路径）
    pub local_path: String,
    /// 原始路径（大文件不复制时记录，用于本地优先读取）
    pub original_path: Option<String>,
    /// 是否为大文件（≥100MB，不复制到缓存目录）
    pub is_large_file: bool,
    pub file_size: i64,
    pub file_name: String,
    pub content_type: String,
    pub source: String,
    pub last_verified: String,
    pub created_at: Option<String>,
}

/// 本地好友记录
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalFriend {
    pub friend_id: String,
    pub username: String,
    pub nickname: Option<String>,
    pub avatar_url: Option<String>,
    pub status: Option<String>,
    pub created_at: String,
    pub updated_at: Option<String>,
}

/// 本地群组记录
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalGroup {
    pub group_id: String,
    pub name: String,
    pub avatar_url: Option<String>,
    pub owner_id: String,
    pub member_count: i64,
    pub my_role: Option<String>,
    pub created_at: String,
    pub updated_at: Option<String>,
}
