/**
 * 批量传输卡片的展示纯逻辑（D-22 方向/对端标识 + D-23 文件计数推导）
 *
 * @module lanTransfer/batchDisplay
 * @location src/lanTransfer/batchDisplay.ts
 *
 * 抽成纯函数的原因与 batchProgressAttribution 相同：页面本体依赖 Tauri invoke，
 * 只有纯逻辑才能被单测直接钉住。
 *
 * - D-22：批量卡片此前只显示「批量传输 #1/#2」，用户分不清哪张卡是收、哪张是发。
 *   方向与对端名优先用 payload 直读（`direction` / `peerDeviceName`，可能缺省），
 *   回退会话表（`TransferSession.direction` / `targetDevice.deviceName`）。
 * - D-23：后端 `completed_files` 会把 Cancelled 也计进去（「3/3 文件」而进度条不满，
 *   自相矛盾），头部计数改为由 files 数组状态推导：completed 计 completed，cancelled
 *   单列，不再直接信任后端计数。
 */

import type { BatchProgressOwnership, SessionOwnership } from './batchProgressAttribution';

/** 计数推导接受的文件条目最小形状 */
export interface FileCountInput {
  status: string;
}

export interface DerivedFileCounts {
  completed: number;
  failed: number;
  cancelled: number;
  /** 仍在排队/传输中（pending + transferring） */
  active: number;
  total: number;
}

/**
 * 由 files 数组状态推导头部计数（D-23）
 *
 * `files` 缺省时返回全 0（调用方此时本就不该渲染「x/y 文件」）。
 */
export function deriveFileCounts(files?: ReadonlyArray<FileCountInput> | null): DerivedFileCounts {
  const counts: DerivedFileCounts = { completed: 0, failed: 0, cancelled: 0, active: 0, total: 0 };
  if (!files) {
    return counts;
  }
  for (const file of files) {
    counts.total += 1;
    switch (file.status) {
      case 'completed':
        counts.completed += 1;
        break;
      case 'failed':
        counts.failed += 1;
        break;
      case 'cancelled':
        counts.cancelled += 1;
        break;
      default:
        counts.active += 1;
        break;
    }
  }
  return counts;
}

export interface BatchDirectionMeta {
  direction: 'send' | 'receive' | null;
  peerName: string | null;
}

/**
 * 批量卡片的方向 + 对端名（D-22）
 *
 * 优先 payload 直读（`direction` / `peerDeviceName`），缺省字段回退会话表；
 * 两边都拿不到时相应字段为 null（调用方回退「批量传输」这类无方向文案）。
 */
export function describeBatchDirection<P extends BatchProgressOwnership>(
  progress: P,
  sessions: readonly SessionOwnership[],
): BatchDirectionMeta {
  let direction = progress.direction ?? null;
  let peerName = progress.peerDeviceName ?? null;
  if (!direction || !peerName) {
    const session = sessions.find((s) => s.sessionId === progress.sessionId);
    if (session) {
      if (!direction) {
        direction = session.direction ?? null;
      }
      if (!peerName) {
        peerName = session.targetDevice.deviceName ?? null;
      }
    }
  }
  return { direction, peerName };
}

/**
 * 卡片标题（D-22）：「发送给/接收自 {对端}」；有方向但对端名缺省时退化为「发送文件/接收文件」，
 * 完全无方向时回退 fallback（移动端平铺卡片用「批量传输」）。
 */
export function formatBatchCardTitle(meta: BatchDirectionMeta, fallback = '批量传输'): string {
  if (meta.direction === 'send') {
    return meta.peerName ? `发送给 ${meta.peerName}` : '发送文件';
  }
  if (meta.direction === 'receive') {
    return meta.peerName ? `接收自 ${meta.peerName}` : '接收文件';
  }
  return fallback;
}

export interface BatchOutcomeInfo {
  label: string;
  className: string;
}

/** 终态徽标文案/样式；非终态（undefined）返回 null */
export function describeBatchOutcome(outcome?: string): BatchOutcomeInfo | null {
  switch (outcome) {
    case 'completed':
      return { label: '已完成', className: 'completed' };
    case 'partial':
      return { label: '部分失败', className: 'failed' };
    case 'failed':
      return { label: '失败', className: 'failed' };
    case 'cancelled':
      return { label: '已取消', className: 'cancelled' };
    default:
      return null;
  }
}

/** 整批失败横幅文案（D-15）：失败原因不再无声消失 */
export function describeBatchFailure(progress: { files?: ReadonlyArray<FileCountInput> | null }): string {
  const counts = deriveFileCounts(progress.files);
  if (counts.failed > 0) {
    return `批量传输失败：${counts.failed}/${counts.total} 个文件失败`;
  }
  return '批量传输失败';
}
