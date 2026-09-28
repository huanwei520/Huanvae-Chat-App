---
name: fault-report-e2e
description: 故障记录检测加密上报（fault_report）全链工作流——ECIES 信封 v1 构造、密钥仪式与公钥换装 SOP、跨实现互操作测试配方、沙盒环境边界速查。适用于 fault_report 模块开发/联调/密钥轮换/排障，或任何「X25519+ChaCha20-Poly1305 信封加密上报」场景（服务器仓 /work/Huanvae-Chat-Rust）。
argument-hint: <envelope|keys|test|env>（省略=全文）
allowed-tools: Read, Grep, Glob, Bash
effort: high
---

# fault_report 加密上报全链速查

真值源（/work/Huanvae-Chat-Rust，均本盘实测存在）：
- 信封协议唯一规范：`docs/diagnosis/fault-report/protocol.md`
- 密钥仪式脚本：`docs/diagnosis/fault-report/generate-keypair.py`（三模式：现场仪式 / `--from-pem` 转金库行 / `--check-public` 配对自检）
- 参考加解密：`docs/diagnosis/fault-report/reference_encrypt.py`（seal/open，Python cryptography）
- 服务端实现：`examples/fault_report/{crypto,envelope,storage,handlers,kdf,rfc8439}.rs`（`#[path]` 挂载进 src/lib.rs，见其 :34-37 注释）

## §1 信封 v1 一次读懂数字信封

字段 = `version` / `machine_code_hash`(64hex) / `timestamp` / `nonce`(b64,12B) / `ephemeral_public_key`(b64,32B) / `ciphertext`(b64,含 16B Poly1305 tag)。
App 端加密必须与服务器同构，任一差异=解密失败。构造：
- ECDH(一次性临时私钥, 服务器静态公钥) → HKDF-SHA256；info=`huanvae/fault-report/v1/ecies/chacha20poly1305`
- salt = SHA-256(`"huanvae-fault-report/v1"` ‖ 0x00 ‖ version_u32_be ‖ 0x00 ‖ machine_code_hash_ascii ‖ 0x00 ‖ timestamp_u64_be)
- **salt 同时作为 AEAD AAD**：篡改信封任一明文字段（version/hash/timestamp）解密直接失败，无需解密后二次比对——对应单测 `tampered_envelope_fields_fail`。
- 工单号 = `FR-YYYYMMDD-<12hex>`（envelope.rs new_ticket_id）。

## §2 密钥事务 SOP（生产必走路径 A）

坑源实录：块 dg80pf1a-1 的仪式私钥放在沙盒 /tmp/fr-ceremony/，交付后即失（ls ENOENT 实测）→ 仓库内 `docs/diagnosis/fault-report/fault-report-public-key.pem` 成**孤儿公钥**（全网无配对私钥）。因此：

1. **生产部署/轮换一律部署机现场仪式**（配对由构造保证）：
   `python3 docs/diagnosis/fault-report/generate-keypair.py --public-out docs/fault-report-public-key.pem --private-line >> /vault.env`
   紧跟配对自检（必回 OK）：`python3 .../generate-keypair.py --check-public docs/fault-report-public-key.pem < /vault.env`
2. **换装铁律**：仪式后用新公钥替换仓库交付物并同步 App 内置。App 内置孤儿公钥=线上故障包全部无法解密，且要到用户上报后才暴露。
3. `--from-pem` 仅当私钥 PEM 确在手上时用；私钥值只经 stdout 重定向进金库，禁打印禁入仓（新增文件 `git grep 'BEGIN PRIVATE KEY'` 应仅 PEM 识别常量命中）。

## §3 测试与联调配方

1. 服务端套件：`export PATH=/root/.cargo/bin:$PATH && SQLX_OFFLINE=true cargo test --lib -- fault_report` → 37 passed, exit 0（2026-09-15 r2 亲跑复现）。
2. **SKIP-as-OK 坑**：t08（Python seal→Rust 解）设了 `FAULT_REPORT_CROSS_ENVELOPE` 才真跑，未设时优雅返回 `ok`——「37 全 ok」≠互操作真跑过；t07（Rust seal）默认用测试自造键。**互操作要真验必须带包跑**（下条）。
3. 跨实现真互操作（全新密钥对即可，不依赖仪式键）：
   - Python `cryptography` 生成 X25519 对：`priv.b64`（raw32B 的 base64）+ `priv.pem` + `pub.pem`；
   - `python3 reference_encrypt.py seal --public-key @pub.pem --machine-code <原文或64hex> --description "..." --logs "..." --screenshot <png> --out env.json --expect-out cross-case.json`——**t08 消费的是 `--expect-out` 写出的包装格式**，漏给该参数则 t08 读到裸信封格式不符；
   - `FAULT_REPORT_TEST_KEY_PATH=priv.b64 FAULT_REPORT_CROSS_ENVELOPE=cross-case.json cargo test --lib -- fault_report::integration_tests::t08` → 1 passed；
   - 反向：同 env 跑 t07 → `python3 reference_encrypt.py open --private-key @priv.pem --envelope target/fault-report-evidence/rust-sealed-envelope.json`，description/logs/screenshots 逐字段比对。
