---
name: dual-end-ui-evidence-revalidation
description: 零裁决前代的换写法重派复验配方 — review 硬指标「触及用户可见界面须双端设备实测」的达标流程（安卓 adb 模拟器：claim/release 环境件、ADBKeyboard 中文注入、screencap 搜索三态+混显四场景矩阵、run-as 拉库、SQLite 按 conversation_id 逐组闭合对账；Windows winserver-hg VM：SSH tar→vite build→tauri build NSIS→autologon/schtasks 拉起→剪贴板注入关键词→截屏→taskkill+scp 拉回同库对账）、判官只读复算环境纪律（verify 入口只放只读命令族、pnpm test:run 判官侧 EROFS 教训、门禁结论以日志 file:line+断言+会话留痕支撑）、verify 脚本模式（编号断言+末行 ALL VERIFY PASS）、重拉代际计算规矩（同 dispatch id 多块同代、缺记录须标注证据缺口并直读 result.json 补齐、沙盒不可达前代证据以卡载引文为限）、零裁决差异点因果咬合写法（输入侧根因诊断→机制差异消解根因；纠正对账一律本会话现跑，转抄 file:line/计数=事故源）。凡接手「前代 review 层 ESCALATED/10 轮零裁决」的重派块、要复验搜索/混显类用户可见修复、或要在 winserver-hg VM 上做 Tauri 桌面实测，先读本 skill。
disable-model-invocation: false
allowed-tools: Read, Grep, Glob, Bash, Write
license: MIT
---

# 双端设备实测复验：零裁决前代重派的达标配方

> 来源：块 `1790479215407-0f4zi12l-1-双端实测复验搜索混显双修复`（2026-09-27，code 层第 8 轮 PASS 后业务返工至第 9 轮再 PASS、review 层第 3 轮 PASS 后又续第 4–6 轮，全块终态 L29/L30 双判官 PASS）。
> 前代为同 dispatch（5lbg8ahy）两块——搜索 LIKE 分页修复、昵称回退修裸 ID——code 层均 PASS 但 review 层各烧满 10 轮零裁决 ESCALATED；
> 本块把其 review 反复索要的「双端设备级证据」升格为主体交付后，review 首轮过。全块过程档案：judge.jsonl（11 组判决）、
> `/work/Huanvae-Chat-App/evidence/0f4zi12l-1/`（SHA256SUMS 149 项：android 56/windows 53/db 6/logs 19/根 15）。

## 触发场景（命中任一条，先读本 skill）

- 接手任务卡标注「换写法重派」「前代 review 零裁决/ESCALATED」的复验块；
- 交付涉及用户可见界面（搜索结果、会话昵称显示等），review 要求双端设备实测；
- 要在安卓模拟器测中文搜索/昵称显示，或在 winserver-hg VM 上实测 Tauri 桌面端；
- 要给判官造可复算入口，而判官环境是只读挂载。

**正典关系（先读再动手）**：安卓真 UI 操作配方（uiautomator/input tap、凭据零明文、GAP 口径）见
[ui-real](../ui-real/SKILL.md)；「行为不变」端清单纪律与验收文书三要素归拢见
[multi-end-behavior-evidence](../multi-end-behavior-evidence/SKILL.md)；混显的**实现层**根因
（sender_name 写侧多路径 × 读侧回退不一）见 [rules/common.md:378](../../rules/common.md)——本 skill 只管**实测复验流程**，不改实现。
update 步自身的交付纪律（三问/落地/枚举）见 [skill-evolve](../skill-evolve/SKILL.md)「沉淀层交付纪律」。

## §1 安卓端流程（emulator-5560 实测，六步缺一即被打回）

