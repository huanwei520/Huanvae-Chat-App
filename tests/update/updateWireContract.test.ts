/**
 * 更新下载进度事件：Rust ↔ TS 的**线格式**契约守卫
 *
 * ## 它替代了什么，为什么非替代不可
 *
 * 原先 `updateResume.test.ts` 里那组「跨语言契约」只是 grep 两边源码有没有 `downloaded`
 * 这几个字，**对格式漂移在结构上不可能翻红**：v1.1.23（`1f42b3e`）起 Rust 侧写的是
 * `#[serde(rename_all = "camelCase", …)]`，在 enum 上它renames 的是**变体名**而不是字段名，
 * 于是真实线格式一直是
 *
 *     {"event":"started","data":{"content_length":9700000,"downloaded":0}}
 *
 * 而前端 `service.ts` 的 `switch (msg.event)` 只认 `'Started'/'Progress'/'Finished'`
 * ⇒ **十个版本里一条进度都没进过前端**，进度条全程停在 `startDownload()` 的初值。
 * 那组 grep 守卫、以及其余往假通道喂**前端自己手写形状**的更新测试，全程绿着。
 * 「测试喂给被测代码的是前端假设的形状」正是这个 bug 能静默存活的直接原因。
 *
 * ## 这份守卫怎么做到「真能红」
 *
 * 1. **线格式不是手写的，是从 Rust 源码解析出来的**：读 `updater_download.rs`，
 *    解析 `#[serde(...)]` 属性 + 变体名 + 字段名，按 serde 的 rename 语义算出真实 JSON 形状。
 * 2. **黄金样本来自 serde 1.0.228 实跑**（不是推断）：把仓内 enum 的属性逐字节照抄进一个
 *    独立 crate 跑 `serde_json::to_string`，两种写法的真实输出分别是
 *      - `rename_all       = "camelCase"` → `{"event":"started","data":{"content_length":…}}`
 *      - `rename_all_fields = "camelCase"` → `{"event":"Started","data":{"contentLength":…}}`
 *    下面的 `GOLDEN` 钉的就是后者。Rust 侧任何一处变体名/字段名/serde 属性改动 ⇒ 派生结果
 *    与 `GOLDEN` 不再相等 ⇒ 红（提醒：改契约必须两侧同改，并重跑一次真 serde 复核黄金样本）。
 * 3. **派生出来的那份形状被真的喂进前端真实 handler**（`downloadAndInstall`，非 mock），
 *    断言每条事件都被消费、数值一路走通。tag 或字段名任一漂移 ⇒ switch 不命中 / 取到
 *    `undefined` ⇒ 红。
 *
 * ## 覆盖不到的（写清楚，别让读者以为是全覆盖）
 *
 * - 解析器只支持它**用得上**的那几条 serde 规则；遇到没实现的规则值直接抛错（不静默放行），
 *   但这意味着换用别的 rename 规则时需要先来这里补规则 + 用真 serde 复核黄金样本。
 * - 它守的是**形状**，不守「事件到底有没有被发出去」——那属于运行时，由下方
 *   「首帧进度」那组的顺序断言 + 真机验收覆盖。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { invoke } from '@tauri-apps/api/core';
import type { DownloadProgress } from '../../src/update/service';
import { downloadAndInstall } from '../../src/update/service';

const invokeMock = vi.mocked(invoke);

const RUST_PATH = resolve(__dirname, '../../src-tauri/src/updater_download.rs');
const TS_PATH = resolve(__dirname, '../../src/update/service.ts');
const RUST_SRC = readFileSync(RUST_PATH, 'utf-8');
const TS_SRC = readFileSync(TS_PATH, 'utf-8');

// ────────────────────────────── Rust 源码解析 ──────────────────────────────

/**
 * 去掉 Rust 注释（行注释 / 块注释），但**不碰字符串字面量里的 `//`**。
 *
 * 必须逐字符扫而不是 `s.replace(/\/\/.*$/gm, '')`：本文件的字符串里就有 `"camelCase"`
 * 这类内容，且注释里写着形如 `{"event":"started"}` 的样例 —— 朴素正则会把它们算进代码，
 * 于是「解析出来的字段名」里混进注释里的样例，守卫就成了另一种假守卫。
 */
function stripRustComments(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '"') {
      out += c;
      i += 1;
      while (i < src.length) {
        if (src[i] === '\\') {
          out += src[i] + (src[i + 1] ?? '');
          i += 2;
          continue;
        }
        out += src[i];
        if (src[i] === '"') {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (c === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') {
        i += 1;
      }
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        i += 1;
      }
      i += 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/** 从 `open` 处（必须是 `{`）花括号配对，返回块内文本（不含最外层花括号）*/
function matchBraces(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') {
      depth += 1;
    } else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        return src.slice(open + 1, i);
      }
    }
  }
  throw new Error('花括号不配对，源码结构与解析器假设不符');
}

