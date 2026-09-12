/**
 * 局域网传输：批量进度 / 哈希进度 → 设备 的归属纯逻辑
 * （src/lanTransfer/batchProgressAttribution.ts）
 *
 * 🔴 回归目标（外部审计 idx=74）：原实现是
 * `for (const [_sessionId, progress] of map) { if (activeConnections.length === 1) return progress; }`
 * —— 循环体判的是**循环外的常量**：
 *   · 连着 ≥2 台设备 ⇒ 跑满 Map 后必然 return null ⇒ **所有**设备卡片的文件列表 /
 *     总体进度条 /「取消全部」同时消失；
 *   · 恰好 1 台 ⇒ 无条件返回 Map 里第一个 entry，不做任何归属校验。
 *
 * 2026-02 扩展（诊断报告 D-01/D-22/C4）：
 * Rust 侧在 batch_progress payload 增补了 `direction` / `peer_device_id` /
 * `peer_device_name`（可能缺省）。归属优先级 = **payload 直读优先、会话表回退**：
 *   · 接收方向会话（D-01 修复前）进不了会话表，只有 payload 直读能归属它；
 *   · 会话表补拉有延迟，payload 是更权威及时的依据。
 */

import { describe, it, expect } from 'vitest';
import {
  pickBatchProgressForDevice,
  resolveHashingTargetDevice,
  type SessionOwnership,
  type BatchProgressOwnership,
} from '../../src/lanTransfer/batchProgressAttribution';

const sessions: SessionOwnership[] = [
  { sessionId: 's-a', targetDevice: { deviceId: 'dev-a' } },
  { sessionId: 's-b', targetDevice: { deviceId: 'dev-b' } },
];

describe('pickBatchProgressForDevice — 会话表回退路径（原回归目标）', () => {
  it('两台设备同时在传时，各自拿到自己的那一份（原实现在这里对两台都返回 null）', () => {
    const map = new Map<string, BatchProgressOwnership>([
      ['s-a', { sessionId: 's-a' }],
      ['s-b', { sessionId: 's-b' }],
    ]);

    expect(pickBatchProgressForDevice(map, sessions, 'dev-a')?.sessionId).toBe('s-a');
    expect(pickBatchProgressForDevice(map, sessions, 'dev-b')?.sessionId).toBe('s-b');
  });

  it('只有一台在传时，另一台拿到 null（不是「Map 里的第一个」）', () => {
    const map = new Map<string, BatchProgressOwnership>([['s-b', { sessionId: 's-b' }]]);

    expect(pickBatchProgressForDevice(map, sessions, 'dev-b')?.sessionId).toBe('s-b');
    // 原实现在「只有一个连接」时会把 s-b 的进度返回给任何设备
    expect(pickBatchProgressForDevice(map, sessions, 'dev-a')).toBeNull();
  });

  it('会话表里还没有该 sessionId ⇒ null（宁可这一帧不显示，也不猜归属）', () => {
    const map = new Map<string, BatchProgressOwnership>([['s-unknown', { sessionId: 's-unknown' }]]);

    expect(pickBatchProgressForDevice(map, sessions, 'dev-a')).toBeNull();
    expect(pickBatchProgressForDevice(map, [], 'dev-a')).toBeNull();
  });

  it('空进度表 ⇒ null', () => {
    expect(pickBatchProgressForDevice(new Map(), sessions, 'dev-a')).toBeNull();
  });
});

