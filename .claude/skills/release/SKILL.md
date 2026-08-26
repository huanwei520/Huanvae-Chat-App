---
name: release
description: 版本发布流程 — 一条龙原子脚本（三处版本号同步 → 从源码构建替换 VPN 二进制 → 全量测试 → commit → tag → 校验 tag 指向 → force push），含 PUBLIC 仓脱敏核与四个必踩坑
argument-hint: <目标版本号 + 更新说明>
disable-model-invocation: false
allowed-tools: Read, Grep, Glob, Bash, Edit
---

# 版本发布流程

发布 = **跑一个一条龙原子脚本**，不是"手动改版本号 → 手动 commit → 手动 push"。
本 skill 的真值源是脚本本身：

- [scripts/linux/release.sh](../../../scripts/linux/release.sh)（7 步一条龙）
- [scripts/linux/test-all.sh](../../../scripts/linux/test-all.sh)（13 项门禁）
- [scripts/build-hg-binaries.sh](../../../scripts/build-hg-binaries.sh)（发布前构建 / 替换 VPN 二进制，被 release.sh 步骤 3 调用）
- [scripts/hg-connectivity-test.sh](../../../scripts/hg-connectivity-test.sh)（VPN 连通性测试，被 test-all.sh 第 13 项调用）

`scripts/linux/README.md` 已与脚本同步（见文末「README 同步状态」），但它仍是二手描述——
凡本文 / README 与脚本冲突，一律以脚本为准。

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

**配置文件解析的两个硬点**（release.sh:115-135）：

- 解析是 `while IFS='=' read -r key value`（:118），**只有 key 被 `tr -d '[:space:]'` 清洗**（:119），
  value 原样保留 ⇒ `=` 两侧不要留空格，否则版本号会带空格、`git tag "v1.1.20 "` 直接失败。
- `VERSION` / `MESSAGE` 缺任一即 exit 1（:128-135）。`MESSAGE` 是文件最后一行，
  **文件必须有结尾换行**，否则 `read` 丢掉最后一行 → 报"配置格式错误"。
- `#` 开头的行被跳过（:120），可写注释。

## 一条龙原子流程：中途不许切开

脚本从版本号一路做到 push，**不存在"我只跑前半段，后面手动补"这种用法**。理由：步骤 2 已经把
三个文件的版本号改成目标版本（工作树变脏），此时中断 = 留下一棵"版本号已升、没测没提交"的脏树，
下一个人接手时既分不清哪些改动属于本批，也会在下次跑脚本时因 `git add -A` 被裹进去（坑 2）。

| 脚本步骤 | 行号 | 做什么 | 失败行为 |
|---------|------|--------|---------|
| 1/7 版本一致性 | :142-166 | 读 `package.json`(:148) / `src-tauri/Cargo.toml`(:149) / `src-tauri/tauri.conf.json`(:150)，三者必须相同 | 不一致直接 `exit 1`(:165)，要求先手动统一 |
| 2/7 版本同步 | :168-211 | 与目标版本不同则 `sed -i` 改三处：package.json(:188)、tauri.conf.json(:191)、Cargo.toml(:194，正则锚到 `[package]` 段，不动依赖版本)，改完回读校验(:197-209) | 校验不过 `exit 1`(:209) |
| **3/7 构建并替换 VPN 二进制** | :213-244 | `BUILD_HG_EXIT=0`(:221) 后调 [scripts/build-hg-binaries.sh](../../../scripts/build-hg-binaries.sh)(:222)：从 HuanvaeGuard 源码构建各平台守护进程 → 形态断言 → macOS 重签 → 替换落点 + sha256 复校 → 泄露扫 → 写 manifest；成功后把 `src-tauri/resources/hg-build-manifest.json` 原样打印出来 | 非 0 即 `exit 1`(:233)，文案明说**不使用仓里的旧二进制兜底继续发布**。**不提交、不推送**（见下方「两项新流程」）|
| 4/7 全量测试 | :246-278 | `TEST_EXIT=0`(:255) 后调 `"$SCRIPT_DIR/test-all.sh" "$@"`(:256)，**接住退出码** | 非 0 一律中止在这里、`exit 1`(:274)：退出码 **2**（有跳过未放行）走专门文案「跳过 ≠ 通过」+ 提示 `ALLOW_SKIP=...`(:260-264)；其它非 0 走 FAIL 文案(:265-267)。两者都**不提交、不推送**，并提示版本号已升、修完可重跑 |
| 5/7 依赖同步 | :280-294 | `pnpm install --frozen-lockfile`(:285)，失败退回 `pnpm install`(:288) | 两次都失败 `exit 1`(:292) |
| 6/7 提交 + 打标签 | :296-324 | `COMMIT_MSG="v$VER: $MSG"`(:301)；有改动则 **`git add -A`**(:309) + `git commit -m`(:310)；`RELEASE_SHA=$(git rev-parse HEAD)`(:315) 锁定本次发布 commit；`git tag -d`(:318) 后 `git tag "v$VER" "$RELEASE_SHA"`(:319) **显式指向**该 commit；随即 `assert_tag_points_at_head`(:322，函数体 :83-104) 断言 tag 指向当前 HEAD | 断言不过：打印两个 sha + 三步手工修正指引 → `exit 1`(:323)，**在 push 之前中止、不推送任何内容**（见坑 4） |
| 7/7 推送 | :326-339 | `git push origin main`(:336)；`git push origin "v$VER" --force`(:337) | — |

⚠️ **步骤 3 在全量测试之前**：先把发货二进制换成刚构建、刚校验过的产物，第 4 步的门禁（含
`cargo test` 里那两条**发货件静态守卫**）才是在**真正要发出去的那份字节**上跑的。顺序反了就
等于验了一份不会发出去的东西。

