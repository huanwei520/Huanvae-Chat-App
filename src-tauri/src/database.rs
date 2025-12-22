//! 本地数据库模块
//!
//! 使用 rusqlite 实现聊天记录、会话、文件映射的本地存储
//! 所有数据库操作都在 Rust 后端执行，前端通过 Tauri Commands 调用
//!
//! 数据库路径按用户分隔：
//! data/{user_id}_{server}/chat/chat_data.db

use once_cell::sync::Lazy;
use parking_lot::Mutex;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::user_data;

// ============================================================================
// 数据库连接管理
// ============================================================================

/// 全局数据库连接（线程安全）
static DB: Lazy<Mutex<Option<Connection>>> = Lazy::new(|| Mutex::new(None));

/// 获取数据库文件路径（使用当前用户上下文）
fn get_db_path() -> Result<PathBuf, String> {
    user_data::get_current_user_db_path()
}

/// 初始化数据库连接并创建表
pub fn init_database() -> Result<(), String> {
    let mut db_guard = DB.lock();

    // 如果已有连接，先关闭（可能是切换用户）
    if db_guard.is_some() {
        println!("[DB] 关闭现有数据库连接");
        *db_guard = None;
    }

    let db_path = get_db_path()?;
    
    // 确保目录存在
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("创建数据库目录失败: {}", e))?;
    }
    
    println!("[DB] 初始化数据库: {:?}", db_path);

    let conn = Connection::open(&db_path).map_err(|e| format!("打开数据库失败: {}", e))?;

    // 启用外键约束
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|e| format!("启用外键失败: {}", e))?;

    // 创建会话表
    conn.execute(
        "CREATE TABLE IF NOT EXISTS conversations (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL CHECK(type IN ('friend', 'group')),
            name TEXT NOT NULL,
            avatar_url TEXT,
            last_message TEXT,
            last_message_time TEXT,
            last_seq INTEGER NOT NULL DEFAULT 0,
            unread_count INTEGER NOT NULL DEFAULT 0,
            is_muted INTEGER NOT NULL DEFAULT 0,
            is_pinned INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL,
            synced_at TEXT
        )",
        [],
    )
    .map_err(|e| format!("创建 conversations 表失败: {}", e))?;

    // 创建消息表
    conn.execute(
        "CREATE TABLE IF NOT EXISTS messages (
            message_uuid TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            conversation_type TEXT NOT NULL CHECK(conversation_type IN ('friend', 'group')),
            sender_id TEXT NOT NULL,
            sender_name TEXT,
            sender_avatar TEXT,
            content TEXT NOT NULL,
            content_type TEXT NOT NULL,
            file_uuid TEXT,
            file_url TEXT,
            file_size INTEGER,
            file_hash TEXT,
            seq INTEGER NOT NULL,
            reply_to TEXT,
            is_recalled INTEGER NOT NULL DEFAULT 0,
            is_deleted INTEGER NOT NULL DEFAULT 0,
            send_time TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (conversation_id) REFERENCES conversations(id)
        )",
        [],
    )
    .map_err(|e| format!("创建 messages 表失败: {}", e))?;

    // 创建消息索引
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_messages_conv_seq ON messages(conversation_id, seq)",
        [],
    )
    .ok();

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_messages_conv_time ON messages(conversation_id, send_time DESC)",
        [],
    )
    .ok();

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_messages_file_hash ON messages(file_hash)",
        [],
    )
    .ok();

    // 创建文件映射表（hash -> 本地路径）
    conn.execute(
        "CREATE TABLE IF NOT EXISTS file_mappings (
            file_hash TEXT PRIMARY KEY,
            local_path TEXT NOT NULL,
            file_size INTEGER NOT NULL,
            file_name TEXT NOT NULL,
            content_type TEXT NOT NULL,
            source TEXT NOT NULL CHECK(source IN ('uploaded', 'downloaded')),
            last_verified TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )",
        [],
    )
    .map_err(|e| format!("创建 file_mappings 表失败: {}", e))?;

    // 创建 file_uuid 到 file_hash 的映射表
    // 用于在服务器返回的消息没有 file_hash 时，通过 file_uuid 查找
    conn.execute(
        "CREATE TABLE IF NOT EXISTS file_uuid_hash (
            file_uuid TEXT PRIMARY KEY,
            file_hash TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )",
        [],
    )
    .map_err(|e| format!("创建 file_uuid_hash 表失败: {}", e))?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_file_uuid_hash ON file_uuid_hash(file_hash)",
        [],
    )
    .ok();

    // 创建头像缓存表
    conn.execute(
        "CREATE TABLE IF NOT EXISTS avatars (
            user_id TEXT PRIMARY KEY,
            avatar_url TEXT NOT NULL,
            local_path TEXT NOT NULL,
            etag TEXT,
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )",
        [],
    )
    .map_err(|e| format!("创建 avatars 表失败: {}", e))?;

    *db_guard = Some(conn);
    println!("[DB] 数据库初始化完成");

    Ok(())
}

