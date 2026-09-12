/**
 * 批量传输进度 / 哈希进度 → 设备 的归属纯逻辑
 *
 * @module lanTransfer/batchProgressAttribution
 * @location src/lanTransfer/batchProgressAttribution.ts
 *
 * `batchProgressMap` 的 key 是 **sessionId**，而设备卡片要按 **deviceId** 取进度，
 * 两者之间原本唯一的桥是 `TransferSession.targetDevice.deviceId`（`get_all_transfer_sessions`
 * 下发的会话表）。Rust 侧已在 `batch_progress` payload 里增补 `direction` /
 * `peer_device_id` / `peer_device_name`（向后兼容，可能缺省）—— payload 直读是比会话表
 * 更权威、更及时的归属依据（接收方向会话 D-01 修复前进不了会话表；会话表补拉还有延迟）。
 *
 * 🔴 **为什么单独抽出来**：原实现写成
 * `for (const [_sessionId, progress] of map) { if (activeConnections.length === 1) return progress; }`
 * —— 循环体判的是**循环外的常量**，与迭代变量无关：
 *   · 连着 ≥2 台设备时跑满整个 Map 必然 `return null` ⇒ **所有**设备卡片的文件列表 /
 *     总体进度条 / 「取消全部」按钮同时消失（`batchProgress` 是它们唯一的数据源）；
 *   · 恰好 1 台时无条件返回 Map 里的第一个 entry，不做任何归属校验，只是碰巧只有一个会话
 *     所以看起来是对的。
 * 归属是纯数据变换，抽成纯函数才能被单测直接钉住（页面本体依赖 Tauri invoke，测不动）。
 */

/** 归属判定需要的会话最小形状（避免把整个 TransferSession 拖进纯逻辑层） */
export interface SessionOwnership {
  sessionId: string;
  targetDevice: { deviceId: string; deviceName?: string };
  direction?: 'send' | 'receive';
}

/** 归属判定需要的批量进度最小形状（payload 增补字段全部可能缺省） */
export interface BatchProgressOwnership {
  sessionId: string;
  direction?: 'send' | 'receive';
  peerDeviceId?: string;
  peerDeviceName?: string;
}

/**
 * 取属于 `deviceId` 的批量传输进度
 *
 * 归属优先级：
 * 1. **payload 直读**：`progress.peerDeviceId === deviceId`（Rust 增补字段，最权威）；
 * 2. **会话表回退**：sessionId 在会话表里能找到 `targetDevice.deviceId === deviceId`。
 *    带 payload 对端的条目**永不**落回会话表归属给第二台设备——会话表可能过时，
 *    双重归属会把同一批进度画到两张卡片上。
 *
 * @param batchProgressMap key = sessionId
 * @param sessions 当前已知的传输会话（sessionId → 对端设备）
 * @param deviceId 目标设备
 * @returns 命中的进度；无归属会话时 `null`（**不猜**：宁可这一帧不显示，也不把 A 的进度画到 B 上）
 */
export function pickBatchProgressForDevice<P extends BatchProgressOwnership>(
  batchProgressMap: ReadonlyMap<string, P>,
  sessions: readonly SessionOwnership[],
  deviceId: string,
): P | null {
  // 单趟扫描：有明确对端的条目只走 payload 直读；无对端条目（旧后端）走会话表回退
  for (const progress of batchProgressMap.values()) {
    if (progress.peerDeviceId !== undefined && progress.peerDeviceId !== null) {
      // 1) payload 直读：明确对端是最权威的归属依据
      if (progress.peerDeviceId === deviceId) {
        return progress;
      }
      // 对端不是本设备：即使会话表命中也不归它（防会话表过时导致双重归属）
      continue;
    }
    // 2) 会话表回退（peerDeviceId 缺省，旧后端 payload）
    const session = sessions.find((s) => s.sessionId === progress.sessionId);
    if (session && session.targetDevice.deviceId === deviceId) {
      return progress;
    }
  }
  return null;
}

/** 哈希进度归属判定需要的最小形状 */
export interface HashingProgressLike {
  fileName: string;
}

/** 哈希归属判定需要的会话最小形状（会话文件列表里能拿到文件名即可） */
export interface HashingSessionLike extends SessionOwnership {
  files?: ReadonlyArray<{ file?: { fileName?: string } }>;
}

/**
 * 解析当前哈希进度归属的设备（D-17：哈希进度是全局单例事件，不得广播到所有设备卡片）
 *
 * 归属优先级：
 * 1. **显式目标**：`sendFilesToPeer` 发起时按连接锁定的设备 —— 哈希阶段先于会话落表，
 *   会话表那时还查不到这次发送，只有它可靠；
 * 2. **会话表回退**：按正在哈希的文件名匹配会话文件列表 → 该会话的目标设备。
 *
 * @returns 归属的 deviceId；无法归属时 `null`（UI 据此不渲染，而不是画到每张卡片上）
 */
export function resolveHashingTargetDevice(
  hashing: HashingProgressLike | null | undefined,
  sessions: readonly HashingSessionLike[],
  explicitDeviceId: string | null | undefined,
): string | null {
  if (!hashing?.fileName) {
    return null;
  }
  if (explicitDeviceId) {
    return explicitDeviceId;
  }
  for (const session of sessions) {
    const hit = (session.files ?? []).some((f) => f?.file?.fileName === hashing.fileName);
    if (hit) {
      return session.targetDevice.deviceId;
    }
  }
  return null;
}
