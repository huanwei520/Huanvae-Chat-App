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
//! - `get_file_hash_by_uuid`: 通过 uuid 查找 hash

use rusqlite::params;

use super::types::LocalFileMapping;
use super::with_db;

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

// ============================================
// 图片尺寸缓存
// ============================================

/// 图片尺寸信息
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ImageDimensions {
    pub width: u32,
    pub height: u32,
}

/// 保存图片尺寸（使用 file_hash 或 file_uuid 作为 key）
pub fn save_image_dimensions(file_key: &str, width: u32, height: u32) -> Result<(), String> {
    with_db!(db, {
        db.execute(
            "INSERT OR REPLACE INTO image_dimensions (file_key, width, height) VALUES (?, ?, ?)",
            params![file_key, width, height],
        )
        .map_err(|e| e.to_string())?;

        Ok(())
    })
}

/// 获取图片尺寸
pub fn get_image_dimensions(file_key: &str) -> Result<Option<ImageDimensions>, String> {
    with_db!(db, {
        let mut stmt = db
            .prepare("SELECT width, height FROM image_dimensions WHERE file_key = ?")
            .map_err(|e| e.to_string())?;

        let result = stmt
            .query_row([file_key], |row| {
                Ok(ImageDimensions {
                    width: row.get(0)?,
                    height: row.get(1)?,
                })
            })
            .ok();

        Ok(result)
    })
}
