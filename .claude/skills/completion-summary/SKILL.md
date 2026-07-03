---
name: completion-summary
description: 工作完成后的规范化汇总输出 — 改动范围、测试结果、审核状态、遗留事项一览
disable-model-invocation: false
allowed-tools: Read, Grep, Glob, Bash
---

# 完成汇总

全流程（实现 → 代码审核 → 测试 → 自检 → 盲审）通过后，输出规范化的完成总结。

## 前置条件

以下环节必须全部完成才能输出汇总。**任何一项缺失都禁止输出完成总结**：

- [x] Plan 所有步骤已执行
- [x] `/code-review` 代码审核通过（业务代码）
- [x] `/code-review` 测试审核通过（含动画冲突测试覆盖检查）
- [x] **`scripts/test-all.ps1` 全量门禁 9/9 PASS**（不可只跑 typecheck + test:run 就替代）
- [x] **若任务含动画变更：`pnpm vitest run tests/animation-conflict.test.ts` 注册表已更新且 PASS**
- [x] 自检逐项核对通过
- [x] `/blind-review` 盲审通过
- [x] `/skill-evolve` 经验回顾已执行

`scripts/test-all.ps1` 是最终事实门禁。**`pnpm test:run` 全绿 ≠ test-all.ps1 全绿** —— 后者还跑严格 ESLint（`--max-warnings 0`）、TypeScript、前端 build、cargo check、clippy 桌面 + Android。本地任务结束前如果只跑过 vitest 就声明完成属于违规。

## 汇总模板

输出以下格式的完成总结：

---

```
## 完成总结

### 功能概述

{一句话描述本次实现了什么功能/修复了什么问题}

### 改动范围

| 类型 | 文件 | 改动说明 |
|------|------|----------|
| 新增 | src/chat/xxx/XxxModal.tsx | 新增 xxx 弹窗组件 |
| 修改 | src/hooks/useXxx.ts | 增加 xxx 业务逻辑 |
| 修改 | src/api/xxx.ts | 新增 xxx API 封装 |
| 新增 | tests/components/XxxModal.test.tsx | xxx 组件渲染 + 交互测试 |

### 新增/修改的 API 封装

| 函数 | 文件 | 后端端点 | 说明 |
|------|------|----------|------|
| createXxx() | src/api/xxx.ts | POST /api/xxx | 创建 xxx（经 secureFetch） |
| getXxx() | src/api/xxx.ts | GET /api/xxx/:id | 获取 xxx 详情 |

（如无 API 封装变更，省略此节）

### 本地数据（SQLite）变更

| 操作 | 表 / 字段 | 说明 |
|------|-----------|------|
| 新建表 | xxx（src/db/） | 存储 xxx 本地数据 |
| 新增列 | yyy.new_col | 支持 xxx 功能 |

（如无本地数据变更，省略此节）

### 测试覆盖

| 测试文件 | 用例数 | 覆盖内容 |
|----------|--------|----------|
| tests/components/XxxModal.test.tsx | 6 | 渲染 + 交互 + 边界条件 + 错误路径 |

运行结果：全部通过 / N 个通过, M 个已知失败

### 审核状态

| 环节 | 状态 | 备注 |
|------|------|------|
| 代码质量审核（业务代码） | PASS | — |
| 代码质量审核（测试代码） | PASS | — |
| scripts/test-all.ps1 全量门禁 | 9/9 PASS | NSIS/package.json/TS/ESLint严格/Vitest/build/cargo check/clippy 桌面/clippy Android |
| 动画冲突测试 | PASS / 不涉及 | 涉及动画时必须列出 tests/animation-conflict.test.ts 新增的 selector |
| 自检 | PASS | N/N 步骤已完成 |
| 盲审 | PASS | — |
| 经验回顾 | 已执行 | {归纳了 N 条经验 / 无可归纳经验} |

### 文档同步

| 文档 | 状态 |
|------|------|
| 代码注释 | 已更新 |
| 模块 README | 已更新 / 无需更新 |
| API 文档 | 已更新 / 无需更新 |
| 数据结构说明 | 已更新 / 无需更新 |
| Rules/Skills | 已更新 / 无需更新 |

### 遗留事项

{列出已知遗留问题、待用户裁定的争议项、后续优化建议。如无则写「无」}

### 部署提示

{如需特殊部署步骤（如数据库迁移、环境变量配置），在此列出。如无则省略此节}
```

---

## 遗留事项处理流程（不可跳过）

汇总输出后，如果遗留事项不为空，**必须立即执行以下流程**，不可留到下次对话：

1. **逐项分类** — 对每个遗留项标注：
   - **可立即修复** — 代码/配置层面的问题，当前会话可解决
   - **有意设计** — 经审计确认非缺陷，记录原因后关闭
   - **需单独任务** — 范围超出本次修改（如 pre-existing 问题），记录到 memory 或 issue

2. **用户双向确认** — 将分类结果展示给用户，确认优先级和处理方式

3. **立即修复** — 用户确认后，"可立即修复"的项**在当前会话内完成修复**，包括：
   - 代码修改
   - 编译/lint 验证
   - 更新完成总结中的遗留事项状态

4. **关闭或转移** — "有意设计"项标注关闭原因；"需单独任务"项记录到对应位置

**禁止**：输出完成总结后直接结束会话，留下未处理的"可立即修复"遗留项。

## 输出规则

1. **只包含事实** — 不加主观评价（不写「完美实现」「高质量代码」）
2. **省略无关板块** — 没有 API 变更就不写 API 节，没有数据库变更就不写数据库节
3. **精确到文件** — 改动范围必须列出每个变更文件，不用「等」省略
4. **测试数据真实** — 用例数和通过数必须来自实际运行结果，不可估算
5. **遗留事项诚实** — 有就写，不要为了好看而隐瞒已知问题
