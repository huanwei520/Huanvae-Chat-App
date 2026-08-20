//! 视频封面本地索引（`file_key` -> 封面图本地路径）
//!
//! ## 它解决什么
//!
//! 视频缩略图此前**没有任何封面产物**：每处都靠 `<video src="…#t=0.1" preload="metadata">`
//! 让引擎现拉元数据 + seek 出首帧。那一帧只活在该 `<video>` 元素里，元素一销毁就没了 ——
//! 于是每次挂载（切会话回来、进「查找记录 → 视频」、杀掉 App 重开）都要重来一遍，
//! 表现就是「先黑再显示」。本表把**截出来的那一帧**落盘并索引，之后走本地图片。
//!
//! ## 为什么另起一张表而不是塞进 `file_mappings`
//!
//! `file_mappings` 的主键就是 `file_hash`，而**同一个 `file_hash` 已经被视频文件本体占用**
//! （`file_hash -> 视频文件路径`）。封面是同一 `file_hash` 的**第二条**产物，塞不进去；
//! 拿 `poster:{hash}` 之类合成键硬塞会污染 `get_cached_file_path` 的语义
//! （它会把封面当成"视频文件已缓存"返回），且该表的 `source` 还有
//! `CHECK(source IN ('uploaded','downloaded'))` 约束，封面两者都不是。
//!
//! **但存储与失效策略与图片侧完全同款**：文件落在同一个缓存根
//! （`data/{user}_{server}/file/posters/`，与 `pictures/` 平级）、显示走同一条
//! asset 通道、读取时同样先查库再 `stat` 实际文件、文件不在就删映射回退到"未缓存"
//! （见 `crate::video_poster::get_video_poster_path`，与 `download::get_cached_file_path` 一一对应）。
//!
//! ## 键为什么不是 URL
//!
//! 显示 URL 不是稳定标识：远程视频的 src 是 presigned URL 经回环反代改写来的，
//! 既带每次重签都变的 SigV4 参数（`X-Amz-Signature` / `X-Amz-Date`），又带每个会话
//! 可能变化的回环端口；本地视频的 src 还会随平台在 asset 协议与本地媒体服务器之间切换。
//! 拿它当键 = **每次都 miss**，正好复现要根治的那个 bug。
//!
//! ## 🔴 2026-08-16：键从 `file_hash` 改名为 `file_key`（两层键）
//!
//! 后端接收面（好友历史 / 群历史 / WS 帧 / 增量同步）**已不再下发 `file_hash`**。
//! 而封面是**下载之前**就要出的产物 —— 一个只被滚过、从没播过的视频，本机永远算不出它的
//! 内容哈希（哈希只有下载完才能自算）。若继续拿哈希当键，这类视频**永远存不下封面、
//! 每次挂载都要重截**，正是本表要根治的那个 bug 原样复发。
//!
//! 所以键改成「**文件身份键**」，两个来源各自稳定唯一、键空间不相交：
//!
//! | 来源 | 键 |
//! |------|----|
//! | 消息面（气泡 / 相册 / 查找命中） | `file_uuid`（后端仍在下发，且下载前就有） |
//! | 个人文件面（`GET /api/storage/files`） | 服务端下发的 `file_hash`（该端点未改） |
//!
//! **只改列名，不动行**：`ALTER TABLE … RENAME COLUMN` 是纯元数据操作，
//! 老用户既有的哈希键封面行原样保留、继续对个人文件面命中（见 `create_table` 的迁移）。

use rusqlite::{params, Connection};

use super::with_db;

// ============================================================================
// 只吃 `&Connection` 的核心实现（便于用内存库做单元测试，不依赖全局 DB）
// ============================================================================