tag 推上去后 `.github/workflows/release.yml` 由 `push: tags: 'v*'` 触发，构建 Win/Linux/macOS/Android
产物并发 Release。**即 push tag 那一刻发布就已不可撤销地对外发生**，脱敏核必须在此之前做完。

## 版本号规则：每次 +0.0.1

按 huanwei 口径，每次发布 **patch 位 +1**（`1.1.19` → `1.1.20`），不自作主张跳 minor/major。
当前版本读 `scripts/release-config.txt` 的 `VERSION` 或 `package.json`。不确定要不要跨位时**问，别猜**。

---

## 🔴 坑 1：跑 release.sh 一律不带任何参数

release.sh:255-256 是：

```bash
TEST_EXIT=0
"$SCRIPT_DIR/test-all.sh" "$@" || TEST_EXIT=$?
```

`"$@"` = **把 release.sh 收到的参数原样透传给 test-all.sh**。而 test-all.sh:69-76 解析**四个**开关：

```bash
--skip-rust) SKIP_RUST=true ;;       # :71  砍掉 cargo check + clippy 桌面 + clippy Android + cargo test（4 项）
--skip-android) SKIP_ANDROID=true ;; # :72  砍掉 clippy Android
--skip-e2e) SKIP_E2E=true ;;         # :73  砍掉 Playwright E2E
--skip-vpn) SKIP_VPN=true ;;         # :74  砍掉 VPN 连通性测试
```

⇒ `./scripts/linux/release.sh --skip-e2e` = 要求发布一个没跑过 E2E 的版本，属**降门槛硬推**，红线。
`--skip-vpn` 同理，而且更要命：它砍掉的正是「隧道是不是真的在承载流量」这条唯一的真机复查。
注意 `--skip-rust` 现在砍的是 **4 项**（多了 `cargo test` —— 连带把两条**发货件静态守卫**一起砍了）。
🔴 `--skip-android` 的代价也变了：它砍掉的**不再是"一个本机跑不了的项"**，而是**一项本可在远程构建宿主真跑的检查**
（`clippy-android` 现在是三态，见下方「同族的软跳过」）。在本机没 NDK 的机器上，正路是设
`ANDROID_CLIPPY_HOST` 让它远程真跑，不是 `--skip-android`。

**这类降门槛现在不再是静默的**（脚本已修）。flag 触发的跳过在开跑时就登记进跳过表
（`record_skip` 函数 :58-62；flag 登记 :112-125）；末尾汇总先列 `⚠ 本次有 N 项被跳过（未真跑）` + 每项
`- id: 原因`（:787-793），然后**默认以退出码 2 结束**（:827-835）。release.sh 步骤 4 接住 2，
打印「有检查项被跳过且未真跑 —— 发布中止（跳过 ≠ 通过）」后 `exit 1`（:260-264 / :274）——
**不提交、不推送**。只有 `ALLOW_SKIP` 显式放行时才走「⚠ 放行：本次有 N 项被跳过」+
`真跑通过 X/13` 并 exit 0（:819-825）。

🔴 **只要存在跳过项，任何分支都不再打印「所有检查通过!」**——那句只在零跳过时出现（:803-809）。

**判据不变**：`release.sh` 后面跟任何东西 = 违规。`ALLOW_SKIP` 是给"环境确实装不上"的兜底闸，
不是给"懒得跑"用的 —— 用它是一个**决策**，得有人拍板，且交付里必须写清放行了哪几项、真跑 X/13
（Linux 侧全量 13；Windows `test-all.ps1` 是 X/11）。
🔴 **`clippy-android` 尤其不要顺手放行**：本机没 NDK 时它还有一条"设 `ANDROID_CLIPPY_HOST` 远程真跑"的正路，
放行前必须先排除那条（见下方三阶梯）。
要调试测试就单独跑 `./scripts/linux/test-all.sh --skip-xxx`，但那条命令的结果**不能**当作发布门禁的通过凭据。

**计数器已修**：`TOTAL_STEPS` 现在按 flag 实算（:96-103，恒定 7 块 + E2E / VPN / Rust 三块 / Android 各按需加），
`step_header` 递增（:106-109），打印的 `[n/N]` 与本次**实际执行**的块数一致（旧版"跳 3 块只减 2"的错已不存在）。
但注意 **N 是"本次跑了几块"，不是全量 13** —— 验收口径看末尾那行 `X/13 真跑通过`（:806 / :822）
和跳过清单，别拿 `[n/N]` 当交付依据。

**同族的软跳过（运行期跳过，走完全相同的路径）**：

- **Android clippy** 只在**双条件同时成立**时才 `record_skip clippy-android`（:676）：
  **本机无 NDK / `aarch64-linux-android` target 未安装，且未配置 `ANDROID_CLIPPY_HOST`**。
  （旧文档写的"NDK 未找到 / target 未安装两个站点"已不存在 —— 本次改造把它们合并成这一处双条件站点。）
- **VPN 连通性测试**在被调脚本返回退出码 **3**（本机物理上跑不了 = **未执行**）时调
  `record_skip vpn-connectivity`（:751；另有 `--skip-vpn` 参数态在 :124）。

⇒ 一样进汇总、一样默认 exit 2、一样拦住发布。所以"这台机器没装 NDK / 没有对端所以那项没跑"
不会再混进"全绿"里。

### 🔴 clippy Android 是**三阶梯**，「本机没 NDK」不是发版时跳过它的理由

块头注释把优先级写死在代码里（:453 `# 三态优先级（本机 → 远程构建宿主 → 才允许跳过）：`）：

