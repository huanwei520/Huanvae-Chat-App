/**
 * 「待发区尺寸探测还没 resolve，用户就按了回车」这条路径上的零跳变
 *
 * ## 这里防的缺陷（2026-08-13 review 挖出，本文件是它的回归锁）
 *
 * 原始像素尺寸有两个读取点，**都是异步**的：
 * - 待发区 `composerTrayStore.probeDimensions` —— 加入待发区那刻起跑，**fire-and-forget**；
 * - 上传链路 `hooks/useFileUpload` —— `await readMediaDimensions(file)`，结果无条件交给后端
 *   ⇒ **完成态**那条气泡拿到的恒是**真实**尺寸。
 *
 * 于是「粘贴完立刻回车」时（探测还没 resolve）：`seed.preview.width/height` 仍是 `null`
 * ⇒ 在途占位走**默认**尺寸、完成态走**真实**尺寸 ⇒ 「上传完成那一刻跳版」原样复发。
 *
 * 🔴 **既有的 tests/components/SendingMediaZeroJump.test.tsx 结构上看不见这条**：
 * 它每个用例都是**同步**把 width/height 塞进 seed 的，永远命不中 null 那条路径
 * （唯二两条 null 用例只断言"两态一起退默认"，那正是缺陷发生时的状态 —— 它们照样绿）。
 * ⇒ 只有"先 null、随后回填"这个**时序**被摆到断言里，那条漏才被看见。
 *
 * ## 判据怎么保证不是恒真
 *
 * `readMediaDimensions` 被换成一个**手动可控**的 promise，于是"回填之前"与"回填之后"
 * 是两个可分别断言的时刻：
 * 1. 回填**之前**断言在途盒子 == 完成态在**缺尺寸**时的盒子（证明 null 那条路径真被走到）；
 * 2. 回填**之后**断言在途盒子 == 完成态在**有尺寸**时的盒子（证明补探真的落到了画面上）；
 * 3. 外加前提断言"这两个盒子本来就不相等" —— 少了它，1 与 2 可能同时被一个恒等式满足。
 *
 * 两态的盒子都是**各渲染一次真组件**取出来的，不是写死的字面量（与 ZeroJump 同口径）。
 *
 * ## 测不到什么（jsdom 结构性盲区，见 .claude/rules/frontend-test.md）
 *
 * 真实的解码：`readMediaDimensions` 在这里是替身，图片/视频到底能不能读出那两个数
 * 是真机的事。这里钉的是**接线与时序**：null 进来 ⇒ 补探被发起 ⇒ 回填改变画面。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';

/**
 * 尺寸读取被换成替身：真实现依赖 `new Image()` / `<video>` 的解码事件，
 * jsdom 两者都不触发（既不 onload 也不 onerror）⇒ promise 永远挂着，测不出"回填之后"。
 */
const dimensionsMock = vi.hoisted(() => ({
  readMediaDimensions: vi.fn(),
  // 同步记忆口（真实现见 utils/mediaDimensions）。本文件测的是"异步回填"那条路，
  // 所以这里恒不命中；命中路径由 tests/unit/mediaDimensionsMemo.test.ts 覆盖。
  peekMediaDimensions: vi.fn(() => null),
}));
vi.mock('../../src/utils/mediaDimensions', () => dimensionsMock);

vi.mock('../../src/hooks/useFileCache', () => ({
  useImageCache: () => ({
    src: 'https://proxy.local/img',
    isLocal: false,
    loading: false,
    error: null,
    onLoad: vi.fn(),
    localPath: null,
    presignedUrl: null,
    retryWithNewUrl: vi.fn(),
    openInFolder: vi.fn(),
  }),
  useVideoCache: () => ({
    src: 'https://proxy.local/vid',
    isLocal: false,
    loading: false,
    error: null,
    onPlay: vi.fn(),
    localPath: null,
    presignedUrl: null,
    openInFolder: vi.fn(),
  }),
  useFileCache: () => ({
    src: null,
    presignedUrl: null,
    isLocal: false,
    localPath: null,
    openInFolder: vi.fn(),
  }),
}));
vi.mock('../../src/services/fileCache', () => ({ triggerBackgroundDownload: vi.fn() }));
vi.mock('../../src/media', () => ({ openMediaWindow: vi.fn() }));
vi.mock('../../src/chat/shared/MobileMediaPreview', () => ({ MobileMediaPreview: () => null }));
vi.mock('../../src/chat/shared/FilePreviewModal', () => ({ FilePreviewModal: () => null }));
vi.mock('../../src/utils/platform', () => ({ isMobile: () => false }));

