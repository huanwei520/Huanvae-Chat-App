//! 会话锁模块（桌面平台专属）
//!
//! 实现同设备同账户单开：
//! - 同一账户在同一设备上只能运行一个实例
//! - 不同账户可以同时运行多个实例
//!
//! ## 平台支持
//! - Windows: ✅
//! - macOS: ✅
//! - Linux: ✅
//! - Android/iOS: ❌ (移动端由系统管理应用生命周期)
//!
//! ## 实现原理
//!
//! 1. 登录成功后创建锁文件 `{app_data}/sessions/{server_hash}_{user_id}.lock`
//! 2. 锁文件记录 PID 和创建时间
//! 3. 登录前检查锁文件，如果 PID 有效则阻止登录并显示错误提示
//!
//! ## 使用流程
//!
//! ```text
//! 前端登录前 → check_session_lock() → 检查是否有冲突
//!                                    ↓
//!                              有冲突且进程存活
//!                                    ↓
//!                           显示"该账户已在其他窗口登录"
//!
//! 登录成功后 → create_session_lock() → 创建锁文件
//!
//! 登出/退出时 → remove_session_lock() → 删除锁文件
//! ```
//!
//! ## 备注
//!
//! `activate_existing_instance` 命令保留但当前未被前端使用，
//! 可用于将来实现窗口激活功能。
//!
//! ## 更新日志
//! - 2026-01-22: 移至 desktop 模块，添加平台支持说明

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use sysinfo::System;
use tauri::{AppHandle, Manager};

/// 会话锁信息
#[derive(Debug, Serialize, Deserialize)]
pub struct SessionLock {
    /// 用户 ID
    pub user_id: String,
    /// 服务器 URL
    pub server_url: String,
    /// 进程 ID
    pub pid: u32,
    /// 创建时间戳（秒）
    pub created_at: u64,
    /// 窗口标签
    pub window_label: String,
}

/// 检查结果
#[derive(Debug, Serialize, Deserialize)]
pub struct SessionCheckResult {
    /// 是否已有实例运行
    pub exists: bool,
    /// 进程是否还在运行
    pub process_alive: bool,
    /// 锁定的进程 ID（如果存在）
    pub pid: Option<u32>,
}

/// 获取会话锁目录
fn get_sessions_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取应用数据目录失败: {}", e))?;
    Ok(app_data.join("sessions"))
}

/// 生成锁文件名
///
/// 使用 server_url 的哈希值 + user_id，避免文件名中出现特殊字符
fn get_lock_filename(server_url: &str, user_id: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    let mut hasher = DefaultHasher::new();
    server_url.hash(&mut hasher);
    let server_hash = hasher.finish();

    format!("{}_{}.lock", server_hash, user_id)
}

/// 获取锁文件路径
fn get_lock_path(app: &AppHandle, server_url: &str, user_id: &str) -> Result<PathBuf, String> {
    let sessions_dir = get_sessions_dir(app)?;
    let filename = get_lock_filename(server_url, user_id);
    Ok(sessions_dir.join(filename))
}

/// 检查进程是否还在运行
fn is_process_running(pid: u32) -> bool {
    let mut sys = System::new();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
    sys.process(sysinfo::Pid::from_u32(pid)).is_some()
}

/// 检查账户是否已有实例运行
///
/// # 参数
///
/// - `app`: Tauri 应用句柄
/// - `server_url`: 服务器地址
/// - `user_id`: 用户 ID
///
/// # 返回
///
/// - `SessionCheckResult`: 包含是否存在冲突、进程是否存活、进程 ID
pub fn check_session_lock(
    app: AppHandle,
    server_url: String,
    user_id: String,
) -> Result<SessionCheckResult, String> {
    let lock_path = get_lock_path(&app, &server_url, &user_id)?;

    if !lock_path.exists() {
        return Ok(SessionCheckResult {
            exists: false,
            process_alive: false,
            pid: None,
        });
    }

    // 读取锁文件
    let content = fs::read_to_string(&lock_path).map_err(|e| format!("读取锁文件失败: {}", e))?;

    let lock: SessionLock =
        serde_json::from_str(&content).map_err(|e| format!("解析锁文件失败: {}", e))?;

    // 检查是否是当前进程（如果是同一进程，不算冲突）
    let current_pid = std::process::id();
    if lock.pid == current_pid {
        return Ok(SessionCheckResult {
            exists: false,
            process_alive: false,
            pid: None,
        });
    }

    // 检查进程是否还在运行
    let process_alive = is_process_running(lock.pid);

    if !process_alive {
        // 进程已死，清理锁文件
        let _ = fs::remove_file(&lock_path);
        println!("[SessionLock] 清理无效锁文件: {:?}", lock_path);
        return Ok(SessionCheckResult {
            exists: false,
            process_alive: false,
            pid: None,
        });
    }

    println!(
        "[SessionLock] 检测到冲突: {} @ {}, PID: {}",
        user_id, server_url, lock.pid
    );

    Ok(SessionCheckResult {
        exists: true,
        process_alive: true,
        pid: Some(lock.pid),
    })
}

