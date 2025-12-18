//! 账号存储管理模块
//! 
//! 本地调用格式使用短横线 "-"
//! 调用服务器格式使用下划线 "_"

use std::fs;
use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use chrono::Utc;
use thiserror::Error;

/// 存储错误类型
#[derive(Error, Debug)]
pub enum StorageError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    
    #[error("Keyring error: {0}")]
    Keyring(String),
    
    #[error("Request error: {0}")]
    Request(String),
    
    #[error("Account not found")]
    AccountNotFound,
}

impl From<keyring::Error> for StorageError {
    fn from(err: keyring::Error) -> Self {
        StorageError::Keyring(err.to_string())
    }
}

impl From<reqwest::Error> for StorageError {
    fn from(err: reqwest::Error) -> Self {
        StorageError::Request(err.to_string())
    }
}

/// 已保存的账号信息（不含密码）
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SavedAccount {
    /// 用户 ID
    pub user_id: String,
    /// 昵称（持久显示）
    pub nickname: String,
    /// 服务器地址
    pub server_url: String,
    /// 本地头像路径
    pub avatar_path: Option<String>,
    /// 保存时间
    pub created_at: String,
}

/// 账号列表存储结构
#[derive(Serialize, Deserialize, Default)]
struct AccountsStore {
    accounts: Vec<SavedAccount>,
}

/// 获取应用数据目录
fn get_app_data_dir() -> Result<PathBuf, StorageError> {
    let base = dirs::data_local_dir()
        .ok_or_else(|| StorageError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "Cannot find local data directory"
        )))?;
    
    let app_dir = base.join("huanvae-chat");
    
    // 确保目录存在
    if !app_dir.exists() {
        fs::create_dir_all(&app_dir)?;
    }
    
    Ok(app_dir)
}

/// 获取头像存储目录
fn get_avatars_dir() -> Result<PathBuf, StorageError> {
    let app_dir = get_app_data_dir()?;
    let avatars_dir = app_dir.join("avatars");
    
    if !avatars_dir.exists() {
        fs::create_dir_all(&avatars_dir)?;
    }
    
    Ok(avatars_dir)
}

/// 获取账号存储文件路径
fn get_accounts_file() -> Result<PathBuf, StorageError> {
    let app_dir = get_app_data_dir()?;
    Ok(app_dir.join("accounts.json"))
}

/// 生成密钥链的 key
/// 格式: huanvae-chat-{server}-{user_id}
fn make_keyring_key(server_url: &str, user_id: &str) -> String {
    // 移除协议前缀和特殊字符，使用短横线
    let server_clean = server_url
        .replace("https://", "")
        .replace("http://", "")
        .replace(['/', ':', '.'], "-");
    
    format!("huanvae-chat-{}-{}", server_clean, user_id)
}

/// 生成头像文件名
/// 格式: {server}-{user_id}.jpg
fn make_avatar_filename(server_url: &str, user_id: &str) -> String {
    let server_clean = server_url
        .replace("https://", "")
        .replace("http://", "")
        .replace(['/', ':', '.'], "-");
    
    format!("{}-{}.jpg", server_clean, user_id)
}

/// 读取账号列表
fn read_accounts() -> Result<AccountsStore, StorageError> {
    let file_path = get_accounts_file()?;
    
    if !file_path.exists() {
        return Ok(AccountsStore::default());
    }
    
    let content = fs::read_to_string(&file_path)?;
    let store: AccountsStore = serde_json::from_str(&content)?;
    
    Ok(store)
}

/// 写入账号列表
fn write_accounts(store: &AccountsStore) -> Result<(), StorageError> {
    let file_path = get_accounts_file()?;
    let content = serde_json::to_string_pretty(store)?;
    fs::write(&file_path, content)?;
    
    Ok(())
}

/// 获取所有已保存的账号
pub fn get_saved_accounts() -> Result<Vec<SavedAccount>, StorageError> {
    let store = read_accounts()?;
    Ok(store.accounts)
}

