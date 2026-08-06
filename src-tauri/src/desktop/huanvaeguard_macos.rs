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
//!   - **装的是"本 App 自己的那一路实例"**：同一台机器上可以并存多路守护进程实例，
//!     安装时挑一个空闲的回环控制端口写进 plist（`--instance` / `--api-listen`），
//!     之后一律只跟这个端口说话 —— 端口被别人占住时不再拒装，也不会把别人的隧道
//!     当成自己的显示出来。端口真值以装好的 plist 为准，见 `control_port`。
//!
//! 二进制与 plist 由 `tauri.macos.conf.json` 打进 .app/Contents/Resources/HuanvaeGuard-macos/。

use std::net::{Ipv4Addr, TcpListener};
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;

/// 安装后的守护进程二进制路径
const DAEMON_BIN_DST: &str = "/usr/local/bin/hg-macos";
/// 安装后的 LaunchDaemon plist 路径
const PLIST_DST: &str = "/Library/LaunchDaemons/com.huanvaeguard.daemon.plist";
/// LaunchDaemon 的服务标签 —— `launchctl` 的 **service target** 用它寻址（`system/<label>`）。
///
/// **必须与打包 plist 模板里 `<key>Label</key>` 的取值完全一致**：不一致时
/// `launchctl enable system/<label>` 会作用在一个不存在的服务上（静默返回，不报错），
/// 随后的 bootstrap 照样被禁用 override 挡下，而错误信息里看不出任何线索。
/// 测试 `daemon_label_matches_bundled_plist_template` 把两者钉死。
const DAEMON_LABEL: &str = "com.huanvaeguard.daemon";
/// 守护进程本地控制端口（回环）的默认值。
///
/// 守护进程自身不带参数时也是绑这个端口，所以在"本机没有别的实例"的普通用户机上，
/// 装出来的仍然是 19198、零配置、与改造前完全一致；换端口只在真的撞车时才发生。
const DEFAULT_CONTROL_PORT: u16 = 19198;
/// 本地控制端口候选表（连续 10 个）：安装时**第一个空闲的**胜出。
///
/// 19198 排第一 → 常见情况（本机没有别的实例）选中的就是默认端口，行为不变；
/// 只有它被别的实例占住时才顺延，从而与对方各用各的端口、互不串台。
const CONTROL_PORT_CANDIDATES: [u16; 10] = [
    19198, 19199, 19200, 19201, 19202, 19203, 19204, 19205, 19206, 19207,
];
/// 本 App 安装的守护进程实例名（`--instance` 的取值）。
///
/// 除了让守护进程知道自己是哪一路，独立实例名也让它自己的滚动日志文件与其他实例分开，
/// 排查时不会把两路实例的日志混在一起。
const APP_INSTANCE_NAME: &str = "app";
/// 打包 plist 模板里的占位符：实例名 / 控制 API 监听地址，安装时由 `render_plist` 替换。
const PLIST_INSTANCE_PLACEHOLDER: &str = "__HG_INSTANCE__";
const PLIST_LISTEN_PLACEHOLDER: &str = "__HG_API_LISTEN__";
/// 打包资源子目录名（与 tauri.macos.conf.json 的 resources 目标一致）
const RESOURCE_SUBDIR: &str = "HuanvaeGuard-macos";
/// 二进制 / plist 文件名（与打包进 .app 的守护进程产物一致）
const BIN_NAME: &str = "hg-macos";
const PLIST_NAME: &str = "com.huanvaeguard.daemon.plist";
/// 渲染后 plist 的暂存目录名（挂在 `std::env::temp_dir()` 下），详见 `staging_dir`。
const STAGING_SUBDIR: &str = "huanvaeguard-install";

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

