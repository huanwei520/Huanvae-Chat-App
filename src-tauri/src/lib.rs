//! Huanvae Chat Tauri 应用
//!
//! 本地调用格式使用短横线 "-"（如 get-saved-accounts）
//! 调用服务器格式使用下划线 "_"（如 user_id）
//!
//! ## 功能模块
//! - 账号管理：登录、保存、删除账号
//! - 数据库操作：本地 SQLite 数据库 CRUD
//! - 用户数据目录：管理用户文件存储路径
//! - 文件下载和缓存：下载文件到本地缓存，大文件优化（≥100MB不复制）
//! - 文件管理：在系统文件管理器中显示本地文件
//! - WebView 权限管理：重置麦克风/摄像头权限缓存
//! - 媒体权限恢复：跨平台权限修复指南和系统设置打开
//! - 系统托盘：关闭窗口时最小化到托盘，后台静默运行（桌面端）
//! - 会话锁：同设备同账户单开，不同账户可多开（桌面端）
//! - 设备信息：获取设备标识用于登录
//! - 窗口状态：记忆窗口位置和大小，下次启动时恢复
//! - 局域网传输：局域网内设备发现和文件互传
//! - HuanvaeGuard VPN：绑定本机 Windows Service 生命周期到 Tauri 进程（仅 Windows）
//! - Android 更新：应用内 APK 下载和安装（Android 专属）
//!
//! ## 平台支持
//! - 桌面端 (Windows/macOS/Linux): 完整功能
//! - 移动端 (Android): 部分功能（无托盘、无会话锁），使用 Tauri API 初始化数据目录
//! - 移动端 (iOS): 暂未支持
//!
//! ## 更新日志
//! - 2026-04-22: 集成 HuanvaeGuard 服务生命周期控制：setup 时异步启动、
//!   RunEvent::Exit 时同步停止（释放 huanvaeguard-svc.exe 文件锁，
//!   保证下次 dev rebuild 不会抢占失败）
//! - 2026-01-22: 添加桌面/移动端条件编译，分离平台专属模块
//! - 2026-01-21: Android 数据目录初始化修复，使用 app.path().app_data_dir() 替代 TMPDIR

// ============================================
// 共享模块（所有平台）
// ============================================
mod db;
mod device_info;
mod download;
mod lan_transfer;
mod permissions;
mod sounds;
mod storage;
// macOS 凭据存储：App 私有 AES + Touch ID（替代系统钥匙串，消除未签名 App 的 ACL 弹框）
#[cfg(target_os = "macos")]
mod macos_credential_store;
// macOS 生物识别（Touch ID）共享门禁：凭据解锁 + 打开 VPN 前验证复用
#[cfg(target_os = "macos")]
mod macos_biometric;
mod user_data;

// ============================================
// 桌面专属模块 (Windows/macOS/Linux)
// ============================================
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod desktop;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod clipboard;

// ============================================
// Android 专属模块（mobile_media_server 用于绕过 WebView 的 asset:// 视频播放
// 限制；iOS 不需要 — iOS WKWebView 原生支持 file:// 视频 URL）
// ============================================
#[cfg(target_os = "android")]
mod mobile_media_server;

// ============================================
// Android 更新模块
// ============================================
mod android_update;

// ============================================
// 统一安全 HTTP(自管 TLS / 内置私有 CA / 直连源站 IP)
// 见工作区 DESIGN-app-discovery-selfsigned-tls.md
// ============================================
pub mod secure_net;

// ============================================
// 数据面 WebSocket(走 Rust:tokio-tungstenite + rustls 内置私有 CA)
// 浏览器 WebSocket 用系统信任,验不过自签 leaf,故 WS 同 secure_net 迁到 Rust
// ============================================
mod ws_proxy;

// ============================================
// 回环安全反代(webview 原生 <img>/<video>/上传 XHR 验不过自签,经 127.0.0.1 反代由
// secure_net 钉 CA 客户端转发到源站 IP)。见 secure_proxy.rs。
// ============================================
mod secure_proxy;

use db::{
    ConversationPreview, LocalConversation, LocalFileMapping, LocalFriend, LocalGroup,
    LocalMessage,
};
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
    storage::update_account_nickname(&server_url, &user_id, &nickname).map_err(|e| e.to_string())
}

