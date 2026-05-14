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

/// 消息搜索结果（含会话上下文 + 前后相邻消息预览）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchMessageResult {
    /// 命中消息本体
    pub message: LocalMessage,
    /// 会话名（来自 conversations 表）
    pub conversation_name: String,
    /// 会话头像
    pub conversation_avatar: Option<String>,
    /// 前一条消息内容（按 seq 相邻），无则 None
    pub context_before: Option<String>,
    /// 后一条消息内容
    pub context_after: Option<String>,
}

/// 会话预览（JOIN messages 表的最新消息）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationPreview {
    pub id: String,
    #[serde(rename = "type")]
    pub conv_type: String,
    pub name: String,
    pub avatar_url: Option<String>,
    pub last_seq: i64,
    pub unread_count: i64,
    pub is_muted: bool,
    pub is_pinned: bool,
    pub updated_at: String,
    /// 最新消息内容（来自 messages 表 JOIN）
    pub msg_content: Option<String>,
    /// 最新消息类型（text/image/video/file）
    pub msg_content_type: Option<String>,
    /// 最新消息时间
    pub msg_send_time: Option<String>,
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

/// 已信任的 NFC 卡记录
///
/// 联合主键 (uid, payload_hash):
/// - 同一张卡被改写 NDEF 内容后，payload_hash 变化 → 新记录
/// - 信任仅作"本地曾确认"标记，不防 UID 仿冒（Magic Card 可克隆 UID）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrustedNfcCard {
    pub uid: String,
    pub payload_hash: String,
    pub action_summary: String,
    pub created_at: i64,
}
