/**
 * 上传环形进度从 0 开始 + 边界健壮（huanwei 反馈："文件上传时的圆圈默认进度就是 12，应从 0 开始"）
 *
 * ## 缺陷的真实位置（修复前，file:line 以 git HEAD 为准）
 *
 * 环的 DOM 公式（SendingMediaOverlay.tsx / CircularProgress.tsx）本身没问题：percent=0
 * ⇒ stroke-dashoffset = 周长 ⇒ 画 0%。**虚高发生在 percent 的生产端** `useFileUpload.ts`：
 * 它把百分比钉在一组写死的检查点上——
 * - `percent: 5`（请求上传检查点）
 * - `percent: 10`（"uploading" 起步检查点：**一个字节都没传就显示 10%**）
 * - `10 + (totalUploaded / file.size) * 80`（真实字节占比被压进 10..90 的映射：真实 2.5% ⇒ 显示 **12%**）
 * ⇒ 用户在起步看到的就是 ~5% → 10% → 12%，永远不是从真实的 0 开始。
 *
 * 另一处真实缺陷：`file.size = 0` 时 `10 + (0/0)*80 = NaN` 沿链路污染——
 * overlay 的 clamp（Math.max/Math.min）拦不住 NaN，渲染出 "NaN%" 文本 + dashoffset=NaN
 * （浏览器把非法值当 0 ⇒ 画成满环 = 100% 的伪影）；CircularProgress 同病。
 *
 * ## 本文件三层断言（SUT 均为真组件 / 真 hook，只在网络边界打桩）
 *
 * ① 生产端：真调 `useFileUpload().uploadFile`（api / XHR 打桩），断言它发出的 percent 流
 *    —— 未传字节恒 0、首字节事件是真实占比、全程单调、完成 100、空文件无 NaN。
 * ② 渲染端（上传环）：真渲染 `SendingMediaOverlay`，初始 uploading 态 dashoffset=周长（0%）、
 *    文本 "0%"、aria "上传中 0%"；进度推进 dashoffset 单调减小；喂 NaN 也必须显示 0%。
 * ③ 渲染端（通用环）：真渲染 `CircularProgress`，progress=0 ⇒ offset=周长；NaN ⇒ "0%" 不出 "NaN%"。
 *
 * 环没有 aria-valuenow（组件可及性口径是 role="status" + aria-label 携带百分比），故按
 * aria-label 断言——这是该组件真实暴露的可访问性面，不为测试新造属性。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useEffect } from 'react';
// jsdom 的 File 没有 arrayBuffer()（calculateSHA256 要用）；生产端测试用 Node 原生 File，
// 它是同形超集（size/name/type/slice/arrayBuffer 全有），运行时行为与真机一致。
import { File as NodeFile } from 'node:buffer';
import { useFileUpload, type UploadProgress, type UploadResult } from '../../src/hooks/useFileUpload';
import { SendingMediaOverlay } from '../../src/chat/shared/SendingMediaOverlay';
import { CircularProgress } from '../../src/components/common/CircularProgress';
import { useSendingMediaStore, type SendingMediaSeed } from '../../src/stores/sendingMediaStore';

// ---------- 网络边界打桩（api + XHR）；SUT（uploadFile / 两个环组件）全部是真的 ----------

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  delete: vi.fn(),
  getBaseUrl: vi.fn(() => 'https://srv.invalid'),
}));

vi.mock('../../src/contexts/SessionContext', () => ({
  useApi: () => apiMock,
  useSession: () => ({ session: null }),
}));

// jsdom 没有 createObjectURL，媒体尺寸探测在这条链路只该返回 null（非媒体文件同口径）
vi.mock('../../src/utils/mediaDimensions', () => ({
  readMediaDimensions: vi.fn(async () => null),
  peekMediaDimensions: vi.fn(() => null),
}));

// 反代收口同属网络边界：proxyRequestUrl（F5 后未就绪会等待/抛错）mock 直通，
// 分片 PUT 的 URL 透传给下方 XHR 桩（等待/抛错行为归 tests/services/secureProxy.test.ts）
vi.mock('../../src/services/secureProxy', () => ({
  proxyRequestUrl: (url: string) => url,
}));

/** 可脚本化的假 XHR：send 时按 script 依次吐 upload.onprogress，然后 200 收尾 */
class FakeXHR {
  static script: Array<{ loaded: number; total: number }> = [];
  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  status = 0;
  timeout = 0;
  open(): void {}
  send(): void {
    for (const step of FakeXHR.script) {
      this.upload.onprogress?.({ lengthComputable: true, loaded: step.loaded, total: step.total });
    }
    this.status = 200;
    this.onload?.();
  }
}

