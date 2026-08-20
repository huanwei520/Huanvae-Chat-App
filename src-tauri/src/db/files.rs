//! 文件映射操作模块
//!
//! 处理本地文件映射的增删改查，实现本地优先的文件加载。
//!
//! ## 映射关系
//!
//! 1. `file_mappings` 表：file_hash -> local_path
//!    - 用于通过文件哈希值快速定位本地文件
//!    - 支持 uploaded（上传）和 downloaded（下载）两种来源
//!
//! 2. `file_uuid_hash` 表：file_uuid -> file_hash
//!    - 用于在服务器消息不包含 file_hash 时，通过 file_uuid 查找
//!    - 在文件上传成功后自动建立映射
//!
//! ## 主要函数
//!
//! - `get_file_mapping`: 通过 hash 获取本地路径
//! - `save_file_mapping`: 保存文件映射
//! - `save_file_uuid_hash`: 保存 uuid->hash 映射
//! - `get_file_hash_by_uuid`: **读** uuid->hash 映射（两层键的第一跳）
//!
//! ## 两层键（2026-08-16 起）
//!
//! 后端接收面（好友历史 / 群历史 / WS 帧 / 增量同步）已**不再下发 `file_hash`**，
//! 消息对象上只剩 `file_uuid`。于是：
//!
//! - **快路径的键 = `file_uuid`**：先经 `file_uuid_hash` 解析出内容哈希，再照旧查
//!   `file_mappings`。`file_mappings` 的表结构与主键**一个字都没动**。
//! - **内容身份 = 哈希**：本机在**下载完成后自算**（`crate::content_hash`），
//!   连同 `file_uuid -> file_hash` 一起落库 —— 这张表此前**只写不读、且只在上传路径写**，
//!   接收方库里根本没有行；补上的正是「下载完也写」+「真的去读」这两件。

use rusqlite::params;

use super::types::LocalFileMapping;
use super::with_db;

/// 获取文件的本地映射
pub fn get_file_mapping(file_hash: &str) -> Result<Option<LocalFileMapping>, String> {
    with_db!(db, {
        let mut stmt = db
            .prepare(
                "SELECT file_hash, local_path, original_path, is_large_file, file_size, 
                 file_name, content_type, source, last_verified, created_at 
                 FROM file_mappings WHERE file_hash = ?",
            )
            .map_err(|e| e.to_string())?;

        let result = stmt
            .query_row([file_hash], |row| {
                Ok(LocalFileMapping {
                    file_hash: row.get(0)?,
                    local_path: row.get(1)?,
                    original_path: row.get(2)?,
                    is_large_file: row.get::<_, i64>(3)? != 0,
                    file_size: row.get(4)?,
                    file_name: row.get(5)?,
                    content_type: row.get(6)?,
                    source: row.get(7)?,
                    last_verified: row.get(8)?,
                    created_at: row.get(9)?,
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
             (file_hash, local_path, original_path, is_large_file, file_size, file_name, 
              content_type, source, last_verified)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                mapping.file_hash,
                mapping.local_path,
                mapping.original_path,
                if mapping.is_large_file { 1 } else { 0 },
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

/// 读 file_uuid -> file_hash 映射（两层键的第一跳）
///
/// 没有该行返回 `Ok(None)` —— 这是**正常且高频**的情形：某个 uuid 在本机第一次被
/// 下载完成之前，本表里就是没有它。调用方据此走远程取件，不要把 `None` 当异常。
pub fn get_file_hash_by_uuid(file_uuid: &str) -> Result<Option<String>, String> {
    with_db!(db, {
        let mut stmt = db
            .prepare("SELECT file_hash FROM file_uuid_hash WHERE file_uuid = ?")
            .map_err(|e| e.to_string())?;
        let result = stmt
            .query_row([file_uuid], |row| row.get::<_, String>(0))
            .ok();
        Ok(result)
    })
}

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
