/**
 * 在途预览 object URL 的生命周期 —— 「上传中就显示本地那张图」这条能力的根
 *
 * ## 这是在防哪个缺陷（2026-08-13 实测的真因）
 *
 * 发送动作的收尾是 `ChatInputArea.handleSend` 调 `composerTrayStore.clear` 清空待发区，
 * 而 `clear` 会**逐个 revoke** 待发区自己创建的每一把 object URL。
 * 此前 `useComposerTrayOutbox.send` 把 `p.item.previewUrl`（就是那几把）原样递给了
 * 乐观条目 ⇒ 消息刚出现在列表里，它 `<img src>` 指向的 blob 已经被吊销 ⇒ **破图**。
 * 用户看到的就是「一整块灰底 + 中间进度圈 + 破图问号」，直到上传完成才换成真图。
 *
 * 修法是换所有权：sendingMediaStore 在 enqueue 时从 `File` 现造一把、在条目离开队列时释放。
 *
 * ## 三道锁，各锁一半
 *
 * 1. **类型**（typecheck 守）：`SendingMediaSeed.preview` 已 `Omit` 掉 `previewUrl`，
 *    想把待发区那把递进去编译不过。**但它要两个零件同时在场才成立**（2026-08-13 实测订正）：
 *    - `SendingMediaSeed` 的 `preview` 是 `Omit<SendingMediaPreview, 'previewUrl'>`；
 *    - **且** `useComposerTrayOutbox` 里那个 `.map()` 回调带**显式返回类型注解**
 *      `(p): SendingMediaSeed => ({...})`。
 *    少了后者，`U` 由回调自身推断、再把 `U[]` 赋给已注解的 `seeds` ——
 *    这个位置**不触发 TS 的 excess property(freshness) 检查**，多递一个 `previewUrl`
 *    时 `tsc` **rc=0 零报错**（此前正是如此，那句"编译不过"当时是假的）。
 *    两个零件由下方「第 1 道锁：类型」那组**静态契约**钉住 —— tsc 自己护不住那个注解。
 * 2. **机制**（下方第一个 describe）：`composerTrayStore.clear` 确实会 revoke 它造的每一把 ——
 *    这条一旦不成立，上面那条推理就失效了，所以要钉住。
 * 3. **行为**（下方第二个 describe）：待发区清空之后，在途条目手里那把**仍然活着**；
 *    而条目真正离开队列（取消 / 真实消息到位）时它**确实被释放**（不泄漏）。
 *
 * jsdom 没有 `URL.createObjectURL` / `revokeObjectURL`，两个 store 都做了能力判断
 * （没有就退成 null）。这里补上可观测的实现，才测得到"谁造的、谁放的"。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  useComposerTrayStore,
  selectTrayItems,
  type TrayItemInput,
} from '../../src/stores/composerTrayStore';
import {
  useSendingMediaStore,
  pickSendingEntries,
  type SendingMediaSeed,
} from '../../src/stores/sendingMediaStore';

const KEY = 'friend:u1';

type UrlPatch = { createObjectURL?: (b: Blob) => string; revokeObjectURL?: (u: string) => void };

const created: string[] = [];
const revoked: string[] = [];

beforeEach(() => {
  created.length = 0;
  revoked.length = 0;
  (URL as unknown as UrlPatch).createObjectURL = () => {
    const url = `blob:test/${created.length}`;
    created.push(url);
    return url;
  };
  (URL as unknown as UrlPatch).revokeObjectURL = (url: string) => { revoked.push(url); };
  useComposerTrayStore.setState({ itemsByConversation: {} });
  useSendingMediaStore.setState({ entries: {}, orderByConversation: {} });
});

afterEach(() => {
  delete (URL as unknown as UrlPatch).createObjectURL;
  delete (URL as unknown as UrlPatch).revokeObjectURL;
});

function trayInput(name = 'a.png'): TrayItemInput {
  return {
    file: new File(['x'], name, { type: 'image/png' }),
    localPath: `/tmp/${name}`,
    kind: 'image',
  };
}

function seed(clientId: string, kind: 'image' | 'video' | 'file' = 'image'): SendingMediaSeed {
  return {
    clientId,
    file: new File(['x'], 'a.png', { type: 'image/png' }),
    conversationKey: KEY,
    conversationType: 'friend',
    targetId: 'u1',
    shape: { kind: 'single', groupId: null, index: null, count: null },
    preview: { name: 'a.png', kind, size: 1, localPath: '/tmp/a.png', width: null, height: null },
    sendTime: '2026-08-13T00:00:00.000Z',
  };
}

function sendingEntries() {
  const s = useSendingMediaStore.getState();
  return pickSendingEntries(s.entries, s.orderByConversation, KEY);
}

describe('机制：待发区 clear 会吊销它自己造的每一把 URL（真因推理的前提）', () => {
  it('clear 之后那把 URL 进了 revoked 名单', () => {
    useComposerTrayStore.getState().add(KEY, [trayInput()]);
    const trayUrl = selectTrayItems(KEY)(useComposerTrayStore.getState())[0].previewUrl;
    expect(trayUrl).toBe('blob:test/0');

    useComposerTrayStore.getState().clear(KEY);
    expect(revoked).toContain(trayUrl);
  });
});

describe('🔴 行为：待发区清空之后，在途条目那张预览仍然活着', () => {
  it('enqueue 造的是**另一把** URL，clear 碰不到它', () => {
    // 复刻真实时序：add（造 blob:test/0）→ enqueue（造 blob:test/1）→ clear（revoke 掉 0）
    useComposerTrayStore.getState().add(KEY, [trayInput()]);
    const trayUrl = selectTrayItems(KEY)(useComposerTrayStore.getState())[0].previewUrl;

    useSendingMediaStore.getState().enqueue([seed('client_a')]);
    const sendingUrl = sendingEntries()[0].preview.previewUrl;

    useComposerTrayStore.getState().clear(KEY);

    expect(sendingUrl).toBeTruthy();
    expect(sendingUrl).not.toBe(trayUrl);
    // 🔴 这一条就是缺陷本身：修复前 sendingUrl === trayUrl，clear 之后它在 revoked 里
    expect(revoked).not.toContain(sendingUrl);
    // 反向：确实是 clear 生效了（否则"没被 revoke"是因为压根没人 revoke，断言恒真）
    expect(revoked).toContain(trayUrl);
  });

  it('文档项不造 URL（只有图片 / 视频才有缩略图）', () => {
    useSendingMediaStore.getState().enqueue([seed('client_doc', 'file')]);
    expect(sendingEntries()[0].preview.previewUrl).toBeNull();
  });
});

describe('不泄漏：条目离开队列的两条路径都会释放', () => {
  it('取消一项 ⇒ 释放它那把，其余项的不受影响', () => {
    const st = useSendingMediaStore.getState();
    st.enqueue([seed('client_a'), seed('client_b')]);
    const [a, b] = sendingEntries().map((e) => e.preview.previewUrl);

    st.cancel('client_a');

    expect(revoked).toEqual([a]);
    expect(revoked).not.toContain(b);
  });

  it('真实消息到位被 prune 掉 ⇒ 释放它那把', () => {
    const st = useSendingMediaStore.getState();
    st.enqueue([seed('client_a'), seed('client_b')]);
    const [a, b] = sendingEntries().map((e) => e.preview.previewUrl);
    st.markSent('client_a', 'real-a');
    st.markSent('client_b', 'real-b');

    st.pruneConfirmed(KEY, new Set(['real-a']));

    expect(revoked).toEqual([a]);
    // b 还在队列里（真实消息没到），它那把绝不能提前放 —— 那就是本次修的缺陷换了个位置复发
    expect(revoked).not.toContain(b);
    expect(sendingEntries().map((e) => e.clientId)).toEqual(['client_b']);
  });
});

/**
 * 第 1 道锁：类型 —— 静态契约（tsc 自己护不住的那半边）
 *
 * 为什么必须有这一组：文件头第 1 点那条"编译不过"的保证由**两个零件**共同成立，
 * 而其中一个（`.map()` 回调的显式返回类型注解）**看上去完全冗余** ——
 * `seeds` 这个变量本身已经注解成 `SendingMediaSeed[]` 了，任何人"顺手删掉重复注解"
 * 都不会让 `tsc` 红一下，那条保证就当场静默失效（2026-08-13 之前正是这个状态）。
 * ⇒ 只能由静态契约钉住。
 *
 * 这一组**防不住什么**（如实写）：它按源码文本判形态，拦不住"换个等价写法但仍安全"的重写
 * （例如改成 `for` 循环逐个 push 到已注解的数组），那种情况下这条会误红、需要人来重锚。
 */
