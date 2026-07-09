//! 群成员已读位置本地持久化模块
//!
//! 群已读回执从"进群独立首拉快照"重构为"消息同步管线一等公民"：已读位置随会话消息一起
//! 本地持久化，进群首帧即从本地读出（消除两阶段弹入），同步快照到达再单调校准。
//!
//! - `get_group_read_positions`: 读某群全部成员的本地已读位置（首帧初值 + 二开校准）
//! - `upsert_group_read_positions`: upsert（last_read_seq 单调 MAX；身份/时间 COALESCE 保留非空旧值）
//! - `replace_group_read_positions`: 用**全量权威快照**对齐成员集（删退群幽灵 + upsert 快照成员）
//!
//! `avatar_url` 存后端原始值，前端显示时经唯一收口点解析（见 types::GroupReadPositionRow 注释）。

use rusqlite::params;

use super::types::GroupReadPositionRow;
use super::with_db;

/// 读某群全部成员的本地已读位置
pub fn get_group_read_positions(group_id: &str) -> Result<Vec<GroupReadPositionRow>, String> {
    with_db!(db, {
        let mut stmt = db
            .prepare(
                "SELECT group_id, user_id, last_read_seq, display_name, avatar_url, last_read_at
                 FROM group_read_positions WHERE group_id = ?",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([group_id], |row| {
                Ok(GroupReadPositionRow {
                    group_id: row.get(0)?,
                    user_id: row.get(1)?,
                    last_read_seq: row.get(2)?,
                    display_name: row.get(3)?,
                    avatar_url: row.get(4)?,
                    last_read_at: row.get(5)?,
                })
            })
            .map_err(|e| e.to_string())?;

        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
        Ok(out)
    })
}

/// upsert 群成员已读位置。
///
/// - `last_read_seq`：单调 MAX（只升不降，不把已推进的位置打回）。
/// - `display_name` / `avatar_url` / `last_read_at`：`COALESCE(excluded.x, x)` —— 快照行携带完整
///   身份，WS 单读者行仅带 seq（其余传 null），COALESCE 让 null 保留旧身份、不清空。
pub fn upsert_group_read_positions(
    group_id: &str,
    rows: Vec<GroupReadPositionRow>,
) -> Result<(), String> {
    with_db!(db, {
        for r in &rows {
            upsert_one(db, group_id, r)?;
        }
        Ok(())
    })
}

/// 用**全量权威快照**对齐某群成员集：删除快照里不再出现的成员（退群幽灵），再 upsert 快照成员。
///
/// 仅"进入会话的 sync 快照"这类**全量活跃成员**权威快照调用（member_count = positions 长度）；
/// WS 单读者推进 / 陌生读者去抖补拉用 `upsert_group_read_positions`（只补不删，避免与刚到的
/// WS 新读者竞态误删）。空 rows 不删（避免把本地已有数据误清；空通常意味当前用户非该群成员）。
pub fn replace_group_read_positions(
    group_id: &str,
    rows: Vec<GroupReadPositionRow>,
) -> Result<(), String> {
    with_db!(db, {
        if !rows.is_empty() {
            db.execute(
                "DELETE FROM group_read_positions WHERE group_id = ?",
                params![group_id],
            )
            .map_err(|e| e.to_string())?;
            for r in &rows {
                upsert_one(db, group_id, r)?;
            }
        }
        Ok(())
    })
}

/// 单行 upsert（last_read_seq 单调 MAX；身份/时间 COALESCE 保留非空旧值）。
fn upsert_one(
    db: &rusqlite::Connection,
    group_id: &str,
    r: &GroupReadPositionRow,
) -> Result<(), String> {
    db.execute(
        "INSERT INTO group_read_positions
         (group_id, user_id, last_read_seq, display_name, avatar_url, last_read_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(group_id, user_id) DO UPDATE SET
             last_read_seq = MAX(last_read_seq, excluded.last_read_seq),
             display_name = COALESCE(excluded.display_name, display_name),
             avatar_url = COALESCE(excluded.avatar_url, avatar_url),
             last_read_at = COALESCE(excluded.last_read_at, last_read_at)",
        params![
            group_id,
            r.user_id,
            r.last_read_seq,
            r.display_name,
            r.avatar_url,
            r.last_read_at,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
