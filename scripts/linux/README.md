# Linux 脚本使用说明

## 概述

本目录包含 Huanvae Chat App 的 Linux 版自动化脚本工具。

## 文件说明

| 文件 | 说明 |
|------|------|
| `release.sh` | 自动化发布脚本（测试通过后自动推送，无需确认） |
| `test-all.sh` | 完整代码质量检查 |
| `setup-deps.sh` | 开发环境依赖安装 |

---

## 首次使用

### 1. 安装开发依赖

```bash
./scripts/linux/setup-deps.sh
```

此脚本会自动检测发行版并安装：
- Tauri 开发所需的系统库
- Rust 工具链 (rustc, cargo, clippy, rustfmt)
- avahi-daemon (mDNS 设备发现)

支持的发行版：
- Debian/Ubuntu/Linux Mint/Pop!_OS
- Fedora/RHEL/CentOS/Rocky Linux
- Arch Linux/Manjaro
- openSUSE

### 2. 添加执行权限

```bash
chmod +x scripts/linux/*.sh
```

---

## 代码质量检查

### 完整测试 (推荐)

```bash
./scripts/linux/test-all.sh
```

**检查内容（共 9 项）：**

| 步骤 | 检查项 | 说明 |
|------|--------|------|
| 1 | Windows 安装配置检查 | WiX 模板 perUser 模式、更新器 passive 模式 |
| 2 | package.json 验证 | JSON 格式和重复键检查 |
| 3 | TypeScript 类型检查 | `pnpm tsc --noEmit` |
| 4 | ESLint 代码检查 | 严格模式，0 errors, 0 warnings |
| 5 | 单元测试 | `pnpm test --run` |
| 6 | 前端构建测试 | 检查构建警告 |
| 7 | Cargo check | Rust 编译检查 |
| 8 | Cargo clippy 桌面端 | Rust 代码审查，禁止任何警告 |
| 9 | Cargo clippy Android | 移动端 Rust 代码审查 |

**测试标准：**
- 要求：**0 errors, 0 warnings**
- 忽略以下已知无害警告：
  - Vite 动态导入优化提示 (`dynamic import will not move module`)
  - ESLint `no-await-in-loop`（已用 eslint-disable 标记的合理用法）
  - `console.warn` / `console.error` 调试日志（允许使用）

**可选参数：**
```bash
./scripts/linux/test-all.sh --skip-rust     # 跳过 Rust 检查
./scripts/linux/test-all.sh --skip-android  # 跳过 Android clippy 检查
```

**Android clippy 需要：**
- 已安装 Android NDK（设置 `$NDK_HOME` 环境变量）
- 已安装 Rust Android 目标：`rustup target add aarch64-linux-android`

---

## 发布流程

### 发布脚本流程图

