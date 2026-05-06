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
