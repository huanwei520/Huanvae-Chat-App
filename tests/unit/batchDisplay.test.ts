/**
 * 局域网传输：批量卡片的展示纯逻辑（src/lanTransfer/batchDisplay.ts）
 *
 * 覆盖诊断报告 D-22（卡片方向+对端标识）与 D-23（文件计数由 files 数组状态推导，
 * 不再直接信任后端 completed_files——它会把 Cancelled 也计进去）以及 D-15 的
 * 整批失败横幅文案。全部是被测纯函数的输入→输出行为断言。
 */

import { describe, it, expect } from 'vitest';
import {
  deriveFileCounts,
  describeBatchDirection,
  formatBatchCardTitle,
  describeBatchOutcome,
  describeBatchFailure,
  type BatchDirectionMeta,
} from '../../src/lanTransfer/batchDisplay';

describe('deriveFileCounts（D-23：计数由 files 状态推导）', () => {
  it('completed 计 completed、failed/cancelled 单列、pending/transferring 归 active', () => {
    const files = [
      { status: 'completed' },
      { status: 'completed' },
      { status: 'cancelled' },
      { status: 'failed' },
      { status: 'transferring' },
      { status: 'pending' },
    ];
    expect(deriveFileCounts(files)).toEqual({
      completed: 2,
      failed: 1,
      cancelled: 1,
      active: 2,
      total: 6,
    });
  });

  it('files 缺省 → 全 0（调用方此时本就不该渲染「x/y 文件」）', () => {
    expect(deriveFileCounts(undefined)).toEqual({
      completed: 0,
      failed: 0,
      cancelled: 0,
      active: 0,
      total: 0,
    });
    expect(deriveFileCounts(null)).toEqual({
      completed: 0,
      failed: 0,
      cancelled: 0,
      active: 0,
      total: 0,
    });
  });

  it('cancelled 不再被计入 completed（后端 completed_files 的旧行为是「3/3 文件」而进度不满）', () => {
    const counts = deriveFileCounts([
      { status: 'completed' },
      { status: 'cancelled' },
      { status: 'cancelled' },
    ]);
    expect(counts.completed).toBe(1);
    expect(counts.cancelled).toBe(2);
  });
});

describe('describeBatchDirection（D-22：方向+对端，payload 直读优先、会话表回退）', () => {
  it('payload 直读命中时不查会话表', () => {
    const progress = { sessionId: 's1', direction: 'receive' as const, peerDeviceName: '手机B' };
    const sessions = [
      { sessionId: 's1', targetDevice: { deviceId: 'd1', deviceName: '桌面A' }, direction: 'send' as const },
    ];
    expect(describeBatchDirection(progress, sessions)).toEqual({
      direction: 'receive',
      peerName: '手机B',
    });
  });

  it('payload 缺省字段回退会话表（direction、对端名各自独立回退）', () => {
    const sessions = [
      { sessionId: 's1', targetDevice: { deviceId: 'd1', deviceName: '桌面A' }, direction: 'send' as const },
    ];
    expect(describeBatchDirection({ sessionId: 's1' }, sessions)).toEqual({
      direction: 'send',
      peerName: '桌面A',
    });
    // 只有对端名缺省：direction 用 payload 的
    expect(
      describeBatchDirection({ sessionId: 's1', direction: 'receive' as const }, sessions),
    ).toEqual({ direction: 'receive', peerName: '桌面A' });
  });

  it('两边都拿不到 → null（调用方回退「批量传输」这类无方向文案，不猜）', () => {
    expect(describeBatchDirection({ sessionId: 's-unknown' }, [])).toEqual({
      direction: null,
      peerName: null,
    });
  });
});

describe('formatBatchCardTitle（D-22：「发送给/接收自 {对端}」）', () => {
  const cases: Array<[string, BatchDirectionMeta]> = [
    ['发送给 手机B', { direction: 'send', peerName: '手机B' }],
    ['接收自 桌面A', { direction: 'receive', peerName: '桌面A' }],
    // 有方向但对端名缺省：退化为无名字文案
    ['发送文件', { direction: 'send', peerName: null }],
    ['接收文件', { direction: 'receive', peerName: null }],
    // 无方向：回退 fallback
    ['批量传输', { direction: null, peerName: null }],
    ['批量传输', { direction: null, peerName: '某设备' }],
  ];

  it.each(cases)('%s', (expected, meta) => {
    expect(formatBatchCardTitle(meta)).toBe(expected);
  });

  it('无方向时使用调用方提供的 fallback', () => {
    expect(formatBatchCardTitle({ direction: null, peerName: null }, '传输任务')).toBe('传输任务');
  });
});

describe('describeBatchOutcome（终态徽标）', () => {
  const cases: Array<[string, string, string]> = [
    ['completed', '已完成', 'completed'],
    ['partial', '部分失败', 'failed'],
    ['failed', '失败', 'failed'],
    ['cancelled', '已取消', 'cancelled'],
  ];

  it.each(cases)('outcome=%s → %s（样式 %s）', (outcome, label, className) => {
    expect(describeBatchOutcome(outcome)).toEqual({ label, className });
  });

  it('非终态（undefined/未知值）→ null，不渲染徽标', () => {
    expect(describeBatchOutcome(undefined)).toBeNull();
    expect(describeBatchOutcome('still-running')).toBeNull();
  });
});

describe('describeBatchFailure（D-15：整批失败横幅文案，不再无声消失）', () => {
  it('有文件明细 → 带失败计数', () => {
    expect(
      describeBatchFailure({ files: [{ status: 'failed' }, { status: 'completed' }, { status: 'failed' }] }),
    ).toBe('批量传输失败：2/3 个文件失败');
  });

  it('无文件信息 → 通用文案（仍然可见）', () => {
    expect(describeBatchFailure({ files: undefined })).toBe('批量传输失败');
    expect(describeBatchFailure({})).toBe('批量传输失败');
  });
});
