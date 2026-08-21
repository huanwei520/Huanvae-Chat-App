/**
 * 局域网传输：批量进度 → 设备 的归属（src/lanTransfer/batchProgressAttribution.ts）
 *
 * 🔴 回归目标（外部审计 idx=74）：原实现是
 * `for (const [_sessionId, progress] of map) { if (activeConnections.length === 1) return progress; }`
 * —— 循环体判的是**循环外的常量**：
 *   · 连着 ≥2 台设备 ⇒ 跑满 Map 后必然 return null ⇒ **所有**设备卡片的文件列表 /
 *     总体进度条 /「取消全部」同时消失；
 *   · 恰好 1 台 ⇒ 无条件返回 Map 里第一个 entry，不做任何归属校验。
 * 下面两条正是这两半：多设备时**各自拿到自己的**，以及不许把别人的进度画到自己头上。
 */

import { describe, it, expect } from 'vitest';
import {
  pickBatchProgressForDevice,
  type SessionOwnership,
} from '../../src/lanTransfer/batchProgressAttribution';

const sessions: SessionOwnership[] = [
  { sessionId: 's-a', targetDevice: { deviceId: 'dev-a' } },
  { sessionId: 's-b', targetDevice: { deviceId: 'dev-b' } },
];

describe('pickBatchProgressForDevice', () => {
  it('两台设备同时在传时，各自拿到自己的那一份（原实现在这里对两台都返回 null）', () => {
    const map = new Map([
      ['s-a', 'progress-a'],
      ['s-b', 'progress-b'],
    ]);

    expect(pickBatchProgressForDevice(map, sessions, 'dev-a')).toBe('progress-a');
    expect(pickBatchProgressForDevice(map, sessions, 'dev-b')).toBe('progress-b');
  });

  it('只有一台在传时，另一台拿到 null（不是「Map 里的第一个」）', () => {
    const map = new Map([['s-b', 'progress-b']]);

    expect(pickBatchProgressForDevice(map, sessions, 'dev-b')).toBe('progress-b');
    // 原实现在「只有一个连接」时会把 s-b 的进度返回给任何设备
    expect(pickBatchProgressForDevice(map, sessions, 'dev-a')).toBeNull();
  });

  it('会话表里还没有该 sessionId ⇒ null（宁可这一帧不显示，也不猜归属）', () => {
    const map = new Map([['s-unknown', 'progress-x']]);

    expect(pickBatchProgressForDevice(map, sessions, 'dev-a')).toBeNull();
    expect(pickBatchProgressForDevice(map, [], 'dev-a')).toBeNull();
  });

  it('空进度表 ⇒ null', () => {
    expect(pickBatchProgressForDevice(new Map(), sessions, 'dev-a')).toBeNull();
  });
});
