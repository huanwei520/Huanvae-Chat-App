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
//! （表现为：建立隧道的操作卡住后，状态查询一并不再应答，服务整体失去响应能力）。
//! 死锁状态下 `sc.exe stop` 返回 1061（"服务无法接受控制消息"），
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

// ── 服务定义：与 `src-tauri/windows/hooks.nsi` 共用的真值 ────────────────────
// 安装器与本文件的 `repair()` 注册的是**同一个**服务，四项写岔会建出形态不同的服务
// （最典型：SDDL 少给 AU 启停权限 ⇒ 非管理员的主程序从此启停不了它），而两边各自都"成功"。
// 一致性由 `tests/winService.nsisContract.test.ts` 逐字比对守着（改这里必须同步改 hooks.nsi）。

/// 服务显示名（对应 hooks.nsi 的 `DisplayName=`）
const SERVICE_DISPLAY_NAME: &str = "HuanvaeGuard VPN Service";
/// 服务描述（对应 hooks.nsi 的 `sc.exe description`）
const SERVICE_DESCRIPTION: &str = "HuanvaeGuard VPN tunnel service for Huanvae Chat";
/// 服务 DACL（对应 hooks.nsi 的 `sc.exe sdset`）：末尾 (…;AU) 让 Authenticated Users 可启停
const SERVICE_SDDL: &str = "D:(A;;CCLCSWRPWPDTLOCRRC;;;SY)(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;BA)(A;;CCLCSWLOCRRC;;;IU)(A;;CCLCSWLOCRRC;;;SU)(A;;CCLCSWRPWPLOCRRC;;;AU)";
/// 守护进程相对主程序的位置（prod = `$INSTDIR\HuanvaeGuard\`；dev = `target\<profile>\HuanvaeGuard\`，同一条规则）
const DAEMON_SUBDIR: &str = "HuanvaeGuard";
/// 守护进程文件名
const DAEMON_EXE: &str = "huanvaeguard-svc.exe";

// ── 提权子进程的退出码（父进程据此翻成中文原因，见 classify_repair_failure）──────
/// 用户在「用户账户控制」里点了「否」（ERROR_CANCELLED）
const RC_UAC_CANCELED: i32 = 1223;
/// `Start-Process -Verb RunAs` 抛了别的异常（提权进程根本没起来）
const RC_ELEVATE_FAILED: i32 = 1299;
/// 提权脚本各步骤的失败码
const RC_STEP_CREATE: i32 = 11;
const RC_STEP_SDSET: i32 = 12;
const RC_STEP_START: i32 = 13;
/// `sc start` 返回 0 之后，等 SCM 真到 Running 的上限（起而复死会在这里露馅）
const REPAIR_RUNNING_WAIT: Duration = Duration::from_secs(12);

/// `sc.exe` 把 Win32 错误码原样当自己的退出码用；1060 = `ERROR_SERVICE_DOES_NOT_EXIST`（winerror.h）
const SC_ERROR_SERVICE_DOES_NOT_EXIST: i32 = 1060;

/// 服务当前状态（从 `sc query` 解析而来）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ServiceState {
    /// 服务确实未在 SCM 中注册（开发环境未跑过 `pnpm hg:install`，或生产环境安装器失败）。
    ///
    /// 🔴 判据是 `sc query` **明确返回 1060**，不是"退出码非零就算没装"。
    NotInstalled,
    Stopped,
    StartPending,
    Running,
    StopPending,
    /// `sc query` 成功返回了，但输出里没有任何可识别的 STATE 行
    Unknown,
    /// 🔴 **查询本身没成功** —— 与 `NotInstalled` 是两件完全不同的事，处置正好相反：
    /// 服务不存在 ⇒ 该去装；查询失败（典型 5 = 拒绝访问、SCM 异常、`sc.exe` 起不来）
    /// ⇒ 该重试或报错，**绝不能**据此去"装"一个可能已经存在的服务。
    ///
    /// 旧实现把两者压成同一个 `NotInstalled` ——「两个不同成因给出同一个读数」正是
    /// 本次 Windows VPN 故障最难定位的那种同形（同族前科见本文件 POSTINSTALL 那条注释）。
    ///
    /// 携带的是 `sc query` 的退出码；`None` = `sc.exe` 连进程都没起来（没有退出码可言）。
    QueryFailed(Option<i32>),
}

