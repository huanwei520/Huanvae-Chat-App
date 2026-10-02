---
name: local-main-merge
description: 多线（≥2 分支）合入本地 main 的管线任务流程——两阶段先只读核对再落笔、merge-tree 预演、add/add 冲突超集论证、在飞块串行核查的 git 层替代证据链、分离头 worktree+update-ref 卫兵场地、门禁与可复算锚点（lo5z61mq 实测沉淀 2026-09-25）
---

# 多线合入本地 main（两阶段合线流程）

来源：块 `1790332771973-lo5z61mq-1-合CI修复与故障上报两线入main`（2026-09-25，ci 修复线+fault-report 线两次 `--no-ff` 合入本地 main，commit `5a4432c6`/`2c3e590f`，review 层独立重跑通过）。
与 `fault-report-e2e/SKILL.md` §7 的分工：那边是**单功能重放合入**（授权冲突/revert 重放/等价性双验），本 skill 是**多线批量合入的主流程**；场地与 worktree 坑两边互补（§5/§6 与彼 §5）。

## 1. 两阶段总则

第一阶段产出的不是计划草稿，而是第二阶段每步的**可执行预言**；第二阶段实际结果必须与预言逐项对上（本块 merge-tree 预判 2 处冲突与真实现场逐字一致）。PLAN.md 写到可直接执行粒度：门禁命令表（含专项测试路径）、场地创建步骤、main 前移方案、末尾验收自检清单。

## 2. 第一阶段 merge-check 九件套（只读，逐件落盘）

1. `git log main..<branch> --oneline`（未合入清单，逐条标注意图）
2. `git merge-base main <branch>`（分叉点=后续增量分析基线）
3. `git rev-list --left-right --count main...<branch>`（ahead/behind 量化）
4. `git merge-base --is-ancestor <branch-tip> main; echo $?`（rc=1=未合入）
5. `git merge-tree --write-tree --name-only main <branch>`（冲突预演，见 §3）
6. `git diff <merge-base> <branch> -- <冲突文件>`（冲突决策原始论据，见 §4）
7. `git status` / `git stash list` / `git worktree list`（在飞与未提交保护，见 §6）
8. 红线物核查：版本号三处（package.json / src-tauri/Cargo.toml / src-tauri/tauri.conf.json）、依赖重叠、分支是否触碰禁改字段
9. 以上汇总为 PLAN.md

## 3. merge-tree 预演两坑

- `git merge-tree --write-tree` **只接受 commit，不接受 tree**：链式预演第二步若把上一步结果 tree 传入即报 `expected commit type, but the object dereferences to tree type`（exit=1）。多线整体预演改为逐线预演，第二步起以上一**真实合并**结果为基线再预演，勿用 tree 硬拼。
- 预演输出含 CONFLICT 行即冲突文件全集；将其写进 PLAN.md，第二阶段冲突现场应与预判逐文件一致——不一致即停手重估。

## 4. add/add 冲突：超集论证三步法

add/add 常见于两线各自"新增"同名文件，先查是否同源（fault 线内容早已由 replay 线进 main，冲突只是血缘未合流的表象）。每个冲突文件三步论证全部成立才允许 `git checkout --ours`：

1. **分支侧独有增量检查**：`git diff <merge-base> <branch> -- <file>` 为空 → 分支侧零独有改动；
2. **main 侧增量列举**：`git diff <merge-base> main -- <file>` 逐 hunk 列出 → main 版 = 分支基线 + N 项后续修复；
3. **结论**：main 版是分支版严格超集，取 main 侧不丢失任何分支意图（对齐任务卡「保留 main 侧在飞块成果 + 吸收两线修复意图」）。

决策留三层记录：预演层（merge-tree 预判文件清单）→ 论据层（逐行 diff+main 侧修复出处 SHA）→ 结论层（解决命令注释 + 合并 commit message 写全决策依据、块 ID、owner 原令——使 `git log main` 自身成为决策记录）。review/判官用第 1 步同款命令即可独立复算。

合并顺序：先小后大、先零冲突后多冲突；第一步合并结果成为第二步基线，回退面小。

