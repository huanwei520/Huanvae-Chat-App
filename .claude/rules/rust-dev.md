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

## 发货给 Windows Service 跑的二进制，必须验「SCM 能拉起」——手启成功不算数

### 症状：`sc.exe start` 报 1053，进程连一行日志都不写

NSIS 安装钩子把 `src-tauri/resources/HuanvaeGuard/huanvaeguard-svc.exe` 注册成服务（`sc.exe create HuanvaeGuard binPath= "...\huanvaeguard-svc.exe" start= demand`，以 LocalSystem 运行）。v1.1.20 发出去的那份二进制**根本起不来**：

```
sc.exe start HuanvaeGuard
[SC] StartService FAILED 1053:
The service did not respond to the start or control request in a timely fashion.
        STATE : 1  STOPPED
```

事件日志（Service Control Manager）：`A timeout was reached (30000 milliseconds) while waiting for the ... service to connect.`

同一个 exe 直接在前台跑：**立即退出**，stdout 空、stderr 空、它自己的滚动日志**一行都没有**，本地控制端口上也没有任何监听。

### 用户侧表现，以及必须分清的两种「0」

VPN 页点「连接」是把隧道配置 POST 到守护进程的本地控制端口。服务是死的 → 这个 POST **连都连不上** → 隧道从来没建起来 → 收发计数**双 0**。

| 计数形态 | 含义 | 根因方向 |
|---------|------|---------|
| Sent = 0 | **从未发出** —— 本例：守护进程压根没跑 | 服务/进程/控制面，与网络无关 |
| Sent > 0、Recv = 0 | **发出去了但没人应** | 真网络/加密问题（对端、路由、握手、密钥） |

两者根因完全不同，**必须分开量**：`Get-NetAdapterStatistics` 读 `SentUnicastPackets` 与 `ReceivedUnicastPackets` 两个独立数字，不许合成一个「不通」了事。

### 可复用的取证法：单变量 A/B

用真安装包装好，然后**只**替换服务路径上的那个二进制 —— 服务注册项、启动命令、POST 的配置全部逐字节不变。旧二进制 → `1053`、无网卡、无监听；新二进制 → 服务 `RUNNING`、隧道接口 up、有包在走。除二进制外零变量，因果就此钉死。

### 规则：SCM 启动是独立的验证项

**凡是打包出去要被 Windows Service 拉起的二进制，必须在干净机器上证明它「能被 SCM 启动」，而不是只证明「从控制台手启能跑」。** 这是两个执行上下文（LocalSystem、session 0、无交互桌面），"我双击能跑"不迁移。

注意本项目健康版二进制是**双模的**：被 SCM 拉起时按服务跑，被直接启动时退回独立前台模式 —— 这正是"手启测试通过、服务路径却是坏的"能同时成立的原因。

### 供应链成因：随发布顺延的 tracked blob，无任何 CI 刷新

这份二进制是**跟着发布一路顺延下来的 tracked blob，没有任何 CI 步骤重编或刷新它**，于是悄悄落后于后端当前提供的数据面契约，直到真机才炸。

本文件上一节已给 macOS 守护进程加了静态守卫（打包二进制必须认识打包 plist 传的每个 `--` 开关）。**Windows 侧目前没有等价的自动守卫**，而且不可能是同一条 —— 这里的失效形态是"在 SCM 下起不来"，只有真 Windows 主机能验。别把它写成已有守卫。

**反例（2026-08-06，真机实测）**：v1.1.20 的 `huanvaeguard-svc.exe` 在真 Windows 机上 `sc.exe start` 恒报 1053、日志零输出、端口无监听 → VPN 连接 POST 直接连不上 → 收发双 0。单变量 A/B（只换二进制）确认二进制即唯一成因；换上新构建后服务 RUNNING、隧道 up、有包。教训：**发货二进制的验证项是"SCM 能不能拉起它"，手启成功属于另一条通路，不能顶替。**

## 无状态守护进程重启后，中继要重新学端点 —— 单向不通 ≠ 二进制坏

### 前提：本项目 VPN 守护进程是无状态的，重启即丢配置

macOS `hg-macos` / Windows `hg-windows` 守护进程**不做任何配置持久化** —— 源码里没有落盘路径，`/api/tunnel/start` 收到的私钥 + peer 只存在内存里。所以**服务一重启，隧道配置就没了**：`/api/tunnel/status` 回 `{"active":false,"peers":[]}`，必须由上层重新 POST 一次配置才会恢复。别指望它自愈。

### 症状：两端都"正常"，却恰好有一个方向 100% 丢包

换上新构建的二进制、重启服务、重新 POST 配置之后实测到：

- 两端 `active=true`，两端路由都在，被换端**握手成功**（`last_handshake` 非 0）；
- 但 **A→B ping 100% 丢包** —— A 侧 `tx` 有增量（包确实发出去了）而 `rx` 无 ICMP 回包；
- 紧接着从 **B→A ping 却 6/6 全通**（0% 丢包、ttl 符合「初始 TTL − 1」、RTT 是隧道量级）；此后 **A→B 立刻也通了**（10/10）。

### 根因：中继侧的端点映射还停在重启前的旧 UDP 源端口

重启后被换端拿到了**新的 UDP 源端口**，而中继（hub）侧对该 VIP 的**端点映射仍是旧的** —— A 发往 B 的包被中继投递到一个已经没人听的旧端点。中继要**收到 B 主动发出的数据包**才会把映射更新过来，所以"让 B 先发一次"就恢复了。这是控制面时序问题，与二进制质量无关。

### 规则

1. **重启过守护进程之后做连通性取证，先从"刚重启的那一端"主动 ping 对面**，再回头测另一方向；否则会拿到一个假的"单向不通"结论。
2. 判「是不是二进制坏了」看这三样，**别看单向 ping**：

   | 观测项 | 正常表现 | 说明 |
   |--------|---------|------|
   | 握手是否发生 | `last_handshake` 非 0 | 密钥/协议栈没问题 |
   | 该端自己的 `tx` 是否有增量 | 有 | 包发得出去，本端数据面活着 |
   | 反向是否通 | 通 | 隧道两端都在工作 |

   三样都正常而**只有一个方向不通** ⇒ 是中继端点映射过期，不是二进制缺陷。
