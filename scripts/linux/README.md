# Linux 脚本使用说明

## 概述

本目录包含 Huanvae Chat App 的 Linux 版自动化脚本工具。

## 文件说明

| 文件 | 说明 |
|------|------|
| `release.sh` | 自动化发布脚本 |
| `pre-release.sh` | 预发布检查脚本 |
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

检查内容：
1. **NSIS 钩子检查** - Windows 更新兼容性
2. **package.json 验证** - JSON 格式和重复键检查
3. **TypeScript 类型检查** - `pnpm tsc --noEmit`
4. **ESLint 代码检查** - 严格模式，0 errors, 0 warnings
5. **单元测试** - `pnpm test --run`
6. **前端构建测试** - 检查 Vite 优化警告
7. **Cargo check** - Rust 编译检查
8. **Cargo clippy 桌面端** - Rust 代码审查，禁止任何警告
9. **Cargo clippy Android** - 移动端 Rust 代码审查

可选参数：
```bash
./scripts/linux/test-all.sh --skip-rust     # 跳过 Rust 检查
./scripts/linux/test-all.sh --skip-android  # 跳过 Android clippy 检查
```

Android clippy 需要：
- 已安装 Android NDK（设置 `$NDK_HOME` 环境变量）
- 已安装 Rust Android 目标：`rustup target add aarch64-linux-android`

### 预发布检查

```bash
./scripts/linux/pre-release.sh
```

包含自动检查 + 人工功能确认清单。

---

## 发布流程

### 第一步：编辑配置文件

编辑 `scripts/release-config.txt`：

```txt
VERSION=1.0.19
MESSAGE=新增局域网自动配置功能
```

### 第二步：运行发布脚本

```bash
./scripts/linux/release.sh
```

### 发布脚本自动执行的操作

1. ✅ 运行完整测试 (`test-all.sh`)
2. ✅ 验证 tauri.conf.json 配置
3. ✅ 同步 pnpm-lock.yaml
4. ✅ 更新 package.json 版本号
5. ✅ 更新 tauri.conf.json 版本号
6. ✅ 更新 Cargo.toml 版本号
7. ✅ Git commit
8. ✅ 创建 Git tag
9. ✅ 推送到 GitHub

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

### Q: cargo clippy 报错怎么办？

Clippy 使用严格模式（-D warnings），任何警告都会导致失败。
请按照提示修复代码中的问题。

常见修复：
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