4. 端到端：POST `/api/fault-reports`（用户 JWT；限体 32MiB；密文上限 20MiB；时间窗 ±86400s，env `FAULT_REPORT_TIMESTAMP_WINDOW_SECS` 可调）；管理端 `/api/admin/fault-reports`（superadmin）+ `/{ticket}/view` HTML。沙盒无浏览器 → `weasyprint admin-view.html out.pdf && pdftoppm -png -r 100 out.pdf page` 出渲染证据。
5. 全量 `cargo test --lib` 有 **10 个既有失败**（沙盒无 Redis 的 ctor panic，全在 `huanvaeguard::services/{agent_push,key_service,device_service}`，exit 101，2026-09-15 r2 复跑同值）——验证一律用 fault_report 过滤器，勿拿全量绿当门禁；归因用 `git diff HEAD --name-only -- <三文件>` 零 diff 佐证。

## §4 沙盒环境边界（2026-09-15 亲测，CMD+OUT 见 dg80pf1a-1 update/deliverable.md §3）

- **Cargo.lock 属 nobody、`test -w`/`touch`/`dd` 全拒 → 新增直接依赖不可行**；`chacha20poly1305`/`hkdf` 仅是 hg-core 传递依赖（Cargo.lock :858/:1865），Rust 不能直接 use——故 crypto.rs 按 RFC 8439/5869 手写（官方向量单测 + 双向互操作双重锚定）。**Cargo.lock 恢复可写后应换回官方 crate，信封字节格式不变**，重跑 37 项 + 互操作即等价切换。
- 仓库根/`src/`/`docs/`/`tests/` 全 EACCES，仅 `examples/` 与 `docs/diagnosis/fault-report/` 可写 → 新模块走 `#[path]` 挂载；交付路径偏移（如公钥不在 docs/ 根）在部署机 `mv` 即可归位。
- **/vault.env = udev[/null] 的 ro bind（findmnt 实测 `ro,devtmpfs`）→ 写入 EACCES 被拒**，既不是可写文件也不是「静默丢弃」——金库安装只能部署机做；读取链 `FAULT_REPORT_PRIVATE_KEY_PATH` > `FAULT_REPORT_PRIVATE_KEY` > `/vault.env` 的 `FAULT_REPORT_PRIVATE_KEY=` 变量（crypto.rs load_private_key_from_env）。
- cargo 不在默认 PATH：先 `export PATH=/root/.cargo/bin:$PATH`，否则裸跑 exit 127（本轮实测踩中）。

## §5 踩坑速查（点名非穷举，全集枚举见 dg80pf1a-1 update/deliverable.md §4）

1. 仪式私钥落 /tmp = 定时炸弹：正式仪式只在部署机做，沙盒只允许演练（对临时金库文件验证 `--from-pem`+`--check-public`）。
2. t08 无 env 静默 ok（§3.2），「全绿」不等于「互操作真跑」。
3. cross-case.json 必须 `--expect-out` 生成（包装格式）。
4. /vault.env ro bind：写被拒非丢弃；上游「写入即丢弃」表述已订正。
5. 对跑的参考实现自己会带 bug（poly1305 对跑脚本 clamp 掩码多 4 hex 位首跑误报 MISMATCH）——参考侧先过官方向量再信对跑结论。
6. 多轮整改后证据叙述漂移（工单号叙述未随重跑同步、mod.rs 头注释路径过期）——叙述性引用必须对 sha256 一致的证据文件重写。
7. App 端联调提醒：脱敏在客户端写日志前完成，服务器只见密文无从兜底；客户端时钟偏差 >±86400s 是已知拒绝路径；磁盘零明文验收=`grep -rl '<提交过的明文标记>' /tmp/fr-store-*` 应 0 命中（本轮实测 0）。

## §6 App 端（/work/Huanvae-Chat-App，dg80pf1a-2 亲测沉淀）

