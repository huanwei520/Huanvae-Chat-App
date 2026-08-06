---
name: release
description: 版本发布流程 — 一条龙原子脚本（三处版本号同步 → 全量测试 → commit → tag → 校验 tag 指向 → force push），含 PUBLIC 仓脱敏核与四个必踩坑
argument-hint: <目标版本号 + 更新说明>
disable-model-invocation: false
allowed-tools: Read, Grep, Glob, Bash, Edit
---

# 版本发布流程

发布 = **跑一个一条龙原子脚本**，不是"手动改版本号 → 手动 commit → 手动 push"。
本 skill 的真值源是脚本本身（[scripts/linux/release.sh](../../../scripts/linux/release.sh) /
[scripts/linux/test-all.sh](../../../scripts/linux/test-all.sh)）。`scripts/linux/README.md`
已与脚本同步（见文末「README 同步状态」），但它仍是二手描述——凡本文 / README 与脚本冲突，
一律以脚本为准。

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

**配置文件解析的两个硬点**（release.sh:113-133）：

- 解析是 `while IFS='=' read -r key value`（:116），**只有 key 被 `tr -d '[:space:]'` 清洗**（:117），
  value 原样保留 ⇒ `=` 两侧不要留空格，否则版本号会带空格、`git tag "v1.1.20 "` 直接失败。
- `VERSION` / `MESSAGE` 缺任一即 exit 1（:126-132）。`MESSAGE` 是文件最后一行，
  **文件必须有结尾换行**，否则 `read` 丢掉最后一行 → 报"配置格式错误"。
- `#` 开头的行被跳过（:118），可写注释。

## 一条龙原子流程：中途不许切开

脚本从版本号一路做到 push，**不存在"我只跑前半段，后面手动补"这种用法**。理由：步骤 2 已经把
三个文件的版本号改成目标版本（工作树变脏），此时中断 = 留下一棵"版本号已升、没测没提交"的脏树，
下一个人接手时既分不清哪些改动属于本批，也会在下次跑脚本时因 `git add -A` 被裹进去（坑 2）。

| 脚本步骤 | 行号 | 做什么 | 失败行为 |
|---------|------|--------|---------|
| 1/6 版本一致性 | :143-164 | 读 `package.json`(:146) / `src-tauri/Cargo.toml`(:147) / `src-tauri/tauri.conf.json`(:148)，三者必须相同 | 不一致直接 `exit 1`(:163)，要求先手动统一 |
| 2/6 版本同步 | :169-209 | 与目标版本不同则 `sed -i` 改三处：package.json(:186)、tauri.conf.json(:189)、Cargo.toml(:192，正则锚到 `[package]` 段，不动依赖版本)，改完回读校验(:195-208) | 校验不过 `exit 1`(:207) |
| 3/6 全量测试 | :214-240 | `TEST_EXIT=0`(:220) 后调 `"$SCRIPT_DIR/test-all.sh" "$@"`(:221)，**接住退出码** | 非 0 一律中止在这里、`exit 1`(:239)：退出码 **2**（有跳过未放行）走专门文案「跳过 ≠ 通过」+ 提示 `ALLOW_SKIP=...`(:225-229)；其它非 0 走 FAIL 文案(:230-232)。两者都**不提交、不推送**，并提示版本号已升、修完可重跑 |
| 4/6 依赖同步 | :248-259 | `pnpm install --frozen-lockfile`(:250)，失败退回 `pnpm install`(:253) | 两次都失败 `exit 1`(:257) |
| 5/6 提交 + 打标签 | :264-289 | `COMMIT_MSG="v$VER: $MSG"`(:266)；有改动则 **`git add -A`**(:274) + `git commit -m`(:275)；`RELEASE_SHA=$(git rev-parse HEAD)`(:280) 锁定本次发布 commit；`git tag -d`(:283) 后 `git tag "v$VER" "$RELEASE_SHA"`(:284) **显式指向**该 commit；随即 `assert_tag_points_at_head`(:287，函数体 :81-101) 断言 tag 指向当前 HEAD | 断言不过：打印两个 sha + 三步手工修正指引 → `exit 1`(:288)，**在 push 之前中止、不推送任何内容**（见坑 4） |
| 6/6 推送 | :294-302 | `git push origin main`(:301)；`git push origin "v$VER" --force`(:302) | — |

