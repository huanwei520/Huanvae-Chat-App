# Linux 脚本使用说明

## 概述

本目录包含 Huanvae Chat App 的 Linux 版自动化脚本工具。

## 文件说明

| 文件 | 说明 |
|------|------|
| `release.sh` | 自动化发布脚本（7 步；测试通过后自动推送，无需确认） |
| `test-all.sh` | 完整代码质量检查（13 项） |
| `setup-deps.sh` | 开发环境依赖安装 |

本目录之外、但被上面两个脚本调用的两个新脚本（放在 `scripts/` 根，按宿主平台成对，
详见 [../README.md](../README.md)）：

| 文件 | 被谁调用 | 说明 |
|------|---------|------|
| `../build-hg-binaries.sh` | `release.sh` 步骤 3/7 | 发布前从 HuanvaeGuard 源码构建各平台 VPN 守护进程二进制并替换进落点，**失败即中止发布** |
| `../hg-connectivity-test.sh` | `test-all.sh` 第 13 项 | VPN 连通性测试：真握手 + 真收发包 + 端到端 ping。**只覆盖 macOS**，在 Linux 上直接以退出码 3（未执行）返回 |

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

**检查内容（共 13 项，`test-all.sh:765` `CANONICAL_TOTAL=13`）：**

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
| 11 | Cargo clippy Android | 移动端 Rust 代码审查。**三态**：本机有 NDK/target → 本机跑；本机没有但设了 `ANDROID_CLIPPY_HOST` → **交给远程 Android 构建宿主真跑**；两者都没有才跳过（详见下方「Android clippy 的远程执行」） |
| 12 | **Cargo test** | `cargo test --lib`。既有门禁只跑 `cargo check` + `clippy`、**从不运行测试**，于是 `src-tauri/src/desktop/huanvaeguard_macos.rs` 里那两条**发货件静态守卫**（打包 plist 的每个 `--` 开关必须真出现在打包二进制里；发货二进制不得含 `/Users/`、`/home/`、`C:\Users` 等构建机路径）等于**没接线**。本项把它们接上 |
| 13 | **VPN 连通性测试** | 调 `../hg-connectivity-test.sh`，判据是**真握手 + 真收发包 + 端到端 ping**，不是"服务起来了"（真实故障形态是服务状态看着正常、上下行包却均为 0）。原始命令输出**原样打印**，不只打结论 |

**测试标准：**
- 要求：**0 errors, 0 warnings**
- 忽略以下已知无害警告：
  - Vite 动态导入优化提示 (`dynamic import will not move module`)
  - ESLint `no-await-in-loop`（已用 eslint-disable 标记的合理用法）
  - `console.warn` / `console.error` 调试日志（允许使用）

**可选参数：**
```bash
./scripts/linux/test-all.sh --skip-rust     # 跳过 Rust 检查（cargo check + clippy 桌面 + clippy Android + cargo test，共 4 项）
./scripts/linux/test-all.sh --skip-android  # 跳过 Android clippy 检查
./scripts/linux/test-all.sh --skip-e2e      # 跳过 Playwright E2E 测试
./scripts/linux/test-all.sh --skip-vpn      # 跳过 VPN 连通性测试
```

注意 `--skip-rust` 现在砍掉的是 **4 项**（多了第 12 项 `cargo test`），不是过去的 3 项。
🔴 `--skip-android` 砍掉的**不再是"一个本机跑不了的项"**，而是**一项本可在远程构建宿主真跑的检查** ——
本机没 NDK 时的正路是设 `ANDROID_CLIPPY_HOST`（见下），不是 `--skip-android`。

**跳过 ≠ 通过（默认不放行）：**

任何被跳过的检查项——不管是上面参数显式跳过的，还是运行期环境缺失导致的（clippy Android：
本机无 NDK/`aarch64-linux-android` target **且**未配置远程构建宿主；VPN 连通性：被调脚本退 `3`）
——都会进入跳过登记表，末尾汇总如实列出：