| 阶梯 | 条件 | 做法 | 结果 |
|---|---|---|---|
| ① | 本机有 NDK 且装了 `aarch64-linux-android` target | 直接跑 `./scripts/linux/release.sh` | 本机真跑，**13/13** |
| ② **（推荐）** | 本机没有，但有远程 Android 构建宿主 | `ANDROID_CLIPPY_HOST=user@host ./scripts/linux/release.sh` | 远程**真跑**，rc 与完整输出取回本机，**照样 13/13** |
| ③ | **两者都没有** | `ALLOW_SKIP=clippy-android ./scripts/linux/release.sh` | 放行，**必须如实报告**「Android clippy 未真跑，真跑 12/13，原因：本机无 NDK/target **且**未配置远程构建宿主」 |

- ⚠️ **③ 只是最后一条路，不是唯一一条。** v1.1.30 那次以「本机无 Android NDK」为由 `ALLOW_SKIP` 放行，
  其源头就是本 skill 旧版把 ③ 写成了「只能」—— 而本仓一直有可用的远程 Android 构建宿主
  （实测该宿主 NDK / 四个 android target / clippy 全部现成，一个字节都不用装，远程真跑 `rc=0`、0 warnings）。
  **发版前先问一句「远程构建宿主能不能跑」，再决定要不要放行。**
- 🔴 **设了 `ANDROID_CLIPPY_HOST` 却连不上 = FAIL，绝不自动退回跳过**：连不上 / 同步失败 / 远程无工具链 /
  远程 clippy 非 0 / 中途断连拿不到结束哨兵，五种失败**全部 FAIL**。自动退回等于把"没跑"重新伪装成"环境不具备"。
- 📌 **待裁决（本单未做，需要人拍板的策略）**：③ 现在仍是一条**走得通**的路 —— 任何人只要
  「不设 `ANDROID_CLIPPY_HOST`」就能合法退回 skip + `ALLOW_SKIP` 放行，形式上就是 v1.1.30 那条路子。
  本次改造只把它从「唯一的路」降级成「最后一条路」，并强制放行文案承认双条件。
  要彻底堵死得定一条策略：**发布机必须配 `ANDROID_CLIPPY_HOST`，否则 `clippy-android` 不可放行**。
  那是策略决定（会让"没有远程宿主就发不了版"），不由 agent 自行收紧。
- 相关环境变量（真值源是脚本头注释 :27 起）：`ANDROID_CLIPPY_HOST`（**无默认值**，形如 `user@host`）/
  `ANDROID_CLIPPY_REMOTE_DIR` / `ANDROID_CLIPPY_REMOTE_NDK_HOME` / `ANDROID_CLIPPY_SSH_OPTS` / `ANDROID_CLIPPY_JOBS`。
  与 `HG_WIN_BUILD_HOST` 同一套红线：**公开仓内不写任何内网地址 / 内部主机名 / 账号，示例一律 `user@host`**，
  值只在运行时经环境变量注入，**不落盘、不入日志**。

## 🔴 坑 2：`git add -A` 会把整棵工作树裹进这次发布

release.sh:309-310 是全量 add：

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

release.sh:318-319 先 `git tag -d` 再重建本地 tag，:337 是：

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

**脚本现在做两件事**（release.sh 步骤 6）：

1. **显式指定 tag 目标**：先 `RELEASE_SHA=$(git rev-parse HEAD)`(:315) 锁定本次发布 commit，
   再 `git tag "v$TARGET_VERSION" "$RELEASE_SHA"`(:319) —— 不再依赖 `git tag` 隐式解析 HEAD。
2. **打完即断言**：`assert_tag_points_at_head`(:83-104，调用点 :322) 比对
   `git rev-parse "<tag>^{commit}"` 与 `git rev-parse HEAD`，不一致就打印两个 sha + 三步手工修正指引，
   `exit 1`(:323)。这一步在**步骤 7 推送之前**，所以断言失败时**没有任何东西被推出去**
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

📌 **那两个 HG 二进制现在是每次发布重新构建的产物**（步骤 3，见下一节），
`build-hg-binaries.sh` 内部对产物做过一次泄露扫。**这不豁免本节的人工脱敏核** ——
脚本只扫它自己刚产出的那两个文件，`git ls-files` 枚举出的其它 tracked 二进制没人管。照扫不误。

---

## 🔴 两项新流程：发货二进制不再是仓内死文件 + VPN 连通性必须真跑

这两项是 2026-08-06 加进发布链的，动机不是"更严谨一点"，而是**两起已经发生的生产故障**。

### 故障事实（写在这里，是为了防止后来的人把这两步当成可省的仪式）

App 发货两个 VPN 守护进程二进制（macOS `hg-macos`、Windows `huanvaeguard-svc.exe`）。
它们长期是**手工放进去、来源不明、无人验证**的仓内死文件 —— 跟着发布一路顺延，
**没有任何 CI 步骤重编或刷新它们**，于是悄悄落后于当前契约，直到真机才炸：

- **(A) macOS**：装 v1.1.20 后点「安装/修复」**恒报** `Bootstrap failed: 5`。仓里那份是
  **linker-signed** 形态，而能被 launchd 加载的那份是 `codesign -f -s -` **显式重签**过的。
- **(B) Windows**：用户连 VPN **无握手、上下行包均为 0**。仓里那份**根本不是**真机上验证过
  「能被 SCM 拉起 + 能建隧道」的那个二进制。

两起故障的共同点：**链路上每一步都"成功"，没有任何地方会报错**。所以补的不是文档，是机器复查。

### 新流程 ①：发布前从源码构建各平台 VPN 二进制并替换（release.sh 步骤 3/7，:213-244）

调 [scripts/build-hg-binaries.sh](../../../scripts/build-hg-binaries.sh)（Windows 宿主用 `.ps1`；
两者差异只在"谁本机构建、谁 ssh 远程构建"）。红线逐条：

1. **来源可追溯** —— 构建源必须是 HuanvaeGuard 仓**当前代码**；manifest
   `src-tauri/resources/hg-build-manifest.json` 记来源 commit、是否 dirty、各产物 target + sha256 + 实测架构。
   `release.sh` 成功后把 manifest 原样打印出来（:236-243），交付里贴它。
