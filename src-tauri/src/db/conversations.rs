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
                 last_seq, unread_count, is_muted, is_pinned, updated_at, synced_at, last_read_seq
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
                    last_read_seq: row.get(12)?,
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
                 last_seq, unread_count, is_muted, is_pinned, updated_at, synced_at, last_read_seq
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
                    last_read_seq: row.get(12)?,
                })
            })
            .ok();

        Ok(result)
    })
}

/// 保存或更新会话
///
/// 用 UPSERT（ON CONFLICT DO UPDATE）而非 INSERT OR REPLACE：① REPLACE 会删行重插，
/// 与 messages 的外键冲突、且会把本地 last_read_seq 清回默认值；② 本函数承载的是
/// 服务端同步字段，**不触碰 last_read_seq**（该列由 advance_conversation_read 单独维护），
/// 故同步会话列表不会覆盖本地已读位置。首次插入时 last_read_seq 走列默认 0。
pub fn save_conversation(conv: LocalConversation) -> Result<(), String> {
    with_db!(db, {
        db.execute(
            "INSERT INTO conversations
             (id, type, name, avatar_url, last_message, last_message_time, last_seq,
              unread_count, is_muted, is_pinned, updated_at, synced_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
             ON CONFLICT(id) DO UPDATE SET
                 type = excluded.type,
                 name = excluded.name,
                 avatar_url = excluded.avatar_url,
                 last_message = excluded.last_message,
                 last_message_time = excluded.last_message_time,
                 last_seq = excluded.last_seq,
                 unread_count = excluded.unread_count,
                 is_muted = excluded.is_muted,
                 is_pinned = excluded.is_pinned,
                 updated_at = excluded.updated_at,
                 synced_at = excluded.synced_at",
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

/// 推进会话本地已读位置（last_read_seq 单调只升）。
///
/// - `seq = None`：推进到当前已收最新（last_read_seq = MAX(last_read_seq, last_seq)），
///   即"用户正读着这个会话"的语义。
/// - `seq = Some(s)`：显式读位（收到消息当帧标读 / 多端 read_sync 自读），
///   last_read_seq = MAX(last_read_seq, s)。不取 MAX(last_seq)、也不抬 last_seq：
///   read_sync 的 s 来自别端，本端可能持有别端没读过的更新消息（不能凭空标到本地最新）；
///   last_seq 是增量同步游标，凭空抬高会让 sync 跳过本地未收到的消息。
///
/// 重连时由前端读出并经 resync_read_positions 回传服务端 GREATEST 合并，
/// 修复抖断丢失的 mark_read。
pub fn advance_conversation_read(id: &str, seq: Option<i64>) -> Result<(), String> {
    with_db!(db, {
        match seq {
            Some(seq) => db
                .execute(
                    "UPDATE conversations SET last_read_seq = MAX(last_read_seq, ?1) WHERE id = ?2",
                    params![seq, id],
                )
                .map_err(|e| e.to_string())?,
            None => db
                .execute(
                    "UPDATE conversations SET last_read_seq = MAX(last_read_seq, last_seq) WHERE id = ?",
                    params![id],
                )
                .map_err(|e| e.to_string())?,
        };

        Ok(())
    })
}

/// 读取会话对方已读位置（peer_last_read_seq；无记录/列缺省返回 0）。
///
/// 单聊已读回执首帧初值：进入会话时读出，配合 WS read_sync 增量推进，判定"我发的消息对方是否已读"。
pub fn get_conversation_peer_read_seq(id: &str) -> Result<i64, String> {
    with_db!(db, {
        let seq: i64 = db
            .query_row(
                "SELECT peer_last_read_seq FROM conversations WHERE id = ?",
                params![id],
                |row| row.get(0),
            )
            .unwrap_or(0);
        Ok(seq)
    })
}

/// 单调推进会话对方已读位置（peer_last_read_seq = MAX(peer_last_read_seq, ?)）。
///
/// 同步快照 / WS read_sync（reader = 对方）到达时写穿，只升不降。会话不存在时无行更新（no-op）。
pub fn update_conversation_peer_read_seq(id: &str, seq: i64) -> Result<(), String> {
    with_db!(db, {
        db.execute(
            "UPDATE conversations SET peer_last_read_seq = MAX(peer_last_read_seq, ?1) WHERE id = ?2",
            params![seq, id],
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