// ============================================================================
// 会话锁管理 Commands（桌面端专属）
// ============================================================================

/// 检查会话锁（桌面端）
#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command(rename_all = "camelCase")]
fn check_session_lock(
    app: tauri::AppHandle,
    server_url: String,
    user_id: String,
) -> Result<desktop::session_lock::SessionCheckResult, String> {
    desktop::check_session_lock(app, server_url, user_id)
}

/// 检查会话锁（移动端存根）
#[cfg(any(target_os = "android", target_os = "ios"))]
#[tauri::command(rename_all = "camelCase")]
fn check_session_lock(
    _server_url: String,
    _user_id: String,
) -> Result<serde_json::Value, String> {
    // 移动端不支持会话锁，直接返回无冲突
    Ok(serde_json::json!({
        "exists": false,
        "process_alive": false,
        "pid": null
    }))
}

/// 创建会话锁（桌面端）
#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command(rename_all = "camelCase")]
fn create_session_lock(
    app: tauri::AppHandle,
    server_url: String,
    user_id: String,
) -> Result<(), String> {
    desktop::create_session_lock(app, server_url, user_id)
}

/// 创建会话锁（移动端存根）
#[cfg(any(target_os = "android", target_os = "ios"))]
#[tauri::command(rename_all = "camelCase")]
fn create_session_lock(_server_url: String, _user_id: String) -> Result<(), String> {
    // 移动端不需要会话锁
    Ok(())
}

/// 移除会话锁（桌面端）
#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command(rename_all = "camelCase")]
fn remove_session_lock(
    app: tauri::AppHandle,
    server_url: String,
    user_id: String,
) -> Result<(), String> {
    desktop::remove_session_lock(app, server_url, user_id)
}

/// 移除会话锁（移动端存根）
#[cfg(any(target_os = "android", target_os = "ios"))]
#[tauri::command(rename_all = "camelCase")]
fn remove_session_lock(_server_url: String, _user_id: String) -> Result<(), String> {
    Ok(())
}

/// 激活已存在的实例（桌面端）
///
/// 注意：此函数接收 PID 参数，尝试激活指定进程的窗口
#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command(rename_all = "camelCase")]
fn activate_existing_instance(pid: u32) -> Result<(), String> {
    desktop::activate_existing_instance(pid)
}

/// 激活已存在的实例（移动端存根）
#[cfg(any(target_os = "android", target_os = "ios"))]
#[tauri::command(rename_all = "camelCase")]
fn activate_existing_instance(_pid: u32) -> Result<(), String> {
    Ok(())
}

// ============================================================================
// Windows 安装类型检测 Commands（桌面端专属）
// ============================================================================

/// 获取 Windows 安装类型（桌面端）
///
/// 返回 "msi"、"nsis" 或 "unknown"
/// 用于更新器选择正确的更新包类型
#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command(rename_all = "camelCase")]
fn get_windows_installer_type() -> String {
    desktop::get_windows_installer_type()
}

/// 获取 Windows 安装类型（移动端存根）
///
/// 移动端不使用此功能，返回 "unknown"
#[cfg(any(target_os = "android", target_os = "ios"))]
#[tauri::command(rename_all = "camelCase")]
fn get_windows_installer_type() -> String {
    "unknown".to_string()
}

// ============================================================================
// 移动端本地视频 URL Commands
// ============================================================================

/// 获取本地视频的 HTTP URL（仅 Android 真实）
///
/// 如果视频已缓存到本地，返回本地服务器 URL；否则返回 None
#[cfg(target_os = "android")]
#[tauri::command(rename_all = "camelCase")]
async fn get_local_video_url(file_hash: String) -> Option<String> {
    mobile_media_server::get_local_video_url(file_hash).await
}