1. **环境声明式占用**：claim 环境（本块 `env-claim-android-r7.json`，env-mujlto7yirg0）→ 实测 → release `{"ok":true}` rc=0；claim/release JSON 带 UTC/CST 双时间戳，入 SHA256SUMS。环境稀缺，用完即还。
2. **装机锚定**：卸载金丝雀旧版 → 修后 APK 安装 Success，**装前先复算 APK sha256**（本块 `48ca251d…f6621`）——实测必须能锚定到代码版本。
3. **中文输入**：模拟器无实体键盘，中文关键词用 **ADB Keyboard** 注入（本块实测词「房间」）。`.claude` 全树查重：ADBKeyboard 此前零覆盖，是安卓中文搜索实测的隐形门槛。
4. **截图矩阵**（不全不开始）：搜索类=输入态/输入+命中/分页滚动态三态起步（本块 r7-and-10/11/12/13）；昵称显示类=有昵称/无昵称/群聊/私聊四场景起步（本块 r7-and-09/14/15/16 + prefix-65/66）。每张绝对路径+完整 64 位 sha256。
5. **DB 对账**：`run-as <pkg> cat …/chat_data.db` 拉库（rc=0）→ sqlite3 按 `GROUP BY conversation_id` 计数 vs UI 命中数**逐组**闭合（本块 21=群7 7+搜索测试B 5+搜索测试D 9，双端同值；另附 meeting 460/unique 240 防回归锚）。
6. **全程命令流水账**：每条 adb 命令的时间戳+输出+rc 写入单一留痕文件（本块 `logs/adb-r7-full.txt` 64 条，4.2MB）。**这是判官认定「真设备级」的核心依据**——声称「N 条 adb 逐 rc」却只贴几条摘录=打回；「见上一版」=无留痕（上一版不在本轮交付内）。

**防降级红线**：纯 API 链路测试≠设备实测；web 截图≠安卓实测；引用不在本轮交付内的旧版证据=无证据。

## §2 Windows 桌面端流程（winserver-hg VM，env-mujm913i51pt）

SSH 上 VM：源码 tar 传输 → junction 挂 appbuild + @noble 三包 dereference → `vite build`（记 VITE_EXIT）→ `tauri build` NSIS 出 exe（记字节数+sha256；.sig 缺私钥报错不影响 exe 本体）→ autologon + schtasks 拉起 → 登录 → 打开会话（群聊懒拉取）截混显 → **剪贴板注入**关键词（VM 内无实体键盘）→ 截搜索三态 → `taskkill` 释放库文件 + scp 拉回 `win-r7-chat_data.db` → 与安卓同 SQL 对账（本块 7/5/9=21 双端同值）。桌面截图必须是真 Windows 窗口。

**「不适用」分支不是漏做出口**：一端判不适用必须=点名原因+该端路径零触碰 diff 三要素（命令+退出码+输出原文）。本块判官原话级教训：Windows 只做构建/登录/同步、漏掉搜索操作，被判「桌面端搜索项实测缺失·验收口径漏答」并升级成总监返工令（rework-feedback-history 在案）。

## §3 判官只读复算环境纪律（EROFS 教训，review 层第 2 轮 REJECT 直接动因）

