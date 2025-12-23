//! 消息操作模块
//!
//! 处理本地消息的增删改查，包括：
//! - `get_messages`: 分页获取会话消息（支持 before_seq 游标）
//! - `save_message`: 保存单条消息
//! - `save_messages`: 批量保存消息（使用事务）
//! - `mark_message_recalled`: 标记消息为已撤回
//! - `mark_message_deleted`: 标记消息为已删除（软删除）
//!
//! ## 消息排序
//!
//! 消息按 seq DESC 排序返回，seq=0 的消息（未同步）优先按 send_time 排序。
//! 前端使用 `flex-direction: column-reverse` 容器正确显示消息顺序。

use rusqlite::params;

use super::types::LocalMessage;
use super::{with_db, DB};

/// 获取会话的消息列表
pub fn get_messages(
    conversation_id: &str,
    limit: i64,
    before_seq: Option<i64>,
) -> Result<Vec<LocalMessage>, String> {
    with_db!(db, {
        // 排序逻辑：seq=0 的消息（未同步的新消息）排在最前面，按 send_time 排序
        // 其他消息按 seq DESC 排序
        let (query, params): (&str, Vec<Box<dyn rusqlite::ToSql>>) = match before_seq {
            Some(seq) => (
                "SELECT message_uuid, conversation_id, conversation_type, sender_id, 
                 sender_name, sender_avatar, content, content_type, file_uuid, file_url, 
                 file_size, file_hash, seq, reply_to, is_recalled, is_deleted, send_time, created_at
                 FROM messages 
                 WHERE conversation_id = ? AND is_deleted = 0 AND (seq < ? OR seq = 0)
                 ORDER BY CASE WHEN seq = 0 THEN 0 ELSE 1 END, 
                          CASE WHEN seq = 0 THEN send_time ELSE NULL END DESC,
                          seq DESC 
                 LIMIT ?",
                vec![
                    Box::new(conversation_id.to_string()),
                    Box::new(seq),
                    Box::new(limit),
                ],
            ),
            None => (
                "SELECT message_uuid, conversation_id, conversation_type, sender_id, 
                 sender_name, sender_avatar, content, content_type, file_uuid, file_url, 
                 file_size, file_hash, seq, reply_to, is_recalled, is_deleted, send_time, created_at
                 FROM messages 
                 WHERE conversation_id = ? AND is_deleted = 0
                 ORDER BY CASE WHEN seq = 0 THEN 0 ELSE 1 END, 
                          CASE WHEN seq = 0 THEN send_time ELSE NULL END DESC,
                          seq DESC 
                 LIMIT ?",
                vec![
                    Box::new(conversation_id.to_string()),
                    Box::new(limit),
                ],
            ),
        };

        let mut stmt = db.prepare(query).map_err(|e| e.to_string())?;

        let params_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();

        let rows = stmt
            .query_map(params_refs.as_slice(), |row| {
                Ok(LocalMessage {
                    message_uuid: row.get(0)?,
                    conversation_id: row.get(1)?,
                    conversation_type: row.get(2)?,
                    sender_id: row.get(3)?,
                    sender_name: row.get(4)?,
                    sender_avatar: row.get(5)?,
                    content: row.get(6)?,
                    content_type: row.get(7)?,
                    file_uuid: row.get(8)?,
                    file_url: row.get(9)?,
                    file_size: row.get(10)?,
                    file_hash: row.get(11)?,
                    seq: row.get(12)?,
                    reply_to: row.get(13)?,
                    is_recalled: row.get::<_, i64>(14)? != 0,
                    is_deleted: row.get::<_, i64>(15)? != 0,
                    send_time: row.get(16)?,
                    created_at: row.get(17)?,
                })
            })
            .map_err(|e| e.to_string())?;

        let mut messages: Vec<LocalMessage> = Vec::new();
        for row in rows {
            messages.push(row.map_err(|e| e.to_string())?);
        }

        // 保持倒序返回 [新→旧]，与群聊 API 一致
        // flex-direction: column-reverse 容器会正确显示为：旧(顶部) → 新(底部)

        Ok(messages)
    })
}

/// 保存消息
pub fn save_message(msg: LocalMessage) -> Result<(), String> {
    with_db!(db, {
        db.execute(
            "INSERT OR REPLACE INTO messages 
             (message_uuid, conversation_id, conversation_type, sender_id, sender_name, 
              sender_avatar, content, content_type, file_uuid, file_url, file_size, 
              file_hash, seq, reply_to, is_recalled, is_deleted, send_time)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                msg.message_uuid,
                msg.conversation_id,
                msg.conversation_type,
                msg.sender_id,
                msg.sender_name,
                msg.sender_avatar,
                msg.content,
                msg.content_type,
                msg.file_uuid,
                msg.file_url,
                msg.file_size,
                msg.file_hash,
                msg.seq,
                msg.reply_to,
                if msg.is_recalled { 1 } else { 0 },
                if msg.is_deleted { 1 } else { 0 },
                msg.send_time,
            ],
        )
        .map_err(|e| e.to_string())?;

        Ok(())
    })
}

/// 批量保存消息
pub fn save_messages(messages: Vec<LocalMessage>) -> Result<(), String> {
    let mut guard = DB.lock();
    let db = guard
        .as_mut()
        .ok_or_else(|| "数据库未初始化".to_string())?;

    let tx = db.transaction().map_err(|e| e.to_string())?;

    for msg in messages {
        tx.execute(
            "INSERT OR REPLACE INTO messages 
             (message_uuid, conversation_id, conversation_type, sender_id, sender_name, 
              sender_avatar, content, content_type, file_uuid, file_url, file_size, 
              file_hash, seq, reply_to, is_recalled, is_deleted, send_time)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                msg.message_uuid,
                msg.conversation_id,
                msg.conversation_type,
                msg.sender_id,
                msg.sender_name,
                msg.sender_avatar,
                msg.content,
                msg.content_type,
                msg.file_uuid,
                msg.file_url,
                msg.file_size,
                msg.file_hash,
                msg.seq,
                msg.reply_to,
                if msg.is_recalled { 1 } else { 0 },
                if msg.is_deleted { 1 } else { 0 },
                msg.send_time,
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;

    Ok(())
}

/// 标记消息为已撤回
pub fn mark_message_recalled(message_uuid: &str) -> Result<(), String> {
    with_db!(db, {
        db.execute(
            "UPDATE messages SET is_recalled = 1, content = '[消息已撤回]' WHERE message_uuid = ?",
            params![message_uuid],
        )
        .map_err(|e| e.to_string())?;

        Ok(())
    })
}

/// 标记消息为已删除
pub fn mark_message_deleted(message_uuid: &str) -> Result<(), String> {
    with_db!(db, {
        db.execute(
            "UPDATE messages SET is_deleted = 1 WHERE message_uuid = ?",
            params![message_uuid],
        )
        .map_err(|e| e.to_string())?;

        Ok(())
    })
}