/// 创建会话锁（登录成功后调用）
///
/// # 参数
///
/// - `app`: Tauri 应用句柄
/// - `server_url`: 服务器地址
/// - `user_id`: 用户 ID
pub fn create_session_lock(
    app: AppHandle,
    server_url: String,
    user_id: String,
) -> Result<(), String> {
    let sessions_dir = get_sessions_dir(&app)?;

    // 确保目录存在
    fs::create_dir_all(&sessions_dir).map_err(|e| format!("创建会话目录失败: {}", e))?;

    let lock_path = get_lock_path(&app, &server_url, &user_id)?;

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("获取时间失败: {}", e))?
        .as_secs();

    let lock = SessionLock {
        user_id: user_id.clone(),
        server_url: server_url.clone(),
        pid: std::process::id(),
        created_at: now,
        window_label: "main".to_string(),
    };

    let content = serde_json::to_string_pretty(&lock).map_err(|e| format!("序列化失败: {}", e))?;

    fs::write(&lock_path, content).map_err(|e| format!("写入锁文件失败: {}", e))?;

    println!(
        "[SessionLock] 创建会话锁: {} @ {}, PID: {}",
        user_id, server_url, lock.pid
    );

    Ok(())
}

/// 移除会话锁（登出或退出时调用）
///
/// # 参数
///
/// - `app`: Tauri 应用句柄
/// - `server_url`: 服务器地址
/// - `user_id`: 用户 ID
pub fn remove_session_lock(
    app: AppHandle,
    server_url: String,
    user_id: String,
) -> Result<(), String> {
    let lock_path = get_lock_path(&app, &server_url, &user_id)?;

    if lock_path.exists() {
        fs::remove_file(&lock_path).map_err(|e| format!("删除锁文件失败: {}", e))?;
        println!(
            "[SessionLock] 移除会话锁: {} @ {}",
            user_id, server_url
        );
    }

    Ok(())
}

/// 激活已存在的实例窗口
///
/// 跨进程激活窗口，支持 Windows/macOS/Linux
///
/// # 参数
///
/// - `pid`: 目标进程 ID
pub fn activate_existing_instance(pid: u32) -> Result<(), String> {
    println!("[SessionLock] 尝试激活 PID {} 的窗口", pid);

    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        // 使用 PowerShell 激活窗口
        let script = format!(
            r#"
            $process = Get-Process -Id {} -ErrorAction SilentlyContinue
            if ($process) {{
                $hwnd = $process.MainWindowHandle
                if ($hwnd -ne 0) {{
                    Add-Type @"
                        using System;
                        using System.Runtime.InteropServices;
                        public class Win32 {{
                            [DllImport("user32.dll")]
                            public static extern bool SetForegroundWindow(IntPtr hWnd);
                            [DllImport("user32.dll")]
                            public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
                        }}
"@
                    [Win32]::ShowWindow($hwnd, 9)
                    [Win32]::SetForegroundWindow($hwnd)
                }}
            }}
            "#,
            pid
        );

        Command::new("powershell")
            .args(["-NoProfile", "-Command", &script])
            .output()
            .map_err(|e| format!("激活窗口失败: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        // macOS 使用 AppleScript 激活窗口
        let script = format!(
            r#"tell application "System Events"
                set frontProcess to first process whose unix id is {}
                set frontmost of frontProcess to true
            end tell"#,
            pid
        );

        Command::new("osascript")
            .args(["-e", &script])
            .output()
            .map_err(|e| format!("激活窗口失败: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        use std::process::Command;
        // Linux 使用 wmctrl
        let _ = Command::new("wmctrl")
            .args(["-ia", &format!("{}", pid)])
            .output();
    }

    Ok(())
}

/// 清理所有无效的会话锁
///
/// 应用启动时调用，清理那些进程已死但锁文件还存在的情况
pub fn cleanup_stale_locks(app: &AppHandle) -> Result<(), String> {
    let sessions_dir = match get_sessions_dir(app) {
        Ok(dir) => dir,
        Err(_) => return Ok(()), // 目录不存在，无需清理
    };

    if !sessions_dir.exists() {
        return Ok(());
    }

    let entries = fs::read_dir(&sessions_dir).map_err(|e| format!("读取会话目录失败: {}", e))?;

    let mut cleaned = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) == Some("lock")
            && let Ok(content) = fs::read_to_string(&path)
            && let Ok(lock) = serde_json::from_str::<SessionLock>(&content)
            && !is_process_running(lock.pid)
        {
            let _ = fs::remove_file(&path);
            cleaned += 1;
        }
    }

    if cleaned > 0 {
        println!("[SessionLock] 清理了 {} 个过期锁文件", cleaned);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_lock_filename() {
        let filename = get_lock_filename("https://example.com", "user123");
        assert!(filename.ends_with("_user123.lock"));
        assert!(!filename.contains('/'));
        assert!(!filename.contains(':'));
    }

    #[test]
    fn test_different_servers_different_filenames() {
        let f1 = get_lock_filename("https://server1.com", "user");
        let f2 = get_lock_filename("https://server2.com", "user");
        assert_ne!(f1, f2);
    }

    #[test]
    fn test_same_server_same_user_same_filename() {
        let f1 = get_lock_filename("https://example.com", "user");
        let f2 = get_lock_filename("https://example.com", "user");
        assert_eq!(f1, f2);
    }
}

