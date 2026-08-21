/**
 * 批量传输进度 → 设备 的归属纯逻辑
 *
 * @module lanTransfer/batchProgressAttribution
 * @location src/lanTransfer/batchProgressAttribution.ts
 *
 * `batchProgressMap` 的 key 是 **sessionId**，而设备卡片要按 **deviceId** 取进度，
 * 两者之间唯一的桥是 `TransferSession.targetDevice.deviceId`（`get_all_transfer_sessions`
 * 下发的会话表）。
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
  targetDevice: { deviceId: string };
}

/**
 * 取属于 `deviceId` 的批量传输进度
 *
 * @param batchProgressMap key = sessionId
 * @param sessions 当前已知的传输会话（sessionId → 对端设备）
 * @param deviceId 目标设备
 * @returns 命中的进度；无归属会话时 `null`（**不猜**：宁可这一帧不显示，也不把 A 的进度画到 B 上）
 */
export function pickBatchProgressForDevice<P>(
  batchProgressMap: ReadonlyMap<string, P>,
  sessions: readonly SessionOwnership[],
  deviceId: string,
): P | null {
  for (const [sessionId, progress] of batchProgressMap) {
    const session = sessions.find((s) => s.sessionId === sessionId);
    if (session && session.targetDevice.deviceId === deviceId) {
      return progress;
    }
  }
  return null;
}