/// 保存账号信息
pub fn save_account(
    user_id: String,
    nickname: String,
    server_url: String,
    password: String,
    avatar_path: Option<String>,
) -> Result<(), StorageError> {
    // 1. 保存密码到系统密钥链
    let key = make_keyring_key(&server_url, &user_id);
    let entry = keyring::Entry::new("huanvae-chat", &key)?;
    entry.set_password(&password)?;
    
    // 2. 读取现有账号列表
    let mut store = read_accounts()?;
    
    // 3. 检查是否已存在（相同 server_url + user_id）
    let existing_idx = store.accounts.iter().position(|a| {
        a.server_url == server_url && a.user_id == user_id
    });
    
    let account = SavedAccount {
        user_id,
        nickname,
        server_url,
        avatar_path,
        created_at: Utc::now().to_rfc3339(),
    };
    
    if let Some(idx) = existing_idx {
        // 更新现有账号
        store.accounts[idx] = account;
    } else {
        // 添加新账号
        store.accounts.push(account);
    }
    
    // 4. 写入文件
    write_accounts(&store)?;
    
    Ok(())
}

/// 获取账号密码（从系统密钥链）
pub fn get_account_password(server_url: &str, user_id: &str) -> Result<String, StorageError> {
    let key = make_keyring_key(server_url, user_id);
    let entry = keyring::Entry::new("huanvae-chat", &key)?;
    let password = entry.get_password()?;
    
    Ok(password)
}

/// 删除已保存的账号
pub fn delete_account(server_url: &str, user_id: &str) -> Result<(), StorageError> {
    // 1. 从密钥链删除密码
    let key = make_keyring_key(server_url, user_id);
    let entry = keyring::Entry::new("huanvae-chat", &key)?;
    let _ = entry.delete_credential(); // 忽略错误（可能不存在）
    
    // 2. 从账号列表删除
    let mut store = read_accounts()?;
    let original_len = store.accounts.len();
    
    store.accounts.retain(|a| {
        !(a.server_url == server_url && a.user_id == user_id)
    });
    
    if store.accounts.len() == original_len {
        return Err(StorageError::AccountNotFound);
    }
    
    // 3. 删除本地头像
    if let Ok(avatars_dir) = get_avatars_dir() {
        let avatar_file = avatars_dir.join(make_avatar_filename(server_url, user_id));
        let _ = fs::remove_file(avatar_file); // 忽略错误
    }
    
    // 4. 写入文件
    write_accounts(&store)?;
    
    Ok(())
}

/// 下载并保存头像到本地
pub async fn download_avatar(
    server_url: &str,
    user_id: &str,
    avatar_url: &str,
) -> Result<String, StorageError> {
    let client = reqwest::Client::new();
    let response = client.get(avatar_url).send().await?;
    
    if !response.status().is_success() {
        return Err(StorageError::Request(format!(
            "Failed to download avatar: {}",
            response.status()
        )));
    }
    
    let bytes = response.bytes().await?;
    
    let avatars_dir = get_avatars_dir()?;
    let filename = make_avatar_filename(server_url, user_id);
    let file_path = avatars_dir.join(&filename);
    
    fs::write(&file_path, &bytes)?;
    
    Ok(file_path.to_string_lossy().to_string())
}

/// 更新账号头像
pub async fn update_account_avatar(
    server_url: &str,
    user_id: &str,
    avatar_url: &str,
) -> Result<String, StorageError> {
    // 1. 下载头像
    let local_path = download_avatar(server_url, user_id, avatar_url).await?;
    
    // 2. 更新账号记录
    let mut store = read_accounts()?;
    
    if let Some(account) = store.accounts.iter_mut().find(|a| {
        a.server_url == server_url && a.user_id == user_id
    }) {
        account.avatar_path = Some(local_path.clone());
        write_accounts(&store)?;
    }
    
    Ok(local_path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_make_keyring_key() {
        let key = make_keyring_key("https://example.com:8080", "testuser");
        assert_eq!(key, "huanvae-chat-example-com-8080-testuser");
    }

    #[test]
    fn test_make_avatar_filename() {
        let filename = make_avatar_filename("https://api.huanvae.com", "user123");
        assert_eq!(filename, "api-huanvae-com-user123.jpg");
    }
}