3. 反过来也成立：**服务 RUNNING + `active=true` 不等于数据面通**。收发字节增量与端到端 ping 才是判据 —— 这正是上一节「服务状态看着正常但上下行包均为 0」那起故障的教训。

**反例（2026-08-06，实测）**：两端二进制都是当天从源码新构建的，重启并重新 POST 配置后 A→B 100% 丢包（A 侧 tx 有增量、握手已成），差点回头怀疑新构建；从 B→A 先 ping 6/6 通，随后 A→B 立刻 10/10 通 —— 证明"单向不通"那一刻是中继映射未更新，而非构建问题。

## macOS 发货守护进程必须显式重签，且要验 launchd 真能拉起

### 症状：装完点「修复」恒报 `Bootstrap failed: 5`

macOS 侧当天那起「安装/修复恒失败」故障，除了本文件前面写过的 launchd override 禁用（`launchctl enable` 那条）之外，还有**第二个独立根因**：`cargo build` 直接产出的二进制**签名类型不对**，launchd 加载不了。

### 根因：`cargo build` 产出的是 linker-signed，不是 adhoc

同一份源码、同一次构建，前后只差一条 `codesign -f -s -`，`codesign -dv` 的 flags 就变了（实测两组）：

```
重签前: CodeDirectory v=20400 size=19736 flags=0x20002(adhoc,linker-signed) hashes=613+0
重签后: CodeDirectory v=20400 size=5130  flags=0x2(adhoc)                   hashes=154+2
```

`cargo build` 直接产出的是 **linker-signed**（`0x20002`，链接器顺手打的）；能被 launchd 正常加载的那份是**显式 `codesign -f -s -` 重签过**的（`0x2`，纯 adhoc）。

### 规则

1. **任何要发货给 launchd / SCM 这类系统服务管理器拉起的二进制，构建后必须显式重签**，并断言 `codesign -dv` 的 `flags` 含 `adhoc` 且**不含 `linker-signed`**。构建脚本要把**改前 / 改后两行 flags 都打出来存证**，别只打一行"已签名"。

2. **与 Windows 侧那条同理：「手工前台跑得起来」不能顶替「服务管理器能拉起」。** macOS 的等价验证是 —— 把发货字节装成一个**独立标签、独立控制端口的第二实例** LaunchDaemon 走完整生命周期：

   ```sh
   launchctl bootout   system '/Library/LaunchDaemons/<第二实例标签>.plist' 2>/dev/null
   launchctl enable    system/<第二实例标签>
   launchctl bootstrap system '/Library/LaunchDaemons/<第二实例标签>.plist'
   launchctl print     system/<第二实例标签>   # 断言下面两行
   ```

   断言 `state = running` 且 `last exit code = (never exited)` —— **`KeepAlive` 下的崩溃循环正是在后面这一行露馅**（进程反复起退时它不是 `(never exited)`）；再确认控制端口真应答。验完 `bootout` + 删文件收尾。**这条不碰生产实例**（标签与端口都另起），可在有真实隧道在跑的机器上安全执行。

3. **二进制字节从构建产物拷到安装位置后要重算 sha256 比对**，别默认 `cp` 一定成功 —— 这是本文件前面「打包件与 plist 参数同版本」守卫的运行期补充。

**反例（2026-08-06，实测）**：按上面第 2 条对当天新构建的发货件跑第二实例验证 —— `bootstrap_rc=0`、`state = running`、`last exit code = (never exited)`、控制端口回 `{"success":true,...}`，生产实例全程不受影响；同批还实测到落点 sha256 与构建产物 sha256 完全一致。而未经显式重签（`flags=0x20002` linker-signed）的那份，正是「修复恒失败」的成因之一。

## 只跑 `cargo check` / `clippy` 时，`tauri-build` **不要求** `frontendDist` 真实存在

要在一台干净机器（CI / 远程构建宿主）上只做 Rust 侧静态检查时，直觉会先跑一遍 `pnpm build`
把 `dist/` 造出来喂给 `tauri-build`。**本仓实测不需要**：`tauri-build 2.6.1` 在
`cargo clippy` / `cargo check` 路径下**不校验 `../dist` 是否存在** ——
故意不建 `dist/` 跑 `cargo clippy --target aarch64-linux-android -- -D warnings`，
结果 `Finished dev profile ... in 31.91s`、`CLIPPY_RC=0`。同理 `src-tauri/gen` 也不用同步
（`gen/schemas` 由 `tauri-build` 自己重生）。

⇒ 远程/CI 上做 Android clippy，**只需同步 `src-tauri`（+ 打包脚本要求的少量资源），
不必先花 26 分钟构建前端**。这条直接决定了远程 clippy 是"半分钟"还是"半小时"。

⚠️ 边界：这只对**静态检查**成立。真出包（`tauri build` / `tauri android build`）当然要 `dist/`。
版本升级后重验一次这个假设 —— 它是 `tauri-build` 的实现行为，不是文档承诺的契约。

## macOS 真机载体必须是 `.app`：`cargo build --release` 的裸二进制**渲染白屏**

**症状**：想在 macOS 上真机复现一个前端行为，图省事直接跑 `cargo build --release` 然后启动
`target/release/<可执行文件>` —— **窗口起得来，但内容白屏**。

