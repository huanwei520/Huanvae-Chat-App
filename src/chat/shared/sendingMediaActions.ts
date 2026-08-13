/**
 * 在途发送项的「重试 / 取消」动作 —— 消息气泡侧的**唯一**入口
 *
 * @module chat/shared
 * @location src/chat/shared/sendingMediaActions.ts
 *
 * `<SendingMediaOverlay>` 需要 `onRetry` / `onCancel` 两个回调。本模块把它们做成
 * **模块级纯函数**（直接操作 store + 模块级 abort 表），气泡渲染时原样递进去即可。
 *
 * ## 🔴 为什么不在气泡里调 `useComposerTrayOutbox(conversationKey)` 拿这两个回调
 *
 * 那个 hook 的 `pumpingRef`（串行闸）是**实例内状态**，多一个实例就多一个泵：
 * 泵在 `pendingCount > 0` 时启动、各自捞"最早的 pending 项"，于是**同一批附件会被并发上传**
 * —— 而串行是刻意的：后端按到达顺序分配 seq，组内 seq 乱序会让相册在对端被拆到不相邻的位置。
 * 一个气泡列表有几十条消息 ⇒ 几十个泵。**代价远大于收益，且收益是零。**
 *
 * ## 取消真的会中断在飞的上传（本轮修好的正确性缺陷）
 *
 * 此前 AbortController 表是那个 hook 的实例内 `useRef`，本模块够不着 ⇒ `abort()` 恒为 no-op ⇒
 * **用户点了取消、UI 立刻消失，那一项的 HTTP 上传照样跑完并可能落库成一条真实消息。**
 * 现在这张表提成了模块级的 {@link import('./uploadAbortRegistry')}，两边指向同一份。
 *
 * ### 🔴 追不回来的那一段（如实记账）
 *
 * `signal` 的检查粒度是**分片边界**（`useFileUpload` 的 `UploadRequestParams.signal`）：
 * 秒传命中、或单分片的小文件，可能在两个检查点之间就把 `upload/confirm` 跑完 ——
 * **那一刻服务端的消息已经建好，abort 追不回来**（对端会看到这条消息）。
 * 本机能保证的是：不再继续传后续分片、不写本地库、不标已发
 * （`uploadOne` 在落库前再判一次 `signal.aborted`）。
 * 所以这条能力的正确表述是「**取消会中断在飞的上传，但已经完成的那一次请求追不回**」，
 * 不是「取消 100% 不会落库」。
 */

import { useSendingMediaStore } from '../../stores/sendingMediaStore';
import { abortUpload } from './uploadAbortRegistry';

/**
 * 单项重试：把 `failed` 打回 `pending`，由已经在跑的那个泵重新捞起来。
 *
 * 位置与形态都不变（store 的 `retry` 不动 `orderByConversation`、不写 `shape`）——
 * 失败那一项还在原来的位置，不会跳到列表底部。
 */
export function retrySendingItem(clientId: string): void {
  useSendingMediaStore.getState().retry(clientId);
}

/**
 * 取消一项：**先断在飞的请求，再从队列移除**（其余项的 shape 不变，相册的 count 不会跟着缩水）。
 *
 * 🔴 这两步的顺序是契约的一部分，不许调换：摘条目会让泵在下一轮捞不到它，
 * 而「中断谁」要靠 clientId 去 abort 表里找 —— 先摘后断在语义上就是"对一个已经不存在的项动手"。
 */
export function cancelSendingItem(clientId: string): void {
  abortUpload(clientId);
  useSendingMediaStore.getState().cancel(clientId);
}
