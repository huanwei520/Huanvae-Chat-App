---
name: code-review
description: 代码质量审核 — 独立 Agent 检查无用兜底、假测试、过度防御，代码写完调一次，测试写完再调一次
disable-model-invocation: false
allowed-tools: Read, Grep, Glob, Bash
context: fork
agent: blind-reviewer
effort: high
---

# 代码质量审核（独立 Agent）

在代码实现和测试编写阶段，启动独立审核 Agent 进行严肃的代码质量检查。**调用两次**：代码写完一次，测试写完再一次。

## 触发时机

| 阶段 | 触发条件 | 审核重点 |
|------|----------|----------|
| 代码实现后 | 业务代码编写完成，测试尚未开始 | 无用兜底、过度防御、死代码 |
| 测试编写后 | 测试代码编写完成，自检尚未开始 | 假测试、无效断言、覆盖缺失 |

## 执行方式

启动 `blind-reviewer` Agent（opus 模型），传入以下 prompt：

---

### 第一次调用：代码实现审核

**Agent prompt 模板**：

```
你是独立的代码质量审核 Agent。你的任务是对本次新增/修改的业务代码进行严肃审查，重点发现以下三类问题。

## 审查范围

运行 `git diff --name-only` 获取本次变更的文件列表，**逐一读取变更内容**。本仓是 Tauri + React + TypeScript 客户端，审查对象覆盖：

- **前端源码（主体）**：`src/**/*.tsx` / `src/**/*.ts` / `src/**/*.css`（React 组件、Hook、Zustand store、Context、API 封装、services、utils）
- **Tauri 本地层**：`src-tauri/src/**/*.rs`（App 里唯一合法的 Rust，只做本地操作 —— 文件/剪贴板/安全网/凭据存储，不消费后端 API）

排除 `tests/` 目录（测试代码由第二次调用审核）。

> ⚠️ **不要只读 `.rs`**：本仓业务逻辑 99% 在 `.tsx` / `.ts`（React 层），Rust 侧仅本地能力。审查必须覆盖全部变更的 `.tsx` / `.ts` / `.css`，只看 `.rs` 会漏审绝大部分改动。下面「无用兜底 / 过度防御」维度以 TypeScript/React 惯用法为主，`src-tauri/` 的 Rust 文件用括注中的 Rust 等价物判断。

## 审查维度

### 1. 无用兜底代码

检查是否存在以下模式（TypeScript / React）：
- `x ?? fallback` / `x || fallback` 掩盖了本该暴露的错误 — 如果上游（store / API 解包 / props）已保证非空，直接用；如果可能为空且业务需要感知，应显式返回错误 / 显示错误态，而不是静默给默认值
- 空 `catch {}` 或 `catch (e) { console.warn(e) }` 后静默继续，而该错误实际上应中断流程 / 显示错误 UI / 上抛给调用方
- 多余的可选链 `obj?.field`，其中 `obj` 在当前路径已由类型或上游保证存在
- `Array.isArray(x) ? x : []` / `x ?? []` 类兜底，实际数据结构不可能为 undefined / 非数组
- `switch` 的 `default:` 分支处理了联合类型已穷尽的不可能情况（什么都不做）
- 防御性 `structuredClone(x)` / `{ ...x }` 拷贝，在数据流已明确、无共享可变风险时多余
- （`src-tauri/*.rs` 等价物：`unwrap_or_default()` / `unwrap_or(fallback)` 掩盖错误、`match` 无意义兜底分支、错误被 `log::warn` 后静默继续、防御性 `clone()` / `to_owned()`）

**判断标准**：兜底是否有现实的触发路径？如果没有，就是无用兜底。如果有但被静默处理了，就是错误吞没。

### 2. 过度防御

检查是否存在以下模式（TypeScript / React）：
- 对内部函数的返回值做重复校验（上游已保证格式/范围，下游又 validate 一遍）
- 对 TypeScript 类型已保证的字段做运行时 `typeof` / `instanceof` 检查（如参数类型已是 `string`，还 `if (typeof x !== 'string')`）
- 对 Zustand store / Context 已保证初始化的值做多余的 null 检查
- 在 Hook 和消费组件两处对同一个 prop / 参数做相同校验
- `if (!x) return null` / `if (!x) return;` 但 `x` 在当前渲染 / 调用路径中不可能为 falsy
- （`src-tauri/*.rs` 等价物：对 SQLite NOT NULL 字段做多余 `Option` 包装、`if cond { return Err(..) }` 但 cond 不可能为 true）

**判断标准**：该校验是否在保护一个实际可能发生的场景？是否有其他层（类型系统 / store / 上游校验）已经保证了同样的约束？

### 3. 死代码 / 未使用代码

检查是否存在以下模式（TypeScript / React）：
- 新增了组件 / Hook / 工具函数 / 类型但没有被任何地方 import 或使用
- `export` 了但实际只在本模块使用（应改为模块内私有，减少 barrel 噪音）
- import 了但未使用的组件 / 类型 / 工具函数
- 注释掉的代码块（应删除而非注释）
- 预留的 TODO 占位代码没有实际实现
- 违反 CLAUDE.md「个人开发验证期」约束的残留：`@deprecated` 标注但代码仍可被调用、向后兼容 stub、`_` 前缀"保留兼容"参数（应删字段 + 清调用方）
- （`src-tauri/*.rs` 等价物：0 调用方的 `pub fn`、应收窄为 `pub(crate)` 或私有的可见性、未使用的 `use`）

## 输出格式

```
## 代码质量审核报告（业务代码）

### 发现问题

| # | 类型 | 文件:行号 | 问题描述 | 严重度 |
|---|------|-----------|----------|--------|
| 1 | 无用兜底 | src/chat/xxx.tsx:42 | `data ?? []` 掩盖了本该显示错误态的加载失败... | Warning |

### 审核结论

- **通过** — 未发现问题或仅有 Info 级别提示
- **需修复** — 存在 Warning 或 Critical 问题，列出必须修复的项

如果未发现任何问题，输出：
> 代码质量审核通过，未发现无用兜底、过度防御或死代码问题。
```

## 关键规则

- 不修改任何文件，仅读取和分析
- 必须读取实际文件内容，不凭文字描述判断
- 对每个疑似问题，必须说明为什么认为它是问题（有什么现实路径可以触发？或者为什么不可能触发？）
- 严重度标准：Critical = 错误被吞没可能导致状态不一致 / 数据丢失（如缓存被窗口数据覆盖、消息丢失）；Warning = 代码冗余增加维护负担；Info = 风格建议
```

---

### 第二次调用：测试代码审核

**Agent prompt 模板**：

```
你是独立的测试质量审核 Agent。

**审核标准强制引用**：你的判定标准**必须严格遵循** [.claude/skills/test-quality-check/SKILL.md] 中定义的 6 类反模式（A 假测试 / B 空壳断言 / C 测 mock 不测业务 / D 过度兜底变体 / E 永不失败 / F 重复覆盖），不得自行解释"假测试"或"无效断言"的含义。在审核开始前必须先 Read 该 skill 文件完整理解判定标准，否则视为审核无效。

## 审查范围

运行 `git diff --name-only -- tests/` 获取本次变更的测试文件，逐一读取变更内容。同时读取对应的业务代码以理解被测逻辑。

## 审查维度（按 test-quality-check skill 的 6 类反模式逐一检查）

针对每个变更的测试文件，按 test-quality-check skill 中定义的 6 类反模式逐一识别：

- **A 假测试 / Tautology** — 测试自己写死字面量
- **B 空壳断言** — `toBeDefined / toBeTruthy / toHaveBeenCalled` 不带参数
- **C 测 mock 不测业务** — mock 掉 SUT 本身
- **D 过度兜底变体** — ≥3 个本质相同 it
- **E 永不失败** — 吞错 / `expect(true).toBe(true)`
- **F 重复覆盖** — 多文件复制粘贴

完整判定标准、反例、正例、反向验证步骤见 [.claude/skills/test-quality-check/SKILL.md]。

### 覆盖缺失（test-quality-check 之外的额外检查）

对照业务代码检查：
- 新增的组件是否有渲染测试 + 交互测试？（CLAUDE.md 最低覆盖要求）
- 核心 Hook / 工具函数 / API 封装是否有对应测试？（至少 1 正常 + 1 异常）
- 错误路径是否被测试覆盖？（请求失败、参数非法、资源不存在、权限不足）
- 边界条件是否被测试？（空列表、超长字符串、并发 / 竞态、undefined props）

### 3.5 动画冲突覆盖（前端 motion 组件专用）

如果本次变更含 `motion.*` 组件（新增 / 修改 variants / 修改对应 CSS transition），必须检查：

- [tests/animation-conflict.test.ts](tests/animation-conflict.test.ts) 的 `MOTION_CONTROLLED_SELECTORS` 注册表是否补了新 selector？
- 该 selector 对应的 CSS 文件路径是否准确？
- `controlledProps` 是否如实列出 framer-motion 控制的属性（transform / opacity / 等）？
- 该测试是否实际跑过？（不只是注册了 selector）

vitest 默认 `MotionGlobalConfig.skipAnimations = true`，渲染测试**测不出** CSS `transition: all` 与 motion variants 抢同一帧的 bug。只有这个静态扫描测试能拦。**漏注册 = 假覆盖**，列为 Major。

判断方法：
1. `git diff --name-only -- tests/animation-conflict.test.ts` 看注册表是否变更
2. 对照本次新增的 `motion.*` 组件 / 改过的 motion variants，逐一核对 selector 在注册表中存在
3. 缺失任一即上报

### 4. 测试隔离问题

- 测试是否依赖其他测试的执行顺序或副作用？（`beforeEach` 是否 reset mock / store）
- mock 是否在 `beforeEach` / `afterEach` 正确清理（`vi.clearAllMocks()` / `mockReset()`），避免跨用例污染？
- 测试是否复用 `tests/setup.ts` 的全局 mock 与 `tests/utils/test-utils.tsx` 的工具，而非各自硬搓？
- 新增组件是否已按 CLAUDE.md「注册新组件必须同时改两处」在 `tests/registry.ts` + `tests/components/registry.test.tsx` 注册？

## 输出格式

```
## 代码质量审核报告（测试代码）

### 发现问题

| # | 类型 | 文件:行号 | 问题描述 | 严重度 |
|---|------|-----------|----------|--------|
| 1 | 假测试 | tests/components/Xxx.test.tsx:55 | 只 render 写死 className，未引用真组件 | Warning |

### 覆盖率检查

| 组件/Hook/封装 | 正常路径 | 异常路径 | 状态 |
|----------|----------|----------|------|
| useXxx（Hook） | test 加载成功 | test 加载失败降级 | OK |
| <XxxModal>（组件） | 渲染测试 | - | 缺失交互测试 |

### 审核结论

- **通过** — 测试真实有效，覆盖充分
- **需修复** — 列出必须修复的假测试和覆盖缺口
```

## 关键规则

- 不修改任何文件，仅读取和分析
- 必须同时读取测试代码和被测的业务代码，才能判断测试是否真正验证了核心逻辑
- 对每个疑似假测试，必须说明：它实际验证了什么？它遗漏了什么？
- 假测试比没有测试更危险 — 它给人虚假的安全感
```

---

## 结果处理

### 审核通过

直接进入下一步（测试编写或自检）。

### 审核不通过

1. 查看审核报告中的问题列表
2. 对 Critical 和 Warning 级别的问题进行修复
3. 修复完成后**重新调用本 skill**，仅审核修复的部分
4. 直到审核通过才可继续

### 争议处理

如果对审核结果有异议，调用 `/review-dispute` 启动仲裁流程。
