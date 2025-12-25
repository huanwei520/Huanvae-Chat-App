//! 本地数据库模块
//!
//! 使用 rusqlite 实现聊天记录、会话、文件映射的本地存储
//! 所有数据库操作都在 Rust 后端执行，前端通过 Tauri Commands 调用
//!
//! ## 模块结构
//!
//! - `types`: 数据类型定义（LocalConversation, LocalMessage, LocalFileMapping）
//! - `conversations`: 会话操作（增删改查、未读数管理）
//! - `messages`: 消息操作（增删改查、撤回、批量保存）
//! - `files`: 文件映射操作（hash->path 映射、uuid->hash 映射）
//!
//! ## 数据库路径
//!
//! 数据库按用户分隔存储：
//! ```text
//! data/{user_id}_{server}/chat/chat_data.db
//! ```
//!
//! ## 使用方式
//!
//! 前端通过 `src/db/index.ts` 调用 Tauri Commands，所有数据库操作
//! 在 Rust 后端线程安全地执行。
//!
//! ## 重构记录
//!
//! - 2024-12: 从单文件 `database.rs` 拆分为模块化结构

use once_cell::sync::Lazy;
use parking_lot::Mutex;
use rusqlite::Connection;
use std::path::PathBuf;

use crate::user_data;

// 子模块
pub mod contacts;
pub mod conversations;
pub mod files;
pub mod messages;
pub mod types;

// 重新导出类型和函数
pub use contacts::*;
pub use conversations::*;
pub use files::*;
pub use messages::*;
pub use types::*;

// ============================================================================
// 数据库连接管理
// ============================================================================

/// 全局数据库连接（线程安全）
pub static DB: Lazy<Mutex<Option<Connection>>> = Lazy::new(|| Mutex::new(None));

/// 获取数据库文件路径（使用当前用户上下文）
fn get_db_path() -> Result<PathBuf, String> {
    user_data::get_current_user_db_path()
}

/// 获取数据库连接的辅助宏
#[macro_export]
macro_rules! with_db {
    ($db:ident, $body:block) => {{
        let guard = $crate::db::DB.lock();
        let $db = guard
            .as_ref()
            .ok_or_else(|| "数据库未初始化".to_string())?;
        $body
    }};
}

// 在模块内部重新导出宏
pub use with_db;

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

    // 创建好友表
    conn.execute(
        "CREATE TABLE IF NOT EXISTS friends (
            friend_id TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            nickname TEXT,
            avatar_url TEXT,
            status TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )",
        [],
    )
    .map_err(|e| format!("创建 friends 表失败: {}", e))?;

    // 创建群组表
    conn.execute(
        "CREATE TABLE IF NOT EXISTS groups (
            group_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            avatar_url TEXT,
            owner_id TEXT NOT NULL,
            member_count INTEGER NOT NULL DEFAULT 0,
            my_role TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )",
        [],
    )
    .map_err(|e| format!("创建 groups 表失败: {}", e))?;

    *db_guard = Some(conn);
    println!("[DB] 数据库初始化完成");

    Ok(())
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
             DELETE FROM avatars;
             DELETE FROM friends;
             DELETE FROM groups;",
        )
        .map_err(|e| e.to_string())?;

        println!("[DB] 已清空所有本地数据");
        Ok(())
    })
}
