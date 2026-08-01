//! HuanvaeGuard macOS LaunchDaemon 安装 + 探活
//!
//! macOS 数据面是 `hg-macos` 守护进程（必须 root —— 创建 utun），由 launchd
//! 常驻托管（plist 含 RunAtLoad + KeepAlive）。与 Windows 用 `sc.exe` 管 Service
//! 不同，macOS 这边职责更轻：
//!   - **安装一次**：拷二进制到 /usr/local/bin、plist 到 /Library/LaunchDaemons、
//!     `launchctl bootstrap`；之后开机自起、崩溃自拉，App 不负责启停。
//!   - **App 仅"首次确保已安装"**：前端打开 HG 窗口时 invoke `hg_ensure_installed`，
//!     已装则瞬时返回；未装则用 `osascript ... with administrator privileges`
//!     弹一次系统管理员密码完成安装（个人测试阶段；产品化改 .pkg postinstall + 公证）。
//!
//! 二进制与 plist 由 `tauri.macos.conf.json` 打进 .app/Contents/Resources/HuanvaeGuard-macos/。

use std::net::{Ipv4Addr, TcpListener};
use std::path::{Path, PathBuf};
use std::process::Command;

/// 安装后的守护进程二进制路径
const DAEMON_BIN_DST: &str = "/usr/local/bin/hg-macos";
/// 安装后的 LaunchDaemon plist 路径
const PLIST_DST: &str = "/Library/LaunchDaemons/com.huanvaeguard.daemon.plist";
/// 守护进程数据面的本地控制端口（回环）。前端 `src/huanvaeGuard/localApi.ts` 用同一端口。
const LOCAL_CONTROL_PORT: u16 = 19198;
/// 打包资源子目录名（与 tauri.macos.conf.json 的 resources 目标一致）
const RESOURCE_SUBDIR: &str = "HuanvaeGuard-macos";
/// 二进制 / plist 文件名（与打包进 .app 的守护进程产物一致）
const BIN_NAME: &str = "hg-macos";
const PLIST_NAME: &str = "com.huanvaeguard.daemon.plist";

/// 守护进程是否已安装（二进制 + plist 均就位）
pub fn is_installed() -> bool {
    PathBuf::from(DAEMON_BIN_DST).exists() && PathBuf::from(PLIST_DST).exists()
}

/// 首次确保 LaunchDaemon 已安装。
///
/// 返回值：
///   - `Ok(false)` —— 已安装，未做任何操作（无密码弹窗）
///   - `Ok(true)`  —— 本次执行了安装（弹过一次管理员授权）
///   - `Err(_)`    —— 打包资源缺失 / 用户取消授权 / 安装命令失败
pub fn ensure_installed() -> Result<bool, String> {
    if is_installed() {
        return Ok(false);
    }
    install()?;
    Ok(true)
}

/// 强制重装 / 修复（恢复"文件在但 daemon 没起"的半装态）。
///
/// 不看 `is_installed()` —— 半装态下文件已存在但 launchd 未真正加载，必须重跑幂等
/// 安装（bootout 清残留 + bootstrap）。供前端在 `serviceRunning===false` 时经
/// 「安装/修复服务」按钮触发，会再弹一次管理员授权。
pub fn repair() -> Result<(), String> {
    install()
}

/// 解析打包资源 → 逐个校验存在 → 同机冲突预检 → 提权安装（`ensure_installed` / `repair` 共用）。
fn install() -> Result<(), String> {
    let res_dir = bundled_resource_dir()?;
    let bin = res_dir.join(BIN_NAME);
    let plist = res_dir.join(PLIST_NAME);

    // 二进制缺失与 plist 缺失分开报：合成一条 "未找到 A 或 B" 用户无从判断到底缺哪个。
    if !bin.exists() {
        return Err(format!(
            "安装包缺少 macOS VPN 组件（未找到 {}）：请重新下载并覆盖安装本应用。",
            bin.display()
        ));
    }
    if !plist.exists() {
        return Err(format!(
            "安装包缺少 macOS VPN 服务配置（未找到 {}）：请重新下载并覆盖安装本应用。",
            plist.display()
        ));
    }

    // 冲突预检放在提权之前：端口被占时装上去也起不来，不该先白弹一次管理员密码再失败。
    if let Some(msg) = conflict_message(port_in_use(LOCAL_CONTROL_PORT)) {
        return Err(msg);
    }

    run_install_with_admin(&bin, &plist)
}

