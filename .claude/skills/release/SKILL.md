---
name: release
description: 版本发布流程 — 一条龙原子脚本（三处版本号同步 → 全量测试 → commit → tag → force push），含 PUBLIC 仓脱敏核与三个必踩坑
argument-hint: <目标版本号 + 更新说明>
disable-model-invocation: false
allowed-tools: Read, Grep, Glob, Bash, Edit
---

# 版本发布流程

发布 = **跑一个一条龙原子脚本**，不是"手动改版本号 → 手动 commit → 手动 push"。
本 skill 的真值源是脚本本身（[scripts/linux/release.sh](../../../scripts/linux/release.sh) /
[scripts/linux/test-all.sh](../../../scripts/linux/test-all.sh)），**不是** `scripts/*/README.md`
——README 已有过时处（见文末「README 与脚本不一致」）。凡本文与脚本冲突，以脚本为准。

## 入口（两步，就这两步）

1. 编辑 [scripts/release-config.txt](../../../scripts/release-config.txt)：

```txt
VERSION=1.1.20
MESSAGE=本次更新的一句话说明
```

2. 在**项目根**跑（Linux）：

```bash
./scripts/linux/release.sh          # 不带任何参数 —— 见坑 1
```

Windows 侧入口是 **`scripts/release.ps1`**（不是 `release.sh` 的同名 ps1 变体）：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\release.ps1
```

**配置文件解析的两个硬点**（release.sh:92-109）：

- 解析是 `while IFS='=' read -r key value`，**只有 key 被 `tr -d '[:space:]'` 清洗**（:93），
  value 原样保留 ⇒ `=` 两侧不要留空格，否则版本号会带空格、`git tag "v1.1.20 "` 直接失败。
- `VERSION` / `MESSAGE` 缺任一即 exit 1（:102-109）。`MESSAGE` 是文件最后一行，
  **文件必须有结尾换行**，否则 `read` 丢掉最后一行 → 报"配置格式错误"。
- `#` 开头的行被跳过（:94），可写注释。

## 一条龙原子流程：中途不许切开

脚本从版本号一路做到 push，**不存在"我只跑前半段，后面手动补"这种用法**。理由：步骤 2 已经把
三个文件的版本号改成目标版本（工作树变脏），此时中断 = 留下一棵"版本号已升、没测没提交"的脏树，
下一个人接手时既分不清哪些改动属于本批，也会在下次跑脚本时因 `git add -A` 被裹进去（坑 2）。

| 脚本步骤 | 行号 | 做什么 | 失败行为 |
|---------|------|--------|---------|
| 1/6 版本一致性 | :119-140 | 读 `package.json`(:122) / `src-tauri/Cargo.toml`(:123) / `src-tauri/tauri.conf.json`(:124)，三者必须相同 | 不一致直接 `exit 1`(:139)，要求先手动统一 |
| 2/6 版本同步 | :145-185 | 与目标版本不同则 `sed -i` 改三处：package.json(:162)、tauri.conf.json(:165)、Cargo.toml(:168，正则锚到 `[package]` 段，不动依赖版本)，改完回读校验(:171-184) | 校验不过 `exit 1`(:183) |
| 3/6 全量测试 | :190-206 | 调 `"$SCRIPT_DIR/test-all.sh" "$@"`(:196) | 非 0 即 `exit 1`(:205)，并提示版本号已升、修完可重跑 |
| 4/6 依赖同步 | :214-225 | `pnpm install --frozen-lockfile`(:216)，失败退回 `pnpm install`(:219) | 两次都失败 `exit 1`(:223) |
| 5/6 提交 + 打标签 | :230-253 | `COMMIT_MSG="v$VER: $MSG"`(:232)；有改动则 **`git add -A`**(:245) + `git commit -m`(:246)；然后 `git tag -d` + `git tag "v$VER"`(:251-252) | — |
| 6/6 推送 | :258-268 | `git push origin main`(:265)；`git push origin "v$VER" --force`(:266) | — |