/// 获取数据库连接的辅助宏
macro_rules! with_db {
    ($db:ident, $body:block) => {{
        let guard = DB.lock();
        let $db = guard
            .as_ref()
            .ok_or_else(|| "数据库未初始化".to_string())?;
        $body
    }};
}

// ============================================================================
// 类型定义
// ============================================================================

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
    pub seq: i64,
    pub reply_to: Option<String>,
    pub is_recalled: bool,
    pub is_deleted: bool,
    pub send_time: String,
    pub created_at: Option<String>,
}

/// 本地文件映射
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalFileMapping {
    pub file_hash: String,
    pub local_path: String,
    pub file_size: i64,
    pub file_name: String,
    pub content_type: String,
    pub source: String,
    pub last_verified: String,
    pub created_at: Option<String>,
}

// ============================================================================
// 会话操作
// ============================================================================

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

// ============================================================================
// 消息操作
// ============================================================================

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

// ============================================================================
// 文件映射操作
// ============================================================================

/// 获取文件的本地映射
pub fn get_file_mapping(file_hash: &str) -> Result<Option<LocalFileMapping>, String> {
    with_db!(db, {
        let mut stmt = db
            .prepare(
                "SELECT file_hash, local_path, file_size, file_name, content_type, source, 
                 last_verified, created_at FROM file_mappings WHERE file_hash = ?",
            )
            .map_err(|e| e.to_string())?;

        let result = stmt
            .query_row([file_hash], |row| {
                Ok(LocalFileMapping {
                    file_hash: row.get(0)?,
                    local_path: row.get(1)?,
                    file_size: row.get(2)?,
                    file_name: row.get(3)?,
                    content_type: row.get(4)?,
                    source: row.get(5)?,
                    last_verified: row.get(6)?,
                    created_at: row.get(7)?,
                })
            })
            .ok();

        Ok(result)
    })
}

/// 保存文件映射
pub fn save_file_mapping(mapping: LocalFileMapping) -> Result<(), String> {
    with_db!(db, {
        db.execute(
            "INSERT OR REPLACE INTO file_mappings 
             (file_hash, local_path, file_size, file_name, content_type, source, last_verified)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
            params![
                mapping.file_hash,
                mapping.local_path,
                mapping.file_size,
                mapping.file_name,
                mapping.content_type,
                mapping.source,
                mapping.last_verified,
            ],
        )
        .map_err(|e| e.to_string())?;

        Ok(())
    })
}

/// 删除文件映射
pub fn delete_file_mapping(file_hash: &str) -> Result<(), String> {
    with_db!(db, {
        db.execute(
            "DELETE FROM file_mappings WHERE file_hash = ?",
            params![file_hash],
        )
        .map_err(|e| e.to_string())?;

        Ok(())
    })
}

/// 更新文件最后验证时间
pub fn update_file_mapping_verified(file_hash: &str) -> Result<(), String> {
    with_db!(db, {
        db.execute(
            "UPDATE file_mappings SET last_verified = datetime('now') WHERE file_hash = ?",
            params![file_hash],
        )
        .map_err(|e| e.to_string())?;

        Ok(())
    })
}

// ============================================================================
// file_uuid 到 file_hash 映射操作
// ============================================================================

/// 保存 file_uuid 到 file_hash 的映射
pub fn save_file_uuid_hash(file_uuid: &str, file_hash: &str) -> Result<(), String> {
    with_db!(db, {
        db.execute(
            "INSERT OR REPLACE INTO file_uuid_hash (file_uuid, file_hash) VALUES (?, ?)",
            params![file_uuid, file_hash],
        )
        .map_err(|e| e.to_string())?;

        Ok(())
    })
}

/// 通过 file_uuid 获取 file_hash
pub fn get_file_hash_by_uuid(file_uuid: &str) -> Result<Option<String>, String> {
    with_db!(db, {
        let mut stmt = db
            .prepare("SELECT file_hash FROM file_uuid_hash WHERE file_uuid = ?")
            .map_err(|e| e.to_string())?;

        let result = stmt
            .query_row([file_uuid], |row| row.get(0))
            .ok();

        Ok(result)
    })
}

// ============================================================================
// 清理操作
// ============================================================================

/// 清空所有本地数据（登出时调用）
pub fn clear_all_data() -> Result<(), String> {
    with_db!(db, {
        db.execute_batch(
            "DELETE FROM messages;
             DELETE FROM conversations;
             DELETE FROM file_mappings;
             DELETE FROM file_uuid_hash;
             DELETE FROM avatars;",
        )
        .map_err(|e| e.to_string())?;

        println!("[DB] 已清空所有本地数据");
        Ok(())
    })
}

