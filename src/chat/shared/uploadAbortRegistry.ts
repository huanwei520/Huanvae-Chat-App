/**
 * 在途上传的 AbortController 注册表 —— **模块级**，全仓唯一一份
 *
 * @module chat/shared
 * @location src/chat/shared/uploadAbortRegistry.ts
 *
 * ## 为什么必须是模块级（这正是它要修的缺陷）
 *
 * 这张表原先是 {@link import('./useComposerTrayOutbox').useComposerTrayOutbox} 的
 * **实例内 `useRef`**。而「取消」的按钮长在消息气泡里，走的是
 * {@link import('./sendingMediaActions').cancelSendingItem} 这条**模块级**入口 ——
 * 它够不着任何 hook 实例的 ref，于是 `abort()` **必然是 no-op**：
 * 用户点了取消，条目从队列摘掉、UI 立刻消失，**而那个 HTTP 上传照样跑完，
 * 并且可能落库成一条真实消息** ⇒ 点了取消，消息照样出现。这是正确性缺陷，不是体验问题。
 *
 * 提成模块级之后，「谁在传」与「谁按了取消」终于指向同一张表。
 * 这张表本来也只该有一份 —— 泵（串行闸）同样只允许有一个实例，
 * 由 tests/unit/sendingOverlayWiring.test.ts C 组守着。
 *
 * ## 生命周期（登记与注销必须成对，否则表会无限长大）
 *
 * 登记：`uploadOne` 真正开始传那一刻（`markUploading` 之前）。
 * 注销：同一个 `uploadOne` 的 `finally`（成功 / 失败 / 取消三条路都会走到）。
 *
 * ## 🔴 abort 追不回什么（如实记账，别声称"取消 = 一定不落库"）
 *
 * `signal` 的检查粒度是**分片边界**（见 `useFileUpload` 的 `UploadRequestParams.signal`）：
 * 秒传命中、或单分片的小文件，可能在两个检查点之间就把 `upload/confirm` 跑完了 ——
 * 那一刻**服务端的消息已经建好**，abort 追不回来。
 * 能做到的是：本机不再写这条消息进本地库（`uploadOne` 在 persist 前再判一次
 * `signal.aborted`），以及后续分片不再继续上传。
 */

/** clientId → 该项在途上传的控制器。只在 uploadOne 的生命周期内存在。 */
const controllers = new Map<string, AbortController>();

/** 开始上传某一项时登记它的控制器（同一 clientId 重传会覆盖旧的，旧的此时已注销）。 */
export function registerUploadAbort(clientId: string, controller: AbortController): void {
  controllers.set(clientId, controller);
}

/** 该项的上传已结束（成功 / 失败 / 取消都算），把它从表里摘掉。 */
export function releaseUploadAbort(clientId: string): void {
  controllers.delete(clientId);
}

/**
 * 中断某一项在途的上传。
 *
 * @returns 是否**真的**有一个在途上传被打断。`false` = 那一项此刻不在传
 *          （还在 pending 排队 / 已经传完）—— 调用方据此如实记账，不要把它当成"已中断"。
 */
export function abortUpload(clientId: string): boolean {
  const controller = controllers.get(clientId);
  if (!controller) {
    return false;
  }
  controller.abort();
  return true;
}
