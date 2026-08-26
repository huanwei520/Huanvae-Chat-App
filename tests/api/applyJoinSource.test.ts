/**
 * 加群三开关的客户端一侧：`applyToJoinGroup` 的必填 `source`，以及
 * 「每个打开群详情面板的入口都显式说明自己是哪条来源」这条不变量。
 *
 * 契约真值源：`backend-docs/groups/群聊管理.md`「申请入群」节
 * （`POST /api/groups/{id}/apply`，`source` **必填**，缺失/非法一律 400；
 * 对应的 `allow_join_via_*` 为 false ⇒ 403）。
 *
 * ## 每条用例防的是哪一种写错法
 *
 * | 用例 | 防的写错法 |
 * |------|-----------|
 * | body 里**真的**出现 `source`（不是只在类型里） | 加了参数却没塞进 `api.post` 的 body 字面量 ⇒ 服务端恒 400，而 TS 一声不吭 |
 * | 三档各发各的值（逐条，不合并） | 用一个常量把三条来源抹平 ⇒ 服务端永远查同一个开关，另两个开关静默失效 |
 * | `message` 缺省时 `source` 仍在 | 把 `source` 写成第四个可选参数、调用方漏传 ⇒ 只有运行期才炸 |
 * | 每个 `openGroupDetail(` 调用点显式传 source（静态扫描） | 新加一个入口忘了传 ⇒ 静默落进 store 的默认档 ⇒ 服务端查错开关（例如群名片被当成搜索） |
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join, relative, sep } from 'node:path';
import type { ApiClient } from '../../src/api/client';
import {
  applyToJoinGroup,
  JOIN_SOURCE_LABELS,
  type GroupJoinSource,
} from '../../src/api/groups';

function makeApi() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
    getBaseUrl: vi.fn(() => 'https://api.example.cn'),
    getAccessToken: vi.fn(() => 'tok-1'),
    refreshAccessToken: vi.fn(),
  } as unknown as ApiClient & { post: ReturnType<typeof vi.fn> };
}

type Api = ReturnType<typeof makeApi>;

const ALL_SOURCES: ReadonlyArray<GroupJoinSource> = ['qr', 'search', 'referral'];

function postBody(api: Api): Record<string, unknown> {
  const call = api.post.mock.calls[0];
  expect(call).toBeDefined();
  return call[1] as Record<string, unknown>;
}

describe('applyToJoinGroup — 必填 source 真的进了请求体', () => {
  let api: Api;

  beforeEach(() => {
    api = makeApi();
    api.post.mockResolvedValue({ status: 'pending', message: 'ok' });
  });

  it.each(ALL_SOURCES)('source=%s ⇒ body.source 逐字相等（三档各发各的，没被抹平）', async (source) => {
    await applyToJoinGroup(api, 'g1', source);
    expect(postBody(api).source).toBe(source);
  });

  it('🔴 三档发出去的值两两不同 —— 合并成一个常量会让另两个开关静默失效', async () => {
    const sent: string[] = [];
    for (const source of ALL_SOURCES) {
      const a = makeApi();
      a.post.mockResolvedValue({ status: 'pending', message: 'ok' });
      // eslint-disable-next-line no-await-in-loop
      await applyToJoinGroup(a, 'g1', source);
      sent.push(String(postBody(a).source));
    }
    expect(new Set(sent).size).toBe(3);
    expect(sent).toEqual(['qr', 'search', 'referral']);
  });

  it('不传 message 时 source 仍在 body 里（source 不是"跟在 message 后面的可选项"）', async () => {
    await applyToJoinGroup(api, 'g1', 'qr');
    const body = postBody(api);
    expect(body).toEqual({ message: '', source: 'qr' });
  });

  it('传了 message 时两个键都在', async () => {
    await applyToJoinGroup(api, 'g1', 'referral', '求通过');
    expect(postBody(api)).toEqual({ message: '求通过', source: 'referral' });
  });

  it('URL 打 /apply 且 groupId 被 encodeURIComponent', async () => {
    await applyToJoinGroup(api, 'a b/c', 'search');
    expect(api.post.mock.calls[0][0]).toBe('/api/groups/a%20b%2Fc/apply');
  });

  it('api 抛错原样上抛（薄封装不许偷偷兜底成"成功"）', async () => {
    api.post.mockRejectedValue(new Error('boom'));
    await expect(applyToJoinGroup(api, 'g1', 'qr')).rejects.toThrow('boom');
  });
});

describe('JOIN_SOURCE_LABELS — 三档文案各不相同', () => {
  it('三条来源三句不同的话（合并成一句会让用户不知道该换哪条路）', () => {
    const labels = ALL_SOURCES.map((s) => JOIN_SOURCE_LABELS[s]);
    expect(new Set(labels).size).toBe(3);
    expect(labels.every((l) => l.length > 0)).toBe(true);
  });

  it('键集合恰好是三档（多一个/少一个都红）', () => {
    expect(Object.keys(JOIN_SOURCE_LABELS).sort()).toEqual(['qr', 'referral', 'search']);
  });
});

// ---------------- 静态扫描：每个入口都显式说明自己是哪条来源 ----------------

/**
 * 🔴 这条不变量**运行时测不到**：漏传 source 的入口会让 `open()` 少一个必填实参 —— TS 会红，
 * 但**传错一档**（例如群名片入口传 `'search'`）编译期完全合法，运行时也一切正常，
 * 只有服务端查错开关时才现形，而"查错了开关"和"开关本来就开着"在界面上完全同形。
 * 所以这里既扫"有没有传"，也扫"传的是不是三档之一或显式 null"。
 *
 * ## 例外表
 *
 * **空的。** 曾经有一项（`src/pages/Main.tsx`，因并发 review 冻结引文而暂时走默认值），
 * 该冻结已解除、那一行已改成显式传 `'search'` ⇒ 例外表随之清空。
 * 留着这个常量是为了让"又出现一个需要豁免的入口"这件事必须显式写进来、并写清理由。
 */