/// 本地控制端口是否已被占用：尝试 bind 一次，失败即视为被占。
///
/// 判据必须是"端口此刻是否真被占"，而不是"某个 plist 文件在不在"——文件留在盘上但
/// 未加载时端口其实空闲（据此拒装 = 误报，阻断合法安装），端口被别的程序占住时按
/// 文件判定又会漏报（放行后装完必崩，用户拿不到原因）。bind 成功后立即 drop，不长期占用。
fn port_in_use(port: u16) -> bool {
    TcpListener::bind((Ipv4Addr::LOCALHOST, port)).is_err()
}

/// 同机冲突判定：守护进程启动时会无条件 bind 本地控制端口，端口被占则起不来，
/// 在 KeepAlive 下变成崩溃循环 —— 装上去也不可用，所以在提权之前就快速失败并说清楚。
///
/// 抽成纯函数（入参"端口是否被占"）以便单测判定与文案。
fn conflict_message(port_occupied: bool) -> Option<String> {
    if !port_occupied {
        return None;
    }
    Some(format!(
        "本地控制端口 127.0.0.1:{LOCAL_CONTROL_PORT} 已被其他程序占用，\
         VPN 服务启动时会因端口被占反复退出，因此本次不做安装。\
         请先退出占用该端口的程序后重试。"
    ))
}

/// 解析 .app 内打包资源目录 `.../HuanvaeGuard-macos`（取当前可执行文件位置）。
fn bundled_resource_dir() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| format!("current_exe 失败: {e}"))?;
    let exe_dir = exe
        .parent()
        .ok_or_else(|| "无法取可执行文件所在目录".to_string())?;
    resolve_resource_dir(exe_dir)
}

/// 由可执行文件所在目录推导资源目录（开发 / 生产两种布局）。
///
/// 与 `user_data::get_notification_sounds_dir` 同一套 dev/prod 检测口径；
/// 抽成纯函数（入参 exe_dir）以便单测路径推导逻辑。
fn resolve_resource_dir(exe_dir: &Path) -> Result<PathBuf, String> {
    // 生产优先：exe 在 <App>.app/Contents/MacOS/ → 资源在 <App>.app/Contents/Resources/。
    // 必须先判 .app 布局：构建产物 .app 在 target/release/bundle/macos/ 下，若先用
    // "target/release" 子串判 dev，会把"原地直接跑的构建包"误当开发模式 → 路径解析错。
    if exe_dir.ends_with("Contents/MacOS") {
        let contents = exe_dir
            .parent()
            .ok_or_else(|| "无法取 Contents 目录".to_string())?;
        return Ok(contents.join("Resources").join(RESOURCE_SUBDIR));
    }

    // 开发模式：tauri dev 直接跑 <project>/src-tauri/target/{debug,release}/<exe>
    //（不在 .app 内），资源在 <project>/src-tauri/resources/HuanvaeGuard-macos/。
    // 指定 target triple 时会多一层 <triple>（target/<triple>/release），所以不能固定
    // 回溯两级 —— 必须向上找到名为 target 的祖先，它的父目录才是 src-tauri。
    if exe_dir.ends_with("debug") || exe_dir.ends_with("release") {
        let src_tauri = exe_dir
            .ancestors()
            .find(|p| p.file_name().is_some_and(|n| n == "target"))
            .and_then(Path::parent)
            .ok_or_else(|| "无法定位 src-tauri 目录".to_string())?;
        return Ok(src_tauri.join("resources").join(RESOURCE_SUBDIR));
    }

    Err(format!("无法识别运行布局（exe 目录: {}）", exe_dir.display()))
}

