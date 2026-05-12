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