> 🔴 **2026-08-16 根因订正（旧归因保留在下面，不抹掉 —— 留痕比干净重要）**
>
> **旧归因（❌ 错误，勿再据它推别的东西）**：
> 「裸二进制**没有 `Info.plist`、不是 bundle**；Tauri 的 webview 依赖 bundle 环境，
> 裸可执行文件跑起来只有壳。」
>
> **真因是 feature，不是 bundle**：`cargo build --release` **默认不带 `tauri/custom-protocol`**，
> 而 Tauri v2 **用这个 feature 决定「读内嵌资源」还是「连 devUrl」** ——
> 不带它，release 二进制会去连一个并不存在的 dev server ⇒ **白屏**。
> `tauri build` 自动带上该 feature，**手工 `cargo build` 不带**，这就是两者行为不同的全部原因。
>
> ⇒ **手工组装 `.app` 时必须**：
> ```
> cargo build --release --features tauri/custom-protocol
> ```
> **只补 `Info.plist` / 只做成 bundle 是不够的** —— 旧归因会让人在 bundle 结构上反复折腾而白屏依旧。
>
> **来源**：`fw-code-1786856192` 在自组装 `.app` 时实撞并定位（gen-24，2026-08-16）；
> 本仓此前把成因写成"没有 bundle"的是 leader，**记在 leader 账上**。
> ⚠️ 该 worker **没有擅自改本文档**，只在交接里建议补 —— 这个边界感是对的。

⇒ 看到白屏**第一反应应当是"我的载体不对 / 我的 feature 不全"**，而不是"这个版本坏了"——
本仓 2026-08-13 实测就在这里绕了一次（当时错误地归因为缺 bundle）。
（这条同时**回填**了 [common.md](common.md) Touch ID 一节里那句「`tauri dev` 裸二进制无 .app
Info.plist 时行为待验」：**已验，白屏** —— 但**白屏的成因是缺 feature，不是缺 Info.plist**。）

**顺带一条同批实测（读 JS console 这条路目前走不通，别再试）**：
`--features tauri/devtools` **能编、App 能起**，但**右键被 App 自己的上下文菜单接管**
（回复 / 删除 / 多选），Inspector 进不去；**独立预览窗**那个 webview 右键**有** Inspect Element，
但 **ad-hoc 签名下 Inspector 窗口起不来**。
⇒ 要读前端错误，得另找路（临时把前端错误上报到 Rust，或走 dev server 模式）。

### 🔴 但 `tauri build --bundles app` 在**共享盘（virtiofs）**上会失败

实测（rc=1，耗时 316s）：

```
failed to bundle project Failed to create Info.plist:
Io(Os { code: 25, kind: Uncategorized, message: "Inappropriate ioctl for device" })
```

**不是权限问题** —— 随后手工往**同一路径**写 `Info.plist` 是**能成功**的，
所以这是共享盘（virtiofs）上的**写入语义**问题（与"virtiofs 慢 IO"是同一个盘的另一形态：那条是慢，这条是某些写入语义直接不支持）。

### ⇒ 可行做法：在**本地盘**手工组装最小 `.app`

1. 在**本地盘**（如 `/private/tmp/…`，不要在共享盘）建 `X.app/Contents/{MacOS,Resources}`；
2. 拷同一份 `cargo build --release` 的二进制进 `Contents/MacOS/`；
3. 自写 `Info.plist`（`CFBundleExecutable` / `CFBundleIdentifier` / `CFBundlePackageType=APPL`）；
4. 🔴 **给它一个与正式包不同的 `CFBundleIdentifier`** —— 否则 LaunchServices 会因
   **bundle identifier 相同**而激活**已在运行的那个实例**（正是 [common.md](common.md)
   「多线共用一台 mac 做真机实验：`open` 不是可靠的启动方式」那条坑），
   你以为在测自己的产物，其实看的是别人的进程。
5. 用完把临时 `.app` 删掉（`target/` 本就 gitignore，但 `/private/tmp` 下的要自己清）。

## serde 在 enum 上：`rename_all` 与 `rename_all_fields` **作用对象不同**，写错在编译期毫无征兆

**两者改的根本不是同一层东西**，而名字只差三个字母：

| 属性（写在 **enum** 上） | 改的是 | 不改的是 |
|---|---|---|
| `rename_all = "camelCase"` | **变体名**（tag 值） | 变体内的**字段名** |
| `rename_all_fields = "camelCase"` | 变体内的**字段名** | **变体名** |

**真 serde 实跑坐实（2026-08-13，独立 probe crate，`serde 1.0.228` / `serde_json 1.0.149`，
与 `src-tauri/Cargo.lock` 锁定版本一致；两组只差 enum 上那一个属性）**：

```
A 组  #[serde(rename_all = "camelCase", tag = "event", content = "data")]
{"event":"started","data":{"content_length":9700000,"downloaded":0}}
{"event":"progress","data":{"downloaded":123456,"content_length":9700000}}
{"event":"finished"}

B 组  #[serde(rename_all_fields = "camelCase", tag = "event", content = "data")]
{"event":"Started","data":{"contentLength":9700000,"downloaded":0}}
{"event":"Progress","data":{"downloaded":123456,"contentLength":9700000}}
{"event":"Finished"}
```

⇒ A 组把 **tag 全降成小写、字段名反而不动**；B 组恰好相反。
**写错哪一个，编译期零告警、零报错 —— 只是把整条线格式换掉**，
而对面（TS 侧）按另一套解析 ⇒ 事件全部落空，且没有任何一层会报错。

### 🔴 只 grep 字段名的守卫，结构上不可能翻红

守「跨语言线格式」的测试如果只是 `grep` 源码里有没有出现某个字段名，
那么把 `rename_all_fields` 写成 `rename_all` 时**字段名一个字都没变** ⇒ 守卫恒绿。
本仓旧守卫就是这样，**十个版本零告警**。

**有效守卫的形状**：**从源码派生出真实线格式，再喂给真 handler / 与黄金样本逐字节比对** ——
即断言的对象必须是**线格式本身**（tag 名 + content 键 + 变体 wire 名 + 字段 wire 名），
不是源码里的标识符。参考件：`tests/update/updateWireContract.test.ts`（本代已做变异自证）。

### 配套：核这类属性时 naive `grep -c` 会多数一条注释

现查实测：`grep -c 'rename_all_fields = "camelCase"' src-tauri/src/updater_download.rs` = **2**,
第二条是**注释表格行**（文件里那张解释两个属性区别的表）。
锚定属性行才是 1：`grep -cE '^#\[serde\(rename_all_fields = "camelCase"'` = **1**。
（同族：[common.md](common.md)「『命中了』不等于命中的是那一类行」。）