function stubRequestEndpoint(overrides: Partial<Record<string, unknown>> = {}): void {
  apiMock.post.mockImplementation((url: string) => {
    if (url.includes('/upload/request')) {
      return Promise.resolve({
        mode: 'multipart',
        preview_support: 'no',
        multipart_upload_id: 'up-1',
        expires_in: null,
        chunk_size: null,
        total_chunks: 1,
        file_key: 'k1',
        max_file_size: 1_000_000_000,
        instant_upload: false,
        ...overrides,
      });
    }
    if (url.includes('/upload/confirm')) {
      return Promise.resolve({
        file_url: 'https://cdn.invalid/k1',
        file_key: 'k1',
        file_size: 1000,
        content_type: 'application/pdf',
        preview_support: 'no',
      });
    }
    return Promise.resolve({});
  });
  apiMock.get.mockImplementation((url: string) => {
    if (url.includes('part_url')) { return Promise.resolve({ part_url: '/presigned/part' }); }
    return Promise.resolve({});
  });
}

interface PercentEvent { percent: number; status: string; loaded: number }

/** 渲一个一次性宿主组件，真调 useFileUpload().uploadFile 并收集 onProgress 流 */
async function runRealUpload(file: File): Promise<PercentEvent[]> {
  const events: PercentEvent[] = [];
  let finish!: () => void;
  const finished = new Promise<void>((res) => { finish = res; });

  function Harness() {
    const { uploadFile } = useFileUpload();
    useEffect(() => {
      const task: Promise<UploadResult> = uploadFile({
        file,
        // 与生产链路 getFileType(file, 'friend_messages') 对非媒体文件的取值一致
        fileType: 'friend_document',
        storageLocation: 'friend_messages',
        relatedId: 'friend-1',
        onProgress: (p: UploadProgress) => {
          events.push({ percent: p.percent, status: p.status, loaded: p.loaded });
        },
      });
      void task.then(
        () => finish(),
        () => finish(),
      );
      // 挂载即跑一次：这条测试线就是为单次上传造的
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return null;
  }

  render(<Harness />);
  // React 18 的 act 返回 void（不透传回调结果），先 await 再返回收集数组
  await act(async () => {
    await finished;
    await Promise.resolve();
  });
  return events;
}

// ---------- 渲染端共用 ----------

const KEY = 'friend:u1';
const OVERLAY_CIRCUMFERENCE = 2 * Math.PI * 18; // SendingMediaOverlay RING_RADIUS = 18

function seed(clientId: string, size: number): SendingMediaSeed {
  return {
    clientId,
    file: new File(['x'], 'a.pdf', { type: 'application/pdf' }),
    conversationKey: KEY,
    conversationType: 'friend',
    targetId: 'u1',
    shape: { kind: 'single', groupId: null, index: null, count: null },
    preview: { name: 'a.pdf', kind: 'file', size, localPath: '', width: null, height: null },
    sendTime: '2026-08-13T00:00:00.000Z',
  };
}

beforeEach(() => {
  vi.stubGlobal('XMLHttpRequest', FakeXHR);
  useSendingMediaStore.setState({ entries: {}, orderByConversation: {} });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------- ① 生产端：percent 流的形状 ----------

describe('上传 percent 流（SUT = useFileUpload().uploadFile，只桩网络）', () => {
  it('🔴 未传任何字节时 percent 恒 0；首字节事件是真实占比（25/1000 ⇒ ≈2.375，不是 12）；全程单调；完成 100', async () => {
    stubRequestEndpoint();
    FakeXHR.script = [{ loaded: 25, total: 1000 }];
    // node:buffer 的 File：jsdom 的 File 没有 arrayBuffer()，哈希这步跑不了（见文件头）
    const file = new NodeFile(['x'.repeat(1000)], 'a.pdf', { type: 'application/pdf' }) as unknown as File;

    const events = await runRealUpload(file);

    // 未传字节（loaded===0）的每一帧都必须是 0%（修复前这里是 5 / 10 —— 起步虚高的根源）
    const zeroByteFrames = events.filter((e) => e.loaded === 0);
    expect(zeroByteFrames.length).toBeGreaterThan(0);
    expect(zeroByteFrames.map((e) => e.percent)).toEqual(zeroByteFrames.map(() => 0));

    // 首字节事件：真实字节占比 × 95（给"确认中"留的量程），不是 10 + x*80 的 12
    const firstByte = events.find((e) => e.loaded === 25);
    expect(firstByte).toBeDefined();
    expect(firstByte!.percent).toBeCloseTo((25 / 1000) * 95, 5);

    // 单调不减 & 收尾 100
    for (let i = 1; i < events.length; i++) {
      expect(events[i].percent).toBeGreaterThanOrEqual(events[i - 1].percent);
    }
    expect(events[events.length - 1].percent).toBe(100);
  });

  it('🔴 空文件（total=0）+ 服务端仍给 1 个分片：percent 流不出现 NaN/Infinity，收尾 100', async () => {
    stubRequestEndpoint({ total_chunks: 1 });
    FakeXHR.script = [{ loaded: 0, total: 0 }];
    const file = new NodeFile([], 'empty.pdf', { type: 'application/pdf' }) as unknown as File;

    const events = await runRealUpload(file);

    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      expect(Number.isFinite(e.percent)).toBe(true);
    }
    expect(events[events.length - 1].percent).toBe(100);
  });
});

// ---------- ② 渲染端：上传环（SendingMediaOverlay） ----------

describe('上传环初始态与边界（SUT = SendingMediaOverlay）', () => {
  it('uploading 且 percent=0 ⇒ dashoffset=周长（画 0%）、文本 "0%"、aria "上传中 0%"', () => {
    const st = useSendingMediaStore.getState();
    st.enqueue([seed('client_a', 2048)]);
    st.markUploading('client_a', 0);
    const { container } = render(
      <SendingMediaOverlay clientId="client_a" onRetry={vi.fn()} onCancel={vi.fn()} />,
    );
    const ring = container.querySelector('.sending-media-ring-value') as SVGCircleElement;
    expect(Number(ring.getAttribute('stroke-dashoffset'))).toBeCloseTo(OVERLAY_CIRCUMFERENCE, 5);
    expect(screen.getByText('0%')).toBeInTheDocument();
    expect(screen.getByTestId('sending-media-overlay')).toHaveAttribute('aria-label', '上传中 0%');
  });

  it('进度推进 ⇒ dashoffset 严格减小（环单调变满），文本同步', () => {
    const st = useSendingMediaStore.getState();
    st.enqueue([seed('client_a', 2048)]);
    st.markUploading('client_a', 0);
    const { container, rerender } = render(
      <SendingMediaOverlay clientId="client_a" onRetry={vi.fn()} onCancel={vi.fn()} />,
    );
    const offsets: number[] = [];
    const read = () => {
      const ring = container.querySelector('.sending-media-ring-value') as SVGCircleElement;
      offsets.push(Number(ring.getAttribute('stroke-dashoffset')));
    };
    read();
    act(() => { st.markUploading('client_a', 30); });
    rerender(<SendingMediaOverlay clientId="client_a" onRetry={vi.fn()} onCancel={vi.fn()} />);
    read();
    expect(screen.getByText('30%')).toBeInTheDocument();
    act(() => { st.markUploading('client_a', 60); });
    rerender(<SendingMediaOverlay clientId="client_a" onRetry={vi.fn()} onCancel={vi.fn()} />);
    read();
    expect(screen.getByText('60%')).toBeInTheDocument();
    expect(offsets[0]).toBeGreaterThan(offsets[1]);
    expect(offsets[1]).toBeGreaterThan(offsets[2]);
  });

  it('🔴 上游喂 NaN（如 total=0 算出的） ⇒ 环显示 0%，绝不渲染 "NaN%" / NaN dashoffset', () => {
    const st = useSendingMediaStore.getState();
    st.enqueue([seed('client_a', 0)]);
    st.markUploading('client_a', Number.NaN);
    const { container } = render(
      <SendingMediaOverlay clientId="client_a" onRetry={vi.fn()} onCancel={vi.fn()} />,
    );
    const ring = container.querySelector('.sending-media-ring-value') as SVGCircleElement;
    expect(Number(ring.getAttribute('stroke-dashoffset'))).toBeCloseTo(OVERLAY_CIRCUMFERENCE, 5);
    expect(screen.getByText('0%')).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).toBeNull();
    expect(screen.getByTestId('sending-media-overlay')).toHaveAttribute('aria-label', '上传中 0%');
  });
});

// ---------- ③ 渲染端：通用环（CircularProgress） ----------

describe('通用环形进度边界（SUT = CircularProgress）', () => {
  const CIRCUMFERENCE = 2 * Math.PI * ((48 - 4) / 2); // 默认 size=48 strokeWidth=4 ⇒ r=22

  function ringOffsetOf(progress: number): { offset: number; text: string | null } {
    const { container, unmount } = render(<CircularProgress progress={progress} />);
    const ring = container.querySelector('.circular-progress-bar') as SVGCircleElement;
    const text = container.querySelector('.circular-progress-text')?.textContent ?? null;
    unmount();
    return { offset: Number(ring.getAttribute('stroke-dashoffset')), text };
  }

  it('progress=0 ⇒ offset=周长（0%）、文本 "0%"', () => {
    const { offset, text } = ringOffsetOf(0);
    expect(offset).toBeCloseTo(CIRCUMFERENCE, 5);
    expect(text).toBe('0%');
  });

  it('0 → 50 → 100 ⇒ offset 单调减小到 0', () => {
    expect(ringOffsetOf(0).offset).toBeGreaterThan(ringOffsetOf(50).offset);
    expect(ringOffsetOf(50).offset).toBeGreaterThan(ringOffsetOf(100).offset);
    expect(ringOffsetOf(100).offset).toBeCloseTo(0, 5);
  });

  it('🔴 progress=NaN ⇒ 按 0% 画、文本 "0%"，不出 NaN（除零防护）', () => {
    const { offset, text } = ringOffsetOf(Number.NaN);
    expect(offset).toBeCloseTo(CIRCUMFERENCE, 5);
    expect(text).toBe('0%');
  });

  it('🔴 progress 越界（120 / -5） ⇒ 夹回 0..100，不画出越界环', () => {
    expect(ringOffsetOf(120)).toEqual({ offset: 0, text: '100%' });
    expect(ringOffsetOf(-5)).toEqual({ offset: CIRCUMFERENCE, text: '0%' });
  });
});
