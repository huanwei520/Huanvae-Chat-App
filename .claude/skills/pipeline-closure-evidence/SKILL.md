---
name: pipeline-closure-evidence
description: 管道块收口/欠项销账流程 — closure/ 证据目录结构、verdict.json 三字段与零命中断言包装记账、git grep 双形态覆盖面边界表述模板、移动端豁免举证门槛（窗口层守卫不够，须查 mobile 树全目录或实拍）
allowed-tools: Read, Write, Edit, Grep, Glob, Bash
---

# 管道块收口与欠项销账（closure evidence）

块在复核层被打回且欠项明确（directive 点名）、代码层已过而预算不足以复验时，正确打法是**收口**：不碰已过交付物，只补欠项证据。来源：块 `1790356269694-6zkl61tt-1`（收口 `8zymajji` 股票剥离块）2026-09-25 实测通过，复核层 complete=true。

## 三条结构决策（先于一切步骤）

1. **交付面隔离**：原块交付=代码改动+门禁；收口块交付=closure/ 新证据。对象重叠、交付面不重叠，无返工回路。
2. **抽跑代替重拉**：门禁只抽 1-2 项（typecheck+build 性价比最高）防漂移，不重拉全部。
3. **main 只读**：对被收口改动只读（git 全只读命令；构建产物只落 gitignored dist/）。

## closure/ 证据目录结构模板

```
closure/
  00-inflight-check.txt        # 任何写盘前：调度器在飞清单核查留证
  01-path-gap.txt              # 任务卡指定路径不可写时，mkdir/touch 实测原文备案
  02-archive-reachability.txt  # git diff <rev>^..<rev> | sha256sum 复算归档 patch
  drift-check/                 # 现状核对：git log -3 / ancestry+branch -r --contains / 提交 stat / 抽跑门禁 EXIT=0
  <欠项一债一目录>/            # 每条复核层欠项一个子目录（如 mobile-evidence/、coverage/）
  verdict.json                 # 验收状态三字段
  CLOSEOUT.md                  # 收口报告
```

每个证据文件首行写执行目录/HEAD/树状态；正文每段 `CMD:` + 原样输出 + `EXIT=`，判官逐字可重跑。若任务卡指定路径在 ro 面（如 pipeline 区 tmpfs）不可写：先 `findmnt -T <路径>` + 多点写探针实测留证，再同构落到授权 rw 面，并在 verdict.json 顶部 evidenceRootNote 声明落点偏移原因。

## verdict.json 三字段写法（含 exitCode 记账坑）

- `complete`（布尔）/ `checks[]`（name+status+exitCode+evidence）/ `unmet[]` 三字段齐全；落盘前 `python3 -m json.tool` 校验。
- checks[].name **直接复述欠项原文要点**，判官按号对号入座；evidence 必须**路径级可追溯**（文件名+节号），指向含 CMD+OUT 原文的证据文件，不指向散文总结。
- unmet 两种合法状态：逐条引证销账（路径+行号+输出原文位置）或如实列挂。禁止「视同完成」。

🔴 **exitCode 记账坑**：grep 零命中时裸命令退出码是 1（无命中标准语义）。checks 记 `exitCode=0` 而复算者跑裸命令得 1 ⇒ 「记账与独立复算不符」被整改。解法＝**零命中断言包装命令**：

```bash
git grep -n -i -E '<关键词集>'; rc=$?; test "$rc" -eq 1 && echo ZERO_HIT_ASSERT_OK
# 零命中 ⇒ 整体 EXIT=0（可复算必得 0）；有命中(rc=0)或出错(rc=2) ⇒ 非 0
```

记账 exitCode=0 记包装命令实测值；**裸命令原始 CMD+OUT+EXIT=1 原文必须同文件保留**，两层语义各留其位。

## 覆盖面复搜：双形态 + 边界表述模板

三件必做（CMD+OUT+EXIT 原文落盘）：

1. `git grep -n -i -E '<关键词集>'` —— 已跟踪面；
2. `git grep --untracked -n -i -E '<关键词集>'` —— 已跟踪+未跟踪并集（--untracked 依据：rules/common.md 盲区 B）；
3. 附 `git status --short`（未跟踪面实况）；增强：`git grep <rev>` 对 main 尖端做时点快照检索，不受工作树脏净影响，且证明后续合入未回填。

🔴 **结论表述规范**（有 --untracked 只解决「搜没搜到」，「结论怎么写」另有规范）：

- **正面清单**：本次覆盖哪些面（已跟踪面 / +未跟踪面 / `<rev>` 快照面），逐一对应证据文件号；
- **负面清单**：明确不含——.gitignore 排除面（构建产物）、node_modules、外部仓、其他分支/其他工作树未提交内容、git 历史中间提交面；
- **边界内措辞**：「**在上述覆盖面内**，关键词集 X 零命中（EXIT=1）」+ 显式「本结论不主张『全仓零命中』」；
- 禁用：无边界限定语的「全仓零命中」「仓库中不存在任何 X」。下多集的结论，先画清集合边界，每条边指到一个实测证据文件。

## 移动端豁免举证门槛

🔴 豁免主张的举证对象是「**豁免条件本身**」：窗口层 isMobile 守卫只是**间接证据**；直接证据只有两种——mobile 树全目录零命中（路线 b）或真机/模拟器实拍前后对照（路线 a）。只举守卫未查 `src/pages/mobile/**` ⇒ 豁免必被判不成立。

路线 b 标准证据组合（五步，全部落盘）：

1. 全目录清单双口径对账：`find src/pages/mobile -type f | sort` 与 `git ls-files src/pages/mobile | wc -l` 一致 ⇒ 无未跟踪遗漏面；
2. 超集关键词两形态检索：`grep -rnE '股票|…|[Ss]tock' src/pages/mobile/`（filesystem 形态天然含未跟踪）+ `git grep -n -i … -- src/pages/mobile`，均零命中；
3. 树同一性：`git diff <剥离树> <main尖端> -- src/pages/mobile --stat` 空输出 ⇒ 结论对两时点同时成立；
4. file:line 级路径不存在解释（三层）：渲染根二选一（如 `App.tsx:548 {isMobile() ? <MobileMain/> : <Main/>}`，无第三条路径）→ 组件挂载点唯一（Sidebar 仅桌面 Main 挂载；移动树内唯一引用是注释自证）→ 能力声明面（Tauri capabilities platforms 无移动端）；
5. 触发规则照办：**grep 出现任何命中 ⇒ 必须转实拍**，口头解释救不了。

写法心得：先完整列出被删入口链（侧栏项→注册表→页面接线→路由→能力声明，每环带剥离前 file:line），再逐环证明不在移动渲染树上——每环可独立 `git show <rev>^ -- <file>` 复算，远比抽象断言有力。

## CLOSEOUT.md 四件套与约束自证

- 收口报告必备：①欠项逐条对号销账；②全部引证（路径+行号+输出原文摘要）；③未重做范围与理由（指原块已过证据索引）；④约束自证。
- 约束自证命令级证据：未推远端＝`git branch -r --contains <提交>` 空输出 + `git log origin/main..main` 含该提交双证；归档未变＝`git diff <提交>^..<提交> | sha256sum` 重跑稳定且前缀与复核记录一致；落笔前在飞核查留证。
- 报告散文数字必须抄自证据文件原文或现跑命令，不凭记忆写（实测教训：散文 44/9 vs numstat 52+17 被复核层留档为非阻断笔误）。