- 判官工作区**只读挂载**：`pnpm test:run` 启动要写 `node_modules/.vite-temp/*.mjs` → EROFS exit=1。交付里把这类命令列为复算入口=「复跑与声称矛盾」violation。
- **verify 入口只放只读命令族**：SQL 计数 / git diff 三件套 / sha256sum / diff / grep。
- 门禁结论（typecheck/lint/unit/cargo）的证据基础改为三件：①日志 file:line+原文行（如 `typecheck-r8.log:3 TYPECHECK_EXIT=0`）；②verify 脚本对日志退出码的断言；③本层会话实跑留痕存档。
- **verify 脚本模式**（本块 `logs/verify-r8.sh`，23 项断言）：编号断言 V1…Vn + 每项 `PASS/FAIL Vx-名` + 末行 `ALL VERIFY PASS (n/n)` + 实跑输出存档 sha256。它同时满足「判官可复算」与「自己防手滑」。配套：交付每节附 `verify:` 行。
- 修复轮代码落地后必须在**当前树全量复跑**门禁并存档日志+sha256（旧轮门禁≠当前树门禁）。
- **判官命令白名单**：判官侧只能跑白名单命令族（grep/sed/sha256sum/wc/date/sqlite3/git 读命令等）；白名单外的复算项（如跑 vitest、开截图逐像素比对）会被挡下按 **UNVERIFIABLE** 读——此时只要交付已附三要素与缺口声明，判官按「如实声明缺口」接受而非打回。设计 verify 入口时就把锚点全部落在白名单族内。
- **断言必须漂移稳定**：verify 脚本若断言会随并行块/update 层写入漂移的绝对计数（porcelain 总数、插入行数、清单项数），每轮都要改期望值，「按现值重写的断言」无独立判别力（review 第 4 轮原话级教训）。改用稳定口径：tracked-M 行数、**文件集合哈希**（`git diff --name-only | sort | sha256sum`）、分类连加自洽。本块 code 第 9 轮 verify-r9.sh 即此重写（V7=65 M 行数、V8=65 文件数+集合哈希，不再断言 146/2890）。
- **被审方脚本不作复核锚点**：review 层不得引用被审方 verify 脚本的断言 PASS 当自己的证据——锚点必须本轮亲跑（grep/sed 原文+退出码），否则「以被审方重写的断言自证」=零判别力。

## §4 重拉代际计算规矩（card 写法层）

- **同 dispatch id 多块同代**：`<ts>-<dispatchId>-1` 与 `-2` 是一代；重拉卡是下一代。派单文案按块数自称「第 3 代」是错的。
- **缺记录必须标注证据缺口并直读终态件**：输入『近三代真实块记录』不含前代时，卡面明写「generation 无输入记录，缺口由 leader 直读 result.json 补齐」，逐条引 `status: ESCALATED`、code `finalVerdict.pass: true`、review `attempts: 10 / verdicts: [] / escalated: true`、finishedAt。
- **沙盒不可达的前代证据以卡载引文为限**：如实声明「截图本体不在沙盒可读域，以卡载引文为限」+本块现算补强（本块判官独立核实缺口声明属实后接受）。诚实声明不可达，比虚构引用安全。

## §5 零裁决差异点因果咬合（重派卡「为什么这次会不同」写法）

1. **先诊断输入侧根因**：零裁决=判官面对**证据缺口**（块A：9 轮索要「设备级同条件配对」而交付给不出）+**口径失准**（块B：WS/REST 锚点误引、file:line 声称不实、计数 11 实为 10）无法收敛，不是机制随机。
2. **机制差异必须直接消解根因**：把 review 反复索要的证据升格为 code 层一次性主体交付 + 强制失准口径逐条纠正对账（命令+退出码+输出原文）。
3. **纠正对账一律本会话现跑**：块B 纠正过程中自己又错两次——wsHandlers 真实路径 `src/contexts/wsHandlers.ts`（先转抄成不存在的 `src/ws/`，grep EXIT=2）；displaySenderName 足迹实为 9 文件（先转抄 10）。**任何 file:line、路径、计数，转抄自记忆或前代文档都是事故源**；历史口径错误在交付「残留声明」如实更正。

## §6 计数与对账纪律（violation 换来的三条）

- **逐组闭合**：每个 UI 分组都要有 SQL 侧对应值或显式未显原因；总数对上不够（本块 B 组 5 条曾在两处文档说法打架被判「对账范围自相矛盾」）。
- **计数单一口径**：穷举集合（截图张数/清单项数）由一条命令生成、一个数字贯穿全文；本块 SHA256SUMS 曾同文出现 103/113 两数，同族 violation 复发 4 轮，终以「`find|sort|xargs sha256sum` → `wc -l`=149 → 分类 `uniq -c` 56+53+6+19+15=149 自洽」定型。
- **证据落仓防灭失**：/tmp 两轮清理曾丢早期日志与修复前 APK；行为证据链一律落 `evidence/<dispatchId>/`；已灭失的写「残留声明」+复现步骤，不补造。
- **零擅改四命令**：`git rev-parse HEAD`、`git log -2`（末提交时刻 < 块 createdAt ⇒ 零提交）、`git status --porcelain | wc -l`、`git diff --stat`；再用 porcelain 存档 `diff <(sort 存档) <(现跑)` 把增量逐行归因（本块唯一增量=并行块 `.claude/skills/` 一行）。