/** 按深度 0 的逗号切分（不切进嵌套花括号/尖括号/圆括号）*/
function splitTopLevel(src: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of src) {
    if (ch === '{' || ch === '<' || ch === '(') {
      depth += 1;
    } else if (ch === '}' || ch === '>' || ch === ')') {
      depth -= 1;
    }
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/** serde 的 rename 规则实现 —— 只实现用得上的那些，其余显式抛错，绝不静默放行 */
const VARIANT_RULES: Record<string, (name: string) => string> = {
  camelCase: (name) => name.charAt(0).toLowerCase() + name.slice(1),
};
const FIELD_RULES: Record<string, (name: string) => string> = {
  camelCase: (name) => name.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase()),
};

interface WireField {
  rust: string;
  wire: string;
}
interface WireVariant {
  rust: string;
  wire: string;
  fields: WireField[];
}
interface WireSpec {
  tag: string;
  content: string;
  variants: WireVariant[];
}

/**
 * 解析 `pub enum <name>` 的 serde 属性 + 变体 + 字段，算出真实线格式。
 *
 * 任何一步对不上就抛错（而不是返回一个空壳）——空壳会让下面的断言变成「拿空比空」。
 */
function deriveWireSpec(rawSrc: string, enumName: string): WireSpec {
  const code = stripRustComments(rawSrc);
  const header = `pub enum ${enumName}`;
  const occurrences = code.split(header).length - 1;
  if (occurrences !== 1) {
    throw new Error(`期望源码里恰好一处 \`${header}\`，实到 ${occurrences} 处`);
  }
  const headerIdx = code.indexOf(header);

  // 属性行：从 enum 关键字往上收集连续的 `#[...]`（注释已被剥掉）
  const before = code.slice(0, headerIdx).split('\n');
  const attrLines: string[] = [];
  for (let i = before.length - 1; i >= 0; i -= 1) {
    const line = before[i].trim();
    if (line === '') {
      continue;
    }
    if (line.startsWith('#[')) {
      attrLines.unshift(line);
      continue;
    }
    break;
  }
  const serdeAttr = attrLines.find((l) => l.startsWith('#[serde('));
  if (!serdeAttr) {
    throw new Error(`\`${enumName}\` 上没有 #[serde(...)] 属性`);
  }
  const inner = serdeAttr.slice('#[serde('.length, serdeAttr.lastIndexOf(')'));
  const kv: Record<string, string> = {};
  for (const m of inner.matchAll(/(\w+)\s*=\s*"([^"]*)"/g)) {
    kv[m[1]] = m[2];
  }

  const tag = kv.tag;
  const content = kv.content;
  if (!tag || !content) {
    throw new Error(`#[serde(...)] 缺 tag/content（当前：${serdeAttr}）—— 线格式不再是邻接内嵌，解析器假设失效`);
  }
  // serde 语义：enum 上的 `rename_all` 作用于**变体名**，`rename_all_fields` 作用于**变体内字段名**
  const variantRule = kv.rename_all;
  const fieldRule = kv.rename_all_fields;
  if (variantRule !== undefined && !(variantRule in VARIANT_RULES)) {
    throw new Error(`未实现的 rename_all 规则 "${variantRule}"：先在本文件补规则并用真 serde 复核黄金样本`);
  }
  if (fieldRule !== undefined && !(fieldRule in FIELD_RULES)) {
    throw new Error(`未实现的 rename_all_fields 规则 "${fieldRule}"：先在本文件补规则并用真 serde 复核黄金样本`);
  }
  const renameVariant = variantRule ? VARIANT_RULES[variantRule] : (n: string) => n;
  const renameField = fieldRule ? FIELD_RULES[fieldRule] : (n: string) => n;

  const body = matchBraces(code, code.indexOf('{', headerIdx));
  const variants: WireVariant[] = splitTopLevel(body).map((item) => {
    const m = /^([A-Za-z_]\w*)\s*(\{[\s\S]*\})?$/.exec(item.trim());
    if (!m) {
      throw new Error(`无法解析变体：${item.trim()}`);
    }
    const rust = m[1];
    const fields: WireField[] = m[2]
      ? splitTopLevel(m[2].slice(1, -1)).map((f) => {
          const fm = /^([A-Za-z_]\w*)\s*:/.exec(f.trim());
          if (!fm) {
            throw new Error(`无法解析字段：${f.trim()}`);
          }
          return { rust: fm[1], wire: renameField(fm[1]) };
        })
      : [];
    return { rust, wire: renameVariant(rust), fields };
  });

  return { tag, content, variants };
}

