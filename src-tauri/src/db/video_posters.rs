//! 视频封面本地索引（`file_hash` -> 封面图本地路径）
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
//! ## 键为什么是 `file_hash` 而不是 URL
//!
//! 显示 URL 不是稳定标识：远程视频的 src 是 presigned URL 经回环反代改写来的，
//! 既带每次重签都变的 SigV4 参数（`X-Amz-Signature` / `X-Amz-Date`），又带每个会话
//! 可能变化的回环端口；本地视频的 src 还会随平台在 asset 协议与本地媒体服务器之间切换。
//! 拿它当键 = **每次都 miss**，正好复现要根治的那个 bug。`file_hash` 是这些 URL 背后
//! 唯一稳定的身份，也正是图片本地缓存用的那把键（「和图片的加载一样」）。

use rusqlite::{params, Connection};

use super::with_db;

// ============================================================================
// 只吃 `&Connection` 的核心实现（便于用内存库做单元测试，不依赖全局 DB）
// ============================================================================

/// 建表（幂等）。由 `db::init_database` 在建库时调用，schema 只此一处定义 ——
/// 单测也调它，避免"测试里的表"与"生产里的表"漂移。
pub fn create_table(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS video_posters (
            file_hash TEXT PRIMARY KEY,
            local_path TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )",
        [],
    )?;
    Ok(())
}

/// 按 `file_hash` 取封面本地路径；没有该行返回 `None`。
pub fn select_local_path(conn: &Connection, file_hash: &str) -> rusqlite::Result<Option<String>> {
    let mut stmt = conn.prepare("SELECT local_path FROM video_posters WHERE file_hash = ?")?;
    let mut rows = stmt.query([file_hash])?;
    match rows.next()? {
        Some(row) => Ok(Some(row.get(0)?)),
        None => Ok(None),
    }
}

/// 写入/覆盖一条封面索引（同 `file_hash` 重复写只保留一行，幂等）。
pub fn upsert(conn: &Connection, file_hash: &str, local_path: &str) -> rusqlite::Result<usize> {
    conn.execute(
        "INSERT OR REPLACE INTO video_posters (file_hash, local_path) VALUES (?, ?)",
        params![file_hash, local_path],
    )
}

/// 删除一条封面索引（封面文件已不在盘上时调用，让下次重新截帧）。
pub fn delete(conn: &Connection, file_hash: &str) -> rusqlite::Result<usize> {
    conn.execute(
        "DELETE FROM video_posters WHERE file_hash = ?",
        params![file_hash],
    )
}

// ============================================================================
// 走全局 DB 的对外 API（与 files.rs 同款包装）
// ============================================================================

/// 获取视频封面的本地路径（仅查库，不校验文件是否还在盘上）
pub fn get_video_poster(file_hash: &str) -> Result<Option<String>, String> {
    with_db!(db, { select_local_path(db, file_hash).map_err(|e| e.to_string()) })
}

/// 保存视频封面索引
pub fn save_video_poster(file_hash: &str, local_path: &str) -> Result<(), String> {
    with_db!(db, {
        upsert(db, file_hash, local_path).map_err(|e| e.to_string())?;
        Ok(())
    })
}

/// 删除视频封面索引
pub fn delete_video_poster(file_hash: &str) -> Result<(), String> {
    with_db!(db, {
        delete(db, file_hash).map_err(|e| e.to_string())?;
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
    fn missing_hash_reads_back_none() {
        let conn = mem_db();
        assert_eq!(select_local_path(&conn, "never-written").unwrap(), None);
    }

    #[test]
    fn writes_are_keyed_by_file_hash() {
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