2. **macOS 必须 `codesign -f -s -` 重签**，随后校验 flags **含 `adhoc` 且不含 `linker-signed`** —— 故障 A 的直接根因。
3. **替换后重算落点 sha256 与源产物比对** —— 防「以为替换了其实没替换」。
4. **产物形态断言**（构建"成功" ≠ 产物能在目标机上跑，这是唯一的机器复查）：
   - **macOS 恰好 `arm64`**（`lipo -archs` 判**相等**，universal 也中止）。依据是
     `.github/workflows/release.yml` 的 macOS build matrix **只有一条** `macos-14` /
     `aarch64-apple-darwin`，DMG 名 `..._aarch64.dmg`，updater 只有 `darwin-aarch64` 一个 key
     ⇒ **本产品线 macOS 仅支持 Apple Silicon**。这条断言是**防漂移**的：哪天改 universal 或加回
     Intel target 而守护进程没跟上，就会复发「装上去 daemon 起不来」。
   - **Windows 是 `x86_64-pc-windows-gnu`（mingw），不是 msvc**。理由：mingw 那一份正是真机验证过
     「能被 SCM 拉起 + 能建隧道」的那份；换 msvc = 重新发一份没人验过的二进制，正是本流程要根治的病。
5. **泄露扫** —— 对产物 `strings` 扫构建机路径（`/Users/`、`/home/`、`C:\Users`）与 RFC1918 私网地址，命中即失败。
6. 🔴 **构建失败 = 发布中止，绝不用仓里的旧二进制兜底。**（脚本 `exit 1`(:233)，文案直说这一点。）
7. 🔴 **主机地址一律经环境变量注入**：`HG_REPO` / `HG_WIN_BUILD_HOST`（**无默认值**）/
   `HG_WIN_BUILD_DIR` / `HG_SKIP_WINDOWS`（Windows 宿主侧对应 `HG_MAC_BUILD_HOST` 等）。
   **公开仓内不写任何内网地址 / 内部主机名 / 账号**，示例一律 `user@host`。
   `HG_SKIP_WINDOWS=1` 只用于临时排障，**发布前不许这么跑**（manifest 会缺 Windows 产物）。

### 新流程 ②：VPN 连通性测试（test-all.sh 第 13 项，:723-756）

调 [scripts/hg-connectivity-test.sh](../../../scripts/hg-connectivity-test.sh)（`.ps1` 是 Windows 侧镜像）。

🔴 **判据是「真握手 + 真收发包 + 端到端 ping」，不是「服务起来了」。** 故障 B 的真实形态就是
**服务状态看着完全正常、上下行包却均为 0** —— 只看状态永远发现不了。五项必测：

1. **守护进程被系统真拉起** —— macOS `launchctl print` 必须 `state = running`；Windows `sc query`
   必须 `STATE : 4  RUNNING`。🔴 **手工前台跑得起来不算数**（那是另一个执行上下文；踩过的坑正是
   "手启成功、被服务管理器拉不起来"）。
2. **隧道接口 + VIP**（status JSON 的 `active` / `interface_name` / `address` + 网卡原始输出）。
3. **真实握手** —— `peers[0].last_handshake` 必须非 0（0 = 从未握手）。
4. **收发两向字节增量都 > 0** —— ping 前后各采样一次，**收、发分开量**，任一方向为 0 即 FAIL。
5. **端到端 ping** —— 丢包率 + 每包 ttl + 路由归属。

**ttl 判据（别硬编码 63）**：ttl 初值由**应答方 OS** 决定（macOS/Linux = 64，Windows = 128），
判「是否经真转发」用「**初始 TTL − 实测 ttl == 1**」，初值由 `HG_PEER_INITIAL_TTL` 给出。
另：macOS `route -n get <对端VIP>` 的 flags **含 `LOCAL` 即 FAIL**（含 LOCAL = 内核本地交付，
包永不进隧道）。

🔴 **对端必须是另一台机器。** 同机两个实例的 VIP 都带 `LOCAL` flag，包永不进隧道 —— 测出来是
**假通过**。对端 VIP 只能经 `HG_PEER_VIP` 注入，**无默认值**；本文与脚本里一律写 `<对端VIP>` 占位符。

**退出码三态，调用方必须分清**：

| 退出码 | 含义 | test-all.sh 的处理 |
|--------|------|-------------------|
| `0` | 五项全过 | PASS |
| `1` | 有项 FAIL（**真跑了**，没通过） | `ALL_PASSED=false` → exit 1 → 发布中止 |
| `3` | 本机物理上跑不了，**未执行** | `record_skip vpn-connectivity`(:751) → 走既有「SKIP ≠ PASS」路径 → 默认 exit 2 → **发布中止**，除非 `ALLOW_SKIP=vpn-connectivity` 显式放行并**如实报告** |

⚠️ `3` **既不是通过也不是失败**。把它当 0 处理 = 把"没测"报成"测过了"，正是这两项要根治的病。

### 新流程 ③（配套补的洞）：`cargo test` 接进门禁（test-all.sh 第 12 项，:681-720）

既有门禁只跑 `cargo check` + `clippy`，**从不运行测试** —— 于是
`src-tauri/src/desktop/huanvaeguard_macos.rs` 里那两条**发货件静态守卫**等于**没接线**：

- `bundled_daemon_binary_understands_every_flag_in_bundled_plist` —— 打包 plist 里每个 `--` 开关
  都必须真出现在打包二进制的字节里（否则守护进程启动即退、`KeepAlive` 下崩溃循环，而安装链
  每一步都"成功"）。
- `bundled_daemon_binary_leaks_no_build_host_paths` —— 发货二进制里不得含 `/Users/`、`/home/`、
  `C:\Users` 等构建机绝对路径（把脱敏核的人工动作常态化成 `cargo test` 的一部分）。

