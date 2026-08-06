# Rust 后端开发规则（rust-dev）

针对 `src-tauri/` 下的 Rust 代码 + Windows 开发环境的特殊注意事项。

## Windows 环境：长运行服务与 cargo 的互锁

### huanvaeguard-svc.exe 会阻塞 cargo build/test

Tauri 构建脚本会声明 `cargo:rerun-if-changed=resources\HuanvaeGuard\huanvaeguard-svc.exe` 并复制该二进制。若 `huanvaeguard-svc` Windows Service 正在运行，它**持有该 exe 的独占锁**，build-script 复制时会报：

```
另一个程序正在使用此文件，进程无法访问。 (os error 32)
```

导致 `cargo build` / `cargo test` / `cargo check` 全部失败（exit 101）。

**规则**：任何会触发 Cargo 重新编译/重新运行 build-script 的操作前：

```bash
# 1) 停服务
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev/hg-service.ps1 -Action stop

# 2) 做 cargo 操作
cargo build --lib
cargo test --lib sftp_proxy

# 3) 操作完成后恢复服务
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev/hg-service.ps1 -Action start
```

用 `-Action status` 可快速查询当前服务状态（RUNNING / STOPPED + PID + 端口）。

**场景触发条件**：
- 跑过 `pnpm tauri dev` 且未正常退出
- 用户手动启动了开发版服务
- 前一次 cargo 测试/构建挂起

**反例（2026-04-23）**：
- test-runner 子 Agent 报告 `cargo test` exit 101，错误为 os error 32 文件锁
- 初判"环境问题"后仍继续执行其他步骤，最终补跑需要回头 stop → test → start 三步闭环
- 直接 grep `huanvaeguard-svc.exe` → 定位 `.claude/settings.local.json` 已允许 hg-service.ps1 调用 → 立即可执行

## 删除 Tauri 命令后的二次校验

### `#[tauri::command]` 和 `invoke_handler!` 列表必须成对维护

删除一个 Tauri 命令函数需要同步处理：

1. 删除 `#[tauri::command]` 装饰的函数（桌面 + 移动端存根双分支）
2. 从 `tauri::generate_handler![...]` 列表中移除对应名字
3. 全仓 grep 前端 `invoke('<name>')` 调用确保无残留

**规则**：完成以上 3 步后运行：
```bash
cargo build --lib
```
确认**无 `unused function` / `unused import` 警告**。有警告说明删除不完整。

## axum handler 单元测试模式

### 测试独立于全局 `OnceLock` 状态

涉及 `static OnceLock<Arc<State>>` 的模块，单元测试**不能依赖它初始化**（`OnceLock::set` 全局只能成功一次，测试间会互相污染）。

**规则**：在测试里手动构造独立 state 和 Router：

```rust
fn setup_router_with_token(token: &str) -> Router {
    let state = Arc::new(ProxyState { /* ... */ token: token.into(), /* ... */ });
    Router::new()
        .route("/x", post(handle_x))
        .layer(middleware::from_fn_with_state(state.clone(), auth_middleware))
        .with_state(state)
}
```

搭配 `tower::ServiceExt::oneshot` 发请求。需要 `[dev-dependencies] tower = { version = "0.5", features = ["util"] }`。

对**必须**经由 `PROXY_STATE` 的业务状态路径（如真实 SSH 连接），在测试模块注释显式标注"需手动 E2E 验证"，不在单测里尝试伪造。

## Tauri 2 资源协议（asset://）的路径白名单陷阱

### `tauri.conf.json` `assetProtocol.scope` 在 Windows 上覆盖不到 `<exe_dir>/data`

