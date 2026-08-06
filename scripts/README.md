# 脚本使用说明

## 概述

本目录包含 Huanvae Chat App 的自动化脚本工具，支持 Windows 和 Linux 两个平台。

## 目录结构

```
scripts/
├── release-config.txt        # 共用配置文件
├── README.md                 # 本文件
├── release.ps1               # Windows 发布脚本（7 步）
├── pre-release.ps1           # Windows 预发布检查
├── test-all.ps1              # Windows 完整测试（11 项）
├── build-hg-binaries.ps1     # VPN 守护进程二进制构建 / 替换（Windows 宿主）
├── build-hg-binaries.sh      # VPN 守护进程二进制构建 / 替换（macOS 宿主）
├── hg-connectivity-test.ps1  # VPN 连通性测试（Windows）
├── hg-connectivity-test.sh   # VPN 连通性测试（macOS）
├── setup-wsl-rust.ps1        # Windows WSL Rust 环境设置
├── dev/                      # 开发辅助脚本
│   ├── hg-service.ps1        # HuanvaeGuard 服务注册/启停/查询（dev 环境等价于 NSIS 钩子）
│   ├── hg-tunnel-diag.ps1    # HG 隧道丢包/握手时间线诊断
│   ├── test-code-server.ps1  # code-server sidecar 独立运行测试
│   └── test-editor-e2e.ps1   # 编辑器端到端测试
└── linux/                    # Linux 脚本目录
    ├── README.md             # Linux 脚本说明
    ├── release.sh            # Linux 发布脚本（7 步）
    ├── test-all.sh           # Linux 完整测试（13 项）
    └── setup-deps.sh         # Linux 开发依赖安装
```

> 四个 `build-hg-binaries.*` / `hg-connectivity-test.*` 放在 `scripts/` 根、**不在 `linux/` 下**：
> 它们按**宿主平台**成对（`.sh` = macOS 宿主，`.ps1` = Windows 宿主），两侧被
> `release.sh` / `release.ps1` 与 `test-all.sh` / `test-all.ps1` 各自调用。

## HuanvaeGuard 开发辅助

本项目桌面端集成 HuanvaeGuard VPN 服务（Windows Service + WireGuard）。正式安装（NSIS）
会自动注册服务；**dev 环境下 NSIS 钩子不执行**，需要手动注册。

推荐通过 npm 脚本调用（无需记路径）：

```powershell
pnpm hg:install       # 首次注册服务 + 启动（会弹 UAC）
pnpm hg:status        # 查询服务状态 + 19198 端口监听
pnpm hg:start         # 启动服务（非管理员可用，依赖 install 时设置的 SDDL）
pnpm hg:stop          # 停止服务
pnpm hg:restart       # 重启服务
pnpm hg:uninstall     # 卸载服务
pnpm hg:diag          # 隧道丢包/握手时间线诊断（跑 3 分钟采集）
```

**Rust 运行时行为**：Tauri 进程 setup() 自动启动服务，RunEvent::Exit 自动停止。
因此正常流程下，只需跑一次 `pnpm hg:install` 就能长期使用。

---

## VPN 守护进程二进制：构建 / 替换 + 连通性测试

App 发货两个 VPN 守护进程二进制（macOS `hg-macos`、Windows `huanvaeguard-svc.exe`）。
它们长期是**手工放进去、来源不明、无人验证**的仓内死文件，**已连续造成两起生产故障**：

- **(A) macOS**：装 v1.1.20 后点「修复」恒报 `Bootstrap failed: 5` —— 仓里那份是 linker-signed
  形态，而能被 launchd 加载的那份是 `codesign -f -s -` 显式重签过的。
- **(B) Windows**：用户连 VPN **无握手、上下行包均为 0** —— 仓里那份根本不是在真机上验证过
  「能被 SCM 拉起 + 能建隧道」的那个二进制。

下面两个脚本就是针对这两起故障建的**机器复查**：一个管「发出去的是不是刚从源码构建、校验过的产物」，
一个管「装上去之后隧道是不是真的在承载流量」。

### `build-hg-binaries.sh` / `.ps1` —— 发布前从源码构建并替换

