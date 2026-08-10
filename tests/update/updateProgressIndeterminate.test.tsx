/**
 * 更新下载进度「不定态」契约测试
 *
 * 背景（真实故障）：更新时进度条**全程钉死 0%**，然后直接跳到「下载完成」。
 *
 * 根因在 store 边界：`src/update/service.ts` 已经正确地把「总长未知」表达为
 * `percent: undefined` + `indeterminate: true`，但 `src/update/store.ts` 用
 * `progress.percent || 0` / `progress.contentLength || 0` 把 `undefined`
 * **吃成了 0**，且 `updateProgress` 签名里根本没有 `indeterminate` 字段
 * ⇒ 不定态信息在 store 边界丢失 ⇒ UI 只能渲染成一个不动的 0%。
 *
 * 本文件把「不定态必须一路传到两端 UI」钉成回归契约：
 * 1. store 边界：总长未知的进度事件必须落成 `indeterminate: true`（不是 0%）
 * 2. store 边界：`percent: 0` 这个**合法值**不能与 `undefined` 混为一谈
 * 3. 桌面 UpdateToast：不定态渲染滚动条 + 不显示「0%」
 * 4. 移动 MobileDownloadCard：同上（两端对齐）
 * 5. 确定态：百分比序列必须真的在动（0 → 37 → 86），并显示 已下载/总大小
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import type { DownloadProgress } from '../../src/update/service';

// service 被 store 用 `await import('./service')` 动态导入，这里整体替换掉，
// 让测试能自己驱动进度回调（等价于 Rust 侧发来的 Channel 事件）。
const mockDownloadAndInstall = vi.hoisted(() => vi.fn());
vi.mock('../../src/update/service', () => ({
  downloadAndInstall: mockDownloadAndInstall,
  checkForUpdates: vi.fn(),
  restartApp: vi.fn(),
}));

import { useUpdateStore } from '../../src/update/store';
import { UpdateToast } from '../../src/update/components/UpdateToast';
import { MobileDownloadCard } from '../../src/update/components/MobileDownloadCard';

/** 把 store 重置回「刚要开始下载」的干净状态（zustand 是跨用例共享的全局单例） */
function resetStore() {
  useUpdateStore.setState({
    status: 'idle',
    version: '',
    notes: '',
    progress: 0,
    downloaded: 0,
    total: 0,
    indeterminate: false,
    sourceUrl: '',
    errorMessage: '',
    isChecking: false,
    desktopUpdateInfo: null,
    androidUpdateInfo: null,
  });
}

/** 驱动一次桌面下载，onProgress 收到给定的事件序列；返回每个事件后的 store 快照 */
async function driveDesktopDownload(events: DownloadProgress[]) {
  const snapshots: Array<ReturnType<typeof useUpdateStore.getState>> = [];

  useUpdateStore.setState({
    desktopUpdateInfo: {
      available: true,
      version: '9.9.9',
      // handleUpdate 只检查 info.update 存在与否，内容原样透传给被 mock 的 service
      update: { rid: 1 } as never,
    },
  });

  mockDownloadAndInstall.mockImplementation(
    async (_update: unknown, onProgress: (p: DownloadProgress) => void) => {
      for (const e of events) {
        onProgress(e);
        snapshots.push({ ...useUpdateStore.getState() });
      }
    },
  );

  await act(async () => {
    await useUpdateStore.getState().handleUpdate();
  });

  return snapshots;
}