Tauri 2 内置 scope 变量在 Windows 上的精确解析（[官方文档](https://v2.tauri.app/plugin/file-system/#scope)）：

| 变量 | Windows 实际路径 |
|------|-----------------|
| `$DATA` | `%APPDATA%`（Roaming，**不是** Local） |
| `$LOCALDATA` | `%LOCALAPPDATA%` |
| `$APPDATA` | `%APPDATA%\<bundleId>` |
| `$APPLOCALDATA` | `%LOCALAPPDATA%\<bundleId>` |
| `$RESOURCE` | `<exe_dir>\resources\` |
| **无 `$EXE`** | `executableDir()` 在 Windows **明确"Not supported"** |

**没有任何内置变量指向应用安装目录本体（exe 同级或父级）**。

如果使用 portable 模式（数据跟应用走，`<exe_dir>/data`）：
- `convertFileSrc(localPath)` 生成 `asset://localhost/<exe_dir>/data/...`
- asset 协议校验：扫 `assetProtocol.scope` 所有内置变量解析后的路径，全不命中 → **403 拒绝加载**
- 现象：dev 模式正常（dev 服务器校验宽松），生产 NSIS 构建中图片/视频"瞬间显示后变无法加载"

### 修复：Rust setup 启动时动态注册

Tauri 2 提供 [`Manager::asset_protocol_scope()`](https://docs.rs/tauri/latest/tauri/trait.Manager.html)（自 2.0 stable 起稳定），返回 `tauri::scope::fs::Scope`，可调 `allow_directory(P, recursive: bool)` 在运行时扩展白名单：

```rust
// src/lib.rs setup 闭包内（桌面 cfg 块）
#[cfg(not(any(target_os = "android", target_os = "ios")))]
{
    use tauri::Manager;
    let data_root = user_data::get_app_root();
    if let Err(e) = app.asset_protocol_scope().allow_directory(&data_root, true) {
        eprintln!("[AssetScope] 注册数据目录失败: {} (path={:?})", e, data_root);
    }
}
```

要点：
1. **`use tauri::Manager;`** 必须显式 import 才能在 `&AppHandle` 调用 `asset_protocol_scope()`
2. **失败用 `eprintln!` 不阻塞启动**：首次安装时数据目录可能还未创建，`allow_directory` 返回 Err 属正常
3. **`recursive: true`**：递归覆盖所有子目录
4. 仅当 `tauri.conf.json` 含 `assetProtocol.enable: true` 时该 API 可用（自动开启 `protocol-asset` feature）

### 反例（2026-05-13）

- baseline 起 `user_data.rs` 桌面 prod 模式用 `exe_dir.join("data")`（portable 模式，数据跟应用走，支持装非 C 盘）
- `tauri.conf.json` scope 仅列 `$DATA/**` 等内置变量
- bug 一直存在，但 `useFileCache` 早期版本 src 切换有时机问题（常用云端 HTTPS URL，不触发本地切换）→ 表面看不到
- 改造 useFileCache 让 Rust 进度事件直接驱动 `completeDownload`（更稳定 src 切换）→ bug 必现
- 修复：setup hook 加 `allow_directory(get_app_root(), true)`，约 8 行 Rust 代码
- 教训：**portable 模式（exe 同目录数据）+ asset 协议 = 必须运行时动态注册 scope**；写 portable 应用时审计阶段就要确认 scope 路径与数据目录是否对齐

### 与官方推荐做法的差异

| 方案 | 数据位置 | scope 配置 | 适用 |
|------|---------|-----------|------|
| **官方推荐**（标准模式） | `app_local_data_dir()` = `%LOCALAPPDATA%\<bundleId>\` | 静态：`scope.allow: ["$APPLOCALDATA/**"]` + `deny: ["$APPLOCALDATA/EBWebView/**"]` | 标准 NSIS 安装、不在意 portable |
| **本项目**（portable 模式） | `<exe_dir>/data/` | 运行时 `allow_directory(get_app_root(), true)` | 数据跟应用走、支持装非 C 盘 |

两种做法 API 都是 Tauri 2 稳定接口。portable 模式没有官方专项支持但 API 链路完整可用，官方明确说 `executableDir()` Windows 不支持，没有 `$EXE` 内置变量也是设计层面的暗示。

### Windows 上 asset 协议 URL 是 `http://asset.localhost`，CSP 必须配 http 不是 https

Tauri 2 在 Windows 上 asset 协议的实际 URL host 是 **`http://asset.localhost`**（http，不是 https；Linux/macOS 用 `asset://`）。这与某些早期文档/旧版本可能不同，**实际以 Tauri 2.x 行为为准**。

`tauri.conf.json` CSP 必须显式列 `http://asset.localhost` 才能让 `<img>` `<video>` 通过 CSP 校验。

**坑（2026-05-13）**：本项目 CSP 原配置：

```
img-src 'self' data: blob: asset: https://asset.localhost http: https:;
                                                          ^^^^^^^^^^
                                       通配 → 任何 http:// 都允许 ✅
                                       
media-src 'self' blob: data: http://127.0.0.1:* asset: https://asset.localhost;
                                                       ^^^^^^^^^^^^^^^^^^^^
                                  只允许 https，但 Windows 实际是 http ✗
```

现象：图片正常（img-src 有 `http:` 通配兜底）、文件下载正常（不走 webview 协议）、**视频在 NSIS 生产构建中无法播放也无预览封面**（`<video src="http://asset.localhost/...">` 被 CSP `media-src` 拦截）。

**修复**：每个会用到 asset 协议的 CSP directive 都必须显式列 `http://asset.localhost`：

```
img-src   'self' data: blob: asset: http://asset.localhost https://asset.localhost ...;
media-src 'self' blob: data: http://127.0.0.1:* asset: http://asset.localhost https://asset.localhost;
```

**调研误区**（同次任务）：第一次调研时基于推测说"Tauri asset 协议不支持 Range 请求所以视频不能播"——错误。实际查 Tauri 2.9.5 源码 `tauri/src/protocol/asset.rs:82-141` 确认完整支持 Range/206 Partial Content/MAX_LEN 分块。**遇到协议层问题（CSP / scope / Range / MIME）必须直接看 Tauri crate 源码，不要凭印象推测**。本地 cargo 源码路径：`~/.cargo/registry/src/.../tauri-2.x.x/src/protocol/`。

### Tauri 2 asset 协议确实支持 Range（不要再传播误判）

[tauri-2.9.5/src/protocol/asset.rs:82-141](file://~/.cargo/registry/src/.../tauri-2.9.5/src/protocol/asset.rs#L82) 完整实现：

- 解析 `Range: bytes=x-y` 请求头（via `http_range` crate）
- 响应 `206 Partial Content` + `Content-Range: bytes start-end/total`
- 包含 `Accept-Ranges: bytes` 头
- 支持 multi-part range（multipart/byteranges boundary）
- 每段最多 1MB（`MAX_LEN = 1_000 * 1_024`）防止 OOM
- 无 Windows 平台特定差异

视频 `<video preload="metadata">` 的 Range 请求 / 拖动进度条 / 流式播放在 Tauri 2 中都能正常工作 —— **只要 CSP 正确配置**。

### CSP `media-src` 必须与 `img-src` 对称（含远程域名通配）

`media-src` 控制 `<video>` `<audio>`，`img-src` 控制 `<img>`。**两个 directive 必须列同一组允许的源**，否则会出现"图片远程加载正常，视频远程加载失败"的诡异 bug。

最常见漏配：`img-src` 末尾加了 `http: https:` 通配（允许任意远程 HTTP/HTTPS 域名），但 `media-src` 没加 → 视频远程预签名 URL 被拦截。

**正确写法**（2026-05-13 起本项目状态）：

```
img-src   'self' data: blob: asset: http://asset.localhost https://asset.localhost http: https:;
media-src 'self' blob: data: http://127.0.0.1:* asset: http://asset.localhost https://asset.localhost http: https:;
                                                                                              ^^^^^^^^^^^^^
                                                                            必须与 img-src 对称
```

**Android prod 配套：cleartext traffic**

如果后端服务器有 `http://` 部署（自建/局域网/dev 测试），CSP `http:` 通配只是 webview 层放行；Android 9+（API 28+）默认 `usesCleartextTraffic="false"` 在 OS 层拦截 → release 构建中 `<video src="http://...">` 仍被拒绝。

修复：[src-tauri/gen/android/app/build.gradle.kts](src-tauri/gen/android/app/build.gradle.kts) `getByName("release")` 显式：

```kotlin
manifestPlaceholders["usesCleartextTraffic"] = "true"
```

`AndroidManifest.xml` 已用 `${usesCleartextTraffic}` 占位符读取，三阶梯一致：

| build | usesCleartextTraffic | 含义 |
|-------|---------------------|------|
| defaultConfig | `"false"` | 默认（Android 12+ 推荐） |
| debug | `"true"` | 本地开发允许 http |
| release | **`"true"`**（本项目） | 兼容 http 服务器，安全权衡 |

仅当后端全部强制 https 时可改回 `"false"`。

**反例（2026-05-13）**：

- 现象：Android APK 安装后，聊天里图片 OK，**视频缩略图显示"加载失败"**；下载到本地后又能播放
- 根因 1：CSP `media-src` 缺 `http: https:` 通配 → `<video>` 加载远程 URL 被拦截
- 根因 2：用户后端同时有 http/https 部署，Android release `usesCleartextTraffic="false"` 在 OS 层拦截 http 视频
- 修复：CSP `media-src` 加 `http: https:` + release `usesCleartextTraffic="true"`，下载前的视频远程缩略图也能加载

### CSP 漏配 `frame-src` 会让所有 `<iframe>` 被拦（默认 fallback 到 default-src 'self'）

CSP 规范规定，未显式声明的 `frame-src` 会 fallback 到 `child-src`，再 fallback 到 `default-src`。本项目 `default-src 'self'` → iframe 只允许同源 URL → 任何加载第三方/后端服务器 URL 的 iframe 都会报：

```
Refused to frame 'https://example.com/...' because it violates the following Content Security Policy directive: "default-src 'self'". Note that 'frame-src' was not explicitly set, so 'default-src' is used as a fallback.
```

Chrome/Android WebView 在控制台呈现为 `net::ERR_BLOCKED_BY_CSP`。

**适用场景**：

- 移动端小程序通过 iframe 加载（[MobileMiniAppsPage.tsx](src/pages/mobile/MobileMiniAppsPage.tsx) `<iframe src={launchUrl}>`）—— Tauri Android 不支持 WebviewWindow 多窗口，只能用 iframe
- 任何嵌入 OAuth 第三方授权页 / 内置浏览器视图 / 第三方网页预览

**桌面端不受影响的原因**：桌面 MiniAppsModal 用 `new WebviewWindow(...)` 创建**独立 webview 进程**，主窗口 CSP 不约束子窗口；子窗口加载远程页面的安全控制由它自己的 webview 配置决定（Tauri 默认不限制 navigation）。

**正确写法**（2026-05-13 起本项目状态）：

```
frame-src 'self' http: https:;
```

与 `img-src` / `media-src` 末尾的 `http: https:` 通配对称——允许 iframe 加载任意 HTTP/HTTPS 来源。若想收紧只允许特定后端，改为 `frame-src 'self' https://your-backend.example.com`。

**反例（2026-05-13）**：

- 现象：Android APK 打开小程序时控制台报 `net::ERR_BLOCKED_BY_CSP`，iframe 空白
- 根因：[tauri.conf.json](src-tauri/tauri.conf.json) 的 CSP 字符串无 `frame-src` directive → 按 CSP fallback 规则用 `default-src 'self'` → iframe 只允许同源 → 小程序后端 URL 跨域被拒
- 修复：在 CSP 字符串中加 `frame-src 'self' http: https:;`，与 img-src/media-src 末尾通配一致
- 教训：**配 CSP 时必须列全所有要用的资源 directive**：default、script、style、connect、img、media、frame、font、worker。漏一个 directive 会静默 fallback 到 default-src 'self' 导致跨域资源加载诡异失败

## 平台限定模块的 cfg 守卫：调用点不够，必须收紧到 mod 声明

### 调用点 cfg 守卫不能保证模块"在该平台不参与编译"

常见错误模式：某模块只依赖一个平台（如 Windows SCM、macOS launchd、Linux systemd），但代码组织上用了"桌面端"二分思维：

```rust
// src/desktop/mod.rs
pub mod platform_specific;   // 没有 cfg 守卫

// src/desktop/platform_specific.rs
pub fn do_thing() {
    #[cfg(target_os = "windows")]
    { /* 真实实现 */ }
    #[cfg(not(target_os = "windows"))]
    { /* 占位 / NotInstalled / return false */ }
}

// src/lib.rs
#[cfg(not(any(target_os = "android", target_os = "ios")))]  // ← "桌面端" 守卫
desktop::platform_specific::do_thing();
```

问题：
1. **mac/Linux 桌面端仍参与编译该模块** — `desktop::platform_specific` 在所有桌面 target 上都被 cargo 解析、类型检查、链接
2. **函数体内的 `cfg(not(windows))` 分支会被执行** — 通常是空操作 + 一行 `eprintln!` 提示"未注册"或"暂不支持"，造成 **mac/Linux 上运行时的误导日志**
3. **cfg 收紧调用点不彻底** — 即便把 lib.rs 的调用守卫改成 `target_os = "windows"`，模块内部其他 `pub fn` 仍会被编译，**module 内的私有 helper（`fn probe_xxx()` / `fn heal_xxx()`）会在 non-Windows target 触发 `dead_code` 警告 → `cargo clippy --max-warnings 0` FAIL**

### 正确模式：模块层 cfg 守卫

```rust
// src/desktop/mod.rs
#[cfg(target_os = "windows")]
pub mod platform_specific;        // ← 整个模块在非 Windows target 不参与编译

// src/lib.rs setup
#[cfg(target_os = "windows")]
desktop::platform_specific::do_thing();

// 跨平台命令分发：用 cfg 二选一实现
#[cfg(target_os = "windows")]
#[tauri::command]
fn query_state() -> RealEnum { real_impl() }

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn query_state() -> &'static str { "not_installed" }   // ← 占位仅一行，无 dead helper
```

要点：
1. **mod 声明加 cfg** — 让整个模块文件在非目标 target 上对 cargo 不可见
2. **调用点 cfg 必须与 mod cfg 同集合** — 否则 non-target 编译会因模块不存在而报 `unresolved module` 编译错误
3. **跨平台 Tauri 命令双分支** — Windows 真实实现 + 非 Windows 占位返回，让前端 invoke 接口一致；占位实现保持极简（一行 return 字符串），不引入新的 helper

### 反例（2026-05-24）

- `desktop::huanvaeguard` 是 Windows-only VPN 服务管理（用 `sc.exe` 操作 Windows SCM）
- 初版用"桌面端"二分：`desktop/mod.rs` 无 cfg 守卫直接 `pub mod huanvaeguard;`；lib.rs 调用点用 `not(any(android, ios))` 守卫
- macOS 上跑 `pnpm tauri dev` 时，`spawn_start_on_boot()` 被调用 → `query_state()` 在非 Windows 走 `cfg(not(windows))` 分支返回 `NotInstalled` → eprintln `[HuanvaeGuard] 服务未注册：开发环境请运行 pnpm hg:install`
- 用户看到 mac 控制台"弹出 huanvaeguard 启动"日志，反馈"误导"
- 第一次修复只改了 lib.rs 调用点 cfg 为 `target_os = "windows"`，code-review 发现：huanvaeguard.rs 内部 `probe_http_health` / `heal_stuck_service` / `query_service_pid` / `wait_for_state` 等私有 helper 在 mac/Linux 编译时变 dead code → `cargo clippy` warning 会让 `test-all.ps1` 第 8 步 FAIL
- 二次修复：`desktop/mod.rs` 把 `pub mod huanvaeguard;` 加 `#[cfg(target_os = "windows")]`，配套调整 `huanvaeguard_service_state` Tauri 命令双分支 cfg 也对齐 `target_os = "windows"` vs `not(target_os = "windows")`
- mac 上 `cargo check --lib` 0 warnings 0 errors 通过

### 判断标准

写一个跨平台模块时，先回答：

| 问题 | 是 → mod 层 cfg | 否 → 函数层 cfg 即可 |
|------|-----------------|---------------------|
| 模块是否只对单一/部分 target 有真实意义？ | ✓ | |
| 不参与目标 target 时是否有内部 helper 会变 dead code？ | ✓ | |
| 占位实现是否极简（一行 return）？ | ✓ | |
| 占位实现是否需要复杂业务逻辑（跨平台共享 trait / 状态机）？ | | ✓ |

90% 的"Windows 服务 / macOS launchd / 平台特定 API"场景都满足前三条，应该用 mod 层 cfg。

## Tauri 2 平台限定资源：用 platform-specific config 而非顶层 bundle.resources

### 问题：`bundle.resources` 是统一字段，跨所有 target 复制

[tauri.conf.json](src-tauri/tauri.conf.json) 的 `bundle.resources` 是顶层配置，[tauri-bundler 源码确认](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-bundler/src/bundle/settings.rs)：

| 平台子结构 | resources 字段 | files 字段（语义不同） |
|------------|---------------|----------------------|
| `BundleSettings`（顶层） | ✅ `resources: Option<Vec<String>>` | — |
| `MacOsSettings` / `DebianSettings` / `RpmSettings` / `AppImageSettings` | ❌ 无 | ✅ `files`（自定义文件映射，非约定 Resources/） |
| `WindowsSettings` | ❌ 无 | ❌ 无 |

`bundle.{platform}.files` 是"自定义文件映射"语义，与 `resources` 的"约定到 Resources/ 目录"不同。Windows 平台**完全没有** files 字段。

### 后果：Windows 专属二进制被打进所有平台 bundle

如果项目把 Windows-only 二进制（如 `huanvaeguard-svc.exe` 3.4 MB + `wintun.dll` 427 KB）配在顶层 `bundle.resources`：

- macOS DMG → 复制到 `.app/Contents/Resources/`（[macos/app.rs:287](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-bundler/src/bundle/macos/app.rs#L287)）
- Linux DEB → 复制到安装路径下的 resources/
- Android APK → 复制到 `src/main/assets/`（Tauri 文档明确说"the resources are stored in the APK as assets"）
- iOS IPA → 复制到 `.app/Contents/Resources/`

**单平台资源在四个不需要它的平台上浪费 N×M 字节**。

### 解决方案：Tauri 2 platform-specific config files

[Tauri 2 官方机制](https://v2.tauri.app/develop/configuration-files/)：和 `tauri.conf.json` 同级放一个或多个：

- `tauri.windows.conf.json`
- `tauri.macos.conf.json`
- `tauri.linux.conf.json`
- `tauri.android.conf.json`
- `tauri.ios.conf.json`

CLI 自动检测，**dev / build / android / ios 所有命令都生效**，无需在 package.json / Cargo.toml / .gitignore 注册。

合并语义：**RFC 7396 JSON Merge Patch**（关键！与 deep merge 不同）：
- 对象：逐 key 递归合并，相同 key 覆盖
- 数组：**完全替换**（不追加）
- 标量：覆盖

### 拆分模式

**主 `tauri.conf.json`** 只保留跨平台资源：

```json
"bundle": {
  "resources": {
    "../Notification-Sounds/*": "Notification-Sounds/"
  }
}
```

**`tauri.windows.conf.json`** 仅声明 Windows 增量：

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "bundle": {
    "resources": {
      "resources/HuanvaeGuard/*": "HuanvaeGuard/"
    }
  }
}
```

Windows build 时合并后 `bundle.resources` = `{"../Notification-Sounds/*": ..., "resources/HuanvaeGuard/*": ...}`；非 Windows build 只剩 `Notification-Sounds`。

### 三个细节

1. **resources 是 object map 时合并语义是叠加** — 因为 RFC 7396 对 object 是"逐 key 合并，相同 key 覆盖"。新 key 添加，相同 key 替换。`resources` 既支持数组（`["./assets"]`）也支持对象 map（`{"src": "dest"}`）；项目用对象 map 时合并行为是"叠加 + 同名覆盖"，**不是替换整个 resources 对象**。如果用数组形式，按 RFC 7396 数组**完全替换**。

2. **.gitignore stale 规则要清理** — 用顶层 `bundle.resources` 时项目可能有形如 `src-tauri/gen/android/app/src/main/assets/<resource-name>/` 的 .gitignore 规则（Android build 副产物）。拆分到 Windows-only 后这条规则变 stale（Android build 不再生成该目录），按 CLAUDE.md「无误导性残留」原则应删除。

3. **`$schema` 字段可选但建议加** — 让 IDE 提供 autocomplete + 校验，主配置和平台 override 都用同一 schema URL。

### 反例（2026-05-24）

- 项目的 `huanvaeguard-svc.exe` (3.4 MB) + `wintun.dll` (427 KB) 仅 Windows 上有意义，但 `tauri.conf.json` 顶层 `bundle.resources` 让它被打进 mac DMG / Linux DEB / Android APK / iOS IPA，**单次构建浪费 ~3.8 MB**
- 项目 .gitignore 早已观察过 Android build 复制行为，写了 `src-tauri/gen/android/app/src/main/assets/HuanvaeGuard/` 规则忽略 — 这条规则的存在本身就是 bundle.resources 跨平台行为的证据
- 修复：把 `"resources/HuanvaeGuard/*"` 从主 tauri.conf.json 移到新建的 `tauri.windows.conf.json`，删除 stale 的 .gitignore 行
- 验证：mac `cargo check --lib` 0 warnings；前端 typecheck/lint/test 全绿
- 教训：**Tauri 2 跨平台项目的任何"平台限定资源"都应该走 platform-specific config，不要污染顶层 bundle.resources**

### 选择 platform-specific config 还是顶层 bundle.resources 的判断

| 资源用途 | 配置位置 |
|---------|---------|
| 所有平台都需要的运行时资源（声音 / 字体 / 图标） | `tauri.conf.json` 顶层 `bundle.resources` |
| 仅某平台需要的二进制 / 驱动 / 系统服务文件 | `tauri.<platform>.conf.json` 的 `bundle.resources` |
| 某平台特殊的安装期文件（LICENSE / 启动脚本） | `tauri.conf.json` 的 `bundle.{macOS,deb,rpm,appimage}.files`（不是 resources）|

混用规则：跨平台基础资源放顶层主配置，平台增量放对应 platform-specific config 即可，由 RFC 7396 自动合并。

## macOS 特权守护进程安装：osascript 提权 + launchd + 单引号注入防护

### 模式（与 Windows Service 对称的 macOS 落地）

需要在 macOS 上装一个 **root 守护进程**（如创建 utun 的 VPN daemon）时，标准落地：

1. **二进制 + plist 走 platform-specific config 打包**：`tauri.macos.conf.json` 把 `resources/<name>/*` 打到 `.app/Contents/Resources/<name>/`（见上一节）；二进制 .gitignore（镜像 Windows `resources/HuanvaeGuard/`）。
2. **运行时解析资源路径**：复用 `user_data::get_notification_sounds_dir` 同款 dev/prod 检测（dev=`target/{debug,release}` 回溯到 `src-tauri/resources/<name>`；prod=`Contents/Resources/<name>`）。**抽成纯函数 `resolve_resource_dir(exe_dir)`** 便于单测。
3. **提权安装（个人测试阶段）**：纯 Rust `Command::new("osascript").args(["-e", &apple_script])`，`apple_script = format!("do shell script \"{escaped}\" with administrator privileges")` 弹一次系统管理员密码，以 root 执行 `cp` 二进制 + `cp` plist（`chown root:wheel` + `chmod 644`）+ `launchctl bootstrap system <plist> || launchctl load <plist>`。**无需 Tauri shell 插件**（与 Windows `sc.exe` 同走 `std::process::Command`）。
4. **launchd 常驻托管**：plist `RunAtLoad + KeepAlive + UserName root`，装一次后开机自起/崩溃自拉，App **不负责启停**（比 Windows Service 简单——无 `spawn_start_on_boot`/`stop_on_exit`）。`is_installed()`（二进制+plist 均存在）早返回避免重复弹密码。命令 `hg_ensure_installed` 用 cfg 双分支：macos 真实现 / 非 macos 占位 `Ok(false)` 一行。
5. **前端**：仅 `platform()==='macos'` 时 `invoke('hg_ensure_installed')`，失败/取消授权 try/catch 后**仍打开窗口**降级（页面显示"服务未运行"）。

### 失败可归因：`HGSTEP=` 标记 + `|| exit` 失败即中止 + 提权前端口预检

提权 shell 不能用 `;` 一路串到底 —— 中途失败仍继续，会装出"二进制没拷成却照样 bootstrap"的必崩半成品，且失败步骤无从归因。约定：

- **每步先打标记再执行**：`echo HGSTEP=<步骤> >&2; <命令> || exit <码>`，失败即中止整条链（步骤码：11 mkdir / 12 copybin / 13 copyplist / 14 bootstrap）。不参与中止判定的步骤（如 `xattr -dr com.apple.quarantine` 去隔离，失败不影响安装）保持 `;`，并在注释写明为何豁免。
- **失败分类取最后一个标记**：`do shell script` 会把子命令 stderr 一并带进 AppleScript 错误，多条 `HGSTEP=` 同时出现 —— `classify_install_failure` 用 `rfind("HGSTEP=")` 取**最后一条**定位真实失败步骤（用 `find` 会永远归到第一步）。`-128` / `User canceled` 先于步骤判定，单独归为"授权被取消"，不许混进步骤失败文案。
- **提权之前先做端口预检**：守护进程启动时无条件 bind 本地控制端口，端口被占则起不来（KeepAlive 下崩溃循环）→ 装上去也不可用，不该先白弹一次管理员密码再失败。所以在 `install()` 里、`osascript` 之前用一次 `TcpListener::bind` 试探。**判据必须是"端口此刻是否真被占"**，不能用"某个 plist 文件在不在"代替：文件在盘上但未加载时端口其实空闲 → 误报拒装；端口被别的程序占住时 → 漏报放行。预检文案只说端口被占 + 请退出占用该端口的程序，**不点名任何具体 daemon 标签**（PUBLIC 仓红线：不写内部组件命名与架构关系）。

### Shell 注入防护（root 执行，必须做对）

osascript 以 **root** 执行拼接的 shell 命令时：
- **主防线**：所有路径用**单引号 `'...'` 包裹** —— shell 单引号内不解释任何元字符（`$`/反引号/`$()`/换行/`;`/`&&`/空格全字面化），**唯一**能逃逸的字符是单引号本身。
- **唯一补充 guard**：拒绝含单引号的路径（`fn path_is_shell_safe(p)=!p.contains('\'')`），即关闭全部注入向量。路径来自 `current_exe()` 非用户输入。
- **抽成纯函数 + 单测**（含 `'` 拒绝 / 正常路径接受），给这条安全关键分支回归保护。
- AppleScript 转义：`shell.replace('\\',"\\\\").replace('"',"\\\"")`，**先转义 `\` 再转义 `"`**（避免二次转义）。

### Gatekeeper（个人测试 vs 产品化）

- 个人测试：安装脚本对二进制 `xattr -dr com.apple.quarantine` 绕 Gatekeeper（无 Developer ID）。
- 产品化：改 `.pkg` + postinstall（取代 osascript）+ `codesign --sign "Developer ID Application"` + `xcrun notarytool`。osascript 路径是 MVP，注释里要诚实标 `// 产品化改 .pkg + 公证`。

### 一次做对（2026-06-04 macOS HuanvaeGuard daemon 安装）

mod 层 `#[cfg(target_os="macos")]`（不踩 2026-05-24 Windows huanvaeguard 的 dead_code 陷阱）、命令双分支占位、注入防护单引号包裹+guard、纯函数+单测。code-review + 盲审双过，cargo check/clippy 0 warning，1077 vitest 全绿。

### `Bootstrap failed: 5: Input/output error` 是四种成因合并的一句话（2026-08-06 逐一隔离实测）

`launchctl bootstrap system <plist>` 对下面四种**互不相同**的状况报的是**同一句** `Bootstrap failed: 5: Input/output error`——错误码本身零信息量，不能据它猜成因：

| 成因 | 安装链里由谁排除 |
|------|-----------------|
| (a) 服务已经加载 | `launchctl bootout system <plist>` |
| (b) 该标签在 launchd 的 override 库里被标记为**禁用** | **只有 `launchctl enable`**（见下） |
| (c) plist 属主不是 root:wheel | `chown root:wheel` |
| (d) plist 组 / 其他人可写 | `chmod 644` |

对照组（实测**不会**触发 error 5，别往这几个方向排查）：Program 指向的二进制不存在、二进制无执行位、plist 带 `com.apple.quarantine` 隔离属性 —— 这三种情况 bootstrap **返回 0**（服务加载成功，起不来是之后的事）。

**真因只能从 launchd 自己的日志里看**，它会说出被合并掉的那一句：

```
launchd[1] [system:] Bootstrap by launchctl[…] for <private> failed (119: Service is disabled)
```

**(b) 是 `bootout` 清不掉的**：bootout 只卸载"已加载"的服务，根本不碰 override 库。所以"bootout 失败就重试 bootout + bootstrap"这种幂等写法对它**恒失败**（实测反复重跑无一次成功）——用户侧表现就是"安装/修复按钮每次都失败"。唯一解法是在 bootstrap 之前插一步：

```sh
launchctl bootout system '/Library/LaunchDaemons/<label>.plist' 2>/dev/null
launchctl enable system/<label>          # ← 解除禁用 override，缺它则 (b) 无解
launchctl bootstrap system '/Library/LaunchDaemons/<label>.plist' || exit 14
```

实测 `enable` 之后 bootstrap 返回 0、服务达到 `state = running`。

**用户怎么落下这条 override**：在**系统设置 → 通用 → 登录项与扩展**里把本应用的后台项关掉；或此前执行过 `launchctl disable` / `launchctl unload -w`。因此 bootstrap 失败的用户文案要给的恢复动作是"回登录项与扩展里重新启用本应用的后台项再重试"，**不是**"可能有同名服务未卸载"（那种情况 bootout 早已处理，写出来纯属误导）。

### `launchctl` 两种寻址形式：service target（斜杠）vs domain + plist 路径（空格）

同一条命令链里两种形式混着用，写混了会静默不生效或报参数错：

| 命令 | 形式 | 写法 |
|------|------|------|
| `enable` / `disable` | **service target** | `launchctl enable system/com.example.daemon`（斜杠 + **服务标签**）|
| `bootstrap` / `bootout` | **domain + plist 路径** | `launchctl bootstrap system /Library/LaunchDaemons/x.plist`（空格 + **文件路径**）|

由此派生一条代码约束：service target 用的**标签**必须与 plist 里 `<key>Label</key>` 的值严格相等 —— `launchctl enable` 对**不存在**的标签是**静默成功**的，两边写歪了不报任何错，只表现为"修复还是失败"。所以标签要提成常量（`DAEMON_LABEL`）并用单测把它与打包 plist 模板的 `Label` 值钉死（`daemon_label_matches_bundled_plist_template`）。

### 发货二进制与 plist 参数必须同版本：加一条静态守卫

同批还踩到另一个独立缺陷：plist 传了 `--api-listen`，但打包进 .app 的守护进程是**不认识该开关**的旧构建 → 进程启动即退 → `KeepAlive` 下崩溃循环 → 用户点多少次修复都没用，而**安装链每一步都"成功"**，没有任何地方会报错。

守卫（`bundled_daemon_binary_understands_every_flag_in_bundled_plist`）：扫打包 plist 里所有以 `--` 开头的 `<string>` 值，逐个断言其字节出现在打包二进制里。两个细节别写错：

- **按字节搜**（`windows()`），不要先 `String::from_utf8` —— Mach-O 不是合法 UTF-8，转换必失败。
- **先断言扫描结果非空**再进循环：扫描逻辑或模板格式一变，空集合会让循环空转、测试**假通过**。

配套再加一条 PUBLIC 仓脱敏守卫（`bundled_daemon_binary_leaks_no_build_host_paths`）：同一份字节里断言不含 `/Users/`、`/home/`、`C:\Users`。这个二进制既进仓也随 release 产物发出去，rustc 默认会把编译机绝对路径烘进 panic 位置等元数据 —— 等于公开构建机目录布局（含用户名）。发货前必须已做 `--remap-path-prefix`。这条把发布 skill 里"对 tracked 二进制跑 `strings` 扫"的人工动作常态化成了 `cargo test` 的一部分。