/// 建表（幂等）。由 `db::init_database` 在建库时调用，schema 只此一处定义 ——
/// 单测也调它，避免"测试里的表"与"生产里的表"漂移。
///
/// 含 `file_hash -> file_key` 的列改名迁移（见模块头）。改名是**纯元数据操作**，
/// 老用户既有的行原样保留 —— 那些行的键是内容哈希，而个人文件面至今仍以哈希为键，
/// 所以它们**继续命中**，不必重截。
pub fn create_table(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS video_posters (
            file_key TEXT PRIMARY KEY,
            local_path TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )",
        [],
    )?;
    // 老库上表已存在（键列还叫 file_hash），上面的 IF NOT EXISTS 是空操作 ⇒ 这里补改名。
    // 判据是 PRAGMA 列表里到底有没有那个列名，不是"试着 ALTER 一下看报不报错"。
    if has_column(conn, "file_hash")? {
        conn.execute(
            "ALTER TABLE video_posters RENAME COLUMN file_hash TO file_key",
            [],
        )?;
    }
    Ok(())
}

/// 表里有没有某个列（迁移判据）。
fn has_column(conn: &Connection, column: &str) -> rusqlite::Result<bool> {
    let mut stmt = conn.prepare("PRAGMA table_info(video_posters)")?;
    let mut rows = stmt.query([])?;
    while let Some(row) = rows.next()? {
        let name: String = row.get(1)?;
        if name == column {
            return Ok(true);
        }
    }
    Ok(false)
}

/// 按 `file_key` 取封面本地路径；没有该行返回 `None`。
pub fn select_local_path(conn: &Connection, file_key: &str) -> rusqlite::Result<Option<String>> {
    let mut stmt = conn.prepare("SELECT local_path FROM video_posters WHERE file_key = ?")?;
    let mut rows = stmt.query([file_key])?;
    match rows.next()? {
        Some(row) => Ok(Some(row.get(0)?)),
        None => Ok(None),
    }
}

/// 写入/覆盖一条封面索引（同 `file_key` 重复写只保留一行，幂等）。
pub fn upsert(conn: &Connection, file_key: &str, local_path: &str) -> rusqlite::Result<usize> {
    conn.execute(
        "INSERT OR REPLACE INTO video_posters (file_key, local_path) VALUES (?, ?)",
        params![file_key, local_path],
    )
}

/// 删除一条封面索引（封面文件已不在盘上时调用，让下次重新截帧）。
pub fn delete(conn: &Connection, file_key: &str) -> rusqlite::Result<usize> {
    conn.execute(
        "DELETE FROM video_posters WHERE file_key = ?",
        params![file_key],
    )
}

// ============================================================================
// 走全局 DB 的对外 API（与 files.rs 同款包装）
// ============================================================================

/// 获取视频封面的本地路径（仅查库，不校验文件是否还在盘上）
pub fn get_video_poster(file_key: &str) -> Result<Option<String>, String> {
    with_db!(db, { select_local_path(db, file_key).map_err(|e| e.to_string()) })
}

/// 保存视频封面索引
pub fn save_video_poster(file_key: &str, local_path: &str) -> Result<(), String> {
    with_db!(db, {
        upsert(db, file_key, local_path).map_err(|e| e.to_string())?;
        Ok(())
    })
}