describe('pickBatchProgressForDevice — payload 直读路径（D-01/D-22 契约增补）', () => {
  it('payload 直读命中：会话表为空也能归属（接收方向会话不在表里也能显示）', () => {
    const map = new Map<string, BatchProgressOwnership>([
      ['s-recv', { sessionId: 's-recv', direction: 'receive', peerDeviceId: 'dev-a' }],
    ]);

    const hit = pickBatchProgressForDevice(map, [], 'dev-a');
    expect(hit?.sessionId).toBe('s-recv');
    expect(hit?.direction).toBe('receive');
  });

  it('双端并发不串卡（payload 直读）：A/B 互传时各自拿到自己的，第三方拿到 null', () => {
    const map = new Map<string, BatchProgressOwnership>([
      ['s-a', { sessionId: 's-a', direction: 'send', peerDeviceId: 'dev-a' }],
      ['s-b', { sessionId: 's-b', direction: 'receive', peerDeviceId: 'dev-b' }],
    ]);

    expect(pickBatchProgressForDevice(map, [], 'dev-a')?.sessionId).toBe('s-a');
    expect(pickBatchProgressForDevice(map, [], 'dev-b')?.sessionId).toBe('s-b');
    expect(pickBatchProgressForDevice(map, [], 'dev-c')).toBeNull();
  });

  it('双端并发不串卡（会话表回退）：旧 payload 无 peerDeviceId 也不串', () => {
    const map = new Map<string, BatchProgressOwnership>([
      ['s-a', { sessionId: 's-a' }],
      ['s-b', { sessionId: 's-b' }],
    ]);

    expect(pickBatchProgressForDevice(map, sessions, 'dev-a')?.sessionId).toBe('s-a');
    expect(pickBatchProgressForDevice(map, sessions, 'dev-b')?.sessionId).toBe('s-b');
    // dev-a 绝不能拿到 dev-b 的那份
    expect(pickBatchProgressForDevice(map, sessions, 'dev-a')?.sessionId).not.toBe('s-b');
  });

  it('payload 直读优先于会话表：带明确对端的条目永不被会话表二次归属给别的设备', () => {
    const map = new Map<string, BatchProgressOwnership>([
      ['s1', { sessionId: 's1', peerDeviceId: 'dev-a' }],
    ]);
    // 会话表声称 s1 属于 dev-b（补拉延迟/过时数据），payload 声称对端是 dev-a
    const staleSessions: SessionOwnership[] = [
      { sessionId: 's1', targetDevice: { deviceId: 'dev-b' } },
    ];

    expect(pickBatchProgressForDevice(map, staleSessions, 'dev-a')?.sessionId).toBe('s1');
    // 若无排除语义，同一批进度会同时画到 dev-a 和 dev-b 两张卡片上
    expect(pickBatchProgressForDevice(map, staleSessions, 'dev-b')).toBeNull();
  });

  it('peerDeviceId 为 undefined 视为缺省：不参与直读命中，但仍可靠会话表回退归属（旧后端兼容）', () => {
    const map = new Map<string, BatchProgressOwnership>([
      ['s1', { sessionId: 's1', peerDeviceId: undefined }],
    ]);

    // 缺对端 + 会话表没有 → null（不猜）
    expect(pickBatchProgressForDevice(map, [], 'dev-a')).toBeNull();
    // 会话表有明确命中 → 回退生效（旧后端 payload 不丢进度）
    const table: SessionOwnership[] = [{ sessionId: 's1', targetDevice: { deviceId: 'dev-a' } }];
    expect(pickBatchProgressForDevice(map, table, 'dev-a')?.sessionId).toBe('s1');
  });
});

describe('resolveHashingTargetDevice（D-17：哈希进度不得广播到所有设备卡片）', () => {
  const hashing = { fileName: 'big.bin' };
  const sessionsWithFile = [
    {
      sessionId: 's1',
      targetDevice: { deviceId: 'dev-a' },
      files: [{ file: { fileName: 'big.bin' } }],
    },
  ];

  it('显式目标优先（sendFilesToPeer 发起时锁定；哈希阶段先于会话落表）', () => {
    expect(resolveHashingTargetDevice(hashing, [], 'dev-x')).toBe('dev-x');
    // 显式目标存在时，会话表匹配结果不得覆盖它
    expect(resolveHashingTargetDevice(hashing, sessionsWithFile, 'dev-x')).toBe('dev-x');
  });

  it('无显式目标时按正在哈希的文件名匹配会话文件列表 → 该会话的目标设备', () => {
    expect(resolveHashingTargetDevice(hashing, sessionsWithFile, null)).toBe('dev-a');
  });

  it('归属不了返回 null（UI 据此不渲染，而不是画到每张卡片上）', () => {
    // 文件名不属于任何会话
    expect(resolveHashingTargetDevice({ fileName: 'other.bin' }, sessionsWithFile, null)).toBeNull();
    // 没有哈希进度
    expect(resolveHashingTargetDevice(null, sessionsWithFile, null)).toBeNull();
    // 会话表为空且无显式目标
    expect(resolveHashingTargetDevice(hashing, [], null)).toBeNull();
  });
});