/// 获取本地视频的 HTTP URL（桌面端 / iOS 占位）
///
/// 桌面端使用 asset:// 协议；iOS WKWebView 原生支持 file:// 视频 URL，
/// 都不需要本地 HTTP 媒体服务器
#[cfg(not(target_os = "android"))]
#[tauri::command(rename_all = "camelCase")]
async fn get_local_video_url(_file_hash: String) -> Option<String> {
    None
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

/// 获取所有会话及其最新消息预览（通过 JOIN messages 表，一次查询）
#[tauri::command]
fn db_get_conversation_previews() -> Result<Vec<ConversationPreview>, String> {
    db::get_conversation_previews()
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

/// 推进会话本地已读位置：不带 seq 推进到当前已收最新（MAX(last_read_seq, last_seq)），
/// 带 seq 推进到显式读位（MAX(last_read_seq, seq)，不碰 last_seq 同步游标）
#[tauri::command]
fn db_advance_conversation_read(id: String, seq: Option<i64>) -> Result<(), String> {
    db::advance_conversation_read(&id, seq)
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

/// 读取会话对方已读位置（单聊已读回执首帧初值；无记录返回 0）
#[tauri::command(rename_all = "camelCase")]
fn db_get_conversation_peer_read_seq(id: String) -> Result<i64, String> {
    db::get_conversation_peer_read_seq(&id)
}

/// 单调推进会话对方已读位置（MAX，只升不降）
#[tauri::command(rename_all = "camelCase")]
fn db_set_conversation_peer_read_seq(id: String, seq: i64) -> Result<(), String> {
    db::update_conversation_peer_read_seq(&id, seq)
}

/// 读某群全部成员的本地已读位置（群已读回执首帧初值 + 二开校准）
#[tauri::command(rename_all = "camelCase")]
fn db_get_group_read_positions(group_id: String) -> Result<Vec<db::GroupReadPositionRow>, String> {
    db::get_group_read_positions(&group_id)
}

/// upsert 群成员已读位置（last_read_seq 单调 MAX，身份/时间 COALESCE 保留非空旧值）
#[tauri::command(rename_all = "camelCase")]
fn db_upsert_group_read_positions(
    group_id: String,
    rows: Vec<db::GroupReadPositionRow>,
) -> Result<(), String> {
    db::upsert_group_read_positions(&group_id, rows)
}

/// 用全量权威快照对齐群成员集（删退群幽灵 + upsert 快照成员）；仅进会话 sync 快照调用
#[tauri::command(rename_all = "camelCase")]
fn db_replace_group_read_positions(
    group_id: String,
    rows: Vec<db::GroupReadPositionRow>,
) -> Result<(), String> {
    db::replace_group_read_positions(&group_id, rows)
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

/// 批量保存消息（INSERT OR REPLACE — 以服务器为准）
#[tauri::command]
fn db_save_messages(messages: Vec<LocalMessage>) -> Result<(), String> {
    db::save_messages(messages)
}

/// 批量插入消息（INSERT OR IGNORE — 仅补本地缺失的，不覆盖本地状态）
///
/// 历史消息加载专用：保护本地已有的 is_recalled / is_deleted 等状态，
/// 防止服务器响应不带这些字段时把本地撤回标记覆盖回 0。
#[tauri::command]
fn db_save_messages_skip_existing(messages: Vec<LocalMessage>) -> Result<(), String> {
    db::save_messages_skip_existing(messages)
}

/// 跨会话搜索消息内容（含文件名）
#[tauri::command]
fn db_search_messages(
    query: String,
    limit: i64,
) -> Result<Vec<db::SearchMessageResult>, String> {
    db::search_messages(&query, limit)
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
// NFC 信任卡 Commands（跨平台 — SQLite 后端，移动端 NFC 扫卡与桌面 stub 守卫无关）
// ============================================================================

/// 查询 (uid, payload_hash) 是否已信任
#[tauri::command(rename_all = "camelCase")]
fn db_nfc_is_trusted(uid: String, payload_hash: String) -> Result<bool, String> {
    db::nfc_is_trusted(&uid, &payload_hash)
}

/// 添加信任记录（覆盖式）
#[tauri::command(rename_all = "camelCase")]
fn db_nfc_add_trusted(
    uid: String,
    payload_hash: String,
    action_summary: String,
    created_at: i64,
) -> Result<(), String> {
    db::nfc_add_trusted(&uid, &payload_hash, &action_summary, created_at)
}

/// 列出所有信任记录
#[tauri::command]
fn db_nfc_list_trusted() -> Result<Vec<db::TrustedNfcCard>, String> {
    db::nfc_list_trusted()
}

/// 移除指定信任记录
#[tauri::command(rename_all = "camelCase")]
fn db_nfc_remove_trusted(uid: String, payload_hash: String) -> Result<(), String> {
    db::nfc_remove_trusted(&uid, &payload_hash)
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

/// macOS：首次确保 HuanvaeGuard LaunchDaemon 已安装（已装瞬时返回；未装弹一次管理员授权安装）。
#[cfg(target_os = "macos")]
#[tauri::command]
fn hg_ensure_installed() -> Result<bool, String> {
    desktop::huanvaeguard_macos::ensure_installed()
}

/// 非 macOS：无此安装路径（Windows 由 setup 阶段的 Service 自启动覆盖），占位返回 false。
#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn hg_ensure_installed() -> Result<bool, String> {
    Ok(false)
}

/// macOS：强制重装/修复 LaunchDaemon（"文件在但服务没起"的半装态恢复，会再弹一次授权）。
#[cfg(target_os = "macos")]
#[tauri::command]
fn hg_repair() -> Result<bool, String> {
    desktop::huanvaeguard_macos::repair().map(|()| true)
}

/// 非 macOS：占位返回 false。
#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn hg_repair() -> Result<bool, String> {
    Ok(false)
}

/// macOS：生物识别（Touch ID）门禁。前端打开 VPN 前调用以"有 Touch ID 则优先生物识别"。
/// - 通过 → `Ok("authenticated")`；无 Touch ID 硬件 → `Ok("unavailable")`（前端照常放行）；
/// - 取消/失败/超时 → `Err(原因)`（前端中止动作）。
#[cfg(target_os = "macos")]
#[tauri::command]
fn biometric_authenticate(reason: String) -> Result<String, String> {
    match macos_biometric::authenticate(&reason) {
        macos_biometric::BiometricResult::Authenticated => Ok("authenticated".to_string()),
        macos_biometric::BiometricResult::Unavailable => Ok("unavailable".to_string()),
        macos_biometric::BiometricResult::Failed(e) => Err(e),
    }
}

/// 非 macOS：无生物识别，返回 "unavailable"（前端照常放行，不门禁）。
#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn biometric_authenticate(_reason: String) -> Result<String, String> {
    Ok("unavailable".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 桌面端：包含 updater 和 clipboard-manager 插件（不用 window-state，窗口每次居中不记忆）
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        // 不用 window-state 插件：窗口每次按 tauri.conf.json 的 center:true 居中、默认尺寸打开，
        // 不记忆位置/尺寸。原插件会在窗口创建（已居中）后恢复上次位置，造成"先居中再漂到右下角/屏外"。
        .plugin(tauri_plugin_clipboard_manager::init());

    // 移动端：不包含 updater 插件
    // - store: 密码 + 会话持久化存储
    // - android-fs: 处理 content:// URI 文件读取（仅 Android）
    // - android-package-install: 应用内 APK 安装（仅 Android）
    // - mobile-onbackpressed-listener: 在 setup 中注册（文档要求）
    #[cfg(any(target_os = "android", target_os = "ios"))]
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_nfc::init());

    // Android 专属插件（iOS 上没有对应 crate）
    #[cfg(target_os = "android")]
    let builder = builder
        .plugin(tauri_plugin_android_fs::init())
        .plugin(tauri_plugin_android_package_install::init());

    builder
        .setup(|app| {
            // 桌面端：把用户数据根目录注册到 asset 协议白名单
            //
            // 背景：tauri.conf.json `assetProtocol.scope` 内置变量（$DATA / $LOCALDATA / $APPDATA 等）
            // 在 Tauri 2 Windows 上不覆盖 `<exe_dir>/data`（无 $EXE 变量；executableDir 在 Windows
            // 明确 "Not supported"）。`user_data::get_app_root()` 返回 `<exe_dir>/data` 让数据跟随
            // 应用安装位置（支持装非 C 盘），所以必须在运行时通过 Manager API 把这个动态路径
            // 加入 asset 协议白名单，否则生产 NSIS 构建中 `<img src="asset://localhost/...">`
            // 加载会被 scope 校验拒绝（瞬间显示后变"无法加载"）。
            //
            // 该 API 自 Tauri 2.0 stable 起稳定：
            // https://docs.rs/tauri/latest/tauri/scope/fs/struct.Scope.html#method.allow_directory
            //
            // 失败仅记录日志，不阻塞应用启动（如目录首次启动时尚未创建）。
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            {
                use tauri::Manager;
                let data_root = user_data::get_app_root();
                if let Err(e) = app.asset_protocol_scope().allow_directory(&data_root, true) {
                    eprintln!(
                        "[AssetScope] 注册数据目录失败: {} (path={:?})",
                        e, data_root
                    );
                }
            }

            // 桌面端：清理过期的会话锁
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            if let Err(e) = desktop::cleanup_stale_locks(app.handle()) {
                eprintln!("[SessionLock] 清理过期锁失败: {}", e);
            }

            // 桌面端：初始化系统托盘
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            if let Err(e) = desktop::setup_tray(app) {
                eprintln!("[Tray] 初始化托盘失败: {}", e);
            }

            // 仅 Windows：异步启动 HuanvaeGuard 服务（非阻塞，失败只打日志）
            // 绑定到 Tauri 进程生命周期：进程退出时由 RunEvent::Exit 停服务
            // macOS/Linux 桌面端无 HG 实现，跳过避免误导日志；移动端被 desktop 模块 cfg 排除
            #[cfg(target_os = "windows")]
            desktop::huanvaeguard::spawn_start_on_boot();

            // Android/iOS：注册返回按钮监听插件（必须在 setup 中注册）
            #[cfg(any(target_os = "android", target_os = "ios"))]
            {
                app.handle()
                    .plugin(tauri_plugin_mobile_onbackpressed_listener::init())?;
            }

            // Android：初始化应用数据目录 + 启动本地媒体服务器
            #[cfg(target_os = "android")]
            {
                use tauri::Manager;
                match app.path().app_data_dir() {
                    Ok(data_dir) => {
                        let data_dir_str = data_dir.to_string_lossy().to_string();

                        // 初始化 storage 模块的数据目录
                        if let Err(e) = storage::init_android_data_dir(data_dir.clone()) {
                            eprintln!("[Storage] Android 数据目录初始化失败: {}", e);
                        }
                        // 初始化 user_data 模块的数据根目录
                        if let Err(e) = user_data::init_android_app_root(data_dir.clone()) {
                            eprintln!("[UserData] Android 数据根目录初始化失败: {}", e);
                        }
                        // 初始化 lan_transfer 模块的数据目录（接收文件保存位置）
                        if let Err(e) = lan_transfer::config::init_android_data_dir(data_dir.clone()) {
                            eprintln!("[LanTransfer] Android 数据目录初始化失败: {}", e);
                        }

                        // 启动本地媒体服务器（后台异步）
                        // 用于解决 Android WebView 无法通过 asset:// 播放视频的问题
                        // 使用 tauri::async_runtime::spawn 而不是 tokio::spawn
                        // 因为 setup 函数不在 Tokio 异步上下文中
                        tauri::async_runtime::spawn(async move {
                            match mobile_media_server::start_server(data_dir_str).await {
                                Ok(port) => {
                                    println!("[MobileMediaServer] 服务器已启动，端口: {}", port);
                                }
                                Err(e) => {
                                    eprintln!("[MobileMediaServer] 服务器启动失败: {}", e);
                                }
                            }
                        });
                    }
                    Err(e) => {
                        eprintln!("[Storage] 获取 Android app_data_dir 失败: {}", e);
                    }
                }
            }

            // iOS：暂无特定初始化
            #[cfg(target_os = "ios")]
            {
                let _ = app; // 避免未使用警告
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            // 桌面端：拦截主窗口关闭事件，隐藏到托盘而不是退出
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            if let tauri::WindowEvent::CloseRequested { api, .. } = event
                && window.label() == "main"
            {
                api.prevent_close();
                let _ = window.hide();
            }

            // 移动端：不拦截关闭事件
            #[cfg(any(target_os = "android", target_os = "ios"))]
            {
                let _ = (window, event); // 避免未使用警告
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
            db_get_conversation_previews,
            db_get_conversation,
            db_save_conversation,
            db_advance_conversation_read,
            db_update_conversation_last_seq,
            db_update_conversation_unread,
            db_clear_conversation_unread,
            db_update_conversation_last_message,
            db_get_conversation_peer_read_seq,
            db_set_conversation_peer_read_seq,
            db_get_group_read_positions,
            db_upsert_group_read_positions,
            db_replace_group_read_positions,
            db_get_messages,
            db_save_message,
            db_save_messages,
            db_save_messages_skip_existing,
            db_search_messages,
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
            // NFC 信任卡
            db_nfc_is_trusted,
            db_nfc_add_trusted,
            db_nfc_list_trusted,
            db_nfc_remove_trusted,
            // 文件下载和缓存
            download::download_and_save_file,
            download::is_file_cached,
            download::get_cached_file_path,
            download::copy_file_to_cache,
            download::show_in_folder,
            download::is_file_exists,
            // 统一安全 HTTP(发现面系统信任 / 数据面内置 CA + 直连源站 IP)
            secure_net::secure_http,
            // 流式安全 HTTP(SSE,Channel 逐块推回)
            secure_net::secure_http_stream,
            // 数据面 WebSocket(内置 CA + 直连源站 IP,Channel 推帧)
            ws_proxy::ws_connect,
            ws_proxy::ws_send_text,
            ws_proxy::ws_send_binary,
            ws_proxy::ws_close,
            // 回环安全反代(webview 原生加载/上传 走自签源站)
            secure_proxy::ensure_secure_proxy,
            secure_proxy::set_proxy_target,
            // WebView 权限管理
            reset_webview_permissions,
            // 提示音管理
            sounds::list_notification_sounds,
            sounds::save_notification_sound,
            sounds::delete_notification_sound,
            sounds::get_notification_sound_path,
            sounds::ensure_sounds_directory,
            // 会话锁管理（桌面端专属）
            check_session_lock,
            create_session_lock,
            remove_session_lock,
            activate_existing_instance,
            // Windows 安装类型检测（桌面端专属，用于更新器）
            get_windows_installer_type,
            // HuanvaeGuard：macOS LaunchDaemon 首次安装 + 修复（其他平台占位返回 false）
            hg_ensure_installed,
            hg_repair,
            biometric_authenticate,
            // 设备信息
            device_info::get_mac_address_cmd,
            // 局域网传输（基础）
            lan_transfer::start_lan_transfer_service,
            lan_transfer::stop_lan_transfer_service,
            lan_transfer::get_discovered_devices,
            lan_transfer::send_connection_request,
            lan_transfer::respond_to_connection_request,
            lan_transfer::get_pending_connection_requests,
            lan_transfer::get_active_transfers,
            lan_transfer::cancel_transfer,
            lan_transfer::get_lan_debug_info,
            // 局域网传输（点对点连接）
            lan_transfer::request_peer_connection,
            lan_transfer::respond_peer_connection,
            lan_transfer::disconnect_peer,
            lan_transfer::get_active_peer_connections,
            lan_transfer::get_pending_peer_connection_requests,
            lan_transfer::send_files_to_peer,
            // 局域网传输（会话管理）
            lan_transfer::get_transfer_session,
            lan_transfer::get_all_transfer_sessions,
            lan_transfer::cancel_transfer_session,
            lan_transfer::cancel_file_transfer,
            // 局域网传输配置
            lan_transfer::get_lan_transfer_save_directory,
            lan_transfer::set_lan_transfer_save_directory,
            lan_transfer::open_lan_transfer_directory,
            lan_transfer::get_lan_transfer_config,
            lan_transfer::add_trusted_device,
            lan_transfer::remove_trusted_device,
            lan_transfer::get_trusted_devices,
            lan_transfer::set_auto_accept_trusted,
            lan_transfer::set_group_by_date,
            // 局域网传输诊断
            lan_transfer::diagnostics::diagnose_lan_transfer,
            // 媒体权限管理
            permissions::open_media_permission_settings,
            permissions::get_media_permission_guide,
            permissions::can_open_permission_settings,
            // 移动端本地视频 URL
            get_local_video_url,
            // 剪贴板图片处理（桌面端专属）
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            clipboard::save_clipboard_image,
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            clipboard::cleanup_clipboard_temp_files,
            // Android 更新（版本检测、APK 下载）
            android_update::get_app_version,
            android_update::fetch_update_json,
            android_update::download_apk,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, _event| {
            // 仅 Windows：进程真正退出时（非隐藏到托盘）同步停止 HuanvaeGuard 服务，
            // 释放 huanvaeguard-svc.exe 文件锁，确保下次 rebuild 不被阻塞。
            // _event 在 Windows 之外不消费，下划线前缀压制 unused 警告
            #[cfg(target_os = "windows")]
            if let tauri::RunEvent::Exit = _event {
                desktop::huanvaeguard::stop_on_exit_blocking();
            }
        });
}