tag 推上去后 `.github/workflows/release.yml` 由 `push: tags: 'v*'` 触发，构建 Win/Linux/macOS/Android
产物并发 Release。**即 push tag 那一刻发布就已不可撤销地对外发生**，脱敏核必须在此之前做完。

## 版本号规则：每次 +0.0.1

按 huanwei 口径，每次发布 **patch 位 +1**（`1.1.19` → `1.1.20`），不自作主张跳 minor/major。
当前版本读 `scripts/release-config.txt` 的 `VERSION` 或 `package.json`。不确定要不要跨位时**问，别猜**。

---

## 🔴 坑 1：跑 release.sh 一律不带任何参数

release.sh:220-221 是：

```bash
TEST_EXIT=0
"$SCRIPT_DIR/test-all.sh" "$@" || TEST_EXIT=$?
```

`"$@"` = **把 release.sh 收到的参数原样透传给 test-all.sh**。而 test-all.sh:51-57 解析三个开关：

```bash
--skip-rust) SKIP_RUST=true ;;      # :53  砍掉 cargo check + clippy 桌面 + clippy Android（3 项）
--skip-android) SKIP_ANDROID=true ;; # :54  砍掉 clippy Android
--skip-e2e) SKIP_E2E=true ;;         # :55  砍掉 Playwright E2E
```

⇒ `./scripts/linux/release.sh --skip-e2e` = 要求发布一个没跑过 E2E 的版本，属**降门槛硬推**，红线。

**这类降门槛现在不再是静默的**（脚本已修）。flag 触发的跳过在开跑时就登记进跳过表
（`record_skip`，:41-45 / :89-98）；末尾汇总先列 `⚠ 本次有 N 项被跳过（未真跑）` + 每项
`- id: 原因`（:496-502），然后**默认以退出码 2 结束**（:536-544）。release.sh 步骤 3 接住 2，
打印「有检查项被跳过且未真跑 —— 发布中止（跳过 ≠ 通过）」后 `exit 1`（:225-229 / :239）——
**不提交、不推送**。只有 `ALLOW_SKIP` 显式放行时才走「⚠ 放行：本次有 N 项被跳过」+
`真跑通过 X/11` 并 exit 0（:528-534）。

🔴 **只要存在跳过项，任何分支都不再打印「所有检查通过!」**——那句只在零跳过时出现（:512-518）。

**判据不变**：`release.sh` 后面跟任何东西 = 违规。`ALLOW_SKIP` 是给"环境确实装不上"的兜底闸，
不是给"懒得跑"用的 —— 用它是一个**决策**，得有人拍板，且交付里必须写清放行了哪几项、真跑 X/11。
要调试测试就单独跑 `./scripts/linux/test-all.sh --skip-xxx`，但那条命令的结果**不能**当作发布门禁的通过凭据。

**计数器已修**：`TOTAL_STEPS` 现在按 flag 实算（:75-80，恒定 7 块 + E2E / Rust 两块 / Android 各按需加），
`step_header` 递增（:83-86），打印的 `[n/N]` 与本次**实际执行**的块数一致（旧版"跳 3 块只减 2"的错已不存在）。
但注意 **N 是"本次跑了几块"，不是全量 11** —— 验收口径看末尾那行 `X/11 真跑通过`（:515 / :531）
和跳过清单，别拿 `[n/N]` 当交付依据。

**同族的软跳过（运行期跳过，走完全相同的路径）**：Android clippy 在 NDK 未找到（:438）或
`aarch64-linux-android` target 未安装（:442）时同样调 `record_skip clippy-android` ⇒ 一样进汇总、
一样默认 exit 2、一样拦住发布。所以"这台机器没装 NDK 所以那项没跑"不会再混进"全绿"里；
要在这种机器上发版，只能显式 `ALLOW_SKIP=clippy-android ./scripts/linux/release.sh`
并**如实报告"Android clippy 未真跑，真跑 10/11"**。

## 🔴 坑 2：`git add -A` 会把整棵工作树裹进这次发布

release.sh:274-275 是全量 add：

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

release.sh:283-284 先 `git tag -d` 再重建本地 tag，:302 是：

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

## 🔴 坑 4：tag 指向自检（曾打到"上一个 commit"，真因未定位）