## 🔴 gen-33 追加（2026-08-21）：HG 真机验收载体的两条坑（控制口端口 · Windows 侧缺 `wintun.dll`）

> **本节是 EOF 追加，不改上文任何一行。** 它是上文「发货给 Windows Service 跑的二进制，必须验
> 「SCM 能拉起」」与「无状态守护进程重启后…单向不通 ≠ 二进制坏」两节的**新实例 + 新判据陷阱**。
> 一手来源：gen-33 在本机 macOS 与一台**远程 Windows 对端**之间手工建真隧道跑门禁第 13 项。

### 一、🔴 HG 控制口端口**两端不同**：macOS `19199` / Windows `19198`

- macOS 侧由 LaunchDaemon 的 `arguments` 给出（`--api-listen 127.0.0.1:19199`）；
  Windows 侧服务用的是 **19198**。两个值仓内都能查到（`src-tauri/src/desktop/huanvaeguard_macos.rs`
  两个都有、`scripts/hg-connectivity-test.ps1` 用 19198）。
- 🔴 **用错端口拿到的 `Unable to connect`，与「服务真的死了」完全同形。**
  gen-33 实撞：拿 macOS 的 19199 去探 Windows 控制口，得到 `Unable to connect`，
  **差一点写成「Windows 侧控制口已经不应答了」**；换 19198 后正常返回
  `{"success":true,"data":{"active":false,"peers":[]}}`。
  同刻负对照（19199 与一个当场现编的端口）**两个都报同一句错**
  ⇒ **「连不上」这个输出对「端口错」与「服务死」零判别力**，不能据它下任何结论。
- ⇒ **可执行动作**：探任何一端的 HG 控制口之前，**先从那一端自己的服务定义里取端口**
  （macOS `launchctl print system/<label>` 的 `arguments`；Windows 看服务命令行 / 该侧脚本），
  **不许把另一端的端口拿来复用**。派单时凡要求「现查某个控制口」，
  **把端口和它属于哪台机器一并写进卡**，写不出就明写「自己去取，别猜」。

### 二、🔴 服务 `RUNNING` + 控制口应答，仍然可能**结构上建不了隧道** —— Windows 侧缺 `wintun.dll`

这是上文「服务状态看着正常 ≠ 数据面能用」那条的**又一个实例**，但失效点更靠前：
**不是发货二进制坏了，是安装件不完整。**

- gen-33 那台远程 Windows 对端开工现查：服务目录里**只有** `huanvaeguard-svc.exe` 与一个 `.bak`，
  **没有 `wintun.dll`**；`C:\Windows\System32` 里也没有；机器 PATH 里没有任何含 wintun 的目录。
- **单变量 A/B（同一份 JSON、同一个服务，只改这一个文件）**：
  目录里**有** `wintun.dll` ⇒ `POST /api/tunnel/start` 成功、隧道网卡起来；
  **删掉** ⇒ `{"success":false,"error":"failed to create device: LoadLibraryExW failed"}`，网卡不出现。
- ⇒ **在 gen-33 之前，那台机器 `sc.exe query` 报 `STATE : 4 RUNNING`、控制口也正常应答，
  但任何一次连接尝试都必然失败** —— 而这三样读数**全都是绿的**。
- 🔴 **gen-33 按还原纪律把 `wintun.dll` 删回去了 ⇒ 它现在仍是这个状态。**
  下一个拿它当真机验收载体的人，**第一件事是确认 `wintun.dll` 在服务目录里**。
- 🔴 **补齐方式必须是「用 App 安装包装一遍」，不是手工拷一个 dll 过去** ——
  手工拷会**绕过「安装件是否完整」这条本该被验的东西**，把一个安装缺陷洗成"环境已就绪"。
  App 的 Windows 资源里本来就带 `wintun.dll`（见上文「Tauri 2 平台限定资源」一节的 `tauri.windows.conf.json`）。

⇒ **判 HG 数据面可用性的最小三件套**（缺一件就会得到一个绿色的假结论）：
① 服务被系统真拉起（`sc query` / `launchctl print`）；
② 控制口应答（**用那一端自己的端口**）；
③ **`POST /api/tunnel/start` 真的返回 `success:true` 且隧道网卡真的出现**。
①② 全绿而 ③ 失败，正是本节这两条坑的形状。

## 🔴 reqwest 默认 builder 的系统代理检测：「测试二进制 + VirtioFS 大目录」下分钟级卡顿（2026-08-27 采栈实证）

> 来源：run-1787814943 单A 交付（de701c1e）证据 02 采栈 + reviewA（11580a72）独立复核成立。本节为 EOF 追加，不改上文任何一行。

### 症状与根因链

`cargo test` 中凡走**默认 `reqwest::Client::builder()`** 的用例，首调 client 构造卡 1~5 分钟（本机实测 270s 一次、106s 两次，时长随目录大小/网络波动不恒定）。对挂起中的测试二进制 `sample` 采栈，链自顶向下：

`ClientBuilder::build` → `reqwest::proxy::Matcher::system` → hyper-util `with_system` → `SCDynamicStoreCreateWithOptions` → `_SC_getApplicationBundleID`（**dispatch_once**，故并发首调的多个测试全排在同一个 once 之后一起卡）→ `CFBundleGetMainBundle` → 测试二进制不在 .app bundle 里，CFBundle **退化为 readdir 可执行文件所在目录** → `target/debug/deps` 数万条目、且整棵在 VirtioFS 网络盘上 ⇒ 分钟级卡顿（栈底 `readdir`/`__getdirentries64` 占 251/252 样本）。

要点：瓶颈**不在代理配置内容**（`scutil --proxy` 显示本机未启用任何代理也照样慢），在 bundle 探测触发的目录遍历。

### feature 层面：`default-features = false` 挡不住

`macos-system-configuration` 是 tauri-plugin-http 的 default feature（**feature 名，不是 crate 名**——当 crate 名查会报 package 不存在、rc=101），它再打开 reqwest 同名 feature → `system-proxy`，经 plugin 统一带回；本仓 `src-tauri/Cargo.toml` 里 reqwest 的 `default-features = false` 拦不住这条绕回的路。证 feature 归因的复核命令是：