1. **生产密钥四件套验证**（联调机上无私钥实体也能闭环「内置正式公钥→服务器可解」）：
   a. DEBUG 旋钮：`VITE_FAULT_REPORT_DEBUG_PEM` 注入联调公钥，生产构建必须 unset；
   b. 构建断言：`grep -l "<正式公钥片段>" dist/assets/index-*.js` 命中且 scratch 公钥片段 0 命中；
   c. 互操作回归：tests/faultReport/interop.test.ts 断言 App 内置公钥 ≡ 服务器交付 pem（32B 裸钥 toEqual）+ fail-closed（公钥为 null 时 seal 抛错，crypto.test.ts）；
   d. 反向解密证明：正式路径工单用 scratch 私钥 open 应返 400（tag/aad mismatch）⇒ 排除 DEBUG 密钥；正向等价性由互操作测试+服务器块 integration_tests 补齐。
2. **脱敏按数据形态分器**：文本（Bearer/KV/JSON 同名字段/authorization 头/长 hex）与 URL 必须分开——URL query **值一律剥除**（键名保留可诊断、结果仍可 `new URL()` 解析），否则失败请求 URL 中的 token 会原样进环形缓冲与上报载荷（dg80pf1a-2 第 6 轮 REJECT 实录）。脱敏器做幂等，源头+入口+组包三层调用；写入点全集枚举法：`grep -rn "pushEntry(\|networkErrors\\.push(" src/services/faultReport/`（本块实测 9 处：capture 4+service 2+instance 3，capture.ts:31/70/88/122、service.ts:69/82、instance.ts:32/39/46）。
3. **聊天正文零采集=机械闭环**（人工枚举 console 调用点不可持续）：对象级丢弃——stringify 前「含 string `content` 且含任一会话特征键（conversationId/messageId/senderId/receiverId/chatId/sessionId/peerId）」的对象整体丢弃返回占位符；字符串化后 JSON content 族键剥除兜底；必须配 capture 端到端单测（console 原样转发不受影响 + 缓冲快照正文零出现）。可达性审计口径：console 打正文/Rust log 聊天词/消息库 import 三连 grep（全 0 见 dg80pf1a-2 update/deliverable.md E2）。
4. **联调环境三补丁 + 交接项**：WebView 跨源 fetch 需服务器侧 CORS 层、JWT 有效期 3600→14400s（长流程联调）、harness 固定密钥目录 env；设备侧 `adb reverse tcp:18099 tcp:18099`。**生产上线交接：网关需为 /api/fault-reports 配 CORS**，否则真机上传静默 Failed to fetch（落本地暂存，不显服务器错）。
5. 应用内更新弹窗会多次中断真机长流程 UI 操作——正式真机验收选更新域不可达或已升级环境。
6. 环形缓冲按字节计费 10MB（单条超限整条丢弃、队首滚动丢弃、droppedCount 透出）；本地暂存=**密文信封**（非明文）上限 5 条跨重启持久化；重试串行 continue-on-failure。工单号 `FR-YYYYMMDD-<12hex>` 与 §1 同源。

## §7 App 端功能重放合入 main（atsafbg2 实测沉淀，2026-09-16）

历史：8e490f77（App 端功能合入）被 47131558 revert——根因=原卡「实现期不 push」边界与返工指令冲突，**非功能缺陷**（重放补丁与原提交逐字节一致）；owner 会话「全批」解除冲突后重放为 71883a69（feat）+11db47f4（pem 同步）落 origin/main。复发时按此速查：

