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

api, chat, components, constants, contexts, db, hooks, huanvaeGuard, lanTransfer, lowcode, media, meeting, nfc, pages, services, stores, styles, theme, types, update, utils

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
├── lowcode/        # 低代码平台
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

代码和测试全部编辑完成后，严格按以下顺序执行。**最终门禁是 `scripts/test-all.ps1`，9/9 全绿才算完成**，不可只跑前几步就声明任务通过。

### 第 1 步：开发期局部验证（迭代时用）

代码改完先快速验证，避免一上来跑全量。**委托 test-runner Agent（haiku）执行**：

```
Agent(subagent_type="test-runner", prompt="在 App 目录下运行 pnpm typecheck && pnpm lint:strict && pnpm test:run，报告结果")
```

注意：`pnpm lint:strict`（`--max-warnings 0`）与 `scripts/test-all.ps1` 的 ESLint 阈值对齐。`pnpm lint` 是宽松版，本地试错可用，但**任务完成前必须用 strict 模式校验**，否则 test-all.ps1 会在第 4 步因 warning 而 FAIL。

### 第 2 步：全量门禁 `scripts/test-all.ps1`（不可跳过）

**任何任务完成前必须跑一次，9/9 全绿才允许进入 completion-summary。** 9 项检查：

1. NSIS 安装配置 / 2. package.json 验证 / 3. TypeScript / 4. ESLint 严格模式 / 5. Vitest / 6. 前端 build / 7. cargo check / 8. clippy 桌面 / 9. clippy Android

**委托 test-runner Agent（haiku）执行**：

```
Agent(subagent_type="test-runner", prompt="在 App 目录下用 PowerShell 运行 scripts/test-all.ps1，逐项报告 9 项结果。若 huanvaeguard-svc.exe 占用导致 cargo 失败，先 scripts/dev/hg-service.ps1 -Action stop 再重跑，结束后恢复。")
```

任何一项 FAIL 必须修复后**重新跑完整 9/9**，不许只重跑失败那项。常见坑见 [.claude/rules/rust-dev.md](.claude/rules/rust-dev.md)（HG 服务文件锁）和 [.claude/rules/frontend-test.md](.claude/rules/frontend-test.md)（vi.hoisted、animation-conflict 注册）。

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

发布 = 编辑 [scripts/release-config.txt](scripts/release-config.txt)（`VERSION` 每次 +0.0.1、`MESSAGE` 一句话说明），然后在项目根跑 `./scripts/linux/release.sh`（Windows 用 `scripts/release.ps1`）。脚本一条龙做完：同步 `package.json` / `src-tauri/Cargo.toml` / `src-tauri/tauri.conf.json` 三处版本号 → 跑 `scripts/linux/test-all.sh` 全量测试 → `git add -A` + commit → 打 tag → push main + push tag。

**完整步骤、行号对照、脱敏核命令、坑的成因见 [.claude/skills/release/SKILL.md](.claude/skills/release/SKILL.md)。** 三条最要命的红线先记住：

1. **一条龙不切开** — 不存在"只跑前半段、后面手动补"。步骤 2 已把三处版本号改脏工作树，中途中断会留下"版本已升、没测没提交"的脏树，下一次发布被 `git add -A` 裹走。
2. **不带参数跑** — `release.sh` 把收到的参数**原样透传**给 `test-all.sh`，而后者有 `--skip-rust` / `--skip-android` / `--skip-e2e` 开关。`./scripts/linux/release.sh --skip-e2e` 会**静默**发出一个没跑 E2E 的版本且照样打印"全部通过" = 降门槛，属红线。同理：测试没全绿就停下如实报，**不许改测试 / 加 skip / 降阈值硬推**。
3. **PUBLIC 仓 push 前必做脱敏核** — 文本面 grep 私钥 / 连接串 / 凭据 env / 私网地址；**并对所有 tracked 二进制跑 `strings` 扫**（编译机绝对路径、内部主机名、构建元数据）。这条踩过：未 strip 的二进制曾随公开仓一起发布并泄露内部结构（见 `git log edbb439`）。tag 是 `--force` 推、push 即不可撤销。

排查工作树归属时注意：本仓是巨树，**禁用 `git status` / `git add -A` 做排查**（会超时），改用 `git diff --name-only`、`git diff --cached --name-only`、`git ls-files --others --exclude-standard -- <目录>`。

## 语言偏好

- **交流语言**: 中文
- **代码语言**: 英文（变量名、函数名、注释使用英文；文档字符串可用中文）