```bash
cargo tree -e features -i <pkg>@<ver>    # 逆向 feature 树
```

裸 `cargo tree -p <pkg>` 只列 crate 依赖树，证不了 feature 归因。

### 规则

1. **直连源站语义的 client 构造必须显式 `.no_proxy()`**（生产代码与测试同一个构造器）。已落地例子：`secure_proxy.rs` 的 `build_proxy_client`（回环反代）、`unified_download.rs` 的 `build_download_client`（统一下载引擎）。`.no_proxy()` 顺带跳过 `Matcher::system` 路径，从根上避开上述 readdir 风暴。
2. **确需保留系统代理检测的，必须在注释写明理由**。现存例子：`updater_download.rs` 的 `default_shaping_keeps_system_proxy_detection` 测试——它刻意钉住「保持系统代理检测」语义，全量测试里这一组承担分钟级等待（2026-08-27 全量 201 个用例里 4 个 updater_download 用例各报 over 60s，同机制），属存量、待后续单评估是否在测试面豁免。

## 🔴 gen-43 追加（2026-08-27 · run-1787861591）：往 `src-tauri/examples/` 放调试/取证 harness 的三个后果 —— **本节只追加在 EOF，不改上文任何一行**

> 来源：单1 code `ce67b197` §8 与单2 review `89be8adc` §1-8 / §2-3。
> 本 run 为跑 GB 级真对象中断/续传实测，新增了一个 **未跟踪** 的 example：
> `src-tauri/examples/gb_resume_harness.rs`（1015 行 / 40211 字节）。
> 「它不参与 `cargo build` / `tauri build`」这句**是对的**（examples 只在 `--example` / `--examples` 时才编），
> **但由它推出的「零影响」把范围划小了。** 下面三条是现查出来的结构性事实。

### 一、它在门禁 clippy 的扫描面内（**未验证它会不会真红**，只写结构事实）

- `cargo metadata` 实测：该文件是本 package 的一个 **`kind=example` 的 target**。
- 门禁 clippy 那一项跑的是 **`cargo clippy --all-targets --all-features -- -D warnings`**
  （`scripts/linux/test-all.sh:461` 与 `scripts/test-all.ps1:354` 各一处；🔴 **行号会漂，引用前自己现查**：
  `git grep -n -F 'all-targets' -- scripts/linux/test-all.sh scripts/test-all.ps1`）。
  cargo 对 `--all-targets` 的说明是 **Build all targets**、且另有独立的 `--examples` 开关
  ⇒ **example 在这一项的扫描面内**，其中任何一条 clippy warning 都会让该项 FAIL。
- 🔴 **本 run 没有实跑 clippy 验证它会不会真红**（共享盘上是分钟到几十分钟量级，超出成本上界）
  ⇒ **这条标注「未验证」**，只主张「它在扫描面内」这个结构性事实，不主张「它会让门禁红」。

### 二、`cargo test --lib` 与 `cargo check` **不含** examples ⇒ 那两项不受影响

门禁的 cargo test 那一项是 `cargo test --lib`（`scripts/linux/test-all.sh:721` / `scripts/test-all.ps1:616`，同样自己现查）
⇒ 不含 examples；`cargo check` 默认也不含。**别把「clippy 受影响」外推成「所有 Rust 项都受影响」。**

### 三、🔴🔴 未跟踪的 harness 会被**下一次发布**收进 PUBLIC 仓的发布 commit

`scripts/linux/release.sh:348` 与 `scripts/release.ps1:329` 各有一行 **`git add -A`**
（现查：`git grep -n -F 'git add -A' -- scripts/linux/release.sh scripts/release.ps1`）
⇒ 发布流程会把**工作树里所有未跟踪文件**一起裹进发布 commit。

本 run 现查：该 harness **未被任何 `.gitignore` 规则覆盖** ——
`git check-ignore -v src-tauri/examples/gb_resume_harness.rs` ⇒ **rc=1、零输出**；
**正对照** `git check-ignore -v src-tauri/target/x` ⇒ **rc=0** 并打印 `src-tauri/.gitignore:3:/target/` ⇒ **判据会响，那个 rc=1 是真的没被忽略**。

⇒ 🔴 **BACKLOG（待总管裁定，三选一，本单不自行处置）**：
`src-tauri/examples/gb_resume_harness.rs` ——
① 加进 `.gitignore`；② 有意提交（则须先过 clippy 与 PUBLIC 仓脱敏核）；③ 删除。

顺带两条与它有关、下一棒该知道的：
- 该 harness 里**硬编码的源站 IP 在仓内已跟踪文件里本来就有**（discovery 与多个测试文件里都在）⇒ **不构成新增暴露**；
  但注意单1 那条「硬编码口令/密钥 = 0 行」的 grep **口径只覆盖 password/secret/TOKEN，不覆盖地址类** ——
  脱敏自查的口径别只按关键词列表写，要按**类别**写。
- 它编译产物在 `src-tauri/target/release/examples/gb_resume_harness`，带 locate / sweep / dump / maxscan /
  presign / probe / fullverify / verifyranges 八个只读子命令，账号经 `HV_USER` 切换 ——
  下次要做生产只读取证可直接复用。⚠️ **但 `dump` 会把真实聊天正文打到 stdout**，落盘前必须脱敏
  （见 [common.md](common.md) 同批追加的「dump 类取证落盘前必须把消息正文脱敏」一节）。

### 四、一个可复用的判定形状：「不参与构建 ⇒ 零影响」是**两跳**，第二跳几乎总是漏

「A 不参与 X」是**一个**事实；「所以 A 零影响」需要**穷举所有会吃到 A 的通道**。
本例里被漏掉的两条通道是 **`--all-targets` 的 clippy** 与 **`git add -A` 的发布**，
它们都不叫「构建」，因此在「不参与构建」这个框里**结构上看不见**。
⇒ **动作**：给任何新增件下「零影响」结论前，把仓内会遍历文件/target 的入口列一遍 ——
至少含：门禁脚本各项的实际命令、`release.sh` / `release.ps1` 的暂存命令、CI workflow 的 `paths` 与打包步骤。