const CALL_SITE_EXCEPTIONS: ReadonlyArray<string> = [];


/**
 * 🔴 **枚举源是【走出来的】，不是手写清单。**
 *
 * 手写清单是个单向有损的代理量：新加一个入口而忘了登记 ⇒ 清单里没有它 ⇒ 守卫**根本不去看它**
 * ⇒ 一条漏传 source 的入口安静地活下来，而守卫全绿。所以这里递归走 `src/`，
 * 谁出现 `openGroupDetail(` 谁就进枚举 —— 漏不掉。
 */
function collectCallSiteFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
      } else if (
        /\.tsx?$/.test(entry.name)
        // 与下面的抠取器**用同一份剥注释**：不一致的话会出现"进了枚举源但抠出 0 条"的假 FAIL
        && stripComments(readFileSync(abs, 'utf-8')).includes('openGroupDetail(')
      ) {
        out.push(relative(SRC_ROOT_PARENT, abs).split(sep).join('/'));
      }
    }
  };
  walk(resolve(__dirname, '../../src'));
  return out.sort();
}

const SRC_ROOT_PARENT = resolve(__dirname, '../..');

/**
 * 剥掉注释再扫。
 *
 * 🔴 不剥的代价是**假 FAIL**：`src/stores/groupDetailStore.ts` 的 JSDoc 里正当地写着
 * `openGroupDetail(` 这个串（在解释这条守卫本身），不剥就会被算成一个漏传 source 的调用点。
 * 🔴 也不许用朴素的 `//.*$`：模板串 `\`http://…\`` 里的 `//` 会被当成行注释起点，
 * 把后半行连同右括号一起吃掉，反而制造另一种假 FAIL（本仓在册的同族坑）。
 * ⇒ 逐行判断 `//` 是否落在引号外，并用 inBlock 跟踪跨行 `/* … *\/`。
 */
