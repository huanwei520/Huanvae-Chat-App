//! 会话操作模块
//!
//! 处理本地会话的增删改查，包括：
//! - `get_conversations`: 获取所有会话列表（按置顶和更新时间排序）
//! - `get_conversation`: 获取单个会话详情
//! - `save_conversation`: 保存或更新会话
//! - `update_conversation_last_seq`: 更新会话的最后同步序列号
//! - `update_conversation_unread`: 更新会话未读数
//! - `clear_conversation_unread`: 清零会话未读数

use rusqlite::params;

use super::types::{ConversationPreview, LocalConversation};
use super::with_db;

/// 获取所有会话列表
pub fn get_conversations() -> Result<Vec<LocalConversation>, String> {
    with_db!(db, {
        let mut stmt = db
            .prepare(
                "SELECT id, type, name, avatar_url, last_message, last_message_time, 
                 last_seq, unread_count, is_muted, is_pinned, updated_at, synced_at
                 FROM conversations ORDER BY is_pinned DESC, updated_at DESC",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |row| {
                Ok(LocalConversation {
                    id: row.get(0)?,
                    conv_type: row.get(1)?,
                    name: row.get(2)?,
                    avatar_url: row.get(3)?,
                    last_message: row.get(4)?,
                    last_message_time: row.get(5)?,
                    last_seq: row.get(6)?,
                    unread_count: row.get(7)?,
                    is_muted: row.get::<_, i64>(8)? != 0,
                    is_pinned: row.get::<_, i64>(9)? != 0,
                    updated_at: row.get(10)?,
                    synced_at: row.get(11)?,
                })
            })
            .map_err(|e| e.to_string())?;

        let mut conversations = Vec::new();
        for row in rows {
            conversations.push(row.map_err(|e| e.to_string())?);
        }

        Ok(conversations)
    })
}

/// 获取单个会话
pub fn get_conversation(id: &str) -> Result<Option<LocalConversation>, String> {
    with_db!(db, {
        let mut stmt = db
            .prepare(
                "SELECT id, type, name, avatar_url, last_message, last_message_time, 
                 last_seq, unread_count, is_muted, is_pinned, updated_at, synced_at
                 FROM conversations WHERE id = ?",
            )
            .map_err(|e| e.to_string())?;

        let result = stmt
            .query_row([id], |row| {
                Ok(LocalConversation {
                    id: row.get(0)?,
                    conv_type: row.get(1)?,
                    name: row.get(2)?,
                    avatar_url: row.get(3)?,
                    last_message: row.get(4)?,
                    last_message_time: row.get(5)?,
                    last_seq: row.get(6)?,
                    unread_count: row.get(7)?,
                    is_muted: row.get::<_, i64>(8)? != 0,
                    is_pinned: row.get::<_, i64>(9)? != 0,
                    updated_at: row.get(10)?,
                    synced_at: row.get(11)?,
                })
            })
            .ok();

        Ok(result)
    })
}

/// 保存或更新会话
pub fn save_conversation(conv: LocalConversation) -> Result<(), String> {
    with_db!(db, {
        db.execute(
            "INSERT OR REPLACE INTO conversations 
             (id, type, name, avatar_url, last_message, last_message_time, last_seq, 
              unread_count, is_muted, is_pinned, updated_at, synced_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
            params![
                conv.id,
                conv.conv_type,
                conv.name,
                conv.avatar_url,
                conv.last_message,
                conv.last_message_time,
                conv.last_seq,
                conv.unread_count,
                if conv.is_muted { 1 } else { 0 },
                if conv.is_pinned { 1 } else { 0 },
                conv.updated_at,
            ],
        )
        .map_err(|e| e.to_string())?;

        Ok(())
    })
}

/// 更新会话的最后序列号
pub fn update_conversation_last_seq(id: &str, last_seq: i64) -> Result<(), String> {
    with_db!(db, {
        db.execute(
            "UPDATE conversations SET last_seq = ?, synced_at = datetime('now') WHERE id = ?",
            params![last_seq, id],
        )
        .map_err(|e| e.to_string())?;

        Ok(())
    })
}

/// 更新会话未读数
pub fn update_conversation_unread(id: &str, unread_count: i64) -> Result<(), String> {
    with_db!(db, {
        db.execute(
            "UPDATE conversations SET unread_count = ? WHERE id = ?",
            params![unread_count, id],
        )
        .map_err(|e| e.to_string())?;

        Ok(())
    })
}

/// 清零会话未读数
pub fn clear_conversation_unread(id: &str) -> Result<(), String> {
    with_db!(db, {
        db.execute(
            "UPDATE conversations SET unread_count = 0 WHERE id = ?",
            params![id],
        )
        .map_err(|e| e.to_string())?;

        Ok(())
    })
}

/// 获取所有会话及其最新消息预览（通过 JOIN messages 表）
///
/// 一次 SQL 查询完成，避免 N+1 查询问题
pub fn get_conversation_previews() -> Result<Vec<ConversationPreview>, String> {
    with_db!(db, {
        let mut stmt = db
            .prepare(
                // 撤回消息保留为预览（content 在 mark_message_recalled 时已被替换为
                // '[消息已撤回]'），保留其 send_time 让会话卡片留在原排序位置 ——
                // 与 WeChat / Telegram / WhatsApp 行为一致：撤回是一次"最新交互"，
                // 不应让卡片掉回到撤回前一条消息的旧时间。仅排除真正软删的消息。
                "SELECT c.id, c.type, c.name, c.avatar_url,
                        c.last_seq, c.unread_count, c.is_muted, c.is_pinned, c.updated_at,
                        m.content, m.content_type, m.send_time
                 FROM conversations c
                 LEFT JOIN messages m ON m.message_uuid = (
                     SELECT message_uuid FROM messages
                     WHERE conversation_id = c.id AND is_deleted = 0
                     ORDER BY send_time DESC, seq DESC
                     LIMIT 1
                 )
                 ORDER BY c.is_pinned DESC, c.updated_at DESC",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |row| {
                Ok(ConversationPreview {
                    id: row.get(0)?,
                    conv_type: row.get(1)?,
                    name: row.get(2)?,
                    avatar_url: row.get(3)?,
                    last_seq: row.get(4)?,
                    unread_count: row.get(5)?,
                    is_muted: row.get::<_, i64>(6)? != 0,
                    is_pinned: row.get::<_, i64>(7)? != 0,
                    updated_at: row.get(8)?,
                    msg_content: row.get(9)?,
                    msg_content_type: row.get(10)?,
                    msg_send_time: row.get(11)?,
                })
            })
            .map_err(|e| e.to_string())?;

        let mut previews = Vec::new();
        for row in rows {
            previews.push(row.map_err(|e| e.to_string())?);
        }

        Ok(previews)
    })
}

/// 更新会话的最后消息预览
pub fn update_conversation_last_message(
    id: &str,
    last_message: &str,
    last_message_time: &str,
) -> Result<(), String> {
    with_db!(db, {
        db.execute(
            "UPDATE conversations SET last_message = ?, last_message_time = ?, updated_at = datetime('now') WHERE id = ?",
            params![last_message, last_message_time, id],
        )
        .map_err(|e| e.to_string())?;

        Ok(())
    })
}