/// 路径是否可安全嵌入"单引号包裹"的 shell 命令。
///
/// 注入防护主防线：调用方所有路径都用单引号 `'...'` 包裹，shell 在单引号内不解释
/// 任何元字符（`$` / 反引号 / `$()` / 换行 / `;` / `&&` / 空格 全部字面化），唯一能
/// 逃逸单引号上下文的字符就是单引号本身。因此只需拒绝含单引号的路径即可关闭全部
/// 注入向量。路径由 `current_exe()` 推导（非用户输入，.app 资源路径正常不含单引号），
/// 含单引号属异常环境 → 在以 root 执行前显式拒绝。
fn path_is_shell_safe(p: &str) -> bool {
    !p.contains('\'')
}

/// 用 `osascript ... with administrator privileges` 一次性提权执行安装命令。
///
/// **失败即中止 + 步骤可归因**：每步先往 stderr 打一条 `HGSTEP=<步骤>` 标记，再用
/// `|| exit <码>` 硬停整条链；失败时由 `classify_install_failure` 取最后一条标记定位真实
/// 失败步骤。旧写法用 `;` 串联，二进制拷贝失败后仍会继续拷 plist 并 bootstrap 一个指向
/// 缺失二进制的服务（装出个必然崩溃循环的半成品）—— 现在会在拷贝那一步就停下。
///
/// 个人测试阶段对二进制 `xattr -dr com.apple.quarantine` 绕 Gatekeeper（无 Developer ID 公证）；
/// 该步失败不影响安装，故保持 `;` 不参与中止判定。
/// 幂等：先 `launchctl bootout`（清可能残留的旧实例，未加载时报错被忽略）再 `bootstrap`，
/// 这样半装/残留状态下重跑也能成功（macOS 11+ 均支持 bootout/bootstrap）。
fn run_install_with_admin(bin: &Path, plist: &Path) -> Result<(), String> {
    let src_bin = bin.to_string_lossy();
    let src_plist = plist.to_string_lossy();

    // 注入防护：路径整体单引号包裹是主防线，详见 path_is_shell_safe；含单引号则拒绝。
    if !path_is_shell_safe(&src_bin) || !path_is_shell_safe(&src_plist) {
        return Err("资源路径含单引号，拒绝执行提权安装".to_string());
    }

    let shell = format!(
        "echo HGSTEP=mkdir >&2; mkdir -p /usr/local/bin /var/log/huanvaeguard || exit 11; \
         echo HGSTEP=copybin >&2; cp '{src_bin}' '{DAEMON_BIN_DST}' || exit 12; \
         chmod 755 '{DAEMON_BIN_DST}' || exit 12; \
         xattr -dr com.apple.quarantine '{DAEMON_BIN_DST}' 2>/dev/null; \
         echo HGSTEP=copyplist >&2; cp '{src_plist}' '{PLIST_DST}' || exit 13; \
         chown root:wheel '{PLIST_DST}' || exit 13; chmod 644 '{PLIST_DST}' || exit 13; \
         echo HGSTEP=bootstrap >&2; launchctl bootout system '{PLIST_DST}' 2>/dev/null; \
         launchctl bootstrap system '{PLIST_DST}' || exit 14",
    );

    // AppleScript 字符串内的 `\` 和 `"` 需转义；shell 内用单引号包路径，通常无 `"`。
    let escaped = shell.replace('\\', "\\\\").replace('"', "\\\"");
    let apple_script = format!("do shell script \"{escaped}\" with administrator privileges");

    let output = Command::new("osascript")
        .args(["-e", &apple_script])
        .output()
        .map_err(|e| format!("osascript 调用失败: {e}"))?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(classify_install_failure(&stderr))
    }
}

