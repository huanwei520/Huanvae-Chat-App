# CLAUDE.md — Huanvae Chat App 项目指南

## 项目简介

Huanvae Chat App 是基于 Tauri 2 + React 的跨平台即时通讯客户端，技术栈：

- **框架**: Tauri 2.9 (Rust backend) + React 19 + TypeScript
- **构建**: Vite + TailwindCSS 4
- **状态管理**: Zustand (stores/)
- **本地数据库**: SQLite（前端经 Rust 命令 `invoke('db_*')` 访问，封装于 `src/db/index.ts`；已不再用 @tauri-apps/plugin-sql 插件）
- **测试**: Vitest (单元/组件) + Playwright (E2E)
- **平台**: Windows/macOS/Linux 桌面端 + Android/iOS 移动端

### 前端模块

api, chat, components, constants, contexts, db, hooks, huanvaeGuard, lanTransfer, media, meeting, nfc, pages, services, stores, styles, theme, types, update, utils

## 项目阶段：个人开发验证期（核心约束）

**此项目处于个人开发验证期，所有修改均不考虑向后兼容。** 这条约束高于其他所有"温和清理"措辞，凡是与之冲突的局部规则均按此处约束覆盖。

### 硬性要求

- **新功能制作完成后，必须将旧功能/旧代码/旧文档清理干净，保证无任何误导性残留**
- 禁止保留 `@deprecated` 函数、向后兼容 stub、兜底分支、`// 旧版兼容` 占位、"以防万一"保留的死代码
- **注释里写"已废弃"但代码仍可被调用 ≠ 清理完成** — 必须**删除**被废弃代码 + 切换**所有调用方**到新实现
- 新增字段/属性时不为旧路径保留默认值或迁移逻辑；旧字段一并删除
- 重命名 API / Hook / 组件时旧名直接删除，不留 alias re-export
- 没有"灰色地带" — 要么彻底清，要么明确写下为什么必须保留（如 Rust 类型定义、还未迁移到新版本的核心模块），并标注成 `// BACKLOG: 等 <模块名> v2 重构一并删除` 强制后续追踪

### 例外清单（保留必须有明确理由）

仅以下情况可暂留旧代码：

1. **跨模块依赖未完成迁移**：例如 LAN 传输 v2 重构尚未完成，旧 `respond_to_request` 仍被前端 invoke — 这种情况注释必须改写为"前端 useLanTransfer.ts 仍在用，等 LAN v2 重构一并清理"+ 加 BACKLOG 标记，**不能**只写"已废弃"
2. **跨语言类型定义未对齐**：Rust enum / struct 字段被序列化为 JSON 传给前端，删除字段需要前端 type 同步 — 必须同 PR 同步删除
3. **存储 schema 不可逆字段**：SQLite 表已有的数据列删除需要 migration，未做 migration 前保留并标记

**判断标准**：能在当前 PR 内删干净就删干净，不能就明确写下原因 + BACKLOG。**禁止只标"已废弃"放着**。

### 与其他规则的关系

此约束**强化**「功能迭代规则」段落（见下方），并扩展到所有修改场景（不只是功能迭代）。审计 / 清理 / 重构 / Bug 修复 / 文档更新 — 全部适用。

## 核心规则：需求对齐优先

**收到任何制作要求或修改要求时，必须先进行需求对齐，再进入审计和实施流程。禁止跳过需求对齐直接开始技术分析或写代码。**

### 需求对齐流程

1. **理解并复述** — 用自己的话将用户的需求完整梳理一遍，包括：功能目标、预期行为、关键约束、涉及的技术细节。不是简单重复用户的话，而是展开为具体的功能点描述，体现自己的理解深度
2. **展示给用户确认** — 将梳理结果向用户展示，明确询问："以上是我对需求的理解，是否有偏差或遗漏？"
3. **用户确认后才继续** — 如果用户指出理解偏差，修正后再次确认，直到用户认可
4. **确认后进入审计** — 需求对齐通过后，调用 `/audit` 进入完整审计流程

**为什么必须这样做**：如果对需求的理解本身就有偏差，后续的审计、计划、实施、审查全部会在错误的方向上执行，且每一步都不会发现问题——因为它们都是拿「自己的理解」而不是「用户的原始意图」作为校验基准。

## 核心规则：修改前必须规划所需 skill 序列

**在需求对齐通过后、进入审计之前，必须先列出本次修改所需的 skill 序列并向用户展示确认。禁止凭直觉直接进入某个 skill 或裸跑工具修改代码。**

### 规划 skill 序列的流程

1. **基于需求性质判断**：

| 修改类型 | 推荐 skill 序列 |
|---------|-----------------|
| 功能开发 / Bug 修复 / 重构 | `audit` → `code-review`（实现后）→ `code-review`（测试后）→ `blind-review` → `skill-evolve` → `completion-summary` |
| 旧代码清理 / 废弃功能删除 | `cleanup` → `code-review` → `blind-review` → `skill-evolve` → `completion-summary` |
| 模块健康检查 / 问题排查 | `health-check`（含强制二轮反向排查）→ `skill-evolve` → `completion-summary` |
| 审核结论有争议 | 上面流程中插入 `review-dispute` |
| 配置变更（settings.json / 权限 / hooks） | `update-config` → `completion-summary` |
| 仅文档 / 规则文件修改 | 直接修改 + `skill-evolve`（如形成新经验）+ `completion-summary` |
| 发布构建（升版本号 + 打 tag + 推 GitHub） | `release`（含 PUBLIC 仓脱敏核）→ `completion-summary`。**前提**：待发的代码改动已各自走完自己的流程；发布本身不代替 audit / code-review |

2. **输出规划清单**：以表格列出 skill 调用顺序 + 每步的产出物 + 每步执行 Agent，向用户展示并征得同意

```
### 修改 skill 规划

| 序号 | Skill | 产出 | 执行 Agent | 必跑 |
|------|-------|------|-----------|------|
| 1 | audit | 审计报告 + 用户确认 | opus（主对话）+ Explore 子 Agent | 是 |
| 2 | 实施（按 audit plan） | 代码改动 | opus（主对话） | 是 |
| 3 | code-review（业务代码） | 审核报告 | general-purpose Agent | 是 |
| 4 | code-review（测试代码） | 审核报告 | general-purpose Agent | 是 |
| 5 | blind-review | 盲审报告 | general-purpose Agent | 是 |
| 6 | skill-evolve | 经验沉淀文件 | opus（主对话） | 是 |
| 7 | completion-summary | 完成总结 | opus（主对话） | 是 |
```

3. **用户确认后才进入第一个 skill**。用户可调整顺序、增删步骤（例：明确不需要测试编写则可砍 4）

### 为什么必须这样做

- **可预测性**：用户和模型对任务整个流程的边界有共识，避免中途突然 "顺手再加一步"
- **可追溯**：完成总结时可对照规划清单逐项核对，发现漏掉的步骤
- **避免遗漏 skill**：例如忘记 `blind-review` 或 `skill-evolve`，事后再补成本高
- **避免越权**：规划阶段就把 "本次不做的事" 列入排除清单，例如规划只清理 P0 死代码、不重构 P2 超长函数，落地时不会偏移

### 禁止情况

- 跳过规划步骤直接 `/audit` 或直接修改
- 规划清单与实际执行不一致（如规划写了 5 个 skill 实际只跑 3 个，事后必须解释或补跑）
- 把"是否需要 audit"判断推给后续步骤（审计本身就是规划要决定的事）

### 例外：纯探查任务

只读不写（仅 Read / Grep / Glob / WebFetch）的任务（如"查 X 是什么"、"看一下 Y 的实现"）不需要走 skill 规划，直接答复即可。**判断标准**：任务是否会涉及 Edit / Write / Bash 修改命令，是则必须规划。

## 核心规则：修改前必须审计

**在进行任何代码修改之前，必须先完成审计流程。禁止跳过审计直接修改代码。**

**执行方式**: 调用 `/audit <描述>` 触发完整审计流程。当用户直接要求修改代码时，也必须先自动调用 `/audit` 完成审计，不可跳过。**审计阶段必须执行 `audit` skill 中"第二轮反向排查到具体代码行"硬性步骤**，不允许仅凭第一轮 Agent 报告进入修改方案。

## 核心规则：修改前必须 git snapshot

**在 audit 通过、进入实施阶段之前，必须先把当前未提交的所有改动 commit 成一个 snapshot，作为回退基线。禁止在 dirty working tree 上直接开始新一轮修改。**

具体步骤（实施第一行代码改动之前必做）：

```bash
# 1. 看当前状态（确认有未提交改动）
git status --porcelain

# 2. 全部 add（包括新增文件，但不含 .gitignore 已忽略的）
git add -A

# 3. 提交 snapshot，标记本次任务名称
git commit -m "snapshot: before <本次任务简述>"
```

**为什么必须这样做**：
- 修改出错时可用 `git diff HEAD~1` 精确看到本次新引入的改动，定位回归点
- 用 `git checkout HEAD~1 -- <file>` 可恢复**某一个文件**到修改前状态，不影响其他修改
- 避免在 dirty tree 上覆盖性失误（如 Edit 工具误改 + 没有 baseline 对比就发现不了）
- 与 `/cleanup` 流程中的 "git init baseline" 一致：**任何会涉及多文件改动的工作前，先有 baseline**

**例外**：纯探查（只 Read / Grep / Glob，不修改）不需要 snapshot。仅当下一步是 Edit / Write / Bash 修改命令时才必做。

**如果 working tree 已经干净**（`git status --porcelain` 为空），则跳过此步（HEAD 本身就是 baseline）。

## 核心规则：测试通过才算完成

**任何功能开发、修改、修复，必须搭配运行对应测试，直到所有相关测试全部通过，任务才算完成。代码写完但测试未通过 = 任务未完成。**

具体要求：
1. **编写测试** — 新功能必须编写对应的测试（Plan 中规划测试用例，实现后编写）；Bug 修复必须编写回归测试
2. **运行测试** — 代码和测试编写完成后，必须实际运行测试并确认通过。不可只写不跑
3. **修复到通过** — 测试失败时，必须排查修复后重新运行，循环直到全部通过。不可跳过失败的测试、注释掉断言、或降低断言标准来"通过"
4. **全量回归** — 模块测试通过后，必须运行全量回归测试，确保修改不影响其他模块

**唯一例外**：因外部依赖（如需要真实设备、第三方 API）无法自动化测试的功能，必须在 Plan 中明确标注，并提供手动验证步骤和验证结果。不可静默跳过。

## Plan 执行规则

### Plan 编写质量要求

Plan 中包含的代码片段必须满足以下要求：

1. **类型正确性** — TypeScript 类型必须准确，泛型参数、联合类型、接口继承关系必须正确
2. **引用一致性** — Plan 中引用的函数名、组件名、Hook 名、类型名必须与项目实际代码一致，不可凭记忆编写
3. **导入完整性** — 如果代码片段使用了新的组件或工具函数，必须在 Plan 中明确列出需要添加的 `import` 语句

### Plan 步骤标注执行方

Plan 中的每个步骤标注由谁执行：

| 任务类型 | 执行方 | 说明 |
|----------|--------|------|
| 代码编写/修改 | opus（主对话） | 包括 .tsx、.ts、.css、Rust 等所有代码 |
| vitest / 单元测试执行 | test-runner (haiku) | 包括 typecheck |
| playwright / E2E 测试执行 | test-runner (haiku) | E2E 测试 |
| lint 检查 | test-runner (haiku) | eslint 检查 |

### 完整执行，不中断

Plan 批准后，必须自主连续执行直到整个 Plan 完成，中途不暂停、不询问。能自己完成的操作一律自己完成（包括但不限于：安装依赖、编译构建、文件操作等）。

**唯一允许暂停的情况** — 操作物理上必须由用户本人完成，例如：
- 浏览器内的 OAuth/SSO 认证登录
- 需要用户在第三方网站上查看并提供 token/密钥
- 需要用户在手机端扫码确认
- 需要访问用户本地未共享的私密凭据

安装软件包、运行 shell 命令、修改配置文件等**不属于**需要暂停的情况。

用户完成手动操作后，必须立即继续执行剩余计划，直到 Plan 全部完成。

### 代码实现后审核（不可跳过）

代码实现完成后、编写测试前，**调用 `/code-review` 启动独立 Agent 进行第一轮代码质量审核**。审核重点：无用兜底、过度防御、死代码。审核通过后才可进入测试编写。

#### 🔴 review 环节的必读链（code-review / blind-review 两道都适用，不可跳）

**任何一次 review（含盲审）开工前，第一件事是 Read 下面这一节，不是「建议阅读」：**

> [.claude/skills/code-review/SKILL.md](.claude/skills/code-review/SKILL.md)
> 「🔴 本仓已实证的失效形态清单（每次 review 必须逐条过）」
> （盲审读 [.claude/skills/blind-review/SKILL.md](.claude/skills/blind-review/SKILL.md) 的同名节，两份逐字节相同）

该节含**总纪律**（检查器类改动必须「故意弄坏一次」自证、且变异要精准只红一条）
与 **14 条**带可执行判据的失效形态（A1–A6 / B7–B9 / C10–C12 / D13–D14），并把
**`.github/workflows/**` 与 `scripts/**` 显式纳入 review 覆盖面** ——
这两类历史上从来没被审过，正是「发布流水线静默降级」能长期存活的直接原因。

**机械核对（做不到即视为没读，review 打回重做）**：review 报告必须原样带
「失效形态清单必答块」，默认必答 **A2 / A5 / B7**，每条给出**实际跑过的判据命令 + 实际输出 + 结论**。
核对命令（在 review 报告文件上跑）：

```bash
grep -c 'FMC-ANSWER:BEGIN' <review 报告>                        # 必须 == 1
grep -cE '^\| [A-D][0-9]+ \|' <review 报告>                     # 必须 == 本次指定的必答条数（默认 3）
grep -cE '^\| [A-D][0-9]+ \|[[:space:]]*\|' <review 报告>       # 必须 == 0（不许空命令格）
```

### 编写测试（不可跳过）

代码实现完成后、自检前，必须编写本次新增功能的测试。

1. **按 Plan 中的测试计划** — Plan 应包含测试文件名、测试用例列表、覆盖的功能点
2. **最低覆盖要求** — 每个新增组件至少 1 个渲染测试 + 1 个交互测试；每个核心 Hook/工具函数至少 1 个测试
3. **遵循项目测试规范** — 使用 `tests/` 下的测试工具和 setup
4. **运行验证** — 编写完成后，委托 test-runner（haiku）运行测试，全部通过后才进入自检

**如果某功能因外部依赖无法编写自动化测试，必须在 Plan 中明确标注，并提供手动验证步骤。不可静默跳过。**

### 测试编写后审核（不可跳过）

测试编写完成后、自检前，**再次调用 `/code-review` 启动独立 Agent 进行第二轮测试质量审核**。审核重点：假测试、无效断言、覆盖缺失、测试隔离。审核通过后才可进入自检。

### 完成后自检（不可跳过 — 直接输出完成总结属于违规）

Plan 全部执行完毕后，**必须立即**进行自检 + 独立 Agent 审核，然后才能输出完成总结。

#### 自检步骤：

1. **逐项核对** — 对照 Plan 中的每一个步骤，确认是否已实际完成
2. **遗漏补全** — 发现未完成的步骤，立即补充执行
3. **输出检查报告** — 列出 Plan 中每个步骤的完成状态，确保无遗漏

### 独立 Agent 盲审（二次审查）

自检完成后，**调用 `/blind-review` 启动独立盲审流程**。盲审 Agent 拥有独立上下文，零上下文对照 Plan 逐项验证。具体流程、prompt 模板和输出格式见 `/blind-review` skill。

🔴 盲审同样适用上面「review 环节的必读链」：开工先读失效形态清单（blind-review skill 的 D-4），
报告必须带必答块 —— 盲审的输入是 Plan + diff，而清单里近一半是 **Plan 与 diff 都看不见的存量失效**，
不主动拿清单去撞就永远撞不到。

### 审核争议解决

盲审报告有不通过项时，**调用 `/review-dispute` 启动 Agent 对话机制进行仲裁**，不直接修复。最终确认为真实问题的项，修复后再次提交审核。

## 经验回顾（任务完成后自动执行）

自检 + 盲审全部通过后、输出完成总结前，**自动调用 `/skill-evolve` 回顾本次任务**。识别踩坑点和重复模式，更新对应的 skill/rule 文件。无经验可归纳时快速跳过。

## 完成汇总（不可跳过）

经验回顾完成后，**调用 `/completion-summary` 输出规范化的完成总结**。禁止跳过汇总直接结束，也禁止用自由格式替代规范模板。

## 架构约定

### 前端目录结构

```
src/
├── api/            # 后端 API 调用封装
├── chat/           # 聊天核心功能
├── components/     # 通用 UI 组件
├── constants/      # 前端常量（动画 variants 等）
├── contexts/       # React Context
├── db/             # 本地 SQLite 数据库操作
├── hooks/          # 自定义 React Hooks
├── huanvaeGuard/   # VPN 客户端模块
├── lanTransfer/    # 局域网文件传输
├── media/          # 音视频通话
├── meeting/        # 会议功能
├── nfc/            # NFC 扫卡指令执行（解析 huanvae:// 指令 + 信任确认）
├── pages/          # 页面组件
├── services/       # 业务逻辑服务层
├── stores/         # Zustand 状态管理
├── styles/         # 全局样式
├── theme/          # 主题配置
├── types/          # TypeScript 类型定义
├── update/         # 应用更新
└── utils/          # 工具函数
```

### Tauri 后端

```
src-tauri/
├── src/            # Rust Tauri 后端代码
├── Cargo.toml      # Rust 依赖配置
└── tauri.conf.json # Tauri 配置
```

### 编码规范

- 组件使用函数式组件 + Hooks
- 状态管理使用 Zustand store（`stores/` 目录）
- API 调用封装在 `api/` 目录，数据面走 `invoke('secure_http')`（经 `src/services/secureFetch.ts`，Rust 自管 TLS 钉私有 CA + mTLS；AI SSE 流式走 `invoke('secure_http_stream')`，经 Channel 逐块推回，见 `src/api/ai.ts`）；webview 原生加载（头像/上传）经回环安全反代 `secureProxy.ts`。仅 `huanvaeGuard/localApi.ts`（回环 127.0.0.1）+ `nfc/executor.ts`（NFC 任意外链）例外保留 @tauri-apps/plugin-http
- 本地数据持久化使用 SQLite（数据访问经 Rust 命令 `invoke('db_*')`，见 `src/db/index.ts`）
- 样式使用 TailwindCSS 4
- TypeScript strict mode

### 依赖版本基准（必须遵守）

**所有新增依赖的版本必须与项目当前 package.json 中的同系列包保持一致，不允许过旧或过新。**

新增依赖检查流程：
1. 检查 `package.json` 是否已有同系列包 — 有则必须用兼容版本
2. 优先使用已有包的功能，不重复引入
3. Tauri 插件版本必须与 `@tauri-apps/api` 版本兼容
4. 前端依赖用 `pnpm add`，Tauri 后端依赖编辑 `src-tauri/Cargo.toml`

## 并行 Agent 策略

默认使用并行 Agent 进行代码分析，提高效率：

- **查看单个功能** — 多个 Agent 分别从组件、Hook、Store、API 层同时梳理
- **查看多个功能** — 每个功能一个 Agent，各自梳理完整链路后汇总
- **问题排查/优化** — 两轮排查：第一轮并行发现问题，第二轮独立盲审确认。使用 `/health-check <模块名>` 触发完整流程

### 子 Agent

| 子 Agent | 模型 | 用途 |
|----------|------|------|
| `test-runner` | haiku | 运行测试、类型检查、lint、报告结果 |
| `blind-reviewer` | opus | Plan 完成后的独立盲审（零上下文） |

**使用原则**：
- **所有测试执行**必须委托给 `test-runner`（haiku），主对话禁止直接运行测试命令
- **代码实现**由主对话（opus）直接编写，不委托子 Agent

### 盲审核心原则

二轮盲审 Agent 必须**零上下文独立评估**，防止确认偏差：

1. 禁止传递第一轮的结论、分析和严重度标签
2. prompt 只包含文件路径 + 中性功能描述 + 检查维度
3. 盲审结论与第一轮对比：两轮一致 → 真实问题；二轮否定 → 误判；矛盾 → 仲裁或待用户裁定

## 功能迭代规则

功能迭代时，完全采用新逻辑，不考虑向后兼容，不使用兜底策略。旧代码和旧文档必须清理干净，保证零污染。

**需要清理旧代码时，调用 `/cleanup` 加载完整清理流程。** 禁止保留废弃代码/注释/文档"以防万一"。

## 修改后同步更新规则

代码修改完成后，必须立即同步更新以下内容：

- **代码注释** — 修改了函数逻辑、参数、返回值时，同步更新注释
- **Rules 与 Skills 同步** — 当发现代码实际的目录结构、文件列表与 `.claude/rules/` 或 `.claude/skills/` 中的描述不一致时，必须立即更新

**禁止代码改了但文档/注释/rules/skills 没更新的情况。**

## 测试规则

**任何功能开发或 bug 修复，都必须编写对应的测试用例。不写测试的功能视为未完成。**

- **新功能** — 必须编写覆盖核心路径的测试：正常流程、关键边界、错误处理
- **Bug 修复** — 必须编写验证问题已修复的回归测试

### 测试执行

```bash
# 单元/组件测试
pnpm test:run

# 指定文件
pnpm vitest run <文件路径>

# E2E 测试
pnpm test:e2e

# 类型检查
pnpm typecheck

# Lint 检查
pnpm lint
```

### 测试执行委托规则（强制）

**所有测试执行必须委托给 `test-runner` 子 Agent（haiku 模型），主对话禁止直接运行测试命令。**

执行方式：
```
Agent(subagent_type="test-runner", prompt="在项目根目录下运行 pnpm test:run，报告结果")
```

### 测试编写规范

- **测试目录** — 单元/组件测试放 `tests/`，E2E 测试放 `e2e/`
- **测试工具** — 使用 `tests/setup.ts` 中的 setup，`tests/utils/` 中的工具函数
- **测试注册** — 新测试需在 `tests/registry.ts` 中注册

## 修改完成后的验证流程

代码和测试全部编辑完成后，严格按以下顺序执行。**最终门禁是 `scripts/test-all.ps1`，11/11 全绿才算完成**，不可只跑前几步就声明任务通过。

### 第 1 步：开发期局部验证（迭代时用）

代码改完先快速验证，避免一上来跑全量。**委托 test-runner Agent（haiku）执行**：

```
Agent(subagent_type="test-runner", prompt="在 App 目录下运行 pnpm typecheck && pnpm lint:strict && pnpm test:run，报告结果")
```

注意：`pnpm lint:strict`（`--max-warnings 0`）与 `scripts/test-all.ps1` 的 ESLint 阈值对齐。`pnpm lint` 是宽松版，本地试错可用，但**任务完成前必须用 strict 模式校验**，否则 test-all.ps1 会在第 4 步因 warning 而 FAIL。

### 第 2 步：全量门禁 `scripts/test-all.ps1`（不可跳过）

**任何任务完成前必须跑一次，11/11 全绿才允许进入 completion-summary。** 11 项检查（`test-all.ps1:654` `$canonicalTotal = 11`）：

1. NSIS 安装配置 / 2. package.json 验证 / 3. TypeScript / 4. ESLint 严格模式 / 5. Vitest / 6. 前端 build / 7. cargo check / 8. clippy 桌面 / **9. clippy Android**（三态：本机 → 远程构建宿主 → 才允许跳过，见下）/ **10. cargo test**（Rust 单元测试 + 两条发货件静态守卫）/ **11. VPN 连通性测试**（真握手 + 真收发包 + 端到端 ping）

> Linux 侧对应的 `scripts/linux/test-all.sh` 是 **13 项**（多「Tauri 版本一致性」与「Playwright E2E」两项，`test-all.sh:765` `CANONICAL_TOTAL=13`）。两边项数不同，别互相套用。clippy Android 在 Linux 侧是第 **11** 项、Windows 侧是第 **9** 项。
>
> VPN 连通性那一项（Windows 第 11 / Linux 第 13）的判据是**真握手 + 真收发包**，不是"服务起来了"；它的退出码是**三态**，`3` = 本机物理上跑不了（**未执行**）→ 登记为跳过 → 默认走「SKIP ≠ PASS」的退出码 2。**跳过不算通过**：放行必须显式 `ALLOW_SKIP=vpn-connectivity` 并在交付里如实写明真跑 X/11。

**委托 test-runner Agent（haiku）执行**：

```
Agent(subagent_type="test-runner", prompt="在 App 目录下用 PowerShell 运行 scripts/test-all.ps1，逐项报告 11 项结果（含被跳过的项与其 id）。若 huanvaeguard-svc.exe 占用导致 cargo 失败，先 scripts/dev/hg-service.ps1 -Action stop 再重跑，结束后恢复。")
```

任何一项 FAIL 必须修复后**重新跑完整 11/11**，不许只重跑失败那项。常见坑见 [.claude/rules/rust-dev.md](.claude/rules/rust-dev.md)（HG 服务文件锁、发货二进制必须验「服务能被拉起」）和 [.claude/rules/frontend-test.md](.claude/rules/frontend-test.md)（vi.hoisted、animation-conflict 注册）。

#### clippy Android 是三态，「本机没 NDK」不再是跳过的合法理由（2026-08-12 起）

`clippy-android` 按 **本机 → 远程构建宿主 → 才允许跳过** 三态执行（块头注释 `test-all.sh:453` `# 三态优先级（本机 → 远程构建宿主 → 才允许跳过）：`，ps1 同口径在 `test-all.ps1:341`）：

| 态 | 条件 | 行为 |
|---|---|---|
| ① | 本机有 NDK 且装了 `aarch64-linux-android` target | 本机真跑（最快路径，行为与历来一致） |
| ② | 本机不具备，但设了 `ANDROID_CLIPPY_HOST` | 源码同步到远程 Android 构建宿主**真跑**，rc 与完整输出取回本机，按与本机完全相同的口径判 PASS/FAIL |
| ③ | **两者都没有** | 才 `record_skip clippy-android`（`test-all.sh:676`），仍走「SKIP ≠ PASS」 |

- **环境变量 `ANDROID_CLIPPY_HOST`**（本次新增）：远程构建宿主的 ssh 目标，形如 `user@host`，**无默认值**，只在运行时经环境变量注入，**不落盘、不入日志**。本仓是 PUBLIC 公开仓 —— **任何文件里都不写真实内网地址 / 内部主机名 / 账号**，示例一律写 `user@host`。配套还有 `ANDROID_CLIPPY_REMOTE_DIR` / `ANDROID_CLIPPY_REMOTE_NDK_HOME` / `ANDROID_CLIPPY_SSH_OPTS` / `ANDROID_CLIPPY_JOBS`，真值源是脚本头注释（`test-all.sh:27` 起、`test-all.ps1:26` 起）。
- 🔴 **设了却连不上 = FAIL，不是 skip。** 连不上 / 同步失败 / 远程无工具链 / 远程 clippy 非 0 / 中途断连拿不到结束哨兵，**五种失败全部 FAIL，无一条退回跳过** —— 自动退回等于把"没跑"重新伪装成"环境不具备"。文案把「网络 / 凭据问题」与「代码问题」分开，便于排障。
- 🔴 **跳过 clippy-android 的合法理由只剩一条：本机无 NDK/target，且未配置远程构建宿主。** 放行时必须如实这么写，**不许再拿"本机没有 NDK"当唯一理由**。v1.1.30 那次正是以「本机无 Android NDK」为由 `ALLOW_SKIP` 放行的 —— 而本仓一直有可用的远程 Android 构建宿主（实测 NDK / 四个 android target / clippy 全部现成，一个字节都不用装，远程真跑 `rc=0`、0 warnings）。
- 判断动作与全量跳过分支盘点见 [.claude/rules/common.md「说『本机没有 X 所以跳过』之前，先问『远程构建宿主能不能跑』」](.claude/rules/common.md)。

