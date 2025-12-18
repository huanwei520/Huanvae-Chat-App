//! Huanvae Chat Tauri 应用
//!
//! 本地调用格式使用短横线 "-"（如 get-saved-accounts）
//! 调用服务器格式使用下划线 "_"（如 user_id）

mod storage;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            get_saved_accounts,
            save_account,
            get_account_password,
            delete_account,
            update_account_avatar,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
