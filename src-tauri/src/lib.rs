//! Huanvae Chat Tauri 应用
//!
//! 本地调用格式使用短横线 "-"（如 get-saved-accounts）
//! 调用服务器格式使用下划线 "_"（如 user_id）
//!
//! ## 功能模块
//! - 账号管理：登录、保存、删除账号
//! - 数据库操作：本地 SQLite 数据库 CRUD
//! - 用户数据目录：管理用户文件存储路径
//! - 文件下载和缓存：下载文件到本地缓存
//! - WebView 权限管理：重置麦克风/摄像头权限缓存
//! - 系统托盘：关闭窗口时最小化到托盘，后台静默运行
//! - 会话锁：同设备同账户单开，不同账户可多开
//! - 设备信息：获取设备标识用于登录
//! - 窗口状态：记忆窗口位置和大小，下次启动时恢复

mod db;
mod device_info;
mod download;
mod session_lock;
mod sounds;
mod storage;
mod tray;
mod user_data;

use db::{LocalConversation, LocalFileMapping, LocalFriend, LocalGroup, LocalMessage};
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

/// 更新账号昵称（本地缓存）
#[tauri::command]
fn update_account_nickname(
    server_url: String,
    user_id: String,
    nickname: String,
) -> Result<(), String> {
    storage::update_account_nickname(&server_url, &user_id, &nickname)
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

/// 更新会话的最后消息预览
#[tauri::command(rename_all = "camelCase")]
fn db_update_conversation_last_message(
    id: String,
    last_message: String,
    last_message_time: String,
) -> Result<(), String> {
    db::update_conversation_last_message(&id, &last_message, &last_message_time)
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

/// 仅清空消息缓存
#[tauri::command]
fn db_clear_messages() -> Result<(), String> {
    db::clear_messages()
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
// 好友和群组操作 Commands
// ============================================================================

/// 获取所有本地好友
#[tauri::command]
fn db_get_friends() -> Result<Vec<LocalFriend>, String> {
    db::get_friends()
}

/// 批量保存好友（全量替换）
#[tauri::command]
fn db_save_friends(friends: Vec<LocalFriend>) -> Result<(), String> {
    db::save_friends(&friends)
}

/// 保存单个好友
#[tauri::command]
fn db_save_friend(friend: LocalFriend) -> Result<(), String> {
    db::save_friend(&friend)
}

/// 删除好友
#[tauri::command(rename_all = "camelCase")]
fn db_delete_friend(friend_id: String) -> Result<(), String> {
    db::delete_friend(&friend_id)
}

/// 获取所有本地群组
#[tauri::command]
fn db_get_groups() -> Result<Vec<LocalGroup>, String> {
    db::get_groups()
}

/// 批量保存群组（全量替换）
#[tauri::command]
fn db_save_groups(groups: Vec<LocalGroup>) -> Result<(), String> {
    db::save_groups(&groups)
}

/// 保存单个群组
#[tauri::command]
fn db_save_group(group: LocalGroup) -> Result<(), String> {
    db::save_group(&group)
}

/// 更新群组信息
#[tauri::command]
fn db_update_group(group: LocalGroup) -> Result<(), String> {
    db::update_group(&group)
}

/// 删除群组
#[tauri::command(rename_all = "camelCase")]
fn db_delete_group(group_id: String) -> Result<(), String> {
    db::delete_group(&group_id)
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

// ============================================================================
// WebView 权限管理 Commands
// ============================================================================

/// 重置 WebView 权限缓存
/// 用于解决用户误点拒绝麦克风/摄像头权限后无法再次请求的问题
/// 通过删除 WebView2 的 Preferences 文件来清除权限缓存
#[tauri::command]
fn reset_webview_permissions(app: tauri::AppHandle) -> Result<String, String> {
    use tauri::Manager;
    
    let data_dir = app.path().app_local_data_dir()
        .map_err(|e| format!("获取数据目录失败: {}", e))?;
    
    // WebView2 权限存储在 EBWebView/Default/Preferences 文件中
    let prefs_file = data_dir
        .join("EBWebView")
        .join("Default")
        .join("Preferences");
    
    if prefs_file.exists() {
        std::fs::remove_file(&prefs_file)
            .map_err(|e| format!("删除权限文件失败: {}", e))?;
        Ok("权限已重置，请重新请求".to_string())
    } else {
        Ok("没有需要重置的权限".to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .setup(|app| {
            // 清理过期的会话锁（进程已死但锁文件还在）
            if let Err(e) = session_lock::cleanup_stale_locks(app.handle()) {
                eprintln!("[SessionLock] 清理过期锁失败: {}", e);
            }

            // 初始化系统托盘
            if let Err(e) = tray::setup_tray(app) {
                eprintln!("[Tray] 初始化托盘失败: {}", e);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // 拦截主窗口关闭事件，隐藏到托盘而不是退出
            if let tauri::WindowEvent::CloseRequested { api, .. } = event
                && window.label() == "main"
            {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            // 账号管理
            get_saved_accounts,
            save_account,
            get_account_password,
            delete_account,
            update_account_avatar,
            update_account_nickname,
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
            db_update_conversation_last_message,
            db_get_messages,
            db_save_message,
            db_save_messages,
            db_mark_message_recalled,
            db_mark_message_deleted,
            db_get_file_mapping,
            db_save_file_mapping,
            db_delete_file_mapping,
            db_update_file_mapping_verified,
            db_clear_messages,
            db_clear_all_data,
            db_save_file_uuid_hash,
            db_get_file_hash_by_uuid,
            // 好友和群组
            db_get_friends,
            db_save_friends,
            db_save_friend,
            db_delete_friend,
            db_get_groups,
            db_save_groups,
            db_save_group,
            db_update_group,
            db_delete_group,
            // 文件下载和缓存
            download::download_and_save_file,
            download::is_file_cached,
            download::get_cached_file_path,
            download::copy_file_to_cache,
            // WebView 权限管理
            reset_webview_permissions,
            // 提示音管理
            sounds::list_notification_sounds,
            sounds::save_notification_sound,
            sounds::delete_notification_sound,
            sounds::get_notification_sound_path,
            sounds::ensure_sounds_directory,
            // 会话锁管理
            session_lock::check_session_lock,
            session_lock::create_session_lock,
            session_lock::remove_session_lock,
            session_lock::activate_existing_instance,
            // 设备信息
            device_info::get_mac_address_cmd,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}