const sessionMock = vi.hoisted(() => ({
  session: {
    userId: 'me',
    serverUrl: 'https://example.invalid',
    accessToken: 't',
    profile: { user_nickname: '我', user_avatar_url: null },
  },
}));
vi.mock('../../src/contexts/SessionContext', () => ({
  useSession: () => sessionMock,
  useApi: () => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn() }),
}));

import { FileMessageContent } from '../../src/chat/shared/FileMessageContent';
import { useSendingMediaStore, type SendingMediaSeed } from '../../src/stores/sendingMediaStore';
import type { MediaDimensions } from '../../src/utils/mediaDimensions';

const KEY = 'friend:u1';

type UrlPatch = { createObjectURL?: (b: Blob) => string; revokeObjectURL?: (u: string) => void };

/** 手动可控的 promise：让"探测已发起但还没 resolve"成为一个可断言的时刻 */
function deferred<T>() {
  let settle!: (value: T) => void;
  const promise = new Promise<T>((resolve) => { settle = resolve; });
  return { promise, settle };
}

beforeEach(() => {
  // 补探的能力判断与 makeSendingPreviewUrl 同款：没有 createObjectURL 就整条不跑
  (URL as unknown as UrlPatch).createObjectURL = () => 'blob:late-dim';
  (URL as unknown as UrlPatch).revokeObjectURL = () => {};
  dimensionsMock.readMediaDimensions.mockReset();
  // 默认：探测发起后永不 resolve（不 resolve 的用例不该被别的用例的残留影响）
  dimensionsMock.readMediaDimensions.mockReturnValue(new Promise<MediaDimensions | null>(() => {}));
  useSendingMediaStore.setState({ entries: {}, orderByConversation: {} });
});

afterEach(() => {
  delete (URL as unknown as UrlPatch).createObjectURL;
  delete (URL as unknown as UrlPatch).revokeObjectURL;
});

function seed(
  clientId: string,
  kind: 'image' | 'video' | 'file',
  width: number | null,
  height: number | null,
  file = new File(['x'], kind === 'video' ? 'a.mp4' : 'a.png', {
    type: kind === 'video' ? 'video/mp4' : 'image/png',
  }),
): SendingMediaSeed {
  return {
    clientId,
    file,
    conversationKey: KEY,
    conversationType: 'friend',
    targetId: 'u1',
    shape: { kind: 'single', groupId: null, index: null, count: null },
    preview: { name: file.name, kind, size: 2048, localPath: '', width, height },
    sendTime: '2026-08-13T00:00:00.000Z',
  };
}

/** 在途那一态；返回 container，盒子每次现查（React 就地改 style，但别假设节点不换） */
function renderSending(clientId: string, kind: 'image' | 'video'): HTMLElement {
  const { container } = render(
    <FileMessageContent
      messageType={kind}
      messageContent={kind === 'video' ? '[视频] a.mp4' : '[图片] a.png'}
      fileUuid={null}
      fileSize={2048}
      clientId={clientId}
    />,
  );
  return container;
}

/** 完成态那一态（服务端下发的宽高；null = 后端也没有这两个数） */
function renderSettled(kind: 'image' | 'video', width: number | null, height: number | null): HTMLElement {
  const { container } = render(
    <FileMessageContent
      messageType={kind}
      messageContent={kind === 'video' ? '[视频] a.mp4' : '[图片] a.png'}
      fileUuid="file-uuid-1"
      fileHash="hash-1"
      fileSize={2048}
      imageWidth={width}
      imageHeight={height}
    />,
  );
  return container;
}

function boxOf(container: HTMLElement, kind: 'image' | 'video') {
  const el = container.querySelector(
    kind === 'video' ? '.video-message' : '.image-message',
  ) as HTMLElement;
  return { width: el.style.width, height: el.style.height };
}

