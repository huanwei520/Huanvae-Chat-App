/**
 * `utils/mediaDimensions` 的按 `File` 记忆，以及它在发送态入队那一帧的兑现
 *
 * ## 这个文件守的是哪个缺陷
 *
 * 「上传中的占位」与「上传完成的气泡」要走**同一组** `width/height` 才不跳版。
 * 这组数有三个读取点（待发区 `add` / 发送态 `enqueue` / 上传链路），读的是**同一个 `File`**。
 * 待发区那次是 fire-and-forget：它 resolve 时那一项可能已被 `clear`（= 发送收尾）清掉
 * ⇒ 回写落空 ⇒ **已经算出来的那组数字被直接丢掉** ⇒ 在途占位只能按默认尺寸画
 * ⇒ 上传完成那一刻跳版。
 *
 * 修法是把结果按 `File` 记住，于是：
 *  - 同一个 `File` 只解码一次（A 组）；
 *  - 已 resolve 的结果可以**同步**取回（B 组）；
 *  - 发送态入队那一帧就能把尺寸填对，一帧默认尺寸都不画（C 组，这条才是用户看得见的）。
 *
 * ## 为什么要自造 `Image` 替身
 *
 * jsdom 不解码：`new Image()` 赋了 `src` 之后 `onload` / `onerror` **都不触发**
 * ⇒ 真实现的 promise 永远挂着，"读到了"这条路径在 jsdom 里根本走不到。
 * 这里换掉的是**浏览器那一侧**（`Image` + `URL.createObjectURL`），
 * 被测的仍是 `utils/mediaDimensions` 与 `stores/sendingMediaStore` 的真代码 ——
 * 不是拿 mock 测 mock。替身还兼作**解码次数计数器**，记忆有没有生效全靠它。
 *
 * ## 测不到的（如实标注）
 *
 * 「跳没跳版」是像素与布局问题，jsdom 无布局引擎（`getBoundingClientRect` 恒 0），
 * 本文件只守**数据面**：那组数字有没有在正确的时刻出现在正确的地方。
 * 视觉结论见 .claude/rules/frontend-test.md「滚动 / 布局相关行为：vitest 结构性测不出」。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { peekMediaDimensions, readMediaDimensions } from '../../src/utils/mediaDimensions';
import { useSendingMediaStore, type SendingMediaSeed } from '../../src/stores/sendingMediaStore';

/** 解码次数 —— 记忆生效的唯一判据（没记住就会涨） */
let decodeCount = 0;

interface UrlPatch {
  createObjectURL?: (f: Blob) => string;
  revokeObjectURL?: (u: string) => void;
}

const originalImage = globalThis.Image;
const originalCreate = (URL as unknown as UrlPatch).createObjectURL;
const originalRevoke = (URL as unknown as UrlPatch).revokeObjectURL;

/** 会 onload 的 `Image` 替身：赋 src 即计一次解码，随后异步给出固定尺寸 */
class FakeImage {
  naturalWidth = 0;
  naturalHeight = 0;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private _src = '';

  get src(): string {
    return this._src;
  }

  set src(value: string) {
    this._src = value;
    decodeCount += 1;
    queueMicrotask(() => {
      this.naturalWidth = 800;
      this.naturalHeight = 600;
      this.onload?.();
    });
  }
}

function imageFile(name: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' });
}

function seedOf(file: File, clientId: string): SendingMediaSeed {
  return {
    clientId,
    file,
    conversationKey: 'friend:1',
    conversationType: 'friend',
    targetId: '1',
    shape: { kind: 'single', groupId: null, index: null, count: null },
    preview: { name: file.name, kind: 'image', size: file.size, localPath: '', width: null, height: null },
    sendTime: '2026-08-13T00:00:00.000Z',
  };
}

beforeEach(() => {
  decodeCount = 0;
  globalThis.Image = FakeImage as unknown as typeof Image;
  (URL as unknown as UrlPatch).createObjectURL = () => 'blob:memo-test';
  (URL as unknown as UrlPatch).revokeObjectURL = () => {};
  useSendingMediaStore.setState({ entries: {}, orderByConversation: {} });
});

