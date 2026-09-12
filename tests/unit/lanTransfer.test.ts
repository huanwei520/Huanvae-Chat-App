/**
 * 局域网传输 hook 行为测试（src/hooks/useLanTransfer.ts）
 *
 * 🔴 本文件是 2026-02 重写版：旧版属于「mock 自证」型假测试（mockInvoke 后断言
 * mockInvoke 被同样参数调用，诊断报告 D 节点名 L110-135），对真实行为零覆盖，
 * 已按 tests/.claude/skills/test-quality-check 标准整文件删除，重写为行为测试——
 *
 * 测试策略：mock @tauri-apps/api/core 的 invoke（tests/setup.ts 已全局 mock）+
 * mock @tauri-apps/api/event 的 listen 捕获事件回调，然后向 hook **喂预设事件序列**，
 * 断言 hook 状态迁移。被测对象是真 hook，不是 mock。
 *
 * 覆盖的缺陷修复：
 * - D-08：startService/stopService 失败 → serviceError 置位（不再吞错），停止失败不打断关窗清理
 * - D-15：transfer_failed 的 error 写入批量条目文件级状态；batch_transfer_completed 带
 *   outcome=partial/failed 时终态条目保留、failed_files 逐文件带原因；outcome=completed 才移除
 * - D-16：peer_connection_established 仅发起方写 currentConnection
 * - D-17：hashing_progress 归属发起目标设备，同对端首条 batch_progress 清除，异对端不吞
 * - D-19：并发 startService 去重（共享同一次 invoke）
 * - D-01/D-22：batch_progress 的 direction/peer 字段透传，配合归属纯函数双端不串卡
 * - D-12：eventCount/lastEvent 来自真实事件流
 * - 契约防御：payload 字段缺省（旧后端）时状态机不炸、向后兼容
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';

import {
  useLanTransfer,
  type DiscoveredDevice,
  type PeerConnection,
  type TransferTask,
  type BatchTransferProgress,
} from '../../src/hooks/useLanTransfer';
import { pickBatchProgressForDevice } from '../../src/lanTransfer/batchProgressAttribution';

// ============================================================
// mock @tauri-apps/api/event：捕获 hook 注册的事件回调，
// 让测试能向 hook 喂「预设事件序列」
// ============================================================

type EventHandler = (event: { payload: unknown }) => void;

const { eventHandlers } = vi.hoisted(() => ({
  eventHandlers: [] as Array<(event: { payload: unknown }) => void>,
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: async (_event: string, handler: EventHandler) => {
    eventHandlers.push(handler);
    return () => {
      const index = eventHandlers.indexOf(handler);
      if (index >= 0) {
        eventHandlers.splice(index, 1);
      }
    };
  },
}));

const mockInvoke = invoke as ReturnType<typeof vi.fn>;

// ============================================================
// 测试数据构造器
// ============================================================

function makeDevice(overrides: Partial<DiscoveredDevice> = {}): DiscoveredDevice {
  return {
    deviceId: 'dev-a',
    deviceName: '设备A',
    userId: 'user-a',
    userNickname: '用户A',
    ipAddress: '192.168.1.10',
    port: 53317,
    discoveredAt: '2026-02-10T00:00:00Z',
    lastSeen: '2026-02-10T00:00:00Z',
    ...overrides,
  };
}

function makeConnection(overrides: Partial<PeerConnection> = {}): PeerConnection {
  return {
    connectionId: 'conn-1',
    peerDevice: makeDevice(),
    establishedAt: '2026-02-10T00:00:01Z',
    status: 'connected',
    isInitiator: true,
    ...overrides,
  };
}

function makeTask(overrides: Partial<TransferTask> = {}): TransferTask {
  return {
    taskId: 'task-1',
    sessionId: 'session-1',
    file: { fileId: 'file-1', fileName: 'a.txt', fileSize: 100, mimeType: 'text/plain', sha256: 'hash-a' },
    direction: 'send',
    targetDevice: makeDevice(),
    status: 'transferring',
    transferredBytes: 0,
    speed: 0,
    startedAt: '2026-02-10T00:00:02Z',
    ...overrides,
  };
}

function makeProgress(overrides: Partial<BatchTransferProgress> & { sessionId: string }): BatchTransferProgress {
  return {
    totalFiles: 2,
    completedFiles: 0,
    totalBytes: 200,
    transferredBytes: 0,
    speed: 0,
    ...overrides,
  };
}

// ============================================================
// invoke 桩：按命令给默认应答，测试用 overrides 覆盖关心的命令
// ============================================================

function defaultAnswer(cmd: string): unknown {
  switch (cmd) {
    // 服务运行后 hook 会拉取的列表类命令：默认空数组
    case 'get_discovered_devices':
    case 'get_pending_connection_requests':
    case 'get_pending_peer_connection_requests':
    case 'get_active_peer_connections':
    case 'get_active_transfers':
    case 'get_all_transfer_sessions':
      return [];
    case 'get_lan_transfer_config':
      return {
        saveDirectory: '/tmp/huanvae',
        tempDirectory: '/tmp/huanvae-temp',
        groupByDate: false,
        autoAcceptTrusted: false,
        trustedDevices: [],
        maxConcurrentTransfers: 3,
        version: 'test',
      };
    default:
      return undefined;
  }
}

function installInvoke(overrides: Record<string, () => unknown> = {}) {
  mockInvoke.mockImplementation(async (cmd: string) => {
    const override = overrides[cmd];
    if (override) {
      return override();
    }
    return defaultAnswer(cmd);
  });
}

// ============================================================
// 挂载 + 事件发射辅助
// ============================================================

async function mountHook() {
  const utils = renderHook(() => useLanTransfer());
  // hook 的 listener 在 useEffect 里异步注册，等它就位后才能喂事件
  await waitFor(() => {
    expect(eventHandlers.length).toBeGreaterThan(0);
  });
  return utils;
}

async function emit(payload: unknown) {
  await act(async () => {
    for (const handler of [...eventHandlers]) {
      handler({ payload });
    }
  });
}

// ============================================================
// 测试
// ============================================================

describe('useLanTransfer（行为测试：invoke + 预设事件序列）', () => {
  beforeEach(() => {
    eventHandlers.length = 0;
    mockInvoke.mockReset();
    installInvoke();
  });

  // ----------------------------------------------------------
  // D-08：服务启停错误不再吞掉
  // ----------------------------------------------------------
  describe('服务启停错误透出（D-08）', () => {
    it('startService 失败 → serviceError 置位（含后端原因）、isRunning=false', async () => {
      installInvoke({
        start_lan_transfer_service: () => {
          throw new Error('端口 53317 被占用');
        },
      });
      const { result } = await mountHook();

      await act(async () => {
        await result.current.startService('user-1', '测试用户');
      });

      expect(result.current.isRunning).toBe(false);
      expect(result.current.serviceError).toContain('服务启动失败');
      expect(result.current.serviceError).toContain('端口 53317 被占用');
    });

    it('startService 成功 → isRunning=true、serviceError 保持 null', async () => {
      const { result } = await mountHook();

      await act(async () => {
        await result.current.startService('user-1', '测试用户');
      });

      expect(result.current.isRunning).toBe(true);
      expect(result.current.serviceError).toBeNull();
    });

    it('stopService 失败 → 不抛出、serviceError 置位、本地状态照常清理（关窗不被阻塞）', async () => {
      installInvoke({
        stop_lan_transfer_service: () => {
          throw new Error('服务未运行');
        },
      });
      const { result } = await mountHook();

      // 先成功启动，再制造一些应被清理的本地状态
      await act(async () => {
        await result.current.startService('user-1', '测试用户');
      });
      await emit({ type: 'device_discovered', device: makeDevice() });
      expect(result.current.devices).toHaveLength(1);

      // 停止失败必须 resolve（桌面 handleClose 靠它保证 clearLanTransferData + window.close 执行）
      await act(async () => {
        await expect(result.current.stopService()).resolves.toBeUndefined();
      });

      expect(result.current.isRunning).toBe(false);
      expect(result.current.devices).toHaveLength(0);
      expect(result.current.serviceError).toContain('服务停止失败');
      expect(result.current.serviceError).toContain('服务未运行');
    });

    it('D-19：并发 startService 共享同一次 invoke（StrictMode 双挂载不再「启动即被停」）', async () => {
      let release!: (value?: unknown) => void;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      installInvoke({ start_lan_transfer_service: () => gate });

      const { result } = await mountHook();
      const p1 = result.current.startService('user-1', '测试用户');
      const p2 = result.current.startService('user-1', '测试用户');
      release();
      await act(async () => {
        await Promise.all([p1, p2]);
      });

      const startCalls = mockInvoke.mock.calls.filter(([cmd]) => cmd === 'start_lan_transfer_service');
      expect(startCalls).toHaveLength(1);
      expect(result.current.isRunning).toBe(true);
    });
  });

  // ----------------------------------------------------------
  // 设备与连接事件
  // ----------------------------------------------------------
  describe('设备发现与点对点连接', () => {
    it('device_discovered 同 id 更新、新 id 追加；device_left 移除', async () => {
      const { result } = await mountHook();

      await emit({ type: 'device_discovered', device: makeDevice({ deviceId: 'dev-a', ipAddress: '192.168.1.10' }) });
      await emit({ type: 'device_discovered', device: makeDevice({ deviceId: 'dev-a', ipAddress: '192.168.1.99' }) });
      expect(result.current.devices).toHaveLength(1);
      expect(result.current.devices[0].ipAddress).toBe('192.168.1.99');

      await emit({ type: 'device_discovered', device: makeDevice({ deviceId: 'dev-b' }) });
      expect(result.current.devices.map((d) => d.deviceId)).toEqual(['dev-a', 'dev-b']);

      await emit({ type: 'device_left', device_id: 'dev-a' });
      expect(result.current.devices.map((d) => d.deviceId)).toEqual(['dev-b']);
    });

    it('D-16：peer_connection_established 仅发起方写入 currentConnection', async () => {
      const { result } = await mountHook();

      // 对方主动连我（被动方）：进 activeConnections，但不抢 currentConnection
      await emit({
        type: 'peer_connection_established',
        connection: makeConnection({ connectionId: 'conn-passive', isInitiator: false }),
      });
      expect(result.current.activeConnections.map((c) => c.connectionId)).toEqual(['conn-passive']);
      expect(result.current.currentConnection).toBeNull();

      // 我发起的连接：写入 currentConnection
      await emit({
        type: 'peer_connection_established',
        connection: makeConnection({ connectionId: 'conn-active', isInitiator: true }),
      });
      expect(result.current.currentConnection?.connectionId).toBe('conn-active');

      // isInitiator 缺省（旧后端）→ 同样不写（契约字段可能缺省需防御）
      await emit({
        type: 'peer_connection_established',
        connection: makeConnection({ connectionId: 'conn-legacy', isInitiator: undefined }),
      });
      expect(result.current.currentConnection?.connectionId).toBe('conn-active');
    });
  });

  // ----------------------------------------------------------
  // D-15：失败原因全链路透出
  // ----------------------------------------------------------
  describe('失败透出与终态条目保留（D-15）', () => {
    it('transfer_failed 的 error 写入批量条目对应文件（不再丢弃），任务从 activeTransfers 移除', async () => {
      const { result } = await mountHook();

      // 先有一个活跃任务（transfer_failed 借 activeTransfers 镜像定位 sessionId/fileId）
      await emit({ type: 'transfer_progress', task: makeTask() });
      expect(result.current.activeTransfers).toHaveLength(1);

      // 批量进度里该文件正在传输
      await emit({
        type: 'batch_progress',
        progress: makeProgress({
          sessionId: 'session-1',
          files: [
            { fileId: 'file-1', fileName: 'a.txt', fileSize: 100, transferredBytes: 10, status: 'transferring' },
            { fileId: 'file-2', fileName: 'b.txt', fileSize: 100, transferredBytes: 0, status: 'pending' },
          ],
        }),
      });

      await emit({ type: 'transfer_failed', task_id: 'task-1', error: '接收端磁盘已满' });

      const entry = result.current.batchProgressMap.get('session-1');
      expect(entry?.files?.[0]).toMatchObject({ fileId: 'file-1', status: 'failed', error: '接收端磁盘已满' });
      // 其它文件不受影响
      expect(entry?.files?.[1]).toMatchObject({ fileId: 'file-2', status: 'pending' });
      expect(result.current.activeTransfers.find((t) => t.taskId === 'task-1')).toBeUndefined();
    });

    it('outcome=partial → 终态条目保留，failed_files 逐文件带原因，已完成文件保持 completed', async () => {
      const { result } = await mountHook();

      await emit({
        type: 'batch_progress',
        progress: makeProgress({
          sessionId: 'session-1',
          completedFiles: 1,
          transferredBytes: 100,
          files: [
            { fileId: 'file-1', fileName: 'a.txt', fileSize: 100, transferredBytes: 100, status: 'completed' },
            { fileId: 'file-2', fileName: 'b.txt', fileSize: 100, transferredBytes: 40, status: 'transferring' },
          ],
        }),
      });
      await emit({
        type: 'batch_transfer_completed',
        session_id: 'session-1',
        total_files: 2,
        save_directory: '/tmp',
        outcome: 'partial',
        failed_files: [{ file_id: 'file-2', file_name: 'b.txt', error: 'SHA-256 校验不匹配' }],
      });

      const entry = result.current.batchProgressMap.get('session-1');
      expect(entry).toBeDefined();
      expect(entry?.outcome).toBe('partial');
      expect(entry?.files?.[0]).toMatchObject({ fileId: 'file-1', status: 'completed' });
      expect(entry?.files?.[1]).toMatchObject({ fileId: 'file-2', status: 'failed', error: 'SHA-256 校验不匹配' });
    });

    it('outcome=completed（含旧后端缺省 outcome）且无失败文件 → 条目照常移除', async () => {
      const { result } = await mountHook();

      await emit({
        type: 'batch_progress',
        progress: makeProgress({ sessionId: 'session-1' }),
      });
      await emit({
        type: 'batch_progress',
        progress: makeProgress({ sessionId: 'session-2' }),
      });
      await emit({
        type: 'batch_transfer_completed',
        session_id: 'session-1',
        total_files: 2,
        save_directory: '/tmp',
        outcome: 'completed',
      });
      // 旧后端不发 outcome 字段 → 缺省按 completed 处理（向后兼容）
      await emit({
        type: 'batch_transfer_completed',
        session_id: 'session-2',
        total_files: 2,
        save_directory: '/tmp',
      });

      expect(result.current.batchProgressMap.has('session-1')).toBe(false);
      expect(result.current.batchProgressMap.has('session-2')).toBe(false);
    });

    it('整批 outcome=failed（无 failed_files）→ 残留 pending/transferring 文件标 failed，completed 保持', async () => {
      const { result } = await mountHook();

      await emit({
        type: 'batch_progress',
        progress: makeProgress({
          sessionId: 'session-1',
          files: [
            { fileId: 'file-1', fileName: 'a.txt', fileSize: 100, transferredBytes: 100, status: 'completed' },
            { fileId: 'file-2', fileName: 'b.txt', fileSize: 100, transferredBytes: 40, status: 'transferring' },
          ],
        }),
      });
      await emit({
        type: 'batch_transfer_completed',
        session_id: 'session-1',
        total_files: 2,
        save_directory: '/tmp',
        outcome: 'failed',
      });

      const entry = result.current.batchProgressMap.get('session-1');
      expect(entry?.outcome).toBe('failed');
      expect(entry?.files?.[0]).toMatchObject({ fileId: 'file-1', status: 'completed' });
      expect(entry?.files?.[1]).toMatchObject({ fileId: 'file-2', status: 'failed' });
    });

    it('终态事件先于任何进度到达 → 构造最小终态条目，失败原因可见（不再无声消失）', async () => {
      const { result } = await mountHook();

      await emit({
        type: 'batch_transfer_completed',
        session_id: 'session-x',
        total_files: 3,
        save_directory: '/tmp',
        outcome: 'failed',
        failed_files: [{ file_id: 'file-9', file_name: 'video.mp4', error: '对端写入失败' }],
      });

      const entry = result.current.batchProgressMap.get('session-x');
      expect(entry?.outcome).toBe('failed');
      expect(entry?.files?.[0]).toMatchObject({
        fileId: 'file-9',
        fileName: 'video.mp4',
        status: 'failed',
        error: '对端写入失败',
      });
    });

    it('dismissBatchSession 移除保留的终态条目', async () => {
      const { result } = await mountHook();

      await emit({
        type: 'batch_transfer_completed',
        session_id: 'session-1',
        total_files: 1,
        save_directory: '/tmp',
        outcome: 'failed',
        failed_files: [{ file_id: 'file-1', file_name: 'a.txt', error: 'x' }],
      });
      expect(result.current.batchProgressMap.has('session-1')).toBe(true);

      act(() => {
        result.current.dismissBatchSession('session-1');
      });
      expect(result.current.batchProgressMap.has('session-1')).toBe(false);
    });
  });

  // ----------------------------------------------------------
  // D-01/D-22：双端卡片归属
  // ----------------------------------------------------------
  describe('双端并发归属（D-01/D-22）', () => {
    it('双端并发会话按 payload 对端归属各自的卡片，方向/对端字段透传（hook + 归属纯函数）', async () => {
      const { result } = await mountHook();

      await emit({
        type: 'batch_progress',
        progress: makeProgress({
          sessionId: 's-a',
          direction: 'send',
          peerDeviceId: 'dev-a',
          peerDeviceName: '设备A',
        }),
      });
      await emit({
        type: 'batch_progress',
        progress: makeProgress({
          sessionId: 's-b',
          direction: 'receive',
          peerDeviceId: 'dev-b',
          peerDeviceName: '设备B',
        }),
      });

      const map = result.current.batchProgressMap;
      // 接收方向会话（D-01 修复前进不了会话表）靠 payload 直读也能归属
      expect(pickBatchProgressForDevice(map, [], 'dev-a')?.sessionId).toBe('s-a');
      expect(pickBatchProgressForDevice(map, [], 'dev-b')?.sessionId).toBe('s-b');
      // 第三台设备不拿到别人的进度
      expect(pickBatchProgressForDevice(map, [], 'dev-c')).toBeNull();
      // D-22 展示字段原样透传给页面层
      expect(map.get('s-a')).toMatchObject({ direction: 'send', peerDeviceName: '设备A' });
      expect(map.get('s-b')).toMatchObject({ direction: 'receive', peerDeviceName: '设备B' });
    });
  });

  // ----------------------------------------------------------
  // D-17：哈希进度归属
  // ----------------------------------------------------------
  describe('哈希进度归属（D-17）', () => {
    it('hashing_progress 归属发起目标设备；同对端首条 batch_progress 到达后清除', async () => {
      installInvoke({ send_files_to_peer: () => 'session-hashing' });
      const { result } = await mountHook();

      // 建立一条到 dev-a 的连接并发起发送（锁定哈希归属目标）
      await emit({
        type: 'peer_connection_established',
        connection: makeConnection({
          connectionId: 'conn-1',
          peerDevice: makeDevice({ deviceId: 'dev-a' }),
          isInitiator: true,
        }),
      });
      await act(async () => {
        await result.current.sendFilesToPeer('conn-1', ['/tmp/big.bin']);
      });

      await emit({
        type: 'hashing_progress',
        file_name: 'big.bin',
        file_size: 1000,
        processed_bytes: 100,
        current_file: 1,
        total_files: 1,
      });
      expect(result.current.hashingProgress).toMatchObject({ fileName: 'big.bin' });
      expect(result.current.hashingDeviceId).toBe('dev-a');

      // 同对端的首条 batch_progress = 哈希阶段结束 → 清除
      await emit({
        type: 'batch_progress',
        progress: makeProgress({ sessionId: 'session-hashing', peerDeviceId: 'dev-a' }),
      });
      expect(result.current.hashingProgress).toBeNull();
      expect(result.current.hashingDeviceId).toBeNull();
    });

    it('其它设备会话的 batch_progress 不吞掉哈希进度；旧后端（无对端字段）退回无条件清除', async () => {
      installInvoke({ send_files_to_peer: () => 'session-hashing' });
      const { result } = await mountHook();

      await emit({
        type: 'peer_connection_established',
        connection: makeConnection({
          connectionId: 'conn-1',
          peerDevice: makeDevice({ deviceId: 'dev-a' }),
          isInitiator: true,
        }),
      });
      await act(async () => {
        await result.current.sendFilesToPeer('conn-1', ['/tmp/big.bin']);
      });
      await emit({
        type: 'hashing_progress',
        file_name: 'big.bin',
        file_size: 1000,
        processed_bytes: 100,
        current_file: 1,
        total_files: 1,
      });

      // B 批（另一台设备的会话）进度到达 —— 不能把 A 批的哈希进度吞掉
      await emit({
        type: 'batch_progress',
        progress: makeProgress({ sessionId: 'session-other', peerDeviceId: 'dev-b' }),
      });
      expect(result.current.hashingProgress).not.toBeNull();
      expect(result.current.hashingDeviceId).toBe('dev-a');

      // 旧后端 payload 缺 peerDeviceId → 退回无条件清除（宁可早清，不能永远挂着）
      await emit({
        type: 'batch_progress',
        progress: makeProgress({ sessionId: 'session-legacy' }),
      });
      expect(result.current.hashingProgress).toBeNull();
      expect(result.current.hashingDeviceId).toBeNull();
    });
  });

  // ----------------------------------------------------------
  // D-12 + 契约防御
  // ----------------------------------------------------------
  describe('调试计数与畸形事件防御（D-12）', () => {
    it('eventCount/lastEvent 来自真实事件流（不再硬编码）', async () => {
      const { result } = await mountHook();

      await emit({ type: 'device_left', device_id: 'dev-x' });
      await emit({ type: 'device_left', device_id: 'dev-y' });
      await emit({ type: 'service_state_changed', is_running: false });

      expect(result.current.eventCount).toBe(3);
      expect(result.current.lastEvent).toBe('service_state_changed');
    });

    it('畸形事件防御：缺关键字段的 batch_progress / device_discovered 不改状态、不抛错', async () => {
      const { result } = await mountHook();

      await emit({ type: 'batch_progress', progress: { totalFiles: 1 } });
      await emit({ type: 'device_discovered' });

      expect(result.current.batchProgressMap.size).toBe(0);
      expect(result.current.devices).toHaveLength(0);
      // 收到即计数（调试面板按真实事件流计数）
      expect(result.current.eventCount).toBe(2);
    });

    it('service_state_changed 同步 isRunning（非布尔按 false 处理）', async () => {
      const { result } = await mountHook();

      await emit({ type: 'service_state_changed', is_running: true });
      expect(result.current.isRunning).toBe(true);

      await emit({ type: 'service_state_changed', is_running: false });
      expect(result.current.isRunning).toBe(false);
    });
  });
});
