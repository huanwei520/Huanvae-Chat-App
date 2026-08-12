/**
 * 更新下载「实时传输速率」测试
 *
 * 分两层：
 * 1. **算法层**（`src/update/downloadSpeed.ts`）—— 纯逻辑，时间戳由测试注入，
 *    不用 fake timer。七类边界逐条钉死，每条都对应一个**真实存在的上游行为**：
 *    - 首样本 seed（不被 0.7 稀释）
 *    - dt < 50ms 丢弃，且**基线不被污染**（安卓终末补发）
 *    - delta < 0 丢样本 + 重置基线、ema 不变（桌面 `progress.fetch_sub` 回滚）
 *    - delta = 0 停滞参与 EMA 并衰减
 *    - dt > 2s seed 覆盖（安卓后台恢复）
 *    - downloaded >= total 冻结（分片不同时收尾）；且不定态 total=0 **不得**误冻结
 *    - EMA 数值正确性（精确算术，不是"大概在动"）
 * 2. **接线层** —— store 把速率算进 state，两端 UI 在有读数时显示、无读数时**整块不渲染**
 *    （不许出现 `0 B/s` 这种零信息量文案）。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import {
  createDownloadSpeedTracker,
  SPEED_EMA_ALPHA,
  MIN_SAMPLE_INTERVAL_MS,
  RESEED_INTERVAL_MS,
} from '../../src/update/downloadSpeed';
import type { DownloadProgress } from '../../src/update/service';

const mockDownloadAndInstall = vi.hoisted(() => vi.fn());
vi.mock('../../src/update/service', () => ({
  downloadAndInstall: mockDownloadAndInstall,
  checkForUpdates: vi.fn(),
  restartApp: vi.fn(),
}));

import { useUpdateStore } from '../../src/update/store';
import { UpdateToast } from '../../src/update/components/UpdateToast';
import { MobileDownloadCard } from '../../src/update/components/MobileDownloadCard';

// ============================================
// 1. 算法层
// ============================================

describe('downloadSpeed：EMA 速率估算', () => {
  /** 常量本身也是契约的一部分：改了它们等于改了收敛速度，必须是显式决策 */
  it('常量取值锁定（α=0.3 / 50ms 下限 / 2s 断档阈值）', () => {
    expect(SPEED_EMA_ALPHA).toBe(0.3);
    expect(MIN_SAMPLE_INTERVAL_MS).toBe(50);
    expect(RESEED_INTERVAL_MS).toBe(2000);
  });

  it('① 首样本直接 seed —— 不被 (1-α) 稀释成真值的 30%', () => {
    const t = createDownloadSpeedTracker();

    // 桌面 Started：downloaded=0 ⇒ 只立基线，还没有读数
    expect(t.push({ downloaded: 0, total: 10_000_000, now: 1000 })).toBeNull();

    // 第一个真样本：200ms 内 1 MB ⇒ 5 MB/s
    const first = t.push({ downloaded: 1_000_000, total: 10_000_000, now: 1200 });

    // 必须是**整个** 5_000_000，而不是 0.3 * 5_000_000 = 1_500_000
    expect(first).toBeCloseTo(5_000_000, 6);
    expect(first).not.toBeCloseTo(1_500_000, 6);
  });

  it('① 之二：首字节到达前的 delta=0 不能把 ema seed 成 0（否则真值永远追不上）', () => {
    const t = createDownloadSpeedTracker();

    t.push({ downloaded: 0, total: 10_000_000, now: 1000 }); // 基线
    // 连接建立中，200ms 过去了一个字节都没来 —— 这不是"停滞"，是还没开始
    expect(t.push({ downloaded: 0, total: 10_000_000, now: 1200 })).toBeNull();
    expect(t.push({ downloaded: 0, total: 10_000_000, now: 1400 })).toBeNull();

    // 首字节终于来了：仍应按「首样本 seed」处理，而不是从 0 慢慢爬
    const first = t.push({ downloaded: 1_000_000, total: 10_000_000, now: 1600 });
    expect(first).toBeCloseTo(5_000_000, 6);
  });

  it('② dt < 50ms 整条丢弃，且**基线不被污染**（下一次仍按原基线的长窗口算）', () => {
    const t = createDownloadSpeedTracker();

    t.push({ downloaded: 0, total: 10_000_000, now: 1000 });
    const seeded = t.push({ downloaded: 1_000_000, total: 10_000_000, now: 1200 });
    expect(seeded).toBeCloseTo(5_000_000, 6);

    // 安卓终末补发形态：与上一次只隔 10ms
    const discarded = t.push({ downloaded: 1_050_000, total: 10_000_000, now: 1210 });
    // 读数原样返回，没有被这个失真样本改动
    expect(discarded).toBeCloseTo(5_000_000, 6);

    // 恒速前进时基线污染与否算出来是同一个数（950000*1000/190 也是 5_000_000），
    // 所以本用例**只**负责「被丢弃的样本不得改动 ema」这一条；
    // 「基线没被推进」由下一个用例用不会巧合的数字单独证。
    const next = t.push({ downloaded: 2_000_000, total: 10_000_000, now: 1400 });
    expect(next).toBeCloseTo(5_000_000, 6);
  });

  it('② 之二：基线未被污染的**非巧合**验证（丢弃样本的字节必须仍被后续窗口算进去）', () => {
    const t = createDownloadSpeedTracker();

    t.push({ downloaded: 0, total: 10_000_000, now: 1000 });
    t.push({ downloaded: 1_000_000, total: 10_000_000, now: 1200 }); // ema = 5_000_000

    // 被丢弃的样本（dt=10ms），它带来的 400_000 字节不能凭空消失
    t.push({ downloaded: 1_400_000, total: 10_000_000, now: 1210 });

    // 基线仍是 (1200, 1_000_000) ⇒ dt=200, delta=1_400_000 ⇒ sample=7_000_000
    // ema = 0.3*7_000_000 + 0.7*5_000_000 = 2_100_000 + 3_500_000 = 5_600_000
    const next = t.push({ downloaded: 2_400_000, total: 10_000_000, now: 1400 });
    expect(next).toBeCloseTo(5_600_000, 6);

    // 若基线被污染成 (1210, 1_400_000)：dt=190, delta=1_000_000 ⇒ sample≈5_263_158
    // ⇒ ema ≈ 5_078_947，与上面明显不同 ⇒ 本断言能真的分辨两种实现
    expect(next).not.toBeCloseTo(5_078_947, 0);
  });

  it('③ delta < 0（桌面分片回滚）⇒ 丢样本、ema 不变，但基线重置到当前值', () => {
    const t = createDownloadSpeedTracker();

    t.push({ downloaded: 0, total: 10_000_000, now: 1000 });
    const before = t.push({ downloaded: 1_000_000, total: 10_000_000, now: 1200 });
    expect(before).toBeCloseTo(5_000_000, 6);

    // Rust 侧 progress.fetch_sub 回滚 400_000 字节（分片读失败的记账修正）
    const onRollback = t.push({ downloaded: 600_000, total: 10_000_000, now: 1400 });
    // ema 一个字都不许动（这段时间的真实吞吐我们没有新信息）
    expect(onRollback).toBeCloseTo(5_000_000, 6);

    // 🔴 基线必须已重置到 600_000：下一次 1_600_000 ⇒ delta=1_000_000（不是 600_000）
    //    sample = 5_000_000 ⇒ ema 维持 5_000_000。
    //    若基线没重置（还停在 1_000_000），delta 只有 600_000 ⇒ sample=3_000_000
    //    ⇒ ema = 0.3*3e6+0.7*5e6 = 4_400_000 —— 也就是把回滚掉的字节又算了一遍。
    const next = t.push({ downloaded: 1_600_000, total: 10_000_000, now: 1600 });
    expect(next).toBeCloseTo(5_000_000, 6);
    expect(next).not.toBeCloseTo(4_400_000, 0);
  });

  it('④ delta = 0 的真停滞必须参与 EMA 并按 (1-α)^n 衰减（不许挂着上一秒的漂亮数字）', () => {
    const t = createDownloadSpeedTracker();

    t.push({ downloaded: 0, total: 10_000_000, now: 1000 });
    t.push({ downloaded: 1_000_000, total: 10_000_000, now: 1200 }); // ema = 5_000_000

    // 卡住：字节不动，但 tick 照常来
    const s1 = t.push({ downloaded: 1_000_000, total: 10_000_000, now: 1400 });
    const s2 = t.push({ downloaded: 1_000_000, total: 10_000_000, now: 1600 });
    const s3 = t.push({ downloaded: 1_000_000, total: 10_000_000, now: 1800 });

    // sample=0 ⇒ ema 每次 ×0.7
    expect(s1).toBeCloseTo(5_000_000 * 0.7, 6);
    expect(s2).toBeCloseTo(5_000_000 * 0.7 ** 2, 6);
    expect(s3).toBeCloseTo(5_000_000 * 0.7 ** 3, 6);
    // 单调下降，确实在"往 0 掉"
    expect(s3!).toBeLessThan(s2!);
    expect(s2!).toBeLessThan(s1!);
  });

  it('⑤ dt > 2s（安卓后台恢复的断档巨样本）⇒ seed 覆盖，不按 α 混入旧 ema', () => {
    const t = createDownloadSpeedTracker();

    t.push({ downloaded: 0, total: 100_000_000, now: 1000 });
    t.push({ downloaded: 1_000_000, total: 100_000_000, now: 1200 }); // ema = 5_000_000

    // 进程被 cached 5 秒，回前台一次性拿到跨越 5s 的累计值
    // delta = 10_000_000，dt = 5000 ⇒ sample = 2_000_000
    const resumed = t.push({ downloaded: 11_000_000, total: 100_000_000, now: 6200 });

    // seed 覆盖 ⇒ 就是 sample 本身
    expect(resumed).toBeCloseTo(2_000_000, 6);
    // 若按 α 混入：0.3*2e6 + 0.7*5e6 = 4_100_000 —— 必须不是它
    expect(resumed).not.toBeCloseTo(4_100_000, 0);
  });

  it('⑥ downloaded >= total ⇒ 冻结最后读数，后续上报一律不再改动', () => {
    const t = createDownloadSpeedTracker();

    t.push({ downloaded: 0, total: 4_000_000, now: 1000 });
    t.push({ downloaded: 1_000_000, total: 4_000_000, now: 1200 }); // ema = 5_000_000
    const frozen = t.push({ downloaded: 2_000_000, total: 4_000_000, now: 1400 });
    expect(frozen).toBeCloseTo(5_000_000, 6);

    // 收尾：分片不同时结束，真实吞吐在跌 —— 冻结，不让用户看着数字往下掉
    expect(t.push({ downloaded: 4_000_000, total: 4_000_000, now: 1600 })).toBeCloseTo(5_000_000, 6);
    // 安卓 reporter.abort() 之后的补发 (100, done, total)：同样不得改动读数
    expect(t.push({ downloaded: 4_000_000, total: 4_000_000, now: 1610 })).toBeCloseTo(5_000_000, 6);
  });

  it('⑥ 之二：不定态 total=0 **不得**被误判成「已下完」而开局即冻结', () => {
    const t = createDownloadSpeedTracker();

    // 服务端没给 Content-Length ⇒ total 恒为 0，`downloaded >= total` 恒真
    t.push({ downloaded: 0, total: 0, now: 1000 });
    const v1 = t.push({ downloaded: 1_000_000, total: 0, now: 1200 });
    const v2 = t.push({ downloaded: 2_000_000, total: 0, now: 1400 });

    // 没有 `total > 0` 前提的实现在这里会全程返回 null
    expect(v1).toBeCloseTo(5_000_000, 6);
    expect(v2).toBeCloseTo(5_000_000, 6);
  });

  it('⑦ EMA 数值正确性：给定序列逐点落在精确值上', () => {
    const t = createDownloadSpeedTracker();

    t.push({ downloaded: 0, total: 10_000_000, now: 1000 });

    // dt=200ms, delta=1_000_000 ⇒ sample = 5_000_000；首样本 seed
    expect(t.push({ downloaded: 1_000_000, total: 10_000_000, now: 1200 })).toBeCloseTo(5_000_000, 6);

    // delta=2_000_000 ⇒ sample = 10_000_000
    // ema = 0.3*10_000_000 + 0.7*5_000_000 = 3_000_000 + 3_500_000 = 6_500_000
    expect(t.push({ downloaded: 3_000_000, total: 10_000_000, now: 1400 })).toBeCloseTo(6_500_000, 6);

    // delta=500_000 ⇒ sample = 2_500_000
    // ema = 0.3*2_500_000 + 0.7*6_500_000 = 750_000 + 4_550_000 = 5_300_000
    expect(t.push({ downloaded: 3_500_000, total: 10_000_000, now: 1600 })).toBeCloseTo(5_300_000, 6);
  });

  it('reset() 抹掉上一轮的基线与 ema —— 新一轮不许拿旧基线去减出一个巨值', () => {
    const t = createDownloadSpeedTracker();

    t.push({ downloaded: 0, total: 10_000_000, now: 1000 });
    t.push({ downloaded: 1_000_000, total: 10_000_000, now: 1200 });

    t.reset();

    // 新一轮：第一次上报只立基线（若没 reset，会拿 t=1200/1_000_000 去减）
    expect(t.push({ downloaded: 0, total: 10_000_000, now: 90_000 })).toBeNull();
    expect(t.push({ downloaded: 400_000, total: 10_000_000, now: 90_200 })).toBeCloseTo(2_000_000, 6);
  });
});

