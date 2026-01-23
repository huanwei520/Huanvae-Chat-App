/*!
 * 断点续传管理模块
 *
 * 管理文件传输的断点续传功能：
 * - 保存传输进度信息
 * - 加载传输进度信息
 * - 管理临时文件
 * - 清理过期的断点信息
 */

use super::config;
use super::protocol::ResumeInfo;
use chrono::Utc;
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;
use thiserror::Error;

// ============================================================================
// 错误类型
// ============================================================================

#[derive(Error, Debug)]
pub enum ResumeError {
    #[error("文件操作失败: {0}")]
    IoError(#[from] std::io::Error),
    #[error("序列化失败: {0}")]
    SerializeError(String),
    #[error("反序列化失败: {0}")]
    DeserializeError(String),
    #[error("哈希校验失败")]
    HashMismatch,
    #[error("续传信息不存在")]
    ResumeInfoNotFound,
    #[error("临时文件不存在")]
    TempFileNotFound,
}

// ============================================================================
// 续传管理器
// ============================================================================

/// 断点续传管理器
pub struct ResumeManager;

impl ResumeManager {
    /// 创建新的续传管理器
    pub fn new() -> Self {
        Self
    }

    /// 保存续传信息
    pub fn save_resume_info(&self, info: &ResumeInfo) -> Result<(), ResumeError> {
        let path = config::get_resume_info_path(&info.file_id);

        // 确保父目录存在
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }

        let content = serde_json::to_string_pretty(info)
            .map_err(|e| ResumeError::SerializeError(e.to_string()))?;

        fs::write(&path, content)?;
        println!(
            "[ResumeManager] 保存续传信息: {} (已传输: {} 字节)",
            info.file_id, info.transferred_bytes
        );

        Ok(())
    }

    /// 加载续传信息
    pub fn load_resume_info(&self, file_id: &str) -> Result<ResumeInfo, ResumeError> {
        let path = config::get_resume_info_path(file_id);

        if !path.exists() {
            return Err(ResumeError::ResumeInfoNotFound);
        }

        let content = fs::read_to_string(&path)?;
        let info: ResumeInfo = serde_json::from_str(&content)
            .map_err(|e| ResumeError::DeserializeError(e.to_string()))?;

        println!(
            "[ResumeManager] 加载续传信息: {} (已传输: {} 字节)",
            file_id, info.transferred_bytes
        );

        Ok(info)
    }

    /// 删除续传信息
    pub fn clear_resume_info(&self, file_id: &str) -> Result<(), ResumeError> {
        let resume_path = config::get_resume_info_path(file_id);
        let temp_path = config::get_temp_file_path(file_id);

        // 删除续传信息文件
        if resume_path.exists() {
            fs::remove_file(&resume_path)?;
            println!("[ResumeManager] 删除续传信息: {}", file_id);
        }

        // 删除临时文件
        if temp_path.exists() {
            fs::remove_file(&temp_path)?;
            println!("[ResumeManager] 删除临时文件: {}", file_id);
        }

        Ok(())
    }

    /// 获取临时文件路径
    pub fn get_temp_file_path(&self, file_id: &str) -> PathBuf {
        config::get_temp_file_path(file_id)
    }

    /// 检查是否可以续传（验证文件完整性）
    pub fn can_resume(
        &self,
        file_id: &str,
        expected_sha256: &str,
    ) -> Result<Option<u64>, ResumeError> {
        // 尝试加载续传信息
        let info = match self.load_resume_info(file_id) {
            Ok(info) => info,
            Err(ResumeError::ResumeInfoNotFound) => return Ok(None),
            Err(e) => return Err(e),
        };

        // 检查文件 SHA256 是否匹配
        if info.file_sha256 != expected_sha256 {
            println!(
                "[ResumeManager] 文件哈希不匹配，需要重新传输: {}",
                file_id
            );
            self.clear_resume_info(file_id)?;
            return Ok(None);
        }

        // 检查临时文件是否存在
        let temp_path = self.get_temp_file_path(file_id);
        if !temp_path.exists() {
            println!("[ResumeManager] 临时文件不存在，需要重新传输: {}", file_id);
            self.clear_resume_info(file_id)?;
            return Ok(None);
        }

        // 验证临时文件大小
        let temp_size = fs::metadata(&temp_path)?.len();
        if temp_size != info.transferred_bytes {
            println!(
                "[ResumeManager] 临时文件大小不匹配（期望 {} 字节，实际 {} 字节），需要重新传输",
                info.transferred_bytes, temp_size
            );
            self.clear_resume_info(file_id)?;
            return Ok(None);
        }

        // 验证已传输部分的哈希（可选，对于大文件可能很慢）
        if !info.chunk_hashes.is_empty()
            && self
                .verify_temp_file_hash(&temp_path, &info.chunk_hashes)
                .is_err()
        {
            println!("[ResumeManager] 临时文件哈希校验失败，需要重新传输");
            self.clear_resume_info(file_id)?;
            return Ok(None);
        }

        println!(
            "[ResumeManager] 可以续传: {} (从 {} 字节开始)",
            file_id, info.transferred_bytes
        );

        Ok(Some(info.transferred_bytes))
    }