#### run-1787871601（gen-44）就地更新上一节的两处 —— BACKLOG ① 已执行；以及「不入仓」**不等于**「不出本机」

> **本节只追加、不改上一节任何一行**（上一节属另一条线尚未提交的在飞文字）。上一节的读数是 2026-08-27 早些时候的时点值，下面是同日 23:33Z 的现查值。

**一、上一节末尾那条 BACKLOG 的三选一，已按①执行 ⇒ 上一节「未被任何 `.gitignore` 规则覆盖 / rc=1」那句**现已不成立**。**

现查（2026-08-27T23:33Z）：`.gitignore:99` 新增一行 `/src-tauri/examples/gb_resume_harness.rs`（配 5 行注释，commit `173b51f`，未 push）；
`git check-ignore -v src-tauri/examples/gb_resume_harness.rs` ⇒ **rc=0** 并打印 `.gitignore:99:…`；
同刻正对照 `git check-ignore -v src-tauri/target/x` ⇒ rc=0（`src-tauri/.gitignore:3:/target/`）、
负对照一个当场现编的仓内路径 ⇒ **rc=1** ⇒ 判据会响也会静。
挡住的入口是 `scripts/linux/release.sh` 与 `scripts/release.ps1` 里的 `git add -A`（行号自己现查：`git grep -n -F 'git add -A' -- scripts/linux/release.sh scripts/release.ps1`）。

**为什么写精确单文件路径而不是 `src-tauri/examples/` 目录通配** —— **失效方向不对称**：
通配写宽了 ⇒ 将来正常的 example 被静默忽略、**没有任何东西会报错**；
精确路径写窄了 ⇒ 下一个 harness 没被挡住，而那是**发布前查得出来**的。代价（每来一个 harness 要手动加一行）已明写在 `.gitignore` 注释里。

**二、🔴 「不入 PUBLIC 仓 / 不随版本发出去」为真，但【不许外推成「它不出本机」】。**

远程 Android clippy 那条通路（`scripts/linux/test-all.sh` 与 `scripts/test-all.ps1`）是用
`tar -czf … --exclude 'src-tauri/target' --exclude 'src-tauri/gen' -C <root> src-tauri Notification-Sounds`
同步源码到远程构建宿主的 —— **`tar` 不读 `.gitignore`**，且 exclude 清单里**没有** `src-tauri/examples`。

**实证（不是读 exclude 清单推的）**：按同一条 exclude 集在本仓真打一个包，
载荷里 `examples/gb_resume_harness.rs` 命中 **1**；同类正对照 `src-tauri/Cargo.toml` 命中 **1**（判据会响）；
负对照被排除的 `src-tauri/target/` 命中 **0**（判据会静）。
⇒ **该 harness 仍会被 scp 到远程构建宿主。**

风险量级（**只登记，不要求处置**）：该文件无口令/密钥，其中硬编码的源站 IP 在本仓**已跟踪文件**里本来就有 ⇒ **不构成新增暴露**。
可复用的形状：**「加进 `.gitignore` 了」只回答了 git 那一条出口**；凡问「它会不会出本机」，必须把**所有会遍历文件的出站动作**各查一遍
（发布 `git add -A` / 远程同步 `tar`+`scp` / CI 打包 / 归档），而 `tar` 这一条**结构上看不见 `.gitignore`**。

## 🔴 gen-48 追加（2026-08-29 · run-1787982711）：本机同账户「单开锁」会挡住第二个载体登录 —— **本节只追加在 EOF，不改上文任何一行**

> 来源：gen-48 单4（code，`fw-code-1788010332`）§9.1。
> 追加在文件末尾是为了**不位移任何既有行号**（本文件被多份归档交付按 file:line 钉着）。

**这是多载体真机实验的一个结构性阻塞**：本机上第二个载体**登录不进去**，
而它与「点击没落到这个窗口」「界面卡住」「网络不通」在**画面上完全同形**。

**现象（两个可辨认的痕迹，缺一个就只剩"看起来没反应"）**：
· 界面出现红条 **「该账户已在其他窗口登录」**；
· 载体自己的 stdout 里有 `[SessionLock] 检测到冲突: <账号> @ <server>, PID: <另一个进程的 pid>`。

**三条必须知道的性质（每一条都会让人查错方向）**：

1. 🔴 **锁文件是三个 .app 共用的【同一个本机文件】** —— Tauri 的 `app_data_dir` 取的是**编译期 identifier**，
   **不看 Info.plist**。⇒ **手工组装的 .app 改了 `CFBundleIdentifier` 也没用**，它们仍然共用同一把锁。
   （这与 common.md 那条「手工组装 .app 要换 `CFBundleIdentifier`，否则 LaunchServices 会激活别人的实例」
   **是两件不同的事**：那条治的是**启动**指错，这条治不了**锁**共用 —— 别把两者混成一条。）
2. 🔴 **检查点在 `src/App.tsx` 的登录流程里、在 `login()` 之【前】**
   ⇒ **被挡住的那次点击根本没有向服务端发起登录**。
   ⇒ 去服务端日志里找「有没有登录请求」会得到 0，而那个 0 **不代表点击没生效**。
3. **它很可能是「载体停在账号选择器」这一类现象的直接原因之一** —— 排查时**先看这条**，
   别先怀疑点击没落到窗口上（单3 那次翻车的直接原因是点击指错，但即使点对了，这条锁照样会把它挡住）。

**可执行判据（先分流，再动手）**：读**被测载体自己的 stdout**，两侧形状不同：
· 被挡住 ⇒ 有 `[SessionLock] 检测到冲突`，且**没有** `[Command] db_init 被调用` / `[DB] 初始化数据库`；
· 真登录了 ⇒ 有 `[Command] db_init 被调用` + `[DB] 初始化数据库: <它自己 .app 里的库路径>`
  + `[SessionLock] 创建会话锁: … PID: <它自己的 pid>`。
