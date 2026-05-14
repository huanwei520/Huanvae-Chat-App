---
name: test-quality-check
description: 测试质量审核标准 — 识别假测试、空壳断言、过度兜底、测试 mock 而非业务的反模式。所有 Agent（code-review / blind-review）在审核测试代码时必须以本 skill 为审核标准。
argument-hint: <测试文件路径 / 模块名 / 'all'>
disable-model-invocation: false
allowed-tools: Read, Grep, Glob, Bash
effort: high
---

# 测试质量审核标准

**核心原则**：测试无兜底 + 测试不假通过。一个误判为通过的假测试 > 没有测试。

本 skill 定义了识别"假通过测试"的硬性标准，适用于：

- 主对话审计现有测试代码时
- `code-review` skill 第二次调用（测试代码审核）
- `blind-review` skill 涉及测试覆盖审查时
- `health-check` skill 检查测试质量时

调用方式：将本 skill 的"6 类反模式判定"原文嵌入审核 Agent prompt 中作为唯一标准，**禁止**让 Agent 自行解释"测试质量"。

---

## 6 类反模式（每条必须按精确判定标准识别）

### 类 A：假测试 / Tautology（测试本身写死字面量）

**精确判定**：测试断言的值 = 测试自己 render 出的字面量字符串/对象，**不引用真组件的逻辑**。

**反例**（必删）：

```tsx
// ❌ 测试自己写死 className，render 后断言这个写死的字符串
it('subtle-btn--primary 渲染', () => {
  render(<button className="subtle-btn subtle-btn--primary" />);
  expect(screen.getByRole('button')).toHaveClass('subtle-btn--primary');
});

// ❌ 字面量对象的字段读出来当断言
it('对象有 name 字段', () => {
  const obj = { name: 'test' };
  expect(obj.name).toBe('test');
});

// ❌ 测自己 mock 的字符串
const mockResult = '/api/checkin';
vi.mock('./api', () => ({ getUrl: () => mockResult }));
it('返回正确 URL', () => {
  expect(getUrl()).toBe('/api/checkin');
});
```

**正例**：

```tsx
// ✅ 渲染真组件，断言三元/拼接表达式的输出
it('SettingsRow 在 buttonVariant=danger 时输出 --danger className', () => {
  render(<SettingsRow type="button" buttonVariant="danger" label="x" onClick={() => {}} />);
  const btn = screen.getByRole('button', { name: 'x' });
  expect(btn).toHaveClass('subtle-btn--danger');
  expect(btn).not.toHaveClass('subtle-btn--primary');
});

// ✅ default 路径反向断言（覆盖三元另一分支）
it('SettingsRow 默认 buttonVariant 输出 --primary className', () => {
  render(<SettingsRow type="button" label="x" onClick={() => {}} />);
  const btn = screen.getByRole('button', { name: 'x' });
  expect(btn).toHaveClass('subtle-btn--primary');
});
```

**反向验证步骤**（每条疑似假测试必跑）：

1. 找断言的值在测试文件内是否硬编码出现
2. 如果是 — 看 render 用的是真组件还是字面量节点
3. 如果 render 字面量节点 — **确认假测试**
4. 如果 render 真组件 — 跑断言对应的三元/拼接是否在源组件内真实存在

### 快速识别启发法（高准确率，可大批扫）

实战中两条启发法可在**一次 Read 文件头**即可命中 90% 的 A 类假测试：

#### 启发 1：检查 import 段是否引用任何 SUT

`grep -E '^import.*from.*['\''"]\.\./\.\./src/(?!types/)' <testfile>` —— 如果**只**命中 `from '../../src/types/...'`（仅 import 类型），**没有**任何 function / component / hook import，该测试文件几乎注定是 A 类假测试。

理由：测试若不调用 SUT 的任何运行时实体，所有 `expect` 必然作用于测试自己构造的字面量 / 自己重写的逻辑。

**实战命中**（2026-05-14）：
- `tests/unit/aiCard.test.ts` 仅 `import type { ChatTarget, AIMessage, ... } from '.../src/types/chat'` — 148 行全 A 类假测试，整文件删除
- `tests/unit/mobileAddPage.test.ts` **零 src/ import**（连类型也没有） — 309 行全 A 类假测试，整文件删除

#### 启发 2：检查测试体是否重写 SUT 业务逻辑

测试体内出现以下模式时，几乎必是 A 类：

