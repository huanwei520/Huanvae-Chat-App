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

**检查内容（共 11 项）：**

| 步骤 | 检查项 | 说明 |
|------|--------|------|
| 1 | Windows NSIS 安装配置检查 | NSIS 安装包 + 自定义 installerHooks + hooks.nsi 存在、更新器 passive 模式 |
| 2 | package.json 验证 | JSON 格式和重复键检查 |
| 3 | Tauri 版本一致性检查 | Rust crate ↔ NPM 包（`tauri` / `tauri-plugin-*`）major.minor 必须对齐 |
| 4 | TypeScript 类型检查 | `pnpm tsc --noEmit` |
| 5 | ESLint 代码检查 | 严格模式，0 errors, 0 warnings |
| 6 | 单元测试 | `pnpm test --run` |
| 7 | Playwright E2E 测试 | `npx playwright test` |
| 8 | 前端构建测试 | 检查构建警告 |
| 9 | Cargo check | Rust 编译检查 |
| 10 | Cargo clippy 桌面端 | Rust 代码审查，禁止任何警告 |
| 11 | Cargo clippy Android | 移动端 Rust 代码审查 |

**测试标准：**
- 要求：**0 errors, 0 warnings**
- 忽略以下已知无害警告：
  - Vite 动态导入优化提示 (`dynamic import will not move module`)
  - ESLint `no-await-in-loop`（已用 eslint-disable 标记的合理用法）
  - `console.warn` / `console.error` 调试日志（允许使用）

**可选参数：**
```bash
./scripts/linux/test-all.sh --skip-rust     # 跳过 Rust 检查（cargo check + clippy 桌面 + clippy Android，共 3 项）
./scripts/linux/test-all.sh --skip-android  # 跳过 Android clippy 检查
./scripts/linux/test-all.sh --skip-e2e      # 跳过 Playwright E2E 测试
```

**跳过 ≠ 通过（默认不放行）：**

任何被跳过的检查项——不管是上面参数显式跳过的，还是运行期环境缺失导致的（Android NDK 未找到 /
`aarch64-linux-android` target 未安装）——都会进入跳过登记表，末尾汇总如实列出：

```
⚠ 本次有 1 项被跳过（未真跑）
- clippy-android: Android NDK 未找到 (设置 NDK_HOME 或使用 --skip-android)
```

**只要存在跳过项，就不会打印「所有检查通过!」**，且默认以**退出码 2** 结束（不视为通过，
`release.sh` 会据此中止发布）。确认这些项确实可以不跑时，用 `ALLOW_SKIP` 环境变量显式放行：

```bash
ALLOW_SKIP=clippy-android ./scripts/linux/test-all.sh        # 放行单项
ALLOW_SKIP="e2e,clippy-android" ./scripts/linux/test-all.sh  # 多项，逗号或空格分隔
ALLOW_SKIP=all ./scripts/linux/test-all.sh                   # 放行全部跳过项
```

可用 id：`e2e` / `cargo-check` / `clippy-desktop` / `clippy-android`。
放行后汇总打印的是 `真跑通过 X/11`（X = 11 − 跳过项数），**不是** "11/11"——报告时按 X 报。

**退出码：**

| 退出码 | 含义 |
|--------|------|
| 0 | 全部真跑通过（11/11），或跳过项已被 `ALLOW_SKIP` 显式放行 |
| 1 | 有检查项 FAIL |
| 2 | 有检查项被跳过且未显式放行（不视为通过） |

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
│     ├─ 全绿(0) → 继续                                   │
│     ├─ 有 FAIL(1) → ❌ 报错退出                         │
│     └─ 跳过未放行(2) → ❌ 中止(跳过≠通过)               │
│                     ↓                                   │
│  5. 同步 pnpm-lock.yaml                                 │
│                     ↓                                   │
│  6. Git 提交 + 创建标签(指向本次 commit)                │
│     └─ 校验标签指向当前 HEAD                            │
│        └─ 不一致 → ❌ 中止且不推送                      │
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
| 3 | 完整测试 | 运行 `test-all.sh`；退出码 1（有 FAIL）或 2（有跳过未放行）均中止发布，不提交不推送 |
| 4 | 依赖同步 | 运行 `pnpm install` |
| 5 | Git 提交 | 自动 commit 所有变更（`git add -A`） |
| 6 | 创建标签 + 指向校验 | 创建 `v{VERSION}` 标签并**显式指向本次发布 commit**，随后校验标签确实指向当前 HEAD；不一致则打印两个 sha + 手工修正步骤后中止，**不推送任何内容** |
| 7 | 自动推送 | 推送到 GitHub 触发 Actions 构建（tag 用 `--force` 推） |

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

### Q: 提示"有检查项被跳过且未真跑 —— 发布中止"怎么办？

`test-all.sh` 以退出码 2 结束了，说明有检查项没真跑（明细见它的汇总）。两条正路：

1. **补齐环境后重跑**（推荐）：例如装 NDK（`export NDK_HOME=...`）或
   `rustup target add aarch64-linux-android`，然后重跑 `./scripts/linux/release.sh`。
2. **确认可以不跑，显式放行**：`ALLOW_SKIP=clippy-android ./scripts/linux/release.sh`。
   这是一个决策，不是绕过——发布记录里要写清放行了哪几项、真跑 X/11。

不要用 `--skip-*` 参数跑 `release.sh`：参数会被原样透传给 `test-all.sh`，等于主动降门槛。

### Q: 提示"标签指向校验失败: vX.Y.Z 没有指向当前 HEAD"怎么办？

脚本在**推送之前**发现标签指向了别的 commit，已中止且**没有推送任何内容**（本地留下一个已提交的
commit + 一个指错的 tag）。按脚本打印的三步修正：

```bash
git tag -f "vX.Y.Z" $(git rev-parse HEAD)               # 1) 把标签挪到当前 HEAD
git rev-parse "vX.Y.Z^{commit}"; git rev-parse HEAD     # 2) 两行输出必须完全相同
# 3) 核对无误后重跑 release.sh（会识别"已是目标版本"跳过版本更新），
#    或手工 git push origin main && git push origin "vX.Y.Z" --force
```

这个校验是 v1.1.20 那次"标签被打到上一个 commit"之后加的兜底。**该现象的真因尚未定位**（脚本、
hook、行尾、worktree、packed-refs 都排查过，350 次循环也没复现），所以校验只保证"打错时推不出去"，
不代表问题已根除。再次遇到请先记下打印的两个 sha 和 `git reflog` 输出再修正，别直接覆盖掉现场。

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

- **2026-08-05**: SKIP 不再等于 PASS + 标签指向校验
  - `test-all.sh` 新增跳过登记表：参数跳过与运行期跳过（NDK / target 缺失）全部登记并在汇总列出
  - 只要有跳过项就不再打印"所有检查通过!"；默认退出码 2，需 `ALLOW_SKIP` 显式放行才算通过
  - 退出码语义定为 0（真跑通过/已放行）/ 1（有 FAIL）/ 2（有跳过未放行），`release.sh` 逐个接住
  - `[n/N]` 步骤计数改为按实际执行块数计算（修正 `--skip-rust` 跳 3 块只减 2 的错）
  - `release.sh` 打标签改为显式指向本次发布 commit，并在推送前校验标签指向 HEAD，不一致即中止
  - 本文件检查项表由 9 项订正为 11 项，补 `--skip-e2e` 与 `ALLOW_SKIP` 说明

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