/// 解析打包资源 → 逐个校验存在 → 选控制端口 → 渲染 plist 到暂存区 → 提权安装
///（`ensure_installed` / `repair` 共用）。
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

    // 端口选择放在提权之前：一个空闲端口都挑不出来时装上去也起不来，
    // 不该先白弹一次管理员密码再失败。
    //
    // 已装 plist 里的端口优先复用，但**仅当它此刻空闲**：那是"重装 / 修复"的常态
    //（旧守护进程没在跑，端口是自己上次占的名额），沿用它可以让配置保持稳定；
    // 若它此刻被占（可能是别人抢了这个号，也可能是旧实例还活着），就另挑一个空闲的。
    let port = match installed_control_port() {
        Some(p) if !port_in_use(p) => p,
        _ => pick_free_port(port_in_use).ok_or_else(all_candidates_busy_message)?,
    };

    // 渲染在 Rust 侧完成（不新增提权步骤）：把占位符换成本次实例名 + 监听地址，
    // 落到用户私有暂存目录，再由提权命令把这份渲染件拷进 /Library/LaunchDaemons。
    let template = std::fs::read_to_string(&plist)
        .map_err(|e| format!("读取打包的 VPN 服务配置失败（{}）：{e}", plist.display()))?;
    let rendered = render_plist(&template, APP_INSTANCE_NAME, &format!("127.0.0.1:{port}"))?;
    let staged = write_staged_plist(&rendered)?;

    let result = run_install_with_admin(&bin, &staged);
    // 暂存件是一次性中间产物：成功失败都清掉，不给下次安装留下过期的渲染结果。
    let _ = std::fs::remove_file(&staged);
    result
}

/// 把渲染好的 plist 写进"当前用户私有"的暂存目录，返回暂存文件路径。
///
/// **为什么不是裸 /tmp**：提权命令里的 `cp` 是以 root 执行的，源路径若落在人人可写的
/// 位置，非 root 攻击者就能在"我们写完"和"root 拷走"之间把文件换掉 —— 那等于把 root
/// 写 /Library/LaunchDaemons 的能力送出去（提权漏洞）。macOS 上 `std::env::temp_dir()`
/// 解析到的是**每用户独立**的受限 `TMPDIR`（非共享 /tmp），再把子目录收到 0700，
/// 使这条替换路径关闭。
fn write_staged_plist(rendered: &str) -> Result<PathBuf, String> {
    let dir = staging_dir();
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("创建安装暂存目录失败（{}）：{e}", dir.display()))?;
    std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700))
        .map_err(|e| format!("收紧安装暂存目录权限失败（{}）：{e}", dir.display()))?;

    let path = dir.join(PLIST_NAME);
    std::fs::write(&path, rendered)
        .map_err(|e| format!("写入安装暂存文件失败（{}）：{e}", path.display()))?;
    Ok(path)
}

/// 渲染件暂存目录（每用户受限 TMPDIR 下的专属子目录），语义见 `write_staged_plist`。
fn staging_dir() -> PathBuf {
    std::env::temp_dir().join(STAGING_SUBDIR)
}

/// 本地控制端口是否已被占用：尝试 bind 一次，失败即视为被占。
///
/// 判据必须是"端口此刻是否真被占"，而不是"某个 plist 文件在不在"——文件留在盘上但
/// 未加载时端口其实空闲（据此判占 = 误报，白白把自己的端口顺延掉），端口被别的程序
/// 占住时按文件判定又会漏报（装完守护进程绑不上必崩）。bind 成功后立即 drop，不长期占用。
fn port_in_use(port: u16) -> bool {
    TcpListener::bind((Ipv4Addr::LOCALHOST, port)).is_err()
}

/// 从候选表里挑第一个空闲端口；全被占用返回 `None`。
///
/// "端口是否被占"以入参谓词形式注入 —— 这样纯函数本身可以不碰真实 socket 就单测到
/// "顺延到第几个""全占时如何"这些真正的判定逻辑。
fn pick_free_port(is_busy: impl Fn(u16) -> bool) -> Option<u16> {
    CONTROL_PORT_CANDIDATES
        .into_iter()
        .find(|&port| !is_busy(port))
}

/// 候选端口全被占用时的可操作提示。
///
/// 用户可见文案只讲端口区间与该怎么办，**不出现任何内部组件标签**（PUBLIC 仓红线）。
fn all_candidates_busy_message() -> String {
    let first = CONTROL_PORT_CANDIDATES[0];
    let last = CONTROL_PORT_CANDIDATES[CONTROL_PORT_CANDIDATES.len() - 1];
    format!(
        "本地控制端口 127.0.0.1:{first}-{last} 已全部被其他程序占用，\
         VPN 服务需要其中一个空闲端口才能启动，因此本次不做安装。\
         请先退出占用这些端口的程序后重试。"
    )
}

