/**
 * 契约测试：HuanvaeGuard 本地控制端口只有一个解析口（localApi.resolveLocalPort），页面不得写死端口。
 *
 * 背景：本地守护进程的控制端口**不是固定值**——同一台机器上可以并存多路守护进程实例，各自绑
 * 不同的回环端口，所以端口真值在 Rust 侧、由 `hg_local_control_port` 逐次解析，
 * `src/huanvaeGuard/localApi.ts` 的 `resolveLocalPort()` 是全仓唯一的解析口。
 *
 * 历史上 `HuanvaeGuardPage.tsx` 在一条**用户可见**的日志里写死了 19198，而 App 实际连的是另一个
 * 端口：功能是好的、日志在撒谎——后来排查"App 到底连在哪个端口上"时被这条日志直接带偏。
 * 这类"显示值与真实行为脱节"的缺陷 vitest 抓不到（jsdom + mock invoke 根本不会发起真实回环请求，
 * 端口写成什么都不影响用例结果），源码级静态扫描是唯一能守住这条线的机制
 * （与 animation-conflict / secure-display-routing 同套路；vitest 静态扫描读源码用 __dirname，
 * 见 .claude/rules/frontend-test.md）。
 *
 * 断言按"块内有界"写法（`[^}]` 限定在块边界内），不用 `[\s\S]*?` 跨段惰性匹配——后者会被下游
 * 无关的同名 token 误满足，变成删掉目标代码仍 PASS 的假测试。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function read(rel: string): string {
  return readFileSync(resolve(__dirname, '..', rel), 'utf-8');
}

/**
 * 剥掉注释，只留代码。
 *
 * 为什么必须剥：「唯一调用点」这条不变量说的是**代码里**只有一个调用点，而散文完全可以
 * 正当地把调用形态原样写出来（localApi.ts 的 DEFAULT_LOCAL_PORT 文档里就有一行
 * `invoke('hg_local_control_port')`，在讲兜底何时生效）。在**含注释**的原文上数调用形态，
 * 注释里的那一处会被算进去 → 1 变 2 → 明明只有一个调用点却 FAIL。收紧成"必须带 invoke 前缀"
 * 也救不了：注释里那句连 `invoke(` 一起写全了。所以计数只能在剥掉注释的代码上做。
 *
 * 为什么按行剥、且**禁止**用 `/\/\/.*$/` 这种朴素行尾剥法：localApi.ts 里有
 * `` `http://127.0.0.1:${port}` `` —— 字符串中段的 `//` 会被朴素正则当成行注释起点，
 * 把 `${port}` 和收尾的反引号一并吃掉，正好毁掉其它「块内有界」断言要匹配的那段文本
 * （`[^}]` 依赖 `${port}` 的 `}` 当块边界）。改成逐行判断：整行 trim 后以 `//` / `*` / `/*`
 * 开头才丢弃，并用 inBlock 跟踪 `/* ... *\/` 跨行块。对本文件的注释风格是精确的，
 * 且永远不会碰到出现在行中间、字符串内部的 `http://`。
 */
function stripComments(src: string): string {
  const kept: string[] = [];
  let inBlock = false;
  for (const line of src.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (inBlock) {
      if (trimmed.includes('*/')) inBlock = false;
      continue;
    }
    if (trimmed.startsWith('/*')) {
      // 单行写完的 /* ... */ 直接丢弃；没闭合的进入块内状态
      if (!trimmed.includes('*/')) inBlock = true;
      continue;
    }
    if (trimmed.startsWith('*') || trimmed.startsWith('//')) continue;
    kept.push(line);
  }
  return kept.join('\n');
}

const PAGE_REL = 'src/huanvaeGuard/HuanvaeGuardPage.tsx';
const LOCAL_API_REL = 'src/huanvaeGuard/localApi.ts';

const PAGE = read(PAGE_REL);
const LOCAL_API = read(LOCAL_API_REL);
/** localApi.ts 的代码部分（已剥注释）—— 凡"数调用点 / 块内有界"的断言都在它上面做。 */
const LOCAL_API_CODE = stripComments(LOCAL_API);

/** 控制端口字面量的形状（默认端口 19198 及其同段邻居，安装时的候选表就在这一段）。 */
const PORT_LITERAL = /1919\d/;

/** 限定语：把数字标注成「默认值 / 由 Rust 侧解析」，而不是当成写死的真值。 */
const QUALIFIER = /默认|default|解析|resolved?/i;