```
⚠ 本次有 1 项被跳过（未真跑）
- clippy-android: 本机无 Android NDK/target，且未配置远程构建宿主 —— 设 ANDROID_CLIPPY_HOST=user@host 走远程真跑（推荐），或设 NDK_HOME 本机跑，或 --skip-android
```

**只要存在跳过项，就不会打印「所有检查通过!」**，且默认以**退出码 2** 结束（不视为通过，
`release.sh` 会据此中止发布）。确认这些项确实可以不跑时，用 `ALLOW_SKIP` 环境变量显式放行：

```bash
ALLOW_SKIP=clippy-android ./scripts/linux/test-all.sh        # 放行单项
ALLOW_SKIP="e2e,clippy-android" ./scripts/linux/test-all.sh  # 多项，逗号或空格分隔
ALLOW_SKIP=all ./scripts/linux/test-all.sh                   # 放行全部跳过项
```

可用 id（`test-all.sh:22-23`）：`e2e` / `cargo-check` / `clippy-desktop` / `clippy-android` /
`cargo-test` / `vpn-connectivity`。
放行后汇总打印的是 `真跑通过 X/13`（X = 13 − 跳过项数），**不是** "13/13"——报告时按 X 报。

**VPN 连通性测试的"跳过"是怎么来的**：`../hg-connectivity-test.sh` 的退出码是**三态** ——
`0` 全过 / `1` 有项 FAIL / **`3` 本机物理上跑不了（未执行）**。`3` 由 `test-all.sh` 登记为
`vpn-connectivity` 跳过项，走的就是上面这条既有的「SKIP ≠ PASS」路径 → 默认退出码 2 →
**发布中止**，除非 `ALLOW_SKIP=vpn-connectivity` 显式放行并**如实报告**。
Linux 上这一项**必然是跳过**（该脚本只覆盖 macOS）；要真跑它得在装了守护进程、
且有**另一台机器**作对端（`HG_PEER_VIP` 注入）的 macOS / Windows 上执行。

**退出码：**

| 退出码 | 含义 |
|--------|------|
| 0 | 全部真跑通过（13/13），或跳过项已被 `ALLOW_SKIP` 显式放行 |
| 1 | 有检查项 FAIL |
| 2 | 有检查项被跳过且未显式放行（不视为通过） |

### Android clippy 的远程执行（本机没 NDK 时的**正路**，不是跳过）

第 11 项按 **本机 → 远程构建宿主 → 才允许跳过** 三态执行（块头注释 `test-all.sh:453`）：

| 态 | 条件 | 行为 |
|---|---|---|
| ① | 本机有 NDK（`$NDK_HOME`）且装了 `aarch64-linux-android` target | 本机真跑（最快路径） |
| ② | 本机不具备，但设了 `ANDROID_CLIPPY_HOST` | 白名单打包源码 → `scp` → 远程 Android 构建宿主**真跑**，rc 与完整输出取回本机，按与本机完全相同的口径判 PASS/FAIL |
| ③ | **两者都没有** | 才 `record_skip clippy-android`（`test-all.sh:676`），仍走「SKIP ≠ PASS」 |

```bash
# 本机没有 NDK 时这样跑，第 11 项是"真跑"而不是"跳过"
ANDROID_CLIPPY_HOST=user@host ./scripts/linux/test-all.sh
```

**环境变量**（真值源是脚本头注释 `test-all.sh:27` 起）：

| 变量 | 默认 | 说明 |
|------|------|------|
| `ANDROID_CLIPPY_HOST` | **无默认值** | 远程 Android 构建宿主的 ssh 目标（形如 `user@host`）。不设 = 不启用远程态 |
| `ANDROID_CLIPPY_REMOTE_DIR` | `/tmp/hv-clippy-android` | 该宿主上的源码同步目录 |
| `ANDROID_CLIPPY_REMOTE_NDK_HOME` | 远程自动探测 | 显式指定远程 NDK 路径 |
| `ANDROID_CLIPPY_SSH_OPTS` | 空 | 追加给 `ssh`/`scp` 的参数（如 `-i ~/.ssh/somekey`） |
| `ANDROID_CLIPPY_JOBS` | `8` | 远程 `cargo` 并发度（构建宿主常跑着别的服务，别抢爆） |