/// 从 plist XML 里读出控制 API 的监听端口。
///
/// 定位 `<string>--api-listen</string>` 元素，取**紧随其后**的 `<string>…</string>` 值
///（形如 `127.0.0.1:<port>`）的端口部分。以下三种情况一律返回 `None`：
///   - 还没替换的模板（值仍是占位符，不含 `host:port` 形状）；
///   - 根本没有 `--api-listen` 元素（老 plist / 手改过的 plist）；
///   - 端口部分解析不出数字。
///
/// 刻意只做字符串扫描：为读一个参数值引入 XML/plist 解析依赖不划算，而 plist 的
/// `ProgramArguments` 是我们自己渲染出来的、形状固定。
fn parse_api_listen_port(plist_xml: &str) -> Option<u16> {
    const FLAG: &str = "<string>--api-listen</string>";
    const OPEN: &str = "<string>";
    const CLOSE: &str = "</string>";

    let after_flag = &plist_xml[plist_xml.find(FLAG)? + FLAG.len()..];
    let value_start = after_flag.find(OPEN)? + OPEN.len();
    let rest = &after_flag[value_start..];
    let value = &rest[..rest.find(CLOSE)?];

    let (_host, port) = value.trim().rsplit_once(':')?;
    port.parse().ok()
}

/// 把 plist 模板里的两个占位符替换成本次安装的实例名与监听地址。
///
/// 占位符缺失即报错（不做"缺了就算了"的兜底）：那说明打包进 .app 的模板是过期 / 错误的，
/// 照装出去会让守护进程收到字面量 `__HG_…` 当参数 —— 要么起不来，要么绑到默认端口
/// 变成"App 显示的是别人家的隧道"。宁可在这里失败并让用户重装应用。
fn render_plist(template: &str, instance: &str, api_listen: &str) -> Result<String, String> {
    if !template.contains(PLIST_INSTANCE_PLACEHOLDER) {
        return Err(format!(
            "打包的 VPN 服务配置模板缺少占位符 {PLIST_INSTANCE_PLACEHOLDER}：\
             安装包内容异常，请重新下载并覆盖安装本应用。"
        ));
    }
    if !template.contains(PLIST_LISTEN_PLACEHOLDER) {
        return Err(format!(
            "打包的 VPN 服务配置模板缺少占位符 {PLIST_LISTEN_PLACEHOLDER}：\
             安装包内容异常，请重新下载并覆盖安装本应用。"
        ));
    }
    Ok(template
        .replace(PLIST_INSTANCE_PLACEHOLDER, instance)
        .replace(PLIST_LISTEN_PLACEHOLDER, api_listen))
}

/// 已装 plist 里**写明**的控制端口（全局可读，无需提权）。
///
/// 只回答"上次装的时候把端口写成了几"这一个问题：老版本 App 装的 plist 没有
/// `--api-listen`，这里就是 `None`，由 `install` 自己另挑一个空闲端口写进去。
/// 注意这**不是**"该连哪个端口"——那是 `control_port` 的判定，两者口径不同。
fn installed_control_port() -> Option<u16> {
    let xml = std::fs::read_to_string(PLIST_DST).ok()?;
    parse_api_listen_port(&xml)
}

/// "该连哪个本地控制端口"的判定规则（纯函数，便于单测）。
///
/// 入参把两件事分开问：`plist_xml` 是已装 plist 的内容（`None` = 根本没装），
/// `first_free` 是当前第一个空闲候选端口。`first_free` **只在没装时**被采纳。
///
/// 三种情况：
///   - **plist 在、且写了端口** → 就是那个端口（那份文件字面上决定守护进程绑哪儿）。
///   - **plist 在、但没写端口** → 老版本 App 装的，它启动的守护进程绑的是编译内置的
///     默认端口，所以答案是 `DEFAULT_CONTROL_PORT`。这里若改去挑"第一个空闲候选"，
///     恰恰会被自家老守护进程占着默认端口这一事实带偏（顺延到下一个），前端探不到
///     → 明明活着却报"服务未运行"，逼用户去点修复。
///   - **plist 不在** → 本机从没被本 App 装过守护进程，没有"我们的"实例可连，
///     给出"接下来会装到的那个端口"（第一个空闲候选），安装前后前端拿到同一个值。
///     **此处绝不能回落到默认端口**：默认端口此刻可能正被别人的实例占着，连上去
///     就是"把别人的隧道当成自己的显示出来"——本次改造要消灭的正是这个 bug。
///
/// 已知边界：没装且候选全被占时，最终仍回落到默认端口，而在这种极端争用的机器上
/// 那个端口可能属于别人的实例。接受这个残留（此时本来也装不上，`install` 会以
/// `all_candidates_busy_message` 明确失败），不为它再加一层无处可去的分支。
fn control_port_from_plist(plist_xml: Option<&str>, first_free: Option<u16>) -> u16 {
    match plist_xml {
        Some(xml) => parse_api_listen_port(xml).unwrap_or(DEFAULT_CONTROL_PORT),
        None => first_free.unwrap_or(DEFAULT_CONTROL_PORT),
    }
}