tag 推上去后 `.github/workflows/release.yml` 由 `push: tags: 'v*'` 触发，构建 Win/Linux/macOS/Android
产物并发 Release。**即 push tag 那一刻发布就已不可撤销地对外发生**，脱敏核必须在此之前做完。

## 版本号规则：每次 +0.0.1

按 huanwei 口径，每次发布 **patch 位 +1**（`1.1.19` → `1.1.20`），不自作主张跳 minor/major。
当前版本读 `scripts/release-config.txt` 的 `VERSION` 或 `package.json`。不确定要不要跨位时**问，别猜**。

---

## 🔴 坑 1：跑 release.sh 一律不带任何参数

release.sh:196 是：

```bash
if ! "$SCRIPT_DIR/test-all.sh" "$@"; then
```

`"$@"` = **把 release.sh 收到的参数原样透传给 test-all.sh**。而 test-all.sh:31-37 解析三个开关：

```bash
--skip-rust) SKIP_RUST=true ;;      # :33  砍掉 cargo check + clippy 桌面 + clippy Android（3 项）
--skip-android) SKIP_ANDROID=true ;; # :34  砍掉 clippy Android
--skip-e2e) SKIP_E2E=true ;;         # :35  砍掉 Playwright E2E
```

⇒ `./scripts/linux/release.sh --skip-e2e` 会**静默**发布一个没跑过 E2E 的版本。它不报错、不警告，
末尾照样打印"所有检查通过"（test-all.sh 只是把 `TOTAL_STEPS` 从 11 减到 10，:60-62）——
这就是**降门槛硬推**，属红线。

顺带：`--skip-rust` 实际跳过 **3** 个块（:340 cargo check / :365 clippy 桌面 / :388 clippy Android），
但计数器只减 2（:54-56）⇒ 带 flag 时打印出来的 `[n/N]` 本身就是错的。**别拿脚本打印的项数当验收依据**，
按下表逐项核对实际输出。

**判据**：`release.sh` 后面跟任何东西 = 违规。要调试测试就单独跑 `./scripts/linux/test-all.sh --skip-xxx`，
但那条命令的结果**不能**当作发布门禁的通过凭据。

**同族的软跳过（同样要盯）**：test-all.sh 的 Android clippy 在 NDK 未找到(:402)或
`aarch64-linux-android` target 未安装(:406)时打印 `⚠ SKIP` 且**不置 `ALL_PASSED=false`** ⇒
"全绿"里可能根本没跑 Android。发布前确认输出里第 11 项是 `✓ PASS` 而不是 `⚠ SKIP`。

## 🔴 坑 2：`git add -A` 会把整棵工作树裹进这次发布

release.sh:245 是全量 add：

```bash
git add -A
git commit -m "$COMMIT_MSG"
```

不是 `git add <本批文件>`。⇒ 工作树里**任何**未提交改动——上一个任务的半成品、调试用的临时改动、
别的 agent 留下的文件——都会被打进这个 `v<版本>` 提交并推上公开仓，且 commit message 只说本次发布说明，
事后完全看不出混进了什么。

**开跑前必须先点清工作树改动归属，确认没有不属于本批的东西。**

⚠️ 本仓是巨树（virtiofs 慢 IO），**禁用 `git status` 和 `git add -A` 做排查**——会超时。改用有界命令：

```bash
git diff --name-only                                    # 已跟踪、未暂存
git diff --cached --name-only                           # 已暂存
git ls-files --others --exclude-standard -- src tests scripts .claude   # 未跟踪，按目录限定

# 判归属：看 mtime（macOS / BSD）
stat -f "%Sm %N" <file>...
# Linux
stat -c '%y %n' <file>...
```

逐个文件回答"它属于本批发布吗"。答不上来的 = 停下来问，不要"顺手带上"。

## 🔴 坑 3：tag 是 force 推，同名 tag 会被无声覆盖

release.sh:251-252 先 `git tag -d` 再重建本地 tag，:266 是：