**事实**：v1.1.20 那次发布，tag `v1.1.20` 最终指向的是**上一个 commit**（`22447dd`）而不是本次发布
commit（`e2a305d`），并且以 `--force` 推了上去。

**真因至今未定位。** 已排查并排除的方向：脚本里 `git tag` 只出现 3 处、commit 确实在 tag 之前执行、
没有 `set +e` 打断错误传播、没有自定义 git hook、配置文件不是 CRLF、`.git/packed-refs` 自 5 月起未更新、
仓库只有一个 worktree；在本机 virtiofs 上做 350 次 commit→tag 循环也**未能复现**。
所以下面这层**不是"根因已修复"**，而是在不知道根因的前提下**保证它再次发生时打不出去**。

**脚本现在做两件事**（release.sh 步骤 5）：

1. **显式指定 tag 目标**：先 `RELEASE_SHA=$(git rev-parse HEAD)`(:280) 锁定本次发布 commit，
   再 `git tag "v$TARGET_VERSION" "$RELEASE_SHA"`(:284) —— 不再依赖 `git tag` 隐式解析 HEAD。
2. **打完即断言**：`assert_tag_points_at_head`(:81-101，调用点 :287) 比对
   `git rev-parse "<tag>^{commit}"` 与 `git rev-parse HEAD`，不一致就打印两个 sha + 三步手工修正指引，
   `exit 1`(:288)。这一步在**步骤 6 推送之前**，所以断言失败时**没有任何东西被推出去**
   （本地留下：一个已提交的 commit + 一个指错的 tag）。

**断言失败时怎么手工修正**（脚本自己也会打印这三步）：

```bash
git tag -f "v<版本>" $(git rev-parse HEAD)                    # 1) 强制把 tag 挪到当前 HEAD
git rev-parse "v<版本>^{commit}"; git rev-parse HEAD          # 2) 两行输出必须完全相同
# 3) 核对无误后重跑 release.sh（步骤 2 会识别"已是目标版本"并跳过），
#    或手工 git push origin main && git push origin "v<版本>" --force
```

⇒ 每次发布仍要**肉眼核对**那行 `✓ 标签指向校验通过: v<版本> -> <sha>`，并与 `git log -1 --format=%H`
对得上。断言是兜底，不是"问题已解决"的证明；再次出现指错就是复现线索，要留现场（别急着 `git tag -f`
覆盖掉证据，先记下两个 sha 和 `git reflog` 输出）。

### 推完必须自核远端（强制收尾，不是可选项）

本地那条断言只证明**推之前**是对的，证明不了**远端最终是什么**。push 返回 0 之后立刻核：

```bash
git rev-parse HEAD
git ls-remote origin refs/heads/main
git ls-remote origin "refs/tags/v<版本>" "refs/tags/v<版本>^{}"
```

三者必须指向**同一个 commit**（tag 若是 annotated，以 `^{}` 解引用后的值为准）。

**这一步真的抓到过**：一次发布远端 tag 指向的是**上一个 commit**，而本地一路看着都正常。所以它是收尾的一部分，不是"有空再看"。

⚠️ 自核发现不一致时 —— **先取证，再修**：记下两个 sha、`git reflog`、`.git/refs/tags/<tag>` 的内容与 **mtime**（`stat -f "%Sm %N"`）。直接 `git tag -f` 会把 ref 的原始 mtime 覆盖掉，真因就再也查不了（**已踩过**：见 [.claude/rules/common.md](../../rules/common.md)「修 bug 之前先取证」）。

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
# 枚举当前 tracked 的二进制（结果会变，以命令输出为准；2026-08-06 是 3 个：gradle-wrapper.jar / huanvaeguard-svc.exe / wintun.dll）
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
强推进 index 的，之后每次发布都在重新发布它。
后来改成过 `git rm --cached` + 构建时按 sha256 manifest 拉取校验，但该设计**已被全量回退**
（见 `git log fba9d2a`）：当前形态回到 **仓内跟踪 + CI 直接构建** —— `scripts/dev/fetch-hg-*.mjs`
已不存在，`huanvaeguard-svc.exe` / `wintun.dll` 仍是 tracked。⇒ 上面的 `strings` 扫**照做不误**，
这两个文件就在枚举结果里。