/// 删除视频封面索引
pub fn delete_video_poster(file_key: &str) -> Result<(), String> {
    with_db!(db, {
        delete(db, file_key).map_err(|e| e.to_string())?;
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem_db() -> Connection {
        let conn = Connection::open_in_memory().expect("打开内存库失败");
        create_table(&conn).expect("建表失败");
        conn
    }

    fn count_rows(conn: &Connection) -> i64 {
        conn.query_row("SELECT COUNT(*) FROM video_posters", [], |r| r.get(0))
            .expect("count 失败")
    }

    #[test]
    fn missing_key_reads_back_none() {
        let conn = mem_db();
        assert_eq!(select_local_path(&conn, "never-written").unwrap(), None);
    }

    /// 键改名迁移：老库（键列还叫 `file_hash`）跑一次建表后，
    /// ① 列名变成 `file_key`；② **老行还在、还能按原键读出来**。
    /// 老行的键是内容哈希，而个人文件面至今仍以哈希为键 ⇒ 它们继续命中，不必重截。
    #[test]
    fn legacy_file_hash_column_is_renamed_and_rows_survive() {
        let conn = Connection::open_in_memory().expect("打开内存库失败");
        // 造一个"老库"：键列叫 file_hash
        conn.execute(
            "CREATE TABLE video_posters (
                file_hash TEXT PRIMARY KEY,
                local_path TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO video_posters (file_hash, local_path) VALUES ('legacy-hash', '/tmp/legacy.jpg')",
            [],
        )
        .unwrap();
        assert!(has_column(&conn, "file_hash").unwrap());

        create_table(&conn).expect("迁移失败");

        // ① 列名迁到 file_key（老列名不复存在）
        assert!(has_column(&conn, "file_key").unwrap());
        assert!(!has_column(&conn, "file_hash").unwrap());
        // ② 老行原样保留，按原键仍读得出
        assert_eq!(
            select_local_path(&conn, "legacy-hash").unwrap(),
            Some("/tmp/legacy.jpg".to_string())
        );
        // ③ 迁移幂等：再跑一次建表不报错、数据不变
        create_table(&conn).expect("重复迁移失败");
        assert_eq!(count_rows(&conn), 1);
    }

    /// `file_uuid` 形态的键（带连字符）能正常读写 —— 消息面用的就是它。
    #[test]
    fn uuid_shaped_keys_work() {
        let conn = mem_db();
        let uuid = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
        upsert(&conn, uuid, "/tmp/u.jpg").unwrap();
        assert_eq!(
            select_local_path(&conn, uuid).unwrap(),
            Some("/tmp/u.jpg".to_string())
        );
        // 负对照：改一个字符就读不到，排除"任何键都返回最后一行"
        assert_eq!(
            select_local_path(&conn, "3f2504e0-4f89-11d3-9a0c-0305e82c3302").unwrap(),
            None
        );
    }

    #[test]
    fn writes_are_keyed_by_file_key() {
        let conn = mem_db();
        upsert(&conn, "hash-a", "/tmp/a.jpg").unwrap();
        upsert(&conn, "hash-b", "/tmp/b.jpg").unwrap();

        // 键正确：各读各的，互不串台
        assert_eq!(
            select_local_path(&conn, "hash-a").unwrap(),
            Some("/tmp/a.jpg".to_string())
        );
        assert_eq!(
            select_local_path(&conn, "hash-b").unwrap(),
            Some("/tmp/b.jpg".to_string())
        );
        // 没写过的键仍是 None（排除"任何键都返回最后一行"这种假实现）
        assert_eq!(select_local_path(&conn, "hash-c").unwrap(), None);
    }

    #[test]
    fn upsert_is_idempotent_and_overwrites_path() {
        let conn = mem_db();
        upsert(&conn, "hash-a", "/tmp/old.jpg").unwrap();
        upsert(&conn, "hash-a", "/tmp/new.jpg").unwrap();

        // 幂等：同一 hash 写两次仍只有一行，取值是最后写入的那个
        assert_eq!(count_rows(&conn), 1);
        assert_eq!(
            select_local_path(&conn, "hash-a").unwrap(),
            Some("/tmp/new.jpg".to_string())
        );
    }

    #[test]
    fn delete_removes_only_the_target_row() {
        let conn = mem_db();
        upsert(&conn, "hash-a", "/tmp/a.jpg").unwrap();
        upsert(&conn, "hash-b", "/tmp/b.jpg").unwrap();

        assert_eq!(delete(&conn, "hash-a").unwrap(), 1);
        assert_eq!(select_local_path(&conn, "hash-a").unwrap(), None);
        // 只删目标行
        assert_eq!(
            select_local_path(&conn, "hash-b").unwrap(),
            Some("/tmp/b.jpg".to_string())
        );
        // 删不存在的行不报错、影响 0 行
        assert_eq!(delete(&conn, "hash-a").unwrap(), 0);
    }

    #[test]
    fn create_table_is_idempotent_and_keeps_data() {
        let conn = mem_db();
        upsert(&conn, "hash-a", "/tmp/a.jpg").unwrap();
        // 每次启动都会再调一次建表，不能把已有数据冲掉
        create_table(&conn).unwrap();
        assert_eq!(
            select_local_path(&conn, "hash-a").unwrap(),
            Some("/tmp/a.jpg".to_string())
        );
    }
}
