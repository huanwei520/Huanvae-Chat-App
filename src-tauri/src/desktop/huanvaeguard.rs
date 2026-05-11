//! HuanvaeGuard Windows Service 生命周期控制
//!
//! 把本机 VPN 服务 (HuanvaeGuard Windows Service) 的生命周期绑定到主程序：
//!   - 主程序启动 → 异步拉起服务（非阻塞，含死锁自愈）
//!   - 主程序真正退出（非隐藏到托盘）→ 停止服务
//!
//! ## 为什么需要这样做
//!
//! 1. dev 模式下 `cargo build` 会把 `huanvaeguard-svc.exe` 作为 bundle 资源处理，
//!    若服务进程正在运行 → 独占文件锁 → 编译失败 (os error 32)。
//!    退出时停服务可以释放文件锁，下次 rebuild 才能成功。
//!
//! 2. 生产环境下避免 VPN 守护进程在主程序被卸载/退出后仍然残留。
//!
//! ## 启动时自愈（防"半挂"死锁）
//!
//! 服务进程在某些路径上会进入"SCM 状态 Running 但 HTTP 19198 不响应"的死锁
//! （详见 HuanvaeGuard 子仓 huanvaeguard-windows::api_server / tunnel — start_tunnel
//! 持锁全程，handle_status 同步锁同 mutex，device 创建 hang 时 axum runtime worker
//! 全部冻死）。死锁状态下 `sc.exe stop` 返回 1061（"服务无法接受控制消息"），
//! 普通 `taskkill /F /PID` 因 svc 以 LocalSystem 权限运行也会 access denied。
//!
//! 应用启动时自动恢复流程：
//!   1. SCM 状态 = Running → TCP+HTTP 1.5s 短超时探活
//!   2. 探活失败 → 尝试 `sc.exe stop`（死锁场景会 1061，忽略错误）
//!   3. 8s 内未 Stopped → `sc.exe queryex` 取 PID + `taskkill /F /PID`（需 PROCESS_TERMINATE
//!      权限；普通用户 token 通常不够，仅当 Tauri 进程 elevated 才能成功）
//!   4. 全部失败 → 日志告知用户管理员手动 kill；主聊天应用不受影响继续运行
//!
//! ## 权限要求
//!
//! `sc.exe start/stop` 默认需要 Administrator。为让非特权的 Tauri 进程能控制服务，
//! 安装时通过 SDDL 授予 Authenticated Users (S-1-5-11) 的 SERVICE_START + SERVICE_STOP
//! 权限。参见 `scripts/dev/hg-service.ps1` 和 `src-tauri/windows/hooks.nsi`。
//!
//! 自愈第 3 步的 `taskkill /F` 不走 SCM，需要进程级 PROCESS_TERMINATE，普通用户
//! 启动的 Tauri 进程通常无法 kill SYSTEM 服务进程；这是 Windows 服务模型的固有限制，
//! 此场景下回退到日志提示，不会卡住主应用启动。

use std::process::Command;
use std::time::{Duration, Instant};

/// Windows Service 名字（与 NSIS 安装钩子和 dev 脚本保持一致）
const SERVICE_NAME: &str = "HuanvaeGuard";

/// 服务当前状态（从 `sc query` 解析而来）
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ServiceState {
    /// 服务未在 SCM 中注册（开发环境未跑过 `pnpm hg:install`，或生产环境安装器失败）
    NotInstalled,
    Stopped,
    StartPending,
    Running,
    StopPending,
    Unknown,
}

/// 在 Windows 上执行 sc.exe 时隐藏控制台窗口（避免每次调用都闪黑窗）
#[cfg(target_os = "windows")]
fn sc_command() -> Command {
    use std::os::windows::process::CommandExt;
    // CREATE_NO_WINDOW = 0x08000000
    let mut cmd = Command::new("sc.exe");
    cmd.creation_flags(0x0800_0000);
    cmd
}

#[cfg(not(target_os = "windows"))]
fn sc_command() -> Command {
    // 非 Windows 不会真的调用，这里只是为了让编译通过
    Command::new("true")
}

