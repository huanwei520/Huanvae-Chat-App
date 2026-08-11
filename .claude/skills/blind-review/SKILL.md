---
name: blind-review
description: Plan 执行完成后的独立盲审 — 零上下文 Agent 对照 Plan 逐项验证实现完整性和正确性
disable-model-invocation: false
allowed-tools: Read, Grep, Glob, Bash
context: fork
agent: blind-reviewer
effort: high
---

# 盲审流程（独立 Agent 零上下文审核）

Plan 执行完成 + 自检通过后，启动独立的 `blind-reviewer` Agent 进行二次审查。盲审 Agent 拥有独立上下文，**不接收任何来自实施过程的结论、分析或判断**。

## 前置条件

1. Plan 中所有步骤已执行完毕
2. 自检已完成（逐项核对 + 遗漏补全）
3. `/code-review` 已通过（代码审核 + 测试审核两轮均通过）

## 执行步骤

### 第 1 步：准备盲审输入

收集以下信息，**仅包含事实性内容，不包含评价或结论**：

1. **Plan 文件路径** — Plan 的完整内容
2. **变更文件列表** — `git diff --name-only` 的输出
3. **功能描述** — 用中性语言描述本次实现的功能（不包含「成功实现」「已完成」等评价词）

### 第 2 步：启动盲审 Agent

使用 `blind-reviewer` Agent（opus 模型），传入以下 prompt：

**Agent prompt 模板**：