// ============================================
// 2. 接线层：store + 两端 UI
// ============================================

/** 把 store 重置回干净状态（zustand 是跨用例共享的全局单例） */
function resetStore() {
  useUpdateStore.setState({
    status: 'idle',
    version: '',
    progress: 0,
    downloaded: 0,
    total: 0,
    speed: 0,
    indeterminate: false,
    sourceUrl: '',
    errorMessage: '',
    isChecking: false,
    desktopUpdateInfo: null,
    androidUpdateInfo: null,
  });
}

/**
 * 驱动一次桌面下载；`times` 依次喂给 performance.now()，与事件一一对应。
 *
 * 用带游标的 mockImplementation 而不是 `mockReturnValueOnce` 链：后者一旦被
 * **别的**调用方（React / framer-motion）多取走一格，整条时间线就会错位，
 * 且用完之后返回 undefined —— 失败现场极难读。游标封顶后恒返回最后一个时刻，
 * 多余调用不会让时间倒流，也不会产生 NaN。
 */
async function driveDesktopDownload(
  events: DownloadProgress[],
  times: number[],
): Promise<number[]> {
  let cursor = 0;
  vi.spyOn(performance, 'now').mockImplementation(
    () => times[Math.min(cursor++, times.length - 1)],
  );

  useUpdateStore.setState({
    desktopUpdateInfo: { available: true, version: '9.9.9', update: { rid: 1 } as never },
  });

  // 🔴 必须在**下载进行中**逐事件采样：handleUpdate 收尾会调 downloadComplete()，
  //    而它按设计把 speed 清回 0（离开 downloading 就不该留读数）。跑完再读 state
  //    永远是 0，读到的是终态、不是用户在下载时看到的东西。
  const speeds: number[] = [];
  mockDownloadAndInstall.mockImplementation(
    async (_u: unknown, onProgress: (p: DownloadProgress) => void) => {
      for (const e of events) {
        onProgress(e);
        speeds.push(useUpdateStore.getState().speed);
      }
    },
  );

  await act(async () => {
    await useUpdateStore.getState().handleUpdate();
  });

  return speeds;
}

