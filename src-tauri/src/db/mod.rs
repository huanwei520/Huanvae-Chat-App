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
//! - `video_posters`: 视频封面索引（hash->封面图 path，见该模块头「为什么另起一张表」）
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
pub mod group_read_positions;
pub mod messages;
pub mod nfc;
pub mod types;
pub mod video_posters;

// 重新导出类型和函数
pub use contacts::*;
pub use conversations::*;
pub use group_read_positions::*;
pub use files::{
    delete_file_mapping, get_file_hash_by_uuid, get_file_mapping, save_file_mapping,
    save_file_uuid_hash,
};
pub use messages::*;
pub use nfc::*;
pub use types::*;
pub use video_posters::{delete_video_poster, get_video_poster, save_video_poster};

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

    // 迁移：添加 last_read_seq 列（本地已读位置，旧数据库兼容；幂等，列已存在则忽略）
    conn.execute(
        "ALTER TABLE conversations ADD COLUMN last_read_seq INTEGER NOT NULL DEFAULT 0",
        [],
    )
    .ok();

    // 迁移：添加 peer_last_read_seq 列（单聊对方已读位置，已读回执首帧初值；幂等）。
    // 与 last_read_seq 同款：save_conversation 的 UPSERT 不列此列，故服务端同步不覆盖它，
    // 由 update_conversation_peer_read_seq 单调 MAX 维护。
    conn.execute(
        "ALTER TABLE conversations ADD COLUMN peer_last_read_seq INTEGER NOT NULL DEFAULT 0",
        [],
    )
    .ok();

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
            image_width INTEGER,
            image_height INTEGER,
            seq INTEGER NOT NULL,
            reply_to TEXT,
            media_group_id TEXT,
            media_group_index INTEGER,
            media_group_count INTEGER,
            is_recalled INTEGER NOT NULL DEFAULT 0,
            is_deleted INTEGER NOT NULL DEFAULT 0,
            send_time TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (conversation_id) REFERENCES conversations(id)
        )",
        [],
    )
    .map_err(|e| format!("创建 messages 表失败: {}", e))?;

    // 迁移：添加 image_width 和 image_height 列（旧数据库兼容）
    conn.execute("ALTER TABLE messages ADD COLUMN image_width INTEGER", [])
        .ok();
    conn.execute("ALTER TABLE messages ADD COLUMN image_height INTEGER", [])
        .ok();

    // 迁移：媒体组（相册）三件套（旧数据库兼容；列已存在时 ALTER 失败，.ok() 忽略）
    conn.execute("ALTER TABLE messages ADD COLUMN media_group_id TEXT", [])
        .ok();
    conn.execute("ALTER TABLE messages ADD COLUMN media_group_index INTEGER", [])
        .ok();
    conn.execute("ALTER TABLE messages ADD COLUMN media_group_count INTEGER", [])
        .ok();

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

    // 创建 FTS5 全文索引（搜索消息内容 + 文件名）
    // content='messages' 表示 FTS 表是 messages 表的"外部内容"视图，节省存储
    // tokenize='unicode61' 内置 unicode 分词器（中英文按字符切分）
    conn.execute(
        "CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
            content,
            content='messages',
            content_rowid='rowid',
            tokenize='unicode61'
        )",
        [],
    )
    .map_err(|e| format!("创建 messages_fts 失败: {}", e))?;

    // 同步 trigger：messages 表变更时维护 FTS
    conn.execute(
        "CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
            INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
        END",
        [],
    )
    .ok();

    conn.execute(
        "CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
            INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
        END",
        [],
    )
    .ok();

    conn.execute(
        "CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
            INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
            INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
        END",
        [],
    )
    .ok();

    // FTS 索引同步性校验 + 必要时强制 rebuild
    //
    // 背景：FTS5 external content 表的 trigger 是 IF NOT EXISTS 创建，但只能同步 trigger
    // 创建之后的 INSERT/UPDATE/DELETE。历史消息（trigger 创建前已存在）必须通过 backfill
    // 或 'rebuild' 命令灌入。
    //
    // 旧实现：检查 messages_fts COUNT=0 → INSERT...SELECT。但 trigger 同时在为新消息写 FTS，
    // 检查瞬间可能 COUNT > 0（仅含新消息），导致历史消息永远不被回灌。
    //
    // 新实现：对比 messages 与 messages_fts 的 COUNT。任一不一致 → 用 SQLite 官方推荐的
    // 'rebuild' 命令重建索引（external content FTS 的标准做法）。幂等且原子。
    let messages_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM messages", [], |row| row.get(0))
        .unwrap_or(0);
    let fts_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM messages_fts", [], |row| row.get(0))
        .unwrap_or(0);
    println!(
        "[DB] FTS 同步检查: messages={} messages_fts={}",
        messages_count, fts_count
    );
    if messages_count != fts_count {
        println!("[DB] FTS 索引不同步，执行 rebuild...");
        match conn.execute(
            "INSERT INTO messages_fts(messages_fts) VALUES('rebuild')",
            [],
        ) {
            Ok(_) => {
                let new_count: i64 = conn
                    .query_row("SELECT COUNT(*) FROM messages_fts", [], |row| row.get(0))
                    .unwrap_or(0);
                println!("[DB] FTS rebuild 完成，新 COUNT={}", new_count);
            }
            Err(e) => {
                eprintln!("[DB] FTS rebuild 失败（不阻塞启动）: {}", e);
            }
        }
    }

    // 创建文件映射表（hash -> 本地路径）
    conn.execute(
        "CREATE TABLE IF NOT EXISTS file_mappings (
            file_hash TEXT PRIMARY KEY,
            local_path TEXT NOT NULL,
            original_path TEXT,
            is_large_file INTEGER NOT NULL DEFAULT 0,
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

    // 迁移：添加 original_path 和 is_large_file 列（旧数据库兼容）
    conn.execute(
        "ALTER TABLE file_mappings ADD COLUMN original_path TEXT",
        [],
    )
    .ok();
    conn.execute(
        "ALTER TABLE file_mappings ADD COLUMN is_large_file INTEGER NOT NULL DEFAULT 0",
        [],
    )
    .ok();

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

    // 一次性迁移：把老库 messages.file_hash 里的（uuid -> hash）灌进 file_uuid_hash，然后删列。
    //
    // 🔴 顺序不能反。后端接收面 2026-08-16 起不再下发 file_hash，消息面改用两层键
    // （file_uuid 快路径 -> file_uuid_hash -> file_mappings）。老用户库里那一列存着**真实**
    // 的历史哈希 —— 不先灌过来就直接删，他们**已经下载好的文件会全部丢失命中、被重新下一遍**。
    // 灌完这一列就再无读者，留着就是误导性残留（本仓禁止），故同一步删掉。
    migrate_message_file_hash_into_uuid_map(&conn)?;

    // 创建视频封面索引表（file_hash -> 封面图本地路径，schema 定义在 video_posters 模块内，
    // 单测用同一个 create_table 建内存库，避免"测试里的表"与"生产里的表"漂移）
    video_posters::create_table(&conn)
        .map_err(|e| format!("创建 video_posters 表失败: {}", e))?;

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

    // 创建群成员已读位置表（群已读回执首帧初值 + 二开校准的本地持久化载体）。
    // avatar_url 存后端原始值，显示层经收口点解析（回环反代端口跨重启会变，不存已解析值）。
    conn.execute(
        "CREATE TABLE IF NOT EXISTS group_read_positions (
            group_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            last_read_seq INTEGER NOT NULL DEFAULT 0,
            display_name TEXT,
            avatar_url TEXT,
            last_read_at TEXT,
            PRIMARY KEY (group_id, user_id)
        )",
        [],
    )
    .map_err(|e| format!("创建 group_read_positions 表失败: {}", e))?;

    // 创建 NFC 信任卡表（联合主键防止 payload 改写后仍命中）
    conn.execute(
        "CREATE TABLE IF NOT EXISTS nfc_trusted_cards (
            uid TEXT NOT NULL,
            payload_hash TEXT NOT NULL,
            action_summary TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            PRIMARY KEY (uid, payload_hash)
        )",
        [],
    )
    .map_err(|e| format!("创建 nfc_trusted_cards 表失败: {}", e))?;

    *db_guard = Some(conn);
    println!("[DB] 数据库初始化完成");

    Ok(())
}

