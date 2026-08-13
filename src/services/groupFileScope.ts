/**
 * 群文件预签名 `related_id`（= 发起本次访问的群 ID）的**唯一**解析点
 *
 * ## 为什么需要它
 *
 * 后端 2026-08-13 起把 `related_id` 列为群文件预签名两个端点的**必填**字段
 * （`POST /api/storage/group_file/{uuid}/presigned_url` 与 `.../presigned_url/extended`），
 * 缺失或非 UUID 形态一律 400、**不做兼容**（不退回旧的「存在于任一你所在的群即放行」判法）。
 * 契约见 backend-docs/storage/文件存储管理.md「群文件预签名 URL」，真值源是后端
 * `src/storage/models/request.rs` 的 `PresignedUrlRequest.related_id`。
 *
 * ## 为什么真值源取 `chatStore.chatTarget` 而不是沿 prop 链传
 *
 * 群文件的取源点分散在气泡（FileMessageContent / AlbumMessage / DocumentDownloadAction）、
 * 会话内查找命中项（ConversationSearchHit）等多处，它们共同的入口是 `useFileCache`
 * → `services/fileCache.getPresignedUrl`。往那条 prop 链上再加一个 `groupId` 会在
 * 四五个组件的 props interface 上各开一个口子，每个口子都能漏（漏了的症状和没改一样：
 * 静默 400）。而「当前打开的会话是哪个群」在本仓**本来就有唯一真值源** ——
 * `chatStore.chatTarget`（`{ type: 'group'; data: Group }`）：
 *
 * - 群消息气泡只在该群会话打开时渲染；
 * - 会话内查找面板挂在该会话的 ChatMenu 里（`getSearchConversationId` 同样从
 *   `chatTarget` 解析 conversation_id，且群聊的 conversation_id 就是 group_id
 *   —— 见 components/search/conversationSearchTarget.ts 文件头）。
 *
 * 所以这里读同一份真值源，请求体的构造点因此只有一处、不会各处漏写。
 *
 * ## 独立预览窗（`/media`）为什么不能直接调它
 *
 * 那是另一个 webview、另一个 JS 上下文，`chatStore` 是空的。它的群 ID 由主窗口侧的
 * `openMediaWindow`（media/api.ts）在 handoff 时调本函数解析并写进 localStorage 载荷，
 * 预览窗只消费不解析。两处加起来就是全部解析点。
 */

import { useChatStore } from '../stores/chatStore';

/**
 * 当前会话若是群聊，返回它的 group_id；否则 null。
 *
 * 返回 null 不代表「可以不带」—— 调用方要在真的要发群文件预签名请求时把 null
 * 当成错误（本仓两处调用方：fileCache.getPresignedUrl 直接抛错；
 * media/MediaPreviewPage 在真要请求时抛错）。这里不抛，是因为 handoff 场景
 * （本地文件预览）拿不到群 ID 也不影响功能，不该在那里炸。
 */
export function resolveGroupFileRelatedId(): string | null {
  const target = useChatStore.getState().chatTarget;
  return target?.type === 'group' ? target.data.group_id : null;
}