/// 查询服务状态（幂等、非阻塞、无需管理员权限）
pub fn query_state() -> ServiceState {
    #[cfg(not(target_os = "windows"))]
    {
        return ServiceState::NotInstalled;
    }

    #[cfg(target_os = "windows")]
    {
        let output = match sc_command().args(["query", SERVICE_NAME]).output() {
            Ok(o) => o,
            Err(_) => return ServiceState::Unknown,
        };

        // 错误 1060 = 指定的服务未安装
        if !output.status.success() {
            return ServiceState::NotInstalled;
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        if stdout.contains("RUNNING") {
            ServiceState::Running
        } else if stdout.contains("START_PENDING") {
            ServiceState::StartPending
        } else if stdout.contains("STOP_PENDING") {
            ServiceState::StopPending
        } else if stdout.contains("STOPPED") {
            ServiceState::Stopped
        } else {
            ServiceState::Unknown
        }
    }
}

/// 启动服务。幂等：已 Running / StartPending 直接返回 Ok
pub fn try_start() -> Result<(), String> {
    match query_state() {
        ServiceState::NotInstalled => Err(
            "HuanvaeGuard 服务未注册：开发环境请运行 `pnpm hg:install`，生产环境请重装应用"
                .to_string(),
        ),
        ServiceState::Running | ServiceState::StartPending => Ok(()),
        _ => {
            let status = sc_command()
                .args(["start", SERVICE_NAME])
                .status()
                .map_err(|e| format!("无法执行 sc.exe: {e}"))?;
            if status.success() {
                Ok(())
            } else {
                Err(format!(
                    "sc.exe start 失败 (exit={:?})；可能是权限不足，检查服务 SDDL 是否授予 Authenticated Users SERVICE_START",
                    status.code()
                ))
            }
        }
    }
}

/// 停止服务。幂等：NotInstalled / Stopped 直接返回 Ok
pub fn try_stop() -> Result<(), String> {
    match query_state() {
        ServiceState::NotInstalled | ServiceState::Stopped => Ok(()),
        _ => {
            let status = sc_command()
                .args(["stop", SERVICE_NAME])
                .status()
                .map_err(|e| format!("无法执行 sc.exe: {e}"))?;
            if status.success() {
                Ok(())
            } else {
                Err(format!(
                    "sc.exe stop 失败 (exit={:?})；可能是权限不足",
                    status.code()
                ))
            }
        }
    }
}

// ============================================================================
// 自愈相关常量 / 辅助
// ============================================================================

/// HTTP 探活的 connect/read/write 超时（健康服务通常 < 50ms 响应）
const HEALTH_PROBE_TIMEOUT: Duration = Duration::from_millis(1500);
/// SCM 状态轮询间隔
const STATE_POLL_INTERVAL: Duration = Duration::from_millis(500);
/// `sc.exe stop` 后等待状态转 Stopped 的最大时间（死锁场景会超时）
const STOP_WAIT_TIMEOUT: Duration = Duration::from_secs(8);
/// taskkill 后或一般状态等待的最大时间
const STATE_WAIT_TIMEOUT: Duration = Duration::from_secs(15);

/// 通过 TCP+HTTP 短超时探活，判断服务是否真活（区分健康 vs 死锁）
///
/// 不依赖 reqwest/hyper 等重型库，直接用 std::net 写最小 HTTP/1.0 请求。
/// 任何环节超时/失败都返回 false（视为死锁/不可用）。
fn probe_http_health() -> bool {
    use std::io::{Read, Write};
    use std::net::{SocketAddr, TcpStream};

    let addr: SocketAddr = match "127.0.0.1:19198".parse() {
        Ok(a) => a,
        Err(_) => return false,
    };
    let mut stream = match TcpStream::connect_timeout(&addr, HEALTH_PROBE_TIMEOUT) {
        Ok(s) => s,
        Err(_) => return false,
    };
    let _ = stream.set_read_timeout(Some(HEALTH_PROBE_TIMEOUT));
    let _ = stream.set_write_timeout(Some(HEALTH_PROBE_TIMEOUT));
    if stream
        .write_all(b"GET /api/tunnel/status HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n")
        .is_err()
    {
        return false;
    }
    let mut buf = [0u8; 64];
    matches!(stream.read(&mut buf), Ok(n) if n > 0)
}

/// 通过 `sc.exe queryex` 提取卡死服务的进程 PID
///
/// queryex 比 query 多输出 `PID : NNNN` 一行。
fn query_service_pid() -> Option<u32> {
    let output = sc_command().args(["queryex", SERVICE_NAME]).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        let trimmed = line.trim_start();
        // 形如 "PID                : 32284"
        if let Some(rest) = trimmed.strip_prefix("PID") {
            let after_colon = rest
                .trim_start_matches(|c: char| c.is_whitespace())
                .strip_prefix(':')?
                .trim();
            return after_colon.parse().ok();
        }
    }
    None
}

/// 强制结束服务进程（taskkill /F /PID）
///
/// 仅当 Tauri 进程 token 拥有 PROCESS_TERMINATE 权限时成功；普通用户启动的
/// Tauri 通常无法 kill SYSTEM 服务进程，此时返回 Err，由调用方记录日志降级处理。
#[cfg(target_os = "windows")]
fn taskkill_force(pid: u32) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    let status = Command::new("taskkill")
        .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
        .args(["/F", "/PID", &pid.to_string()])
        .status()
        .map_err(|e| format!("taskkill 调用失败: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "taskkill /F /PID {pid} 失败 (exit={:?})；通常是 PROCESS_TERMINATE 权限不足，需管理员手动执行",
            status.code()
        ))
    }
}

#[cfg(not(target_os = "windows"))]
fn taskkill_force(_pid: u32) -> Result<(), String> {
    Err("taskkill 仅 Windows 可用".into())
}

