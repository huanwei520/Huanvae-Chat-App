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

运行 `git diff --name-only` 获取本次变更的 .rs 文件列表（排除 tests/ 目录），逐一读取变更内容。

## 审查维度

### 1. 无用兜底代码

检查是否存在以下模式：
- `unwrap_or_default()` / `unwrap_or(fallback)` 掩盖了本该暴露的错误 — 如果上游保证非空，直接 unwrap 或用 expect 说明理由；如果可能为空，应该返回明确错误而不是静默吞掉
- `match` / `if let` 中的兜底分支处理了不可能出现的情况（例如 enum 已经穷尽了有意义的变体，但还有一个 `_ => {}` 什么都不做）
- 错误被 `log::warn` 后静默继续，而该错误实际上应该中断流程并返回给调用方
- `Option::map` / `and_then` 链中的 `.unwrap_or(vec![])` 类兜底，实际数据不可能为 None
- 防御性 clone() 或 to_owned()，在所有权已明确的场景下多余

**判断标准**：兜底是否有现实的触发路径？如果没有，就是无用兜底。如果有但被静默处理了，就是错误吞没。

### 2. 过度防御

检查是否存在以下模式：
- 对内部函数的返回值做重复校验（上游已保证格式/范围，下游又 validate 一遍）
- 对框架已保证的行为做额外检查（如 Axum 的 Json extractor 已做反序列化，handler 里又手动检查字段是否存在）
- 对数据库 NOT NULL 约束已保护的字段做 `Option` 包装
- 在 service 层和 handler 层对同一个参数做相同的校验
- `if condition { return Err(...) }` 但 condition 在当前调用链中不可能为 true

**判断标准**：该校验是否在保护一个实际可能发生的场景？是否有其他层已经保证了同样的约束？

### 3. 死代码 / 未使用代码

检查是否存在以下模式：
- 新增了函数/结构体但没有被任何地方调用
- `pub` 可见性但实际只在模块内使用（应为 `pub(crate)` 或私有）
- 导入了但未使用的 trait / 类型
- 注释掉的代码块（应删除而非注释）
- 预留的 TODO 占位代码没有实际实现

## 输出格式

```
## 代码质量审核报告（业务代码）

### 发现问题

| # | 类型 | 文件:行号 | 问题描述 | 严重度 |
|---|------|-----------|----------|--------|
| 1 | 无用兜底 | src/xxx.rs:42 | unwrap_or_default() 掩盖了... | Warning |

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
- 严重度标准：Critical = 错误被吞没可能导致数据不一致；Warning = 代码冗余增加维护负担；Info = 风格建议
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
- 新增的 API 端点是否有对应测试？（至少 1 正常 + 1 异常）
- 核心 service 方法是否有对应测试？
- 错误路径是否被测试覆盖？（权限不足、参数非法、资源不存在）
- 边界条件是否被测试？（空列表、超长字符串、并发操作）

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

- 测试是否依赖其他测试的执行顺序或副作用？
- 测试数据是否通过 `generate_email` 等工具生成，而非硬编码？
- 测试创建的资源是否通过 `TestContext` 追踪并自动清理？

## 输出格式

```
## 代码质量审核报告（测试代码）

### 发现问题

| # | 类型 | 文件:行号 | 问题描述 | 严重度 |
|---|------|-----------|----------|--------|
| 1 | 假测试 | tests/t99_xxx.rs:55 | 只断言了 200 未验证数据变更 | Warning |

### 覆盖率检查

| API/方法 | 正常路径 | 异常路径 | 状态 |
|----------|----------|----------|------|
| POST /api/xxx | test_create_xxx | test_create_xxx_unauthorized | OK |
| DELETE /api/xxx | - | - | 缺失 |

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
