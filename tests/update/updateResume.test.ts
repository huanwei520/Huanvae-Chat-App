/**
 * 断点续传：前端这一段的回归契约
 *
 * 背景（真实缺陷）：更新下载的「断点续传」名不副实 —— 只有「单个分片的一次请求失败后
 * 接着下」那一层是真的；**整次失败 / 用户点重试 / 进程重启一律从头下**。
 * 字节层面的续传已在 Rust 侧补上（`src-tauri/src/resume_meta.rs` + 两端下载器），
 * 前端这一段要守的是另外两件事：
 *
 * 1. **点「重试」不许把进度清零** —— 清零传达的是「之前下的全白费了」，而那是假的。
 *    弱网上重试前那次 HEAD 探测要好几百毫秒，正是用户盯着看的那几百毫秒。
 * 2. **续传起点必须由 `Started` 事件自己带出来**，不能"先报 0 再补一条 Progress" ——
 *    后者会让速率估算把断点那一跳（0 → 8MB）当成 200ms 内的真实吞吐，
 *    读数瞬间飙到几十 MB/s，EMA 要好几秒才落回真值。
 *
 * 跨语言线格式（Rust `ShardedEvent` 与 TS 解析的 tag / 字段名是否对得上）**不在本文件**，
 * 归 `tests/update/updateWireContract.test.ts` —— 原先放在这里的那组只是 grep 字段名，
 * 对格式漂移结构上不可能翻红，已删（见文件末尾的说明）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import type { DownloadProgress } from '../../src/update/service';

// service 被 store 用 `await import('./service')` 动态导入 —— 只在第 1 组用得到，
// 第 2 组直接测真实 service.ts，故这里**不**整体 mock service。
import { useUpdateStore } from '../../src/update/store';
import { downloadAndInstall } from '../../src/update/service';

const invokeMock = vi.mocked(invoke);

/** 把 store 拨到「上一次下载失败在 8MB / 共 13MB」的现场 */
function seedFailedAt(downloaded: number, total: number) {
  useUpdateStore.setState({
    status: 'error',
    errorMessage: '分片请求失败',
    downloaded,
    total,
    progress: Math.round((downloaded / total) * 100),
    speed: 0,
    indeterminate: false,
    resumeHint: false,
  });
}

describe('重试不清零进度（前端只负责显示，字节续传在 Rust 侧）', () => {
  beforeEach(() => {
    useUpdateStore.setState({ resumeHint: false });
  });

  it('handleRetry → startDownload 保留上次的已下字节 / 总长 / 百分比', () => {
    seedFailedAt(8_000_000, 13_766_023);
    // handleRetry 会去调 handleUpdate（异步、需要 updateInfo），这里只验它置位的效果，
    // 所以直接走「置位 + startDownload」这条真实路径。
    useUpdateStore.getState().handleRetry();
    useUpdateStore.getState().startDownload();

    const s = useUpdateStore.getState();
    expect(s.status).toBe('downloading');
    expect(s.downloaded).toBe(8_000_000);
    expect(s.total).toBe(13_766_023);
    expect(s.progress).toBe(58);
    // 🔴 关键：不能退回不定态。退回去 = 进度条变成滚动动画 = 用户读作"重新开始了"
    expect(s.indeterminate).toBe(false);
  });

  it('首次下载（没点过重试）仍然从 0 起并进不定态', () => {
    seedFailedAt(8_000_000, 13_766_023);
    // 不调 handleRetry —— 这是「更新」按钮那条路径
    useUpdateStore.getState().startDownload();

    const s = useUpdateStore.getState();
    expect(s.downloaded).toBe(0);
    expect(s.total).toBe(0);
    expect(s.progress).toBe(0);
    expect(s.indeterminate).toBe(true);
  });

  it('resumeHint 是一次性的：消费后不会污染下一次全新下载', () => {
    seedFailedAt(8_000_000, 13_766_023);
    useUpdateStore.getState().handleRetry();
    useUpdateStore.getState().startDownload();
    expect(useUpdateStore.getState().resumeHint).toBe(false);

    // 第二次是全新下载（用户重新点「更新」），必须回到 0
    useUpdateStore.getState().startDownload();
    const s = useUpdateStore.getState();
    expect(s.downloaded).toBe(0);
    expect(s.indeterminate).toBe(true);
  });

  it('没有上次读数时（total=0）即使点重试也走不定态，不编造一个百分比', () => {
    useUpdateStore.setState({
      status: 'error',
      downloaded: 0,
      total: 0,
      progress: 0,
      indeterminate: true,
      resumeHint: false,
    });
    useUpdateStore.getState().handleRetry();
    useUpdateStore.getState().startDownload();

    const s = useUpdateStore.getState();
    expect(s.total).toBe(0);
    expect(s.indeterminate).toBe(true);
  });

  it('续传下载中 androidApkPath 必须作废（此刻盘上是半截包，不能给「立即安装」）', () => {
    useUpdateStore.setState({
      androidApkPath: '/data/cache/half.apk',
      downloaded: 8_000_000,
      total: 13_766_023,
      resumeHint: false,
    });
    useUpdateStore.getState().handleRetry();
    useUpdateStore.getState().startDownload();
    expect(useUpdateStore.getState().androidApkPath).toBe('');
  });
});

describe('Started 事件自带断点起点（不是先报 0 再补 Progress）', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  /** 驱动一次真实的 downloadAndInstall，让 Rust 侧事件按给定序列发过来 */
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

  it('续传：Started 直接报断点字节与对应百分比', async () => {
    const got = await drive([
      { event: 'Started', data: { contentLength: 1000, downloaded: 400 } },
      { event: 'Progress', data: { downloaded: 700, contentLength: 1000 } },
    ]);

    expect(got[0]).toMatchObject({
      event: 'Started',
      contentLength: 1000,
      downloaded: 400,
      percent: 40,
      indeterminate: false,
    });
    // 🔴 反向断言：Started 若还报 0，速率估算就会把 0→400 当成一个 tick 内的吞吐
    expect(got[0].downloaded).not.toBe(0);
    expect(got[1]).toMatchObject({ downloaded: 700, percent: 70 });
  });

  it('非续传：Started 的起点就是 0，百分比 0（正对照，防止上面那条被"恒非零"蒙混）', async () => {
    const got = await drive([{ event: 'Started', data: { contentLength: 1000, downloaded: 0 } }]);
    expect(got[0]).toMatchObject({ downloaded: 0, percent: 0, indeterminate: false });
  });

  it('总长未知：仍是不定态，不拿断点字节去除一个 undefined', async () => {
    const got = await drive([
      { event: 'Started', data: { contentLength: null, downloaded: 400 } },
    ]);
    expect(got[0]).toMatchObject({ indeterminate: true, downloaded: 400 });
    expect(got[0].percent).toBeUndefined();
  });
});

// 原「跨语言契约：Started.downloaded 两侧都要有」那一组已**删除**（不是搬走）。
// 它只 grep 两边源码里有没有这几个字，对**格式漂移**在结构上不可能翻红 —— 事实上
// v1.1.23~v1.1.32 期间 Rust 真实线格式是 `{"event":"started","data":{"content_length":…}}`
// （enum 上的 `rename_all` 改的是**变体名**、不是字段名），前端一条事件都收不到、
// 进度条恒 0，而这两条断言全程绿着。
// 替代者：`tests/update/updateWireContract.test.ts` —— 从 Rust 源码**派生**真实线格式、
// 钉到真 serde 输出，再把派生结果喂进前端真实 handler（tag/字段名任一漂移即红）。