| | |
|---|---|
| **用途** | 从 HuanvaeGuard 源码仓构建各平台守护进程 → 形态断言 → 重签（macOS）→ 替换落点 → sha256 复校 → 泄露扫 → 写 manifest |
| **谁调用** | `scripts/linux/release.sh` **步骤 3/7**（`release.sh:222`）、`scripts/release.ps1` **步骤 3/7**（`release.ps1:233`）；在**全量测试之前**执行 |
| **落点** | `src-tauri/resources/HuanvaeGuard-macos/hg-macos`（crate `hg-macos`）<br>`src-tauri/resources/HuanvaeGuard/huanvaeguard-svc.exe`（crate `hg-windows`，产物名 `hg-windows.exe`，落点改名）<br>`src-tauri/resources/hg-build-manifest.json`（manifest） |
| **退出码** | `0` = 全部产物构建 / 校验 / 替换成功；`1` = 任一环节失败（含泄露扫命中） |

**环境变量**（`.sh`，macOS 宿主：本机构建 macOS，ssh 到 Windows 构建机产出 Windows）：

| 变量 | 默认 | 说明 |
|------|------|------|
| `HG_REPO` | `<项目根>/../HuanvaeGuard` | HuanvaeGuard 源码仓路径 |
| `HG_WIN_BUILD_HOST` | **无默认值** | 构建 Windows 产物的 ssh 目标（形如 `user@host`） |
| `HG_WIN_BUILD_DIR` | `/var/lib/build/HuanvaeGuard` | 该宿主上的构建树路径 |
| `HG_SKIP_WINDOWS` | 不跳 | 置 `1` 只构建 macOS 侧（**仅临时排障，发布前不许这么跑**） |

`.ps1`（Windows 宿主：本机构建 Windows，ssh 到 macOS 构建机产出 macOS）对应的是
`HG_REPO` / `HG_MAC_BUILD_HOST`（**无默认值**）/ `HG_MAC_BUILD_DIR` / `HG_SKIP_MACOS`。

🔴 **构建宿主地址一律经环境变量注入。** 本仓是 PUBLIC 公开仓，脚本、文档、manifest 里
**都不写任何内网地址 / 内部主机名 / 账号**，示例一律用 `user@host` 这类占位符。

**硬性约束（这几条就是两起故障的根治点）**：

1. **来源可追溯** —— 构建源必须是 HuanvaeGuard 仓**当前代码**；manifest 记录来源 commit、
   是否 dirty（含 dirty 文件名前 10 条）、每个产物的 target + sha256 + 实测架构。
2. **macOS 必须显式重签** —— 构建后 `codesign -f -s -`，随后校验 flags **含 `adhoc`、
   不含 `linker-signed`**（故障 A 的直接根因）。
3. **产物形态断言** —— macOS 架构必须**恰好等于** `arm64`（`lipo -archs` 判**相等**，universal
   也中止）；Windows 必须是 **PE32+ x86-64**。构建"成功" ≠ 产物能在目标机上跑，这两条是唯一的机器复查。
4. **替换后重算 sha256 与源产物比对** —— 防「以为替换了其实没替换」。
5. **泄露扫** —— 对产物跑 `strings`，命中构建机路径（`/Users/`、`/home/`、`C:\Users`）或
   RFC1918 私网地址即失败。
6. **构建失败 = 发布中止** —— 绝不回落仓里的旧二进制兜底继续发布。

**两条架构断言为什么是现在这个值**（改产品线时必须连断言一起改，否则复发「装上去 daemon 起不来」）：

- **macOS 恰好 `arm64`**：依据 `.github/workflows/release.yml` 的 macOS build matrix **只有一条**
  （`macos-14` / `aarch64-apple-darwin`），DMG 名是 `..._aarch64.dmg`，updater manifest 也只有
  `darwin-aarch64` 一个 key ⇒ **本产品线 macOS 仅支持 Apple Silicon**。断言存在的意义是**防漂移**。
- **Windows 是 `x86_64-pc-windows-gnu`（mingw），不是 msvc**：mingw 那一份正是真机验证过
  「能被 SCM 拉起 + 能建隧道」的那份；换 msvc 等于重新发一份没人验过的二进制 —— 而
  「发货二进制无人验证」正是这套脚本要根治的病本身。

### `hg-connectivity-test.sh` / `.ps1` —— 判据是「真握手 + 真收发包」

| | |
|---|---|
| **用途** | 量真实数字判定隧道是否**真的在承载流量**，并把**原始命令输出**打印出来备查（不只打结论） |
| **谁调用** | `scripts/linux/test-all.sh` 第 **13** 项（`test-all.sh:534`）、`scripts/test-all.ps1` 第 **11** 项（`test-all.ps1:422`） |
| **平台** | `.sh` 只覆盖 **macOS**（launchctl / ifconfig / netstat -ibn / route），其它系统直接退 `3`；`.ps1` 覆盖 **Windows**（sc.exe / Get-NetAdapterStatistics / ping.exe） |