/** 20 MiB 包，每 200ms 稳定下 2 MiB ⇒ 恰好 10 MiB/s */
const TOTAL = 20_971_520;
const STEADY_EVENTS: DownloadProgress[] = [
  { event: 'Started', contentLength: TOTAL, percent: 0, indeterminate: false, downloaded: 0 },
  { event: 'Progress', contentLength: TOTAL, percent: 10, indeterminate: false, downloaded: 2_097_152 },
  { event: 'Progress', contentLength: TOTAL, percent: 20, indeterminate: false, downloaded: 4_194_304 },
];

describe('接线：store 把速率算进 state', () => {
  beforeEach(() => {
    resetStore();
    mockDownloadAndInstall.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('稳定 10 MiB/s 的进度序列 ⇒ 下载途中 store.speed 就是 10 MiB/s', async () => {
    const speeds = await driveDesktopDownload(STEADY_EVENTS, [1000, 1200, 1400]);

    // Started 只立基线（还没有读数 ⇒ 0 = 不显示），其后两个样本都恰好 10 MiB/s
    expect(speeds[0]).toBe(0);
    expect(speeds[1]).toBeCloseTo(10_485_760, 6);
    expect(speeds[2]).toBeCloseTo(10_485_760, 6);
  });

  it('只有 Started 时 speed 保持 0（不显示 ⇒ 不会闪一个 0 B/s）', async () => {
    const speeds = await driveDesktopDownload([STEADY_EVENTS[0]], [1000]);
    expect(speeds).toEqual([0]);
  });

  it('handleUpdate 收尾（downloadComplete）把速率清回 0，不留过期读数', async () => {
    const speeds = await driveDesktopDownload(STEADY_EVENTS, [1000, 1200, 1400]);
    expect(speeds[2]).toBeGreaterThan(0); // 下载途中确有读数
    expect(useUpdateStore.getState().speed).toBe(0); // 跑完已清零
    expect(useUpdateStore.getState().status).toBe('ready');
  });

  it('startDownload 清零上一轮遗留的速率', () => {
    useUpdateStore.setState({ status: 'downloading', speed: 12_345 });
    act(() => {
      useUpdateStore.getState().startDownload();
    });
    expect(useUpdateStore.getState().speed).toBe(0);
  });

  it('showError / dismiss 这两个出口同样把速率清回 0', () => {
    useUpdateStore.setState({ status: 'downloading', speed: 12_345 });
    act(() => {
      useUpdateStore.getState().showError('网络断了');
    });
    expect(useUpdateStore.getState().speed).toBe(0);

    useUpdateStore.setState({ status: 'downloading', speed: 12_345 });
    act(() => {
      useUpdateStore.getState().dismiss();
    });
    expect(useUpdateStore.getState().speed).toBe(0);
  });

  it('新一轮下载不复用上一轮基线（否则第一个样本会算出荒唐的巨值）', async () => {
    await driveDesktopDownload(STEADY_EVENTS, [1000, 1200, 1400]);
    vi.restoreAllMocks();

    // 第二轮的时间戳整体推后 90 秒；若基线没被 startDownload 重置，
    // 第一个样本的 dt 会被算成 ~90s 之前的差值 ⇒ 速率荒唐地偏离
    const speeds = await driveDesktopDownload(STEADY_EVENTS, [91_000, 91_200, 91_400]);
    expect(speeds[0]).toBe(0);
    expect(speeds[1]).toBeCloseTo(10_485_760, 6);
  });
});

describe('接线：两端 UI 显示速率（有读数才显示）', () => {
  const queryToast = (sel: string) => document.body.querySelector(sel);

  beforeEach(() => {
    resetStore();
  });

  it('桌面 UpdateToast：speed>0 ⇒ 显示 "10.0 MB/s"', () => {
    render(
      <UpdateToast
        status="downloading"
        version="9.9.9"
        indeterminate={false}
        progress={20}
        downloaded={4_194_304}
        total={TOTAL}
        speed={10_485_760}
      />,
    );

    expect(screen.getByText('10.0 MB/s')).toBeInTheDocument();
    expect(queryToast('.update-toast-speed')).not.toBeNull();
    // 原有的 已下载/总大小 文案不能被挤掉
    expect(screen.getByText('4.0 MB / 20.0 MB')).toBeInTheDocument();
  });

  it('桌面 UpdateToast：speed=0 ⇒ 整块不渲染，绝不出现 "0 B/s"', () => {
    render(
      <UpdateToast
        status="downloading"
        version="9.9.9"
        indeterminate={false}
        progress={0}
        downloaded={0}
        total={TOTAL}
        speed={0}
      />,
    );

    expect(screen.queryByText('0 B/s')).toBeNull();
    expect(queryToast('.update-toast-speed')).toBeNull();
  });

  it('桌面 UpdateToast：不定态下同样显示速率（总长未知不妨碍算速率）', () => {
    render(
      <UpdateToast status="downloading" version="9.9.9" indeterminate downloaded={4096} total={0} speed={1024} />,
    );

    expect(screen.getByText('1.0 KB/s')).toBeInTheDocument();
  });

  it('移动 MobileDownloadCard：speed>0 ⇒ 显示速率，且不挤掉字节文案', () => {
    act(() => {
      useUpdateStore.setState({
        status: 'downloading',
        version: '9.9.9',
        indeterminate: false,
        progress: 20,
        downloaded: 4_194_304,
        total: TOTAL,
        speed: 10_485_760,
      });
    });

    const { container } = render(<MobileDownloadCard />);

    expect(screen.getByText('10.0 MB/s')).toBeInTheDocument();
    expect(container.querySelector('.mobile-download-card-speed')).not.toBeNull();
    expect(screen.getByText('4.0 MB / 20.0 MB')).toBeInTheDocument();
  });

  it('移动 MobileDownloadCard：speed=0 ⇒ 整块不渲染，绝不出现 "0 B/s"', () => {
    act(() => {
      useUpdateStore.setState({
        status: 'downloading',
        version: '9.9.9',
        indeterminate: false,
        progress: 0,
        downloaded: 0,
        total: TOTAL,
        speed: 0,
      });
    });

    const { container } = render(<MobileDownloadCard />);

    expect(screen.queryByText('0 B/s')).toBeNull();
    expect(container.querySelector('.mobile-download-card-speed')).toBeNull();
  });
});