**通用教训（与那套已回退的设计无关，别读成"应该恢复它"）**：给 workflow 加"构建时拉取 + 校验"
这类**外部供给**步骤时，配套的凭据 / 来源必须**同批建好并真跑验证过一次**再合入 —— 这类步骤按设计
就是"拉不到即硬失败"，缺一样就把该平台的产物整个打没。本仓因此连续一个版本缺 macOS DMG 与 Windows EXE。

⇒ **判据**：本批**新增**了任何二进制文件 = 高危，必须 strings 扫 + 回答"它凭什么该进公开仓"，
默认答案是**不该**入 index。注意别把它跟现状搞混：HG 那两个二进制是**既有的、明知故犯地留在仓内**
（见上），不是本条判据的放行先例 —— 新增件仍要单独说清"为什么它必须随公开仓分发"。
（历史里的那份二进制也仍在；清理历史是另一个决策，不在发布流程内顺手做。）

---

## 测试没全绿就停 —— 如实报，不许改测试

release.sh:221 调的 test-all.sh 覆盖 **11 项**（test-all.sh:474 `CANONICAL_TOTAL=11`，与脚本里 11 个检查块一一对应）：

| # | 检查 | 行号 |
|---|------|------|
| 1 | Windows NSIS 安装配置 | :103 |
| 2 | package.json 验证（重复键 + JSON 格式） | :141 |
| 3 | Tauri 版本一致性（Rust crate ↔ NPM 包，major/minor 必须对齐） | :184 |
| 4 | TypeScript `pnpm tsc --noEmit` | :260 |
| 5 | ESLint（0 errors, **0 warnings**） | :272 |
| 6 | 单元测试 `pnpm test --run` | :295 |
| 7 | Playwright E2E | :318 |
| 8 | 前端 `pnpm build`（查 Vite 警告） | :341 |
| 9 | `cargo check` | :377 |
| 10 | `cargo clippy` 桌面（`-D warnings`） | :402 |
| 11 | `cargo clippy` Android | :425 |

任一 FAIL → `ALL_PASSED=false` → `exit 1`(:504-510) → release.sh 中止在步骤 3(:239)，**不会提交、不会推送**
（版本号已改，工作树留脏——修完重跑即可，步骤 2 会识别"已是目标版本"并跳过）。

**test-all.sh 退出码三态**（脚本头 :21-24 有注释；release.sh:223-239 逐个接住）：

| 退出码 | 含义 | release.sh 行为 |
|--------|------|----------------|
| 0 | 全部真跑通过（`11/11`），**或**跳过项已被 `ALLOW_SKIP` 显式放行（`真跑通过 X/11`） | 继续步骤 4 |
| 1 | 有检查项 FAIL | 「测试检查未通过」(:231) → `exit 1`(:239)，不提交不推送 |
| 2 | 有检查项被跳过且未放行（SKIP ≠ PASS） | 「跳过 ≠ 通过」+ 提示 `ALLOW_SKIP=clippy-android ./scripts/linux/release.sh`(:226-229) → `exit 1`(:239)，不提交不推送 |

⚠️ 退出码 0 **不等于** 11/11：拿 `ALLOW_SKIP` 放行过就是 `X/11`。向上汇报时**必须报那个 X 和被放行的 id**，
不许把"exit 0"翻译成"全部通过"。（v1.1.20 就是据一次含 `⚠ SKIP` 的 exit 0 错报了"11/11 通过"。）

**红线**：测试没全绿 = 发布停止 + 如实报告哪几项 FAIL。
**禁止**：改测试断言、加 `--skip-*`、注释掉用例、降 lint 阈值来"让它绿"。
这三种做法都能让脚本走完，但发出去的是一个没被验证过的版本——比不发布严重得多。

修 FAIL 的常见坑：[.claude/rules/frontend-test.md](../../rules/frontend-test.md)（vi.hoisted、
animation-conflict 注册、AnimatePresence 消失断言竞态）、
[.claude/rules/rust-dev.md](../../rules/rust-dev.md)（HG 服务文件锁导致 cargo 失败）。

## 平台差异（别把两边的结论互相套用）