1. **授权先行**：已验收≠不会被 revert，被 revert≠功能有缺陷——先查授权链（边界条款是否互斥、有无 owner 显式解除原话写进新卡 approvedMandate），授权冲突不解则停手，禁止「两条指令选一个执行」。
2. **重放终点=分支现行验收态，非机械单 SHA**：原提交在分支上的后续修复须一并 pick（本例漏 pick 2b1ccb07 pem 同步即把过期内置公钥带上 main＝§2 换装铁律同型事故）。
3. **冲突预判先于恐慌**：revert 只把功能文件还原回基线、未叠新改动时 cherry-pick 零冲突直过；动手前先做 `git diff --name-only <功能基点>..HEAD` 与功能文件面的交集检查。若冲突：只 `git add` 功能清单内路径，禁 `add -A`；合入后禁碰面核验 `git diff --name-only <基点>..<合入HEAD> | grep -E '^scripts/|^\.github/|tauri\.conf|gradle\.properties|\.claude/'` 应零命中（在飞块 UI 面另 grep `^src/pages/|^src/styles/`）。
4. **等价性双验**：`git show <原提交> --format= | diff - <(git show <新提交> --format=)` 逐字节（本块 RC=0）；再对分支验收态做功能文件面 diff 应为空。等价证明同源口径见 release/SKILL.md:763（patch-id）。
5. **worktree 隔离三件坑**（主 checkout 带他块脏文件时禁就地合入，`git worktree add` 开隔离舱）：①node_modules 缺失→符号链接主 checkout；②untracked 测试夹具缺失（interop.test.ts 消费 `test-artifacts/dg80pf1a-interop/py-sealed-envelope.json`）→原样复制后全量重跑；③gitignored 编译期钥匙 `src-tauri/resources/app-client.key.pem`（.gitignore 覆盖，include_bytes! 需要）→复制，值不打印不入 git。cargo 不在默认 PATH 同 §4.4。
6. **合入与发版解耦**：合入 commit 只带功能文件；版本号/tag/发布动作归发布单。证据三线=版本字段 grep 原值（package.json / tauri.conf.json / Cargo.toml）+ `git ls-remote --tags` 前后 diff 零新增 + 基点..HEAD 无 `.github/workflows` 变更。
7. **门禁计数跨期对账锚专项**：全量用例数随 main 漂移（dg80pf1a-2 时 4458→合入后 4461，系 main 侧新增用例），可比对锚=faultReport 专项 71/71；`git ls-remote` 偶发 GnuTLS RC=128 为瞬时网络抖动，原样重试即成（本块 tags 现查首跑即中）。
8. **集合计数防「动作加总冒充文件全集」**：两 commit 触达文件并集=28 个（71883a69 28 文件＋11db47f4 仅改其中 config.ts 1 行；变更动作 29 次但不同文件 28）——报「N 个文件」前先 `git diff --name-only <基点>..<HEAD> | wc -l` 对账，勿把逐 commit 计数连加（atsafbg2 update v1 即把 28+1 误报成「29 个文件」）。

## §8 多线修复批量合入本地 main 的发版前口径（lik80p7i 实测沉淀，2026-09-29）

场景：**7+1 条已验收修复线**（部分=已提交分支，部分=共享工作树未提交改动）要在发版前合并进本地
`refs/heads/main` 并过门禁，但**发布动作（tag/push/上传/切渠道/release.sh）留待 owner 确认卡**。
§7 覆盖单条功能重放；本节覆盖**多线批量合入 + 版本派生 + 门禁登记**的增量口径，与 §7 互补不重复。
块实证：`/root/pipeline-lines/huanvae-chat-app/blocks/1790619639024-lik80p7i-1-核对修复线合入本地主线过门禁/`
（main `2c3e590f`→`015e18fd`，v1.1.53，前端四门+Rust 三门 exit 全 0）。

1. **合并门顺序：先核对→再合并→后 bump**。切勿在已 bump/已 tag 的树上开合并门：前代 `nmh7ib86`
   即因 main 已有 `5c8f0661 chore(release): v1.1.50` 且 tag 已 push 固化而卡死 10 轮。开工首步实测
   「目标 tag 远端不存在」+「最新 release tag」，再动合并。
2. **按线拆 commit 的切分口径**：一条线触达文件互不重叠→各成独立 commit；**多线共用的命令注册点
   /模块声明文件**（本例 `src-tauri/src/lib.rs` 同属 ②搜索 offset / ⑤去SNI / ⑥rc_inject 三线）
   无法切成不重叠 commit→**单列一个 commit 并在 message 正文逐项标注归属线**，不留归属不明的混合提交。
   门禁红→绿的**零行为修订单独成 commit**（本例 `015e18fd` clippy doc 补空行、`c0a147a8` 更新源补≥2条），
   便于日后二分。
3. **同修复多落点查重去重（双口径）**：祖先口径 `git merge-base --is-ancestor <sha> refs/heads/main && echo IN-MAIN`
   逐 commit 跑；内容口径 `git show <sha1> | git patch-id --stable` 与 `<sha2>` 比对——相同即语义等价、
   合入幂等（本例 ⑥ 分支 `c19406c9` ≡ main `861e5032`，patch-id `371680d5…`）。**`--stable` 必加**，
   否则空白差异误判不同。**要点**：同一修复可能**部分**已在 main（本例 ⑦ 一半在 main、一半在工作树），
   须按**文件落点** `git diff --name-only <base> refs/heads/main | grep <path>` 逐件判，不能「分支没 merge 就全合」。