describe('HuanvaeGuardPage 不写死控制端口、不自带解析逻辑', () => {
  it('端口字面量只允许带限定语出现（裸写死的 1919x 即违规）', () => {
    // 本文件是端口的**消费端**，不是真值源：数字可以出现，但必须带「默认 / 由 Rust 侧解析」
    // 这类限定语，与 types.ts / index.ts / localApi.ts 的 6 处准确表述同口径。禁的不是数字本身，
    // 而是**裸写死**的数字——历史缺陷正是一条用户可见日志里裸打 `19198`，而 App 实际连的是
    // 别的端口：功能是好的、日志在撒谎。
    //
    // 注：这条只看**行内**是否有限定语，单靠它拦不住"裸写字面量 + 行尾补个限定语注释"的绕法。
    // 那个洞由本文件另外两条断言堵住（running 分支必须调 `resolveLocalPort()`、日志端口必须是
    // `${}` 插值且插的正是解析出的那个变量）——三条合起来才守得住这条线，故那两条不得削弱或删除。
    //
    // 用逐行过滤而不是单个 boolean 断言：回归时失败信息里直接是那一行源码，
    // 不用再回头 grep 找是谁写死的。
    const offenders = PAGE.split(/\r?\n/).filter(
      (line) => PORT_LITERAL.test(line) && !QUALIFIER.test(line),
    );
    expect(offenders).toEqual([]);
  });

  it('不重复端口解析逻辑：IPC 名 hg_local_control_port 不得出现在页面里', () => {
    // 这条把"单一真值源"从散文变成机器可强制：页面想自己解析端口，必然要提到这个 IPC 名。
    expect(PAGE).not.toContain('hg_local_control_port');
  });
});

describe('「已检测到本地服务」日志用运行时解析出的端口，而非字面量', () => {
  // 锚点 `已检测到本地服务` 是 probeService 里 `if (running) { ... }` 分支独有的文案，
  // 全文件仅此一处；`[^}]` 把匹配限制在该分支块内（块内第一个 `}` 来自 `${port}`）。

  it('running 分支内调 localApi.resolveLocalPort()，且在写日志之前', () => {
    expect(PAGE).toMatch(/if \(running\) \{[^}]*localApi\.resolveLocalPort\(\)[^}]*已检测到本地服务/);
  });

  it('日志里的端口是 ${} 插值，且插的正是 resolveLocalPort() 的返回值', () => {
    // ① 端口位置必须是插值（写死成 `localhost:19198` 时，锚点到块尾都不含 `${` → FAIL）
    expect(PAGE).toMatch(/已检测到本地服务[^}]*\$\{/);
    // ② 插的必须是同一块内 resolveLocalPort() 绑定的那个变量（反向引用 \1 锁住同名），
    //    避免"调了解析口、却把别的值打进日志"这种更隐蔽的说谎形态。
    expect(PAGE).toMatch(
      /const (\w+) = await localApi\.resolveLocalPort\(\);[^}]*已检测到本地服务[^}]*\$\{\1\}/,
    );
  });
});

describe('localApi 是控制端口解析的唯一真值源', () => {
  it('导出解析口 resolveLocalPort(): Promise<number>', () => {
    expect(LOCAL_API).toMatch(/export async function resolveLocalPort\(\s*\)\s*:\s*Promise<number>/);
  });

  it('IPC 名 hg_local_control_port 只被调用一次（唯一调用点）', () => {
    // 在**代码**（已剥注释，见 stripComments）上数调用形态。注释里正当地写出
    // `invoke('hg_local_control_port')` 讲兜底何时生效属正常文档写作，不该把它算成调用点，
    // 更不该把文档写作限制成"不许提这个名字"。多出第二个真调用点 → 从 1 变 2 → FAIL。
    const callSites = LOCAL_API_CODE.match(/'hg_local_control_port'/g) ?? [];
    expect(callSites.length).toBe(1);
  });

  it('resolveLocalBase 复用 resolveLocalPort()，不自己再解析一遍', () => {
    // 块内有界：`async function resolveLocalBase()` 到函数体内第一个 `}`（来自 `${port}`）之间
    // 必须出现 resolveLocalPort()；改成直接 invoke 即 FAIL。
    // 同样在已剥注释的代码上做：将来往该函数体内加一行注释（提到 resolveLocalPort 或 invoke）
    // 不该左右这两条断言的结论。
    expect(LOCAL_API_CODE).toMatch(/async function resolveLocalBase\(\)[^}]*resolveLocalPort\(\)/);
    // 同一块内不得绕过解析口自己发 IPC（"既调解析口、又自己 invoke 一次"的混合退化形态）。
    // `[<(]` 是必须的：调用形态可能是 `invoke(` 也可能带泛型 `invoke<number>(`，只写 `invoke\(`
    // 会漏掉后者（变异验证实测：那样写时把 base 改成 invoke<number>(...) 断言仍 PASS）。
    expect(LOCAL_API_CODE).not.toMatch(/async function resolveLocalBase\(\)[^}]*\binvoke\s*[<(]/);
  });
});