```ts
// ❌ 测试体内重写 SUT 三元 / 业务规则
it('pendingCount > 99 显示 99+', () => {
  const pendingCount = 150;
  const display = pendingCount > 99 ? '99+' : String(pendingCount);  // ← 重写 SUT 业务规则
  expect(display).toBe('99+');
});

// ❌ 测试体内重写 SUT 数组操作
it('approved 后从列表移除', () => {
  const requests = [{ request_id: 'r1' }, { request_id: 'r2' }];
  const filtered = requests.filter((r) => r.request_id !== 'r1');  // ← 重写 SUT filter
  expect(filtered).toHaveLength(1);
});

// ❌ 测试体内手动排序后断言排序结果
it('AI 卡片置顶', () => {
  cards.sort((a, b) => { /* 排序逻辑 */ });
  const finalList = [aiCard, ...cards];  // ← 手动 prepend
  expect(finalList[0].type).toBe('ai');
});
```

判定标准：测试体内出现 `Array.prototype.filter / sort / map / reduce` / 三元 / `obj || default` 等**计算**，且断言验证的是这些计算的结果 → A 类。

理由：这些计算本应该在 SUT 内执行；测试自己执行 = 验证的是测试代码而非 SUT 代码。

---

### 类 B：空壳断言（toBeTruthy / toBeDefined / toHaveBeenCalled 不带参数）

**精确判定**：断言只检查"存在性"或"调用过"，**不验证实际值或调用参数**。

**反例**（必加强或删）：

```ts
// ❌ 只断言被调用过，不知道传了什么
expect(mockFn).toHaveBeenCalled();

// ❌ 断言 result 存在，但 result 永远不可能是 null（函数签名 Promise<T> 而非 Promise<T | null>）
const result = await someFn();
expect(result).toBeDefined();

// ❌ 检查列表非空，没断言任何元素
expect(items.length).toBeGreaterThan(0);
```

**正例**：

```ts
// ✅ 断言调用参数
expect(mockFn).toHaveBeenCalledWith({ id: '123', type: 'friend' });
expect(mockFn).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'success' }));

// ✅ 断言列表的具体内容/顺序
expect(items).toEqual([
  { id: '1', name: 'foo' },
  { id: '2', name: 'bar' },
]);

// ✅ 长度 + 内容字段双断言
expect(items).toHaveLength(2);
expect(items[0]).toMatchObject({ status: 'pending' });
```

**反向验证步骤**：

1. 找所有 `toHaveBeenCalled()`（无 `With`），看有无配套 `toHaveBeenCalledWith` 在同一 it 内
2. 找所有 `toBeDefined()` / `toBeTruthy()`，看变量类型是否真的可能是 undefined（如果不可能 — 假断言）
3. 找所有 `toBeGreaterThan(0)` / `.length`，看是否补充了元素断言
4. **三 strikes**：单 it 内 ≥ 2 个空壳断言 + 0 个有效断言 → 标 Critical

---

### 类 C：测 mock 不测业务（过度 mock 至全空壳）

**精确判定**：测试 mock 掉了**被测对象自身的核心逻辑**（不只是外部依赖），导致断言验证的是 mock 行为而非真业务。

**反例**（必删或重写）：

```ts
// ❌ mock 掉被测函数本身
import { processOrder } from './order';
vi.mock('./order', () => ({
  processOrder: vi.fn().mockReturnValue({ success: true }),
}));
it('processOrder 成功', () => {
  const result = processOrder({ id: '1' });
  expect(result.success).toBe(true);  // 测的是 mock 的 returnValue，不是真逻辑
});

// ❌ mock 掉所有依赖且 mock 行为决定了断言结果
vi.mock('./db', () => ({ query: () => [{ id: '1' }] }));
vi.mock('./auth', () => ({ check: () => true }));
vi.mock('./logger', () => ({ log: vi.fn() }));
it('handler 返回数据', () => {
  const res = handler({ user: 'x' });
  expect(res.data).toHaveLength(1);  // 这是 mock 的 query 行为，不是 handler 的真业务
});
```

**正例**：

```ts
// ✅ 只 mock 外部边界（HTTP / 数据库），断言被测函数的核心逻辑
vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn().mockResolvedValue({ status: 200, json: async () => ({ data: { user_id: 'u1' } }) }),
}));
it('login 成功后保存 user_id 到 session store', async () => {
  await login('alice', 'pwd');
  expect(useSessionStore.getState().userId).toBe('u1');  // 被测代码的真行为
});
```