const SPEC = deriveWireSpec(RUST_SRC, 'ShardedEvent');

/**
 * 黄金样本 —— 来自 serde 1.0.228 **实跑**（把仓内 enum 的属性逐字节照抄到独立 crate）：
 *   {"event":"Started","data":{"contentLength":9700000,"downloaded":0}}
 *   {"event":"Progress","data":{"downloaded":123456,"contentLength":9700000}}
 *   {"event":"Finished"}
 * 对照组（写成 `rename_all` 时的真实输出，即历史缺陷形态）：
 *   {"event":"started","data":{"content_length":9700000,"downloaded":0}}
 */
const GOLDEN: WireSpec = {
  tag: 'event',
  content: 'data',
  variants: [
    {
      rust: 'Started',
      wire: 'Started',
      fields: [
        { rust: 'content_length', wire: 'contentLength' },
        { rust: 'downloaded', wire: 'downloaded' },
      ],
    },
    {
      rust: 'Progress',
      wire: 'Progress',
      fields: [
        { rust: 'downloaded', wire: 'downloaded' },
        { rust: 'content_length', wire: 'contentLength' },
      ],
    },
    { rust: 'Finished', wire: 'Finished', fields: [] },
  ],
};

/** 按派生出的线格式造一条**真实形状**的事件（字段名一律取派生值，不写死） */
function wireEvent(rustVariant: string, values: Record<string, number | null>): unknown {
  const v = SPEC.variants.find((x) => x.rust === rustVariant);
  if (!v) {
    throw new Error(`Rust 侧已无变体 ${rustVariant}（现有：${SPEC.variants.map((x) => x.rust).join('/')}）`);
  }
  if (v.fields.length === 0) {
    return { [SPEC.tag]: v.wire };
  }
  const data: Record<string, number | null> = {};
  for (const f of v.fields) {
    if (!(f.rust in values)) {
      throw new Error(`变体 ${rustVariant} 多出字段 ${f.rust}，用例未给值 —— 契约变了，两侧都要跟`);
    }
    data[f.wire] = values[f.rust];
  }
  return { [SPEC.tag]: v.wire, [SPEC.content]: data };
}

// ────────────────────────────── 测试 ──────────────────────────────

describe('Rust→TS 线格式：从 Rust 源码派生，钉到真 serde 输出', () => {
  it('正对照：源码真读进来了，且解析出 3 个变体（否则下面全是拿空比空）', () => {
    expect(RUST_SRC.length).toBeGreaterThan(1000);
    expect(SPEC.variants.map((v) => v.rust)).toEqual(['Started', 'Progress', 'Finished']);
  });

  it('派生出的线格式 === serde 1.0.228 实跑的黄金样本', () => {
    expect(SPEC).toEqual(GOLDEN);
  });

  it('反向对照：serde 在 enum 上的两个 rename 开关语义确实不同（防止把它们当同义词）', () => {
    // 这条钉的是「解析器实现的 serde 语义」本身，与仓内当前写法无关：
    // 同一批变体名/字段名，走 rename_all（变体）与 rename_all_fields（字段）结果必须不同。
    expect(VARIANT_RULES.camelCase('Started')).toBe('started');
    expect(FIELD_RULES.camelCase('content_length')).toBe('contentLength');
    // 变体规则不该把 snake_case 字段拼成 camelCase，字段规则也不该动 PascalCase 变体名
    expect(FIELD_RULES.camelCase('Started')).toBe('Started');
  });
});