/// 轮询 SCM 状态直到达到目标或超时；返回最终观测到的状态
fn wait_for_state(target: ServiceState, timeout: Duration) -> ServiceState {
    let deadline = Instant::now() + timeout;
    loop {
        let s = query_state();
        if s == target {
            return s;
        }
        if Instant::now() >= deadline {
            return s;
        }
        std::thread::sleep(STATE_POLL_INTERVAL);
    }
}

/// 恢复死锁服务：尝试 sc.exe stop → 失败则 taskkill
///
/// 成功路径：
///   1. `sc.exe stop` + 等到状态 Stopped 即返回 Ok
///   2. 否则 sc.exe queryex 取 PID + taskkill /F + 等 Stopped
fn heal_stuck_service() -> Result<(), String> {
    eprintln!("[HuanvaeGuard] 死锁恢复：尝试 sc.exe stop ...");
    let _ = sc_command().args(["stop", SERVICE_NAME]).status(); // 1061 等错误忽略
    if wait_for_state(ServiceState::Stopped, STOP_WAIT_TIMEOUT) == ServiceState::Stopped {
        eprintln!("[HuanvaeGuard] 死锁恢复：sc stop 已将服务停止");
        return Ok(());
    }

    let pid = query_service_pid()
        .ok_or_else(|| "服务卡死且无法从 sc queryex 获取 PID".to_string())?;
    eprintln!("[HuanvaeGuard] 死锁恢复：sc stop 未生效，强制 kill PID {pid} ...");
    taskkill_force(pid)?;
    if wait_for_state(ServiceState::Stopped, STATE_WAIT_TIMEOUT) == ServiceState::Stopped {
        eprintln!("[HuanvaeGuard] 死锁恢复：taskkill 已将服务停止");
        Ok(())
    } else {
        Err(format!(
            "kill 后 SCM 仍未把服务状态归零，需管理员手动: taskkill /F /PID {pid} && sc.exe start {SERVICE_NAME}"
        ))
    }
}

/// 应用启动时调用：异步拉起服务（不阻塞 Tauri setup），含死锁自愈
///
/// 启动逻辑：
///   1. 查 SCM 状态；StartPending/StopPending 等到稳定状态
///   2. Running → 探活；
///        响应正常 → 直接复用
///        探活失败（死锁）→ 进入 heal_stuck_service 恢复流程
///   3. Stopped → sc.exe start
///
/// 失败只打日志不中断应用启动，因为 HG 是可选功能，主聊天应用应独立可用。
pub fn spawn_start_on_boot() {
    std::thread::spawn(|| {
        // 第一阶段：等待瞬态状态稳定
        match query_state() {
            ServiceState::NotInstalled => {
                eprintln!(
                    "[HuanvaeGuard] 服务未注册：开发环境请运行 `pnpm hg:install`，生产环境请重装应用"
                );
                return;
            }
            ServiceState::StartPending => {
                println!("[HuanvaeGuard] 服务启动中，等待 SCM 稳定...");
                let _ = wait_for_state(ServiceState::Running, STATE_WAIT_TIMEOUT);
            }
            ServiceState::StopPending => {
                println!("[HuanvaeGuard] 服务停止中，等待 SCM 稳定...");
                let _ = wait_for_state(ServiceState::Stopped, STATE_WAIT_TIMEOUT);
            }
            _ => {}
        }

        // 第二阶段：根据稳定状态决定动作
        match query_state() {
            ServiceState::Running => {
                if probe_http_health() {
                    println!("[HuanvaeGuard] 服务已运行且 19198 响应正常");
                    return;
                }
                eprintln!(
                    "[HuanvaeGuard] 服务标记为 RUNNING 但 19198 不响应（疑似死锁），启动恢复流程"
                );
                if let Err(e) = heal_stuck_service() {
                    eprintln!("[HuanvaeGuard] 死锁恢复失败: {e}");
                    return;
                }
                // 恢复后状态应已 Stopped，落到下方 try_start
            }
            ServiceState::Stopped => {} // 直接 start
            ServiceState::NotInstalled => return,
            other => {
                eprintln!("[HuanvaeGuard] 服务处于异常状态 {other:?}，跳过启动");
                return;
            }
        }

        // 第三阶段：启动
        match try_start() {
            Ok(()) => println!("[HuanvaeGuard] 服务启动请求已发出"),
            Err(e) => eprintln!("[HuanvaeGuard] 服务启动失败: {e}"),
        }
    });
}

/// 应用真正退出时调用（非隐藏到托盘）：同步停止服务
///
/// **必须同步**——主进程退出后 Windows 不保证子线程完成。
/// 同步阻塞可确保文件句柄释放，下次 dev rebuild 才不会抢锁失败。
/// 超时控制由 sc.exe 本身处理（默认 ~30s，对于开发够用）。
pub fn stop_on_exit_blocking() {
    match try_stop() {
        Ok(()) => println!("[HuanvaeGuard] 服务已请求停止"),
        Err(e) => eprintln!("[HuanvaeGuard] 服务停止失败: {e}"),
    }
}