describe('🔴 待发区探测未完成就发送：在途占位最终也拿到真实尺寸', () => {
  it.each([
    ['图片 1179x2556（手机竖屏截图）', 'image' as const, 1179, 2556],
    ['视频 1080x1920（竖版）', 'video' as const, 1080, 1920],
  ])('%s', async (_label, kind, w, h) => {
    const d = deferred<MediaDimensions | null>();
    dimensionsMock.readMediaDimensions.mockReturnValue(d.promise);

    // seed 的宽高是 null —— 这就是"没等探测完就按回车"落进 store 的形态
    useSendingMediaStore.getState().enqueue([seed('client_late', kind, null, null)]);
    const sending = renderSending('client_late', kind);

    const defaultBox = boxOf(renderSettled(kind, null, null), kind);
    const realBox = boxOf(renderSettled(kind, w, h), kind);
    // 前提：缺尺寸与真实尺寸算出的盒子本来就不同 —— 否则下面两条会被同一个恒等式满足
    expect(defaultBox).not.toEqual(realBox);

    // ① 回填之前：在途确实停在默认尺寸（缺陷发生时就是一直停在这里）
    expect(boxOf(sending, kind)).toEqual(defaultBox);

    // ② 补探 resolve ⇒ 回填 ⇒ 与完成态同框
    await act(async () => { d.settle({ width: w, height: h }); });
    await waitFor(() => { expect(boxOf(sending, kind)).toEqual(realBox); });

    // 数据面也核一遍：回填写进的是 store 里那一项，不是只有画面"看起来对"
    const entry = useSendingMediaStore.getState().entries.client_late;
    expect({ width: entry.preview.width, height: entry.preview.height }).toEqual({ width: w, height: h });
  });

  it('探测读不出来（resolve null）⇒ 保持默认尺寸，不写脏值', async () => {
    const d = deferred<MediaDimensions | null>();
    dimensionsMock.readMediaDimensions.mockReturnValue(d.promise);

    useSendingMediaStore.getState().enqueue([seed('client_null', 'image', null, null)]);
    await act(async () => { d.settle(null); });

    const entry = useSendingMediaStore.getState().entries.client_null;
    expect(entry.preview.width).toBeNull();
    expect(entry.preview.height).toBeNull();
  });

  it('回填晚于取消 ⇒ 不复活已离队的条目', async () => {
    const d = deferred<MediaDimensions | null>();
    dimensionsMock.readMediaDimensions.mockReturnValue(d.promise);

    useSendingMediaStore.getState().enqueue([seed('client_gone', 'image', null, null)]);
    useSendingMediaStore.getState().cancel('client_gone');
    await act(async () => { d.settle({ width: 800, height: 600 }); });

    expect(useSendingMediaStore.getState().entries.client_gone).toBeUndefined();
    expect(useSendingMediaStore.getState().orderByConversation[KEY]).toEqual([]);
  });
});

describe('只补该补的那些（补探不是无条件多读一遍）', () => {
  it('待发区抢跑成功（seed 已有宽高）⇒ 一次都不探测', () => {
    useSendingMediaStore.getState().enqueue([seed('client_ready', 'image', 1179, 2556)]);
    expect(dimensionsMock.readMediaDimensions).not.toHaveBeenCalled();
    // 正对照：同一批里缺尺寸的那一项确实会触发探测，且拿到的是它自己的 File
    const lateFile = new File(['y'], 'b.png', { type: 'image/png' });
    useSendingMediaStore.getState().enqueue([seed('client_need', 'image', null, null, lateFile)]);
    expect(dimensionsMock.readMediaDimensions).toHaveBeenCalledTimes(1);
    expect(dimensionsMock.readMediaDimensions).toHaveBeenCalledWith(lateFile);
  });

  it('文档项不探测（它根本没有像素尺寸这回事）', () => {
    useSendingMediaStore.getState().enqueue([seed('client_doc', 'file', null, null)]);
    expect(dimensionsMock.readMediaDimensions).not.toHaveBeenCalled();
  });
});