/// 一次性迁移（2026-08-16 两层键）：把老库 `messages.file_hash` 灌进 `file_uuid_hash`，然后删列。
///
/// ## 为什么必须先灌再删
///
/// 后端接收面已不再下发 `file_hash`，消息面改走两层键
/// （`file_uuid` → `file_uuid_hash` → `file_mappings`）。而**老用户库里那一列存的是真实的
/// 历史哈希**：不灌过来就直接删，他们**已经下载好的文件会全部丢失命中、被重新下一遍**。
/// 灌过来之后这一列再无读者，留着就是误导性残留，所以同一步删掉。
///
/// ## 幂等
///
/// 判据是列在不在（`PRAGMA table_info`），不是"试着 ALTER 一下看报不报错"。
/// 新库建表时就没有这一列 ⇒ 直接跳过；老库迁移一次后列没了 ⇒ 之后每次启动也跳过。
///
/// `INSERT OR IGNORE` 保证不覆盖 `file_uuid_hash` 里已有的行（上传路径写的那些更权威：
/// 那是本机自己算的）。
fn migrate_message_file_hash_into_uuid_map(conn: &Connection) -> Result<(), String> {
    if !table_has_column(conn, "messages", "file_hash")? {
        return Ok(());
    }

    let moved = conn
        .execute(
            "INSERT OR IGNORE INTO file_uuid_hash (file_uuid, file_hash)
             SELECT file_uuid, file_hash FROM messages
             WHERE file_uuid IS NOT NULL AND file_hash IS NOT NULL AND file_hash <> ''",
            [],
        )
        .map_err(|e| format!("迁移 messages.file_hash 到 file_uuid_hash 失败: {}", e))?;

    // 列上有索引时 SQLite 拒绝 DROP COLUMN，先把索引删掉
    conn.execute("DROP INDEX IF EXISTS idx_messages_file_hash", [])
        .map_err(|e| format!("删除 idx_messages_file_hash 失败: {}", e))?;
    conn.execute("ALTER TABLE messages DROP COLUMN file_hash", [])
        .map_err(|e| format!("删除 messages.file_hash 列失败: {}", e))?;

    println!("[DB] 两层键迁移完成：{} 条 uuid->hash 已并入 file_uuid_hash，messages.file_hash 已删除", moved);
    Ok(())
}