🔴 **主机地址一律经环境变量注入。** 本仓是 PUBLIC 公开仓，脚本与文档里**都不写任何内网地址 /
内部主机名 / 账号**，示例一律用 `user@host` 占位；该值只在运行时注入，**不落盘、不入日志**
（与 `HG_WIN_BUILD_HOST` 同一套红线）。

🔴 **设了却连不上 = FAIL，绝不自动退回跳过。** 五种失败全部 FAIL、无一条退回 skip：
连不上（ssh 预检失败）/ 同步失败 / 远程无 Android 工具链 / 远程 clippy 真报错误告警 /
中途断连拿不到结束哨兵。文案把「网络 / 凭据问题」与「代码问题」分开，便于排障。
自动退回等于把"没跑"重新伪装成"环境不具备" —— 那正是这套改造要根治的病。

⚠️ 同步载荷用的是**白名单**（只带 `src-tauri` + `Notification-Sounds`），不是"排除大目录"的黑名单：
仓根有 `data/`（App portable 模式的本地运行数据落点，含**聊天数据库与用户文件**），
黑名单漏一条就会把用户数据 `scp` 出本机。

---

## 发布流程

### 发布脚本流程图

```
┌─────────────────────────────────────────────────────────┐
│            release.sh 自动发布流程（7 步）               │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  读取 release-config.txt 目标版本号                     │
│                     ↓                                   │
│  1. 检查当前项目版本号一致性                            │
│     (package.json / Cargo.toml / tauri.conf.json)       │
│     ├─ 一致 → 继续                                      │
│     └─ 不一致 → ❌ 报错退出                             │
│                     ↓                                   │
│  2. 对比目标版本与当前版本                              │
│     ├─ 相同 → 继续                                      │
│     └─ 不同 → 自动更新所有版本号                        │
│                     ↓                                   │
│  3. 构建并替换 VPN 二进制 (build-hg-binaries.sh)        │
│     从 HuanvaeGuard 源码构建 → 形态断言 → 重签(mac)     │
│     → 替换落点 → sha256 复校 → 泄露扫 → 写 manifest     │
│     ├─ 成功(0) → 继续                                   │
│     └─ 失败(1) → ❌ 中止(绝不回落仓里的旧二进制)        │
│                     ↓                                   │
│  4. 运行完整测试 (test-all.sh，13 项)                   │
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
| 3 | **构建并替换 VPN 二进制** | 调 `../build-hg-binaries.sh`：从 HuanvaeGuard 源码构建各平台守护进程 → 断言产物形态（macOS 恰好 `arm64`、Windows `PE32+ x86-64`）→ macOS `codesign -f -s -` 重签并校验 flags 含 `adhoc` 且不含 `linker-signed` → 替换落点并**重算 sha256 与源产物比对** → `strings` 泄露扫 → 写 `src-tauri/resources/hg-build-manifest.json`（来源 commit / dirty / 各产物 target+sha256+架构）。🔴 **构建失败即中止发布，绝不用仓里的旧二进制兜底** |
| 4 | 完整测试 | 运行 `test-all.sh`（13 项）；退出码 1（有 FAIL）或 2（有跳过未放行）均中止发布，不提交不推送 |
| 5 | 依赖同步 | 运行 `pnpm install` |
| 6 | Git 提交 + 创建标签 + 指向校验 | 自动 commit 所有变更（`git add -A`）；创建 `v{VERSION}` 标签并**显式指向本次发布 commit**，随后校验标签确实指向当前 HEAD；不一致则打印两个 sha + 手工修正步骤后中止，**不推送任何内容** |
| 7 | 自动推送 | 推送到 GitHub 触发 Actions 构建（tag 用 `--force` 推） |

**步骤 3 为什么存在**：App 发货的两个 VPN 守护进程二进制长期是「手工放进去、来源不明、无人验证」
的仓内死文件，**已连续造成两起生产故障** —— (A) macOS 装 v1.1.20 后点「修复」恒报
`Bootstrap failed: 5`（仓里那份是 linker-signed，能跑的那份是显式重签过的）；(B) Windows 用户连
VPN **无握手、上下行包均为 0**（仓里那份根本不是真机验证过的那个二进制）。步骤 3 把它们改成
「每次发布前从源码构建 → 校验 → 替换」的可复现产物。构建宿主地址一律经环境变量
（`HG_REPO` / `HG_WIN_BUILD_HOST` / `HG_WIN_BUILD_DIR` / `HG_SKIP_WINDOWS`）注入，
**公开仓内不写任何内网地址**。细节见 [../README.md](../README.md)。

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

**先问一句：有没有远程 Android 构建宿主？有就别装 NDK。**

0. **（推荐）交给远程构建宿主真跑**：`ANDROID_CLIPPY_HOST=user@host ./scripts/linux/test-all.sh` ——
   本机一个字节都不用装，第 11 项是真跑而不是跳过。见上文「Android clippy 的远程执行」。
1. 确保已安装 Android NDK（通过 Android Studio SDK Manager）
2. 设置 `NDK_HOME` 环境变量：
   ```bash
   export NDK_HOME=$HOME/Android/Sdk/ndk/29.0.14206865
   ```
3. 或在 `~/.bashrc` 中永久设置

🔴 三条都做不到才允许 `ALLOW_SKIP=clippy-android`，且理由必须如实写成
「本机无 NDK/target **且**未配置远程构建宿主」，不许只写"本机没有 NDK"。

### Q: ESLint 报警告怎么办？

```bash
# 自动修复部分问题
pnpm lint --fix