function stripComments(src: string): string {
  const out: string[] = [];
  let inBlock = false;
  for (const rawLine of src.split('\n')) {
    let result = '';
    let quote: string | null = null;
    for (let i = 0; i < rawLine.length; i += 1) {
      const ch = rawLine[i];
      const next = rawLine[i + 1];
      if (inBlock) {
        // 🔴 单行块注释（`/** … */`）必须在**同一行内**闭合。
        // 早一版在遇到 `/*` 时直接 break 掉整行，于是 `/** x */` 这种一行写完的注释
        // 把 inBlock 永久置真 ⇒ 该文件其后所有代码被当注释吃掉 ⇒ 抠出 0 条调用点，
        // 而"0 条"与"这个文件确实没有调用点"完全同形。
        if (ch === '*' && next === '/') { inBlock = false; i += 1; }
        continue;
      }
      if (quote) {
        result += ch;
        if (ch === '\\') { result += next ?? ''; i += 1; continue; }
        if (ch === quote) { quote = null; }
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') { quote = ch; result += ch; continue; }
      if (ch === '/' && next === '/') { break; }
      if (ch === '/' && next === '*') { inBlock = true; i += 1; continue; }
      result += ch;
    }
    out.push(result);
  }
  return out.join('\n');
}

/**
 * 抠出一个文件里所有 `openGroupDetail(...)` 实参串。
 *
 * 🔴 用括号配平取实参，不用「到行尾」或固定字符窗口：调用可能跨行，
 * 而按窗口截会把**后面别的属性**一起算进来（本仓在册的 over-capture 坑）。
 * ⚠️ 只取**调用**形态：`useGroupDetailStore((s) => s.open)` 那种取函数引用的行不含
 * `openGroupDetail(`，不会被误算。
 */
function extractOpenCalls(rawSrc: string): string[] {
  const src = stripComments(rawSrc);
  const out: string[] = [];
  const needle = 'openGroupDetail(';
  let i = src.indexOf(needle);
  while (i !== -1) {
    let depth = 0;
    let j = i + needle.length - 1;
    let start = j + 1;
    for (; j < src.length; j += 1) {
      if (src[j] === '(') { depth += 1; }
      else if (src[j] === ')') {
        depth -= 1;
        if (depth === 0) { break; }
      }
    }
    out.push(src.slice(start, j));
    i = src.indexOf(needle, j);
  }
  return out;
}

function readSrc(rel: string): string {
  return readFileSync(resolve(__dirname, '../..', rel), 'utf-8');
}

describe('openGroupDetail 调用点：来源必须显式传（静态扫描）', () => {
  it('🔴 stripComments 自证：单行块注释必须在同一行闭合（这条曾经真的坏过）', () => {
    // 坏掉时下面这段会被整段吃掉 ⇒ 抠出 0 条，而 0 与"确实没有调用点"同形
    const src = [
      "/** 一行写完的块注释 */",
      "openGroupDetail(a, 'qr');",
      "// 行注释里的 openGroupDetail(x) 不算",
      "/* 跨行",
      "   openGroupDetail(y) 不算 */",
      "const u = `http://x/y`; openGroupDetail(b, 'search');",
    ].join('\n');
    const calls = extractOpenCalls(src);
    expect(calls).toEqual(["a, 'qr'", "b, 'search'"]);
  });

  it('判据自证：提取器在已知存在的调用点上会响（正对照）', () => {
    const calls = extractOpenCalls(readSrc('src/chat/shared/GroupCardMessage.tsx'));
    expect(calls.length).toBeGreaterThan(0);
    // 负对照：一个确定不含该调用的文件必须抠出 0 条（提取器不恒真）
    expect(extractOpenCalls(readSrc('src/api/groups.ts'))).toHaveLength(0);
  });

  it('枚举源是走出来的，且非空（判据自证：它至少要找到已知的那几个入口）', () => {
    const files = collectCallSiteFiles();
    expect(files.length).toBeGreaterThanOrEqual(5);
    // 三个已知一定在里面的（正对照，同类：都是真的调用点）
    expect(files).toContain('src/chat/shared/GroupCardMessage.tsx');
    expect(files).toContain('src/pages/mobile/MobileChatList.tsx');
    expect(files).toContain('src/components/search/GlobalMessageSearchResults.tsx');
  });

  it.each(collectCallSiteFiles())('%s 的每个调用点：要么显式传三档之一，要么在例外表里', (rel) => {
    const calls = extractOpenCalls(readSrc(rel));
    expect(calls.length).toBeGreaterThan(0);

    const exempt = CALL_SITE_EXCEPTIONS.includes(rel);
    for (const args of calls) {
      // 合法的第二个实参只有四种：三档之一，或显式 null（成员入口）
      const explicit =
        ALL_SOURCES.some((v) => args.includes(`'${v}'`)) || /,\s*null\s*$/.test(args.trim());
      if (exempt) {
        // 登记表过期同样算错：例外项一旦改成显式传，就该从表里删掉
        expect(explicit, `${rel} 已显式传 source，请把它从 CALL_SITE_EXCEPTIONS 里删掉`).toBe(false);
      } else {
        expect(explicit, `${rel} 的调用 openGroupDetail(${args}) 没有显式传 source`).toBe(true);
      }
    }
  });

  it('例外表里的每一项都真的是被走出来的调用点（防止登记了一个不存在/已改名的路径）', () => {
    const files = collectCallSiteFiles();
    for (const rel of CALL_SITE_EXCEPTIONS) {
      expect(files, `例外表登记了 ${rel}，但它已不再是调用点 —— 请从表里删掉`).toContain(rel);
    }
  });
});