4. **auto-version 版本派生 + 四文件一致的机器可核对写法**：版本只能由
   `bash scripts/linux/auto-version.sh --json` 只读派生（输出 `AUTO_VERSION: latest=… target=… action=…`，
   `EXIT=0`），禁猜禁跳位。三处（+Cargo.lock）用 `git show refs/heads/main:<path>` 取值（**禁用工作区文件**）：
   `package.json` / `src-tauri/tauri.conf.json`（各 grep `"version"`）、`src-tauri/Cargo.toml`（grep `^version`）、
   `src-tauri/Cargo.lock`（grep -A1 `name = "huanvae-chat-app"`）。bump commit 惯例对齐仓内
   `git show 5c8f0661 --stat`：**恰 4 文件各 1 行**，stat 超行=夹带，停。`release-config.txt` 同步
   VERSION+MESSAGE，**不跑 release.sh**。
5. **门禁「跳过项登记 ≠ 通过」的登记式口径**：前端四门按 `package.json` 既有脚本**原样跑**，不改脚本/不过滤用例；
   Rust 侧口径锚=仓内既有门禁定义 `scripts/linux/test-all.sh:728`（`cargo test --lib`），**锚点必须取
   `git show refs/heads/main:scripts/linux/test-all.sh` 侧 blob**——若引工作树脏文件，blob 哈希与 main 侧不同
   （本例 review 第 1 次 REJECT 实录：工作树 blob `4802ea0d` ≠ main `9270fb00`）⇒ 锚不可核。整包 `cargo test`
   会连带 `tests/local_e2e.rs` 3 例（需本机 `127.0.0.1:18080` 后端集群），该 3 例不属仓内门禁口径且非本块引入
   （`git diff --name-only <base> refs/heads/main | grep local_e2e` 零命中）→如实登记 **env-BLOCKED（非跳过、
   非通过）**，覆盖性由 `cargo test --lib`（含搜索 7 例）+ 去 SNI 专项（7+3 例）补齐。
6. **零远端写的「前后快照反证法」**（比自述「没 push」硬）：开工前后各拍
   `git ls-remote --heads origin` / `--tags origin` / `git tag -l | sort` / `git status --porcelain=v1`，
   收工逐字 `diff` 期望 IDENTICAL（本例四组全 IDENTICAL，origin/main 前后同为 `976b0198`）。
   **同法反证「未触碰共享工作树」**：`porcelain` 前后 149 行逐字一致 + `git rev-parse HEAD` 前后同值
   （本例工作树停留 `6bba968a` 分支，而 main=`015e18fd`，二者不同）。
7. **main 侧正向锚点必须显式 `refs/heads/main`，禁用工作区 HEAD**：工作树 HEAD 指向分支时会得出错误结论
   （本例 HEAD=`6bba968a` ≠ main=`015e18fd`）。所有「已在 main」声称写成
   `git show refs/heads/main:<path>` / `git merge-base --is-ancestor <sha> refs/heads/main`。
   配套：核心结论配**行首字面 `verify: <单行命令>`** 指向冻结证据文件（生成后不改 + `sha256sum -c MANIFEST.sha256`）——
   review 第 2 次 REJECT 的直接原因即「核心结论无判官侧可复跑锚点」。
8. **冲突解决「归属可证」比「冲突已解」重要**：若冲突文件相对一侧是**纯增量/严格子集**，取超集侧即无损
   （本例 `wsHandlers.ts` diff 的 deletions 全为分支侧缺 main 内容→取 **ours(main)** 无损；
   `MobileMeetingPage.tsx` deletions=3/additions=104 纯增量→取 **theirs(6bba968a)** 无损）。
   若两侧各有独立语义增删（真冲突）→**停下报告**，不得擅取舍（可能改已验收结论）。
9. **纳/剔账三件**：①untracked 交付件按**白名单**复制入库并落清单（本例 33 项）；②**二进制件按既有策略**——
   `src-tauri/binaries/*` 若工作树为旧件，保留 main 已验收件，证明=`git diff --name-only <base> refs/heads/main |
   grep '^src-tauri/binaries/'` 空输出 + sha256 逐字节同；③**密钥零入库核查**
   `git diff --name-only <base> refs/heads/main | grep -E '\.(pem|key|jks)$'` 空输出，gitignored 构建期钥匙
   （`app-client.key.pem`）只复制进隔离 worktree 不入库。剔除项=证据/scratch/worktree/媒体目录、CI 旧件、dev 环境改动。
10. **门禁证据=命令原文+完整输出全文+exit 码，摘要不构成证据**：交付以「Test Files 397 passed」等摘要行
    替代完整终端原文会被判不可复算（review 第 1/2 次 REJECT 实录）。8 份 `gates/*.log` 完整落盘，末行显式
    `EXITCODE=0`，核心声称配行首 `verify:` 行指向冻结文件。
