//! NFC 信任卡操作
//!
//! 持久化"用户已信任的 NFC 卡 + payload"标记。联合主键 (uid, payload_hash):
//! - 同一张卡 NDEF 内容改写后 payload_hash 变 → 新记录 → 再次扫到要求重新确认
//! - 信任仅作"本地曾确认"标记，不防 UID 仿冒（Magic Card 可克隆 UID）

use super::types::TrustedNfcCard;
use super::with_db;
use rusqlite::params;

/// 查询 (uid, payload_hash) 是否已信任
pub fn nfc_is_trusted(uid: &str, payload_hash: &str) -> Result<bool, String> {
    with_db!(db, {
        let count: i64 = db
            .query_row(
                "SELECT COUNT(*) FROM nfc_trusted_cards WHERE uid = ?1 AND payload_hash = ?2",
                params![uid, payload_hash],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        Ok(count > 0)
    })
}

/// 添加信任记录（已存在则覆盖 action_summary 与 created_at）
pub fn nfc_add_trusted(
    uid: &str,
    payload_hash: &str,
    action_summary: &str,
    created_at: i64,
) -> Result<(), String> {
    with_db!(db, {
        db.execute(
            "INSERT OR REPLACE INTO nfc_trusted_cards
             (uid, payload_hash, action_summary, created_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![uid, payload_hash, action_summary, created_at],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

/// 列出所有信任记录（按 created_at 倒序）
pub fn nfc_list_trusted() -> Result<Vec<TrustedNfcCard>, String> {
    with_db!(db, {
        let mut stmt = db
            .prepare(
                "SELECT uid, payload_hash, action_summary, created_at
                 FROM nfc_trusted_cards
                 ORDER BY created_at DESC",
            )
            .map_err(|e| e.to_string())?;

        let cards = stmt
            .query_map([], |row| {
                Ok(TrustedNfcCard {
                    uid: row.get(0)?,
                    payload_hash: row.get(1)?,
                    action_summary: row.get(2)?,
                    created_at: row.get(3)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        Ok(cards)
    })
}

/// 移除指定 (uid, payload_hash) 信任记录
pub fn nfc_remove_trusted(uid: &str, payload_hash: &str) -> Result<(), String> {
    with_db!(db, {
        db.execute(
            "DELETE FROM nfc_trusted_cards WHERE uid = ?1 AND payload_hash = ?2",
            params![uid, payload_hash],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}