单4 实测计数：登录成功的载体 `db_init` **2** / `[DB]` **5** / `[Command]` **4**；
被挡住的（单2 那两个）**三项全 0**；负对照当场现编串（如 `q7v3-no-such-line-8821`）在同一份日志里命中 **0**
⇒ 这条 grep **会响也会静**。

**单4 用的绕法（如实记，含它的代价）**：把该锁文件的 `pid` 字段**临时改成自己的 pid**，
让自己的登录通过本机单开检查；**收工按字节还原**（sha256 开工 = 收工）。
持锁的那个进程**不重读该文件**，所以改写对它的运行时无影响。
⚠️ 第二次起载体时通常不需要再改 —— App 自己会打 `[SessionLock] 清理了 1 个过期锁文件`。

**🔴 但这个绕法有一个跑不掉的外部代价，必须提前告知并记账**：
**同账户在服务端只保得住一条实时连接** ⇒ 你一登录，**别的线那个常驻载体就会掉实时连接、漏收消息**。
单4 实测：它的载体 `messages=6475`（最新 `13:57:21Z`），别的线那个 `messages=6471`（最新 `13:39:39Z`）
⇒ **中间那 4 条它没收到**。非破坏性（进程未被杀、本地库未被写、下次重连会补回），
但**必须在交付里逐条登记**，不许当作没发生。

**一手来源**：单4 §9.1（含它对单2 那次「两个载体从头到尾停在账号选择器」的解释）· §9.2（外部影响记账）。

## 🔴 gen-49 追加（2026-08-30 · run-1788016992）：Windows 应用内更新会把快捷方式整块删掉 —— **本节只追加在 EOF，不改上文任何一行**

> 来源：gen-49 六单中四份 PASS（单1 code fw-code-1788017858 · 单2 review fw-review-1788019925 ·
> 单3 code fw-code-1788022401 · 单5 code fw-code-1788039249 · 单6 review fw-review-1788046300）。
> 🔴 **单4（fw-code-1788030898）REJECT×3 硬停、从未拿到判官终态 ⇒ 凡引用它的内容一律标「未过审」。**
> 追加在文件末尾是为了**不位移任何既有行号**（本文件被多份归档交付按 file:line 钉着）。

### 一、机制：删了不建，且安装日志一个字都不会说

Windows 应用内更新 ⇒ 新安装器带 `$UpdateMode=1` 起来 ⇒ 本仓 src-tauri/windows/hooks.nsi 的
`NSIS_HOOK_PREINSTALL` 用 `ExecWait` 拉起**旧版本的卸载器** ⇒ 旧卸载器是一个**独立进程**，
它的 `un.onInit` 只认**自己命令行上**的 `/UPDATE`；**你不传，它那边就是 0**
⇒ 它按「用户在主动卸载」把桌面 / 开始菜单 lnk、任务栏固定项、`HKCU\...\Run` 自启项**整块删掉**
⇒ 而**新**安装器自己在 `$UpdateMode=1` 下**两处重建都直接 Return**（不重建快捷方式、不重写自启项）
⇒ **删了不建**。

🔴 **它为什么能活这么久没人发现**：整条链上**没有任何一处报错** —— 卸载器 rc=0、安装器 rc=0、
安装日志里不会出现一个字。用户侧唯一可察觉的信号是「升级完一次，桌面图标没了」。

**修法（仓内已落地、待提交）**：`$UpdateMode = 1` 时把 `/UPDATE` 一并拼进给旧卸载器的命令行。

### 二、真机读数（三臂 A/B/C + 全新安装回归；载体 = Windows Server 2025 **Server Core**）

除命令行里那一个 token 之外零变量；三次装完 v1.1.37 的基线读数逐行相同；整轮跑了两遍互证。

| 臂 | 命令行 | lnk L2/L4 | UNINST_HKLM | MAINEXE | INSTDIR 文件数 | 卸载器 rc |
|---|---|---|---|---|---|---|
| A | `/S _?=<dir>` | **0 / 0** | absent | absent | 1 | 0 |
| B | `/S /UPDATE _?=<dir>` | **1 / 1** | absent | absent | 1 | 0 |
| **C** | `/S _?=<dir> /UPDATE`（**错序**） | **1 / 1** | absent | **present ver=1.1.37** | **5** | 0 |

- L2 = 公共桌面，L4 = 全体用户开始菜单；两个 lnk 的 TargetPath 都解析到 `<INSTDIR>\huanvae-chat-app.exe`。
- **臂 A 与臂 B 形状不同（0/0 vs 1/1）⇒ 修法机制在真机上成立。**
- 全新安装回归（无旧版直接静默装 v1.1.38）与单3 基线逐行一致，唯一差异是 DisplayVersion。
- 单6 换量重做（换成 v1.1.38 卸载器 + 换一套读法 cmd/reg/findstr）复现同一形状；
  并用**同一份仓内宏**驱动**真 v1.1.38 发货卸载器**再做一次单变量 A/B：
  `$UpdateMode=0` ⇒ lnk **0/0**，`$UpdateMode=1` ⇒ lnk **1/1**，两侧旧版本都被卸干净。

🔴 **`HKCU\...\Run` 那一列在本载体上从头到尾恒为 absent（含刚装完）⇒ 它零判别力，不能拿它支持任何一侧。**

### 三、🔴 `_?=` 必须是命令行的最后一个参数 —— 错序的危害是**假阳性 + 静默不卸载**

NSIS 官方手册 3.2.2（makensis 3.12 随包 NSIS.chm）写死：`_?=` 后面的一切都会被当成目录路径的一部分。

🔴 **但错序的后果**不是**「`/UPDATE` 被吞掉、`$UpdateMode` 仍是 0」** —— 那是本代任务卡与单4（未过审）
的预判，**已被臂 C 实测证伪**：`${GetOptions}` 扫的是**整条命令行**里的 token，它照样看得见 `/UPDATE`。
被打坏的是 `$INSTDIR` ⇒ **依赖它的删除动作全部落空 ⇒ 旧版本静默不卸载**，
而**卸载器 rc=0、注册表卸载记录照样被删掉了**。