/// `sc query` 的退出码 → 状态判定。抽成纯函数只为**能单测** —— 真跑 `sc.exe` 只有 Windows 才有。
fn classify_query_exit(code: Option<i32>) -> ServiceState {
    match code {
        Some(SC_ERROR_SERVICE_DOES_NOT_EXIST) => ServiceState::NotInstalled,
        other => ServiceState::QueryFailed(other),
    }
}

/// 把 `QueryFailed` 携带的退出码翻成一句人话（`None` = `sc.exe` 根本没跑起来）。
///
/// 只回退出码这一个数字，**不回 `sc.exe` 的 stdout/stderr** —— 那里可能带安装路径（含用户名），
/// 本仓是 PUBLIC 仓，与提权回传通道「只写数字」是同一条纪律。
fn query_failure_reason(code: Option<i32>) -> String {
    match code {
        Some(rc) => format!("查询服务状态失败（sc query 返回 {rc}）"),
        None => "查询服务状态失败（系统的服务查询程序 sc.exe 没能运行）".to_string(),
    }
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
fn query_state() -> ServiceState {
    #[cfg(not(target_os = "windows"))]
    {
        return ServiceState::NotInstalled;
    }

    #[cfg(target_os = "windows")]
    {
        let output = match sc_command().args(["query", SERVICE_NAME]).output() {
            Ok(o) => o,
            // sc.exe 连进程都没起来。这也是"查询失败"，不是"服务不存在"。
            Err(_) => return ServiceState::QueryFailed(None),
        };

        // 只有明确的 1060 才等于"没装"；其余非零一律是查询没成功（见 classify_query_exit）
        if !output.status.success() {
            return classify_query_exit(output.status.code());
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
fn try_start() -> Result<(), String> {
    match query_state() {
        ServiceState::NotInstalled => Err(
            "HuanvaeGuard 服务未注册：开发环境请运行 `pnpm hg:install`，生产环境请重装应用"
                .to_string(),
        ),
        // 没查清楚就不动手：此时服务可能正好在跑，盲目 start 只会得到一个更难解释的失败
        ServiceState::QueryFailed(code) => {
            Err(format!("{}，未尝试启动服务", query_failure_reason(code)))
        }
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
fn try_stop() -> Result<(), String> {
    match query_state() {
        ServiceState::NotInstalled | ServiceState::Stopped => Ok(()),
        // 同 try_start：没查清楚就不动手，且这一句会进退出日志，不会被吞掉
        ServiceState::QueryFailed(code) => {
            Err(format!("{}，未尝试停止服务", query_failure_reason(code)))
        }
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
/// 1. 查 SCM 状态；StartPending/StopPending 等到稳定状态
/// 2. Running → 探活；
///    - 响应正常 → 直接复用
///    - 探活失败（死锁）→ 进入 heal_stuck_service 恢复流程
/// 3. Stopped → sc.exe start
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
            // 「没查到」与「没装」必须分开说：前者不该让人去重装应用
            ServiceState::QueryFailed(code) => {
                eprintln!(
                    "[HuanvaeGuard] {}，跳过本次自动启动",
                    query_failure_reason(code)
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
            // 第一段之后状态可能刚好翻成查询失败（SCM 忙 / 权限变化），单独说清，不混进"异常状态"
            ServiceState::QueryFailed(code) => {
                eprintln!(
                    "[HuanvaeGuard] {}，跳过本次自动启动",
                    query_failure_reason(code)
                );
                return;
            }
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

// ============================================================================
// 安装 / 修复：提权幂等重装（UI 上的「安装服务 / 修复服务」按钮）
// ============================================================================
//
// ## 为什么是"重装"而不是"只 start"
//
// SCM 里的服务条目记着一个**绝对** binPath。安装位置一变（老用户从 currentUser 的
// %LOCALAPPDATA% 升级到 perMachine 的 Program Files，而安装器刚把旧目录删掉），
// 旧条目就指向一个不存在的 exe —— 对它 `sc start` **永远**失败，只有重建才能刷新 binPath。
// 所以本函数固定走 stop → delete → create → sdset → start，与
// `scripts/dev/hg-service.ps1` 的 install 分支、以及 macOS 侧 `repair() = install()` 同形。
// 服务已存在不是"跳过"的理由，恰恰是"必须重建"的理由。
//
// ## 提权模型：整进程提权，且**拿不回子进程的 stderr**
//
// Windows 没有 macOS `do shell script … with administrator privileges` 那种
// "只这一条命令以 root 跑"的粒度，只能 `ShellExecute(runas)` 整进程提权，
// 而提权子进程的 stdout/stderr 不会自动回到调用者。于是失败归因另设一条通道：
// 提权脚本把 `HGSTEP=<步骤> rc=<码>` 追加写进一个**约定的临时文件**，父进程读回来分类。
// 🔴 那条通道上**只回传数字**，绝不回传异常消息 —— 消息里会带安装路径（含用户名），
// 本仓是 PUBLIC 仓，这类串不该出现在任何可能被贴出来的错误文案里。
//
// ## 失败必须说话
//
// 本次要修的 bug，根就是"安装器写了注册但没人看返回码 ⇒ 失败也显示成功"。
// 所以这条路径上每一步都判 rc，且父进程**不信**提权进程的自述：rc=0 之后仍要回头问 SCM
// 最终态（见 `repair()` 末尾）。`sc start` 返回 0 只代表 SCM 收下了启动请求，
// 起来又立刻死（1053 那一族）只有在最终态复核里才露馅。

/// 服务是否已在 SCM 注册。
///
/// 只读、幂等、不需要管理员权限、不弹 UAC。前端用它把「未安装 / 已安装未运行」两态分开 ——
/// 这两句话指向的成因完全不同（安装器注册失败 vs 进程起不来），压成一句就没法排查。
/// 每次调用 fork 一个 `sc.exe`（~10–30ms），因此**只在挂载与修复之后各查一次**，不进轮询。
///
/// 🔴 返回值是**三值**，不许压回两值：
/// - `Ok(true)`  = SCM 里查到了 ⇒ 前端「已安装未运行」
/// - `Ok(false)` = `sc query` 明确报 1060 ⇒ 服务确实不存在 ⇒ 前端「未安装」，该去装
/// - `Err(原因)` = 查询本身没成功 ⇒ 前端「服务状态未知」，该重试或报错，
///   **绝不能**据此去装一个可能已经存在的服务
pub fn is_registered() -> Result<bool, String> {
    match query_state() {
        ServiceState::NotInstalled => Ok(false),
        ServiceState::QueryFailed(code) => Err(format!(
            "无法确认 VPN 服务是否已注册：{}。请重试；若仍失败，请以管理员身份运行本应用。",
            query_failure_reason(code)
        )),
        _ => Ok(true),
    }
}

/// 把任意字符串包成一个 PowerShell **单引号**字面量。
///
/// PowerShell 单引号串内不做任何变量展开、不解释任何转义，**唯一**需要处理的字符就是
/// 单引号本身（写两遍表示一个）。所以这一条替换就是完整的转义，不存在别的逃逸向量 ——
/// 也因此这里不需要 macOS 侧那种"拒绝含引号的路径"的补充 guard（那边是 sh 单引号，
/// 单引号本身在 sh 里无法在单引号串内转义，只能拒绝）。
fn ps_single_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

/// 定位随包发货的守护进程可执行文件：主程序同级的 `HuanvaeGuard\huanvaeguard-svc.exe`。
///
/// prod（NSIS）是 `$INSTDIR\HuanvaeGuard\`，dev 是 `target\<profile>\HuanvaeGuard\` ——
/// 相对主程序的位置**是同一条规则**，所以不需要 dev/prod 分支。
fn resolve_daemon_binary() -> Result<std::path::PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| format!("无法定位应用程序路径：{e}"))?;
    let dir = exe
        .parent()
        .ok_or_else(|| "无法定位应用程序所在目录".to_string())?;
    let bin = dir.join(DAEMON_SUBDIR).join(DAEMON_EXE);
    if !bin.is_file() {
        return Err(format!(
            "找不到 VPN 服务程序（应用目录下的 {DAEMON_SUBDIR}\\{DAEMON_EXE}）。请重新安装应用。"
        ));
    }
    Ok(bin)
}

/// 提权子进程要执行的 PowerShell 脚本正文。
///
/// create 这一步刻意用 `New-Service` 而不是 `sc.exe`：它是 .NET API 调用，binPath **不经过**
/// 任何 shell 引用规则，彻底避开「Program Files 里的空格在 PowerShell → 原生命令行之间被
/// 重新引用」这个老坑（`hg-service.ps1` 里那串 `binPath= "\`"$binPath\`""` 就是踩出来的形态，
/// 而且它的行为还随 PowerShell 大版本变过）。binPath 自带一对双引号是 SCM 的要求 ——
/// 未加引号的服务路径本身就是一个已知的提权面。
/// 其余三条（stop / delete / sdset / start）的参数都不含空格，走 `sc.exe` 零风险。
fn build_elevated_script(bin_path: &str, result_path: &str) -> String {
    format!(
        r#"$ErrorActionPreference = 'Continue'
$Result = {result}
$BinPath = {bin}
$Svc = {svc}
function Emit([string]$line) {{ Add-Content -LiteralPath $Result -Value $line -Encoding UTF8 }}
Emit 'HGSTEP=begin'

& sc.exe stop $Svc 2>&1 | Out-Null
Start-Sleep -Milliseconds 1500
& sc.exe delete $Svc 2>&1 | Out-Null
Start-Sleep -Milliseconds 800

try {{
  New-Service -Name $Svc -BinaryPathName ('"' + $BinPath + '"') -DisplayName {display} -Description {desc} -StartupType Manual -ErrorAction Stop | Out-Null
}} catch {{
  $code = ''
  if ($_.Exception -is [System.ComponentModel.Win32Exception]) {{ $code = [string]$_.Exception.NativeErrorCode }}
  if ($code -eq '' -and $_.Exception.InnerException -is [System.ComponentModel.Win32Exception]) {{ $code = [string]$_.Exception.InnerException.NativeErrorCode }}
  Emit ('HGSTEP=create rc=' + $code)
  exit {rc_create}
}}
Emit 'HGSTEP=create rc=0'

& sc.exe sdset $Svc {sddl} 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {{ Emit ('HGSTEP=sdset rc=' + $LASTEXITCODE); exit {rc_sdset} }}
Emit 'HGSTEP=sdset rc=0'

& sc.exe start $Svc 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {{ Emit ('HGSTEP=start rc=' + $LASTEXITCODE); exit {rc_start} }}
Emit 'HGSTEP=start rc=0'
Emit 'HGSTEP=done'
exit 0
"#,
        result = ps_single_quote(result_path),
        bin = ps_single_quote(bin_path),
        svc = ps_single_quote(SERVICE_NAME),
        display = ps_single_quote(SERVICE_DISPLAY_NAME),
        desc = ps_single_quote(SERVICE_DESCRIPTION),
        sddl = ps_single_quote(SERVICE_SDDL),
        rc_create = RC_STEP_CREATE,
        rc_sdset = RC_STEP_SDSET,
        rc_start = RC_STEP_START,
    )
}

/// 非提权的外层命令：负责弹 UAC、等提权进程结束、把它的退出码原样带回来。
///
/// 「用户点了否」必须与「命令失败」分开 —— 前者是 `ERROR_CANCELLED (1223)`，
/// 它裹在 `InvalidOperationException` 的 InnerException 里，所以要沿 InnerException 链找
/// `Win32Exception`（直接读 `$_.Exception.NativeErrorCode` 会拿到 $null，把取消误判成未知失败）。
/// 全串只用单引号、不含任何双引号 —— 这样它作为一个 argv 传给 powershell.exe 时不会有引用歧义。
///
/// 🔴 整串会被 Rust 的续行 `\` 折成**一行**，所以每两条语句之间必须显式写 `;`。
/// PowerShell 在一行里不接受 `if (…) { … } $x = 1` 这种无分隔的相邻语句（会报意外的 token），
/// 而这类语法错误在本机（macOS，无 pwsh）**编不出来也跑不到**，只会在用户点按钮那一刻炸。
/// 同理这里刻意**不用 while 循环**：InnerException 链最多两层，摊平成两个独立 if 更难写错。
fn build_launcher(script_path: &str) -> String {
    format!(
        "$ErrorActionPreference='Stop'; \
         try {{ \
           $p = Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru -WindowStyle Hidden \
                -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',{script}); \
           exit $p.ExitCode \
         }} catch {{ \
           $code = 0; \
           if ($_.Exception -is [System.ComponentModel.Win32Exception]) {{ $code = $_.Exception.NativeErrorCode }}; \
           if ($code -eq 0 -and $_.Exception.InnerException -is [System.ComponentModel.Win32Exception]) {{ $code = $_.Exception.InnerException.NativeErrorCode }}; \
           if ($code -eq {cancel}) {{ exit {cancel} }} else {{ exit {failed} }} \
         }}",
        script = ps_single_quote(script_path),
        cancel = RC_UAC_CANCELED,
        failed = RC_ELEVATE_FAILED,
    )
}

/// 把「外层退出码 + 回传文件里的最后一条 HGSTEP 标记」翻成一句用户能照着做下一步的中文。
///
/// 取**最后**一条标记（`rfind`）而不是第一条：脚本一路会打 begin / create / sdset…，
/// 用 `find` 会永远归到第一步（macOS 侧 `classify_install_failure` 已经踩过这个坑）。
fn classify_repair_failure(rc: i32, marks: &str) -> String {
    let last = marks
        .rfind("HGSTEP=")
        .and_then(|i| marks[i..].lines().next())
        .unwrap_or("")
        .trim()
        .to_string();
    let code = last.split("rc=").nth(1).unwrap_or("").trim().to_string();
    let code_txt = if code.is_empty() {
        String::new()
    } else {
        format!("（错误码 {code}）")
    };

    match rc {
        RC_UAC_CANCELED =>
            "已取消管理员授权。注册 VPN 服务必须以管理员身份执行 —— 请再点一次，并在弹出的「用户账户控制」中点击「是」。".to_string(),
        RC_ELEVATE_FAILED =>
            "无法启动提权进程。请以管理员身份重新运行本应用后再试。".to_string(),
        RC_STEP_CREATE => format!(
            "第 1 步失败：注册服务{code_txt}。错误码 5 = 提权没生效；1072 = 同名服务正被标记删除，重启电脑后重试。"
        ),
        RC_STEP_SDSET => format!(
            "第 2 步失败：授予服务启停权限{code_txt}。服务已注册，但主程序可能无法自动启停它。"
        ),
        RC_STEP_START => format!(
            "第 3 步失败：启动服务{code_txt}。服务已注册但起不来；错误码 1053 通常是随包的服务程序本身有问题，请重装应用。"
        ),
        other => format!("修复未完成（提权进程退出码 {other}）。最后一步：{last}"),
    }
}

/// 提权重装并启动服务。成功 = SCM 最终态确实是 Running。
///
/// 每一次调用都会弹一次 UAC —— 这是 Windows 提权模型的固有代价，没有 macOS 那种
/// "装一次以后由 launchd 常驻托管"的对应物。
pub fn repair() -> Result<(), String> {
    use std::os::windows::process::CommandExt;

    // 1) 提权**之前**先做前置校验：随包的服务程序都不在，白弹一次 UAC 也只会失败
    //    （与 macOS 侧"提权前先做端口预检"同一条纪律）。
    let bin = resolve_daemon_binary()?;
    let bin_str = bin
        .to_str()
        .ok_or_else(|| "应用安装路径含无法处理的字符，请换一个安装位置后重装".to_string())?;

    // 2) 一次性工作目录：提权脚本 + 结果回传文件。放在当前用户的 %TEMP% 下（其他用户无权写入），
    //    用完即删。目录名带 pid + 纳秒，避免同一进程内连点两次互相覆盖。
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let work = std::env::temp_dir().join(format!("hg-repair-{}-{stamp}", std::process::id()));
    std::fs::create_dir_all(&work).map_err(|e| format!("无法创建临时目录：{e}"))?;
    let script = work.join("repair.ps1");
    let result = work.join("result.txt");
    let (Some(script_str), Some(result_str)) = (script.to_str(), result.to_str()) else {
        let _ = std::fs::remove_dir_all(&work);
        return Err("临时目录路径含无法处理的字符".to_string());
    };

    let write_res = std::fs::write(&script, build_elevated_script(bin_str, result_str))
        .and_then(|()| std::fs::write(&result, ""));
    if let Err(e) = write_res {
        let _ = std::fs::remove_dir_all(&work);
        return Err(format!("无法写入临时脚本：{e}"));
    }

    // 3) 弹 UAC、跑提权脚本、拿退出码
    let launcher = build_launcher(script_str);
    let status = Command::new("powershell.exe")
        .creation_flags(0x0800_0000) // CREATE_NO_WINDOW：外层这个不该闪黑窗（UAC 框照常显示）
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &launcher,
        ])
        .status();
    let status = match status {
        Ok(s) => s,
        Err(e) => {
            let _ = std::fs::remove_dir_all(&work);
            return Err(format!("无法启动 PowerShell：{e}"));
        }
    };
    // 被信号/异常终止时 code() 为 None，按"提权进程没起来"归类，不当成功
    let rc = status.code().unwrap_or(RC_ELEVATE_FAILED);
    let marks = std::fs::read_to_string(&result).unwrap_or_default();
    let _ = std::fs::remove_dir_all(&work);

    if rc != 0 {
        return Err(classify_repair_failure(rc, &marks));
    }

    // 4) 🔴 独立复核：不信提权进程的自述，回头问 SCM 最终态。
    //    这是"不许把失败显示成成功"的第二道闸 —— `sc start` 返回 0 只代表 SCM 收下了
    //    启动请求，起来又立刻死（1053 那一族）只有在这里才露馅。
    match wait_for_state(ServiceState::Running, REPAIR_RUNNING_WAIT) {
        ServiceState::Running => Ok(()),
        ServiceState::NotInstalled => Err(
            "注册步骤报告成功，但服务随后在系统服务管理器中查不到。请重试；若仍失败，请以管理员身份运行本应用。"
                .to_string(),
        ),
        // 「查不到」与「没查成」在这里也必须分开：前者是注册真没成，后者是复核这一步自己坏了
        ServiceState::QueryFailed(code) => Err(format!(
            "注册步骤报告成功，但{}，无法确认服务是否真的起来了。请稍后重新打开本窗口复查。",
            query_failure_reason(code)
        )),
        other => Err(format!(
            "服务已注册，但没有进入运行状态（当前 {other:?}）。请查看守护进程日志 %ProgramData%\\HuanvaeGuard\\logs\\hg-svc.log.<日期>"
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ⚠️ 本模块整体带 `#[cfg(target_os = "windows")]`（见 desktop/mod.rs），
    // 所以下面这些用例**只在 Windows 上的 `cargo test` 里跑**，macOS/Linux 侧不会编译到。
    // 跨文件的常量一致性（hooks.nsi ↔ 本文件）另由 tests/winService.nsisContract.test.ts
    // 在 vitest 里守着 —— 那条是平台无关的，任何机器上都会跑。

    #[test]
    fn only_1060_means_not_installed_every_other_rc_is_a_failed_query() {
        // 「服务确实不存在」只有一个判据：明确的 1060。
        assert_eq!(
            classify_query_exit(Some(SC_ERROR_SERVICE_DOES_NOT_EXIST)),
            ServiceState::NotInstalled
        );
        // 其余非零一律是"查询没成功"，而不是"没装"。5 = 拒绝访问，是最容易被误读成
        // "没装"的那一个（旧实现正是把它读成 NotInstalled ⇒ 界面说「未安装」⇒
        // 用户去点「安装服务」⇒ 装一个其实已经存在的服务）。
        for rc in [1i32, 5, 1053, 1061, 1072, -1] {
            assert_eq!(
                classify_query_exit(Some(rc)),
                ServiceState::QueryFailed(Some(rc)),
                "rc={rc} 不该被读成 NotInstalled"
            );
        }
        // 连退出码都没有（sc.exe 没跑起来）同样是查询失败
        assert_eq!(classify_query_exit(None), ServiceState::QueryFailed(None));
        // 🔴 负对照：两个结论的形状必须不同 —— 否则这条判据没有区分力
        assert_ne!(
            classify_query_exit(Some(SC_ERROR_SERVICE_DOES_NOT_EXIST)),
            classify_query_exit(Some(5))
        );
    }

    #[test]
    fn query_failure_reason_carries_the_code_and_leaks_no_path() {
        let with_code = query_failure_reason(Some(5));
        let no_code = query_failure_reason(None);
        assert!(with_code.contains('5'), "退出码必须出现在原因里：{with_code}");
        assert_ne!(with_code, no_code, "两种失败形态的文案不许撞");
        // 只回数字，不回 sc.exe 的输出（那里可能带含用户名的安装路径；本仓是 PUBLIC 仓）
        for s in [&with_code, &no_code] {
            assert!(!s.contains("C:\\"), "原因里不许出现路径：{s}");
            assert!(!s.contains(":\\Users"), "原因里不许出现用户目录：{s}");
        }
    }

    #[test]
    fn ps_single_quote_wraps_and_doubles_inner_quote() {
        assert_eq!(ps_single_quote("plain"), "'plain'");
        assert_eq!(
            ps_single_quote(r"C:\Program Files\Huanvae Chat App"),
            r"'C:\Program Files\Huanvae Chat App'"
        );
        // 单引号是唯一需要转义的字符，写两遍表示一个
        assert_eq!(ps_single_quote("it's"), "'it''s'");
        // 反斜杠 / $ / 反引号在单引号串里都是字面量，不该被动过
        assert_eq!(ps_single_quote("$x`y\\z"), "'$x`y\\z'");
    }

    #[test]
    fn elevated_script_checks_every_rc_and_leaks_no_path_in_markers() {
        let s = build_elevated_script(r"C:\Program Files\App\HuanvaeGuard\huanvaeguard-svc.exe", r"C:\tmp\r.txt");
        // 三个必须判 rc 的步骤各有自己的退出码
        assert!(s.contains(&format!("exit {RC_STEP_CREATE}")));
        assert!(s.contains(&format!("exit {RC_STEP_SDSET}")));
        assert!(s.contains(&format!("exit {RC_STEP_START}")));
        // sdset / start 走 $LASTEXITCODE 判定
        assert_eq!(s.matches("$LASTEXITCODE -ne 0").count(), 2);
        // 回传通道只写数字：Emit 的每一行都不含异常消息属性
        assert!(!s.contains("$_.Exception.Message"));
        // binPath 必须带一对双引号交给 SCM
        assert!(s.contains(r#"('"' + $BinPath + '"')"#));
        // 服务定义四项都用上了
        assert!(s.contains(SERVICE_NAME));
        assert!(s.contains(SERVICE_DISPLAY_NAME));
        assert!(s.contains(SERVICE_DESCRIPTION));
        assert!(s.contains(SERVICE_SDDL));
    }

    #[test]
    fn launcher_separates_uac_cancel_from_other_failures() {
        let l = build_launcher(r"C:\tmp\repair.ps1");
        assert!(l.contains(&format!("exit {RC_UAC_CANCELED}")));
        assert!(l.contains(&format!("exit {RC_ELEVATE_FAILED}")));
        // 必须沿 InnerException 链找 Win32Exception —— 直接读 NativeErrorCode 会拿到 $null
        assert!(l.contains("InnerException"));
        assert!(l.contains("Win32Exception"));
        // 全串不含双引号，作为单个 argv 传给 powershell.exe 时无引用歧义
        assert!(!l.contains('"'));

        // 🔴 整串被 Rust 的续行 `\` 折成一行，`}` 与下一条语句之间必须有 `;`。
        // PowerShell 不接受一行里 `if (…) { … } $x = 1` 这种相邻无分隔语句；而这类语法错误
        // 在本机（macOS，无 pwsh）编不出来也跑不到，只会在用户点按钮那一刻炸。
        // `} else` / `} catch` 是合法的接续形式，故只查下面这两个形状。
        let flat = l.split_whitespace().collect::<Vec<_>>().join(" ");
        assert!(!flat.contains("} $"), "`}}` 后紧跟语句却缺分号：{flat}");
        assert!(!flat.contains("} if"), "`}}` 后紧跟 if 却缺分号：{flat}");
    }

    #[test]
    fn classify_takes_the_last_marker_not_the_first() {
        let marks = "HGSTEP=begin\nHGSTEP=create rc=0\nHGSTEP=sdset rc=0\nHGSTEP=start rc=1053\n";
        let msg = classify_repair_failure(RC_STEP_START, marks);
        assert!(msg.contains("1053"), "取到的应该是最后一条标记：{msg}");
        assert!(!msg.contains("begin"));
    }

    #[test]
    fn classify_covers_every_exit_code_with_a_distinct_message() {
        let marks = "HGSTEP=create rc=5\n";
        let cancel = classify_repair_failure(RC_UAC_CANCELED, "");
        let elevate = classify_repair_failure(RC_ELEVATE_FAILED, "");
        let create = classify_repair_failure(RC_STEP_CREATE, marks);
        let sdset = classify_repair_failure(RC_STEP_SDSET, "HGSTEP=sdset rc=5\n");
        let start = classify_repair_failure(RC_STEP_START, "HGSTEP=start rc=1053\n");
        let unknown = classify_repair_failure(7, "");
        let all = [&cancel, &elevate, &create, &sdset, &start, &unknown];
        // 六条互不相同 —— 否则"失败在哪一步"就没说清
        for (i, a) in all.iter().enumerate() {
            assert!(!a.is_empty());
            for (j, b) in all.iter().enumerate() {
                if i != j {
                    assert_ne!(a, b, "第 {i} 条与第 {j} 条文案撞了");
                }
            }
        }
        // 取消授权必须自成一类，不能混进"命令失败"
        assert!(cancel.contains("用户账户控制"));
        assert!(create.contains("错误码 5"));
    }
}
