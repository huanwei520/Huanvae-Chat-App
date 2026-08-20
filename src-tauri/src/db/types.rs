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
    /// 本地已读位置（per 会话单调推进，仅 advance_conversation_read 维护）。
    /// 保存会话（server 同步）不携带此字段——故 serde default，save 路径不覆盖它。
    #[serde(default)]
    pub last_read_seq: i64,
    pub is_muted: bool,
    /// 本地置顶状态（纯本地 UI 状态，与服务端无关）。
    /// 保存路径（save_conversation）不携带此字段——故 serde default，仅 set_conversation_pinned 维护。
    #[serde(default)]
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
    /// 图片宽度（像素），仅图片类型消息有值
    pub image_width: Option<i32>,
    /// 图片高度（像素），仅图片类型消息有值
    pub image_height: Option<i32>,
    pub seq: i64,
    pub reply_to: Option<String>,
    /// 媒体组（相册）ID —— 组内各项共享同一值；非组内消息为 None。
    /// 必须本地持久化：消息列表是 DB-first 的，不存的话重启/切会话/离线加载后
    /// 相册会散成 N 条独立图片。
    pub media_group_id: Option<String>,
    /// 组内位次（0-based）；index=0 那条的 content 即整组 caption
    pub media_group_index: Option<i32>,
    /// 组的期望总数（2..10）；跨分页只加载到一部分时靠它预留占位
    pub media_group_count: Option<i32>,
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

/// 消息搜索过滤条件（全 None = 跨会话、不限类型的全局搜索）
///
/// `include_content_types` / `exclude_content_types` 收的是**原始 content_type 值**
/// （`text` / `image` / `video` / `file` / `system` / `meeting_invite` / `card` …），
/// 由前端按业务分类映射后下发——Rust 侧不认识"图片/文件"这类业务分类，
/// 因为 `messages.content_type` 是服务端 message_type 的原样透传、DB 无 CHECK 约束，
/// 未来新增类型不应要求改 Rust。
///
/// 两个方向都需要：
/// - 「图片 / 视频 / 文件」用 include（枚举已知类型）
/// - 「文字」用 exclude（= 非文件类，这样未来新增的未知类型仍归入文字，不会从四个分类里凭空消失）
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct MessageSearchFilter {
    /// 限定单个会话（None = 跨会话）
    pub conversation_id: Option<String>,
    /// 仅保留这些 content_type（None = 不限；Some(空) = 无任何命中）
    pub include_content_types: Option<Vec<String>>,
    /// 排除这些 content_type（None / Some(空) = 不排除）
    pub exclude_content_types: Option<Vec<String>>,
    /// 只看某个发送者在本会话内的消息（None = 不限）。
    ///
    /// 用途：群聊「按群成员查找」—— 单独看某个群员在本群说过什么。
    /// 与 content_type 过滤**正交**：可以「只看张三发的图片」。
    pub sender_id: Option<String>,
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
    /// 最新消息发送者 ID（群聊卡片预览前缀判「是不是我」用）
    pub msg_sender_id: Option<String>,
    /// 最新消息发送者昵称（群聊卡片预览前缀用；未带昵称的同步路径为 None）
    pub msg_sender_name: Option<String>,
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

/// 群成员本地已读位置行（对应 group_read_positions 表）
///
/// 群已读回执首帧初值 + 二开校准的本地持久化载体。`avatar_url` 存后端**原始**值
/// （相对路径 / 逻辑域名 URL），显示层经唯一收口点解析为回环反代 URL——不存已解析值，
/// 因反代端口跨应用重启会变，持久化解析后的回环 URL 会失效。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupReadPositionRow {
    pub group_id: String,
    pub user_id: String,
    pub last_read_seq: i64,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub last_read_at: Option<String>,
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