**五项必测**（任一不过即 FAIL）：

1. **守护进程被系统真拉起** —— macOS `launchctl print` 必须 `state = running`；Windows
   `sc query` 必须 `STATE : 4  RUNNING`。🔴 **手工前台跑得起来不算数**：那是另一条通路
   （踩过的坑就是「手启成功、被服务管理器拉不起来」）。
2. **隧道接口 + VIP** —— status JSON 的 `active` / `interface_name` / `address` + 网卡原始输出。
3. **真实握手** —— `peers[0].last_handshake` 必须非 0（0 = 从未握手）。
4. **真实收发包（两向）** —— ping 前后各采样一次，**收、发分开量**，任一方向增量为 0 即 FAIL。
   故障 B 的形态正是「服务状态看着正常，但上下行包均为 0」，只看状态发现不了。
5. **端到端 ping** —— 丢包率 + 每包 ttl 跳数判定 + 路由不得是内核本地交付。

**环境变量**：

| 变量 | 默认 | 说明 |
|------|------|------|
| `HG_PEER_VIP` | **无默认值，必需** | 对端隧道 VIP。未设置即退 `3` |
| `HG_PEER_INITIAL_TTL` | `64` | 对端 OS 的初始 TTL：macOS/Linux 填 `64`，Windows 填 `128` |
| `HG_CONTROL_PORT` | macOS：从已装 plist 的 `--api-listen` 解析，解析不到才回落默认；Windows：默认值 | 本机守护进程控制口 |
| `HG_PING_COUNT` | `10` | ping 包数 |
| `HG_EXPECT_DAEMON_SHA` | 不校验 | 设置了就**断言**已装守护进程 sha256 相等，不等即 FAIL |

🔴 **对端必须是另一台机器。** 同机两个实例的 VIP 都带 `LOCAL` flag，包永不进隧道，测出来是
**假通过**。所以对端 VIP 只能经 `HG_PEER_VIP` 注入、**无默认值**，脚本与文档里一律用
`<对端VIP>` 占位符（PUBLIC 仓不写真实地址）。

**ttl 判据（别改成硬编码 63）**：ttl 初值由**应答方 OS** 决定（macOS/Linux = 64，Windows = 128），
判「包是否真经过转发」用「**初始 TTL − 实测 ttl == 1**」。把判据写死成 `ttl == 63`，换个 OS 的
对端就恒错。另外 macOS 侧 `route -n get <对端VIP>` 的 flags **含 `LOCAL` 即 FAIL**
（含 LOCAL = 内核本地交付，包永不进隧道）。

**退出码三态**（调用方必须按三态处理，别把 3 当成 1，也别当成 0）：

| 退出码 | 含义 | `test-all` 的处理 |
|--------|------|-------------------|
| `0` | 五项全过 | PASS |
| `1` | 有项 FAIL（**真跑了**，没通过） | FAIL → 发布中止 |
| `3` | 本机物理上跑不了，**未执行**（`HG_PEER_VIP` 未设置 / 本机没装守护进程 / 控制口无应答且 plist 不存在 / 系统不对） | 登记为**跳过** → 走既有「SKIP ≠ PASS」路径（`test-all` 退出码 2）→ **发布中止**，除非 `ALLOW_SKIP=vpn-connectivity` 显式放行并**如实报告** |

**用法**：

```bash
HG_PEER_VIP=<对端VIP> ./scripts/hg-connectivity-test.sh
HG_PEER_VIP=<对端VIP> HG_PEER_INITIAL_TTL=128 ./scripts/hg-connectivity-test.sh   # 对端是 Windows
```

```powershell
$env:HG_PEER_VIP='<对端VIP>'; .\scripts\hg-connectivity-test.ps1
```

## 快速开始

### Windows

```powershell
# 预发布检查
powershell -ExecutionPolicy Bypass -File .\scripts\pre-release.ps1

# 发布
powershell -ExecutionPolicy Bypass -File .\scripts\release.ps1
```

### Linux

```bash
# 添加执行权限 (首次)
chmod +x scripts/linux/*.sh

# 预发布检查
./scripts/linux/pre-release.sh

# 发布
./scripts/linux/release.sh
```

---

## Windows 脚本说明

