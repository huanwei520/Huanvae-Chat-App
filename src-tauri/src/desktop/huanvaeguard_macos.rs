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

use std::path::{Path, PathBuf};
use std::process::Command;

/// 安装后的守护进程二进制路径
const DAEMON_BIN_DST: &str = "/usr/local/bin/hg-macos";
/// 安装后的 LaunchDaemon plist 路径
const PLIST_DST: &str = "/Library/LaunchDaemons/com.huanvaeguard.daemon.plist";
/// 打包资源子目录名（与 tauri.macos.conf.json 的 resources 目标一致）
const RESOURCE_SUBDIR: &str = "HuanvaeGuard-macos";
/// 二进制 / plist 文件名（与 client/macos 产物一致）
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

/// 解析打包资源 → 校验存在 → 提权安装（`ensure_installed` / `repair` 共用）。
fn install() -> Result<(), String> {
    let res_dir = bundled_resource_dir()?;
    let bin = res_dir.join(BIN_NAME);
    let plist = res_dir.join(PLIST_NAME);
    if !bin.exists() || !plist.exists() {
        return Err(format!(
            "打包资源缺失：未找到 {} 或 {}",
            bin.display(),
            plist.display()
        ));
    }
    run_install_with_admin(&bin, &plist)
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
    //（不在 .app 内），资源在 <project>/src-tauri/resources/HuanvaeGuard-macos/
    if exe_dir.ends_with("debug") || exe_dir.ends_with("release") {
        let src_tauri = exe_dir
            .parent()
            .and_then(|p| p.parent())
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
/// 个人测试阶段对二进制 `xattr -dr com.apple.quarantine` 绕 Gatekeeper（无 Developer ID 公证）。
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
        "mkdir -p /usr/local/bin /var/log/huanvaeguard && \
         cp '{src_bin}' '{DAEMON_BIN_DST}' && chmod 755 '{DAEMON_BIN_DST}' && \
         xattr -dr com.apple.quarantine '{DAEMON_BIN_DST}' 2>/dev/null; \
         cp '{src_plist}' '{PLIST_DST}' && chown root:wheel '{PLIST_DST}' && chmod 644 '{PLIST_DST}' && \
         (launchctl bootout system '{PLIST_DST}' 2>/dev/null; launchctl bootstrap system '{PLIST_DST}')",
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
        Err(format!("提权安装失败（可能取消了授权）: {}", stderr.trim()))
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
}
