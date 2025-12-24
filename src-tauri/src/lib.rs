//! Huanvae Chat Tauri 应用
//!
//! 本地调用格式使用短横线 "-"（如 get-saved-accounts）
//! 调用服务器格式使用下划线 "_"（如 user_id）

mod db;
mod download;
mod storage;
mod user_data;

use db::{LocalConversation, LocalFileMapping, LocalMessage};
use storage::SavedAccount;

/// 获取所有已保存的账号
#[tauri::command]
fn get_saved_accounts() -> Result<Vec<SavedAccount>, String> {
    storage::get_saved_accounts().map_err(|e| e.to_string())
}

/// 保存账号信息（登录成功后调用）
#[tauri::command]
fn save_account(
    user_id: String,
    nickname: String,
    server_url: String,
    password: String,
    avatar_path: Option<String>,
) -> Result<(), String> {
    storage::save_account(user_id, nickname, server_url, password, avatar_path)
        .map_err(|e| e.to_string())
}

/// 获取账号密码（从系统密钥链）
#[tauri::command]
fn get_account_password(server_url: String, user_id: String) -> Result<String, String> {
    storage::get_account_password(&server_url, &user_id).map_err(|e| e.to_string())
}

/// 删除已保存的账号
#[tauri::command]
fn delete_account(server_url: String, user_id: String) -> Result<(), String> {
    storage::delete_account(&server_url, &user_id).map_err(|e| e.to_string())
}

/// 更新账号头像（下载到本地）
#[tauri::command]
async fn update_account_avatar(
    server_url: String,
    user_id: String,
    avatar_url: String,
) -> Result<String, String> {
    storage::update_account_avatar(&server_url, &user_id, &avatar_url)
        .await
        .map_err(|e| e.to_string())
}

// ============================================================================
// 数据库操作 Commands
// ============================================================================

/// 初始化数据库
#[tauri::command]
fn db_init() -> Result<(), String> {
    println!("[Command] db_init 被调用");
    let result = db::init_database();
    match &result {
        Ok(_) => println!("[Command] db_init 成功"),
        Err(e) => println!("[Command] db_init 失败: {}", e),
    }
    result
}

/// 获取所有会话
#[tauri::command]
fn db_get_conversations() -> Result<Vec<LocalConversation>, String> {
    db::get_conversations()
}

/// 获取单个会话
#[tauri::command]
fn db_get_conversation(id: String) -> Result<Option<LocalConversation>, String> {
    db::get_conversation(&id)
}

/// 保存会话
#[tauri::command]
fn db_save_conversation(conversation: LocalConversation) -> Result<(), String> {
    db::save_conversation(conversation)
}

/// 更新会话的最后序列号
#[tauri::command(rename_all = "camelCase")]
fn db_update_conversation_last_seq(id: String, last_seq: i64) -> Result<(), String> {
    db::update_conversation_last_seq(&id, last_seq)
}

/// 更新会话未读数
#[tauri::command(rename_all = "camelCase")]
fn db_update_conversation_unread(id: String, unread_count: i64) -> Result<(), String> {
    db::update_conversation_unread(&id, unread_count)
}

/// 清零会话未读数
#[tauri::command]
fn db_clear_conversation_unread(id: String) -> Result<(), String> {
    db::clear_conversation_unread(&id)
}

/// 获取消息列表
#[tauri::command(rename_all = "camelCase")]
fn db_get_messages(
    conversation_id: String,
    limit: i64,
    before_seq: Option<i64>,
) -> Result<Vec<LocalMessage>, String> {
    db::get_messages(&conversation_id, limit, before_seq)
}

/// 保存消息
#[tauri::command]
fn db_save_message(message: LocalMessage) -> Result<(), String> {
    db::save_message(message)
}

/// 批量保存消息
#[tauri::command]
fn db_save_messages(messages: Vec<LocalMessage>) -> Result<(), String> {
    db::save_messages(messages)
}

/// 标记消息为已撤回
#[tauri::command(rename_all = "camelCase")]
fn db_mark_message_recalled(message_uuid: String) -> Result<(), String> {
    db::mark_message_recalled(&message_uuid)
}

/// 标记消息为已删除
#[tauri::command(rename_all = "camelCase")]
fn db_mark_message_deleted(message_uuid: String) -> Result<(), String> {
    db::mark_message_deleted(&message_uuid)
}