    /// 创建临时文件
    /// 注：Android 新传输直接写入公共目录，此方法仅用于非 Android 平台和断点续传
    #[allow(dead_code)]
    pub fn create_temp_file(&self, file_id: &str) -> Result<File, ResumeError> {
        let path = self.get_temp_file_path(file_id);

        // 确保父目录存在
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }

        let file = File::create(&path)?;
        println!("[ResumeManager] 创建临时文件: {:?}", path);

        Ok(file)
    }

    /// 打开临时文件（用于续传）
    pub fn open_temp_file(&self, file_id: &str, offset: u64) -> Result<File, ResumeError> {
        let path = self.get_temp_file_path(file_id);

        if !path.exists() {
            return Err(ResumeError::TempFileNotFound);
        }

        let mut file = fs::OpenOptions::new()
            .write(true)
            .read(true)
            .open(&path)?;

        // 定位到续传位置
        file.seek(SeekFrom::Start(offset))?;
        println!("[ResumeManager] 打开临时文件续传: {:?} (offset: {})", path, offset);

        Ok(file)
    }

    /// 完成传输，将临时文件移动到最终位置
    pub fn finalize_transfer(
        &self,
        file_id: &str,
        file_name: &str,
    ) -> Result<PathBuf, ResumeError> {
        let temp_path = self.get_temp_file_path(file_id);
        let final_path = config::get_file_save_path(file_name);

        // 确保目标目录存在
        if let Some(parent) = final_path.parent() {
            fs::create_dir_all(parent)?;
        }

        // 处理文件名冲突
        let final_path = Self::resolve_filename_conflict(&final_path);

        // 移动文件
        fs::rename(&temp_path, &final_path)?;
        println!(
            "[ResumeManager] 传输完成，文件保存到: {:?}",
            final_path
        );

        // 清理续传信息
        let _ = self.clear_resume_info(file_id);

        Ok(final_path)
    }

    /// 处理文件名冲突
    fn resolve_filename_conflict(path: &std::path::Path) -> PathBuf {
        if !path.exists() {
            return path.to_path_buf();
        }

        let stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("file");
        let extension = path.extension().and_then(|s| s.to_str()).unwrap_or("");
        let default_parent = PathBuf::from(".");
        let parent = path.parent().unwrap_or(&default_parent);

        let mut counter = 1;
        loop {
            let new_name = if extension.is_empty() {
                format!("{} ({})", stem, counter)
            } else {
                format!("{} ({}).{}", stem, counter, extension)
            };
            let new_path = parent.join(new_name);
            if !new_path.exists() {
                return new_path;
            }
            counter += 1;
        }
    }

    /// 验证临时文件的哈希
    fn verify_temp_file_hash(
        &self,
        path: &PathBuf,
        chunk_hashes: &[String],
    ) -> Result<(), ResumeError> {
        let mut file = File::open(path)?;
        let chunk_size = super::protocol::CHUNK_SIZE;
        let mut buffer = vec![0u8; chunk_size];

        for (index, expected_hash) in chunk_hashes.iter().enumerate() {
            let bytes_read = file.read(&mut buffer)?;
            if bytes_read == 0 {
                break;
            }

            let mut hasher = Sha256::new();
            hasher.update(&buffer[..bytes_read]);
            let actual_hash = hex::encode(hasher.finalize());

            if &actual_hash != expected_hash {
                println!(
                    "[ResumeManager] 块 {} 哈希不匹配: 期望 {}, 实际 {}",
                    index, expected_hash, actual_hash
                );
                return Err(ResumeError::HashMismatch);
            }
        }

        Ok(())
    }

    /// 更新续传信息（传输过程中调用）
    pub fn update_progress(
        &self,
        file_id: &str,
        file_sha256: &str,
        transferred_bytes: u64,
        chunk_hash: Option<String>,
    ) -> Result<(), ResumeError> {
        let mut info = self.load_resume_info(file_id).unwrap_or_else(|_| ResumeInfo {
            file_id: file_id.to_string(),
            file_sha256: file_sha256.to_string(),
            temp_file_path: self.get_temp_file_path(file_id).to_string_lossy().to_string(),
            transferred_bytes: 0,
            chunk_hashes: vec![],
            last_updated: Utc::now().to_rfc3339(),
        });

        info.transferred_bytes = transferred_bytes;
        info.last_updated = Utc::now().to_rfc3339();

        if let Some(hash) = chunk_hash {
            info.chunk_hashes.push(hash);
        }

        self.save_resume_info(&info)
    }
}

impl Default for ResumeManager {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================================================
// 便捷函数
// ============================================================================

/// 获取全局续传管理器实例
pub fn get_resume_manager() -> ResumeManager {
    ResumeManager::new()
}