```bash
git push origin "v$TARGET_VERSION" --force
```

⇒ 远端已存在的同名 tag **直接被覆盖**，指向新 commit。后果：

- 已经基于旧 tag 出过的 Release 产物与 tag 内容对不上，用户拿到的安装包无法溯源到确切代码。
- 复用一个已发布过的版本号（比如"上次发失败了我再发一次同版本"）会覆盖历史，而不是报错拦住你。

**判据**：`VERSION` 必须是**没发布过的新版本号**。要确认：

```bash
git tag -l 'v1.1.*' | tail -5          # 本地
git ls-remote --tags origin 'v1.1.*'   # 远端（以远端为准）
```

同版本重发是个**决策**，不是操作细节——必须由人明确拍板，agent 不得自行覆盖。

---

## 🔴 PUBLIC 仓脱敏核（push 前必做，两面都要）

本仓是**公开仓**。push 一旦发生，泄露即进入 git 历史与 GitHub Release，**删不干净**。
脱敏核分文本面和二进制面，**二进制面是踩过的那一次**。

### 1) 文本面

```bash
git grep -nIE 'BEGIN [A-Z ]*PRIVATE KEY|ssh-(ed25519|rsa) AAAA|(DATABASE_URL|REDIS_URL|REDIS_PASSWORD)=|[A-Z0-9_]*_(TOKEN|SECRET|PASSWORD)=[^"'"'"'$ ]|(^|[^0-9.])(10|192\.168|172\.(1[6-9]|2[0-9]|3[01]))\.[0-9]{1,3}\.[0-9]{1,3}'
```

覆盖：私钥块、SSH 公钥、库连接串、带真值的凭据 env、RFC1918 私网地址。
另外按业务再补一轮：**内部控制面/部署系统的名字前缀、内部主机名后缀、mesh 组网名**
（这些字面量不写进本文件——本文件自己也在公开仓里；从非公开的工作区规则里取）。

命中不等于泄露（示例、占位、注释里的通用格式是合法的），但**每一处都要打开看**，
确认它是占位而不是真值。判据：这行字符串**能不能直接拿去连上什么东西**——能就是泄露。

### 2) 二进制面（`strings` 扫，别跳过）

文本 grep 看不见编译产物里的东西。二进制会带**编译机的绝对路径、内部主机名、构建元数据**。

```bash
# 枚举当前 tracked 的二进制（今天是 2 个：gradle-wrapper.jar、wintun.dll）
git ls-files | grep -iE '\.(jar|exe|dll|so|dylib|node|bin|wasm|apk|aar)$'

# 逐个扫
for f in $(git ls-files | grep -iE '\.(jar|exe|dll|so|dylib|node|bin|wasm|apk|aar)$'); do
  echo "== $f"
  strings -a "$f" | grep -aiE '/Users/|/Volumes/|/home/[a-z]|BEGIN [A-Z ]*PRIVATE KEY|ssh-ed25519|(^|[^0-9.])(10|192\.168|172\.(1[6-9]|2[0-9]|3[01]))\.[0-9]{1,3}\.'
done
```

**为什么这条是硬要求（真实反例）**：VPN 服务/守护进程二进制曾长期被 tracked 并随公开仓一起发布，
"along with build-time metadata that has no reason to be published"（见 `git log edbb439` /
`6501c2e` 的 commit body）。根因有两层：① 未 strip 的二进制把内部结构和构建路径明文带了出去；
② 该目录**早就有 ignore 规则**，但 ignore 对**已 tracked** 的路径无效——它是被 `git add -f`
强推进 index 的，之后每次发布都在重新发布它。现已改为 `git rm --cached` + 构建时按 sha256
manifest 拉取校验（`scripts/dev/fetch-hg-*.mjs`）。

⇒ **判据**：本批新增了任何二进制文件 = 高危，必须 strings 扫 + 回答"它凭什么该进公开仓"。
默认答案是**不该**——构建产物走 fetch + sha256 校验，不入 index。
（该二进制仍留在历史里；清理历史是另一个决策，不在发布流程内顺手做。）