| | Linux `scripts/linux/release.sh` | Windows `scripts/release.ps1` |
|---|---|---|
| 调测试 | `"$SCRIPT_DIR/test-all.sh" "$@"`(:221) — **透传参数**（坑 1） | `& powershell ... test-all.ps1`(:232) — **不传参数**，无透传面 |
| 测试项数（canonical） | 11（test-all.sh:474，含 Tauri 版本一致性 + E2E） | **9**（test-all.ps1:365，无这两项，对齐 CLAUDE.md 的「9/9」口径） |
| 跳过登记 / `ALLOW_SKIP` 可用 id | `e2e` / `cargo-check` / `clippy-desktop` / `clippy-android`（test-all.sh:17-18） | `cargo-check` / `clippy-desktop` / `clippy-android` —— **无 `e2e`**（test-all.ps1:18） |
| 跳过未放行 → 退出码 2 | test-all.sh:544；release.sh:225-229 接住 | test-all.ps1:426；release.ps1:237-242 接住 |
| 标签指向断言 | `assert_tag_points_at_head`(:81-101，调用 :287) | `Assert-TagPointsAtHead`(release.ps1:65，调用 :309) |
| 版本号改写 | `sed -i`(:186/:189/:192) | UTF-8 无 BOM `WriteAllText`(:179/:184/:191) + 正则 |
| 提交 / 标签 / 推送 | :274-275 / :280-284 / :301-302 | :295-298 / :304-306 / :321-322（行为相同，含 `--force` 推 tag） |

⚠️ **Windows 侧的对称修复尚未运行验证**：`scripts/test-all.ps1` / `scripts/release.ps1` 已按与 Linux
相同口径改好（跳过登记 + `$env:ALLOW_SKIP` + 退出码 2 + `Assert-TagPointsAtHead`），但本次改动
**在 macOS 上完成、本机无 PowerShell，两个 ps1 一行都没实际跑过**。Windows 侧首次使用时按"未验证代码"
对待：先单独跑 `.\scripts\test-all.ps1` 核对汇总文案与退出码是否符合预期，再拿它发版。

⚠️ **不要在 macOS 上跑 `scripts/linux/release.sh`**：步骤 2 用 GNU 语法 `sed -i "s/.../"`(:186/:189/:192)，
macOS 是 BSD sed —— 它的 `-i` **必须带备份后缀**，于是把 `s/.../` 脚本吃成后缀、把**文件名**当成脚本，
结果是 **rc=1 且文件一个字没改**（报文随脚本内容而异：简单 `s///` 报 `unescaped newline inside
substitute pattern`，带地址范围的 Cargo.toml 那条报 `undefined label`），再被 `set -e`(:31) 当场中止。
更隐蔽的是：当**当前版本已等于目标版本**时步骤 2 整段被跳过(:176-177)，脚本会继续往下跑——
于是同一个脚本在 mac 上"有时炸有时不炸"。

**发布优先在 Linux（或 WSL）上做。** 只有在必须从 macOS 发时才用这条绕法：**先手工把三处版本号
（`package.json` / `src-tauri/Cargo.toml` / `src-tauri/tauri.conf.json`）改到目标值**，让步骤 2 命中
「已是目标版本」整段跳过 —— 步骤 3~6（全量测试 → commit → 打 tag → 校验指向 → push）**仍完整留在
脚本内跑**，所以这不是"手动补后半段"（那违反本文开头的一条龙红线）。用这条绕法时，交付里必须写清
"版本号是手工改的、步骤 2 被跳过"，别让人误以为脚本从头跑通了。

## README 同步状态

[scripts/linux/README.md](../../../scripts/linux/README.md) 已与当前脚本同步，本次订正了四处：

- 检查项表由 9 项改为 **11 项**（补上「Tauri 版本一致性」「Playwright E2E」），第 1 项的说明也从
  过时的 "WiX 模板 perUser" 改成实际检查的 NSIS + installerHooks。
- 可选参数补 `--skip-e2e`（原先只列了 `--skip-rust` / `--skip-android`）。
- 新增「跳过 ≠ 通过」段：跳过登记表、`ALLOW_SKIP` 用法与可用 id、退出码 0/1/2 语义。
- 发布流程图与「自动执行的操作」表补上"创建标签后校验指向当前 HEAD，不一致中止且不推送"。

⇒ 它现在可以当入门说明读，但**仍是二手描述**，脚本再改时它可能又落后。
引用发布流程的**具体行号 / 项数 / 退出码**时，直接读脚本。