/// 本 App 该连的本地控制端口 —— 前端（`hg_local_control_port`）的唯一真值来源。
///
/// 薄封装：读一次 plist（读得到 = 装过），把真实入参喂给 `control_port_from_plist`，
/// 判定规则与其理由见那里。
pub fn control_port() -> u16 {
    let xml = std::fs::read_to_string(PLIST_DST).ok();
    // 只有"没装"这一支才会采纳空闲候选，装了就没必要白 bind 一轮候选端口去探。
    let first_free = if xml.is_none() {
        pick_free_port(port_in_use)
    } else {
        None
    };
    control_port_from_plist(xml.as_deref(), first_free)
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

/// 提权安装实际执行的那条 shell 命令串（纯函数，便于对**步骤顺序**做单测）。
///
/// 两个入参是已过 `path_is_shell_safe` 的源路径；命令语义、中止链与
/// bootout → enable → bootstrap 的顺序理由见 `run_install_with_admin` 的文档注释。
fn install_shell(src_bin: &str, src_plist: &str) -> String {
    format!(
        "echo HGSTEP=mkdir >&2; mkdir -p /usr/local/bin /var/log/huanvaeguard || exit 11; \
         echo HGSTEP=copybin >&2; cp '{src_bin}' '{DAEMON_BIN_DST}' || exit 12; \
         chmod 755 '{DAEMON_BIN_DST}' || exit 12; \
         xattr -dr com.apple.quarantine '{DAEMON_BIN_DST}' 2>/dev/null; \
         echo HGSTEP=copyplist >&2; cp '{src_plist}' '{PLIST_DST}' || exit 13; \
         chown root:wheel '{PLIST_DST}' || exit 13; chmod 644 '{PLIST_DST}' || exit 13; \
         echo HGSTEP=bootstrap >&2; launchctl bootout system '{PLIST_DST}' 2>/dev/null; \
         launchctl enable system/{DAEMON_LABEL}; \
         launchctl bootstrap system '{PLIST_DST}' || exit 14",
    )
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
/// 幂等：先 `launchctl bootout`（清可能残留的旧实例，未加载时报错被忽略）、再
/// `launchctl enable`（解除"服务被禁用"标记）、最后 `bootstrap`，这样半装 / 残留 / 被禁用
/// 状态下重跑都能成功（macOS 11+ 均支持 bootout/bootstrap）。
///
/// **为什么必须有 enable 这一步**：`launchctl bootstrap` 对至少四种完全不同的状况都只报
/// 同一句 `Bootstrap failed: 5: Input/output error`（逐一隔离实测）——
///   1. 服务已经加载；
///   2. 该标签在 launchd 的 override 库里被标记为**禁用**；
///   3. plist 属主不是 root:wheel；
///   4. plist 组 / 其他人可写。
///
/// 3 和 4 由上面的 `chown root:wheel` + `chmod 644` 排除，1 由 `bootout` 排除，唯独 2
/// **`bootout` 清不掉** —— bootout 只卸载"已加载"的服务，不碰 override 库。真因只在
/// launchd 自己的日志里说得出来：`failed (119: Service is disabled)`。用户在
/// 「系统设置 → 通用 → 登录项与扩展」里关掉本应用的后台项，或此前跑过 `launchctl disable` /
/// `launchctl unload -w`，都会落下这条 override；此后反复 bootout + bootstrap 永远失败
///（"安装/修复"按钮每次都失败就是这么来的），只有 `launchctl enable` 能解除。
///
/// enable 步**故意不进 `|| exit` 中止链**（与上面 xattr 同款豁免，写 `;` 收尾）：它只是
/// "清一个可能根本不存在的 override"，绝大多数机器上本就无 override 可清；真出问题时紧随
/// 其后的 bootstrap 会立刻失败并带出真实错误，让 enable 自己 `|| exit` 反而会用一个
/// 更含糊的失败盖掉后面那条更有信息量的。
///
/// 注意两者**寻址形式不同**：`enable` 收的是 **service target**（`system/<label>`，斜杠、
/// 用服务标签），而这里的 `bootout` / `bootstrap` 收的是 **domain + plist 路径**
///（`system <path>`，空格、用文件路径）——写混了命令会静默不生效或报参数错。
///
/// `staged_plist` 是**渲染后**的 plist（占位符已换成本次实例名 + 监听地址），位于
/// `write_staged_plist` 交代的私有暂存目录；这里拷的是它，不是打包资源里的模板。
fn run_install_with_admin(bin: &Path, staged_plist: &Path) -> Result<(), String> {
    let src_bin = bin.to_string_lossy();
    let src_plist = staged_plist.to_string_lossy();

    // 注入防护：路径整体单引号包裹是主防线，详见 path_is_shell_safe；含单引号则拒绝。
    // 暂存路径同样要过这道闸 —— 它由 TMPDIR（含用户名）推导，不是常量。
    if !path_is_shell_safe(&src_bin) || !path_is_shell_safe(&src_plist) {
        return Err("安装路径含单引号，拒绝执行提权安装".to_string());
    }

    let shell = install_shell(&src_bin, &src_plist);

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
        // 这一步的原始错误几乎总是泛化的 `Bootstrap failed: 5: Input/output error`，
        // 它把四种成因合并成一句（见 run_install_with_admin）。安装链已经把其中三种
        //（已加载 / 属主 / 权限）排除掉了，剩下唯一还可能剩下、且**只能由用户自己解**的
        // 是"这台机器把本应用的后台项关掉了"，所以文案直接给这条恢复路径，
        // 不再泛泛说"可能已有同名服务未卸载"（那种情况 bootout 早已处理，属误导）。
        Some("bootstrap") => format!(
            "文件已就位，但系统拒绝加载后台服务。请打开「系统设置 → 通用 → 登录项与扩展」，\
             把本应用的后台项重新启用，然后回来再点一次「安装/修复服务」。原始输出：{raw}"
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
    fn port_in_use_detects_occupied_then_free() {
        // 绑 0 号端口取一个临时端口：持有 listener 时应判为被占，drop 后应判为空闲。
        // 绝不探测真实的 19198 —— 不抢占本机既有服务。
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).expect("临时端口应可绑定");
        let port = listener.local_addr().expect("应能取到本地地址").port();
        assert!(port_in_use(port), "持有 listener 时应判定为被占");
        drop(listener);
        assert!(!port_in_use(port), "释放后应判定为空闲");
    }

    /// 打包进 .app 的 plist 模板本体：用它做渲染回环测试，
    /// 一旦发货的模板丢了占位符，这里立刻红。
    const BUNDLED_PLIST_TEMPLATE: &str =
        include_str!("../../resources/HuanvaeGuard-macos/com.huanvaeguard.daemon.plist");

    #[test]
    fn pick_free_port_takes_default_when_nothing_is_busy() {
        assert_eq!(pick_free_port(|_| false), Some(19198));
    }

    #[test]
    fn pick_free_port_skips_busy_candidates_in_order() {
        // 前三个被占 → 顺延到第四个候选，而不是随便挑一个。
        let busy = [19198_u16, 19199, 19200];
        assert_eq!(pick_free_port(|p| busy.contains(&p)), Some(19201));
    }

    #[test]
    fn pick_free_port_none_when_every_candidate_is_busy() {
        assert_eq!(pick_free_port(|_| true), None);
    }

    #[test]
    fn all_candidates_busy_message_names_range_and_no_internal_label() {
        let msg = all_candidates_busy_message();
        assert!(msg.contains("19198"), "实际: {msg}");
        assert!(msg.contains("19207"), "实际: {msg}");
        // 用户可见文案不许出现任何内部组件标签（PUBLIC 仓红线）。
        assert!(!msg.contains("com.huanvae"), "实际: {msg}");
    }

    #[test]
    fn parse_api_listen_port_reads_value_after_the_flag() {
        let xml = "<array><string>/usr/local/bin/hg-macos</string>\
                   <string>--api-listen</string><string>127.0.0.1:19203</string></array>";
        assert_eq!(parse_api_listen_port(xml), Some(19203));
    }

    #[test]
    fn parse_api_listen_port_rejects_unsubstituted_template() {
        // 模板里该位置还是占位符 —— 不能被当成"装好了、端口是 X"。
        assert_eq!(parse_api_listen_port(BUNDLED_PLIST_TEMPLATE), None);
    }

    #[test]
    fn parse_api_listen_port_none_without_the_flag() {
        // 有 host:port 形状的字符串，但没有 --api-listen 参数：不能瞎认。
        let xml = "<array><string>/usr/local/bin/hg-macos</string>\
                   <string>127.0.0.1:19198</string></array>";
        assert_eq!(parse_api_listen_port(xml), None);
    }

    #[test]
    fn parse_api_listen_port_none_for_non_numeric_port() {
        let xml = "<array><string>--api-listen</string>\
                   <string>127.0.0.1:not-a-port</string></array>";
        assert_eq!(parse_api_listen_port(xml), None);
    }

    #[test]
    fn render_plist_round_trips_bundled_template() {
        let rendered = render_plist(BUNDLED_PLIST_TEMPLATE, APP_INSTANCE_NAME, "127.0.0.1:19205")
            .expect("打包模板必须含两个占位符");
        // 渲染出来的东西，读回去必须还是同一个端口（这条链就是运行时真值链）。
        assert_eq!(parse_api_listen_port(&rendered), Some(19205));
        assert!(
            !rendered.contains("__HG_"),
            "渲染后不应残留占位符:\n{rendered}"
        );
        assert!(
            rendered.contains(&format!("<string>{APP_INSTANCE_NAME}</string>")),
            "渲染后应带上实例名:\n{rendered}"
        );
    }

    #[test]
    fn control_port_uses_port_named_by_installed_plist() {
        // 走真实渲染件（而不是手写字面量），这条判定才是骑在真格式上的。
        let rendered = render_plist(BUNDLED_PLIST_TEMPLATE, APP_INSTANCE_NAME, "127.0.0.1:19206")
            .expect("打包模板必须含两个占位符");
        // 同时喂一个"空闲候选"进去：装了就该以 plist 为准，不许被候选带偏。
        assert_eq!(control_port_from_plist(Some(&rendered), Some(19199)), 19206);
    }

    #[test]
    fn control_port_falls_back_to_default_for_legacy_install_without_flag() {
        // 老版本 App 装的 plist：ProgramArguments 只有二进制路径，
        // 它启动的守护进程绑的是编译内置默认端口。
        let legacy = "<key>ProgramArguments</key>\
                      <array><string>/usr/local/bin/hg-macos</string></array>";
        // 传进来的候选之所以是 19199，正是因为默认端口被那个老守护进程占着；
        // 若采信候选就会把活着的自家守护进程判成"未运行"。
        assert_eq!(control_port_from_plist(Some(legacy), Some(19199)), 19198);
    }

    #[test]
    fn control_port_without_plist_takes_first_free_never_the_default() {
        // 反回归守卫：没装 plist 时默认端口可能正被**别人家**的实例占着
        //（候选顺延到 19199 就是这么来的）。此时回落到默认端口 =
        // "App 把别人的隧道当成自己的显示出来"，正是本次改造要消灭的 bug。
        let got = control_port_from_plist(None, Some(19199));
        assert_eq!(got, 19199);
        assert_ne!(got, DEFAULT_CONTROL_PORT);
    }

    #[test]
    fn control_port_without_plist_and_no_free_candidate_falls_back_to_default() {
        assert_eq!(control_port_from_plist(None, None), 19198);
    }

    #[test]
    fn render_plist_errors_when_instance_placeholder_missing() {
        let stale = "<array><string>--api-listen</string>\
                     <string>__HG_API_LISTEN__</string></array>";
        let err = render_plist(stale, APP_INSTANCE_NAME, "127.0.0.1:19198")
            .expect_err("缺实例占位符必须报错");
        assert!(err.contains(PLIST_INSTANCE_PLACEHOLDER), "实际: {err}");
        // 只该点名真正缺的那个，否则用户无从判断模板哪里不对。
        assert!(!err.contains(PLIST_LISTEN_PLACEHOLDER), "实际: {err}");
    }

    #[test]
    fn render_plist_errors_when_listen_placeholder_missing() {
        let stale = "<array><string>--instance</string>\
                     <string>__HG_INSTANCE__</string></array>";
        let err = render_plist(stale, APP_INSTANCE_NAME, "127.0.0.1:19198")
            .expect_err("缺监听占位符必须报错");
        assert!(err.contains(PLIST_LISTEN_PLACEHOLDER), "实际: {err}");
        assert!(!err.contains(PLIST_INSTANCE_PLACEHOLDER), "实际: {err}");
    }

    #[test]
    fn classify_user_cancel_maps_to_authorization_hint() {
        let msg = classify_install_failure("0:59: execution error: User canceled. (-128)");
        assert!(msg.contains("管理员密码"), "实际: {msg}");
        assert!(msg.contains("授权被取消"), "实际: {msg}");
        // 取消授权不该被归到任何具体安装步骤上。
        assert!(!msg.contains("系统拒绝加载后台服务"), "实际: {msg}");
        assert!(!msg.contains("原始输出"), "实际: {msg}");
    }

    #[test]
    fn classify_takes_last_step_marker_bootstrap() {
        // 多条标记同时出现时取最后一条 —— 前面的步骤都已成功。
        let msg = classify_install_failure(
            "HGSTEP=mkdir\nHGSTEP=copybin\nHGSTEP=bootstrap\nBootstrap failed: 5",
        );
        assert!(msg.contains("系统拒绝加载后台服务"), "实际: {msg}");
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
        assert!(!msg.contains("系统拒绝加载后台服务"), "实际: {msg}");
    }

    // ── 以下四条守 2026-08-06 那次 P0：「安装/修复」按钮每次都失败 ──────────────
    // 真因是两件互相独立的事凑在一起：launchd 侧的禁用 override 让 bootstrap 恒失败，
    // 以及发货的守护进程二进制是不认识 `--api-listen` 的旧构建。两者各配一条守卫。

    /// 从 plist XML 里取 `<key>Label</key>` **紧随其后**的 `<string>…</string>` 值。
    ///
    /// 与 `parse_api_listen_port` 同款字符串扫描：plist 是我们自己写的、形状固定，
    /// 为读一个键值引入 XML 解析依赖不划算。
    fn parse_plist_label(xml: &str) -> Option<&str> {
        const KEY: &str = "<key>Label</key>";
        const OPEN: &str = "<string>";
        const CLOSE: &str = "</string>";

        let after_key = &xml[xml.find(KEY)? + KEY.len()..];
        let value_start = after_key.find(OPEN)? + OPEN.len();
        let rest = &after_key[value_start..];
        Some(rest[..rest.find(CLOSE)?].trim())
    }

    /// 扫出 plist 里所有"以 `--` 开头"的 `<string>` 值 = 实际传给守护进程的命令行开关。
    fn plist_flag_arguments(xml: &str) -> Vec<&str> {
        const OPEN: &str = "<string>";
        const CLOSE: &str = "</string>";

        let mut flags = Vec::new();
        let mut rest: &str = xml;
        while let Some(open_at) = rest.find(OPEN) {
            let after_open = &rest[open_at + OPEN.len()..];
            let Some(close_at) = after_open.find(CLOSE) else {
                break;
            };
            let value = after_open[..close_at].trim();
            if value.starts_with("--") {
                flags.push(value);
            }
            rest = &after_open[close_at + CLOSE.len()..];
        }
        flags
    }

    /// 打包进 .app 的守护进程二进制本体（发货件），按字节读。
    ///
    /// 刻意不做 UTF-8 转换 —— 它是 Mach-O，转不成字符串。
    fn bundled_daemon_bytes() -> Vec<u8> {
        const PATH: &str = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/resources/HuanvaeGuard-macos/hg-macos"
        );
        std::fs::read(PATH).unwrap_or_else(|e| panic!("读取打包守护进程二进制失败（{PATH}）：{e}"))
    }

    fn contains_bytes(haystack: &[u8], needle: &[u8]) -> bool {
        haystack.windows(needle.len()).any(|w| w == needle)
    }

    #[test]
    fn daemon_label_matches_bundled_plist_template() {
        // DAEMON_LABEL 只在 `launchctl enable system/<label>` 里出现，而 enable 对不存在的
        // 服务标签是**静默成功**的 —— 两边写歪了不会有任何报错，只会表现为"修复还是失败"。
        let label = parse_plist_label(BUNDLED_PLIST_TEMPLATE).expect("打包模板必须有 Label 键");
        assert_eq!(
            label, DAEMON_LABEL,
            "enable 用的服务标签必须与打包 plist 的 Label 一致"
        );
    }

    #[test]
    fn install_shell_enables_service_between_bootout_and_bootstrap() {
        let shell = install_shell(
            "/tmp/src/hg-macos",
            "/tmp/staged/com.huanvaeguard.daemon.plist",
        );

        let bootout = shell
            .find("launchctl bootout")
            .expect("提权安装必须先 bootout 清残留");
        let enable = shell
            .find(&format!("launchctl enable system/{DAEMON_LABEL}"))
            .expect("提权安装必须显式 enable 服务标签，否则禁用 override 让 bootstrap 恒失败");
        let bootstrap = shell
            .find("launchctl bootstrap")
            .expect("提权安装必须 bootstrap 加载服务");

        // 顺序就是这条修复的全部：enable 排在 bootstrap **之后**等于没解除 override，
        // 本次 bootstrap 照样失败（下次安装才受益）—— 所以断言的是相对位置，不是"出现过"。
        assert!(
            bootout < enable,
            "enable 应在 bootout 之后（先卸载再解禁）：\n{shell}"
        );
        assert!(
            enable < bootstrap,
            "enable 必须在 bootstrap 之前，否则本次加载仍被禁用 override 挡下：\n{shell}"
        );
    }

    #[test]
    fn bundled_daemon_binary_understands_every_flag_in_bundled_plist() {
        // 发过一次事故：plist 传了 `--api-listen`，打包的却是不认识该开关的旧构建 →
        // 守护进程启动即退 → KeepAlive 崩溃循环 → 用户点多少次「修复」都没用，
        // 而安装链本身每一步都"成功"，没有任何地方会报错。这条把"plist 写的开关"
        // 与"发货二进制真认识的开关"钉在一起。
        let flags = plist_flag_arguments(BUNDLED_PLIST_TEMPLATE);
        assert!(
            !flags.is_empty(),
            "没从打包 plist 扫出任何 `--` 开头的参数：扫描逻辑或模板格式变了。\
             此时下面的逐个断言会空转通过（假测试），必须先修扫描再谈这条测试的结论"
        );
        assert!(
            flags.contains(&"--api-listen"),
            "扫描结果里没有 --api-listen（实际扫到 {flags:?}）：\
             它正是当年翻车的那个开关，丢了它这条守卫就失去了核心覆盖"
        );

        let bin = bundled_daemon_bytes();
        for flag in flags {
            assert!(
                contains_bytes(&bin, flag.as_bytes()),
                "打包的守护进程二进制里找不到开关 {flag}：发货的是不认识该开关的旧构建，\
                 装上去必然起不来"
            );
        }
    }

    #[test]
    fn bundled_daemon_binary_leaks_no_build_host_paths() {
        // 本仓是 PUBLIC 仓，这个二进制既进仓也随 release 产物发出去。编译机的绝对路径
        // 会被 rustc 烘进 panic 位置等元数据里，泄露的是构建机的目录布局（含用户名）。
        // 发货前必须已做路径重映射（--remap-path-prefix），这条守卫替脱敏核把这一项常态化。
        let bin = bundled_daemon_bytes();
        for leak in [&b"/Users/"[..], b"/home/", b"C:\\Users"] {
            assert!(
                !contains_bytes(&bin, leak),
                "打包的守护进程二进制里烘进了编译机绝对路径片段 {}：\
                 PUBLIC 仓发货件必须先做路径重映射再放进来",
                String::from_utf8_lossy(leak)
            );
        }
    }

    #[test]
    fn classify_bootstrap_failure_points_at_login_items_recovery() {
        let msg = classify_install_failure(
            "HGSTEP=copyplist\nHGSTEP=bootstrap\nBootstrap failed: 5: Input/output error",
        );
        // error 5 把四种成因合成一句，其中安装链没法自己解决、只能由用户动手的那种，
        // 就是"后台项被关掉"（launchd 记的禁用 override）。文案必须给出这条具体路径。
        assert!(msg.contains("系统设置"), "实际: {msg}");
        assert!(msg.contains("登录项与扩展"), "实际: {msg}");
        // 原始输出必须留着 —— 上面那条路径解不了时，它是唯一还能往下查的线索。
        assert!(
            msg.contains("Bootstrap failed: 5: Input/output error"),
            "实际: {msg}"
        );
        // 用户可见文案不许出现任何内部组件标签（PUBLIC 仓红线）。
        assert!(!msg.contains("com.huanvae"), "实际: {msg}");
    }
}