describe('第 1 道锁：类型 —— 两个零件都必须在场（静态契约）', () => {
  const STORE_SRC = readFileSync(
    resolve(__dirname, '../../src/stores/sendingMediaStore.ts'),
    'utf-8',
  );
  const OUTBOX_SRC = readFileSync(
    resolve(__dirname, '../../src/chat/shared/useComposerTrayOutbox.ts'),
    'utf-8',
  );

  it('正对照：两个扫描器确实读到了目标文件（否则下面两条的"命中"没有意义）', () => {
    // 各取一条与本组无关、但一定存在的锚串；它们若不在，说明路径/读取本身坏了。
    expect(STORE_SRC).toMatch(/export type SendingMediaSeed =/);
    expect(OUTBOX_SRC).toMatch(/useSendingMediaStore\.getState\(\)\.enqueue\(seeds\);/);
  });

  it('零件 A：SendingMediaSeed 的 preview 仍是 Omit 掉 previewUrl 的形态', () => {
    expect(STORE_SRC).toMatch(
      /export type SendingMediaSeed =[^;]*&\s*\{\s*preview:\s*Omit<SendingMediaPreview,\s*'previewUrl'>\s*\}/,
    );
  });

  it('零件 B：enqueue 的入参字面量由带显式返回类型注解的 map 回调产出', () => {
    // 没有 `(p): SendingMediaSeed =>` 这段注解，多递一个 previewUrl 时 tsc 不报错。
    expect(OUTBOX_SRC).toMatch(
      /const seeds:\s*SendingMediaSeed\[\]\s*=\s*plan\.items\.map\(\(p\):\s*SendingMediaSeed\s*=>\s*\(\{/,
    );
  });
});