第 12 项跑 `cargo test --lib` 把它们接上。**注意 `--skip-rust` 会连它一起砍掉。**

⚠️ 这两条守卫是 **macOS 侧**的。**Windows 侧目前没有等价的自动守卫** —— 那边的失效形态是
"在 SCM 下起不来"，只有真 Windows 主机能验，靠的是新流程 ② 的第 1 项。别把两者当成同一条。

---

## 测试没全绿就停 —— 如实报，不许改测试

release.sh:256 调的 test-all.sh 覆盖 **13 项**（test-all.sh:765 `CANONICAL_TOTAL=13`，与脚本里 13 个检查块一一对应）：

> 下表「块头行」= 脚本里那行 `# N. xxx` 注释。行号会随脚本改动整体位移，**用 `grep -n '^# [0-9]\+\.' scripts/linux/test-all.sh` 现查**，别只信这里的数字。

| # | 检查 | 块头行 |
|---|------|------|
| 1 | Windows NSIS 安装配置 | :128 |
| 2 | package.json 验证（重复键 + JSON 格式） | :166 |
| 3 | Tauri 版本一致性（Rust crate ↔ NPM 包，major/minor 必须对齐） | :209 |
| 4 | TypeScript `pnpm tsc --noEmit` | :285 |
| 5 | ESLint（0 errors, **0 warnings**） | :297 |
| 6 | 单元测试 `pnpm test --run` | :322 |
| 7 | Playwright E2E | :344 |
| 8 | 前端 `pnpm build`（查 Vite 警告） | :368 |
| 9 | `cargo check` | :403 |
| 10 | `cargo clippy` 桌面（`-D warnings`） | :428 |
| 11 | `cargo clippy` Android（**三态：本机 → 远程构建宿主 → 才允许跳过**，见坑 1 下的三阶梯） | :451 |
| 12 | **`cargo test --lib`**（Rust 单元测试 + 两条**发货件静态守卫**） | :681 |
| 13 | **VPN 连通性测试**（真握手 + 真收发包 + 端到端 ping；退出码三态，`3` = 未执行 → 跳过） | :723 |

任一 FAIL → `ALL_PASSED=false` → `exit 1`(:795-801) → release.sh 中止在步骤 4(:274)，**不会提交、不会推送**
（版本号已改、VPN 二进制已替换，工作树留脏——修完重跑即可，步骤 2 会识别"已是目标版本"并跳过）。

**test-all.sh 退出码三态**（脚本头 :38-41 有注释；release.sh:258-274 逐个接住）：

| 退出码 | 含义 | release.sh 行为 |
|--------|------|----------------|
| 0 | 全部真跑通过（`13/13`），**或**跳过项已被 `ALLOW_SKIP` 显式放行（`真跑通过 X/13`） | 继续步骤 5 |
| 1 | 有检查项 FAIL | 「测试检查未通过」(:266) → `exit 1`(:274)，不提交不推送 |
| 2 | 有检查项被跳过且未放行（SKIP ≠ PASS） | 「跳过 ≠ 通过」+ 提示 `ALLOW_SKIP=clippy-android ./scripts/linux/release.sh`(:261-264) → `exit 1`(:274)，不提交不推送 |

⚠️ 退出码 0 **不等于** 13/13：拿 `ALLOW_SKIP` 放行过就是 `X/13`。向上汇报时**必须报那个 X 和被放行的 id**，
不许把"exit 0"翻译成"全部通过"。（v1.1.20 就是据一次含 `⚠ SKIP` 的 exit 0 错报了"全部通过"。）
第 13 项尤其容易踩这条：**没有对端就退 3 = 未执行**，一放行就成了 `12/13`，交付里必须写明。

**红线**：测试没全绿 = 发布停止 + 如实报告哪几项 FAIL。
**禁止**：改测试断言、加 `--skip-*`、注释掉用例、降 lint 阈值来"让它绿"。
这三种做法都能让脚本走完，但发出去的是一个没被验证过的版本——比不发布严重得多。

修 FAIL 的常见坑：[.claude/rules/frontend-test.md](../../rules/frontend-test.md)（vi.hoisted、
animation-conflict 注册、AnimatePresence 消失断言竞态）、
[.claude/rules/rust-dev.md](../../rules/rust-dev.md)（HG 服务文件锁导致 cargo 失败）。

## 平台差异（别把两边的结论互相套用）

| | Linux `scripts/linux/release.sh` | Windows `scripts/release.ps1` |
|---|---|---|
| 调测试 | `"$SCRIPT_DIR/test-all.sh" "$@"`(:256) — **透传参数**（坑 1） | `& powershell ... test-all.ps1`(:266) — **不传参数**，无透传面 |
| 构建 VPN 二进制（步骤 3/7） | `build-hg-binaries.sh`(:222) — 本机构建 macOS，ssh 到 Windows 构建机产出 Windows | `build-hg-binaries.ps1`(:233) — 本机构建 Windows，ssh 到 macOS 构建机产出 macOS |
| 构建失败即中止 | `exit 1`(:233) | `exit 1`(:244) |
| 测试项数（canonical） | **13**（test-all.sh:765，含 Tauri 版本一致性 + E2E） | **11**（test-all.ps1:654，无这两项） |
| 跳过登记 / `ALLOW_SKIP` 可用 id | `e2e` / `cargo-check` / `clippy-desktop` / `clippy-android` / `cargo-test` / `vpn-connectivity`（test-all.sh:22-23） | `cargo-check` / `clippy-desktop` / `clippy-android` / `cargo-test` / `vpn-connectivity` —— **无 `e2e`**（test-all.ps1:22） |
| 跳过 flag | `--skip-rust` / `--skip-android` / `--skip-e2e` / `--skip-vpn`(:71-74) | `-SkipRust` / `-SkipAndroid` / `-SkipVpn`(:45-47) —— 无 `-SkipE2e` |
| clippy Android 远程真跑 | `ANDROID_CLIPPY_HOST=user@host`（第 11 项，块头 :451） | `$env:ANDROID_CLIPPY_HOST='user@host'`（第 9 项，块头 test-all.ps1:339）—— **Windows 侧未实测**，见 :351 的自述 |
| VPN 连通性取数手段 | `launchctl print` / `ifconfig` / `netstat -ibn` / `route -n get`（**只覆盖 macOS**，Linux 上恒退 3） | `sc.exe query` / `Get-NetAdapterStatistics` / `ping.exe -n` |
| 跳过未放行 → 退出码 2 | test-all.sh:835；release.sh:260-264 接住 | test-all.ps1:715；release.ps1:270-275 接住 |
| 标签指向断言 | `assert_tag_points_at_head`(:83-104，调用 :322) | `Assert-TagPointsAtHead`(release.ps1:67，调用 :343) |
| 版本号改写 | `sed -i`(:188/:191/:194) | UTF-8 无 BOM `WriteAllText`(:181/:186/:193) + 正则 |
| 提交 / 标签 / 推送 | :309-310 / :315-319 / :336-337 | :329-331 / :338-340 / :355-356（行为相同，含 `--force` 推 tag） |