describe('更新进度：总长未知时必须是「不定态」，不能钉死 0%', () => {
  beforeEach(() => {
    resetStore();
    mockDownloadAndInstall.mockReset();
  });

  it('store 边界：Started/Progress 都没有总长 ⇒ indeterminate=true 且总大小保持未知', async () => {
    const snaps = await driveDesktopDownload([
      // service.ts 在总长未知时发的就是这个形状（:158-165 / :171-177）
      { event: 'Started', contentLength: undefined, percent: undefined, indeterminate: true, downloaded: 0 },
      { event: 'Progress', downloaded: 4096, contentLength: undefined, percent: undefined, indeterminate: true },
      { event: 'Progress', downloaded: 65536, contentLength: undefined, percent: undefined, indeterminate: true },
    ]);

    expect(snaps).toHaveLength(3);
    for (const s of snaps) {
      expect(s.indeterminate).toBe(true);
    }
    // 已下载字节数仍必须如实累加（不定态下这是唯一能给用户看的真实进展）
    expect(snaps[1].downloaded).toBe(4096);
    expect(snaps[2].downloaded).toBe(65536);
    // 总长未知 ⇒ 不能编造一个总大小
    expect(snaps[2].total).toBe(0);
  });

  it('store 边界：percent=0 是合法值，不能与 undefined 混为一谈（总长已知 ⇒ 确定态）', async () => {
    const snaps = await driveDesktopDownload([
      { event: 'Started', contentLength: 9252045, percent: 0, indeterminate: false, downloaded: 0 },
    ]);

    expect(snaps[0].indeterminate).toBe(false);
    expect(snaps[0].progress).toBe(0);
    expect(snaps[0].total).toBe(9252045);
  });

  it('store 边界：确定态下百分比序列真的在动（0 → 37 → 86）', async () => {
    const snaps = await driveDesktopDownload([
      { event: 'Started', contentLength: 1000, percent: 0, indeterminate: false, downloaded: 0 },
      { event: 'Progress', contentLength: 1000, percent: 37, indeterminate: false, downloaded: 370 },
      { event: 'Progress', contentLength: 1000, percent: 86, indeterminate: false, downloaded: 860 },
    ]);

    expect(snaps.map((s) => s.progress)).toEqual([0, 37, 86]);
    expect(snaps.map((s) => s.indeterminate)).toEqual([false, false, false]);
    expect(snaps.map((s) => s.downloaded)).toEqual([0, 370, 860]);
  });

  it('store 边界：startDownload 起手就是不定态（还没拿到总长，不许先闪一个 0%）', () => {
    act(() => {
      useUpdateStore.getState().startDownload();
    });
    const s = useUpdateStore.getState();
    expect(s.status).toBe('downloading');
    expect(s.indeterminate).toBe(true);
  });

  it('store 边界：downloadComplete 必须回到确定态 100%', () => {
    act(() => {
      useUpdateStore.getState().startDownload();
      useUpdateStore.getState().downloadComplete();
    });
    const s = useUpdateStore.getState();
    expect(s.progress).toBe(100);
    expect(s.indeterminate).toBe(false);
  });
});

describe('桌面 UpdateToast：不定态渲染', () => {
  // 🔴 UpdateToast 用 createPortal 挂到 document.body，RTL 的 `container` 里没有它的 DOM。
  //    用 container.querySelector 断言「不存在」会恒真（假测试），必须查 document.body。
  const queryToast = (sel: string) => document.body.querySelector(sel);

  it('不定态：显示滚动条，不显示「0%」，只报已下载字节', () => {
    render(
      <UpdateToast status="downloading" version="9.9.9" indeterminate downloaded={4096} total={0} progress={0} />,
    );

    // 关键：不能出现一个钉死不动的 0%
    expect(screen.queryByText('0%')).toBeNull();
    // 必须有不定态滚动条（CSS keyframes 驱动，非 framer-motion 宽度动画）
    expect(queryToast('.update-toast-progress-indeterminate')).not.toBeNull();
    // 确定态的 motion 宽度条此时不能同时存在（两者互斥，避免两套动画共存）
    expect(queryToast('.update-toast-progress-fill')).toBeNull();
    // 总大小未知时不能显示「4.0 KB / 0 B」这种误导文案
    expect(screen.queryByText(/\/ 0 B/)).toBeNull();
    expect(screen.getByText('4.0 KB')).toBeInTheDocument();
  });

  it('确定态：显示真实百分比 + 已下载/总大小，且没有不定态滚动条', () => {
    render(
      <UpdateToast
        status="downloading"
        version="9.9.9"
        indeterminate={false}
        progress={37}
        downloaded={10485760}
        total={20971520}
      />,
    );

    expect(screen.getByText('37%')).toBeInTheDocument();
    expect(screen.getByText('10.0 MB / 20.0 MB')).toBeInTheDocument();
    expect(queryToast('.update-toast-progress-fill')).not.toBeNull();
    expect(queryToast('.update-toast-progress-indeterminate')).toBeNull();
  });
});

describe('移动 MobileDownloadCard：不定态渲染（与桌面对齐）', () => {
  beforeEach(() => {
    resetStore();
  });

  it('不定态：显示滚动条，不显示「0%」', () => {
    act(() => {
      useUpdateStore.setState({
        status: 'downloading',
        version: '9.9.9',
        indeterminate: true,
        progress: 0,
        downloaded: 4096,
        total: 0,
      });
    });

    const { container } = render(<MobileDownloadCard />);

    expect(screen.queryByText('0%')).toBeNull();
    expect(container.querySelector('.mobile-download-card-progress-indeterminate')).not.toBeNull();
    expect(container.querySelector('.mobile-download-card-progress-fill')).toBeNull();
    expect(screen.getByText('4.0 KB')).toBeInTheDocument();
  });

  it('确定态：显示真实百分比 + 已下载/总大小', () => {
    act(() => {
      useUpdateStore.setState({
        status: 'downloading',
        version: '9.9.9',
        indeterminate: false,
        progress: 42,
        downloaded: 10485760,
        total: 20971520,
      });
    });

    const { container } = render(<MobileDownloadCard />);

    expect(screen.getByText('42%')).toBeInTheDocument();
    expect(screen.getByText('10.0 MB / 20.0 MB')).toBeInTheDocument();
    expect(container.querySelector('.mobile-download-card-progress-fill')).not.toBeNull();
    expect(container.querySelector('.mobile-download-card-progress-indeterminate')).toBeNull();
  });
});