**反向验证步骤**：

1. grep 测试文件内 `vi.mock(` 的模块路径
2. 检查这些模块是不是 SUT（System Under Test）— 如果 `vi.mock('./order')` 且 it 测试调用的就是 `order.processOrder` → **测 mock**
3. 检查 mock 是否覆盖了 SUT 的核心计算 / 状态变更逻辑 — 如果是 → 测试无实质验证

---

### 类 D：过度兜底变体（N 个本质相同场景）

**精确判定**：N (≥3) 个 it 测试覆盖**完全同型**的逻辑分支，断言模式 100% 一致，只是数据值不同。

**反例**（必合并）：

```tsx
// ❌ 5 个 it 测试 5 种 size，断言模式完全一样
it('size=small 渲染', () => { render(<Btn size="small" />); expect(getByRole('button')).toHaveClass('btn--small'); });
it('size=medium 渲染', () => { render(<Btn size="medium" />); expect(getByRole('button')).toHaveClass('btn--medium'); });
it('size=large 渲染', () => { render(<Btn size="large" />); expect(getByRole('button')).toHaveClass('btn--large'); });
it('size=xl 渲染', () => { render(<Btn size="xl" />); expect(getByRole('button')).toHaveClass('btn--xl'); });
it('size=xxl 渲染', () => { render(<Btn size="xxl" />); expect(getByRole('button')).toHaveClass('btn--xxl'); });
```

**正例**（用 it.each 合并）：

```tsx
// ✅ 表驱动一处覆盖所有变体
it.each(['small','medium','large','xl','xxl'] as const)('size=%s 渲染 btn--%s', (size) => {
  render(<Btn size={size} />);
  expect(getByRole('button')).toHaveClass(`btn--${size}`);
});
```

**反向验证步骤**：

1. 在同一 describe / 文件内找连续 ≥ 3 个 it，名字 pattern 类似 `size=X / status=X / type=X`
2. 看 it 函数体除常量字面量外是否完全相同
3. 是 → 建议合并为 `it.each`；**但不删测试覆盖**（核心是变体场景仍要测，只是组织方式优化）
4. **注意**：D 类是"组织优化"而非"虚假测试"，**优先级低于 A/B/C**

---

### 类 E：永不失败（吞错 / skip / `true.toBe(true)`）

**精确判定**：测试结构上**不可能 FAIL**。

**反例**（必删）：

```ts
// ❌ try/catch 吞掉所有错误
it('xxx', () => {
  try {
    expect(someFn()).toBe('correct');
  } catch {
    // 静默通过
  }
});

// ❌ conditional skip 永久成立
if (process.env.SKIP_TESTS) {
  it.skip('xxx', () => {});
} else {
  it('xxx', () => { expect(true).toBe(true); });  // 不管 env 都是空壳
}

// ❌ 经典反例
it('basic sanity check', () => {
  expect(true).toBe(true);
});

// ❌ Playwright canary
test('app loads', async ({ page }) => {
  await page.goto('/');
  // 无任何断言
});
```

**正例**：测试必须包含至少一个**能让它失败**的断言。

**反向验证步骤**：

1. grep `expect(true)\.toBe\(true\)` / `expect\(\d+\)\.toBe\(\d+\)` 字面量重复
2. grep `try.*\{[^}]*expect[^}]*\}.*catch.*\{\s*\}` 空 catch
3. grep `\.skip` 看是否 conditional 永远 skip
4. 整个 test 函数体内是否含任意 expect 语句

---

### 类 F：重复覆盖（多文件复制粘贴同一断言）

**精确判定**：同一断言（同 SUT + 同输入 + 同 expected）在 ≥ 2 个测试文件中重复出现，删除 N-1 个不损覆盖。

**反例**（必去重）：

```ts
// tests/api/users.test.ts
it('getUser returns user data', async () => {
  const u = await getUser('123');
  expect(u.id).toBe('123');
  expect(u.name).toBe('alice');
});

// tests/components/UserCard.test.tsx
it('UserCard fetches getUser', async () => {
  const u = await getUser('123');  // 同样调用
  expect(u.id).toBe('123');         // 同样断言
  expect(u.name).toBe('alice');
  // 然后才是组件渲染相关的测试
});
```

**正例**：UserCard 测试应专注组件行为（mock `getUser`），`getUser` 单测在 `tests/api/users.test.ts` 单独覆盖一次即可。

