//! HuanvaeGuard Windows Service 生命周期控制
//!
//! 把本机 VPN 服务 (HuanvaeGuard Windows Service) 的生命周期绑定到主程序：
//!   - 主程序启动 → 异步拉起服务（非阻塞）
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
//! ## 权限要求
//!
//! `sc.exe start/stop` 默认需要 Administrator。为让非特权的 Tauri 进程能控制服务，
//! 安装时通过 SDDL 授予 Authenticated Users (S-1-5-11) 的 SERVICE_START + SERVICE_STOP
//! 权限。参见 `scripts/dev/hg-service.ps1` 和 `src-tauri/windows/hooks.nsi`。

use std::process::Command;

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

/// 应用启动时调用：异步拉起服务（不阻塞 Tauri setup）
///
/// 失败只打日志不中断应用启动，因为 HG 是可选功能，主聊天应用应独立可用。
pub fn spawn_start_on_boot() {
    std::thread::spawn(|| match try_start() {
        Ok(()) => println!("[HuanvaeGuard] 服务启动请求已发出"),
        Err(e) => eprintln!("[HuanvaeGuard] 服务启动失败: {e}"),
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