/// 表里有没有某个列（迁移判据）
fn table_has_column(conn: &Connection, table: &str, column: &str) -> Result<bool, String> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({})", table))
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let name: String = row.get(1).map_err(|e| e.to_string())?;
        if name == column {
            return Ok(true);
        }
    }
    Ok(false)
}

// ============================================================================
// 清理操作
// ============================================================================

/// 仅清空消息缓存
pub fn clear_messages() -> Result<(), String> {
    with_db!(db, {
        db.execute_batch("DELETE FROM messages;")
            .map_err(|e| e.to_string())?;

        println!("[DB] 已清空消息缓存");
        Ok(())
    })
}

/// 清空所有本地数据（登出时调用）
pub fn clear_all_data() -> Result<(), String> {
    with_db!(db, {
        db.execute_batch(
            "DELETE FROM messages;
             DELETE FROM conversations;
             DELETE FROM group_read_positions;
             DELETE FROM file_mappings;
             DELETE FROM file_uuid_hash;
             DELETE FROM video_posters;
             DELETE FROM avatars;
             DELETE FROM friends;
             DELETE FROM groups;
             DELETE FROM nfc_trusted_cards;",
        )
        .map_err(|e| e.to_string())?;

        println!("[DB] 已清空所有本地数据");
        Ok(())
    })
}