⚠️ **Windows 侧的对称实现尚未运行验证**：`scripts/test-all.ps1` / `scripts/release.ps1` /
`scripts/build-hg-binaries.ps1` / `scripts/hg-connectivity-test.ps1` 都已按与 Linux/macOS 相同口径写好
（跳过登记 + `$env:ALLOW_SKIP` + 退出码 2 + `Assert-TagPointsAtHead` + 步骤 3 构建替换 + 第 11 项
VPN 连通性），但这些改动**在 macOS 上完成、本机无 PowerShell，四个 ps1 一行都没实际跑过**。
Windows 侧首次使用时按"未验证代码"对待：先单独跑 `.\scripts\test-all.ps1` 核对汇总文案与退出码是否
符合预期，再拿它发版。

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

[scripts/linux/README.md](../../../scripts/linux/README.md) 与
[scripts/README.md](../../../scripts/README.md) 均已与当前脚本同步。

2026-08-12 那批（clippy-android 三态 + 行号重锚）订正的：

- 本 skill：坑 1 补 `--skip-android` 的新代价、`ALLOW_SKIP` 段补"clippy-android 别顺手放行"、
  「同族的软跳过」改成**双条件**并新增**三阶梯**表（① 本机 / ② `ANDROID_CLIPPY_HOST` 远程真跑 / ③ 才允许放行）；
  **删掉了把 ③ 说成唯一出路的那句措辞**（旧文写的是「要在这种机器上发版，*只能*显式 `ALLOW_SKIP=clippy-android`」）
  —— 它正是 v1.1.30 那次放行的源头。
- `scripts/linux/README.md`：示例里已从脚本删除的旧 skip 文案换成现行双条件文案；「两条正路」改**三条**
  （远程真跑排第 1）；新增「Android clippy 的远程执行」小节（5 个 `ANDROID_CLIPPY_*` env + 五种失败一律 FAIL）。
- `scripts/README.md`：修 VPN 调用方的两个失效行锚点；新增 `test-all.*` 的 `ANDROID_CLIPPY_*` 环境变量表。
- **全批重锚**：`2f3e4dd` 让 `test-all.sh` / `test-all.ps1` 行号整体位移，四份文档里指向这两个脚本的
  `文件:行` 锚点**全部失效**，已逐条现查重锚（判据：`grep -rn "test-all\.\(sh\|ps1\):[0-9]" .claude scripts`
  + 各处裸 `:NNN`）。

2026-08-06 那批（两项新流程）订正的：

- `scripts/linux/README.md`：检查项表由 11 项改为 **13 项**（补第 12 项 `cargo test`、第 13 项
  VPN 连通性测试）；可选参数补 `--skip-vpn`；`ALLOW_SKIP` 可用 id 补 `cargo-test` /
  `vpn-connectivity`；`X/11` 口径全部改 `X/13`；发布流程图与「自动执行的操作」表补上
  **步骤 3「构建并替换 VPN 二进制（失败即中止）」**，并把脚本步骤数订正为 7。
- `scripts/README.md`：目录树与 Windows 脚本表补上 `build-hg-binaries.*` / `hg-connectivity-test.*`
  四个新脚本（用途 / 环境变量 / 退出码 / 被谁调用）；「脚本自动执行的操作」由 6 条改为 7 步一条龙。

2026-08-05 那批（SKIP ≠ PASS）订正的：检查项表 9 → 11、`--skip-e2e`、「跳过 ≠ 通过」段、
标签指向校验。

⇒ 它们现在可以当入门说明读，但**仍是二手描述**，脚本再改时可能又落后。
引用发布流程的**具体行号 / 项数 / 退出码**时，直接读脚本。

## 🔴 步骤 7/7 的 push 在本环境**必然失败** —— 每次发版都会卡在最后一步（2026-08-13 v1.1.33 实证）

**现象**（`release.sh` 已把 1–6 步全做完并自校验通过，只在最末失败）：

```
[7/7] 推送到 GitHub...
remote: Invalid username or token. Password authentication is not supported for Git operations.
fatal: Authentication failed for 'https://github.com/<owner>/<repo>.git/'
```

**根因**：脚本的 `git push` 走**继承的系统 credential helper**（本机全局是 Git Credential Manager），
**不读你注入的 `GH_TOKEN`**。GCM 在无 tty 环境要么走交互式 OAuth（挂死）、要么按用户名/密码认证被 GitHub 拒。
⇒ **这不是偶发、不是网络问题，是每次发版都会重演的结构性缺陷。**