**反向验证步骤**：

1. grep 同一函数名（如 `getUser('123')`）在 `tests/` 的所有出现
2. 对比这些位置的断言模式 — 完全一致 → 重复
3. 决定保留哪一份（建议保留单测层，组件层 mock 掉它）

---

## 反向验证规则（每条 finding 上报前必走）

**精准度 >> 召回率**。误删一个真实测试的破坏性远大于漏报一个假测试。

1. **存在性验证** — `Grep -n` 精确到文件:行号 + Read 上下 5 行
2. **意图标记检查** — 查看 it 名 / 文件头注释：
   - `// 防回归测试` / `// 故意写死字面量验证 X` — 可能有特殊原因，需进一步核实
   - `it.skip` / `it.todo` — 已被显式跳过，不必清理
3. **被测代码追踪** — 如果是 A 类（假测试），必须 grep 被测组件 / 函数源码，确认断言的字面量在源码中是否真的产生
4. **反面论证** — 主动构造"这测试是有价值的"论据：
   - 可能是契约测试（如 "API 返回字段名必须为 user_id" — 写死字面量但代表 contract）— 不算假
   - 可能是 snapshot / regression — 看是否有相关 comment
5. **对比一致性** — 项目内同类测试如何写？如果只有此处异常 — 更可能是 bug；如果全部都这样 — 可能是项目约定

---

## 输出格式（每条 finding）

```
### Finding [N] [class-A/B/C/D/E/F]

- **位置**: `tests/.../xxx.test.ts:行号` (精确到行号)
- **症状**: 一句话描述
- **断言**:
  ```ts
  <原始代码片段>
  ```
- **反向验证**:
  - 存在性 ✅ `Grep -n "<pattern>"` → `tests/...:line`
  - 意图标记 ✅ 上下 5 行 + 文件头无特殊注释
  - 被测代码追踪 ✅ <SUT 源码 grep 结果>
  - 反面论证 ❌ <尝试为"有价值"辩护 / 失败原因>
  - 一致性 ✅ <项目内其他位置同类断言对比>
- **触发概率**: 几乎不会 / 罕见 / 常见
- **建议**: 删除 / 加强断言 / 合并为 it.each / 移动到正确测试层
- **严重度**: Critical (A/C/E) / Major (B 全无效断言) / Minor (D 优化建议 / B 部分加强 / F 去重)
```

---

## 严重度判定

| 严重度 | 标准 | 必须处理 |
|--------|------|---------|
| **Critical** | A 类假测试 / C 类测 mock 不测业务 / E 类永不失败 — **完全没有防回归价值** | 立即删除 |
| **Major** | B 类全空壳（同 it 内无任何有效断言）/ F 类重复覆盖（N ≥ 3 份完全相同） | 删除或重写 |
| **Minor** | B 类部分空壳（同 it 内既有空壳也有有效断言）/ D 类变体合并 / 文件头注释失真 | 视情况清理 |

---

## 与其他 skill 的衔接

### 嵌入到 `code-review` skill 的"测试代码审核"路径

`code-review/SKILL.md` 第二次调用时，Agent prompt **必须**说明：

> 审核维度遵循 [.claude/skills/test-quality-check/SKILL.md] 中的 6 类反模式标准。**禁止自行解释"假测试"含义**，必须严格按本文档判定。

### 嵌入到 `blind-review` skill 的测试覆盖检查

`blind-review/SKILL.md` 中"测试覆盖"审核维度的判定标准必须引用本 skill。

### 嵌入到 audit / health-check skill 的测试质量扫描

当 audit 或 health-check 涉及测试代码时，启动的扫描 Agent prompt **必须**嵌入本 skill 的 6 类反模式判定 + 反向验证规则。

---

## 与 `.claude/CLAUDE.md` 的衔接

按 "项目阶段：个人开发验证期" 核心约束，**确认的 Critical 假测试一律删干净，禁止保留"以防万一"或"等下次重写"**。
- Critical / Major 必须当批清理
- Minor 可分批，但**不留** `// TODO 待清理` 注释占位

---

## 资源限制

调用此 skill 的 Agent 必须遵守：

- 不超过 3000 词输出
- 不读超过 60 个测试文件
- 不执行实际修改（仅审核 + 报告）
- **严格遵守"精准度 > 召回率"**，宁可漏报小毛病也不要误报真实测试