/// 把 osascript / launchctl 的原始失败输出翻成可操作的中文提示。
///
/// `do shell script` 失败时会把子命令写到 stderr 的内容带进 AppleScript 错误里，
/// 因此上面埋的 `HGSTEP=` 标记会一并出现；取**最后一个**标记即失败所在步骤。
fn classify_install_failure(stderr: &str) -> String {
    let raw = stderr.trim();

    // 用户取消授权（osascript 错误 -128 / "User canceled"）与安装步骤失败是两回事，先判。
    if raw.contains("-128") || raw.contains("User canceled") {
        return "安装 macOS VPN 服务需要本机管理员密码，本次授权被取消了。\
                请重试并在弹出的系统提示中输入管理员密码后点「好」。"
            .to_string();
    }

    const MARKER: &str = "HGSTEP=";
    let step = raw.rfind(MARKER).map(|i| {
        let rest = &raw[i + MARKER.len()..];
        let end = rest
            .find(|c: char| !c.is_ascii_alphanumeric())
            .unwrap_or(rest.len());
        &rest[..end]
    });

    match step {
        Some("bootstrap") => format!(
            "文件已就位，但 launchctl 加载服务失败：可能已有同名服务未卸载，\
             或系统拒绝了该 LaunchDaemon 配置。原始输出：{raw}"
        ),
        Some("copyplist") => format!(
            "写入 LaunchDaemon 配置到 /Library/LaunchDaemons 失败：\
             请确认该目录可写、未被安全软件或系统策略拦截。原始输出：{raw}"
        ),
        Some("copybin") => format!(
            "复制守护进程二进制到 /usr/local/bin 失败：\
             请确认该目录可写、未被安全软件拦截。原始输出：{raw}"
        ),
        Some("mkdir") => format!(
            "创建安装目录（/usr/local/bin、/var/log/huanvaeguard）失败：\
             请确认磁盘可写。原始输出：{raw}"
        ),
        _ => format!("提权安装失败。原始输出：{raw}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dev_debug_layout_resolves_to_src_tauri_resources() {
        let got = resolve_resource_dir(Path::new("/proj/src-tauri/target/debug")).unwrap();
        assert_eq!(
            got,
            PathBuf::from("/proj/src-tauri/resources/HuanvaeGuard-macos")
        );
    }

    #[test]
    fn dev_release_layout_resolves_to_src_tauri_resources() {
        let got = resolve_resource_dir(Path::new("/proj/src-tauri/target/release")).unwrap();
        assert_eq!(
            got,
            PathBuf::from("/proj/src-tauri/resources/HuanvaeGuard-macos")
        );
    }

    #[test]
    fn app_bundle_layout_resolves_to_contents_resources() {
        let got =
            resolve_resource_dir(Path::new("/Applications/Huanvae.app/Contents/MacOS")).unwrap();
        assert_eq!(
            got,
            PathBuf::from("/Applications/Huanvae.app/Contents/Resources/HuanvaeGuard-macos")
        );
    }

    #[test]
    fn shell_safe_rejects_path_with_single_quote() {
        assert!(!path_is_shell_safe(
            "/Users/o'brien/App.app/Contents/Resources/HuanvaeGuard-macos/hg-macos"
        ));
    }

    #[test]
    fn shell_safe_accepts_normal_path() {
        assert!(path_is_shell_safe(
            "/Applications/Huanvae.app/Contents/Resources/HuanvaeGuard-macos/hg-macos"
        ));
    }

    #[test]
    fn built_app_in_build_tree_resolves_by_bundle_layout() {
        // 构建产物 .app 跑在 target/release/bundle/macos/ 下：必须按 .app 布局解析，
        // 不能因路径含 "release" 而误判 dev（这是修复前的真缺陷）。
        let got = resolve_resource_dir(Path::new(
            "/proj/src-tauri/target/release/bundle/macos/Huanvae-Chat-App.app/Contents/MacOS",
        ))
        .unwrap();
        assert_eq!(
            got,
            PathBuf::from(
                "/proj/src-tauri/target/release/bundle/macos/Huanvae-Chat-App.app/Contents/Resources/HuanvaeGuard-macos"
            )
        );
    }

    #[test]
    fn unrecognized_layout_errors() {
        assert!(resolve_resource_dir(Path::new("/tmp/whatever")).is_err());
    }

    #[test]
    fn dev_triple_release_layout_resolves_to_src_tauri_resources() {
        // 指定 target triple 时布局多一层：target/<triple>/release。
        // 固定回溯两级会落到 <src-tauri>/target/resources（修复前的真缺陷）。
        let got =
            resolve_resource_dir(Path::new("/proj/src-tauri/target/aarch64-apple-darwin/release"))
                .unwrap();
        assert_eq!(
            got,
            PathBuf::from("/proj/src-tauri/resources/HuanvaeGuard-macos")
        );
    }

    #[test]
    fn dev_triple_debug_layout_resolves_to_src_tauri_resources() {
        let got =
            resolve_resource_dir(Path::new("/proj/src-tauri/target/x86_64-apple-darwin/debug"))
                .unwrap();
        assert_eq!(
            got,
            PathBuf::from("/proj/src-tauri/resources/HuanvaeGuard-macos")
        );
    }

    #[test]
    fn conflict_message_names_port_and_no_internal_label() {
        let msg = conflict_message(true).expect("端口被占时必须判定为冲突");
        assert!(msg.contains("19198"), "实际: {msg}");
        // 用户可见文案不许出现任何内部组件标签（PUBLIC 仓红线）。
        assert!(!msg.contains("com.huanvae"), "实际: {msg}");
    }

    #[test]
    fn port_in_use_detects_occupied_then_free() {
        // 绑 0 号端口取一个临时端口：持有 listener 时应判为被占，drop 后应判为空闲。
        // 绝不探测真实的 19198 —— 不抢占本机既有服务。
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).expect("临时端口应可绑定");
        let port = listener.local_addr().expect("应能取到本地地址").port();
        assert!(port_in_use(port), "持有 listener 时应判定为被占");
        drop(listener);
        assert!(!port_in_use(port), "释放后应判定为空闲");
    }

    #[test]
    fn conflict_message_absent_is_none() {
        assert!(conflict_message(false).is_none());
    }

    #[test]
    fn classify_user_cancel_maps_to_authorization_hint() {
        let msg = classify_install_failure("0:59: execution error: User canceled. (-128)");
        assert!(msg.contains("管理员密码"), "实际: {msg}");
        assert!(msg.contains("授权被取消"), "实际: {msg}");
        // 取消授权不该被归到任何具体安装步骤上。
        assert!(!msg.contains("launchctl 加载服务失败"), "实际: {msg}");
        assert!(!msg.contains("原始输出"), "实际: {msg}");
    }

    #[test]
    fn classify_takes_last_step_marker_bootstrap() {
        // 多条标记同时出现时取最后一条 —— 前面的步骤都已成功。
        let msg = classify_install_failure(
            "HGSTEP=mkdir\nHGSTEP=copybin\nHGSTEP=bootstrap\nBootstrap failed: 5",
        );
        assert!(msg.contains("launchctl 加载服务失败"), "实际: {msg}");
        assert!(msg.contains("Bootstrap failed: 5"), "实际: {msg}");
        assert!(!msg.contains("/usr/local/bin 失败"), "实际: {msg}");
    }

    #[test]
    fn classify_copybin_embeds_raw_output() {
        let msg = classify_install_failure(
            "HGSTEP=mkdir\nHGSTEP=copybin\ncp: /usr/local/bin/hg-macos: Permission denied\n",
        );
        assert!(msg.contains("/usr/local/bin 失败"), "实际: {msg}");
        assert!(
            msg.contains("cp: /usr/local/bin/hg-macos: Permission denied"),
            "实际: {msg}"
        );
        assert!(!msg.contains("launchctl 加载服务失败"), "实际: {msg}");
    }
}