```
┌─────────────────────────────────────────────────────────┐
│            release.sh 自动发布流程                       │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  1. 读取 release-config.txt 目标版本号                  │
│                     ↓                                   │
│  2. 检查当前项目版本号一致性                            │
│     (package.json / Cargo.toml / tauri.conf.json)       │
│     ├─ 一致 → 继续                                      │
│     └─ 不一致 → ❌ 报错退出                             │
│                     ↓                                   │
│  3. 对比目标版本与当前版本                              │
│     ├─ 相同 → 继续                                      │
│     └─ 不同 → 自动更新所有版本号                        │
│                     ↓                                   │
│  4. 运行完整测试 (test-all.sh)                          │
│     ├─ 通过 → 继续                                      │
│     └─ 失败 → ❌ 报错退出                               │
│                     ↓                                   │
│  5. 同步 pnpm-lock.yaml                                 │
│                     ↓                                   │
│  6. Git 提交 + 创建标签                                 │
│                     ↓                                   │
│  7. 自动推送到 GitHub（无需确认）                       │
│                     ↓                                   │
│  ✅ 发布完成，GitHub Actions 自动构建                   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 第一步：编辑配置文件

编辑 `scripts/release-config.txt`：

```txt
VERSION=1.0.26
MESSAGE=局域网传输优化、统一MSI安装包
```

**注意：**
- `VERSION` 是目标版本号
- `MESSAGE` 是本次更新说明（用于 Git commit message）

### 第二步：运行发布脚本

```bash
./scripts/linux/release.sh
```

**测试通过后自动推送发布，无需手动确认！**

### 发布脚本自动执行的操作

| 步骤 | 操作 | 说明 |
|------|------|------|
| 1 | 版本一致性检查 | 确保三个配置文件版本号相同 |
| 2 | 版本对比与更新 | 自动更新到目标版本 |
| 3 | 完整测试 | 运行 `test-all.sh`，必须全部通过 |
| 4 | 依赖同步 | 运行 `pnpm install` |
| 5 | Git 提交 | 自动 commit 所有变更 |
| 6 | 创建标签 | 创建 `v{VERSION}` 标签 |
| 7 | 自动推送 | 推送到 GitHub 触发 Actions 构建 |

### 版本号说明

发布脚本会自动同步以下三个文件的版本号：

| 文件 | 版本字段 |
|------|----------|
| `package.json` | `"version": "x.x.x"` |
| `src-tauri/Cargo.toml` | `version = "x.x.x"` |
| `src-tauri/tauri.conf.json` | `"version": "x.x.x"` |

**版本规则：**
- 如果当前版本与目标版本相同，跳过更新
- 如果不同，自动更新所有文件
- 如果三个文件版本不一致，脚本报错退出

---

## 与 Windows 脚本的区别

| 特性 | Windows (PowerShell) | Linux (Bash) |
|------|---------------------|--------------|
| 编码处理 | 需要显式指定 UTF-8 无 BOM | 默认 UTF-8，无需处理 |
| 跨平台检查 | 通过 WSL2 检查 Linux 构建 | 直接运行 cargo check/clippy |
| 依赖安装 | setup-wsl-rust.ps1 | setup-deps.sh |
| 路径分隔符 | 反斜杠 `\` | 正斜杠 `/` |

---

## 常见问题

### Q: 权限不足怎么办？

```bash
chmod +x scripts/linux/*.sh
```

### Q: 版本号不一致怎么办？

如果脚本报错"当前项目版本号不一致"，需要先手动统一：

```bash
# 检查当前版本
grep '"version"' package.json | head -1
grep '^version = ' src-tauri/Cargo.toml
grep '"version"' src-tauri/tauri.conf.json | head -1
```

### Q: cargo clippy 报错怎么办？

Clippy 使用严格模式（-D warnings），任何警告都会导致失败。

```bash
# 自动修复部分问题
cargo clippy --fix --allow-dirty

# 查看详细建议
cargo clippy --all-targets --all-features 2>&1 | less
```

### Q: Android clippy 如何单独运行？

```bash
cd src-tauri

# 设置 NDK 环境变量
export NDK_HOME=$HOME/Android/Sdk/ndk/29.0.14206865  # 替换为你的版本
export CC_aarch64_linux_android="$NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin/aarch64-linux-android24-clang"
export AR_aarch64_linux_android="$NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-ar"

# 运行 Android clippy
cargo clippy --target aarch64-linux-android
```

### Q: Android NDK 未找到怎么办？

1. 确保已安装 Android NDK（通过 Android Studio SDK Manager）
2. 设置 `NDK_HOME` 环境变量：
   ```bash
   export NDK_HOME=$HOME/Android/Sdk/ndk/29.0.14206865
   ```
3. 或在 `~/.bashrc` 中永久设置

### Q: ESLint 报警告怎么办？

```bash
# 自动修复部分问题
pnpm lint --fix

# 查看所有问题
pnpm lint
```

### Q: 如何回退发布？

```bash
# 1. 删除远程标签
git push origin :refs/tags/v{VERSION}

# 2. 删除本地标签
git tag -d v{VERSION}

# 3. 回退提交
git reset --hard HEAD~1

# 4. 强制推送
git push origin main --force
```

### Q: 测试失败后版本号怎么办？

如果测试失败但版本号已更新：
- 可以继续修复问题后重新运行发布脚本
- 版本号会被检测为已是目标版本，自动跳过更新步骤

---

## 更新日志

- **2026-01-25**: 简化发布流程
  - 移除预发布脚本 (pre-release.sh)
  - 测试通过后自动推送发布，无需手动确认
  - 更新 Windows 安装配置检查（WiX perUser + updater passive）

- **2026-01-24**: 优化发布流程
  - 添加版本号一致性检查
  - 先更新版本号再进行测试
  - 测试必须全部通过才能发布
  - 添加推送确认步骤
  - 更新 test-all.sh 忽略无害的 Vite 动态导入警告