afterEach(() => {
  globalThis.Image = originalImage;
  (URL as unknown as UrlPatch).createObjectURL = originalCreate;
  (URL as unknown as UrlPatch).revokeObjectURL = originalRevoke;
});

describe('A. 同一个 File 只解码一次', () => {
  it('连读两次 ⇒ 结果相同、解码只发生一次', async () => {
    const file = imageFile('a.png');

    const first = await readMediaDimensions(file);
    expect(first).toEqual({ width: 800, height: 600 });
    expect(decodeCount).toBe(1);

    const second = await readMediaDimensions(file);
    expect(second).toEqual({ width: 800, height: 600 });
    // 🔴 记忆没生效的话这里会是 2 —— 这一条就是"待发区那次白读了"的机器口径
    expect(decodeCount).toBe(1);
  });

  it('并发两次（第一次还没 resolve 就发第二次）⇒ 共用同一次解码', async () => {
    const file = imageFile('b.png');

    const p1 = readMediaDimensions(file);
    const p2 = readMediaDimensions(file);
    expect(decodeCount).toBe(1);

    expect(await p1).toEqual({ width: 800, height: 600 });
    expect(await p2).toEqual({ width: 800, height: 600 });
    expect(decodeCount).toBe(1);
  });

  it('换一个 File ⇒ 重新解码（记忆是按文件记的，不是全局一份）', async () => {
    await readMediaDimensions(imageFile('c1.png'));
    expect(decodeCount).toBe(1);
    await readMediaDimensions(imageFile('c2.png'));
    // 负对照：不同文件必须各解码一次，否则记忆就串了
    expect(decodeCount).toBe(2);
  });
});

describe('B. peekMediaDimensions 是同步的', () => {
  it('读之前为 null，resolve 之后同步取得同一组数字', async () => {
    const file = imageFile('d.png');
    expect(peekMediaDimensions(file)).toBeNull();

    await readMediaDimensions(file);

    // 同步调用，没有 await —— 这正是 enqueue 那一帧能用上它的原因
    expect(peekMediaDimensions(file)).toEqual({ width: 800, height: 600 });
  });

  it('还在飞（未 resolve）时仍为 null，不会给出半成品', async () => {
    const file = imageFile('e.png');
    const flying = readMediaDimensions(file);
    expect(peekMediaDimensions(file)).toBeNull();
    await flying;
    expect(peekMediaDimensions(file)).toEqual({ width: 800, height: 600 });
  });
});

describe('C. 发送态入队：seed 里是 null，但记忆里有 ⇒ 同步填对，不留默认尺寸的那一帧', () => {
  it('入队那一帧（不 await）preview 已是真实尺寸', async () => {
    const file = imageFile('f.png');
    // 模拟待发区那次探测已经跑完（而回写因为条目已离队而落空 ⇒ seed 里仍是 null）
    await readMediaDimensions(file);
    const decodesAfterTrayProbe = decodeCount;

    useSendingMediaStore.getState().enqueue([seedOf(file, 'client_f')]);

    // 🔴 同步断言：enqueue 返回时就必须是真实尺寸（不是 await 之后才对）
    const entry = useSendingMediaStore.getState().entries['client_f'];
    expect(entry.preview.width).toBe(800);
    expect(entry.preview.height).toBe(600);
    // 而且没有为此再解码一次 —— 走的是同步记忆，不是又发了一次异步补探
    expect(decodeCount).toBe(decodesAfterTrayProbe);
  });

  it('记忆里也没有 ⇒ 仍走异步补探，回填后尺寸到位（原有兜底不被本次改动削弱）', async () => {
    const file = imageFile('g.png');
    // 没有预热：入队那一帧只能是 null
    useSendingMediaStore.getState().enqueue([seedOf(file, 'client_g')]);
    expect(useSendingMediaStore.getState().entries['client_g'].preview.width).toBeNull();

    // 异步补探（enqueue 内部发起的那一次）落地
    await readMediaDimensions(file);
    await Promise.resolve();
    await Promise.resolve();

    const entry = useSendingMediaStore.getState().entries['client_g'];
    expect(entry.preview.width).toBe(800);
    expect(entry.preview.height).toBe(600);
  });
});