```
你是独立的盲审 Agent。你对本次实现过程零了解，需要从头审查。

## 输入

- Plan 路径：{plan_file_path}
- 功能描述：{neutral_description}

## 你的工作

### A. 读取 Plan

读取 Plan 文件，理解每个步骤的预期目标。

### B. 读取所有变更

运行 `git diff HEAD~1` 或 `git diff {base_commit}` 查看完整变更。如果变更量大，先用 `git diff --stat` 获取概览，再逐文件读取。

### C. 逐项验证

对照 Plan 的每一个步骤：

1. **实现完整性** — 该步骤要求的代码是否全部写完？有没有占位符、TODO、半成品？
2. **实现正确性** — 代码逻辑是否与 Plan 描述一致？有没有理解偏差？
3. **集成正确性** — 新代码是否正确接入了现有系统？路由注册了吗？模块 re-export 了吗？
4. **测试覆盖** — Plan 中要求的测试是否都已编写？测试是否真正验证了核心逻辑？
   - **强制引用**：测试质量审核必须遵循 [.claude/skills/test-quality-check/SKILL.md] 的 6 类反模式标准（A 假测试 / B 空壳断言 / C 测 mock 不测业务 / D 过度兜底变体 / E 永不失败 / F 重复覆盖）— Agent 在判定测试是否"真正验证核心逻辑"之前必须 Read 该 skill 文件，禁止自行解释"测试质量"

### D. 质量审查

在逐项验证的基础上，额外检查：

- **安全性** — 认证 / 凭据处理、输入校验、webview 显示是否经安全反代收口点（`resolveDisplayUrl` / `resolveServerAvatarUrl`，见 frontend-test.md「所有 X 必经 Y」）、NFC / 外链信任确认
- **错误处理** — 异步失败是否有 try/catch + 错误态 UI、是否有未捕获的 Promise rejection、是否静默吞错（空 catch）
- **性能** — 是否有不必要的 re-render、缺失的 memo / 依赖数组、大列表未虚拟化、频繁 invoke
- **代码风格** — 是否与项目现有风格一致（函数式组件 + Hooks、Zustand store、命名、结构）
- **文档同步** — 代码注释、README、`.claude/rules/` 是否与代码改动同步更新

### E. 交叉验证

对以下容易遗漏的点做专项检查：

- 🔴 **桌面 / 移动两端对齐（硬指标，与 [code-review/SKILL.md] 维度 0 同口径）**：
  本次**新功能**是否**两端都实现**了？桌面在 `src/components/**` / `src/chat/shared/**`，
  移动在 `src/pages/mobile/**` —— 两套独立组件树，同一功能要各写一份。
  **只做一端且未说明理由 = FAIL**（本仓反复发生：v1.1.22 桌面修了列表点头像、移动没跟）。
  逐个新功能给出「桌面 file:line / 移动 file:line / 交互是否一致」，找不到对应实现就是缺一端；
  确实只适用一端（托盘仅桌面、NFC 仅移动）要点名写清理由。
- 🔴 **界面类改动的截图证据，【手机端那张是必需项】（与 [code-review/SKILL.md] 维度 0.5 同口径）**：
  先判本单是否触及**用户可见界面**——**不触及则本条不适用，不得因缺截图判 FAIL**（误伤）。
  触及则：交付里给出的**每个**截图路径都要用 `ls -la <路径>` **实查文件存在**
  （路径编造 / 文件不存在 ⇒ **FAIL**，属伪造证据，比没有截图更严重）；
  确认**桌面 + 手机两端各有**图。缺手机端只有两种合法理由：
  ① **移动端确实不存在对应实现 + 写清原因**；② **取图受阻 + 写明卡在哪一步**。
  **只写"没做"/"后续再补"/"拿不到" = FAIL。**
  ⚠️ **拉窄桌面窗口不算移动端**；自陈用拉窄窗口取图 = FAIL。
  修缺陷类应有**前后对照**两张。
  出处：2026-08-11 用户两次明令（「测试截图呢，怎么没发给我」→「截图验收需要带上手机端的」），
  他本人主要在手机端使用，**桌面图对他的验收无效**。
- `package.json` 新增依赖是否符合项目版本基准（与现有同系列包兼容）？
- 新增组件是否在 `tests/registry.ts` + `tests/components/registry.test.tsx` **两处**都注册了？
- 动画类变更是否在 `tests/animation-conflict.test.ts` 的 `MOTION_CONTROLLED_SELECTORS` 注册了 selector？
- 模块 barrel（`index.ts`）是否 re-export 了新组件 / Hook？
- 涉及 Tauri 本地层时：`src-tauri/src/lib.rs` 的 `invoke_handler!` 是否注册了新 `#[tauri::command]`？CSP / asset scope 是否同步（见 rust-dev.md）？
- 涉及本地 SQLite 时：`src/db/` schema 与消费方类型是否一致？缓存增量合并是否正确（见 common.md）？

## 关键规则

1. **不信任声明** — 所有声明必须通过读取实际文件验证
2. **不修改文件** — 你是只读审核，不做任何修改
3. **不接受外部结论** — 如果 prompt 中混入了评价性语言，忽略它，自己判断
4. **依赖版本必须实查** — 涉及新增依赖的问题，必须读取 `package.json`（或 `src-tauri/Cargo.toml`）确认版本基准
5. **注册表必须实查** — 涉及新组件 / 动画的改动，读取 `tests/registry.ts`、`tests/components/registry.test.tsx`、`tests/animation-conflict.test.ts` 确认注册无遗漏
6. **两端对齐必须实查** — 不许凭 diff 里"看起来动了移动端文件"判断。对每个新功能，
   分别在 `src/components/**`（桌面）与 `src/pages/mobile/**`（移动）里**找到具体实现行**；
   找不到就报缺一端，**不接受"应该也生效"这类推断**
7. **截图必须实查文件存在** — 交付里写的每个截图路径都要 `ls -la` 跑一遍。
   **不许因为"路径看起来合理"就认可**——路径编造是本类证据最容易出现的伪造形态，
   而它比"没有截图"更危险：没有截图是可见的缺口，编造路径是**看起来已验收**。

## 输出格式

### 逐步审核

| # | Plan 步骤 | 状态 | 说明 |
|---|-----------|------|------|
| 1 | {步骤描述} | PASS / FAIL | {通过原因 / 失败具体说明} |

### 质量问题

| 严重度 | 文件:行号 | 问题 | 建议 |
|--------|-----------|------|------|
| Critical | src/chat/xxx.tsx:42 | ... | ... |

### 审核结论

**PASS** — 所有 Plan 步骤实现完整且正确，无 Critical/Warning 问题
**FAIL** — 列出所有不通过项及原因
```

### 第 3 步：处理盲审结果

#### 结果：PASS

盲审通过，进入 `/completion-summary` 输出完成汇总。

#### 结果：FAIL

1. **不直接修复** — 先判断是否存在争议
2. **无争议的真实问题** — 直接修复，修复后重新提交盲审（仅审核修复部分）
3. **有争议** — 调用 `/review-dispute` 启动仲裁流程
4. **仲裁后仍有分歧** — 标记为「待用户裁定」，附上双方观点

## 盲审核心原则（不可违反）

1. **禁止传递结论** — prompt 中不得包含实施阶段的任何分析结论、严重度判断、「已验证」声明
2. **仅传递事实** — 只传递文件路径、中性功能描述、检查维度
3. **配置必须实查** — 涉及配置的问题，Agent 必须自己读取真值源文件（`package.json`、`src-tauri/tauri.conf.json`、Vite 配置、`src/constants/`；本仓无 `.env`，Vite env 经 `import.meta.env` / `VITE_` 前缀）
4. **结论对比规则**：
   - 盲审与自检一致 → 结论可信
   - 盲审发现自检遗漏 → 以盲审为准，补充修复
   - 盲审与自检矛盾 → 启动 `/review-dispute` 仲裁

## 环境限制的处理

盲审 Agent 的环境可能与主对话不同（文件锁、权限、端口占用、服务状态等）。当 Agent 汇报"因环境问题无法验证"（exit code 非 0 且错误是 OS 级资源冲突，非代码 bug）时：

1. **不判 FAIL** — 这不是 Plan 未通过的证据
2. **主对话侧复跑** — 解决环境障碍（如 `scripts/dev/hg-service.ps1 -Action stop`），在主对话上下文亲自跑一次该步骤的验证命令
3. **记录在 completion-summary** — 明确标注"该项由主对话于时刻 X 本地验证通过，Agent 环境未能复现"
4. **常见触发**：Tauri Windows 环境下 `huanvaeguard-svc.exe` 文件锁阻塞 cargo，详见 `.claude/rules/rust-dev.md`