---

## 测试没全绿就停 —— 如实报，不许改测试

release.sh:196 的 test-all.sh 覆盖 **11 项**（test-all.sh:53 `TOTAL_STEPS=11`）：

| # | 检查 | 行号 |
|---|------|------|
| 1 | Windows NSIS 安装配置 | :67 |
| 2 | package.json 验证（重复键 + JSON 格式） | :105 |
| 3 | Tauri 版本一致性（Rust crate ↔ NPM 包，major/minor 必须对齐） | :148 |
| 4 | TypeScript `pnpm tsc --noEmit` | :224 |
| 5 | ESLint（0 errors, **0 warnings**） | :236 |
| 6 | 单元测试 `pnpm test --run` | :259 |
| 7 | Playwright E2E | :282 |
| 8 | 前端 `pnpm build`（查 Vite 警告） | :305 |
| 9 | `cargo check` | :341 |
| 10 | `cargo clippy` 桌面（`-D warnings`） | :366 |
| 11 | `cargo clippy` Android | :389 |

任一 FAIL → `ALL_PASSED=false` → `exit 1`(:453) → release.sh 中止在步骤 3，**不会提交、不会推送**
（版本号已改，工作树留脏——修完重跑即可，步骤 2 会识别"已是目标版本"并跳过）。

**红线**：测试没全绿 = 发布停止 + 如实报告哪几项 FAIL。
**禁止**：改测试断言、加 `--skip-*`、注释掉用例、降 lint 阈值来"让它绿"。
这三种做法都能让脚本走完，但发出去的是一个没被验证过的版本——比不发布严重得多。

修 FAIL 的常见坑：[.claude/rules/frontend-test.md](../../rules/frontend-test.md)（vi.hoisted、
animation-conflict 注册、AnimatePresence 消失断言竞态）、
[.claude/rules/rust-dev.md](../../rules/rust-dev.md)（HG 服务文件锁导致 cargo 失败）。

## 平台差异（别把两边的结论互相套用）

| | Linux `scripts/linux/release.sh` | Windows `scripts/release.ps1` |
|---|---|---|
| 调测试 | `"$SCRIPT_DIR/test-all.sh" "$@"`(:196) — **透传参数** | `& powershell ... test-all.ps1`(:212) — **不传参数**，无坑 1 |
| 测试项数 | 11（含 Tauri 版本一致性 + E2E） | 9（无这两项，对齐 CLAUDE.md 的「9/9」口径） |
| 版本号改写 | `sed -i`(:162/:165/:168) | UTF-8 无 BOM `WriteAllText` + 正则 |
| 提交 / 标签 / 推送 | :245 / :251-252 / :265-266 | :266 / :274-275 / :288-289（行为完全相同，含 `--force` 推 tag） |

⚠️ **不要在 macOS 上跑 `scripts/linux/release.sh`**：步骤 2 用 GNU 语法 `sed -i "s/.../"`，
macOS 是 BSD sed（`-i` 必须带备份后缀），会报 `invalid command code` 并因 `set -e`(:30) 中止。
更隐蔽的是：当**当前版本已等于目标版本**时步骤 2 整段被跳过(:152-153)，脚本会继续往下跑——
于是同一个脚本在 mac 上"有时炸有时不炸"。发布在 Linux（或 WSL）上做。

## README 与脚本不一致（以脚本为准）

- [scripts/linux/README.md:52](../../../scripts/linux/README.md) 写"检查内容（共 9 项）"并给出
  一张 9 行表 —— **过时**。test-all.sh:53 是 `TOTAL_STEPS=11`，多出「Tauri 版本一致性(:148)」
  和「Playwright E2E(:282)」两项。
- 同文件的可选参数一节只列了 `--skip-rust` / `--skip-android`，漏了 `--skip-e2e`（test-all.sh:35）。

⇒ 引用发布流程细节时**直接读脚本**，不要引 README 的数字。