**已验证的修法**（`common.md`「无 tty 环境的 git push 挂死」同款，v1.1.33 实测 `rc=0`、3.8s）：

```bash
GIT_TERMINAL_PROMPT=0 git \
  -c credential.helper= \
  -c credential.helper='!f(){ echo username=<owner>; echo "password=$GH_TOKEN"; };f' \
  push origin main
```

🔴 **第一个 `-c credential.helper=`（空值）不可省** —— git 的 helper 是**列表**语义、只追加不覆盖；
不先清空就仍会回落到 GCM，照样失败。tag 同理（`push origin <tag>`）。

🔴 **那个 token 从哪儿取（2026-08-13 补，此前这一段只写用法不写出处，人人卡在同一处）**：

- **金库**：`~/.claude/secrets/credentials.env`（权限 `0600`，**不在任何 git 仓内**，`KEY=value` 一行一条）。
- **键名现枚举，不照抄任何文档里的例子**（键名会漂）：

  ```bash
  /usr/bin/grep -oE '^[[:space:]]*(export[[:space:]]+)?[A-Za-z0-9_]+=' ~/.claude/secrets/credentials.env
  ```

  字符类**必须含数字**（`common.md`「grep 字符类漏数字」那条坑就是在金库里找 token 时栽的）。
  GitHub PAT 只有一把就直接用，**有多把就停下上报**。
- **先验最小权限再用**：做一次只读调用确认 scope 够；发布要推 tag 与 `main`，
  改到 `.github/workflows/*` 时还需要 `workflow` scope。
  🔴 **scope 不够就停下上报 —— 不许换别的 token、不许降级绕过、不许扩权。**
- 🔴 只在**运行时**取值，**不落盘 / 不打印 / 不进提交物 / 不进交付**（交付写 `<REDACTED>`）；
  自证遮蔽的命令里也不许出现明文。**本仓是 PUBLIC 公开仓**，这条与本 skill 的脱敏核同级。
- `gh` 同理：`export GH_TOKEN=<运行时取到的值>` 即可，**不要跑 `gh auth login`**（交互式，无 tty 会挂死）。

**这算不算「把一条龙切开」——不算，口径已由总管写死（2026-08-13）**：
> 红线禁的是「**主动把流程拆成几段分别跑**」，不是「**流程跑到最后一步失败后补完同一个动作**」。

脚本已把版本号、二进制构建、13 项门禁、commit、tag 全部做完并自校验通过，
补 push 是**同一动作的收尾**，且用的是本仓自己记过的写法，不是自创绕法。

**建议（尚未落地，下一版该做）**：把这段内联 helper 直接写进 `release.sh` 的 7/7 步，
或至少在脚本失败时打印这条修法 —— **别让它只活在文档里等人想起来**。
每次发版都要人肉补最后一步，本身就是流程缺陷。

## 🔴 gen-33 追加（2026-08-21）：第 13 项 `vpn-connectivity` 第一次真跑之后暴露的五条子判据事实

> **本节是 EOF 追加，不改上文任何一行** —— 上文「新流程 ②：VPN 连通性测试」那节记的五项判据
> **仍然成立**；本节补的是它**没写、而第一次真跑就撞上**的隐含前提与覆盖面缺口。
> 一手来源：gen-33 在本机 macOS 与一台**远程 Windows 对端**之间手工建起真隧道，
> 把这一项从长期 SKIP 打成 **13/13 真跑通过、退出码 0、无一项跳过**（同一条命令跑了两遍，
> 第二遍显式捕获到 `TESTALL_EXIT=0`），并有三条单变量负对照证明该判据会红。

### 一、🔴 第 5 项的 ttl 子判据隐含「路径上【恰好一跳】IP 转发」—— 两端直连时它结构上必红

**判据本体**：`hg-connectivity-test.sh:473` `if [[ $((PEER_INITIAL_TTL - t)) -ne 1 ]]; then`
—— **差值不等于 1 就红**。⇒ 它对 **0 跳**红、对 **2 跳及以上也红**，
所以准确措辞是「**恰好一跳**」，**不是**「至少一跳」。
这不是咬文嚼字：任何按「至少一跳」去设计的放宽修法，**仍然挡不住 ≥2 跳的真实拓扑**。

**实测（单变量对照：同一份脚本、同一条隧道，只换对端 VIP 与 TTL 初值）**：

| 拓扑 | 结果 |
|---|---|
| 两端 HG 客户端**直连**（对端 = 直连 peer，初值 128） | **4/5** —— 第 1/2/3/4 项全 PASS（真握手、两向真收发、**0.0% 丢包**），唯独第 5 项 `✗ FAIL: 有包不满足「初始 TTL(128) − ttl == 1」：异常 ttl = 128 ×10` |
| 对端后面**补一跳 IP 转发**（对端 = 隔一跳的地址，初值 64） | **5/5**，ttl 实测 63 |

**成因**：hg-core 是**隧道不是路由器** —— 解封装后把 IP 包原样写进 tun，**不减 IP TTL**
（`RelayEnvelope` 自己那个 `ttl` 是中继信封字段，与 IP 头 TTL 无关；`core` 里没有任何一处读写 IP 头 TTL）。
生产 hub-and-spoke 里那一跳减 1，来自**中继 agent 解封装之后由内核做的 IP 转发**；
两台客户端直连时**根本没有这一跳** ⇒ `初值 − ttl == 0` ⇒ 恒红。

🔴 **危害的形状（这才是它值钱的地方）**：这一项**唯一**能失败的方式**看起来像「网络坏了」**，
失败文案还把人指向「包没经过预期的那一跳转发」去查网络 —— 而真因是
「**你的拓扑不是它假设的那个**」。
⇒ **拿不到 5/5 时第一件事是问「我这条路径上有几跳 IP 转发」，不是去查网络。**
⇒ 派单时**不许**把「两端直连」写成「可接受的达标路径」—— gen-33 的卡就是这么写的，害执行方白跑一轮。