## §7 手机端判读口径、覆盖面自报与续轮回归（review 第 4–6 轮新增）

- **截图逐张说明是必答节，不是「引用如前」**：触及用户可见界面的单子，每张截图要写明它证明什么+实码锚点 file:line；「第 N 轮 §3.1 全表引用如前」=本交付内零呈现=必答节缺失（review 第 4 轮打回原文）。
- **手机端判读四要素**：帧缓冲来源（是否真 screencap 帧而非模拟器窗口截屏）、移动形态分辨率（`file` 亲跑，本块 1080x2400）、logcat 落盘（拿不到就如实声明缺口+佐证，判官按 5d 接受）、逐张对照表落盘（本块 `review/logs/mapping-review.md`，17 哈希自检 17 OK/0 MISS）。
- **覆盖面自报三件套**（集合类声称标配）：①点名声明「这是点名非穷举」；②枚举命令+计数（`grep -cE … SHA256SUMS.txt` → 17）；③上界回答——全量 153 项分类自洽（56+53+23+6+15），未被点名的 136 项属哪几类（流程留痕/历轮同族/临时件/元数据）、为何不在口径内。
- **epoch/换算禁心算**：`date -ud @1790473917` 亲跑 → 01:51:57Z；本块 review 第 5 轮心算成 01:25:17Z 且文件对应错（GroupChatMessages.tsx 写成 messages.rs），换算与所引输出不符被判失准。
- **返工轮会漏掉先前已过的验收项**：review 第 5 轮整改时把验收标准 4 前半（前代归拢段）整段漏掉、§7 自评却标 ✅——每轮交付动笔前先抄一遍验收标准全清单逐项对号，✅ 必须指向本交付内的实际章节。
- **证据清单计数随时点演进**：SHA256SUMS 从 code 层终态 149 项涨到 review 层终态 153 项（review 自产存档入清单）。引用计数必带时点+分类自洽复算，不引过期数（本块 update 第 2 次交付引 149，续轮后应改引 153 并重算分类）。
- **续轮重派不得漏答原沉淀主题**：任务卡 updateScope 三主题是**每轮**交付的必答项，续轮只写增量教训、不逐项对账原主题落点=漏答 violation（本块 update 第 4 次执行实证：第 3 次交付只写增量六项，主题 2/3 虽已典在盘仍判漏答）；每轮动笔先抄主题清单逐项给 file:line，再写增量。
- **上界枚举必须与声称集合同域**：点名非穷举时，「未纳入还有哪些」要用**同域**全集回答——处置总表（全集枚举命令→逐条归族→每族给落点或理由→连加闭合）；拿另一域的计数冒充上界=零证明力（同轮实证：拿 judge 判决行数 19/11 充当「沉淀落点集合」上界被判不相关）。
- **三问必答是 update 层每轮固定节**：动笔先写三问节再写其他；整改自查按**层内全项清单**（三问＋updateScope 主题＋落地 file:line＋上界＋验证）而非上轮 violation 窄清单——本块第 4 份交付实证：只按上轮三条逐条整改、漏写三问节即判复发 REJECT（纪律 2「零作答即 REJECT」不因历史轮次答过而豁免）。
- **追加式档案计数用写时点逐行号枚举**：judge.jsonl/会话档随轮次追加，`grep -c` 浮动计数会被判官复跑打穿（本块实证：声称 21、判官复跑 22）；改为 `grep -n` 行号清单＋写时点声明，复算口径=清单内行号仍逐行命中（append-only 保证）＋超出快照的新增行不在口径内。