describe('把派生出的真实线格式喂进前端真实 handler（不是喂前端自己假设的形状）', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  /** 驱动一次真实的 downloadAndInstall，按给定序列把事件投进它的 Channel */
  async function drive(events: unknown[]): Promise<DownloadProgress[]> {
    const got: DownloadProgress[] = [];
    invokeMock.mockImplementation(async (_cmd: string, args?: unknown) => {
      const ch = (args as { onEvent: { onmessage: (m: unknown) => void } }).onEvent;
      for (const e of events) {
        ch.onmessage(e);
      }
      return undefined;
    });
    await downloadAndInstall(
      { rid: 1 } as unknown as Parameters<typeof downloadAndInstall>[0],
      (p) => got.push(p),
    );
    return got;
  }

  it('三种事件全部被消费，数值一路走通（tag 或字段名漂移 ⇒ 这里必红）', async () => {
    const got = await drive([
      wireEvent('Started', { content_length: 9_300_000, downloaded: 0 }),
      wireEvent('Progress', { downloaded: 4_650_000, content_length: 9_300_000 }),
      wireEvent('Finished', {}),
    ]);

    // 🔴 数量断言先行：线格式一漂移，前端 switch 一条都不命中 ⇒ got 为空，
    //    这正是 v1.1.23~v1.1.32 用户看到的「进度条恒 0」。
    expect(got).toHaveLength(3);
    expect(got[0]).toMatchObject({
      event: 'Started',
      contentLength: 9_300_000,
      downloaded: 0,
      percent: 0,
      indeterminate: false,
    });
    expect(got[1]).toMatchObject({
      event: 'Progress',
      downloaded: 4_650_000,
      contentLength: 9_300_000,
      percent: 50,
      indeterminate: false,
    });
    expect(got[2]).toMatchObject({ event: 'Finished', percent: 100, indeterminate: false });
  });

  it('断点续传：Started 自带的起点字节被前端读出来并换算成百分比', async () => {
    const got = await drive([
      wireEvent('Started', { content_length: 1000, downloaded: 400 }),
      wireEvent('Progress', { downloaded: 700, content_length: 1000 }),
    ]);
    expect(got).toHaveLength(2);
    expect(got[0]).toMatchObject({ downloaded: 400, percent: 40, indeterminate: false });
    // 反向断言：若前端把起点写死成 0，续传时速率估算会把 0→400 当成一个 tick 的吞吐
    expect(got[0].downloaded).not.toBe(0);
    expect(got[1]).toMatchObject({ downloaded: 700, percent: 70 });
  });

  it('总长未知（contentLength=null）走不定态，不拿字节去除 undefined', async () => {
    const got = await drive([wireEvent('Started', { content_length: null, downloaded: 400 })]);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ indeterminate: true, downloaded: 400 });
    expect(got[0].percent).toBeUndefined();
  });

  it('TS 侧线格式类型声明的 tag 集合 === Rust 派生的 tag 集合', () => {
    const typeIdx = TS_SRC.indexOf('type ShardedEvent =');
    expect(typeIdx).toBeGreaterThan(-1);
    // 🔴 不能用 `indexOf(';')` 找结尾：`data: { contentLength: number | null; downloaded: number }`
    //    里就有分号，那样只会截到第一个成员 —— 断言看着在比三个 tag，其实只比了一个。
    //    按花括号深度扫到深度 0 的分号才是声明真正的结尾。
    let depth = 0;
    let end = -1;
    for (let i = typeIdx; i < TS_SRC.length; i += 1) {
      const ch = TS_SRC[i];
      if (ch === '{') {
        depth += 1;
      } else if (ch === '}') {
        depth -= 1;
      } else if (ch === ';' && depth === 0) {
        end = i;
        break;
      }
    }
    expect(end).toBeGreaterThan(typeIdx);
    const decl = TS_SRC.slice(typeIdx, end);
    const declared = [...decl.matchAll(/event:\s*'([^']+)'/g)].map((m) => m[1]);
    // 比集合不比顺序：union 成员顺序调换是无害重构，不该让守卫翻红
    expect([...declared].sort()).toEqual([...SPEC.variants.map((v) => v.wire)].sort());
    expect(declared).toHaveLength(SPEC.variants.length);
  });
});

describe('首帧进度：上报器必须先发一条再睡（下载短于一个 tick 也得有进度）', () => {
  /**
   * 为什么用静态顺序断言而不是跑一次真下载：这段是 tokio 任务 + 真实网络，vitest 够不着。
   * 断言的对象是**语句顺序**（send 在 sleep 之前），不是名字有没有出现 —— 把两句换回原顺序
   * 即翻红（已做变异验证）。运行时行为由真机验收覆盖。
   */
  const CODE = stripRustComments(RUST_SRC);
  const reporterIdx = CODE.indexOf('let reporter = {');

  it('正对照：找得到 reporter 那段（找不到就说明结构变了，断言必须跟着改）', () => {
    expect(reporterIdx).toBeGreaterThan(-1);
  });

  it('reporter 的 loop 体内：ch.send(...) 出现在 tokio::time::sleep(...) 之前', () => {
    const loopIdx = CODE.indexOf('loop {', reporterIdx);
    expect(loopIdx).toBeGreaterThan(-1);
    const loopBody = matchBraces(CODE, CODE.indexOf('{', loopIdx));
    const sendIdx = loopBody.indexOf('ch.send(');
    const sleepIdx = loopBody.indexOf('tokio::time::sleep(');
    expect(sendIdx).toBeGreaterThan(-1);
    expect(sleepIdx).toBeGreaterThan(-1);
    expect(sendIdx).toBeLessThan(sleepIdx);
  });

  it('分片全部结束后立刻 abort 上报器 —— 正是它让「睡在前面」等于「一条都不发」', () => {
    // 这条不是装饰：如果哪天 abort 被挪走/删掉，上面那条顺序断言的必要性就变了，
    // 读者需要在同一处看到这个前提。
    expect(CODE).toMatch(/reporter\.abort\(\);/);
  });
});