/// 获取文件映射
#[tauri::command(rename_all = "camelCase")]
fn db_get_file_mapping(file_hash: String) -> Result<Option<LocalFileMapping>, String> {
    db::get_file_mapping(&file_hash)
}

/// 保存文件映射
#[tauri::command]
fn db_save_file_mapping(mapping: LocalFileMapping) -> Result<(), String> {
    db::save_file_mapping(mapping)
}

/// 删除文件映射
#[tauri::command(rename_all = "camelCase")]
fn db_delete_file_mapping(file_hash: String) -> Result<(), String> {
    db::delete_file_mapping(&file_hash)
}

/// 更新文件映射验证时间
#[tauri::command(rename_all = "camelCase")]
fn db_update_file_mapping_verified(file_hash: String) -> Result<(), String> {
    db::update_file_mapping_verified(&file_hash)
}

/// 清空所有本地数据
#[tauri::command]
fn db_clear_all_data() -> Result<(), String> {
    db::clear_all_data()
}

/// 保存 file_uuid 到 file_hash 的映射
#[tauri::command(rename_all = "camelCase")]
fn db_save_file_uuid_hash(file_uuid: String, file_hash: String) -> Result<(), String> {
    db::save_file_uuid_hash(&file_uuid, &file_hash)
}

/// 通过 file_uuid 获取 file_hash
#[tauri::command(rename_all = "camelCase")]
fn db_get_file_hash_by_uuid(file_uuid: String) -> Result<Option<String>, String> {
    db::get_file_hash_by_uuid(&file_uuid)
}

// ============================================================================
// 用户数据目录管理 Commands
// ============================================================================

/// 设置当前用户（登录成功后调用）
/// 这会创建用户数据目录并设置上下文
#[tauri::command(rename_all = "camelCase")]
fn set_current_user(user_id: String, server_url: String) -> Result<(), String> {
    println!("[Command] set_current_user 被调用: {} @ {}", user_id, server_url);
    let result = user_data::set_current_user(&user_id, &server_url);
    match &result {
        Ok(_) => println!("[Command] set_current_user 成功"),
        Err(e) => println!("[Command] set_current_user 失败: {}", e),
    }
    result
}

/// 清除当前用户（登出时调用）
#[tauri::command]
fn clear_current_user() {
    user_data::clear_current_user()
}

/// 获取当前用户的文件下载目录
#[tauri::command]
fn get_user_file_dir() -> Result<String, String> {
    user_data::get_current_user_file_dir()
        .map(|p| p.to_string_lossy().to_string())
}

/// 根据文件类型获取下载目录
#[tauri::command(rename_all = "camelCase")]
fn get_download_dir(file_type: String) -> Result<String, String> {
    let ctx = user_data::get_current_user()
        .ok_or_else(|| "未设置当前用户".to_string())?;
    
    let dir = user_data::get_download_dir_for_type(&ctx.user_id, &ctx.server_url, &file_type);
    Ok(dir.to_string_lossy().to_string())
}

/// 列出当前用户的所有下载文件
#[tauri::command]
fn list_user_files() -> Result<Vec<String>, String> {
    let ctx = user_data::get_current_user()
        .ok_or_else(|| "未设置当前用户".to_string())?;
    
    let files = user_data::list_user_files(&ctx.user_id, &ctx.server_url)?;
    Ok(files.iter().map(|p| p.to_string_lossy().to_string()).collect())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            // 账号管理
            get_saved_accounts,
            save_account,
            get_account_password,
            delete_account,
            update_account_avatar,
            // 用户数据目录管理
            set_current_user,
            clear_current_user,
            get_user_file_dir,
            get_download_dir,
            list_user_files,
            // 数据库操作
            db_init,
            db_get_conversations,
            db_get_conversation,
            db_save_conversation,
            db_update_conversation_last_seq,
            db_update_conversation_unread,
            db_clear_conversation_unread,
            db_get_messages,
            db_save_message,
            db_save_messages,
            db_mark_message_recalled,
            db_mark_message_deleted,
            db_get_file_mapping,
            db_save_file_mapping,
            db_delete_file_mapping,
            db_update_file_mapping_verified,
            db_clear_all_data,
            db_save_file_uuid_hash,
            db_get_file_hash_by_uuid,
            // 文件下载和缓存
            download::download_and_save_file,
            download::is_file_cached,
            download::get_cached_file_path,
            download::copy_file_to_cache,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}