落到 hooks.nsi 的四段判定链上（`${Errors}` / `$2 != 0` / `$4 != ""` / `${Else}`，
见 src-tauri/windows/hooks.nsi:129 起）：error flag 未置位、rc=0、复核「卸载记录还在吗」也判为已删
⇒ **三道判据一起放行**，会打印「旧版本已卸载」，而旧程序文件原封不动躺在 INSTDIR 里。

⇒ **写反了不会有任何东西报错**。仓内测试里那条「`/UPDATE` 必须排在 `_?=` 之前」的守卫不是洁癖：
沙箱变异只把两行对调、其余一字不动 ⇒ **精准红 2 条**（既有 26 条一条没被带红）。

⚠️ **臂 C 的结论靠哪条证据站住，别搞混**（单6 复核订正单5 的论证）：靠的是「错序下 GetOptions 仍置 1」
这条**直接测量**；**不靠**「lnk 还在 ⇒ 所以 `$UpdateMode` 判到了 1」那条推理 ——
模板里每一次删 lnk 之前还要过一道 `IsShortcutTarget`，`$INSTDIR` 被打坏时它照样返回 0
⇒ 「lnk 还在」在「`$UpdateMode=1`」与「`$UpdateMode=0` 但 `$INSTDIR` 被打坏」两种解释下**完全同形**。

### 四、🔴 存量缺陷（本次未修，登记）：判定链里没有一条断言「旧程序文件真的不在了」

hooks.nsi 判「旧版本卸掉没有」只看三样：error flag / 卸载器 rc / 注册表卸载记录还在不在。
**没有任何一条去看文件系统。** 判据：该文件里 `FileExists` 命中 **0**；
同类正对照（同文件同族 NSIS 指令）`ReadRegStr` = **2**、`RMDir` = **4** ⇒ 查法会响；
负对照当场现编串 = **0** ⇒ 那个 0 是真 0。

⇒ **臂 C 那个第三态正好能让三道判据全部放行。** 要堵它，最小改法是在 `${Else}` 分支里补一条
`FileExists "$1\<主二进制>.exe"` 的复核。**本次未改**，登记在此。

### 五、载体事实（下一棒排预算用，别照抄任何一方的数字）

- 客户机是 **Windows Server 2025 Server Core** ⇒ **`explorer.exe` 不存在、无开始菜单 UI、无任务栏**
  ⇒ 「开始菜单搜索框搜不到」与「任务栏 Unpin」两层在本载体上**物理不可验**；
  **不许拿 lnk 存在性去顶替它们**。
- `virsh screenshot` **直出 PNG**，无需转码。
- 🔴 **控制台会在十几分钟无输入后消隐，此后 `virsh screenshot` 照样 rc=0、照样产出 PNG，只是全黑**
  ⇒ 「截图成功」与「截图有内容」完全同形。做法：截图前先送一次唤醒键 + 对截图做非空判据（大小 / md5 去重）。
- **性能数字两单互相矛盾，别照抄**：单3/单4（后者未过审）报冷启动 ≈37 分钟、`snapshot-revert` 可达 2.5 小时；
  单5 实测冷启动 ≈6 分钟、一次静默安装 ≈215 秒、整轮 ≈32 分钟。成因推断（未验证）是宿主当时被别的负载饱和。
  ⇒ **这台机器的速度是易变态，自己量。** 照 37 分钟排预算会让人误以为一轮做不完，从而去砍臂、砍读数点。

### 六、🔴 未闭合与待裁决（**别让上面看起来像全做完了**）

**未闭合的那一跳（唯一一格）**：**用「Tauri 真生成的、打了这个补丁的 setup.exe」走一遍完整更新**。

已闭合到哪一步（逐条，不许合并成一句「已端到端验证」）：

1. ✅ 「这份 hooks.nsi 在 `$UpdateMode=1/0` 时组出的命令行分别长什么样」—— 由**被拉起的子进程自报**，形状不同；
2. ✅ 「这条命令行喂给**真 v1.1.38 发货卸载器**会不会真保住 lnk」—— 单变量 A/B，0/0 对 1/1；
3. ✅ 「`${GetOptions}` 会不会因为 `/UPDATE` 排在 `_?=` 后面就看不见它」—— 直接测量，不会；
4. ❌ **「真安装器收到 `/UPDATE` 时把 `$UpdateMode` 置 1」这一跳只有上游模板源码引用 + 行为观测，
   没在真 setup.exe 上直接量过**（夹具里的 `$UpdateMode` 是夹具自己的 `.onInit` 设的）；
5. ❌ **「Tauri updater 到底会不会给新安装器传 `/UPDATE`」完全没碰**，属另一条链；
6. ❌ 跨范围升级（≤v1.1.35 currentUser → perMachine）零验证（本载体造不出那个现场）；
7. ❌ App 层端到端零覆盖（没从 App 里点更新）；开始菜单搜索 / 任务栏两层零覆盖（见第五节）。

最省的闭合路径：提交 → 推 tag 让 CI 出 Windows 产物 → 拷进同一台 VM → 按单3 手法跑一遍。
**判据、脚本、载体都已就绪，只差那一个 exe。**

**待裁决（两条都是产品决策，已上报，代码里各留了一条 BACKLOG，见 src-tauri/windows/hooks.nsi:104 与 :109；不许在规则里替它们下结论）**：

- ① **已中招的存量用户**：他们的 lnk 已被删，而模板卸载段里删主二进制那句是**无条件**的、不受 `$UpdateMode` 影响
  ⇒ 现在补建 lnk 只会得到一个「点了没反应」的图标。要不要单独做一次迁移/重建？
- ② **跨范围升级**（≤v1.1.35 currentUser → 现在的 perMachine）：本修法在这一格把「没有图标」变成
  「**图标还在但点不动**」（旧 lnk 指向 %LOCALAPPDATA% 那份 exe，而它被这次卸载无条件删掉了），
  `HKCU\...\Run` 同理会留一条指向已删 exe 的死项。要不要把条件收成「只在旧安装目录 == 新安装目录时才传 `/UPDATE`」？