## 5. 串行纪律核查：调度器服务面可能无块级在飞清单

本沙箱实测（2026-09-25）：pipeline-screen 47620 对任何路径（/status /inflight /blocks）均回同一健康 JSON；47621 仅环境池租约（/inflight→`{"ok":false,"error":"unknown"}`）；model-gateway 47622 /inflight→`{"ok":false}`；47613 无此路由。**「查不到=没人落笔」不成立**，git 层替代证据链（逐条留 CMD+OUT）：

1. `git reflog show main -3 --date=iso`：main 顶停留时长（16.9h 零移动=无块落笔）；
2. 逐在飞块核对落笔位置：有分支/worktree 的查其分支顶（`git log -1 --format='%H %d' -C <worktree>`）；无痕迹的查其成果是否以主工作区未提交形态存在（`git status --porcelain | grep -E '<特征路径>'`）；已完成块用 `git merge-base --is-ancestor <成果> main`；
3. 落笔前最后一刻 `git rev-parse main` 复查顶未漂移（核查与落笔之间的间隙也是风险窗口）；
4. 旁证：`ps aux | grep -E 'pi-node|pi-coding|pipeline-worker' | grep -v grep` 进程清点。

## 6. 场地：分离头 worktree + update-ref 带旧值卫兵前移

现场常见双占用：主工作区被在飞块 checkout（带几十条未提交改动，**零触碰**——它的 status 行数就是对账基线）；main 的检出点又被另一 worktree 占用（git 不允许两个 worktree 检出同一分支；若该场地有遗留已暂存死状态，不在其中落笔也不代为清理，透明记录）。方案：

```
git worktree add --detach /tmp/<task>-wt <main原顶>   # 分离头，等价 main 顶
# 在其中 git merge --no-ff ×N、解冲突、commit
git update-ref refs/heads/main <新顶> <main原顶>      # 带旧值卫兵：期间有人动 main 即拒绝
```

要点：分离头里产生的合并提交与直接在 main 上操作完全相同（双亲 SHA 可验）；旧值参数=乐观锁；reflog 自然留痕；收尾 `git worktree remove` 并确认 `git worktree list` 零残留。**永远不 reset --hard、不强推、不推远端**——事后审计锚：`git reflog show main` 无 reset 条目 + `refs/remotes/*` 停在旧值（推送会使远端跟踪引用前移）。

## 7. 门禁

- 专项测试**单独跑一遍单独落盘**（如 `npx vitest run tests/faultReport tests/unit/huanvaeGuard.localApi.test.ts`），不全量结果里"顺便看过"；计数结果（`88 passed | 1 skipped`）要能解释每个 skipped：先查 `it.skipIf` 带因守卫（夹具缺失按设计 skip≠失败），再定性；
- cargo 不在默认 PATH：`PATH=/root/.cargo/bin:$PATH`；缺 `src-tauri/resources/app-client.key.pem`（rc=101）先核实 `.gitignore` 确系仓内刻意忽略的本地私钥资源，再拷贝**仅进门禁场地**，不进 git、不打印值；
- node_modules 软链共享主仓（只读，不 install 不动 lockfile）；失败件如实留证再处置（失败原因=环境而非合并引入也要留证）。

## 8. 证据可复算锚点体系（判官逐字复跑）

- 对象级：`git cat-file -p <合并提交>` 列双亲（一步证明 --no-ff 与血缘）；`git rev-parse <A>^{tree} <B>^{tree}` 树相等（净内容零变化证明）；
- 内容级：门禁被测文件逐个登记 blob SHA（`git rev-parse main:<path>`），git 对象不可变 → 锚定"门禁测的就是 main 终态"；
- 行级：file:line 锚点（`git show main:<path> | sed -n '<N>p'`）；
- 净差级：`git diff --stat <原main顶> <新main顶>` + `git log main..<branch> | wc -l` 清零（完整性+无损性一步验证）；
- 每条锚点前缀 `verify:`，判官复制即跑；锚点正本落 `artifacts/merge-check|merge-exec/`，交付里必须内嵌关键原文（判官宇宙=交付材料，只给路径=不可见）。