# 查看所有问题
pnpm lint
```

### Q: 提示"有检查项被跳过且未真跑 —— 发布中止"怎么办？

`test-all.sh` 以退出码 2 结束了，说明有检查项没真跑（明细见它的汇总）。**三条正路，按顺序试**：

1. **交给远程构建宿主真跑**（推荐，跳过项是 `clippy-android` 时的首选）：
   ```bash
   ANDROID_CLIPPY_HOST=user@host ./scripts/linux/release.sh
   ```
   本机一个字节都不用装，rc 与完整输出取回本机，按与本机完全相同的口径判 PASS/FAIL，**照样拿满 13/13**。
   见上文「Android clippy 的远程执行」。
2. **补齐本机环境后重跑**：装 NDK（`export NDK_HOME=...`）或
   `rustup target add aarch64-linux-android`，然后重跑 `./scripts/linux/release.sh`。
3. **确认确实跑不了，才显式放行**：`ALLOW_SKIP=clippy-android ./scripts/linux/release.sh`。
   这是一个决策，不是绕过——发布记录里要写清放行了哪几项、真跑 X/13，
   且 `clippy-android` 的放行理由**必须写成双条件**「本机无 NDK/target **且**未配置远程构建宿主」，
   🔴 **不许只写"本机没有 NDK"**（v1.1.30 就是这么放行的，而当时远程构建宿主一直可用）。

不要用 `--skip-*` 参数跑 `release.sh`：参数会被原样透传给 `test-all.sh`，等于主动降门槛。

### Q: 提示"VPN 二进制构建/替换失败 —— 发布中止"怎么办？

步骤 3 的 `../build-hg-binaries.sh` 非 0 退出了。**唯一正路是把构建修好后重跑**，
🔴 **不许绕过、不许拿仓里的旧二进制继续发**（那正是两起生产故障的根因）。常见原因：

- `HG_REPO` 指不到 HuanvaeGuard 源码仓，或它不是 git 仓库 → 用 `HG_REPO=/path/to/HuanvaeGuard` 指定。
- `HG_WIN_BUILD_HOST` 未设置（**无默认值**，公开仓不写内网地址）→ 显式注入 ssh 目标。
- 产物形态断言不过（macOS 架构不等于 `arm64`、Windows 不是 `PE32+ x86-64`）→ 说明发布目标变了，
  需要人重新决策守护进程该产出什么形态，脚本不会默默放行。
- macOS 重签后 flags 不含 `adhoc` 或仍含 `linker-signed` → 签名形态不符合预期，launchd 可能拒绝加载。
- `strings` 泄露扫命中构建机路径或私网地址 → 构建时 `--remap-path-prefix` 没生效，
  别用环境变量 `RUSTFLAGS`（会整体覆盖 HuanvaeGuard 仓 `.cargo/config.toml` 里的设置）。

`HG_SKIP_WINDOWS=1` 只用于临时排障，**发布前不许这么跑**（manifest 会缺 Windows 产物）。

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

- **2026-08-12**: 第 11 项 clippy Android 由「本机跑不了就跳过」改为**三态：本机 → 远程构建宿主 → 才允许跳过**
  - 新增 `ANDROID_CLIPPY_HOST`（**无默认值**，形如 `user@host`）等 5 个 `ANDROID_CLIPPY_*` 环境变量：
    本机无 NDK 时把源码同步到远程 Android 构建宿主**真跑**，rc 与完整输出取回本机
  - 🔴 设了却连不上 / 同步失败 / 远程无工具链 / 远程 clippy 非 0 / 中途断连 —— **五种失败全部 FAIL，
    无一条退回跳过**；跳过文案改成**双条件**（本机无 NDK/target **且**未配置远程宿主）
  - 动机：v1.1.30 以「本机无 Android NDK」为由 `ALLOW_SKIP` 放行，而本仓一直有可用的远程 Android
    构建宿主（实测 NDK / 4 个 android target / clippy 全部现成，远程真跑 `rc=0`、0 warnings）
  - 同批修掉 6 处 `OUT=$(cmd) || true` 紧跟 `EXIT=$?` 的 rc 捕获缺陷（rc 恒为 0 ⇒ FAIL 分支不可达）
  - 本文件：检查项表第 11 项补三态说明、新增「Android clippy 的远程执行」小节、
    「两条正路」改**三条**（远程真跑排第 1）、行号锚点重锚

- **2026-08-06**: 发货 VPN 二进制改为源码构建 + 新增 VPN 连通性测试 + `cargo test` 接进门禁
  - `release.sh` 新增**步骤 3/7**：调 `../build-hg-binaries.sh` 从 HuanvaeGuard 源码构建各平台
    VPN 守护进程二进制并替换进落点（形态断言 + macOS 重签 + sha256 复校 + 泄露扫 + manifest），
    **失败即中止发布**；脚本步骤总数由 6 变 **7**
  - `test-all.sh` 新增第 **12** 项 `cargo test`：既有门禁只跑 `cargo check` + `clippy`、从不运行测试，
    `huanvaeguard_macos.rs` 里两条发货件静态守卫等于没接线，本项把它们接上
  - `test-all.sh` 新增第 **13** 项 VPN 连通性测试：判据是真握手 + 真收发包 + 端到端 ping，
    不是"服务起来了"；调用脚本退出码三态（0/1/**3=未执行**），`3` 登记为跳过走 SKIP ≠ PASS 路径
  - `CANONICAL_TOTAL` 由 11 改为 **13**；新增 `--skip-vpn` 参数；`ALLOW_SKIP` 可用 id 补
    `cargo-test` / `vpn-connectivity`；`--skip-rust` 现在砍 4 项（多了 `cargo test`）
  - 本文件检查项表由 11 项订正为 13 项，发布流程图与「自动执行的操作」表补上步骤 3

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