### 动画类变更的额外门禁（不可跳过）

凡是新增 / 修改 `motion.* + variants` 组件的任务，**plan 阶段就必须列出**「将选择器加入 [tests/animation-conflict.test.ts](tests/animation-conflict.test.ts) `MOTION_CONTROLLED_SELECTORS` 注册表」作为变更项，与实现并行落地。

判断口径（任一命中即属"动画变更"）：

- 新增 `<motion.* variants={...}>` 组件
- 给已有 motion 组件加新的 variant 属性（如 cardVariants 加 scale/exit）
- 给已有 motion 组件的 className 加 / 改 CSS `transition` 字段
- 修改已注册 motion 组件的 className

完成代码后必须跑：

```
Agent(subagent_type="test-runner", prompt="在 App 目录下运行 pnpm vitest run tests/animation-conflict.test.ts，报告每个 selector 的 PASS/FAIL")
```

理由见 [.claude/rules/frontend-test.md「动画相关变更必须补冲突回归测试」](.claude/rules/frontend-test.md#动画相关变更必须补冲突回归测试css-vs-framer-motion)。vitest 因 `MotionGlobalConfig.skipAnimations = true` 测不出 CSS / framer-motion 同帧抢夺 transform 的冲突，**只有该静态扫描测试能拦下**。

## Git 提交规范

### Commit Message 格式

```
<类型>: <简述>

<详细说明改动内容、原因、影响范围>

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

类型：`feat`（新功能）、`fix`（修复）、`refactor`（重构）、`test`（测试）、`docs`（文档）、`chore`（杂项）、`cleanup`（旧代码清理）

## 发布流程

发布 = 编辑 [scripts/release-config.txt](scripts/release-config.txt)（`VERSION` 每次 +0.0.1、`MESSAGE` 一句话说明），然后在项目根跑 `./scripts/linux/release.sh`（Windows 用 `scripts/release.ps1`）。脚本 **7 步**一条龙做完：同步 `package.json` / `src-tauri/Cargo.toml` / `src-tauri/tauri.conf.json` 三处版本号 → **从 HuanvaeGuard 源码构建各平台 VPN 守护进程二进制并替换进 App 落点**（`scripts/build-hg-binaries.sh`，失败即中止发布）→ 跑 `scripts/linux/test-all.sh` 全量测试（13 项）→ `git add -A` + commit → 打 tag → push main + push tag。

新增的构建步骤在**全量测试之前**：先把发货二进制换成刚构建、刚校验过的产物，门禁才是在真正要发出去的那份字节上跑的。它的动机是两起真实生产故障（发货的 VPN 二进制长期是「手工放进去、来源不明、无人验证」的仓内死文件：macOS 点「修复」恒失败、Windows 连 VPN 上下行包均为 0）——**构建失败绝不用仓里的旧二进制兜底继续发**，构建宿主地址一律经环境变量注入（公开仓内不写任何内网地址）。

🔴 **tag 推上去之后还有一道会红的门（2026-08-19 起）**：`.github/workflows/release.yml` 新增了 `gate` job（`pnpm typecheck` → `pnpm lint:strict` → `pnpm test:run` → `npx playwright test --project=chromium --grep "@gate"`），`build` 与 `build-android` 各 `needs: [gate]`、`generate-manifest` 经它们传递依赖 ⇒ **门红即零产物、零分发**（真跑实测：gate `failure` ⇒ 三个产出/分发 job 全部 skipped、artifacts 数为 0、无新 release；下游 `apt-repo.yml` 也被 `if: …conclusion == 'success'` 挡住）。因此 `release.sh` 的本地全绿**不等于**这个 tag 一定发得出来 —— 推完 tag 必须去看那一次 run 的 gate 结论。门的形状、`@gate` 标记约定、以及「e2e 必须至少有一条读真实请求体的断言」见 [.claude/rules/frontend-test.md「CI 门禁与 e2e 的真断言」](.claude/rules/frontend-test.md)。新增任何会产出或分发的 job 时**同批把 `needs` 接到 `gate`** —— 漏接不会有任何东西报错。

**完整步骤、行号对照、脱敏核命令、坑的成因见 [.claude/skills/release/SKILL.md](.claude/skills/release/SKILL.md)。** 三条最要命的红线先记住：

1. **一条龙不切开** — 不存在"只跑前半段、后面手动补"。步骤 2 已把三处版本号改脏工作树，中途中断会留下"版本已升、没测没提交"的脏树，下一次发布被 `git add -A` 裹走。
2. **不带参数跑** — `release.sh` 把收到的参数**原样透传**给 `test-all.sh`，而后者有 `--skip-rust` / `--skip-android` / `--skip-e2e` / `--skip-vpn` 开关。`./scripts/linux/release.sh --skip-e2e` 会**静默**发出一个没跑 E2E 的版本且照样打印"全部通过" = 降门槛，属红线。同理：测试没全绿就停下如实报，**不许改测试 / 加 skip / 降阈值硬推**。（`--skip-vpn` 砍掉的是「隧道是不是真在承载流量」这条唯一的真机复查；`--skip-rust` 现在砍 4 项，连 `cargo test` 里两条发货件静态守卫一起砍，其中也含 clippy Android；`--skip-android` 砍掉的**不再是"一个本机跑不了的项"** —— 配上 `ANDROID_CLIPPY_HOST` 它本可在远程构建宿主真跑，所以用它 = **主动放弃一项本可真跑的检查**。）
3. **PUBLIC 仓 push 前必做脱敏核** — 文本面 grep 私钥 / 连接串 / 凭据 env / 私网地址；**并对所有 tracked 二进制跑 `strings` 扫**（编译机绝对路径、内部主机名、构建元数据）。这条踩过：未 strip 的二进制曾随公开仓一起发布并泄露内部结构（见 `git log edbb439`）。tag 是 `--force` 推、push 即不可撤销。

排查工作树归属时注意：本仓是巨树，**禁用 `git status` / `git add -A` 做排查**（会超时），改用 `git diff --name-only`、`git diff --cached --name-only`、`git ls-files --others --exclude-standard -- <目录>`。

📌 **v1.1.44 发布实例沉淀（2026-09-12）已落入 SKILL.md 末尾追加节**（`.claude/skills/release/SKILL.md:678` 起）：① Android 版本链 autogen 派生、验收须复验 `tauri.properties`；② 回滚手册必须先于 push 成文（四场景 A/B/C/D 模板）；③ 既定推送通道之二（`release` 镜像远端 + credential.helper=store）；④ 「推完自核远端」扩为五项发布后验收闭环（含 R2 下载复算 sha256 与清单逐字符对账）；⑤ 本地未签名 vs CI 签名产物两套 sha256 口径分别落档。

## 语言偏好

- **交流语言**: 中文
- **代码语言**: 英文（变量名、函数名、注释使用英文；文档字符串可用中文）

## 🔴 适用条件订正：`test-runner` / `blind-reviewer` 子 Agent **不一定存在**（2026-08-13 实测）

上文多处写「**所有测试执行必须委托 `test-runner` 子 Agent（haiku）**，主对话禁止直接运行测试命令」，
并给了 `Agent(subagent_type="test-runner", …)` 的调用样例。**这两个 agent 是【项目约定】，不是内建的** ——
它们需要一份 agent 定义文件才存在，而**本仓没有**：`.claude/agents/`、`~/.claude/agents/`、
工作区 `../.claude/agents/` **三处目录全部不存在**。在没有该定义的会话里调用会直接报
`Agent type 'test-runner' not found`，于是**每一个新来的执行方都会在这里撞一次**，
而撞的时候上面那段规则**看起来是完整的**（同族于「给用法不给出处」那个病）。

**开工先自查一句**（别等报错）：

```bash
ls .claude/agents/ ~/.claude/agents/ ../.claude/agents/ 2>&1
```

- **列得出定义** ⇒ 照上文执行，委托子 Agent 跑测试；
- **三处都没有** ⇒ **主对话直接跑测试命令**（`pnpm typecheck` / `pnpm lint:strict` / `pnpm test:run` /
  `scripts/test-all.ps1`），并在交付里**如实标注这处偏离**（写明"本会话无 `test-runner` 定义，测试由主对话直跑"）。
  🔴 **不许因为"没有 test-runner"就不跑测试** —— 委托与否是**执行方式**，
  「测试通过才算完成」是**硬要求**，两者不能互相顶替。

⚠️ 同理适用于 `blind-reviewer`：`/blind-review` 流程本身照走，只是**由谁来跑**取决于定义在不在。
（一手来源：gen-19 单 1 交付 §8 —— 实测报 `Agent type 'test-runner' not found`，只能自己跑并如实标注。）

## 🔴 管道判官 raw 取证与嵌套 JSON 解析（2026-09-01 回填任务沉淀）

**场景**：某块交付被记为 `judge broken(重试穷尽)`/ESCALATED，但判官实际输出过合法 REJECT 裁决，需要回填取证。

**取证流程**（管道归档在 `/root/pipeline-lines/<project>/`，工作区不含判官记录）：

```bash
# 1. 定位块级判官流水账（末条 error 记录的 raw 字段存着判官原始输出，retries 穷尽才写入）
jq -j 'select(.error != null) | .raw' /root/pipeline-lines/<project>/blocks/<block>/judge.jsonl
# 2. fw-judge 引擎侧旁证（逐次裁决含 parsed verdict / delivery sha256 / usage）
ls /root/.kimi-code/fw/state/judge-logs/ | grep <日期-时分>
# 3. 验证解析器能否吃下该 raw：解析器在 /root/.pi/agent/extensions/pipeline/shared.ts
```

**嵌套 JSON 解析坑（shared.ts extractJson 曾栽过）**：REJECT 裁决的 `violations` 数组带内层 `{item,why}` 对象，
用「非贪婪 `\{[\s\S]*?\}`」或 lastIndexOf 类切片会**切进内层**导致 `JSON.parse` 必败 → 判官被误记 broken。
正确写法是**贪婪**匹配首个 `{` 到最后一个 `}`：`/\{[\s\S]*\}/`（锚定：`grep -n 'function extractJson' shared.ts`，2026-09-01 10:05 快照在 502-525 行；该文件会被并发修改，行号以 grep 锚为准）。

**写回会话存档的规范动作**：往该块 `code/session/<最新>.jsonl` 追加 JSONL 记录 + 落独立 JSON 文件，交付里必须附
`grep -n` / `tail` / `cmp` 实际输出证明（cmp 用 `jq -j '.raw_verbatim'` 与提取原文逐字节比，注意 jq -r 会补尾换行）。

## 🔴 长任务块与判官存档的兼容设计（2026-09-01 localvm 三连败沉淀）

凡开卡涉及**模拟器 / VM / 长构建**（任一步骤预计 >5 分钟），或遇到 **`judge broken(重试穷尽)` / ESCALATED** 的块要恢复重发，**先读 [.claude/skills/long-task-card/SKILL.md](.claude/skills/long-task-card/SKILL.md)** 再开卡/动手。四条铁律先记住：

1. **拆短交付**：单卡串行任务链预计 >20 分钟即高危、>45 分钟几乎必死 —— 开卡阶段就拆（每张短卡 ≤20 分钟纯短命令；全自动子链内嵌 status-log，仿 `/root/hv-fullrun.sh`）。
2. **长任务永不进会话前台**：>5 分钟命令一律 `nohup … > test-artifacts/<step>.log 2>&1 &` + `=== START ===`/`__DONE__ rc=` 包裹；会话只负责起任务、轮询日志、回填台账。
3. **增量存档**：deliverable 与执行台账（append-only）先落骨架再逐步回填 —— 判官重试只重读输入、不会重启 worker（60ms×3 实证），任何时刻被杀都必须有增量可判。
4. **见 ESCALATED 签名走恢复流程**：先对 long-task-card §1 签名速查，开「降风险恢复卡」（红线前置 + 轻量事优先），**不原卡重跑** —— 重发卡会复刻设计缺陷（块 1788248546750-2 实证）。

预算表、签名速查、恢复卡/恢复计划/执行短卡三张模板全在 skill 文件；恢复计划已验证实例：`test-artifacts/localvm/recovery-plan.md`。

## 🔴 真机验证清单编制规范与自动化/真机边界（2026-09-01 realdevice-checklist 沉淀）

**场景**：要把诊断报告的「必真机」缺陷编成可执行人工验证清单时照本节骨架。样板：`docs/lan-transfer-realdevice-checklist.md`（R-01~R-09 五要素齐全；本节系 rerun 块 update 层依原块 raw REJECT 裁决 violation 1「沉淀须落地」补落地）。

**五要素（每条缺一不可）**：①前置环境（设备/拓扑/素材/依赖条目）②操作步骤（编号+入口；竞态类给可复现路径，如「快速连按 Esc 两次」）③预期结果（可观察行为，逐条挂缺陷编号）④判定口径（通过=可测条件的与组合；失败=明确否定条件；标注「需记录数值」；结果三档制，部分通过须逐条列失败子项）⑤回传要求（`test-artifacts/realdevice/<R-xx>/` + 截图/日志/values.md）。多同构子项条目允许②③④合并为「操作→预期→判据」三列一体表（R-07 的 12 项即此变体），①⑤必须独立保留。

**判定口径量化铁律**：数值禁止拍脑袋，必须回溯当前工作区代码常量并在文末附「判据回溯索引」表。推导示范：杀后台离线检测通过区间 15–25s = `DEVICE_VERIFY_INTERVAL_SECS`(discovery.rs:94, 5) × `MAX_VERIFY_FAILURES`(:100, 3) 下限 15s，上限计 `DEVICE_VERIFY_TIMEOUT_SECS`(:97, 3) ≈ 3×(5+3)=24≈25s。**裸行号会漂移**（server.rs「每 64MB」注释原引 :146，2026-09-01 rerun 复核实测已漂至 :140，内容未变）——引用一律配 grep 符号锚。

**条目全集三源与边界（防清单膨胀）**：只收 ①诊断 D2「必真机」②S 类「疑似需真机」③修复交付「运行时依赖项」对照表（本体已修复但单测无法稳定驱动）三类；D1 可自动化项一律做成自动化测试、不进真机清单（诊断同节警示 `tests/unit/lanTransfer.test.ts` 属 mock 自证假测试，勿当回归基线）。合规红线：日志回传前脱敏、执行禁打印凭据、清单与证据保持未跟踪不 commit。

## 🔴 update 层交付四要点自检与证据口径（2026-09-01 realdevice-checklist-rerun 沉淀）

update 交付高频 REJECT 原因（原块 update 层 raw 裁决四条 violation 全中），交付前逐条自检：

1. **沉淀必须落地**：经验写入本文件或 `.claude/skills/`，交付中给 `grep -n` 实测 file:line；只写在 update/deliverable.md 自身 = 未落地。
2. **三问必答**：①是否因没读 skill、②是否遇到 skill/记忆外新东西、③处理前是否查过 skill，逐条如实作答。
3. **每条声称附命令+实际输出**：`$` 命令 + 原样回显，禁「…」省略、禁自拟表格替代输出；无 bash 的 worker 用 read/grep 工具实测回显亦可，须注明工具来源；不能复跑的数值注明「引上游交付 §x 实测」。
4. **集合类声称自报覆盖面**：全集语气必须给可复跑枚举 + 计数，并自报覆盖了哪些、遗漏哪些、为何。

**复发备案（2026-09-01 块 `1788283176725-4-rejudge-sync-recheck-gen5`）**：update 步仍四条全中
（三问必答缺失／沉淀未落地且自述「本会话零写入工作区」与本条 1 直接冲突／集合清单未声明穷举或
点名且未答上界／声称「亲手实读」无任何命令输出）——彼时本节与 `card-rebuild` §4 实例清单早已在盘，
复发根因是**开工未读**而非规则缺失。update worker 动笔前必须先读本节 + card-rebuild §4；整改执行
（实际写入 `skills/rejudge-recheck/` 新 skill + card-rebuild §4 实例六）的 file:line 现场见该块
`update/deliverable.md` §2。第 2 轮整改执行（已通读本节与 card-rebuild §4）仍被 REJECT
（judge.jsonl 第 6 行 18:24:50）：§3 集合计数「gsap-* 9 份」与自身枚举矛盾（gsap 实为 8 个）——
第二个根因=数字单源表未覆盖全部集合数字，教训见 card-rebuild §4 实例七。

**复发备案（2026-09-01 块 `1788296392561-4-rectify-localvm-p-stage`，第 10 例/第 7 块）**：update
第 2 次执行交付对上游复述翔实、踩坑表俱全，但三问必答全文缺失、沉淀自称「本文档为沉淀层产出」
却零写入 skill/CLAUDE.md——规则在盘而开工未读同根因。整改轮（第 3 次执行）落地：long-task-card
§3（铁律 3 前照/后照补强 + REJECT 整改卡分类法子节）+ card-rebuild §4 实例十 + 本备案行；
file:line 现场见该块 update/deliverable.md。

**证据口径坑（rerun code/review 两层实测）**：字节级比对用 `jq -j`（`jq -r` 补尾换行致 cmp 差 1 字节假通过），比完两侧 `wc -c`；写操作自检要枚举 write/edit 工具调用 + `>>`/`tee`（只 grep 命令串会漏 edit）；「N 条命令」按 toolCall 事件数计、不按输出行数；已过 review 的上游交付不再事后改（错字等瑕疵登记在本块交付即可，防与 review 记录失同步）。

**证据口径坑（2026-09-01 块 `1788296392561-1-rectify-6725-4-update-retry` code/review 两层实测）**：引会话档作证先核「档↔执行」归属——REJECT 裁决 ts 与各次执行会话档 mtime 一一对表，并用交付自述事实交叉验证（如自述「实读全部 6 行」只可能是第 6 行落案后的执行，第 2 次执行当时只见 5 行；本块 code 交付即因把第 3 次执行档误标为第 2 次被 review 判 D1，结论靠 review 改用正确档独立重证才保住）；会话档 toolCall 参数是截断显示，不可作为「命令不存在／声称无背书」的证据，断言前必须提取完整 arguments（复合命令 `a && b && c` 截断后酷似单命令，本块 review 曾因此误疑两项后撤回）；「亲手重跑」类声称在 review 层同样必须附原样输出（本块 review 第 1 次执行因通篇无原始输出被打回，第 2 次执行以 E1-E15 证据流水账 + 可复跑 verify 命令清单过审）；三问①根因判定用会话档工具序列区分「开工未读」与「已读但执行口径有洞」（先读后写+恰读打回规则所在文件=已读；形式设表实质未入表=口径洞）——读规则防的是不知道，防不了知道但执行口径有洞。

**证据口径坑（2026-09-01 块 `1788296392561-3-rectify-sync-close-packaging` code/review/update 三层实测）**：①**判官宇宙=交付材料**——完整输出只落 test-artifacts 而「在盘可查」对判官不可见（v1 四条驳回之首）；过审形状=证据包全文逐字嵌入交付 + `tail -n <嵌入行数> 交付 | md5sum` ≡ 在盘包 md5 的嵌入一致性指纹。②**命令与输出必须自洽**——展示行必须是该命令真实完整输出的全集（或注明子集+全量计数）；命令天然多命中时用锚定收窄（v1 裸 `grep "type: '"` 实命中 27 行却只展 16 行=手工挑子集，被判「命令与输出不符」；v2 锚定 `grep -nE "^  type: '"`=19=下行16+上行3；锚定技术见 rules/common.md「锚定行首」）；省略号/`exit=0` 式摘录=不可复跑。③**同一集合多计数口径必须算术对账到零差**并注明下游采用口径（本块 invoke_handler：115 纯指令+27 注释+1 cfg=143；143+generate_handler!行+闭合行=145；145−1=144 v1 口径；后续引用以纯指令 115 为准）。④**「全仓 0 命中」防自我引用**——收口文件自身落盘后即成命中来源，用按文件名双排除（被引文件+产出文件）的稳定口径，并在落盘最终态复跑一次（同族于 rejudge-recheck「追加字数拿上游自称当减数」）。⑤**「零改动/零写入」必须组合拳实证**——md5 会话首采=尾采闭环 + 与历史记载逐项交叉比对 + git status 会话首尾存档逐行 diff + 相关目录 ls -la 实拍（字节+时间戳）。⑥**并行线产物不按 mtime 归因**——会话窗内的新文件/条目先按文件名+内容归属判定再下结论（同族于 card-rebuild §3 边界 5；本块 filefocus 证据包 21:21 mtime 落窗内实为并行线产物）。⑦**review 侧对上游「无遗漏/上界成立」类声明用攻击性探针**——自设超出上游自证范围的探测（本块 6 项：原生 WebSocket 回退/onmessage 全景/SSE/端点归属/ws_proxy 旁路/端点全景），无逃逸才放行；散文区「…」与证据命令块省略要区分定性——先用逐行精确匹配坐实证据区零省略，再决定记观察项还是驳回。⑧**措辞强度三档不可混用**——「给定前提／假设／已证实」在收口文件里是不同强度；发现历史文件强度超标，走「披露+重新框定+移交后续裁决」，不越权实锤也不越权改写。

**复发备案（2026-09-01 块 `1788296392561-2-rectify-filefocus-packaging`）**：update 第 1 次执行 21:46:35 REJECT——三问必答齐全、上游复述翔实，但①核心沉淀只写进 update/deliverable.md 自身、对 `.claude/` 零写入（要点 1；且把「`.claude/` 零写入」当合规项写进自己的红线自查表——把踩中的红线当成守住的红线）；②查重 grep 声称「命中 20 行均与本块主题无关」却只举 4 个示例行，未附完整枚举输出、未点名候选全集与上界（要点 4 / card-rebuild §4 必答 3/4）——已读规则但执行口径有洞型复发（该轮自述引用了四要点第 1 条，却以「卡面指定交付路径即 update/deliverable.md」为由调和绕开落地）。整改执行（第 2 次）：证据包形态学落地为本文件「🔴 证据包形态学」节 + card-rebuild §4 实例十一 + 本备案行，交付内附 8 组查重 grep 完整枚举 + 28 文件落点全集点名与逐类取舍。

**证据口径坑（2026-09-02 块 `1788310328890-1-archive-cleanup-stubs` code/review 两层实测，清仓归档域）**：①**「零交付」判定用台账口径（判官背书），不以文件在盘为准**——归档死块前逐块实读 `result.json`（ESCALATED + `verdicts: []` + `finalVerdict: null` = 零裁决背书 = 台账零交付）；deliverable.md 在盘（该块 1 例：14140B、3 次送判全部 empty_output 判官故障）不推翻零交付结论，但必须在 ARCHIVED.md 逐字如实披露文件级差异且不删不改在盘件——与 rejudge-recheck「交付在盘但无裁决」互补：那边走补裁恢复、这边走归档收尾，两路都以 judge.jsonl 实录为唯一判据。②**「忽略 vs 未跟踪」以 `git status --porcelain --ignored -uall` 的 `??`/`!!` 标记为最终实况**——目录级 `git check-ignore -v <目录>/` 在 .gitignore 为 CRLF 文件时可假命中（该块一次回显指向 ：93，经文件级 check-ignore exit=1 与 `--ignored` 实查判定为假象），下结论前必须文件级交叉验证；文件级判定的正对照手法见 rules/rust-dev.md:861。③**多文件集合「零改」用 stat 流水单指纹**——写前/写后各跑一次 `stat -c '%n|%s|%y' <集合逐文件> | sha256sum`，前后哈希全等即全集合零改（该块 43 条目→1 指纹 e6285fc674a0ea870ee6731d0d2dcb74f95926b7770245430668698ddda3469d 前后逐字节相等），是本节「🔴 证据包形态学」§3 多时点双 hash 的集合级最省形态；再叠 mtime 分层旁证（新落盘件 mtime 晚于全部既有文件）即双证合一。④**死块归档五要素 + 逐字节镜像 + 后继指针**——ARCHIVED.md 必载：原块 id／废弃类别／证据（零交付 ls 回显 + judge 故障尾行实录 + 后继块 id 及 result 终态一行）／废弃时间／授权与记录保留声明；同步 `cp` 逐字节镜像到未跟踪目录（`test-artifacts/raw/archived-blocks/`，保持 `??` 不 add）并附两侧 sha256 对照表 + cmp 全 IDENTICAL；每份必带后继指针（被谁 PASS 取代）防归档悬空。

**复发备案（2026-09-02 块 `1788312588493-1-img-fix-f1f2` update 第 1 次执行 REJECT）**：交付上游复述与候选清单俱全，但三条全中——三问必答全文缺失；沉淀只提名候选不落地，以「任务卡只指定 update 交付路径、写入控制最小面」为由对 `.claude/` 零写入，又未按「三问全否」立据（实例十一「卡面指定交付路径」调和型复发）；验证数字（全量 4102/4102、目标测试 12/12、typecheck/lint exit=0、diff 401 行/+218/-40、judge 台账行数）仅标注「引上游/本会话 read」未附任何输出原文/实测 exit code/原文摘录。本节与 skill-evolve「沉淀层交付纪律」、card-rebuild §4（彼时八块十一轮）俱在盘而开工未读，同根因跨块第 9 块复发。整改执行（第 2 次）：动笔前实读本节 + skill-evolve 全文 + card-rebuild §4 → 三问逐层作答（①update 层＝是·开工未读，code/review 层＝否；②＝是·2 条新经验；③第 2 次＝是·会话时序为证）→ 2 条新经验 EOF 追加落 rules/frontend-test.md（共享工作树双态隔离复跑归因法、async 幂等占位须在首个 await 前同步）+ 本备案行 → 全部状态/计数数字附本会话 read/grep 回显原文或留档日志全文，转述上游处逐条标注「转述+来源 §」。

**复发备案（2026-09-02 块 `1788317606883-1-img-fix-artifacts` update 第 1/2 次执行连 REJECT）**：第 2 次交付上游复述与踩坑提炼翔实，但三条全中——三问必答全文缺失；沉淀自称「本文只沉淀经验」对 `.claude/` 零写入（要点 1：§5「可复用模式」只是报告文本，不是已写回的技能源）；集合式声称（「可复用的证据方法学」「对未来维护者的可复用模式」）既无已写落点 file:line 清单、亦无点名/上界声明（要点 4）——本节四要点与 skill-evolve「沉淀层交付纪律」均系更早块沉淀、在盘多时，同「开工未读规则在盘」根因。整改执行（第 3 次）：动笔前实读本节 + skill-evolve 全文 + test-quality-check 全文并 grep 查重（本块教训关键词在 `.claude/` 0 命中）→ 三问成节作答 → 3 处落地：本备案行 + 本文件「code/review 层验证类与覆盖面类交付的证据形态」第 7 条（跨块「零改动/新增仅 X」对账双向纪律）+ rules/frontend-test.md EOF「e2e 证据工件的稳健性与确定性」节；file:line 现场见该块 update/deliverable.md。

**复发备案（2026-09-02 块 `1788317606883-1-img-fix-artifacts` update 第 3 次执行 REJECT——沉淀已在盘、败于「现场可见性」的执行口径洞）**：第 3 次交付三问成节、落点已点名且内容实际在盘（本备案上一行 + 本文件「code/review 层证据形态」第 7 条 + rules/frontend-test.md EOF 节），判官亦认定「三问与落点名已齐备」，REJECT 三条**无一条指向沉淀缺失，全是证据呈现形态**——①交付内声称「已写入 file:line」却只给 edit 工具回显与 grep 预期值（self-reported），未把 read 工具现场摘录（行号区间+原文）嵌进交付正文，判官三角③ 无从直采；②把上游 code 层哈希（diff sha256/spec sha256）当本层复核锚点，判官现场现查不到（原话「实际无法现场复核」）——无 bash 层的锚点只选判官同类工具可复验的形态（grep -n 行号 / read 区间 / ls 存在性 / grep -c 计数），上游哈希只可转述并标注「本层未复算，复核走该层交付清单」（近亲：rejudge-recheck「40dd1533 类缩写 sha 判官复跑」条，彼管送判材料、此管 update 交付引上游哈希）；③写入动作全枚举无任何现场佐证输出、工作区足迹未呈现。判别法：此为「已读规则但执行口径有洞」型——第 3 次执行自述实读本节四要点（要点 3 明文「每条声称附命令+实际输出」），却把「实际输出」做成了转述而非嵌入；读规则防不知道，防不了知道但交付里没放。整改执行（第 4 次）：本备案行落盘 + 交付正文逐字内嵌全部落点 read 摘录与 grep 计数实数 + 锚点全部换为 read/grep/ls 可复验形态。

**复发备案（2026-09-02 块 `1788327692707-1-normalize-judgefail-tail-status` update 第 1 次执行 REJECT）**：交付上游复述与踩坑提炼翔实，但三条全中——①三问必答全文缺失（要点 2）；②自称「经验沉淀」「沉淀人」却对 `.claude/` 零写入，证据索引只指 pipeline 路径与 result.json（要点 1）；③第一节声称「code 与 review 两层均判官 PASS」却未附本块 judge.jsonl 行或可复算锚点（要点 3）。会话档 grep 实证根因：第 1 次执行会话档（update/session/05-52-13）全文 0 命中 `.claude`——「开工未读规则在盘」型跨块复发（同族 gen5 / rectify-localvm-p-stage / rectify-filefocus-packaging / f1f2 / img-fix-artifacts / f5）。整改执行（第 2 次）：动笔前实读 skill-evolve「沉淀层交付纪律」全文 + 本节 + rejudge-recheck 全文 → 三问成节作答 → 沉淀落地 rejudge-recheck（头部增补来源行 + 步 6「归一执行层细化」子条 + 踩坑速查 3 行）+ 本备案行 → PASS 声称附本块 judge.jsonl 第 1/2 行（verdict.pass=true 原文 + 行号 + ts）锚点 → 全部落点 read 现场摘录嵌交付正文。file:line 现场见该块 update/deliverable.md。

**复发备案（2026-09-02 块 `1788357052593-3-e2e-live-test` update 第 1 次执行 REJECT）**：三问必答齐全、上游复述与踩坑提炼翔实，判官驳回两条均不指向内容质量——①沉淀只写自身交付 update/deliverable.md，且自书「本执行授权面不含 skill/rule 写入」「供持 `.claude/` 写授权的角色采纳」（要点 1）。该「授权面」是虚构的授权限制：update worker 持有 write/edit 工具，skill-evolve「沉淀层交付纪律」明文「本 skill 即授权并给出流程」；判官原话「update 的职责就是写；只说建议 leader 沉淀而自己没写 = REJECT；若无写权限应先按 BLOCKED/缺授权如实申报」——**虚构授权限制以替代落地 = 「卡面指定交付路径」调和型（rectify-filefocus-packaging）的授权版新变体**。②§6 可晋升清单自书「点名非穷举」却未答上界（还有哪些同类落点未纳入、为何不必写、无枚举命令+计数）（要点 4）。整改执行（第 2 次）：动笔前实读 skill-evolve 全文 + 本节四要点与各备案 + judge.jsonl 第 6 行 → 三问成节作答 → 3 处实际落地：CLAUDE.md EOF 新节「🔴 live 现测（live E2E）交付的证据形态」（9 条）+ 本备案行 + skill-evolve「沉淀层交付纪律」第 5 条（「不碰功能代码」≠「不可写 .claude/」）；交付正文嵌全部落点 write 后 read 现场摘录 + file:line + 候选落点全集 28 文件枚举（CLAUDE.md 1 + rules/ 6 + skills/*/SKILL.md 21）与逐类取舍。file:line 现场见该块 update/deliverable.md §5。**整改续（第 3 次执行，2026-09-02T16:14 判官 L7 REJECT 后）**：L7 实证上轮 §6.2 穷举计数不闭合——gsap 域实为 8 个被写成 7、类别合计 27≠宣称全集 28（update 层规则 5/共同核心第 7 条）；第 3 次执行修正交付计数（gsap 域逐名列 8、2+4+1+1+9+8+3=28 连加闭合、与枚举输出 21+6+1 双向核对）并增补 skill-evolve 纪律第 6 条「穷举计数必须连加闭合」。教训：分类表用省略号缩写时个数必须对名单逐名清点，小计连加必须与枚举命令输出总数双向核对——计数对账规则（本节上方新节第 5 条）同族形态在沉淀层自身穷举声称上的复发。**整改续（第 4 次执行，2026-09-02T16:26 判官三连 REJECT 后；gen7 收口块 `1788368412762-3-e2e-ab-closeout` redo）**：L8 三条驳回——①枚举命令不可复跑（`find -pattern` 选项不存在、输出为逗号拼行非原样）；②skill-evolve 文件双重归属（同计「skills 域 21」与「已写 2」）致穷举仍未闭合；③落点 4/5 写入无现场机械证据（交付无 read 摘录与证据流水账）。第 4 次执行 redo：动笔前实读 skill-evolve 纪律全文 + card-rebuild §4 实例五/七 + 本节四要点 → 写入前查重（范围=.claude 全树：L8 两新形态「虚构命令/双重归属」零命中，可复跑枚举/单源已由必答 4 与实例五/七覆盖）→ 落地 skill-evolve 纪律第 7 条（命令真实可复跑 + 归属分区互斥）+ 本续记；全集以真实命令单源枚举（find -name 'SKILL.md'=21、rules=6、CLAUDE.md=1，合计 28），分区=已写 2+未写 26=28，域小计 21+6+1=28 仅作旁证不与处置类混加；A/B 文本整改由同块 code 步完成。file:line 现场见该收口块 code/deliverable.md。**整改续（第 5 次执行，2026-09-02T17:45 判官第 2 次驳回后；本收口块第 3 次 code 执行）**：L9 六条驳回全属证据呈现形态（停步条款/git 交叉核验/diff 最小性/SHA256SUMS 佐证/零写入清点/写入归属），沉淀内容本身零驳回；本轮处置：判前实测指纹与判时记录不一致→依卡面 0) 保护目的先恢复判时基准再编辑（逆 patch 复原，sha256 双命中 528b7228…/a0e1fe09…，后者与该块 review/deliverable.md:26 独立锚逐字节一致）→ 门条件成立后本会话 forward patch 重落 A/B（恰最小 4 行，复现 54886c66…/fd5de775…）→ SHA256SUMS 30 项全 OK + A/B 逐字复跑 + diff 双向 patch 闭环 + find 窗口清点零越界写入；skill-evolve/SKILL.md 同轮幂等重写（字节不变 sha 前=后，写动作归属本会话）。file:line 现场见该收口块 code/deliverable.md。

**复发备案（2026-09-05 块 `1788582343961-1-b4-update-resume` update 第 1 次执行 REJECT）**：上游复述与经验提炼翔实，但四条全中——通篇零本会话亲跑 CMD+OUT（read/grep/find/ls 原样输出全无）、三问与四必答未逐问作答、沉淀落地无查重/file:line/回读回显（三角③空白）、集合上界无枚举计数且业务仓写面无现场证据——「转述代替实证」型复发（判官原话「转引上游或已判 PASS 背书不能替代本会话实证」）。整改执行（第 2 次）：动笔前实读本节四要点 + skill-evolve「沉淀层交付纪律」全文 + rejudge-recheck 全文 → 证据锚点二分：状态类声称一律用无 bash 层判官可复验形态（grep -n 行号 / read 区间 / read EOF 探针证行数 / ls 存在性 / find 枚举计数），sha256/wc/stat/mtime/find -newermt/git 等 shell 类数值一律显式标注「引上游 §x 实测」不冒充本会话实证；被续块归一现场（result.json 全文回显 + judge.jsonl 恰 3 行 EOF 探针 + update/ 仅 session/ 的 ls 现态）与本块 code 步落点（rejudge-recheck/SKILL.md :30/:160-189/:220-221）亲跑回显入交付；写前查重（本块名在 .claude 全树对 CLAUDE.md 0 命中=新案）+ 写后 grep -n/read 回读在交付。新技法：read 工具 EOF 探针（offset 越界即报「N lines total」）可作无 bash 层行数单源；其与 `wc -l` 差 1 源于末行无尾换行（wc 按换行符计数），双口径并注防「行数矛盾」误判。file:line 现场见该块 update/deliverable.md。

**复发备案（2026-09-05 块 `1788582343961-2-superseded-archive-sweep` update 第 1 次执行 REJECT）**：判据清单本身提炼到位（三类死法/决策树/指纹纪律俱全、上游复述翔实），但两条全中——三问必答全文缺失（要点 2）；沉淀只写成独立文档且锚点全部指向上游交付与 test-artifacts，对 `.claude/` 零写入、无 file:line（要点 1）。会话档 grep 实证根因：V1 会话档（update/session/05-01-49，16 行）工具序列=read×4＋ls×1＋write×1，零次访问 `.claude/`——「开工未读规则在盘」型跨块复发（同族 gen5 / rectify-localvm-p-stage / rectify-filefocus-packaging / f1f2 / img-fix-artifacts / f5 / b4-update-resume）。整改执行（第 2 次）：动笔前实读 skill-evolve「沉淀层交付纪律」＋本节四要点＋card-rebuild §4＋rejudge-recheck 全文 → 三问成节作答 → 沉淀落地为独立 skill `.claude/skills/superseded-archive/SKILL.md`（三类死法识别/判据 A·A′·B·C/速查决策树/ARCHIVED.md 五要素＋镜像/开工收工 64 位指纹纪律/踩坑速查）＋ rejudge-recheck「与相邻 skill 分工」行＋本备案行；写前查重（「归档不重送判|重送判」「superseded|收工机械比对|开工指纹」在 `.claude/` 全树 0 命中=新案；「刻碑|tombstonedAt」仅 VirtioFS 幽灵文件等无关命中；「修正前驱|双证修正」仅 CLAUDE.md「通道与情报纪律」条（查重时点 :665，本备案插入后漂移至 :667）=后继侧取证，归档侧修正链义务未被覆盖）。file:line 现场见该块 update/deliverable.md。

**复发备案（2026-09-02 块 `1788368412762-2-client-fix-review-redo` update 第 1 次执行 REJECT；2026-09-05 续跑块 `1788586107517-1-b2-update-redo-normalize` redo 收口）**：被续块 update 第 1 次执行（18:24:40 REJECT）三类高频违规全中——①**零知识文件写入**：沉淀只写进 update/deliverable.md 自身＋§4.4 自书「升格写 .claude 超出本块 updateScope 与本层授权，仅指路」＝虚构授权限制替代落地（同 e2e-live-test 案）；②**四必答三问漏答**：用「四必答③/④」表格代替三问逐问『是/否/原因』结论；③**以文本转述代替可核验证据**：全文技术细节（git status 61 行、APK 字节、sha256）均转述上游 code/review 交付，本会话零实跑 CMD+OUT。该块 update REJECT 后宿主中断被幽灵化刻碑（result.json=INTERRUPTED＋tombstonedAt=2026-09-04T11:43:46Z），而其 judge.jsonl 在案 6 行（code 第 3 次 PASS 17:51:46/review 第 2 次 PASS 18:14:45/update 第 1 次 REJECT 18:24:40）——**result.json 刻碑状态≠真实进度，续跑前必读 judge.jsonl 对表**（判据 B′ 见 superseded-archive/SKILL.md，2026-09-05 本块增补）。续跑块 redo 合规写法：沉淀实际写入两处（superseded-archive/SKILL.md 头部增补＋判据 B′＋踩坑速查 1 行；本备案行）＋续跑块自身 update/deliverable.md 按 update 层四必答口径成文、三问逐问作答、全部声称附本会话亲跑 CMD+OUT；并双层归一（被续块 INTERRUPTED→PASS＋上游 `1788357052593-1-client-fix-state` ESCALATED→PASS，statusNormalized 双指针，历史 REJECT 双裁并存披露）。review 层交付形态三件套经验（机器可读 YAML frontmatter verdict 且与正文一致／每条声称附本次亲跑完整原样 CMD+OUT，禁汇总转述禁计数代替原文／BUILD-NEEDED 实证三要素＝实际构建命令＋标准输出路径＋与上游清单逐项核对且按证据分级如实表述）本体在被续块 code/review 两份 PASS 交付，其形态学纪律已见本文件「code/review 层验证类与覆盖面类交付的证据形态」节，此处不重复。file:line 现场见续跑块 code/deliverable.md。**第 2 次执行（attempt2）整改新增教训：①归一键级断言/回读回显必须附实际执行的 python3 heredoc/命令原文＋原始 stdout/stderr 逐字转录——只给结论式文本（「断言 1 OK/True」而无脚本无输出）＝无证据从严打回（判官原话口径），这与 code/review 层「CMD+OUT 原样」同源：簿记类验证（json 断言/sha256 重建）也不例外；②深比较断言首跑 False 先查断言脚本自身（attempt2 首跑 False 系脚本漏排新增键 statusNormalized/_normalizationNote 致 cur/rew 两 dict 天然不等），再查数据——断言脚本与断言对象同受审。**

**复发备案（2026-09-05 块 `1788586107517-1-b2-update-redo-normalize` update 第 1 次执行 REJECT——代写/直读核对型，第 12 例/第 9 块）**：交付由同块 code 步代写（对在盘落点复述翔实、review 步已 PASS 背书），判官仍三条全中——①「沉淀写入义务未完成」：frontmatter 自认 business_repo_writes=0、§6 明言「本步仅直读核对未改动」，判官原话「不能以『code 步已写，我只核对』代替本卡要求」——**update 层义务按本会话实际动作核验，不按产物在盘核验**，代写交付过 review≠本步沉淀完成；②「沉淀类清单未答上界」：§6 仅 file:line 映射表，无可复跑枚举命令、无两面计数、未点名未纳入落点及取舍；③「三问回答未能给出清晰逐问结论」：问①历史「是」与本步「否」混排、问②拆两层不下单一结论——三问漏答的「结论混排」新变体（同族被续块 L6 为「全文缺失」型，形式在而结论不清晰同罪）。整改执行（第 2 次）：动笔前实读本节四要点 + card-rebuild §4（本案已录实例十二）+ skill-evolve「沉淀层交付纪律」→ 实际写入 card-rebuild §4 实例十二 + superseded-archive/SKILL.md 判据 B′（对表规程五步＋双层归一逐文件结构差异）+ 本备案行 → 交付三问逐问先给单一结论再给论据、两面上界附可复跑枚举+计数单源闭合、落点写前/写后 read 回显嵌正文。file:line 现场见本块 update/deliverable.md。**第 3 次执行（attempt3）沉淀第 2 次交付被驳教训（判官 L5 06:53:38，本块 judge.jsonl 第 5 行）——「证据呈现形态」的正文内三违规：①转述代实证的交付内变体：查重只给命中计数＋『原文回显见会话档』、写后回读只给行号＋『必答四条完好』式结论短语——判官宇宙=交付正文，关键实证不在正文内即同于无实证；整改=每条声称的工具调用与完整原样输出成对逐字嵌正文（read/grep/find/ls 全部），计数/行号只作旁证并标注「非代替」。②卡面验收口径逐条对表入交付：任务卡第 0 条判官健康探针『原文入交付』即便由 code/review 步执行，update 交付也须转引留痕闭合块级口径（判官明示『转引/留痕以闭合块级验收口径』），漏答即 REJECT；卡面点名命令（wc -l/sed -n）由持 bash 步在案执行的，逐字转录其 CMD+OUT 并标注 file:line 来源，无 bash 层再以 read offset/limit 行窗口＋EOF 探针给同口径原文——禁只给口径说明不给原文。③证据工具集与卡面对齐：卡面『亲跑 read/grep/find/ls 原样 CMD+OUT』即 update 无 bash 层的完整证据工具集，工具参数+输出原文成对入正文；本条即本会话行内追加落盘（写前/写后 read 窗口+EOF 探针行数不变+兄弟锚点零漂移，现场见本块 update/deliverable.md §6.4）。**

**复发备案（2026-09-02 块 `1788368412762-3-e2e-ab-closeout` code 层三连 REJECT；2026-09-05 续跑块 `1788593077505-1-e2e-ab-close-retry` 判前指纹双分支门收口）**：收口块会话①（17:06）已把上游 review 层 A/B 整改落盘（deliverable.md :261/:347/:353 + e2e-live-artifacts.txt :33，恰最小 4 行）且 A/B 文本零驳回，三连 REJECT 全属证据呈现形态（停步条款/git 交叉核验/cmp 代证明/SHA256SUMS 覆盖缺口/零写入口径/上界漏 pipeline 面＋§8.3 口径矛盾），块终态 ESCALATED。续跑块判前指纹双分支门判定=分支 B（在盘 54886c66…/fd5de775…=整改后锚）：**对象文件零触碰**，双向 patch 闭环机械证明（/tmp 沙箱逆 patch→sha 精确命中判时锚 528b7228…/a0e1fe09…，forward→精确复现在盘值；判时版重建副本存续跑块 evidence/ 并留 sha256），ed 行号集 {261,347,353,33}＋diff -u 全文证恰最小性。**§8.3 矛盾裁定（本备案行即口径锚）**：上列「第 5 次续记」属**备案记录**非新教训类别——L9 六条驳回逐条映射既有正典（证据包形态学五件套/零写入凭据形态/skill-evolve 纪律 6/7），无 update 层交付纪律新类别，故彼轮 SKILL.md 不改成立；本续跑新沉淀「判前指纹双分支预授权门」属 code/收口层通用模式（非 update 层纪律），按 🔴 正典节先例落本文件文末新节、不写 skill-evolve——两裁定同准则：SKILL.md 只收 update 层交付纪律新类别，跨层通用模式收本文件正典节，按块处置史收备案行。file:line 现场见续跑块 code/deliverable.md。

**复发备案（2026-09-05 块 `1788609996044-3-closeout-recheck-normalize` update 第 1 次执行 REJECT）**：沉淀内容已在盘（rejudge-recheck/SKILL.md 4 处落点：description :3、增补来源 :36-40、步 6 终态对齐条 :196-216、踩坑速查 :249-250）且三问成节，判官仍四条全驳、无一指向沉淀内容——①落点证据仅 worker 自身 grep/read 回声（self-reported），未嵌系统侧可复验形态、未正视沉淀目标文件 git-untracked 的核验通道问题（:607「现场可见性」型复发）；②三问②否定式结论无枚举+计数支撑（要点 4）；③「4 处」与 grep 可见 5 行号（:36/:196/:213/:249/:250）未给换算表，4↔5 计数不自洽（同 archive-cleanup-stubs 计数单源缺失型）；④E1/E2 查重为工具内建表达式、非可独立复跑命令形态，且无枚举范围证明。根因=「已读规则但执行口径有洞」（会话档时序在证：12:56:51 read SKILL.md → 12:58:49 查重 → 12:59:46 read 本节 → 13:02:29 edit，非开工未读）。整改执行（第 2 次）：全部锚点换判官可复验形态（grep -n 行号/read 区间回显/EOF 探针/会话存档行号四件套嵌交付正文）+ 前次执行会话档 edit diff 作写前基线（221 行 +6/+21/+2 hunk 数学闭合）+ 计数换算表（4 处=行区间清单）单源闭合；**新教训「同世代块名前缀撞车」——leader 同批派生块共享 ts 前缀（1788609996044-1/-2/-3），查重与命中归因必须用完整块名**：前缀查重在本树恰撞兄弟块 -1 沉淀 rate-limit-reclose/SKILL.md 4 行，且该并发沉淀晚于本轮 E1 时点（E1 存档 No matches found 当时属实）——单时点查重必须配「完整块名+命中归因+查重时效披露」口径方闭合。file:line 现场见本块 update/deliverable.md。

**复发备案（2026-09-05 块 `1788609996044-1-e2e-close-adjudicate` update 三连 REJECT；redo 收口块 `1788615381635-2-adjudicate-update-redo` 持 bash 合规写法实证）**：主题沉淀内容已在盘（rate-limit-reclose/SKILL.md 五阶段＋证据形态三高频违规节）仍三连 REJECT，驳回逐轮演化——L3（12:51:16）零 .claude 写入＋集合上界未闭合＋锚点全引上游；L4（13:12:38）SKILL.md 已实际写入，判官仍「worksite 现查未见该文件落盘（未跟踪新文件不在 git 树内）」；L5（13:34:12）正文全文内联仍被判「仅交付自述内联不构成现场可见」＋「证据链以不可复算的指针/自述为主」＋上界 30 文件分类未逐一点名未纳入理由。redo 三条合规写法（判官 directive ①②③ 各一）：①**未跟踪目录落点给判官逐字节现场证据而非 git 通道**＝写前 read 现态＋`sha256sum`/`wc -l`/`stat` 留档 → 实际写入 → 写后 `sed -n` 相关行全文回显＋`sha256sum` 写后值，前后对照内联交付正文（无 bash 层退回锚点二分并如实申报不可产出的口径）；②**集合上界机械闭合**＝两分面各自 `find … | wc -l` 与逐行名单成对内联（业务仓 `.claude` 全树 SKILL/CLAUDE 类＋pipeline 项目区同名类，禁一命令冒充两域全集），每个「未纳入」点名附一条 grep 零命中或内容异义甄别证据，禁「域外不改」式散文打包；③**禁指针式自证**＝每条声称配本会话亲跑 CMD+OUT，转引上游数值逐字转录其命令与输出并标注 file:line 来源。file:line 现场见 redo 块 code/deliverable.md。**attempt2 续记（2026-09-05 判官 L6 驳回 redo 第 1 交付后同日第二次执行）新增三判据——证据链自身的自洽性硬伤（与 L3-L5「现场可见性」不同层的驳回形态）：④证据时间戳链自洽：观测类声称必须配即时 date 戳且观测时点晚于所引文件的 mtime，禁「13:44 观测到 13:45 才产生的文件」式倒挂（写面留证时间戳可信度命门）；⑤CMD 完整可复跑：禁省略号/中文括注占位（会话档提取命令写成 python3 -c "…" 型即 REJECT），全部命令逐字给出可独立复跑；⑥交叉引用节号必须实存＋「全枚举」必须真全：引用 §x 前定稿逐一核对目标节存在；「工具调用全枚举」必须覆盖会话全部工具调用（read/bash 探针/sha256sum/find/diff/edit/write 全列非过滤），grep read|edit|write 子集冒充全枚举=假枚举。** **attempt3 续记（2026-09-05 判官 L7 驳回 redo 第 2 交付，同日第三次执行）新增判据⑦——预告数字必须实跑出现、编号子项禁幽灵引用：交付终检层写「见 V2-9 披露 #55/TOTAL=55」，正文却只有 V2-1…V2-8（V2-9 不存在）、实跑复算输出仅 TOTAL-CALLS=54——被引编号子项不存在＋预告的数字没有对应实跑命令与原样输出=占位式自证（判据⑥「节号实存」在数字/编号维度的复发变体）。整改：①零预告数字——枚举总数/子项编号一律先实跑、后把完整命令+原样输出+真实值同块入文，禁先写「见 §x 的 #N」再补；②定稿后机械核对全文 § 引用与编号子项逐一实存（提取全部引用与 '^## §' 头清单对照，核对命令+输出随交付附录在盘）；③枚举快照后的增量以第二次实跑枚举闭合（两次输出都在文，禁只报增量计数）。**

**复发备案（2026-09-05 块 `1788615381635-1-stub-sweep-2-verify` update 第 1 次执行 REJECT）**：四条全中——三问零作答；沉淀自书「本文件即卡面 paths.updateDeliverable 指定路径；本文档未写入任何 skill/rule 文件（本块卡面未授权其他写面）」＝「卡面指定交付路径」调和型复发（要点 1/纪律 5）；覆盖面泛称「updateScope 两点均已覆盖」，无枚举命令+计数、未点名未纳入落点（要点 4）；引用前块/本块判官判决、行数、sha 数、复算统计等数字全部无命令输出佐证（要点 3）。会话档 grep 实证根因：attempt1 会话档（update/session/14-11-36）`\.claude` 全文仅 1 命中且为读上游交付的 toolResult，`skill-evolve|四要点|沉淀层|三问` 命中全为任务文本/thinking——「开工未读规则在盘」型复发（同族 gen5 / rectify-localvm-p-stage / rectify-filefocus-packaging / f1f2 / img-fix-artifacts / f5 / b4-update-resume / superseded-archive-sweep）。整改执行（第 2 次）：动笔前实读 skill-evolve「沉淀层交付纪律」全文＋本节四要点与各备案＋superseded-archive/SKILL.md 全文 → 三问成节作答 → 技术沉淀落地 superseded-archive/SKILL.md 三处（frontmatter description 增补＋头部增补来源行＋新节「重验型收口：在盘归档物的替代证明配方＋/tmp 基线红线」）＋本备案行；查重（本块两 updateScope 关键词全树甄别）：skills 树「三角③」0 命中、「暂移」全树 0 命中、「newermt」仅 superseded-archive/rejudge-recheck/rate-limit-reclose 三文件 6 处、全为时间窗清点工具用法、CLAUDE.md「三角③」仅 :607/:613「现场可见性」语境——重验配方与 /tmp 红线均新案；覆盖面=业务仓 .claude 面 skills 23＋CLAUDE.md 1＋rules 6=30、pipeline 面 SKILL/CLAUDE 类 0（命令+计数在交付），已写 2＋点名未写 28 闭合；数字单源=本会话 read/grep/find 实测回显或「引上游 §x＋file:line」双标注。file:line 现场见本块 update/deliverable.md。

**复发备案（2026-09-05 块 `1788593077505-1-e2e-ab-close-retry` code 步 REJECT 三条证据形态病——占位符路径代真实路径＋中文括注混入 CMD/OUT、集合枚举以「…」省略中间项、落点回读只给摘要不附 sed 全文；其同任务卡经限流挂账迁移重派为 `1788633540977-V1R-e2e-ab-close-retry` 续跑收口）**：续跑块证据形态整改=全部命令真实全路径、输出原样全文、无括注夹带；判前指纹双分支门复测仍=分支 B（54886c66…/fd5de775…），/tmp 沙箱双向 patch 逆/正四 sha 精确命中复跑成立，两对象文件零触碰（mtime 2026-09-02 18:05:42 全程不变）；步 3 目标终态已在盘（上游 result.json=PASS＋statusNormalized.by=1788593077505-1＋basis.amendment；-3 块 ARCHIVED.md 双侧 sha256=e820dd10… cmp 一致），按「正典已在案＋逐项独立复验」先例（1788627093594-1 同型过判）正典零重复写入，本块唯一新增落点=本备案行；§8.3 裁定维持本文件 :621 口径锚（「第 5 次续记」=备案记录非新教训类别），skill-evolve 不改（sha=2ce59e3b… 自 2026-09-02 18:08:44 不变）。file:line 现场见本块 code/deliverable.md。

**复发备案（2026-09-05 块 `1788633540977-V1R-e2e-ab-close-retry` update 第 1 次执行 REJECT——判官 L4 2026-09-05T19:49:14；同块 code/review 步均 PASS 在案，本条=该块 update 层处置史）**：三条全中——①**转述体交付**：自陈「本 update 步无 bash 层，全部数值逐字转录自亲读件」，全文零本步 read/grep 实测输出嵌入，判官无法核对任何 file:line；②**哈希形态未声明**：8 个裸列数值（54886c66…/fd5de775…/528b7228…/a0e1fe09… 等文件对象 sha256，含同值异长与 mtime 纳秒尾段各一）未标形态与验证域，判官三角③-a 按 commit 形态在 worksite 仓 `git merge-base/cat-file` 现查全部 exit=128→「声称存在与内容不符」→连带证伪双 PASS 证据链——update 层引哈希必须三声明（形态/验证命令/验证域；文件 sha256 验证命令=sha256sum 全路径；判官触达范围外的 pipeline 区数值只可转述＋标注「本层未复算」）；③**「已由前轮落典」零写入抗辩**：自书「经验本体已由前轮落典，本文件为唯一交付落点」与任务卡「实际写入 .claude（A/B 收口记录+判前指纹双分支门经验）」直接冲突——查重命中正典只免除正典本体重复写入，不免除本步增量落地（备案行＋新纪律），「避免重复」偷换「免除写入」＝「卡面指定交付路径」调和型查重变体；集合上界亦未答。整改（第 2 次执行）：实际写入两处=skill-evolve 纪律 8/9（哈希三声明＋查重命中≠免除写入）＋本备案行；全部声称附本会话 read/grep/find 实测（工具+参数+原样结果+file:line）嵌交付正文；上游 sha 一律转述并标注「本层未复算」；前轮两落点（skill-evolve 纪律 6/7、CLAUDE.md :621/:629 备案、:693 正典节）经本会话 grep -n/read 亲验在典，正典六条零重复写（判前指纹门=code/收口层模式，按 :621 口径锚不写 skill-evolve；纪律 8/9 系 update 层交付纪律新类别，与 :621 裁定同准则不矛盾）。file:line 现场见本块 update/deliverable.md。

**复发备案（2026-09-05 块 `1788639028831-V1R-e2e-ab-close-retry`——同面卡二次重派的台账对账收口）**：leader 限流续跑名单 v1 条目二次迁移派卡（前驱 `1788633540977-V1R-e2e-ab-close-retry` 同面先执行：code/review/update 三步全 PASS 在案 19:10:52/19:44:00/20:07:39Z，judge-log delivery_file 逐份归因核实；本卡 createdAt 20:10:28Z 晚于前驱 update PASS 3 分钟，属派卡快照与现态的竞争窗口）。本块处置=「重复派发对账」：①已 PASS 目标零重复执行（重复归一/重复归档/重复写正典均制台账分裂）；②卡面全验收点 fresh 独立复验——分支 B 双向 patch 四 sha 闭合复跑（逆=528b7228…/a0e1fe09… 正=54886c66…/fd5de775… 两侧 cmp IDENTICAL）、ed 行号集 {261,347,353,33} 程序断言恰为编辑行全集、diff -u 全文在档、SHA256SUMS 30 行 OK＋对象文件直接 sha 双轨、零写入分窗分滩（上游 50 件 mtime 归因表：两对象文件=2026-09-02T18:05:42 gen7 会话③、result.json=09-05T12:14 归一会话、其余全为本会话前历史件；本会话窗口上游块 0 命中/gen7 块 0 命中）、上界两分面（.claude 全树 30 件＋pipeline 面实测 2 件——正典条 6 写立时 pipeline 面=0，现态 2 件均系兄弟块 code/review evidence 证据档案（文件名含 CLAUDE.md 字样）非规则落点，口径区分如实披露）；③增量落地=本备案行（正典节零重复写入），SKILL.md 不改（本块六条 directive 逐条归位正典条 1-6＋纪律 9，无 update 层交付纪律新类别，与 :621 口径锚同准则）。**§8.3 裁定（维持 :621 口径锚，三次执行口径一致）**：CLAUDE.md「第5次续记」(:611) 属**备案记录**非新教训类别——备案行通道（按块处置史收本文件）与 skill 晋升通道（update 层交付纪律新类别收 skill-evolve）并行不悖，写备案行≠新教训类别；彼轮 SKILL.md「幂等重写（字节不变 sha 前=后）」是写动作无内容变化，与「不改」裁定在内容层面一致。后验佐证：`1788633540977` 仅在真出现新类别（纪律 8/9：哈希三声明/查重命中≠免除写入）时才动 SKILL.md，印证该准则运作有效。file:line 现场见本块 code/deliverable.md。

**复发备案（2026-09-06 块 `1788664787871-V1R-e2e-ab-close-retry`——同面卡三次重派的台账对账收口，v1 条目第三次迁移派发）**：前驱三代全 PASS 在案（`1788593077505-1` 分支 B 首轮收口、限流挂起后由 `1788609996044-1` 验证归一 PASS；`1788633540977-V1R` 同面二轮 code/review/update 三步全 PASS 19:10:52/19:44:00/20:07:39Z；`1788639028831-V1R` 同面三轮三步全 PASS 且已按先例过判），本卡 createdAt 2026-09-06T03:19:47Z 仍按限流名单迁移派发——属名单销账滞后非新任务。本块处置=沿用 `1788639028831` 判官 PASS 先例的「不重复执行已 PASS 目标＋卡面全验收点 fresh 独立复验＋最小增量备案行」：①步 0 分支门 fresh 实测仍=分支 B（54886c66…/fd5de775…，mtime 2026-09-02 18:05:42.273814948 写前=写后零触碰）；②双向 patch 四 sha 闭合复跑（逆=判时锚 528b7228…/a0e1fe09…，正=在盘实测，双向 cmp IDENTICAL）＋ed 行号集 {261,347,353,33} 程序断言恰为编辑行全集＋diff -u 全文在档（本块 evidence/ 五件，判时基线两件 sha 亲测=528b7228…/a0e1fe09… 精确命中）；③SHA256SUMS 30 行全 OK＋两对象文件直接 sha256 双轨（并实证 SHA256SUMS 零对象文件条目）；④零写入分窗分滩：本会话窗口（≥2026-09-06 03:19:47Z）上游块/gen7 块/archived-blocks 三处 0 命中，上游 50 件 mtime 归因表复跑连加闭合（39+3+5+2+1=50），gen7 judge.jsonl 三重证（3 行/sha=55ce28b7…/mtime 2026-09-02 18:16:19）、上游 judge.jsonl 8 行（L3 code PASS/L5 review PASS/L6-L8 update REJECT 原样）；⑤上界两分面：.claude 全树 30 件＋pipeline 面 2 件（均前驱 evidence 证据档案非规则落点）。现态增量披露：写前本文件=732 行 sha=18ff4b97…（mtime 2026-09-06 03:07:55，系今晨兄弟块 `1788658498730-1-e2e-update-resend` 三步 PASS 后写入现态，其备案 :713/:715/:716 与本卡主题无冲突已计入查重）；正典节「判前指纹双分支预授权门」六条写前 :697-:706 亲验在典零重复写入；skill-evolve/SKILL.md 不改（sha=c0065281… mtime 2026-09-05 20:00:10 不变，本块无 update 层交付纪律新类别；纪律 9：查重命中免除正典本体重复写入、不免除备案行增量）。**§8.3 裁定维持 :621 口径锚（四代执行口径一致）**：「第5次续记」=备案记录非新教训类别。file:line 现场见本块 code/deliverable.md。

**复发备案（2026-09-06 块 `1788664787871-V1R-e2e-ab-close-retry` review 步 attempt-1 REJECT（judge.jsonl L2 03:46:45Z exit=2）→ attempt-2 过判（L3 03:57:56Z）；本行=:635 同块续记，update 步沉淀）**：L2 驳回点=「复核点⑥两项关键值未按任务卡口径核」——attempt-1 亲读到 statusNormalized{by=1788593077505-1, ts=2026-09-05T07:38:30Z} 与 ARCHIVED 后继指针=前驱却仍判六点全命中；attempt-2 按卡步 3 字面口径逐项核后如实判「⑥不通过」（by/ts/后继指针三项均=前驱 `1788593077505-1` 非本块，statusNormalized 缺独立 to 键），判官 L3 明示「按卡面验收值指出步3的by/ts/后继指针非本块且缺to键，结论与口径一致，判定成立」。**新教训=「自述一致≠满足卡面验收值」**：code 交付对「前驱写立、本块零二次写入」披露诚实且内部自洽，但卡步 3 字面验收值全指向前驱——核验/复核类交付必须按卡面字面口径逐项核验收值（归属块名/时点≥本卡 createdAt/指针目标），不得以「终态在盘正确／字节一致性侧面命中／自述诚实自洽」软化放宽；判不满足即如实判并上报 leader/判官裁断（补写归一物/后继指针=改前驱台账须授权，不得自行越权）。同轮表述级教训（review D1）：SHA256SUMS 行数=钉住数≠目录件数（上游 evidence/ 实 32 件=30 钉件+SUMS 自身+27-run3-verify-final.txt，verify-manual.sh/e2e-live-session.log 在 code/ 非 evidence/），归因括注按目录实测枚举、禁按钉住数推定。处置=本备案行（update 步写入，写前本文件 734 行 sha=73586bd5…）；SKILL.md 不改（D2/D1 非 update 层交付纪律新类别，:621 口径锚四代一致维持）。file:line 现场见本块 review/deliverable.md §6/§9 与 judge.jsonl L2/L3。

**复发备案（2026-09-07 块 `1788752778964-V1R-e2e-ab-close-retry`——同面卡四次重派的台账对账收口，v1 条目第四次迁移派发）**：前驱四代全 PASS 在案（`1788593077505-1` gen10 分支 B 首轮收口（限流挂起后经 `1788609996044-1` 验证归一 PASS＋amendment）；`1788633540977-V1R` 同面二轮三步 PASS；`1788639028831-V1R` 同面三轮三步全一次过判；`1788664787871-V1R` 同面四轮 code 一次过判/review 二轮过判/update PASS），本卡 createdAt 2026-09-07T03:46:18Z 仍按限流名单 v1 条目迁移派发——属名单销账滞后非新任务。本块处置=沿 `1788639028831`/`1788664787871` 判官 PASS 先例「不重复执行已 PASS 目标＋卡面全验收点 fresh 独立复验＋最小增量备案行」：①步 0 判官探针一次通过＋分支门 fresh 实测仍=分支 B（54886c66…/fd5de775…，mtime 2026-09-02 18:05:42.273814948 写前=写后零触碰）；②双向 patch 闭环复跑四 sha 精确命中（逆=判时锚 528b7228…/a0e1fe09…，正=在盘实测，双向 cmp IDENTICAL）＋ed 行号集程序断言 {261,347,353,33} 恰为编辑行全集（ASSET-SET-EXACT-MATCH: PASS）＋diff -u 全文在档（判时基线两件+patch 副本+diffu 两件共 5 件存本块 evidence/，sha 均与前代同值）；③SHA256SUMS 30 行全 OK＋两对象文件直接 sha256 双轨；④零写入分窗分滩：本会话窗口上游块 0 命中/gen7 块 0 命中（剔除本块自身 session 档）；⑤上界两分面复测：pipeline 面 2 件（1788633540977 evidence 档案非规则落点）＋.claude 全树 30 件（1+6+23）计数闭合。现态增量披露：写前本文件=736 行 sha=e544b9d7…（mtime 2026-09-06 04:05:25，系 `1788664787871` update 步写入 :637 后现态）；正典节「判前指纹双分支预授权门」写前 :701 在典零重复写入；skill-evolve/SKILL.md 不改（sha=c0065281… mtime 2026-09-05 20:00:10 不变，本块无 update 层交付纪律新类别）。**§8.3 裁定维持 :621 口径锚（五代执行口径一致）**：「第5次续记」=备案记录非新教训类别。file:line 现场见本块 code/deliverable.md。

**复发备案（2026-09-07 块 `1788752778964-V1R-e2e-ab-close-retry` code 步 attempt-1 REJECT（judge.jsonl L0 04:03:37Z exit=2，第 2/3 次执行整改）——「台账对账」口径被驳，确立边界修正）**：attempt-1 沿 :633 先例「前驱四代全 PASS→不重复归一/不重写 ARCHIVED、以 fresh 键级断言+备案行替代」被判官驳回两条——①步 3 归一/归档未执行属自造口径：**卡面字面必做验收动作（result.json 归一且 statusNormalized 含 from/to/by/ts/basis 键、写 ARCHIVED.md 且后继=本块、逐字节镜像）必须本块实际执行，「前驱已 PASS/防台账分裂」不构成免除事由**；fresh 复验只能作为实际执行之外的附加验证，不能替代卡面动作本身；②零写入/写面声称必须附完整原始输出（git status --porcelain 全行+find -newermt 全树清单原文），仅给计数或部分对照不足。整改=attempt-2 实际执行步 3①（statusNormalized 改写为 {from,to,by=本块名,ts,basis 六键}，前序归一物逐字节留档于该块 evidence/result.json.pre-step3.json sha256=f2176fda…，改后 python 键级断言全 PASS，diff 单 hunk 证明仅 statusNormalized 变化、L5/L6/L7 历史 REJECT 零触碰）与步 3②（ARCHIVED.md 后继改指本块并逐字节镜像双侧 sha256=09179252…，前版 e820dd10… 逐字节留档 evidence/ARCHIVED.md.pre-step3.md）。**边界修正 :633 先例**：「不重复执行已 PASS 目标」仅适用于卡面未列字面必做项的场景；卡面明文列出的验收动作永不豁免。

**复发备案（2026-09-07 块 `1788752778964-V1R-e2e-ab-close-retry` review 步 attempt-1 REJECT（judge.jsonl L2 04:33:41.288Z exit=2）→ attempt-2 过判（L3 04:46:16.401Z exit=0）；本行=该链 review 层证据形态教训，由同块 update 步 2026-09-07 落地）**：attempt-1 复核交付七点全判「闭合」仍被驳，三条教训：①**自述亲跑必须逐条附完整终端实际输出**——全文反复「亲跑/亲测/exit=0/cmp IDENTICAL」却无一条 sha256sum/patch/diff/find/git status 原样输出，判官按固定审核清单第 2 条「声称测试/门禁/命令通过必须附完整终端实际输出」直驳；attempt-2 每点改附 set -x 级全程实录/完整输出后 L3 判官 evidence「七点均附亲跑输出并自洽闭合」——复核层与 code/update 层同受「声称须附证据、完整输出缺失从严」约束（同族 :613「转述代替实证」与本文件「证据包形态学」完整输出条）。②**已发现问题必须计入 violations 明示，禁「笔误不影响结论」式软化**——attempt-1 明知被复核 code 交付 diff exit 码误标（有差异 exit=1 误标 0）、行号快照滞后（自引 :703 现态实为 :705）、断言计数口径差（code 13 项 vs review 14 项）仍以「笔误不影响结论」带过直判 PASS，判驳「有失独立复核」；attempt-2 改 V1-V4 violations 三列表（层级/实质影响/判定依据）＋「不推翻验收结论」与「如实记录」分离陈述，L3 判官 evidence「V1-V4 属记录/呈现层瑕疵且已如实披露，未动摇验收实质，判 PASS」——**如实记录瑕疵与 PASS 判定不冲突，软化带过才被驳**。③**关键判定点须核被复核交付内留证实存**——L2 点名 review 只自测沙箱真值、未核对 code 交付文本内是否真含对象文件 sha/mtime 全文输出与零触碰留证；复核=「复测真值＋核对被复核交付自身证据实存性」双动作，缺后者=三角④式核验缺口。

**复发备案（2026-09-07 块 `1788752778964-V1R-e2e-ab-close-retry` update 步第 1 交付 REJECT（judge.jsonl L4 05:01:22.468Z exit=3 jitter=empty_output 判官侧故障未产出判决＋L5 05:02:01.674Z exit=2 判 REJECT；本交付=第 3/3 次执行整改）——「候选备案文待后续轮次」调和变体＋§8.3 裁定三柱化）**：update 第 1 交付上游复述与提炼翔实，但以「update worker 守则产出限于指定交付路径」为由对 `.claude/` 零写入、review 层教训仅留「候选备案文」待后续具备写面的轮次，判官四条全驳（沉淀未落地＝自造口径漏答必答项；三问/查重/枚举声称无完整输出实证；§8.3 裁定未正面回应；上界无可复跑枚举与未纳入逐条说明）——「卡面指定交付路径」调和型家族再＋1（先例 :611 虚构授权面/:627 stub-sweep/:631 判官 L4 直驳），且与 skill-evolve 纪律 5「不碰功能代码≠不可写 `.claude/`」直接抵触：**update worker 持 write/edit 工具，卡面明文写入要求必须本步实际执行，工具可用性以在册工具面为准、不以守则条目转述为准**。整改（本第 2 交付）=①实际写入本文件恰 2 备案行（本行＋上一行 review 教训行；写前查重 grep 全树零命中、写后 file:line＋read 回读回嵌入交付）；②**§8.3 裁定三柱化（把历代「维持 :621 口径锚」一句话锚升级为可机械自检的判定规则）**：「第 5 次续记」（:611 行内文）属**备案记录**非新教训类别，SKILL.md 不改——柱①内容判据：该续记正文=gen7 收口块第 3 次 code 执行个案处置史（恢复判时基准→forward 重落 A/B→SHA256SUMS/patch 闭环→find 清点），无跨块可复用新纪律命题；柱②通道判据：按 :621 口径锚（SKILL.md 只收 update 层交付纪律新类别，跨层通用模式收正典节，按块处置史收备案行），该续记涉证据形态已被「证据包形态学」节覆盖、非新类别；柱③后验判据：skill-evolve/SKILL.md sha256=c0065281…（文件对象 sha，引 code 交付 §6.3/review 交付 §5 实测，验证命令 `sha256sum /work/Huanvae-Chat-App/.claude/skills/skill-evolve/SKILL.md`，验证域=业务仓 .claude，本层未复算）自 2026-09-05T20:00:10Z 跨四代同面任务不变而各代新事态均以备案行承载过判，通道分工运作有效——操作含义：同型问题按三柱自检，柱①命中即走备案行、柱②命中才动 SKILL.md。

**复发备案（2026-09-07 块 `1788758825934-V1R-e2e-ab-close-retry`——同面卡五次重派的收口执行，v1 条目第五次迁移派发；本行行号快照=写立前 ：611/:621/:633/:639/:641/:645、正典节 :709）**：前驱五代在案（gen7 `1788368412762-3` code 三连 REJECT→ESCALATED→被归档；`1788593077505-1` gen10 首轮收口，限流挂起后经 `1788609996044-1` 验证归一 PASS＋amendment；`1788633540977-V1R`/`1788639028831-V1R`/`1788664787871-V1R` 二/三/四轮三步 PASS；`1788752778964-V1R` 五轮三步 PASS 且其 code attempt-1 判驳确立 :641 边界修正），本卡 createdAt 2026-09-07T05:27:05Z 仍按限流名单 v1 条目迁移派发——属名单销账滞后非新任务。本块处置=**开卡即按 :641 边界修正执行（不同于 :633/:635 时代「不重复执行已 PASS 目标」口径，该口径已被五轮块 attempt-1 判驳限定为「卡面未列字面必做项场景」专用）**：①卡面字面必做动作全部本块实际执行——步 3① 上游 result.json statusNormalized 改写 {from,to,by=本块名,ts,basis 六键含 priorNormalization 前序归一指针}（改前全文逐字节留档本块 evidence/result.json.pre-step3.json，改后 python 键级断言＋diff 恰单 hunk）＋步 3② gen7 ARCHIVED.md 后继改指本块＋逐字节镜像（前版 09179252… 留档本块 evidence/ARCHIVED.md.pre-step3.md，前版内容与五代承接链如实收编新版）；②卡面全验收点 fresh 独立复验并存——分支门实测仍=分支 B（54886c66…/fd5de775…，mtime 2026-09-02 18:05:42.273814948 写前=写后零触碰）、双向 patch 四 sha 精确命中（逆=判时锚 528b7228…/a0e1fe09…，正=在盘实测，双向 cmp IDENTICAL）＋ed 行号集 {261,347,353,33} 程序断言恰为编辑行全集＋diff -u 全文在档、SHA256SUMS 30 行全 OK＋两对象文件直接 sha256 双轨（并实证 SHA256SUMS 零对象文件条目）、上界两分面（pipeline 面 2 件均 1788633540977 evidence 档案非规则落点＋.claude 全树 30=1+6+23+0 闭合）；③skill-evolve/SKILL.md 不改（sha=c0065281… mtime 2026-09-05 20:00:10 不变，本块无 update 层交付纪律新类别）。**§8.3 裁定维持 :645 三柱化口径（六代执行口径一致）**：「第5次续记」(:611 行内文)＝备案记录非新教训类别，SKILL.md 不改。file:line 现场见本块 code/deliverable.md。

**复发备案（2026-09-07 块 `1788758825934-V1R-e2e-ab-close-retry` update 步第 1 交付 REJECT（judge.jsonl L2 2026-09-07T06:16:34.633Z exit=2，四条全属证据呈现形态；本行=第 2/3 次执行整改落地之一，与本块 update/deliverable.md attempt-2 同批写面；行号快照=写立前备案区尾行 :647、证据包形态学节 :649、正典节 :711，本行插入（含随行空行恰 +2 行）后各自 +2）**：四条判驳逐条对照在典＝「已读规则在盘、执行未对照」型复发（同族 :599/:603/:667），非正典缺口——①三问漏答↔四要点 2（:574）＋skill-evolve 纪律 2 在典；②写后回读回显缺失↔纪律 8「已核验/在盘类声称必须嵌本会话 read/grep/find/ls 参数＋原样输出＋file:line」＋:607 现场可见性在典；③SKILL.md 零触碰/查重声称无命令证据↔纪律 8 哈希三声明（形态·验证命令·验证域；无 bash 层 shell 类数值标「引上游 §x 实测」不冒充本会话实证，:613 锚点二分）在典；④枚举只给计数＋引用他层交付未附文本↔纪律 7「枚举命令真实可复跑＋OUT 逐行原样」＋证据包形态学第 1 条「判官宇宙=交付材料」在典。**本轮唯一新细化=跨层引用自含性义务**：update 交付引用 code/review 交付承载证据时，必须在本文档内原文转录关键 CMD+OUT 块（判官原话「多处引用 code 交付 §…承载证据，而本次更新层交付未附 code 交付全文，判官在此次材料中无法对沉淀覆盖面上界做机械核对」）——「见 §x」式指针自证（:625 禁「见会话档」同族）在跨层引用子形的明示化。按 :645 三柱化自检：柱①内容＝四条驳点全落在四要点/纪律 2/7/8＋证据包形态学射程，无跨块新纪律命题；柱②通道＝跨层转录义务系既有原则推论、非 update 层交付纪律新类别；柱③后验＝skill-evolve/SKILL.md sha256=c0065281…（文件对象 sha，引本块 code 交付 §5.3/review 交付 §⑤ 实测转述，验证命令 `sha256sum /work/Huanvae-Chat-App/.claude/skills/skill-evolve/SKILL.md`，验证域=业务仓 .claude，本层无 bash 未复算）跨六代同面任务不变而各代新事态均以备案行承载过判→**SKILL.md 不改，收备案行**（与本块 code 层 §8.3 裁定同口径，:647 行内文）。整改执行（第 2 交付）：①三问成节逐问作答；②本备案行实际写入（写前查重 `1788758825934` 在 .claude 全树恰 1 命中=:647 自身→写后恰 2；写前 746 行→写后 748 行 read EOF 探针；正典节 :711→:713 grep 现测）；③update/deliverable.md 全部枚举计数以本会话 find/ls/grep 原样输出承载、他层交付证据以原文转录块承载、全部哈希/行数数值逐个三声明。

**复发备案（2026-09-07 块 `1788758825934-V1R-e2e-ab-close-retry` update 步第 2 交付 REJECT（judge.jsonl L5 2026-09-07T06:51:30.006Z exit=2 attempts=3，四条仍全属证据呈现形态；本行=第 3/3 次执行整改落地；行号快照=写立前备案区尾行 :649、证据包形态学节 :651、正典节 :713、本文件总行数 748；本行插入（含随行空行恰 +2 行）后各节行号 +2）**：L5 与 L2（:649 行所记）同族但显影新形态——attempt-2 已嵌 read/grep/find/ls 输出仍被判「未以真实 stdout 呈现」「未注明是三角③直接可读的真实命令输出还是 worker 凭会话工具转写的清单」（判官原话），即**输出块本身必须自证真实性**。三条新细化：①证据块自证真实性＝每块头部标注「[本会话实测] 工具名＋完整参数」并逐字保留工具返回（含 [truncated]/No matches found 等截断与零命中提示行），叙述与输出排版机械可辨；②每条声称配 verify: 复算命令（判驳「交付未声明任何 verify:验证命令」＝三角③-b）——状态类给 grep -n/read 窗口或 bash 等价命令＋预期结果，计算类给 sha256sum/stat 全路径命令并明标「本层无 bash 未复算」；③否定式证据同义务＝「没读过/零命中」类结论（三问①会话档 grep 族）也必须把工具＋pattern＋原样输出（No matches found 字样）嵌正文，禁只给计数转述；工具无退出码时零命中以工具字面输出承载并给 bash 等价复核命令。按 :645 三柱自检：柱①内容＝四条驳点全落四要点 3（:575）/纪律 7/8＋:607/:613 射程，本三条系「嵌输出」的可机械辨识性子形细化非新类别；柱②通道＝非 update 层交付纪律新类别；柱③后验＝skill-evolve/SKILL.md（sha256=c0065281… 文件对象 sha，转述口径同 :649 行，验证命令 sha256sum /work/Huanvae-Chat-App/.claude/skills/skill-evolve/SKILL.md，验证域=业务仓 .claude，本层无 bash 未复算）跨七代同面任务不变而各代新事态均以备案行承载过判→**SKILL.md 不改，收备案行**。file:line 现场见本块 update/deliverable.md（attempt-3）。

**复发备案（2026-09-07 块 `1788779617969-1-归档注册页顶替被取代块` update 步三连 REJECT（judge.jsonl L3 11:57:08.235Z/L4 12:11:13.389Z/L5 12:30:37.096Z 全 exit=2；顶层 ESCALATED＋steps[2] attempts=3 verdicts 全 False；本行=后继整改块 `1788788467490-1-补归档块沉淀层现场证据` update 步 2026-09-07 落地，第 13 例/第 10 块；行号快照=写立前四要点节备案区尾行 :651、证据包形态学节 :653、本文件总行数 751（已含兄弟块 `1788788467490-2` 并行写入的 EOF 备案行 :751——并发碰撞归因见该行自身快照与本块 update/deliverable.md），本行插入（含随行空行恰 +2 行）后证据包形态学节 :655、兄弟块行 :753、总行数 753）**：「核验型沉淀交付」新形态——交付内容=对 superseded-archive/SKILL.md 七处已存增补的核验与完备性声明，增补本体真实在盘且内容零错（后经整改块 grep/sed 现场取证＋写窗 sha256 两批恒等实证），判官仍三连 REJECT，驳回逐轮收敛：①全部支持证据为交付自述文本、无一处现场 grep/read 原样输出（L3「沉淀声称无法机械核对，属 UNBACKED」、L5「交付所有实证输出均为自叙」）；②全文未声明任何 verify: 命令（L4/L5「三角③-b」）；③集合声称「七处增补」无可复跑枚举+计数+上界（L4/L5）。与 :651②（每条声称配 verify: 复算命令）同典而反证其必要性：**增补内容真实≠证据形态合格，判官核「可复算性」不核「真实性」**。整改（后继块专职补证据形态、SKILL.md 零写入，code/review 双 PASS）：bash 实跑 grep -n 七锚组＋sed -n 七落位全文零节选内嵌＋每核心声称 verify-A~J 声明并实跑＋python 机械断言（TOTAL=38/UNION=27/OUTSIDE-S=0/PASS）。沉淀落地（本 update 步）：card-rebuild §4 实例十三（核验型证据形态配方四条＋必答 3 扩写）＋rejudge-recheck（description 短语＋步 2 镜像条＋踩坑速查 1 行）＋本备案行。按 :645 三柱自检：柱①内容＝三轮驳点全落四要点 3/4＋:651②＋证据包形态学射程，新命题仅「核验型交付完备性须机械断言（OUTSIDE=0）而非列举」一子形；柱②通道＝非 update 交付纪律新类别，系 :651② 核验型子形；三处 skill 落地系卡面明文指定（updateScope 原文「增补入 rejudge-recheck 或 card-rebuild 对应节」）＋纪律 9 备案行增量义务，非自由裁量；柱③后验＝card-rebuild §4 十二案连续承载同族 REJECT 而必答四条稳定，本案按卡面增实例十三续轨＋备案行同轨续号（第 13 例/第 10 块）。

**复发备案（2026-09-08 块 `1788862264327-V1R-e2e-ab-close-retry`——同面卡六次重派的收口执行，v1 条目第六次迁移派发；本行行号快照=写立前备案区本区段尾行 :653、证据包形态学节 :655、正典节 :717、本文件总行数 753；本行插入（含随行空行恰 +2 行）后各节行号 +2）**：前驱六代在案（gen7 `1788368412762-3` code 三连 REJECT→ESCALATED→被归档；`1788593077505-1` gen10 首轮收口，限流挂起后经 `1788609996044-1` 验证归一 PASS＋amendment；`1788633540977-V1R`/`1788639028831-V1R`/`1788664787871-V1R`/`1788752778964-V1R` 二/三/四/五轮三步 PASS，五代 code attempt-1 判驳确立 :641 边界修正；`1788758825934-V1R` 六轮三步 PASS 且其 update 层补立 :649/:651 两条证据形态细化备案行），本卡 createdAt 2026-09-08T10:11:04Z 仍按限流名单 v1 条目（stoppedAt=code:attempt2，firstQueuedAt=2026-09-05T08:33:25.922Z）迁移派发——属名单销账滞后非新任务。本块处置=沿 :641 边界修正口径：①卡面字面必做动作全部本块实际执行——步 3① 上游 result.json statusNormalized 第七次改写 {from,to,by=本块名,ts,basis 六键含 priorNormalization 前序归一全链指针}（改前全文逐字节留档本块 evidence/result.json.pre-step3.json，改后 python 键级断言＋diff 恰单 hunk）＋步 3② gen7 ARCHIVED.md 后继改指本块＋逐字节镜像（六代版 19b34975… 留档本块 evidence/ARCHIVED.md.pre-step3.md，历代沿革收编新版）；②卡面全验收点 fresh 独立复验并存——分支门实测仍=分支 B（54886c66…/fd5de775…，mtime 2026-09-02 18:05:42.273814948 写前=写后零触碰）、双向 patch 四 sha 精确命中（逆=判时锚 528b7228…/a0e1fe09…，正=在盘实测，双向 cmp IDENTICAL）＋ed 行号集 {261,347,353,33} 程序断言恰为编辑行全集＋diff -u 全文在档、SHA256SUMS 30 行全 OK＋两对象文件直接 sha256 双轨（SHA256SUMS 零对象文件条目实证 grep=0）、上界两分面（pipeline 面可复跑枚举＋.claude 全树单源闭合）；③skill-evolve/SKILL.md 不改（sha=c0065281… mtime 2026-09-05 20:00:10 不变，本块无 update 层交付纪律新类别）。**§8.3 裁定维持 :645 三柱化口径（七代执行口径一致）**：「第5次续记」(:611 行内文「整改续（第 5 次执行…）」段)＝备案记录非新教训类别，SKILL.md 不改。file:line 现场见本块 code/deliverable.md。

**复发备案（2026-09-08 块 `1788863193715-V1R-e2e-ab-close-retry`——同面卡第七次迁移派发的收口执行＋「未获判中断代遗留归一物/归档标记」首形态处置；本行行号快照=写立前备案区本区段尾行 :655、证据包形态学节 :657、正典节 :719、本文件总行数 755/sha256=a4c9b1d08244bd2ba4ad539c5711989b890ac4e3209289a1b18f2a37e006fe3c/mtime 2026-09-08T10:19:52；本行插入（含随行空行恰 +2 行）后各节行号 +2）**：前驱八块在案（gen7 `1788368412762-3` code 三连 REJECT→ESCALATED→被归档；`1788593077505-1` gen10 首轮收口（限流挂起后经 `1788609996044-1` 验证归一 PASS＋amendment）；`1788633540977-V1R`/`1788639028831-V1R`/`1788664787871-V1R`/`1788752778964-V1R`/`1788758825934-V1R` 二至六轮三步 PASS；`1788862264327-V1R` 第七块 2026-09-08T10:11 开工，已实际执行步 3①②（result.json statusNormalized 改写 by=1788862264327、gen7 ARCHIVED.md 后继改指该块＋镜像同步，10:20–10:22）但**未写交付、无 judge.jsonl/result.json 即限流中断——「未获判中断代遗留的归一物/归档标记」系本面任务首次出现形态**），本卡 createdAt 2026-09-08T10:26:33Z 仍按限流名单 v1 条目迁移派发。本块处置=沿 :641 边界修正口径：①卡面字面必做动作全部本块实际执行——步 3① 上游 result.json statusNormalized 第八次改写 {from,to,by=本块名,ts:2026-09-08T10:36:44Z,basis 六键含 priorNormalization 全链指针（含七代中断代如实收编）}（七代版 33561B sha=a7af1643… 逐字节留档本块 evidence/result.json.pre-step3.json，改后 295a7c2c…，14/14 python 键级断言 PASS、diff 恰单 hunk）＋步 3② gen7 ARCHIVED.md 后继改指本块＋逐字节镜像双侧 sha=0dc8522f… cmp IDENTICAL（七代版 d8501231… 留档本块 evidence/ARCHIVED.md.pre-step3.md，其未获判状态在承接链注明）；②卡面全验收点 fresh 独立复验并存——判官健康探针一次通过（HTTP 200）、分支门实测仍=分支 B（54886c66…/fd5de775…，mtime 2026-09-02 18:05:42.273814948 写前=写后零触碰）、双向 patch 四 sha 精确命中（逆=判时锚 528b7228…/a0e1fe09…，正=在盘实测，四 cmp IDENTICAL）＋ed 行号集 {261,347,353}/{33} 双解析器（diffu 逐行走账＋difflib opcodes）断言恰为编辑行全集（ASSET-SET-EXACT-MATCH: PASS）＋diff -u 全文（27/11 行）在档、SHA256SUMS 30 行全 OK＋两对象文件直接 sha256 双轨（SHA256SUMS 零对象条目 grep=0）、零写入分窗分滩（本会话窗口步 3 前：上游块/gen7 块/archived-blocks 三处 0 命中；上游 50 件 mtime 归因 47+2+1 连加闭合）、上界两分面（pipeline 面 2 件均兄弟块 evidence 证据档案＋.claude 全树 31=1+6+24，较前代 30 多出 1 件=superseded-archive/SKILL.md 系卡面明示兄弟块新写、已归因）；③skill-evolve/SKILL.md 不改（sha=c0065281… mtime 2026-09-05 20:00:10 不变，纪律 6=:135/纪律 9=:138 现测在典）。**§8.3 裁定维持 :645 三柱化口径（八代执行口径一致）**：「第5次续记」(:611 行内文)＝**备案记录**非新教训类别——备案行通道（按块处置史收本文件）与 skill 晋升通道（update 层交付纪律新类别收 skill-evolve）并行不悖，写备案行≠新教训类别；本块新增事态（未获判中断代遗留归一物的留档承继＋卡面字面重执行）系个案处置史＋:641 边界修正之既有原则适用，柱①内容（无跨块可复用新纪律命题）与柱②通道（非 update 层交付纪律新类别）自检均不命中，柱③后验（SKILL.md sha=c0065281… 跨八代同面任务不变而各代新事态均以备案行承载过判）成立，故 SKILL.md 不改、收本备案行。file:line 现场见本块 code/deliverable.md。

**复发备案（2026-09-12 块 `1789231380042-bjj26jbq-1-清点13项新功能并合入本地main` update 第 1 次执行 REJECT——三问漏答＋沉淀未落地双硬门，「开工未读规则在盘」族复发；行号快照=写立前备案区尾行 :655、证据包形态学节 :661、本文件总行数 812；本行插入（含随行空行恰 +2 行）后证据包形态学节 :663）**：第 1 次交付基线表/阻塞清单翔实，但两条硬门全中——①update 三问全文零作答（要点 2；在盘旧交付 grep「三问|是否因未读|先查 skill|新东西」= 0 命中实证）；②自称「经验沉淀」却对 `.claude/` 零写入、§十仅为「给后续维护者的建议」（要点 1）。根因=「开工未读规则在盘」族复发（本节四要点与 skill-evolve :120「沉淀层交付纪律」均系更早块沉淀、在盘多时）。**本块另暴露结构性断链**：本节及多备案点名「动笔前必读 card-rebuild §4 / long-task-card / rejudge-recheck」，但 card-rebuild / long-task-card / rate-limit-reclose / rejudge-recheck / superseded-archive 五个 SKILL.md 在 HEAD 全部 ABSENT（`git cat-file -e HEAD:.claude/skills/<s>/SKILL.md` 逐一 exit≠0；五件系 stash@{0} 第三父 untracked，55825f7 整合未回填）——「必读链」指向不在盘文件，即便执行「先读」也读不到；属集成缺口，已移交 leader/code 线决策回填，update 层不代行整合。整改执行（第 2 次）：动笔前实读本节四要点＋备案族＋skill-evolve「沉淀层交付纪律」＋release/SKILL.md（含 v1.1.44 追加节口径）→ 三问成节作答（①是·开工未读；②是·5 条新经验，写前查重 0 命中；③第 1 次=否、本次=是）→ 技术沉淀实际落 `.claude/skills/release/SKILL.md` EOF 新节五条（park-stash 遗落机制/回填手法与断链/flaky 声称口径/clippy-android env/取证留痕）＋本备案行 → 全部落点写后 grep -n/read 回显嵌交付正文。

## 🔴 证据包形态学：穷举/零改/零写类声称的凭据形态（2026-09-01 rectify-filefocus-packaging 沉淀）

**场景**：交付（code/review/update 通用）要主张「附完整输出 / 无遗漏 / 前后一致零改 / 零 git 写操作」时，照本节组装凭据。有效性由块 `1788296392561-2` 实证：code 首轮四条 REJECT 全是证据形态问题，次轮**零功能改动、报告本体零改**仅重做凭据形态即 PASS。与同批 `-3` 块「证据口径坑」段互补（那段讲判官可见性/命令-输出自洽/多计数对账/零改动组合拳，本节讲集合穷举形态与复核手法）；字节级比对工具口径（jq -j / wc -c）见上方 rerun 两层段。

**交付侧五件套**（缺一即 REJECT 形态）：

1. **完整输出全文嵌入**：命令原始输出逐字节全文进交付/证据包，禁 summary 表与 `exit=0` 式摘录替代（判官宇宙=交付材料，见上方 `-3` 段①）；唯一允许的改写 = 显式计数的确定性脱敏占位（单模式替换 + 替换计数 + 行数不变 + 复验标记）。
2. **集合「无遗漏」= 穷举三重奏**：①判定规则先行明示（何者登记、何者显式不登记——纯结构行/纯静态代码事实/仓库内测试事实三类可豁免但须事先声明）②被扫描对象逐行分类账（每行恰一标签，覆盖可程序化复算）③正交手段交叉验证（独立语义锚 grep 命中行逐行归账，命令原文可复跑）。只给规则或只给清单都可争议；交叉锚专防「分类账自身漏行」。
3. **「零改/前后一致」= 多时点双 hash + mtime 物理旁证**：T0（任何触碰之前）/T1/T2 三时点 md5+sha256 逐字节一致。T0 是历史值无法回溯重观测，故**采集时点纪律第一**（整改动作序列的第一个工具动作之前必采）；再加文件 mtime 早于块执行窗口的物理旁证，「两证合一」。最简形态（首采=尾采闭环）见上方 `-3` 段⑤。
4. **「零写/只读」= 命令全清单**：本会话全部相关命令的编号清单，逐条标注只读/写性质 + 会话存档 jsonl 路径供第三方独立解析复核（review 侧实测形态：全量提取 bash 命令 + 危险子命令扫描 0 命中）。模板先例见 long-task-card §6 合规声明；只说「仅用了只读命令」不给清单 = 无效凭据。
5. **大证据包落点**：证据包落工作仓**未跟踪**路径（`test-artifacts/raw/…`，git status 以 `??` 出现），被整改的原目录只允许刷新一页指针（路径 + hash + 内容提纲），交付可见性与「零 git 写操作」红线兼得。⚠ 未跟踪文件会被发布 commit 裹走（rules/rust-dev.md「未跟踪的 harness」节）——证据包保持未跟踪不 commit，赶发布窗时按该节三选一处置。

**review 侧五件套**：①亲跑超抽（实跑数 ≥ 抽样要求数，超抽是复核可信度的来源）；②**hash 复算法**——对「逐字节嵌入」类声称，用「现跑输出 + 已声明包装行」精确重算出对方声称的 sha256（包装行口径给算式，如 8765 = 8763 内容 + 2 包装行），把「内容看起来一样」升级为「hash 数学上可复算」；③mtime 物理旁证；④**反向找漏**——从被登记对象原文反向找断言、再查登记表是否收录，专治「登记表自身漏项」，是正向按表抽查的必要对偶；⑤明细程序化验——分类账/编号完整性用脚本复算，人工核对在 200+ 行规模不可信。同族手法见 rejudge-recheck「逆向重建判前字节复核法」（对象与方向不同：那边重建判官所见字节，这边重算交付声称 hash）。

**四个实测坑**（本块 review 轻微偏差实录，条条可迁移）：①**明细全对 ≠ 汇总对**——逐行分类账程序化复算 203/203 全对，手写汇总行却 41+33+116+13+6=209≠203（真实 58/24/106/9/6）：汇总统计必须从明细程序化直出、禁手写；同文件事实数字（32 M 转写成 33 M）以原始输出处为唯一真身，其余位置用指针。②**脱敏有残留面**——diff 正文占位为真，叙述段却写了被脱敏 IP 的字面值：脱敏后要对全文（含叙述段、映射表）跑敏感模式扫描归零，映射用类型描述（「1 处公网 IPv4」）不写全值；计数自查既有口径见 rules/common.md「dump 类取证落盘前必须把消息正文脱敏」节。③**markdown 嵌入会剥行尾 CR**——字节级声称措辞改「语义逐行一致（行尾 CR 除外，markdown 嵌入口径）」；严格字节级证据走附件 + hash 锚定，**hash 可复算性是字节级瑕疵的救命绳**。④**偏差如实披露是可信度资产**——行号抽验 20 点中 2 点偏差主动登记，review 独立现读证实「披露属实」后写进 PASS 理由；藏偏差被发现是致命伤，报偏差被证实是加分项。

**复发备案（2026-09-02 块 `1788310328890-1-archive-cleanup-stubs` update 第 1 次执行 REJECT）**：三问/沉淀落地/集合上界三层自评均完整、CLAUDE.md:601 四条沉淀被判官明示「完整」，唯一驳回点＝**计数类证据矛盾**——查重 grep 声称「8 行命中」却同段逐一点名 11 个 file:line（8≠11，违反共同核心第 6 条「计数类证据须解析数值并与声称一致」）。根因＝声称值未从同一份枚举输出里现数（心算/誊写失真；整改时两种大小写口径实跑均恰 12 行=11 异域+1 自引 CLAUDE.md:601，无任何口径可得 8）。整改执行（第 2 次）：沉淀零改、仅重做证据形态——全部计数声称由本轮工具全量枚举直出（先枚举后断言）、自引命中单列排除口径、交付附录数字单源表逐条对账（同族于上方「证据口径坑」段③ 多计数对账、上方复发备案②「声称 20 行只举 4 示例」、四个实测坑①「明细全对≠汇总对」；本块新增性＝**自引排除口径**：沉淀落盘后查重 grep 必然命中沉淀自身，「零既有覆盖」结论必须显式减除自引行后成立）。

**复发备案（2026-09-02 块 `1788312588493-2-img-fix-f5` update 第 1 次执行 REJECT）**：交付正文翔实（7 决策/8 坑/5 建议、判官两轮 REJECT 引证俱全）仍被 REJECT 两条——①三问必答全文缺失（要点 2：交付 §0-§8 无一节作答三问）；②沉淀只写成「候选清单」并自书「本执行不写入 skill/rule，仅提名」「.claude/ 零触碰」，把落点决断反向委托 skill-evolve（要点 1：交付里只写「供采纳」= 未沉淀）——而候选清单本身已记载「同型 REJECT 在兄弟块 f1f2 复发」「建议固化为模板」，即明知应沉淀而不沉淀、还把「零写入」当合规项写进红线自查。会话档 grep 实证根因：该次执行全程未读 CLAUDE.md 与 skill-evolve（pattern「update 层交付四要点|三问|skill-evolve/SKILL.md|CLAUDE\.md」在该次会话档 0 命中；其格式参照的 f1f2 update 交付里就引过同型 REJECT 仍照犯）——「开工未读规则在盘」型复发（同族于 gen5 / rectify-localvm-p-stage / rectify-filefocus-packaging 三例）。整改执行（第 2 次）：code/review 层证据形态教训落盘为本文件「🔴 code/review 层验证类与覆盖面类交付的证据形态」节 + 本备案行；交付内三问成节必答 + 落盘 file:line 现场回显。

## 🔴 code/review 层验证类与覆盖面类交付的证据形态（2026-09-02 img-fix-f5 沉淀）

**场景**：code/review 层交付要主张「测试/typecheck/lint 通过」「零触碰/零命中/零落盘」「消费点全量有出口」「无新增 unhandled rejection」时照本节组装凭据。有效性由块 `1788312588493-2-img-fix-f5` 实证：该块 code 首轮 5 条 REJECT + review 首轮 3 条 REJECT **无一条指向实现正确性，全部是证据形态与覆盖面**，次轮实现零改动、仅重做证据即双 PASS；同型问题在兄弟块 f1f2 的 update 沉淀（其 §3-1/§3-3）已复发过一次——模板化是终结整类 REJECT 的唯一路径。与上方「🔴 证据包形态学」互补：那边管穷举/零改/零写类声称，本节管验证/负向/覆盖面类声称。

1. **「验证通过」类声称 = 可复算锚点三件套**（缺一按 pool=opaque 处理，不得单独支撑 PASS）：①`git hash-object <被测文件…>` hash 入档——复核者同命令复跑一致即证「被测文件与测试输出同一现场」（本块 71a4a70…/9194f4d… 被 code 与 review 双方独立实测一致）；②每条命令**完整终端输出原文**入档（vitest 汇总行/Duration/pnpm 头都在内），自拟摘要行与裸 exit 数字都算 opaque；③exit code **无管道直取**：`cmd > log 2>&1; echo $?`——管道后 `$?` 是末命令的，`cmd | tee` 再取已失真。
2. **负向声称（零命中/零触碰/零落盘）四要素**：①完整管道命令原文、两侧不可分离（`git diff HEAD -- <文件> | grep -c '关键词'` 的 diff 侧与 grep 侧同给）；②真实输出（含 `grep -c` 的 `0`）；③`echo $?` 回显并注明语义——grep 无命中 exit=1 是**预期**不是故障；④**扫描范围正向计数**——先 `grep -cE '^\+[^+]'` 数出被扫新增行全集（本块 101 行）再扫，证明没有漏扫。C10 正对照防「查法错」，本④防「范围漏扫」。
3. **集合「全量」= 可复跑命令 + 分层计数 + 逐项归宿表**：①枚举命令原文（`rg -n 'xxx' --glob '!node_modules' …`）；②分层计数（本块：全仓 73 行 / src 生产代码 17 行 / 真实调用点 4 处，注释/mock/测试分开计）；③每个调用点的抛错链**追到终点 catch**（file:line 现查）才叫「有出口」，停在「上层有 try」不算。经得起他人加码的「全量」才是全量（本块 review 独立复跑补出上游未列的 useComposerTrayOutbox markFailed 出口，反而加固了结论）。
4. **「零新增 unhandled rejection」双锚点**：①机器级——vitest 把 unhandled rejection 以 unhandled errors 判 FAIL，故「全量 exit=0 **且** 日志 `unhandled` 关键词 grep 计 0」即机器证明（本块 367 文件 4102 用例全绿 + grep 0 命中）；②人工级——每个 await / return-promise 链逐点追到终点 catch。口头结论、或只有人工链没有机器锚，都按未证明处理。
5. **任务卡点名项必须显式成节回答（review 层头号 REJECT 源）**：codeTask/reviewFocus 点名的每一项都要成节给核实过程与证据，**排除性结论（「不在抛错面/零改动/不适用」）也是得分点，沉默 = 漏项 = REJECT**——本块 review 首轮漏答 fileCache.ts:325 链即被点名驳回（实测该链为 sync 函数 `resolveDisplayUrl`/`proxyResourceUrl` 喂 `<img src>`，签名上进不了 async 抛错面且 diff 零改动，答「排除」后过审）。配套判别法：**消费点先按抛错面分层再逐点**——sync 函数无法 await/无法抛，先分层可整面排除伪遗漏；跨文件引用行号先现场重锚（任务卡 :325 实际漂到 :342/:409）。
6. **review 交付头部机器可读 frontmatter + 整改映射表**：头部 `blockId`/`step`/`verdict`/`reviewedBy`/`reviewedAt`/`reviewedTarget` 齐全且 `verdict` 值与正文结论一致（判官/下游按字段机读，正文 PASS 而 frontmatter 缺失 = 格式 REJECT）；整改轮交付以「判官上轮 REJECT 点 → 本轮闭环位置」映射表开篇——可细于理由条数（拆分行可以），不可漏行、不可把未整改写成已整改（本块 code §0 六行对 judge 5 条理由、review §0 三行对 3 条理由，第 2 轮均一次过）。
7. **跨块「零改动/新增仅 X」声称 = 开工基线集合 diff + 前驱锚点复算（双向纪律）**（2026-09-02 块 `1788317606883-1-img-fix-artifacts` code 第 3 轮实证，判官前两轮 REJECT 首因）：①开工第一时间（**任何写入之前**）落盘**全量**基线——`git status --porcelain=v1` 全量快照 + 全工作树逐文件 sha256 清单（**未跟踪集合是「新增仅 X」的主战场**，只查 `^ M` 已跟踪修改面必被打穿）；收尾**同一条命令**重跑，两清单剔除本块产物后做集合 diff（exit code 直取）。②基线里非本块的每个未跟踪条目逐条 `grep -rF` 前驱块档案目录给归属——「新增仅 X」的穷举证法是逐条归属，不是「看起来都像别的块的」。③与每个前驱交付**明文记录过的哈希锚点**现场复算（`git hash-object` / `git diff HEAD -- <文件> | sha256sum`），前驱有 diff 留档的对上留档哈希+mtime——**前驱写锚点、后继复算锚点是双向纪律**：你交付里写下的每个哈希与留档路径，就是后继块验收「业务面不变」的对账依据（本块 F5 两文件 hash-object、F1F2 401 行 diff 留档 sha256 双锚点一次对上）。④交付尾部给判官可逐条复跑的 verify 命令清单，**每条附预期值**（「status 应 61 行/43M/18??」「spec sha256 应为 8b87113d…」）。⑤过滤后集合的文件数必须对过滤后清单直接统计，禁用「未过滤总数−净差」心算拼数（本块 review Minor 实证：236−2 拼出「234」，过滤后实为 69——实质 diff=0 成立、数字仍记复核发现项）。

## 🔴 live 现测（live E2E）交付的证据形态（2026-09-02 块 `1788357052593-3-e2e-live-test` 沉淀）

**场景**：交付要主张「隔离环境当前刻实测某链 通/不通」（HTTP 状态码/DB 行/对象字节/浏览器跑批等 live 运行时证据）时照本节组装凭据。有效性由该块实证：code 三轮判决（REJECT→REJECT→PASS，judge.jsonl L1-L3）全部围绕证据形态收敛，run3 零功能争议；review 轮再以 A/B 两处「文本↔证据」不一致退回 code（L4-L5）。查重口径：pattern「断点层位|三重锚|自命中|不可复算|当前刻|verify-manual」在该块沉淀落笔前 `.claude/` 全树 0 命中（update 会话 grep 实测）。与上方「🔴 证据包形态学」（穷举/零改/零写类）、「🔴 code/review 层验证类」（静态验证/覆盖面类）互补：本节管 live 运行时证据。

1. **不可复算池证据三重锚**：HTTP/DB/MinIO/Playwright 的 live 结果无法从 git 复算，任一单锚不可采信，三锚齐备才够——①关键步骤原始 CMD+OUT 直接嵌交付正文（判官宇宙=交付材料，run1 因「只有 evidence 路径自指」被驳）；②evidence 文件全量入 SHA256SUMS（`sha256sum -c` 逐项 OK 防篡改）；③verify 脚本对**当前环境** live 断言且每条给期望值（run3 `PASS=21 FAIL=0`，判官可亲手复跑）。git pre/post 指纹只证「源码零改动」，**不证运行时现态**——把运行时对象（PID/message_uuid/对象 sha）当 git 对象现查会被 exit=128 打穿（run1 判官原文），git 指纹降级为辅助证明。
2. **锚点与证据本体同域**：live 证据的可核查锚 = 嵌正文的原始输出 + sha256 固定的 evidence 文件 + 可复跑 verify 命令；隔离环境可能被回收，交付需写明「live 项届时以静态证据 + 清单校验为准」的降级口径。
3. **三态结论词汇 + 断点层位 + 缺口指名**：每链结论必须写成「当前刻 通/不通/BLOCKED」（「三态」在 test-all 语境另有 clippy-android 三态义，勿混）+ 逐断点层位（鉴权/发送/落库/对象/投递/ack 各给 ✓ 或定性）+ 不通/BLOCKED 时指名缺什么、归谁管（本块「后端侧 gate 集群 18801/18802 启动」）。环境缺位的层（隔离实例无桥进程）标「未验」并说明为何非断链——「实跑 1 failed 却宣称非 BLOCKED」是 run1 三条 REJECT 之一。
4. **失败留证即资产**：撞上 401/过期等环境性失败时三段原样保留（失败输出→修复→重试成功），修复动作登记为写操作；现场发现的现态结论（access token 有效期=900s →「先登录再用」）如实沉淀，不掩盖也不粉饰。
5. **计数声称 = 枚举现数 + 自身括注连乘对账**：登记表/正文的行数必须来自 `SELECT count(*)`/`GROUP BY` 现跑输出，落笔前与声称内自己的括注先乘一遍——本块实测「6 行」括注「每文件两行×6 文件」自证 12 而 DB 实态 12，登记表数字失实（review 轮 REJECT 依据 A）。
6. **负对照自命中口径**：负对照扫描与其正对照记录行同住一个 evidence 文件时，「命中文件=0」的声称在文件补完后必然不可逐字复现（重跑得 1，唯一命中=该文件自身的合成正对照记录行；review 轮 REJECT 依据 B）。负向声称写可复现口径：「真实凭据命中=0；文件命中=1，指明是第 N 号文件第 M 行的正对照记录行（合成样本，非凭据）」。
7. **已钉 sha 的证据文件不可为修文字而改**：SHA256SUMS 已收录的 evidence 文件即使有措辞瑕疵也不动（改则破校验链），只改未钉 sha 的正文/登记表并随改随更 sha 锚；verify 终验输出这类「由被校验集合派生的新文件」不入清单防自指循环。修后重审只需对被驳点逐字复跑，不重做全案。
8. **verify 脚本断言集随证据代际同步**：多轮 live 测试累积产物（消息/对象/行数）逐轮递增，verify 脚本断言数与期望值必须随代际更新（本块 16 项→21 项），交付注明脚本版本对应的证据代际，否则过期脚本反而制造假 FAIL。
9. **隔离栈现态速查（该块实测，后续 live 块直接复用）**：①测试账号 JWT access token 有效期 900s，用前先登录，链中 401 先查时效；②端点分隔符不一致：bot 预签名 `POST /api/storage/bot/file/{uuid}/presigned-url`（连字符）vs 用户侧 `POST /api/storage/friends_file/{uuid}/presigned_url`（下划线），一律源码现读勿互推；③分片 PUT 的 S3 签名全在 query、无 Authorization 头、空响应体=成功；`upload/confirm` 自动建消息无需再调消息接口；④`file-access-permissions` 每文件恒 2 行（owner/upload + read/friend_share），凡计数按「文件数×2」做预期；⑤e2e-real 前端腿硬依赖 18801/18802 gate 集群+nginx（后端线职责起停），用例运行时自注册随机账号、e2e-real 体系内无金库凭据；⑥宿主 `/work/pi-bot-link` 的 `node bridge.mjs` 是 pipeline 自有桥、与聊天后端无连接，审计桥 ack 层先做此排除。

## 🔴 生产只读现态排查（只读现测四问）交付的证据形态（2026-09-02 块 `1788368412762-1-srv-chan-retry-go` 沉淀）

**场景**：交付要主张「生产环境当前刻某链 通/不通」（只读四问型：生产库近窗计数 / redis stream 现态 / 对象落盘现态 / 进程未重启证明）时照本节组装凭据。与上方「🔴 live 现测」节互补：那边是隔离栈**主动打流量**（三重锚/verify 脚本），本节是生产面**只读旁观**（零写入零重启，证据=真实生产流量痕迹）；同宿主机并存隔离实例时的分滩见第 9 条。有效性由该块实证：code/review 双层首审均一次 PASS（judge.jsonl 2026-09-02T17:56:06 / 18:08:56，六项 reviewFocus 零返工）。查重口径：pattern「双证|正证|负证」「postmaster」「三重对齐|file-uuid-mapping」「MOVED|XLEN|XREVRANGE」「非主动探针|生产流量|真实流量」落笔前 `.claude/` 全树 0 命中（update 会话 grep 实测）；「金库」既有命中全为 `~/.claude/secrets/`（release/token 域），与本块生产金库 `/work/Atlas/server/.env` 无交集。

1. **通道与情报纪律——前驱情报正负双证后才可继承或推翻**：通道类情报（前驱临终判断「生产栈在本机 127.0.0.1」）照抄前必须抽验、正负各一：**负证**（同金库凭据连情报所指旧目标 → `FATAL: password authentication failed`）+ **正证**（同凭据连修正目标认证成功，且 `current_database()/inet_server_addr()/pg_postmaster_start_time()` 三字段输出与原始沉淀逐字同构）——双证齐备才写「修正前驱」（本块实况：生产 PG/Redis 数据面=mesh 节点，本机 5432/6379 为 build 实例；唯一例外生产 MinIO=本机容器，由磁盘直证另证）。跨项目复用兄弟项目沉淀的通道（金库 `/work/Atlas/server/.env` + psql 形态）时，交付给「同金库同目标认证成功 + 与通道原始记载抽 1 处逐字比对」即可把通道真实性从自述升级为对表证据。金库取值全程 `$VAR` 引用零明文（`set -a; . .env; set +a`；redis AUTH 走环境变量、输出只 `AUTH -> OK`；交付只枚举变量名不打印值）。
2. **判官健康探针的输出是四问共用的交叉证据源**：第零步 `curl -sS http://127.0.0.1:47613/health`（exit=0 原文入交付；三败停步条款未触发）除证判官活性外，字段直接复用——`bot_user_id` 即 redis stream key 尾段（Q2 探查目标）、`cursor` 为 stream entry id 格式（与 stream 探查互证）、`uptime_s` 会话首尾两次单调增=桥进程未重启旁证（Q4）。此类卡探针端点即被测进程自身监听口（`bridge.mjs:32`/`:912`），「探针通过」与「被测链活着」同一性成立。
3. **语义先正本再下探**：探查对象的方向/机制先以代码锚定——`update_queue.rs` 只对 receiver=bot_ 前缀入队 ⇒ `bot:updates:{bot_id}` 是**用户→bot 方向**的更新队列；bot 出站 ack=HTTP 响应本身（`bridge.mjs` `done(200,{ok,message_uuid,seq,file_size})`）、**无独立出站 stream**。不先正本就会把出站 ack 查成不存在的 stream、或把入队 stream 误当出站证据；两方向各由哪问承载要在交付里写明。
4. **直连不可达→落任务卡明文允许的替代口径，再以独立直证补强；失败留证标「未采信」**：生产 MinIO 端口 TCP 不可达时改走 DB `file-uuid-mapping` 近窗行计数（任务卡明文允许），再以本机数据盘只读 ls 补强；**三重对齐**（DB 映射键 ↔ DB 消息 send-time ↔ 磁盘对象 mtime **同秒**、file-size **逐一相等**）即把「DB 口径」升格为「生产 MinIO=本机实例」实锚。降级前的直连尝试失败（sigv4 两次 403）三段原样披露并标「未采信、不影响结论」——失败留证即资产（与 live 节第 4 条同族）。
5. **「未重启」组合拳与会话外重启的归属证明**：本机面=会话首尾同命令 `ps`，**PID 全等 + etime 增量≈墙钟差**；无 exec 通道的远端数据面=`pg_postmaster_start_time()` 会话首查+复查同值证「会话窗口内无二次重启」，查得的重启时刻先于会话即如实披露「会话外重启、非本会话所为」，并以重启后业务连续性（近窗消息落库+stream 持续入队+seq 单调跨重启点）证「重启后链路仍通」。对照表每行注明 BEFORE 取样来源与时刻（本块 review 备注级瑕疵：nginx 行 BEFORE 实取自甄别 ps 而非基线命令，数值真但口径未注记）。
6. **只读现测的「通」可锚定近期真实生产流量，但必须限定「非主动探针」**：纯只读卡不能主动触发发送，「通」的判定=近窗（如 48h）真实流量证据链（近窗计数+最近 N 条时间戳距探针时刻+契约字段原样），结论行必带限定说明「基于近 X 小时真实生产流量证据链，非主动探针」；无近期活动/不可达时按三态如实降级——不越证据下结论。
7. **脱敏有效性给「正负对照三件套」而非自查声明**：①正对照=同一数据两种形态并排（调试期原始 RESP dump 含完整载荷 vs 正式输出同 entry 仅 `[payload redacted]`+`from=Huan****`）；②正对照=规则内联 CMD 可见、OUT 生效（SQL `regexp_replace('(conv-[A-Za-z0-9_]{4})…'→'\1****')` 输出 `conv-Huan****-…`）；③负对照=非敏感契约字段（file-url/file-uuid/seq/时间戳/文件名段）原样放行，防脱敏误伤可复算性。最硬形式=复核侧对金库**全部敏感变量实际取值**逐一 `grep -c -F` 交付=0（只输出计数、不回显值）。坑：**脱敏约定行的示例值本身也要脱敏**（本块约定行以完整 IP 作「被脱敏示例」=review 备注级 N1；两值在簇 C 交付已在案无泄漏增量，但「约定行连示例也脱敏」才是自洽口径）。与 rules/common.md「dump 类取证落盘前必须把消息正文脱敏」两问自查互补：那条管「别搬进去」，本条管「证明已遮干净」。
8. **只读 redis 探查含集群重定向时保持命令面纯净**：首试命中集群 `MOVED <slot> <node:port>` → 只读跟随到持槽节点即可，全程命令面限定 `AUTH/PING/XLEN/XINFO STREAM/XREVRANGE`；ENTRY 只打印 id/ts/类型/seq/标识前 4 字符，payload 全遮蔽。只读性证明用「写特征扫描+逐条甄别」：全文 `XADD/XTRIM/kill/INSERT` 命中逐条核对（本块全部为源码引文/前驱事件文件名/散文，零执行）。
9. **同宿主机并存隔离实例时的分滩写法**：交付设独立一节声明「未查询、未引用 E2E 隔离面任何数据」，进程对照表中隔离实例行显式标注「非本卡对象」；本卡生产结论与姊妹块隔离实例结论互不引用——同宿主进程共存不构成证据交集。

**实测坑（本块 review 备注级，条条可迁移）**：①自称「OUT 原文」就不得截尾（本块 §2 probe 行被截去只读声明尾段=review N2，数值零差异，但「原文」口径要连尾段保留）；②磁盘对象物理字节≠库内 file-size（XL 分片 part.1=业务字节+32 分片头，review N4）——落盘对齐主张用「mtime 同秒+键名+库内两表尺寸互证」，勿以「磁盘字节数=库内尺寸」作断言；③SQL 列别名笔误（`sent_utc` 实为 +08 本地时间）在 OUT 原文保留不改、以正文勘误注为准。

## 🔴 判前指纹双分支预授权门——整改已落盘未获判挂账的收口模式（2026-09-05 块 `1788593077505-1-e2e-ab-close-retry` 沉淀）

**场景**：上游整改指令（如 review 层 A/B 文本失实）已由前会话落盘，但该块未获判（code 三连 REJECT 升级/ESCALATED/中断）；续跑收口块开工实测对象文件判前指纹≠判时锚——这恰是「整改已在盘」的地真而非漂移事故。照本节分支门收口，禁止自作主张恢复判时基准或盲目重改。

1. **双锚定分支＋两不匹配即停步**：开工 sha256+字节+行数实测对象文件，与判时锚（分支 A）/整改后锚（分支 B）比对：命中 A=按原卡现场落整改走全证据链；命中 B=**对象文件零触碰**，改走机械恰最小性证明；两分支均不匹配→零编辑停步 BLOCKED，原始输出全量入交付。分支判定与卡面预授权原文载交付 §0；写前/写后 sha256+mtime 留证——判官「不一致即停步」驳回针对的是无授权自恢复，预授权分支命中后零编辑零恢复即合规。
2. **非 git 区机械可复算性=双向 patch 闭环**：pipeline 记录区非 git 仓（`git rev-parse` exit=128 实测），git cat-file 核验天然不成立；可复算替代物：/tmp 沙箱对在盘文件逆应用整改 diff → sha256 精确命中判时锚（该锚另与 review 交付独立在案锚逐字一致）→ forward 复应用 → sha256 精确命中在盘实测；判时版重建副本存本块 evidence/ 留 sha256；有兄弟块 judged-baseline 副本时同 sha 交叉。
3. **恰最小性证明三件套，禁 cmp 单点报告代证明**：cmp 只报首个差异字节，证明不了「编辑行外零差异」（同字面 REJECT 在案）；改用：双向 patch 双 sha 精确命中＋ed 行号集（diff hunk 头解析 '+' 行号全集，应恰等于卡面指令行号集）＋`diff -u` 全文嵌入交付，三者合成恰最小性。
4. **SHA 链覆盖缺口双轨并载**：`sha256sum -c SHA256SUMS` 全 N 行 OK 原文入交付，只证 evidence/ 件；对象文件完整性由直接 `sha256sum` 原文承担，并明载「SHA256SUMS 仅钉 evidence/ N 件，不含对象文件」——只报计数不载原文、或让 SHA256SUMS 冒充对象文件校验，均为同型 REJECT（三连 REJECT 第 2/3 轮各中一次）。
5. **零写入分窗分滩如实归因**：本会话窗口=`find <上游两块＋业务仓> -newermt <本块开工时刻>`（空输出即零写入原文入交付）；历史多会话写入按 mtime 归因表逐项披露（哪会话何时写了什么）；业务仓（git）与 pipeline 区（非 git）分滩表述；禁止把「本会话零写入」超称成「判前零写入」。
6. **集合上界两分面各自单源闭合**：沉淀查重上界=业务仓 `.claude` 全树可复跑枚举＋计数（CLAUDE.md / skills/*/SKILL.md / rules/*.md）；另补 pipeline 面枚举 `find <pipeline 项目区> -type f \( -iname "*SKILL*" -o -iname "*CLAUDE*" \)`（2026-09-05 实测=0）。两分面各出各的命令＋计数，禁止合并一个命令冒充两域全集（覆盖范围声明与命令实际范围不符=同型 REJECT）。

与 rejudge-recheck :151-152「判前指纹先行」分工：彼管补裁送判时「指纹一致才可送」；此管收口续跑时「指纹不一致=整改已在盘」的分支判定与零触碰证明。六类高频 REJECT（停步条款/git 不可验/cmp 代证明/SHA 链覆盖缺口/零写入口径超称/上界漏 pipeline 面）逐条对应本节 1/2/3/4/5/6。

①本节同源案例的 update 层沉淀曾因三类违例三连 REJECT（落点证据不可现查/上界未机械闭合/指针式自证）；
②合规写法=写前后 sha256sum+sed 全文内联（未跟踪目录 git 通道不可见，逐字节现场证据为准）、上界=find|wc 与逐行名单成对且全文唯一计数、禁一切「见会话档」式指针自证；
③案例锚=块 1788615381635-2（三连 REJECT）与本块（收口）。
④跨代卡0 违例的真身整改重送收口（2026-09-06 块 `1788658498730-1-e2e-update-resend` 沉淀）：fresh formal 回填只治「块自身无裁决」（裁决缺失），不产生以新块名义的 directive 逐项整改——历史违例（如 1788368412762-3-e2e-ab-closeout 判审 L3「判前 sha 不一致未停步上报禁编辑」）的整改重送=重送块按原 REJECT directive 合规形态产出自身 code+update 交付、三套指纹对账（判时锚 528b7228…/a0e1fe09…/整改后锚 54886c66…/fd5de775…/现测值逐值相等表）、双分支预授权原文载重送交付 §0；两轨互补不可互替：回填不豁免重送，重送不撤销回填；
⑤重送块零违停步实证三件套=分支 B 命中（在盘值=整改后锚）+对象文件零触碰（写前/写后 sha256+mtime 全等）+双向 patch 恰最小性闭环（沿用本节 2/3 条）；上界两分面枚举必须定稿前复测现态——2026-09-05 实测 pipeline 面=0，2026-09-06 复测=2（1788633540977-V1R 块 code/evidence/CLAUDE.md.pre-write-copy 与 review/evidence/E18-claude-md-write.txt，均系块内证据留档副本、非活性沉淀面，逐件点名归因），时效复测缺口即超称缺口；
⑥案例锚=1788368412762-3（卡0 违例原判 L3）/1788593077505-1（分支 B 预授权首次合法收口）/1788658498730-1（真身整改重送收口）。
⑦本块 update 步去重收尾与跨代教训备案（2026-09-06 块 `1788658498730-1-e2e-update-resend` update 步沉淀）：updateScope 三主题（停步条款违例制度化闭环／真身重送与 formal 回填双轨适用差异／多代际指纹对表对账写法）已由同块 code 步 attempt-1 落典上行 ④⑤⑥ 三行（写前 760985ae…728 行→写后 25121af1…731 行，judge.jsonl L2 PASS 判时在案），update 步 read 去重判定=三主题全覆盖、零缺口零重复、④⑤⑥ 字节零改写，本行=落点区第 4 行处置史备案（恰在卡面「3-5 行补遗」窗口内）；跨代新教训三条入档：a）机械自检必须与交付文件自身 sha 解耦——占位符 grep／计数唯一／verdict 一致均设计为内容检查、对定稿终稿实跑、文件自身 sha 零内嵌零自指（code attempt-1 因自检 sha 自指不可复现被前判 directive ④ 打回，attempt-2 以解耦重设计过判）；b）git-log 行数推断对工作树未提交 M 态失明——HEAD 已提交版与工作树版各行其域，commit message 的「零行号位移」不描述未 commit 文件（code attempt-1 由 d5ec0c8 摘要误推 CLAUDE.md 行数被前判 directive ③ 打回，attempt-2 以 git 通道全取证＋写前态机械重建消解）；c）append-only 键文内嵌时间戳必须取落盘动作即时 date 戳、禁事后凭印象回填（amendment2 键文自称 01:52:30Z、实际落盘 01:46:47Z，偏差 5 分 43 秒——判定与留档=本块 review 交付 F1 节，判官 L3 认定非阻断）；本步对账载体=本块 update/deliverable.md（含 update 步追加段）。

**双轨判别：statusNormalized 归一 vs fresh formal 回填（2026-09-05 块 `1788639028831-1-queued-formal-verdict` gen10 formal 补裁沉淀）**：限流/挂账块终态两轨互补不可互替——归一治「顶层标签」：台账 status 停在 RATE_LIMIT_QUEUED/ESCALATED/INTERRUPTED 而裁决已在别处在案时，只做顶层翻转＋statusNormalized{from,to,by,ts,basis} 双指针（steps/历史 verdicts/finalVerdict=null/rateLimitQueued 原样保留＝双裁并存），本身不产生新裁决，合法性全靠 basis 指针指向真裁决在案处（后继收口块验证/amendment），basis 落空＝无中生有；回填治「块自身无裁决」：steps 的 finalVerdict=null/该步 judge.jsonl 无 formal 判决行时，任何标签都替代不了块内裁决，必须先送判书→fw-judge formal 裁决（管线判官本体非 worker 自撰），PASS 回注才可回填。两轨先后皆可（本例先归一 by=1788609996044-1-e2e-close-adjudicate 12:16:30Z、后回填 21:33Z）；回填后顶层若仍挂起态仍需归一收尾。块级 result.json＝块生命周期终态事件（收口/挂账/刻碑）的落盘物、非逐判流水：in-flight 块（历史步已 PASS、末步执行中乃至末步 REJECT 待重派）result.json ENOENT 属机制预期——2026-09-05 本块实测：code/review 双 PASS＋update attempt1 REJECT（23:00:09Z）后块目录仍无 result.json，全管线 blocks 总 85 目录、result.json 在盘 84、差集恰=本 in-flight 块（对照：84 个已收口/挂账/刻碑块全在盘）；故 update/末步执行中的块级 verdict 判据＝judge.jsonl append-only 流水亲读；机制类「属预期」声称必须附此类在盘对照实证、禁一句话带过（本块 update attempt1 即因只一句「属预期」未附对照被驳，attempt2 补遗）。
回填三笔全 append-only：①标的块 judge.jsonl 恰 +1 行（rejudgeBy=执行块；note 四要素缺一不可＝gen 代际 formal 补裁事由/送判书判时 sha256/被补裁 card 绝对路径/后继验证链指针）；②标的块 REJUDGED.md 新建（四指针逐条可 cat 实核：新裁决行/送判书判时指纹三重链/后继双 PASS 链/statusNormalized 现值）；③标的块 result.json 恰 +1 键 basis.amendment（一句话指向 fresh 裁决：执行块名＋判时 ts＋引擎日志名；文本级定点插入禁 json.dump 重序列化，改后键级深比较除新键外逐键等价）。amendment 键＝两轨缝合点：顶层标签变更从此可回溯到真实裁决。
回填前置＝裁决真实性三重链（同 rejudge-recheck 写前置口径），任一断链→零写入报 BLOCKED-UNEXECUTED：a 后继验证链＝承接验证的后继块相关步 finalVerdict.pass 全 True＋其判时日志 sha256(delivery_full)==delivery_sha256==sha256(在盘) 三值相等（后继自身非验证步的 REJECT 不碍链，如实披露即可）；b 标的块 byproducts 现态抽核＝对象文件 sha/字节/行数/mtime 与整改后锚全等；c 标的块目录现态＝result.json/judge.jsonl/evidence 逐件与后继 basis 全等。
恰两笔指纹纪律：标的块 judge.jsonl append-only 全史恰两笔（原判行＋fresh formal 行）——写前全文件 sha256=3b81fd9a…（追加后 L1 前缀逐字节零改动）、写后尾行 sha256=79209a54… 即终态锚；送判书判时指纹＝引擎日志 delivery_sha256=c37a1705…（attempts 1/2 的 REJECT 版本指纹 b82d2a2d…/97c948bd… 各在其日志在案）；回填窗口 find -newermt 恰命中授权三件、其余逐件 sha 不变。数值形态＝在盘留档 sha256 字符串（本 update 层亲读标的块 judge.jsonl 第 2 行 note 与 REJUDGED.md 原文转录、未复算；复算命令 sha256sum 全路径，验证域＝标的块 pipeline 区，实测记录＝该块 code/review 交付）。
分工：本节补遗只钉「判别层」（先归一还是先补裁、何时两轨都要、回填终态判据），操作流程不重复——补裁送判与回写全流程＝rejudge-recheck（写前置三重链/步 4-6），归一键级断言与双裁披露＝rate-limit-reclose 阶段⑤；判例正文＝上述执行块 code/deliverable.md §1/§8/§9 与 review/deliverable.md 七项复核。

**升级块补裁收线的双送判模式（2026-09-05 块 `1788650740016-1-trio-formal-verdict` gen10 formal 补裁×2 沉淀）**：一收线块同批给多挂账标的补 fresh 裁决时，各标的送判书（A 补 update 步/B 补 code 步）共载于 code 交付单文件、一次送 `fw-judge --layer code` 双收裁决——判时指纹锚只有一个＝共载体引擎日志 `delivery_sha256`（2c2d03c8…），定稿版三口径自指备查（＝判时版减指纹节自身，指纹值只进本节不进被哈希文本，无自嵌）。
①共载体送判书编法：每标的四件套缺一不可——缺裁步实测（judge.jsonl 逐行解析＋result.json 该步 finalVerdict 亲读）；3×REJECT 历史逐轮双裁披露（旧 REJECT 原样在案不隐藏，且归因「全指向证据呈现形态、非结论被推翻」）；完成态两实证（后继代成块 result.json 三步 PASS＋唯一落点 sed 全文回读）；判时指纹口径。执行侧两坑：送判前先探 `FW_JUDGE_PROMPTS` 环境变量（漏配=ERROR 系执行侧故障非判官内容故障）；自检必须语义成对命令（`grep -c` 只出计数行、全文另行输出，管道接 wc 冒充行全文=拼接 REJECT）且对判时版实跑（probe→真值定点回填→闭合复跑）。
②已归档＋已过判并存的终态语义：ARCHIVED.md 标记＝历史阶段记录（append-only 零改零删），fresh formal 裁决＝终态背书——回填不翻转顶层 ESCALATED、不撕标记，只新增顶层 statusNormalized 单层键且 note 明文并存语义；已 PASS 块只在 basis 内恰＋1 键 amendment。归档与过判正交并存，谁也不覆盖谁。
③防递归：收线批次自产块（含收线块自身交付＝受判载体）日后挂账，补裁＝按引擎日志三重链（sha256(delivery_full)==delivery_sha256==在盘前缀）核验既有送判记录＋同款四笔回填，禁再派收线块对收线块收线——递归终止条件＝判时指纹三重链在案即可独立核验，无需重建送判书。
④案例锚与处置史：本补遗 lead＋①②③四行由本块 update 第 2 次执行落典（判官认「沉淀内容与单点落点证据基本完整」），该次交付因 update 层法定三问完全漏答被 REJECT——正典「三问必答」（本文件 :574 要点 2）与 skill-evolve「沉淀层交付纪律」纪律 2 早备，会话档 grep 实证该次执行零阅读动作，「开工未读规则在盘」跨块复发族再＋1；第 3 次执行整改＝三问逐问会话档实证作答＋追加本行处置史（写后补遗恰 5 行仍在卡面 3-5 行区间）。
**终末归一——已归档＋已过判并存块的顶层标签翻转收尾（2026-09-06 块 `1788655535877-1-stub-sweep2-normalize-final` 沉淀）**：trio 式回填落地后顶层若仍 ESCALATED，收尾必须派终末归一块翻转顶层标签——顶层标签是检查器「未决/挂账」的判定面，fresh 裁决在案而标签滞留＝按标签误报未决；写法＝文本级定点替换恰两处（顶层 `"status": "ESCALATED"`→`"PASS"`＋statusNormalized 整块换新 `{from:"ESCALATED",to:"PASS",by:归一块名,ts,basis{code,archived_marker}}`），写前唯一命中断言、禁 json.dump 重序列化、改后键级深比较 changed=[]＋diff 恰 2 hunk（本块实绩：`ca1f5cf1…c0f2`→`897b66a1…7e38`，18287B→18401B，B=`…/blocks/1788609996044-2-stub-sweep-2`）。
archived_marker 键＝「ARCHIVED 前提被取代」双裁披露模板三段式：①标记写入时点前提当时为真（「零判官背书」于写入时点 2026-09-05T17:19Z 为真）→②现被 fresh formal 裁决取代为终态背书（judge.jsonl 行号+verdict+引擎日志 delivery_sha256 锚）→③并存非矛盾（与 REJUDGED.md 指针 5/judge.jsonl note 同口径互证）；旧版 statusNormalized（trio note 版「顶层 ESCALATED 维持」）全文留档于归一块交付并经逆向重建 EXACT MATCH 背书＝append-only，标记与镜像零改写零删除（双侧 sha cmp IDENTICAL）。
坑两条：①被留档件末行无换行符时，交付围栏逐行呈现/sed 提取必补 `\n`，「留档 74 行」与「围栏 75 物理行」差 1 属呈现口径非保真缺陷，剥离补入换行后逐字节比对命中声称 sha 即闭合（本块 review ①1b：18288→18287B）；②恰最小性硬证＝从改后在盘件反施已知编辑逆向重建判前字节、sha256 与改前留档 EXACT MATCH，留档另有 REJUDGED.md:45 等跨锚点在案非孤证——cmp 单点报告不可替代。
终态判据＝四方交叉断言 CONSISTENT（顶层 status==statusNormalized.to==fresh 裁决行 verdict==后继重验块三步 finalVerdict 全 true）；操作流程不另起——归一键级断言与双裁披露＝rate-limit-reclose 阶段⑤、fresh 裁决三重链＝rejudge-recheck、双轨判别见上文 queued-formal-verdict 补遗；案例锚＝本块 code/review 交付（判官双 PASS）§2 留档/§4.4 读回。
**复发备案（2026-09-07 块 `1788788467490-2-修沉淀整改块复核交付证据` update 第 1 次执行 REJECT（judge.jsonl :4 2026-09-07T14:59:41.136Z exit=2，两条理由＝三问漏答＋§四验证记录只给结论性计数未附命令原文与完整输出；本行=第 2 次执行整改落地之一；行号快照=写立前锚定行＝「终末归一…终态判据」行（写后实测=:752）；本行落盘=:753＝写后实测 EOF（grep '沉淀者未自用'=:753＋read offset=753 无 more-banner 双证）；初稿误写「尾行 :750/总行数 750/本行=:751」系写前对 offset=735 起读出区间数行少计 2 行＋一过性尾行观测（offset=749 读曾报 2 more lines，offset=753 复读无）——凭印象数行 micro 复发，就地以写后 grep/read 更正（纪律 6/证 3 同源教训）））**：第 1 次执行已把卡面三条证据形态规则实际写入 `code-review/SKILL.md`（新节「review 交付自身的证据形态硬规则」证 1/证 2/证 3=:484-:562（节末行 read offset=555 实测；v1 口径 :559 系其未验坐标，第 2 次执行更正；第 3 次执行增补证 2/证 3 判 FAIL 形态各 1 条恰 +2 行后实测节末=:564、bullet=:814/:927、总行数 949→951）＋两次调用 prompt 模板 bullet :812/:925），但该交付自身四要点 2/3 全中＝**「沉淀者未自用」新变体**——同一会话正把「结论须配命令原文+完整输出」写进 skill，其交付 §四 却只写结论性 grep 计数且三问零作答；根因会话档实证＝该档（update/session/14-47-26）对交付纪律正典关键词 'skill-evolve|沉淀层交付纪律|三问|update 层交付四要点' 恰 1 命中（第 3 次执行逐词复扫更正初稿「全文 0 命中」：唯一命中=:16＝前块 v6 交付 toolResult 内容自带 'skill-evolve' 字样〔v6 本体 :13 即含该词〕，'三问'/'沉淀层交付纪律'/'update 层交付四要点' 三词 grep 均 No matches found；'CLAUDE\.md' 同工具实测 3 行=:7/:9/:10〔本块 review 交付/code-review SKILL/test-quality-check SKILL 三份 toolResult 内容自带〕，第 2 次执行交付所记「4 处」系将其合扫输出第 4 行〔:16，实际命中词=skill-evolve〕误归入 CLAUDE\.md；超长单行档 grep 匹配受行深/存储截断影响、深部字样可能漏配，本组计数只作定性归因不作精确词频）——四行命中均为所读文件内容自带字样、无任何指向正典的读取动作，结论不变——正典（本文件 :574 要点 2/3、skill-evolve :120 纪律 2/8）在盘未读，「开工未读规则在盘」族＋1，且该会话已亲读卡面点名的两个落点 skill（档 :9/:10 read 在档）＝查了落点、没查交付纪律。第 2 次执行整改：三问逐问作答（①=是·会话档 0 命中实证；②=是·3 条新东西；③=第 1 次部分——落点查了、纪律正典没查；第 2 次·是）；并修正新节两处不实引文（「13 条理由」→实测 11 条＝3+3+5；判官 14:23:23 指令引文由拼接改写复原为两段逐字引）——沉淀文本自身也须过其证 3 普查，增量教训就地生效。

**复发备案（2026-09-08 块 `1788867548355-P1-三通路文件传输只读诊断定位断点` update 第 1 次执行 REJECT（judge.jsonl 恰 5 行、REJECT=:5 2026-09-08T12:36:36.468Z exit=2，四条＝沉淀未落地〔update 层特有 2〕＋集合上界未答〔共同核心 7〕＋沉淀清单未点名〔update 层特有 5〕＋声称哈希按 commit 形态现查 exit=128〔证据不一致〕；本行=第 2/3 次执行整改落地；行号快照=写立前本文件总行数 758（read banner 实测）、EOF 备案行=上一行 `1788788467490-2` 行（grep '增量教训就地生效'=:757 恰 1 命中）、本行插入（含随行空行恰 +2 行）后总行数 760）**：第 1 次交付上游复述与域方法论提炼翔实，但四条全中——①自书「本沉淀零功能代码、零仓内写入」把零写入当合规项＝「卡面指定交付路径」调和型复发（同族 :611 虚构授权面/:627/:631/:657 第 13 例/img-fix-artifacts :603 家族，把踩中的红线当守住的红线）；②集合声称（三通路方法论/六个判定模式/三代零改动自证/四个坑/证据基础清单）无枚举命令+计数、无甲乙结构；③沉淀落点零点名；④引用 2d3c731e/7e570621/116e1028/ed66aaa6/6f04ea85 五个**文件内容 sha256** 裸列未标形态，判官按 commit 形态在 worksite 仓 git cat-file 现查全 exit=128（仅 a209c92 真实存在）——skill-evolve 纪律 8 哈希三声明（2026-09-05 落典）在盘而未读未用，非新类别系正典复发。会话档 grep 实证根因：attempt-1 会话档（update/session/12-30-34）pattern「skill-evolve|沉淀层交付纪律|update 层交付四要点」恰 1 命中=:14＝读上游 code 交付附录 E 时其 62 件哈希清单自带 `.claude/skills/skill-evolve/SKILL.md` 字样（toolResult 内容自带字样非读典动作；超长单行档 grep 有截断风险，只作定性归因）——「开工未读规则在盘」族再＋1。整改执行（第 2 次）：动笔前实读 skill-evolve「沉淀层交付纪律」全文（:124-:138 纪律 1-9，纪律 8 哈希三声明=:137）＋本节四要点与备案族＋judge.jsonl 五行 → 域方法论实际落地**新建 skill `.claude/skills/three-pathway-diagnosis/SKILL.md`**（三通路无关性证明/五步执行法/七判定模式/零改动自证三代+落盘四件套/gen14 断点结论 C1-C5·Z1-Z10 索引·SR-CR 归属/N1 四环证据链/并发覆盖恢复配方/域内证据红线五条/来源与哈希三声明；锚点全部本会话 grep 亲验含符号锚；写前查重 pattern「三通路」.claude 全树 No matches found=新案、「minio:9000|optimizePresignedUrl|IMAGE_MAX_RETRIES|无声失败」仅 2 处异义命中已甄别）＋本备案行；判官四条逐条闭合：①②③=该 skill+本行+交付 §沉淀清单（已写 2/未写 30 点名+取舍）、④=交付哈希清单全量三声明；按 :645 三柱自检：柱①四驳点全落四要点 1（:569 节）/4＋纪律 2（:125）/6（:135）/7（:136）/8（:137）射程，无 update 层交付纪律新类别→skill-evolve/SKILL.md 零改（纪律 8/9 在典本会话 read+grep 亲验）；柱②域方法论通道=独立域 skill（同 ui-real 先例）非正典节非 skill-evolve。file:line 现场见本块 update/deliverable.md。

## 🔴 VPN token 生命周期与注入链速查（2026-09-09 · block 1788964672726-1-修VPN页热更新断连与token认证 沉淀）

> 背景：安卓 VPN 覆盖页「Token 无效或已过期」401 刷屏（code/review 双 PASS 已修，块窗 2026-09-09）。以下 file:line 为 2026-09-09 工作树值，经本块 update 层 read/grep 亲验（输出原文见该块 update/deliverable.md §4），位移以 grep 现查为准。

- **签发**：`POST /api/auth/login` 签发 JWT，有效期 15 分钟（`src/contexts/SessionContext.tsx:137` 注释「JWT 15 分钟、提前 5 分钟刷 ⇒ 约每 10 分钟一次」）。
- **刷新双通道**（均在 SessionContext）：
  - **主动**：解码 JWT 取过期时间，`expiresAt - BUFFER_MS`（`:184` `BUFFER_MS = 5 * 60 * 1000`）到点前定时 `api.refreshAccessToken()`（`:185-:192`）；
  - **被动**：api client 收 401 走 `refreshAccessToken()`（`:201`）。
- **轮换与分发**：两条路都落 `updateTokens`（`:113`）→ 持久化 ＋ `emit('session:tokens-updated', …)`（`:126`）**广播给所有窗口**——VPN 覆盖页/子窗口的新令牌唯一来源是这条事件（`:170` 为请求侧同步回路的 emit 点）。消费侧注入：VPN 页 `windowData.accessToken` → `serverApi.serverFetch` 的 `token` 入参（`src/huanvaeGuard/serverApi.ts:44`）→ 请求头 `Authorization: Bearer ${token}`（`:54`）→ `/api/hg/*`。
- **🔴 排障判据一：401 刷屏先查注入路径，别先怀疑后端吊销。** 后端刷新轮换**不吊销**旧 access token——五步 curl 排除实验（上游证据 `/work/vpnpage-fix-evidence-1788964672726/logs/curl-oldtoken-exclusion.txt`：步骤 4 用旧对 refresh 轮换出新对后，旧 access token 调 `/api/hg/devices` 仍 HTTP 200）。⇒ 页面 401 只能是手里拿的是过期快照。
- **🔴 排障判据二：快照被重置的两个已知坑（都已修，回归别退回去）**：
  - **每次渲染传新对象 ＋ effect 依赖 initialData** ⇒ 父组件每渲染一次就把 `windowData` 整体重置回开页那一刻的 token 快照（安卓上主窗口 WS 重连风暴每几秒 re-render，重置连发；主窗口刚同步进来的新令牌随即被旧值覆盖）。修复：`HuanvaeGuardPage.tsx:431` `initialDataRef = useRef(initialData)`（开页数据挂载消费一次）＋ `:442` 依赖仅 `[addLog]`。
  - **initialData 引用必须稳定**：`MobileGuardPage.tsx:38-:41` `useMemo` 依赖 `[data.userId, data.serverUrl, data.accessToken, data.refreshToken]`——只有真拿到新令牌才换引用。
  - **判别式**：页面日志先出现「已从主窗口同步访问令牌」、随后 401 连发 ＝ 快照重置型（查上面两个坑）；从未同步成功 ＝ 查 `session:request-tokens`/`session:tokens-updated` 回路与 master 侧凭据。
- **落笔自律**：纯 EOF 追加、`-` 项目符号、零改前文。

**复发备案（2026-09-09 块 `1788964672726-1-修VPN页热更新断连与token认证` update 层执行被拒（judge.jsonl :6 2026-09-09T17:19:32 exit=3 jitter empty_output 判官故障未成裁；:7 attempts:2 2026-09-09T17:20:59.314Z exit=2 五条 REJECT ＝ 三问必答缺失＋沉淀未落地 skill/CLAUDE.md＋测试/AVD 全绿声称无输出证据＋三仓零改动声称无现场证据＋集合声称缺枚举命令；本行=第 3 次执行整改落地）**：被拒执行（其会话档 update/session/2026-09-09T17-12-39-*.jsonl）经本会话 grep 亲查：'update 层交付四要点|skill-evolve|三问必答|沉淀层交付纪律' 与 '\.claude' 均 **No matches found** ＝ 开工零读正典，「开工未读规则在盘」族＋1；其交付两份领域文档只在 deliverable 正文 §2/§3 呈现、对 `.claude/` 零写入。整改执行（第 3 次执行）：动笔前实读本节四要点与备案族 → 领域文档实际落地两处（`HuanvaeGuard/.claude/CLAUDE.md` 附录三十七「client 控制面（配置热更新通道）断连条件与平台分支速查」＋本文件上方「🔴 VPN token 生命周期与注入链速查」节）＋本备案行 → 三问成节作答 → 集合声称全部附枚举命令＋计数（daemon.rs connected 写点 grep 15 行分解 2/3/1/9）→ 测试/AVD/零改动类声称按锚点二分：read/grep/ls 可亲验的亲验嵌正文，shell 类数值（cargo/vitest/tsc 重跑、AVD 实拍、git 对账）一律标【转述】引上游 review/evidence/* 具体档案名并注「本层未复算」。skill-evolve 零改（五条全落四要点 1-4＋共同核心 2/7 射程，无新纪律类别，:621 口径锚；查重命中只免除正典本体重复写入，不免除本步增量落地）。file:line 现场见本块 update/deliverable.md。

**复发备案（2026-09-09 块 `1788964672726-2-统一远控UI并修信令断开` update 第 1 次执行 REJECT（judge.jsonl :6 2026-09-09T18:14:57.977Z exit=2，五条＝沉淀有声明无落点〔update 特有 2〕＋凭记忆/自述无证据〔共同核心 1/2/3〕＋行为证据引自上游未附出处原文〔共同核心 2、update 特有 1〕＋集合类声称未给上界〔共同核心 7〕＋file:line 无现场可核对证据；本行=第 2 次执行整改落地）**：被拒交付把两份领域文档（远控信令 ws 状态机与重连机制、远控页设计 token 对照表）只写在 update/deliverable.md 正文 §2/§3，对 `.claude/` 零写入，且通篇「亲手 grep/read 实测」无任何工具输出原文嵌入——「沉淀只在交付正文」家族（同族 :599/:603/:605/:609/:611/:645/:759）＋「转述代替实证」双中。整改执行（第 2 次）：动笔前实读本节四要点（:573-:576）与备案族、skill-evolve 全文、判官 REJECT 原文（本块 judge.jsonl :6）→ 领域文档实际落地两处＋本备案行：①**新建 skill `.claude/skills/remote-control-signaling/SKILL.md`**（三条信令链路总览与误报复盘判别式／useWebRTC 常量与心跳看门狗 pongTimedOut 标记／shouldReconnectOnClose 决策表／scheduleReconnect 两条置错路径分流表／error 生命周期＝常驻横幅机理／ControlWindow 三态机与宣断时延公式／WebSocketContext 世代守卫速查／空 token 误报四环判定与守卫根修／改动自查命令／排障速查表）；②**新建 rules `.claude/rules/remote-control-ui-tokens.md`**（收敛纪律四条+深色舞台取色语义+42 token 全表分五类（定义行号本会话 42 名候选全集 grep 恰 42 行零多零少锚定）+豁免与残集上界三类+假 token 化暗道排除+改样式自查命令 4 组+历史教训三条）；证据形态按 :613 锚点二分——file:line/集合成员/枚举一律 grep/read 工具实测原文嵌交付正文并标「[本会话实测] 工具名+参数」，shell 类数值（95/106/42 计数、vitest/tsc RC、AE 像素、cmdlog 行为实测）一律标转述引上游具体 § 与档案名并注「本层未复跑」；查重 grep（ControlWindow|LinkState|scheduleReconnect|remote-control.css|远控页 等 3 组）.claude 全树 No matches found=新案。file:line 现场见本块 update/deliverable.md。

**复发备案（2026-09-09 块 `1788964672726-2-统一远控UI并修信令断开` update 第 3 次执行交付被拒（judge.jsonl :8 2026-09-09T18:35:50.110Z exit=2，三条＝沉淀落点现场不可核〔update 特有 2〕＋声称附证据不成立/依赖上游转述〔共同核心 2〕＋frontmatter HEAD 与判官现场矛盾〔共同核心 3/6〕；本行=第 4 次执行整改落地）**：被拒交付已把两份领域文档真实写入本仓 `.claude/`（上条备案），但 frontmatter 只声明嵌套仓 HEAD（79ce79a4…），判官按外层 /work 仓（HEAD 22ab5fe45…）git cat-file/merge-base 核对得 exit=128＝按「取证失败」从严——**教训：判官 worksite 核对面是外层 /work 仓；嵌套仓（自带 .git 的 /work/Huanvae-Chat-App 等）的 commit 哈希在外层仓对象库永远查不到，落点必须声明为「工作树文件＋ls/read 核对面」，禁止单给 git 对象哈希作证据；交付正文必须自含沉淀文档全文，截段自述不算存在性证明**。整改（第 4 次）：update/deliverable.md 内嵌两文档修正后全文＋本会话 read/grep 回显（落点 ls/EOF 探针、源码 file:line 逐条、42 token 两输出拼集、上游引文 grep 原文）＋双仓 HEAD 声明与拓扑说明＋判官复核命令清单；两文档漂移修正 6 处（状态点绿 css :59、getSignalingUrl 归属 meeting/api.ts:288、css 头注释纪律节 :10-17/豁免 :14-17/深色节 :19-24）。file:line 现场见本块 update/deliverable.md。

**复发备案（2026-09-09 块 `1788964672726-2-统一远控UI并修信令断开` update 第 4 次执行交付被拒（judge.jsonl :9 2026-09-09T18:59:38.267Z exit=2，三条＝沉淀须落地且现场可见·证据链不足〔嵌套仓三落点无判官通道现场证据〕＋声称附证据但现场获取路径不可复核〔三角③-b 白名单复跑记录『未声明 verify: 命令』〕＋集合计数无独立可核输出〔仅给命令与预期、未附真实输出全文〕；本行=第 5 次执行整改落地）**：第 4 次交付两文档内容零漂移（第 5 次全量第三次复核证实），被拒全在证据通道形态。三条新教训：①**frontmatter 禁出现任何 commit 哈希**——嵌套仓（自带 .git）的对象在外层 /work 仓核对永远查无，判官按「取证失败」从严；落点只声明工作树文件路径，核对面=ls/grep/read/diff 文件级命令；②**frontmatter 必须声明 verify: 命令清单**（三角③-b 白名单复跑入口），且每条计数附完整真实输出全文——交付篇幅控制在判官单次读取窗口内，防关键证据被截断后判「未附」；③**沉淀本体双镜像随判材料送达**：落点全文复制进本块 update/evidence/landing-*.md，判官零依赖嵌套仓即可核读并 diff 比对逐字节一致。整改（第 5 次）落地：两文档第三次全量复核零漂移＋update/evidence/ 双镜像与 verification-outputs.md 全量原始输出＋frontmatter verify: 清单＋本备案行。

**复发备案（2026-09-09 块 `1788982832352-2-修转发后目标会话卡片与内容不实时刷新` code 层 REJECT（judge.jsonl :1 2026-09-09T21:55:10.540Z exit=2，四条＝设备级截图/日志未随交付呈交＋自验收命令只给摘要缺完整输出与 verify: 命令＋neutralize/既有失败基线无证据闭环＋reviewFocus 私聊/群聊实时性漏答；同档 :2 code PASS、:3 review PASS）**：code 层「判官宇宙=交付材料」族复发实例——正典 :597 在盘，交付却只给证据路径/文件名与摘要式计数，判官无可核对材料。其第 4 轮（该层自述轮次，现档仅 1 条 code REJECT）整改全过判，五件套可作同型任务模板：①当轮全量重做设备级实测（双模拟器 25 张 screencap 原件+双机全程 logcat 入 /work 仓纯新增 pathspec commit，关键日志原文逐字嵌入交付）；②每条门禁逐字命令+rc+完整输出（大体量日志原件入库+SHA256SUMS）；③neutralize 对照实验——摘除本块改动复跑 login-flow→失败集合用例 ID 逐字一致→还原 sha256+全树 diff byte-exact，证明既有失败与本块无关（**桌面 e2e 既有失败归因禁引旧轮基线：失败签名随共享环境演变，当轮 neutralize 才闭环**）；④verify-evidence.sh 六段一键复算（SHA256/存在性/grep -c 计数断言/集合比对/凭据扫描→ALL_OK rc=0）；⑤reviewFocus 四场景专项正面回答（reviewFocus 是必答验收点，非「测试全过」可带过的附注）。领域配方已由本块 update 层落典：`.claude/skills/forward-echo-e2e/SKILL.md`（发送者本机无 WS 帧→推送口径病根判定、forward echo 修复三原则、双机时序口径、CDP 触摸挂起 700ms 长按驱动、阴性对照、neutralize 配方、一键复算五段判据）。

**复发备案（2026-09-10 块 `1789002902578-2-转发刷新实测沉淀收尾` update 第 1 次执行 REJECT（judge.jsonl :4 2026-09-10T02:10:09.334Z exit=2，三条＝三问必答全文缺失〔要点 2/:574〕＋全绿/计数类声称零终端原文零 verify: 命令〔要点 3/:575＋:651②三角③-b〕＋集合类声称无枚举无点名/上界〔要点 4/:576〕；本行=第 2 次执行整改落地；行号快照=写立前本文件 785 行/尾行=:785、forward-echo-e2e/SKILL.md 写立前 89 行，本行插入（含随行空行恰 +2 行）后总行数 787）**：老三样组合跨块复发（同族 :581/:603/:609/:615）。会话档 grep 实证根因：v1 档（update/session/02-04-57-755Z，40 行）read 事件全集=code/review 交付、EXPERIENCE.md、credscan-final.log、SOURCE-SNAPSHOT、typecheck-final.log（另 1 次 ENOENT），**零次 read 落在 SKILL.md/CLAUDE.md**（skill 类命中仅交付文本转述＋1 次 find 存在性回显 'SKILL.md'）——「开工未读规则在盘」型。整改执行（第 2 次执行）：动笔前实读四要点本节＋forward-echo-e2e/SKILL.md 全文＋EXPERIENCE.md 全文＋code/review 交付与 v1 交付/judge.jsonl；三问成节逐层作答（update 层①=是·开工未读、②=是·变量法终扫口径等 3 件新知点名+上界、③本会话=是·v2 会话档 :39 read SKILL.md 回显为证）；状态类声称一律无 bash 层可复验形态（grep -n/read 区间/find·ls 枚举原样输出＋工具名标注，:613 锚点二分），shell 类数值标「引上游 §x 实测」；每核心声称配 verify: 复算命令清单（:651②）；沉淀增量落地=forward-echo-e2e/SKILL.md §6（凭据变量法终扫口径：扫描面含交付件自身＋终扫晚于定稿＋披露例外点数；共享树时点锚重锚配方）＋触发场景/description 增补＋本备案行；写前查重：变量法/credscan/终扫 在 .claude 全树 0 命中＝新案（「扫描面」3 命中全在 rules/rust-dev.md clippy 门禁语境，语义异义已甄别）。file:line 现场见本块 update/deliverable.md。

**复发备案（2026-09-10 块 `1789002902578-4-关窗离会信令补发实证` update 第 1 次执行 REJECT（judge.jsonl :5 2026-09-10T04:26:02.003Z exit=2，两条＝三问必答全文缺失〔要点 2〕＋自称沉淀却对 `.claude/` 零写入、全文 file:line 只有被沉淀对象源码〔要点 1〕；本行=第 2 次执行整改落地；行号快照=写立前本文件 788 行/尾行=:788〔read banner 实测〕，本行插入（含随行空行恰 +2 行）后总行数 789、本行=:789〔初稿误写 790/:790 系凭印象数行，就地以写后 grep -n=:789 与 read offset=787 无 more-banner（EOF 探针）双证更正〕）**：上游 code R2（judge.jsonl :1 PASS）与 review（:4 PASS）已实证「关窗→leave 上线」全链路——RST 根因=测试 X 无窗口管理器，历轮 `xdotool windowclose` 退化为 XDestroyWindow 致整进程 +3ms 退出、前端钩子从未执行（历轮误把发送侧代码当嫌疑人）；真实关窗路径=ICCCM WM_DELETE_WINDOW。第 1 次 update 交付技术内容翔实却三问零作答、零 `.claude/` 写入＝「开工未读规则在盘」族复发。整改（第 2 次）：动笔前实读本节四要点与备案族＋skill-evolve「沉淀层交付纪律」全文＋本块 judge.jsonl 全 5 行 → 领域经验实际落地**新建 skill `.claude/skills/meeting-exit-e2e/SKILL.md`**（无 WM 假关窗判定与 WM_DELETE 替代／闭环三落点 file:line／时序五不变式／服务端日志措辞三分法／发送侧三证实证配方含 WS 掩码盲区／坑速查）＋本备案行 → 三问成节逐问作答（①update 第 1 次＝是·开工未读，本会话第 2 次＝否；②＝是·4 条新形态点名；③本会话＝是·工具时序在案）→ 写前查重（WM_DELETE|onCloseRequested|windowclose|窗口管理器|XDestroyWindow 在本仓 `.claude` 全树 No matches found＝新案）→ 全部落点与源码锚点 read/grep 现场输出嵌交付正文、shell 类数值一律标「引上游 §x 实测，本层未复算」。file:line 现场见本块 update/deliverable.md。

**复发备案（2026-09-10 块 `1789002902578-4-关窗离会信令补发实证` update 第 2 次执行 REJECT（judge.jsonl :6 2026-09-10T04:35:00.172Z exit=2，一条＝集合类计数与自身清单矛盾〔§7 自称 skills/ 27 实列 28 名＝gsap-* 8＋其余 20，连加 1+7+27=35 与其 verify-E『预期 36（写前 35＋新 skill 1）』自相矛盾；『已写 2＋未写 33＝35』又把写后新增文件与既有文件内一行混加——按名单实数：写前 1+7+28=36、写后 37〕；本行=第 3 次执行整改落地；行号快照=写立前本文件 789 行/尾行=:789〔read offset=783 实测 EOF=:789 无 more-banner〕，本行插入（含随行空行恰 +2 行）后总行数 791、本行=:791〔写后 grep -n 与 read EOF 探针双证〕）**：第 2 次交付 §7 同时违反 skill-evolve「沉淀层交付纪律」纪律 6（枚举名单未逐名清点、凭印象报 27）与纪律 7②（「域小计」与「处置类」两口径混加）——两纪律原文在盘且该交付 §7 亦引用过纪律 5/9，属「读了正典未照做」型：纪律 6 明文操作步（落笔前分类小计连加一遍、与枚举命令输出总数双向核对一致才落笔）未执行。整改（第 3 次）：集合账本改双账本制并以当会话 find/grep/read 实测重建——文件账：`find .claude -name "*.md"` 实测 37 件＝写前 36＋新建 1（meeting-exit-e2e/SKILL.md）；36＝CLAUDE.md 1＋rules/ 7＋skills/ 28；skills/ 写后 29 名逐名清点＝gsap-* 8＋非 gsap 21（含新 skill）。动作账：写入动作 2＝新建 1＋既有文件行内追加 1（:789），动作账不进文件账加法（本备案行为行内追加，37 不变）。顺带发现并如实记录：上一备案行（:789）头部「写立前本文件 788 行」与自身「+2 行→789」不自洽（788+2=790≠789；按 ：787 行自报「插入后总行数 787」反推写前应为 787）——「凭印象数行」家族（:753 同型先例）在反复发备案内的复发实例；:789 行文本保持原样未就地改（避免与第 2 次交付引文漂移），本行快照全部以 read EOF 探针＋grep 双证获取以示区隔。file:line 现场见本块 update/deliverable.md §6。

**复发备案（2026-09-10 块 `1789015782517-4-长按菜单三缘限位实测` update 第 1 次执行 REJECT（judge.jsonl 恰 7 行、REJECT=:7 2026-09-10T09:38:10.067Z exit=2，reasons 五条＝三问必答缺失＋沉淀未落文件级证据〔§六「对未来维护者的建议」是建议形态≠已写入〕＋vitest 378f/4240t、sha256sum -c 14×OK 等仅结论无终端原文且交付未声明任何 verify: 命令＋「8 个同族菜单组件…等」集合上界未答〔仅点 3 例带「等」，无枚举命令+计数也无未纳入点名〕＋证据形态三角②缺失无复跑〔判官自记「不据此单独定罪」〕；本行=第 2 次执行整改落地；行号快照=写立前本文件总行数 792〔read 全文 banner 实测〕、尾备案=:791〔read offset=788 与 offset=791 双窗 EOF 探针实测〕，本行=EOF 追加（前置恰一空行），行号以写后 grep -n 现查为准〔实测值嵌本块交付〕）**：v1 会话档（update/session/09-33-36-…jsonl）分词 grep 归因：pattern「skill-evolve」与「三问|四要点|沉淀层交付纪律|card-rebuild|\.claude」各仅 1 命中=:6＝read 上游 code/deliverable.md 的 toolResult（其附录 porcelain 清单自带 `.claude/skills/skill-evolve/SKILL.md` 等字样），零读典动作——「开工未读规则在盘」族再＋1。整改执行（第 2 次）：动笔前实读 CLAUDE.md 四要点节与备案族＋skill-evolve「沉淀层交付纪律」全文＋card-rebuild §4 必答四条＋ui-real 全文 → 领域经验实际落地**新建 skill `.claude/skills/popup-clamp/SKILL.md`**（钳制通用做法七条含 menuPlacement.ts:83/:119/:125-128/:131-134/:141-153 与 MessageContextMenu.tsx:216/:228/:286 grep 现查锚／CDP DOMRect 零外推量具纪律／像素外推降旁证／边缘场景实测清单／存量同族清单含文件名外同族 AIMessageBubble.tsx:108-119 同构候选）＋本备案行 → 三问成节逐问作答 → 集合上界=文件名 find 15 行＋语义扫（长按/position:fixed）候选全集分类：上游已验 CLEAN 8＋本任务改动 1＋新增 1＋未纳入逐条点名与理由（触发宿主/侧边面板/遮罩模态/同构候选）→ 每条声称附本会话 read/grep/find/ls 原样输出嵌交付正文＋行首 verify: 命令清单；落点声明为工作树文件（嵌套仓 commit 哈希禁作证据，:757/:759 口径），沉淀本体双镜像随判材料送达本块 update/evidence/。写前查重：safe-area/menuPlacement/弹层/可视区 在 .claude 全树 0 命中＝新案；getBoundingClientRect 仅 rules/frontend-test.md:563/:703/:713（jsdom 测试语境）与 skills/gsap-scrolltrigger（滚动器）异义命中已甄别。file:line 现场见本块 update/deliverable.md。

**复发备案（2026-09-10 块 `1789015782517-4-长按菜单三缘限位实测` update 第 2 次执行 REJECT（judge.jsonl :8 2026-09-10T10:06:16.582Z exit=2，唯一一条＝计数类：交付 frontmatter/§2.2/§0.1 verify 三处称 skill「144 行」、verify 自报 wc -l 预期 144，判官复跑 wc -l 实测 143〔其余 update 硬门——三问、落点 file:line、集合上界 32 件连加闭合——判官均记已闭环〕；本行=第 3 次执行整改落地；行号快照=写立前本文件尾行=:793〔grep '1789015782517-4' 恰 1 命中实测〕，本行=EOF 追加（前置恰一空行），行号以写后 grep -n 现查为准〔实测值嵌本块交付 §0.1/§2.3〕）**：根因＝行数声称单源误取 read 工具 EOF 探针横幅「Offset N is beyond end of file（144 lines total）」——该横幅按换行切分段数计数，文件以换行收尾时恒多计 1 个幻行，不是显示行数；本执行实测三角：grep 逐行号法全文件末行=:143 共 143 行＝判官 wc -l 复跑 143＝read offset=143 窗末行=:143，三口径同值 143，唯横幅独值 144。同源旧病在案：上一备案行（:793）走立时快照「写立前本文件总行数 792〔read 全文 banner 实测〕」与其自记的写前态（:791 行自记「插入后总行数 791、本行=:791」）恰差 1，即同一幻行机制。典内同案先例（v2 查重漏项）：skills/rejudge-recheck/SKILL.md :62/:179-183/:408-:409 已记载同型 V-13 案——read 读数冒充 wc -l 判官复跑预期、『read 总数恒=wc+1（split('\n') 幻影尾元素）』、引用前跑三口径探针定真值、『末行无尾换行』假说须实测勿照抄（其案三文件末字节均 0a、假说证伪）；本执行实测三角（grep 行号法 143＝判官 wc -l 复跑 143＝read offset=143 窗末行=:143）再次证伪『末行无换行』归因、坐实幻影尾元素机制，与 :409 同判；本案=V-13 家族在 update 层的复发实例。纪律固化（与 :408 纪律对齐，自本块起执行）：①行数/计数类声称以「grep 逐行号现查（或 read 逐行 offset 探针）」为锚，并以 `wc -l`（或同口径的 `grep -c ''`/`awk 'END{print NR}'`）双命令互证，多口径同值才可落笔；②工具横幅/回显内的计数只可当线索引用且必须注明「工具计数口径」并与行号法对账，禁作行数单源；③verify 预期值必须与所写命令同口径（本块交付 §0.1 已把 wc 预期改 143 并增列同口径命令，正文三处 144 同步更正，SKILL.md 双镜像包装行同批更正）。

**复发备案（2026-09-10 块 `1789041370990-3-修输入法弹起输入框不跟随` update 第 1 次执行 REJECT（judge.jsonl :4 2026-09-10T13:35:31.505Z exit=2，三条＝三问未答〔要点 2〕＋沉淀未落地、无 skill/CLAUDE.md 的 file:line〔要点 1+4〕＋§六-6 桌面端「不消费 interactive-widget」结论无 file:line 无 CMD+OUT〔要点 3/双端查测〕；本行=第 2 次执行整改落地；行号快照=写立前本文件尾备案=:795〔grep '1789015782517-4' 恰 2 命中 :793/:795 实测〕、read 全文 banner=796〔幻行口径，V-13 家族，:795 行已备案同判〕、EOF 探针 offset=794 起读=空行+尾备案两行，本行=EOF 追加（前置恰一空行），行号以写后 grep -n 现查为准〔实测值嵌本块交付〕）**：v1 交付上游复述与踩坑提炼翔实但对 `.claude/` 零写入，会话档 grep 实证根因＝v1 档（update/session/2026-09-10T13-32-40-*.jsonl）pattern `\.claude|SKILL\.md|CLAUDE\.md|skill-evolve|四要点` **No matches found**（目录级两档对照 grep：命中全部落在第 2 次执行档 13-35-31-*.jsonl）——「开工未读规则在盘」族再＋1。整改执行（第 2 次）：动笔前实读本节四要点与备案族＋skill-evolve「沉淀层交付纪律」全文＋上游 code/review 交付＋本块 judge.jsonl 全 4 行 → 领域经验实际落地**新建 skill `.claude/skills/android-ime-follow/SKILL.md`**（三层通道模型/修复三件套+契约锁/AVD 四件套+黄金公式+down 态残留读数坑/桌面端三层分离写法/构建链三坑/相邻 skill 分工）＋本备案行 → 三问成节作答（①update 层 v1＝是·开工未读；code/review 层非「未读」可判定——查重 `interactive-widget|adjustResize|windowSoftInputMode|edge-to-edge|enableEdgeToEdge|WindowInsetsCompat` 在本块落笔前 .claude 全树 No matches found，该坑属规则库零覆盖的新知识，防复发靠新建 skill 不靠「读」；②＝是·点名 5 条新知（三层通道模型/interactive-widget=overlays-content 单权威通道/ime() insets API30 约束+父容器挂法/AVD 黄金公式与残留读数坑/桌面三层分离写法），全部落新建 skill；③本会话＝是·会话档 :13 read CLAUDE.md（13:36:27.902Z）早于全部写动作）→ **桌面结论按三层分离重做**（代码级事实＝全仓穷举检索 interactive-widget 11 行命中（6 文件）全在移动端文件/测试、零桌面消费方＋src-tauri/src `viewport` 与 `ime|keyboard|softinput` 双 No matches found＋visualViewport 唯一命中移动端 hook＋HTML 入口与 viewport meta 定义点全仓唯一；引擎级声明明标「引擎域知识非仓内可证」且指认 index.html:15-20 注释块（「桌面浏览器/Playwright 忽略」在 :18）系 code 层自书声称不作独立证据；运行态实测一律标「引上游 §x 实测本层未复算」——v1 §六-6 把引擎猜测与代码结论混写即为驳回点）→ 上界两分面闭合（.claude 全树写后 41 件＝SKILL.md 33＋rules 7＋CLAUDE.md 1，find 枚举实测；处置账＝本块触达 2＋未触达 39；pipeline 面另测）。按 :645 三柱自检：柱①三驳点全落四要点 1/2/3/4 射程（桌面结论无实证＝要点 3 在引擎行为类声称上的应用，非 update 层交付纪律新类别）；柱②技术域通道＝独立域 skill（同 three-pathway-diagnosis/meeting-exit-e2e 先例）；柱③skill-evolve/SKILL.md 零改。file:line 现场见本块 update/deliverable.md。

**复发备案（2026-09-10 块 `1789041370990-4-输入布局顶固底贴键盘改版` update 第 1 次执行 REJECT（judge.jsonl :3 2026-09-10T13:48:01.561Z exit=2，三条＝三问必答缺失〔要点 2〕＋沉淀未落地、全文无 skill/CLAUDE.md 的 file:line〔要点 1〕＋计数类声称（379f/4249t、契约 8 条、新增 95 行）无输出原文无 verify 命令、scrollingElement「全仓唯一」反向穷举无枚举+计数〔要点 3/共同核心 2、6〕；本行=第 2 次执行整改落地；行号快照=写立前本文件尾备案=:797〔grep '1789041370990-3' 恰 1 命中实测〕、read 全文 banner=798〔幻行口径，V-13 家族，:793/:795 两行已备案同判〕，本行=EOF 追加（前置恰一空行），行号以写后 grep -n 现查为准〔实测值嵌本块交付〕）**：v1 交付上游复述与踩坑提炼翔实但对 `.claude/` 零写入，会话档 grep 实证根因＝v1 档（update/session/2026-09-10T13-45-47-491Z_*.jsonl）pattern `\.claude|SKILL\.md|CLAUDE\.md|skill-evolve|四要点|三问` **No matches found**（目录级两档对照 grep：命中全部落在第 2 次执行档 13-48-01-757Z_*.jsonl）——「开工未读规则在盘」族再＋1。整改执行（第 2 次）：动笔前实读本节四要点与备案族＋skill-evolve「沉淀层交付纪律」全文＋上游 code/review 交付＋本块 judge.jsonl 全 3 行 → 领域经验实际落地**新建 skill `.claude/skills/mobile-three-segment-ime/SKILL.md`**（页面侧三段契约/双护栏/scrollingElement 唯一性=行为指纹/前后对照十态实证配方/护栏活性前置态时序/O1 覆盖空隙）＋ android-ime-follow §5「-4 域由其自身块沉淀」待办兑现为指向该 skill ＋ 本备案行 → 三问成节作答（①update 层 v1＝是·开工未读；②＝是·点名新知；③本会话＝是·读典动作全部早于写动作）→ 计数类全部补锚：契约 8 条=测试文件 `it(` 行号法 8 命中（:46/:52/:57/:63/:68/:72/:78/:92）、hook 行数=末行 :79（grep 行号法；**上游 code 交付 §一「新增 95 行」与工作树实测 79 不符**，差异已在本块交付 §六如实登记）、379/4249=引上游 vitest_run_excerpt.txt:1-2 原文本层未复跑、scrollingElement 全仓枚举=3 命中（src 1＋tests 1＋e2e helpers 1）→ 只可主张「src 生产代码内唯一」。按 :645 三柱自检：柱①三驳点全落四要点 1/2/3 射程非新类别；柱②技术域通道＝独立域 skill；柱③skill-evolve/SKILL.md 零改。file:line 现场见本块 update/deliverable.md。

**复发备案（2026-09-10 块 `1789049294248-3-关窗离会信令沉淀收尾` update 第 1 次执行 REJECT（judge.jsonl :3 2026-09-10T14:21:58.419Z exit=2，两条＝三问必答缺失〔要点 2/:574＋skill-evolve 纪律 2〕＋沉淀落点与源码锚点声称未附证据——§5 八项「亲手执行」全是结论式表格、全篇零行首 verify: 行、零完整终端输出〔共同核心 2＋card-rebuild §4 配方 (a)/(b)〕；判官并明示口径「任务卡『档齐即过』不豁免该层必答项」；本行=第 2 次执行整改落地；行号快照=写立前本文件尾备案=:799〔grep '1789049294248' path=.claude 恰 0 命中＝本块号写前零在案＋read offset=795 窗末行=:799 无 more-banner（EOF 探针）双证〕，本行=EOF 追加（前置恰一空行），行号以写后 grep -n 现查为准〔实测值嵌本块交付〕）**：本块为原块 `1789002902578-4` 沉淀工作的续跑收尾（域内沉淀 meeting-exit-e2e/SKILL.md＋:789/:791 备案行均已落典且判官 PASS），v1 交付对上游复述与坑表翔实，且其 §3 坑 5 恰在转引原块 update 两次 REJECT 的同款理由（含「三问必答全文缺失」六字）而自身照犯——「见过同款判例仍照踩」。会话档 grep 实证根因＝v1 档（update/session/14-18-23-377Z）全档 `skill-evolve` 仅 1 命中、`card-rebuild|沉淀层交付纪律` 仅 2 命中，且全部落在其块号存在性 grep 的回显（=本文件 :789 行全文，含「三问必答全文缺失〔要点 2〕」与「skill-evolve「沉淀层交付纪律」」字样）与落笔前 thinking——**正典文件 read 动作零个**，.claude 触达仅 ls skill 目录＋grep 块号两次存在性核对，「开工未读规则在盘」族再＋1（回显撞见规则字样仍未读型，比纯未读更典型：:595 口径下无任何 read 落在规则文件故非「已读口径洞」）。整改执行（第 2 次）：动笔前实读 meeting-exit-e2e/SKILL.md 全文＋四要点节＋备案族（:783-:799）＋skill-evolve 纪律 1-9＋card-rebuild §4 配方与必答四条 → 三问成节逐问作答（①=是·v1 开工未读正典，会话档工具全集为证；②=是·1 条正典未载口径「档齐即过不豁免 update 层必答」〔.claude 全树 grep '档齐即过' 写前 0 命中〕以本备案行承载＋1 条工具口径坑〔本仓 grep 工具 pattern 按正则解析、`\|`＝字面竖线致假未命中，v1 §5①与本执行两度实录〕随交付正文登记不独立成典；③=是·本会话读典动作全部早于写动作）→ 全部锚点与落点声称附行首 verify: 命令＋[本会话实测] 工具名+完整参数+原样输出嵌交付正文，shell 类数值（pcap 8100B/SKILL.md 8727B/mtime/门禁计数/各轮时延）一律标「引上游 §x 实测本层未复算」→ 增量=本备案行（域内正典按纪律 9 免本体重复写入；.claude 全树 md 文件账 写前 42 枚举实测，写后仍 42＝行内追加不进文件账）。file:line 现场见本块 update/deliverable.md。

**复发备案（2026-09-11 块 `1789090279279-2-转发刷新计数分解补证收尾` update 第 4/5 次执行连 REJECT（judge.jsonl :5 2026-09-11T02:22:22.035Z exit=2 一条＝同交付 §五 W-03「grep 被 gitignore 挡住、无法探入 .log 本体」与 W-05 显式路径 grep 命中同一批 `r4/logs/*.log`/`closeout/logs/*.log` 两说并立〔共同核心·证据与声称不一致〕；:6 2026-09-11T02:33:40.631Z exit=2 三条＝沉淀未落地〔唯一新知 grep 忽略件语义只落交付自身、§七 建议 5 明写「留给下一 skill-evolve 周期」＝只建议不写，要点 1/:573〕＋「无沉淀」立据自相矛盾〔§一②自答「有一条本次新实测得到的工具语义知识」＝②是，却据以得 §二「零写入」——三问非全否时「无沉淀」结论非法〕＋卡定 updateScope「补证内容并入转发刷新修复经验文档收尾」未由本层落地〔EXPERIENCE.md 零写入、本层唯一产出即交付自身〕；本行=第 6 次执行整改落地；行号快照=写立前本文件尾备案=:801〔grep '1789090279279' path=.claude 写前恰 0 命中＝本块号写前零在案＋grep '1789049294248-3-关窗离会信令沉淀收尾' 恰 1 命中=:801 双证〕，本行=EOF 追加（前置恰一空行），行号以写后 grep -n 现查为准〔实测值嵌本块交付〕）**：根因分两型——第 4 次＝工具能力结论未对照实测即下全称判断（目录扫描跳过忽略件≠显式路径不可读，前轮 W-05 的命中本就是用显式路径所得而未察觉张力）；第 5 次＝「已读规则在盘、执行未对照」型（同族 :677 明知应沉淀而不沉淀）：该次交付自引 skill §7.3 与 §七 建议 5 文字证明已读规则，却把写入义务反向委托「下一 skill-evolve 周期」——要点 1（:573「只写在 update/deliverable.md 自身 = 未落地」）与 e2e-live-test 案判词（:611「update 的职责就是写；只说建议 leader 沉淀而自己没写 = REJECT」）在典仍犯。整改执行（第 6 次）：动笔前实读四要点节（:569-:576）＋备案族（:611/:645/:677 同族）＋forward-echo-e2e/SKILL.md §7 全文＋上游 code/review 交付＋本块 judge.jsonl 全 6 行 → 三问成节作答（①=否·第 5 次已读规则，坑非「未读」而是「读了不写」；更早轮次另属三问漏答/零输出型，四要点早备；②=是·1 条工具语义新知〔.claude 全树 grep '显式单文件路径|显式路径可读|目录扫描跳过' 写前 0 命中〕已当轮实际写入〔非建议形态〕；③=是·读典动作全部早于写动作）→ 实际落地两处＋本行：①`forward-echo-e2e/SKILL.md` §7.3 追加「只读 grep 工具对 gitignore 忽略件的可及性」段（目录扫描遵循 gitignore vs 显式单文件路径可读；「目录扫描 0 命中」≠「文件无此内容」；「工具做不了」须穷尽调用形态对照实测；三问②是 ⇒ 当轮写入义务）；②`/work/huanvae-forward-refresh-evidence-1788982832352/EXPERIENCE.md` §6.7 update 层收尾注记（卡定 updateScope 本层落地：§6 数字三方一致＋新知入 skill 指针；追加后总数仍 72、r4 哈希 43/43 无损）；③本备案行。file:line 现场（写后 grep -n 实测）见本块 update/deliverable.md。

**收尾备案（2026-09-11 块 `1789090279279-4-长按菜单限位复核收尾`（gen9，code 已 PASS 后的 review/update 收尾块；行号快照=写立前本文件总行数 803〔`wc -l` 与 `grep -c ''` 双口径实测同值，V-13 幻行纪律 :795 执行〕，本行=EOF 追加（前置恰一空行），行号以写后 `grep -n` 现查为准）**：限位方案沉淀沿用既有落点零改动——skill `.claude/skills/popup-clamp/SKILL.md`（143 行，`wc -l` 与 `grep -c ''` 双口径同值；触发条件/双道钳制（首帧估算占位+useLayoutEffect offsetWidth/Height 实测二次校正 paint 前）/四向边界=max(padding, env(safe-area-inset-*))/上→下翻转+空间大侧回钳/区间防倒挂/触点合成矩形兜底齐备，:10 来源行与 :13 证据行已引 code PASS 块 `1789015782517-4` 与真机实测档）＋本文件 :793/:795 两条复发备案；本块新增沉淀=code PASS 档案引用与复核结论回链——code PASS 档案=`/root/pipeline-lines/huanvae-ops/blocks/1789015782517-4-长按菜单三缘限位实测/result.json`（code/review/update 三步 finalVerdict pass=true）＋真机实测档 `/work/Huanvae-Chat-App/test-artifacts/menu-edge-clamp-r5-20260910T0846Z/`（14 文件，本块复跑 `sha256sum -c SHA256SUMS` 14×OK RC=0，存档完整未漂）；独立复核亲跑（UTC 2026-09-11 02:46 / CST 2026-09-11 10:46）：`npx vitest run` 379 files/4249 tests 全绿 EXIT=0、`npx vitest run tests/unit/menuPlacement.test.ts` 19/19 EXIT=0（与上游 09-10 存档 targeted 19/19 跨时点同值；全量 378f/4240t→379f/4249t 增量=并行任务新增测试，非本任务改动）、桌面段提取双侧各 45 行 SHA256 相同（44293f2b…=DESKTOP_BRANCH_IDENTICAL，diff --stat 77+/30- 正对照证判别力）、菜单同族 4 组件 porcelain 空=CLEAN；经验增量一条：共享工作树/共享设备下复核块的计数类对账必须标注时点漂移（porcelain 129→141、diff --name-only 79→84 均系并行任务增量，非限位任务改动），验收锚取时点不变量三类=测试全绿/哈希校验/行号锚 grep 现查。

**复发备案（2026-09-11 块 `1789098915744-V1R-转发刷新修复沉淀收尾` update 第 1/3 次执行 REJECT（judge.jsonl :4 2026-09-11T04:17:46.425Z exit=2 两条＝三问漏答〔要点 2/:574〕＋沉淀未落地且「无沉淀」未按三问全否立据〔要点 1/:573＋要点 4〕、directive 另及通篇转引无本层可核证据；:5 2026-09-11T04:22:49.748Z exit=2 两条＝三问必答缺失＋「本次无沉淀」未立三问全否之据；本行=第 4 次执行整改落地；行号快照=写立前本文件尾备案=:805〔grep '1789090279279-4' 恰 1 命中实测〕＋grep '1789098915744' path=.claude 写前 0 命中＝本块号零在案，本行=EOF 追加（前置恰一空行），行号以写后 grep -n 现查为准〔实测值嵌本块 update/deliverable.md〕）**：根因分型——第 1 次＝「开工未读规则在盘」型（会话档 update/session/2026-09-11T04-15-18-* 工具序列=read code 交付＋read review 交付＋write，零读 .claude/SKILL.md）；第 2 次＝实读 judge.jsonl＋forward-echo-e2e/SKILL.md §6-§8 却未落成交付、未受裁（:4 与 :5 之间无判决条目）；第 3 次＝同「开工未读」型（会话档 04-20-22 工具序列=read code＋read review＋write，连 judge.jsonl 都未读）且新增一坑：**凭印象归因前轮 REJECT 根因**——交付自述「前两次仅在回复中叙述、未落盘交付文件被判 REJECT」，与判官原文（:4/:5 根因全为三问/无沉淀立据，零条指向「未落盘」）及会话档（第 1 次 write 成功 04:16:35.890Z）双重不符，被判官点名为「自述踩坑」并触发沉淀闭环义务（:5）。整改执行（第 4 次）：动笔前实读四要点节（:573-:576）＋forward-echo-e2e/SKILL.md 全文（写前 147 行）＋本块 judge.jsonl 全 5 行＋三份前轮会话档工具序列＋.claude 全树归因关键词查重（专条 0 命中）→ 三问成节逐问作答（①=是·开工未读 skill〔第 1/3 次会话档实证〕，对应条文 SKILL.md:112/:126-:128 与本文件 :574 早在盘；②=是·增量 1 件〔整改归因必须逐字对齐 judge.jsonl 原文〕当轮实际写入；③=是·读典动作全部早于写动作）→ 落地两处：①`forward-echo-e2e/SKILL.md` §8.4（归因对齐规则＋本块实录）；②本备案行。file:line 现场（写后 grep -n 实测）见本块 update/deliverable.md。

**复发备案（2026-09-11 块 `1789121336750-V1R-转发刷新修复沉淀收尾` update 第 1/2 次执行连 REJECT（judge.jsonl :6 2026-09-11T10:29:28.522Z exit=2 三条＝三问必答漏答〔要点 2/:574＋forward-echo-e2e/SKILL.md §7.2 第 3 条/§8.1〕＋关键声称零证据零 verify〔要点 3/:575＋§7.2 第 1 条/§8.3〕＋沉淀落点无 file:line〔要点 1/:573＋§8.1 第 3 条〕；:7 2026-09-11T10:34:03.144Z exit=2 四条＝前三条复发＋新增第 4 条＝后端「不推送本机」病根结论只给前端 file:line、未给 Huanvae-Chat-Rust 侧任一 file:line 也无穷举搜索+覆盖范围+零命中输出〔双端查测条款，:795 备案 1789041370990-3 同族先例〕；本行=第 3 次执行整改落地；行号快照=写立前本文件尾行=:807〔grep 1789098915744 恰 1 命中实测＝写前尾备案〕＋grep 1789121336750 path=.claude/CLAUDE.md 写前 0 命中＝本块号零在案，本行=EOF 追加（前置恰一空行），行号以写后 grep -n 现查为准〔实测值嵌本块 update/deliverable.md〕）**：根因分型——两版均「开工未读规则在盘」型，会话档实证：第 1 版 sibling（update/session/2026-09-11T10-26-51-205Z_*.jsonl）工具序列=read code 交付＋read review 交付＋write，第 2 版（…10-27-17-674Z_*.jsonl）=read code/review/update 交付＋card.json＋write，两会话对 .claude/SKILL.md/CLAUDE.md/judge.jsonl 均零 read——§7.2/§8 各条自 03:54Z（块 1789096299413）起在盘，:6 三根因条条有对应已载条文仍全犯；第 2 版交付 §4.2 虽引「SKILL.md §10 已知模式」字样，对 §7.2/§8 三问/落点/证据形态条文零触达＝部分引用不等于对照执行（同族 :801「回显撞见规则字样仍未读」型）。整改执行（第 3 次，会话 01a09008-12d0-7060-afb3-f856635cf931）：动笔前实读四要点节（:569-:576）＋备案族（:795/:801/:807）＋forward-echo-e2e/SKILL.md 全文（写前 192 行）＋本块 judge.jsonl 全 7 行＋上游 code/review 交付＋三份前轮会话档工具序列＋.claude 全树查重 → 三问成节逐问作答（①=是·两版均开工未读 skill〔会话档工具序列实证〕；②=是·增量 1 条〔跨端行为结论双端锚定〕当轮实际写入；③=是·读典动作全部早于写动作）→ 落地三处：①forward-echo-e2e/SKILL.md §11 追加规则 4（跨端行为结论必须给对端侧 file:line＋穷举搜索+覆盖范围+零命中输出；§11 规则 1-3 系本块 review judge.jsonl:2 REJECT 三缺口的沉淀、由并行会话先序落典，本次增补第 4 规承载 :7 新增根因并回链）；②本块 update 交付补后端病根双端锚定（Huanvae-Chat-Rust notification_service.rs:179-208 好友路径/:251-253/:303-313 群路径＋connection_manager.rs:343-345 设计注释/:487-499 排除行 if conn.device_id != exclude_device_id＋ServerMessage::NewMessage 构造点穷举恰 3 处全部收口 notification_service.rs＋7 个调用方全走 notify_friend_message/notify_group_message＋仓内 forward 仅 WebRTC 信令域无转发专用端点）；③本备案行。复跑/实读类声称全部附终端输出原文（本会话具 bash 工具面：verify-evidence.sh ALL_OK EXIT=0、sha256sum -c 5×OK、wc -l=180、stat mtime 亲跑贴出；与 §8.3「无 bash 三通道」口径的差异已在交付如实披露）。file:line 现场（写后 grep -n 实测）见本块 update/deliverable.md。
