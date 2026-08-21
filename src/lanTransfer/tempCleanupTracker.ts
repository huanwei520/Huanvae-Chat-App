/**
 * Android 临时文件清理的时机判定（纯逻辑）
 *
 * @module lanTransfer/tempCleanupTracker
 * @location src/lanTransfer/tempCleanupTracker.ts
 *
 * ## 它替掉的是什么
 * 原实现是 `setTimeout(() => cleanupTempFiles(paths), 60000)` —— 注释写「传输完成后清理」，
 * 代码做的是「无条件 60 秒后清理」。Android 侧 `selectFilesForTransfer` 会把 `content://`
 * URI 复制成临时文件，**正在被传输读取的就是它们**：局域网传一个 2GB 视频远不止 60 秒，
 * 定时器到点就把源文件删掉 ⇒ 传输中断，而 catch 只 `console.warn`，用户只看到「莫名失败」。
 * 那个 setTimeout 还没有任何 cleanup —— 页面卸载后它照样在 60 秒后触发。
 *
 * ## 判定改成什么
 * 会话在 `batchProgressMap` 里**出现过、又消失了** = 这一批传完了（消失由
 * `batch_transfer_completed` 事件驱动），此时删临时文件才是安全的。
 * 「出现过」这一步不能省：会话刚建出来、第一条 batch_progress 还没到时它也不在 Map 里，
 * 用「不在 Map 里」当完成判据会**立刻**删掉正要传的文件 —— 比原来的 60 秒还糟。
 *
 * ## 页面卸载时为什么是「放弃」而不是「清理」
 * 传输由 Rust 侧承载，页面关了它还在跑。这时删源文件同样会中断传输。
 * 宁可漏掉一次临时文件清理（占点磁盘），也不能砍掉用户正在进行的传输。
 */

/** 一批待清理的临时文件 */
interface PendingBatch {
  paths: string[];
  /** 该会话是否已在进度表里出现过（没出现过就不能用「不在表里」判完成） */
  seen: boolean;
}

export interface TempCleanupTracker {
  /** 登记一批刚交给传输层的临时文件 */
  register(sessionId: string, paths: string[]): void;
  /**
   * 用当前活跃会话集合结算一次
   * @returns 本次应当清理的文件路径批次（已从待清理表里移除）
   */
  settle(activeSessionIds: ReadonlySet<string>): string[][];
  /** 放弃全部待清理项（页面卸载：传输可能还在进行，删源文件会中断它） */
  abandon(): void;
}

export function createTempCleanupTracker(): TempCleanupTracker {
  const pending = new Map<string, PendingBatch>();

  return {
    register(sessionId, paths) {
      if (paths.length === 0) {
        return;
      }
      pending.set(sessionId, { paths, seen: false });
    },

    settle(activeSessionIds) {
      const ready: string[][] = [];
      for (const [sessionId, batch] of [...pending]) {
        if (activeSessionIds.has(sessionId)) {
          batch.seen = true;
          continue;
        }
        if (batch.seen) {
          pending.delete(sessionId);
          ready.push(batch.paths);
        }
      }
      return ready;
    },

    abandon() {
      pending.clear();
    },
  };
}