| 文件 | 说明 |
|------|------|
| `release.ps1` | 自动化发布脚本（7 步，步骤 3 构建替换 VPN 二进制、步骤 4 全量测试） |
| `release-config.txt` | 发布版本配置 |
| `pre-release.ps1` | 预发布检查脚本 |
| `test-all.ps1` | 完整代码质量检查（**11 项**，含 cargo test 与 VPN 连通性测试） |
| `build-hg-binaries.ps1` | 发布前从 HuanvaeGuard 源码构建并替换 VPN 二进制（Windows 宿主） |
| `hg-connectivity-test.ps1` | VPN 连通性测试（真握手 + 真收发包 + 端到端 ping），被 `test-all.ps1` 调用 |
| `setup-wsl-rust.ps1` | WSL2 Rust 环境设置 |

## Linux 脚本说明

详见 [linux/README.md](linux/README.md)

---

## 预发布检查

在发布新版本前，运行预发布检查确保代码质量：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\pre-release.ps1
```

**检查内容：**
1. TypeScript 类型检查
2. ESLint 代码规范检查
3. 单元测试
4. 前端构建测试
5. 人工功能检查清单

---

## 发布流程

### 第一步：编辑配置文件

编辑 `scripts/release-config.txt`，设置版本号和更新说明：

```txt
VERSION=1.0.3
MESSAGE=新增系统托盘功能，优化本地优先加载
```

**注意事项：**
- `VERSION` 使用语义化版本号（如 `1.0.3`、`1.1.0`、`2.0.0`）
- `MESSAGE` 简洁描述本次更新内容
- 每行一个配置项，格式为 `KEY=VALUE`
- 以 `#` 开头的行会被忽略（可用于注释）

### 第二步：运行发布脚本

在项目根目录打开 PowerShell，执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\release.ps1
```

### 第三步：等待构建完成

脚本执行后会输出 GitHub Actions 链接，点击查看构建状态：
- Actions: https://github.com/huanwei520/Huanvae-Chat-App/actions
- Release: https://github.com/huanwei520/Huanvae-Chat-App/releases

## 脚本自动执行的操作

发布脚本是 **7 步一条龙**（`release.ps1` / `scripts/linux/release.sh` 同构），中途不许切开：

1. **版本号一致性检查** - `package.json` / `src-tauri/Cargo.toml` / `src-tauri/tauri.conf.json` 三处必须相同
2. **版本号同步** - 与目标版本不同则改写上述三处（`version` 字段；Cargo.toml 正则锚到 `[package]` 段）
3. **构建并替换 VPN 二进制** - 调 `build-hg-binaries.ps1`（Linux 侧调 `.sh`）从 HuanvaeGuard
   源码构建各平台守护进程 → 断言形态 → 重签 → 替换落点 → sha256 复校 → 泄露扫 → 写 manifest。
   🔴 **失败即中止发布，绝不回落仓里的旧二进制兜底**
4. **全量测试** - 跑 `test-all.ps1`（11 项 / Linux 侧 `test-all.sh` 13 项）；退出码 1（有 FAIL）
   或 2（有跳过未放行）均中止，不提交不推送
5. **同步依赖** - `pnpm install`
6. **Git 提交 + 创建标签** - 提交信息格式 `v{VERSION}: {MESSAGE}`；标签**显式指向本次发布 commit**，
   打完立刻断言标签指向当前 HEAD，不一致即中止且**不推送任何内容**
7. **推送到 GitHub** - 推送代码和标签（tag 用 `--force` 推），触发 GitHub Actions 构建

## 技术细节

### UTF-8 无 BOM 编码

脚本使用 UTF-8 无 BOM 编码写入文件，避免 JSON 解析错误：

```powershell
$Utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($path, $content, $Utf8NoBom)
```

### Cargo.toml 版本替换

脚本使用精确的正则表达式，只替换 `[package]` 部分的 version，不影响依赖项版本：

```powershell
$content -replace '(\[package\][\s\S]*?name\s*=\s*"[^"]+"\s*\n)version\s*=\s*"[^"]+"', "`$1version = `"$Version`""
```

## 常见问题

### Q: 标签冲突怎么办？

脚本会自动删除本地同名标签后重新创建，并使用 `--force` 推送覆盖远程标签。

### Q: 构建失败 "is not valid JSON"？

检查 JSON 文件是否有 BOM 头，可手动修复：

```powershell
$Utf8NoBom = New-Object System.Text.UTF8Encoding $false
$content = [System.IO.File]::ReadAllText("package.json", $Utf8NoBom)
[System.IO.File]::WriteAllText("package.json", $content, $Utf8NoBom)
```

### Q: 如何回退版本？

1. 删除远程标签：`git push origin :refs/tags/v{VERSION}`
2. 删除本地标签：`git tag -d v{VERSION}`
3. 回退提交：`git reset --hard HEAD~1`
4. 强制推送：`git push origin main --force`

