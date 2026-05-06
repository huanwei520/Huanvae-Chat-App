---
name: cleanup
description: 旧代码清理流程 — 功能迭代后安全删除废弃代码、注释、文档，含回滚保护和回归验证
argument-hint: <清理目标描述>
disable-model-invocation: false
allowed-tools: Read, Grep, Glob, Bash, Edit, Write
---

# 旧代码清理流程

功能迭代时，完全采用新逻辑，不考虑向后兼容。旧代码和旧文档必须清理干净，保证零污染。

## 1. 全面排查

使用并行 Agent 搜索所有引用旧逻辑的代码（Grep 函数名、类型名、常量名），确认每一处是否仍被使用：

```bash
# 示例：排查某个被替换的函数
rg "old_function_name" src/ tests/
rg "OldTypeName" src/ tests/
```

列出所有引用位置及其所属模块。

## 2. 确认无用

对每处旧代码，追溯其调用链，确认完全无其他模块依赖：

- 函数/方法：grep 确认无调用方
- 类型/结构体：grep 确认无使用方（包括 trait impl）
- import：确认 use 语句对应的符号确实无人引用

**存疑的不删，标记后询问用户。**

## 3. 清理前提交

保存当前状态到本地，确保可回滚：

```bash
git add -A
git commit -m "chore: 清理前快照 — 保存当前状态以便回滚"
```

## 4. 执行删除

清理以下内容，不留残余：

- **旧代码** — 废弃的函数、结构体、模块文件
- **旧注释** — `// TODO: remove`、`// deprecated`、`// old logic` 等
- **旧文档** — 模块 README 中的过时描述、API 文档中已删除的端点、数据结构说明中已删除的表/列

## 5. 立即测试

**委托 test-runner Agent（haiku）执行，主对话禁止直接运行 cargo test：**

```
Agent(subagent_type="test-runner", prompt="运行全量回归测试 cargo test --test test_runner -- --test-threads=1，报告通过/失败汇总")
```

## 6. 测试失败处理

如有失败：

```bash
# 先回滚到清理前的提交
git checkout HEAD~1
```

分析失败原因，判断：
- **确实还有依赖（不应删除）** — 保留该部分代码，不再尝试删除
- **删除方式有误（需调整删除范围）** — 修正后重新走步骤 3-5

直到测试全部通过。

## 7. 测试通过后提交

```bash
git add -A
git commit -m "cleanup: <说明清理了哪些旧代码及原因>"
git push
```

## 禁止事项

- 保留已废弃的代码/注释/文档"以防万一"
- 保留 `// removed`、`#[deprecated]` 占位
- 保留未使用的 `_variable` 重命名
- 要么确认无用后彻底删除，要么确认有用后保留，**不做中间态**