### 二、🔴 `HG_PEER_VIP` 的真实语义：不是「你的直连 peer 的 VIP」

上文只写了「对端必须是另一台机器」「无默认值」，**没写它与你之间要隔几跳**。
准确语义是：**与你隔【恰好一跳 IP 转发】的那个 VPN 内地址**。
生产 hub-and-spoke 里这天然等于「另一台 VPN 成员」（中间那一跳是中继）；
**手工搭的两点隧道里必须自己在对端后面补出那一跳**，否则第 5 项必红。

### 三、🔴 第 1 项的「发货件同一性」子判据在**本机结构上不可用** ⇒ 第 1 项实际只验了「进程在跑」

- `hg-connectivity-test.sh:79` 把 `DAEMON_BIN` **写死**成 v1.1.37 的**新落点** `/Library/PrivilegedHelperTools/hg-macos`；
- 而本机 launchd 拉起的是**旧落点** `/usr/local/bin/hg-macos`（2026-08-06 构建），
  **新落点那个文件在本机不存在**（现查 `ls -d` rc=1；同刻正对照 `ls -d /Library/LaunchDaemons` rc=0 ⇒ 判据会响）。
- ⇒ **设了 `HG_EXPECT_DAEMON_SHA` 必红**（走 `设置了 HG_EXPECT_DAEMON_SHA，但 $DAEMON_BIN 不存在` 那条 fail 分支）；
  **不设则这条子判据完全不把关** ⇒ **第 1 项实际只验了「进程在跑」**。
- 🔴 **推论**：在把本机守护进程迁到新落点之前，第 13 项验的**永远是旧件**，
  跟「这次要发出去的那份二进制」没有关系。**想真验一个版本的发货件，第一步是先把本机升到那一版。**
  gen-33 那次 13/13 证到的是「**这一项在有真对端时确实会真跑、也真能 PASS**」+
  「**本机已装的那份守护进程数据面是活的**」，**没有**证到 v1.1.37 发出去的那两个二进制。

### 四、第 5 项对丢包率的判据是「`>= 100%` 才 FAIL」⇒ 90% 丢包照样判「端到端 ping 达标」

`hg-connectivity-test.sh:462` `elif [[ "${LOSS%%.*}" -ge 100 ]]; then` —— 只有**完全不通**才红。
这**不是**实现与文档不符（文档写的就是「丢包率不得 100%」），是**判据本身宽**：
一个发布门禁容忍 99% 丢包，值得在引用「端到端 ping 达标」这句话时心里有数。
**阈值该不该收紧另立单**，本节只把它的真实形状写下来。

### 五、🔴 「13/13 无一项跳过」是【项】级口径，**不等于每一层都有覆盖**

脚本的跳过表是**项级**的，`13/13 真跑通过` 那一行也只写在 `SKIP_COUNT -eq 0` 分支里
⇒ 「**项级零跳过**」这个结论**完全成立**。但同一次运行里：

- 第 7 项（Playwright E2E）的读数是 **`30 passed, 8 skipped`**；
- 那 8 条正是**视觉截图断言**（`toHaveScreenshot`，仓内恰好 8 条，对应 8 张入仓 linux 基线）——
  按 `e2e/helpers/visual-authority.ts` 的权威平台判定，**darwin 不是权威平台 ⇒ 截图断言整类 skip**；
- 判据（不靠转述）：盘上 8 张 darwin 基线的 mtime 全是 **Jul 17 / Aug 12** 的旧件，
  而门禁跑在 **Aug 21** —— 真跑过比对会改写它们，**没被改写 ⇒ 这一次真的没跑视觉比对**。

⇒ **写死一句：那一次 13/13 里，视觉回归这一层等于零覆盖。**
「项级全绿」与「层级全覆盖」是两件事，**混起来就是把跳过洗白**。
汇报 13/13 时，凡内部含 `N passed, M skipped` 的项，**必须把 M 是什么一并写出来**。
视觉那一层自身的形状与空白区间声明见 [.claude/rules/frontend-test.md](../../rules/frontend-test.md) 末尾两节。

### 六、登记：第 8 项那条**恒假死分支**至今未修，且钉它的行号锚点已漂

- 机制**早已在册**，不在这里重复：见 [.claude/rules/common.md](../../rules/common.md)
  「同族的第三态：`⚠ WARN` 与"恒假的 if"」一节。
- **本代新增的只有两件事**：
  1. **2026-08-21 复证仍未修**。我自己实跑三态：喂一份**确实含** `[plugin vite:reporter]` 的输入
     进那条管道 ⇒ 整体 **rc=1**（分支进不去）；**正对照**单跑 `grep -q` ⇒ **rc=0**（确实命中）；
     **负对照**不含该串 ⇒ rc=1。⇒ 两次门禁的第 8 项都是直接落到 `else` 打 `✓ PASS: 前端构建 (0 warnings)`，
     **「查 Vite 警告」这半句从未执行过**。
  2. 🔴 **`code-review/SKILL.md` 与 `blind-review/SKILL.md` 里钉的实证位置 `test-all.sh:378` 已经漂了** ——
     现行位置是 **`scripts/linux/test-all.sh:402`**，原文
     `if echo "$BUILD_OUTPUT" | grep -q "\[plugin vite:reporter\]" | grep -v "dynamic import will not move module"; then`；
     而 `:378` 现在指向的是一行毫不相干的 `E2E_SKIPPED=...`。
     这正是 [.claude/rules/common.md](../../rules/common.md)「改动一个被文档按行号引用的脚本/源文件后，
     必须回头重锚所有 `文件:行`」那条纪律的又一次发作。
     **本单按「纯追加、零行号位移」纪律没有就地改那两处锚点** —— 重锚与修分支都另立单。
