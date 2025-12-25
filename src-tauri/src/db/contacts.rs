//! 好友和群组操作
//!
//! 实现好友和群组的本地存储操作

use super::types::{LocalFriend, LocalGroup};
use super::with_db;
use rusqlite::params;

// ============================================================================
// 好友操作
// ============================================================================

/// 获取所有好友
pub fn get_friends() -> Result<Vec<LocalFriend>, String> {
    with_db!(db, {
        let mut stmt = db
            .prepare(
                "SELECT friend_id, username, nickname, avatar_url, status, created_at, updated_at
                 FROM friends
                 ORDER BY updated_at DESC",
            )
            .map_err(|e| e.to_string())?;

        let friends = stmt
            .query_map([], |row| {
                Ok(LocalFriend {
                    friend_id: row.get(0)?,
                    username: row.get(1)?,
                    nickname: row.get(2)?,
                    avatar_url: row.get(3)?,
                    status: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        Ok(friends)
    })
}

/// 保存单个好友
pub fn save_friend(friend: &LocalFriend) -> Result<(), String> {
    with_db!(db, {
        db.execute(
            "INSERT OR REPLACE INTO friends
             (friend_id, username, nickname, avatar_url, status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now'))",
            params![
                friend.friend_id,
                friend.username,
                friend.nickname,
                friend.avatar_url,
                friend.status,
                friend.created_at,
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

/// 批量保存好友（全量替换）
pub fn save_friends(friends: &[LocalFriend]) -> Result<(), String> {
    with_db!(db, {
        // 开启事务
        db.execute("BEGIN TRANSACTION", [])
            .map_err(|e| e.to_string())?;

        // 清空现有好友
        db.execute("DELETE FROM friends", [])
            .map_err(|e| e.to_string())?;

        // 插入新好友
        for friend in friends {
            db.execute(
                "INSERT INTO friends
                 (friend_id, username, nickname, avatar_url, status, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now'))",
                params![
                    friend.friend_id,
                    friend.username,
                    friend.nickname,
                    friend.avatar_url,
                    friend.status,
                    friend.created_at,
                ],
            )
            .map_err(|e| e.to_string())?;
        }

        // 提交事务
        db.execute("COMMIT", []).map_err(|e| e.to_string())?;

        println!("[DB] 保存 {} 个好友", friends.len());
        Ok(())
    })
}

/// 删除好友
pub fn delete_friend(friend_id: &str) -> Result<(), String> {
    with_db!(db, {
        db.execute("DELETE FROM friends WHERE friend_id = ?1", [friend_id])
            .map_err(|e| e.to_string())?;
        Ok(())
    })
}

// ============================================================================
// 群组操作
// ============================================================================

/// 获取所有群组
pub fn get_groups() -> Result<Vec<LocalGroup>, String> {
    with_db!(db, {
        let mut stmt = db
            .prepare(
                "SELECT group_id, name, avatar_url, owner_id, member_count, my_role, created_at, updated_at
                 FROM groups
                 ORDER BY updated_at DESC",
            )
            .map_err(|e| e.to_string())?;

        let groups = stmt
            .query_map([], |row| {
                Ok(LocalGroup {
                    group_id: row.get(0)?,
                    name: row.get(1)?,
                    avatar_url: row.get(2)?,
                    owner_id: row.get(3)?,
                    member_count: row.get(4)?,
                    my_role: row.get(5)?,
                    created_at: row.get(6)?,
                    updated_at: row.get(7)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        Ok(groups)
    })
}

/// 保存单个群组
pub fn save_group(group: &LocalGroup) -> Result<(), String> {
    with_db!(db, {
        db.execute(
            "INSERT OR REPLACE INTO groups
             (group_id, name, avatar_url, owner_id, member_count, my_role, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, datetime('now'))",
            params![
                group.group_id,
                group.name,
                group.avatar_url,
                group.owner_id,
                group.member_count,
                group.my_role,
                group.created_at,
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

/// 批量保存群组（全量替换）
pub fn save_groups(groups: &[LocalGroup]) -> Result<(), String> {
    with_db!(db, {
        // 开启事务
        db.execute("BEGIN TRANSACTION", [])
            .map_err(|e| e.to_string())?;

        // 清空现有群组
        db.execute("DELETE FROM groups", [])
            .map_err(|e| e.to_string())?;

        // 插入新群组
        for group in groups {
            db.execute(
                "INSERT INTO groups
                 (group_id, name, avatar_url, owner_id, member_count, my_role, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, datetime('now'))",
                params![
                    group.group_id,
                    group.name,
                    group.avatar_url,
                    group.owner_id,
                    group.member_count,
                    group.my_role,
                    group.created_at,
                ],
            )
            .map_err(|e| e.to_string())?;
        }

        // 提交事务
        db.execute("COMMIT", []).map_err(|e| e.to_string())?;

        println!("[DB] 保存 {} 个群组", groups.len());
        Ok(())
    })
}

/// 更新群组信息
pub fn update_group(group: &LocalGroup) -> Result<(), String> {
    with_db!(db, {
        db.execute(
            "UPDATE groups SET
             name = ?2, avatar_url = ?3, owner_id = ?4, member_count = ?5, my_role = ?6, updated_at = datetime('now')
             WHERE group_id = ?1",
            params![
                group.group_id,
                group.name,
                group.avatar_url,
                group.owner_id,
                group.member_count,
                group.my_role,
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    })
}

/// 删除群组
pub fn delete_group(group_id: &str) -> Result<(), String> {
    with_db!(db, {
        db.execute("DELETE FROM groups WHERE group_id = ?1", [group_id])
            .map_err(|e| e.to_string())?;
        Ok(())
    })
}

