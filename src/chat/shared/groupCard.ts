/**
 * 群名片（`message_type: 'group_card'`）的内容编解码 —— 封闭 schema 的唯一出入口
 *
 * @location src/chat/shared/groupCard.ts
 *
 * 契约真值源：`backend-docs/groups/群聊管理.md` §八「1. 分享群卡片」
 * （后端实现 `Huanvae-Chat-Rust/src/friends_messages/services/card_schema.rs`
 * 的 `validate_group_card_content`）。三条硬约束，任意一条不满足后端一律 **400**：
 *
 * 1. `message_content` 必须是合法 JSON，且根是**对象**
 * 2. 对象**有且仅有 `group_id` 一个键**（多一个键就 400 —— 所以群名/头像/人数**不许**塞进来）
 * 3. `group_id` 必须是合法 UUID 字符串，整体不超过 256 字节
 *
 * 之所以不让卡片自带展示字段（后端明写的两条理由）：**防伪造**（消息体由发送方构造，
 * 服务端无从校验里面的群名属实 ⇒ 允许携带等于允许发「写着 A 群名、点进去是 B 群」的钓鱼卡）、
 * **防过期**（快照写死在历史消息里，群改名/换头像后永远显示旧值且无法修复）。
 * ⇒ 展示字段由接收端凭 `group_id` 现拉 `GET /api/groups/{id}/public`。
 *
 * 🔴 构造一律走 `buildGroupCardContent`，**不要在调用点手写 `JSON.stringify({...})`** ——
 * 手写就等于把「只许一个键」这条约束散落到每个发送点，哪天有人顺手多塞一个 group_name
 * 就是线上 400，而且 TS 不会拦。`tests/unit/groupCard.test.ts` 对本函数有反向断言
 * （产出的 JSON **只能**有一个键）。
 */

import type { GroupCardPayload } from '../../types/chat';

/** 会话列表 / 通知 / 引用块里群名片的统一预览文案（四处共用一个常量，避免各写各的） */
export const GROUP_CARD_PREVIEW_TEXT = '[群名片]';

/**
 * 把群 id 编成 `message_content`。
 *
 * 显式构造 `GroupCardPayload` 而不是接一个宽对象：多余的键在这里就进不来。
 */
export function buildGroupCardContent(groupId: string): string {
  const payload: GroupCardPayload = { group_id: groupId };
  return JSON.stringify(payload);
}

/**
 * 从 `message_content` 解出群 id；**任何**不合形态一律返回 `null`（调用方据此渲染失效态）。
 *
 * 不合形态包含：非法 JSON / 根不是对象（含数组与 `null`）/ 缺 `group_id` /
 * `group_id` 不是字符串 / 是空白串。这里**不校验 UUID 格式** —— 格式判定是服务端的事，
 * 客户端拿着一个非 UUID 的 id 去打 `/public` 只会得到 404，照样落进失效态，
 * 再加一层本地正则只会多一处与服务端漂移的判据。
 */
export function parseGroupCardContent(content: string): string | null {
  let root: unknown;
  try {
    root = JSON.parse(content);
  } catch {
    return null;
  }
  if (typeof root !== 'object' || root === null || Array.isArray(root)) {
    return null;
  }
  const groupId = (root as Record<string, unknown>).group_id;
  if (typeof groupId !== 'string' || groupId.trim() === '') {
    return null;
  }
  return groupId;
}

/**
 * 把发送群名片时的 HTTP 状态码翻成用户能据以行动的一句话。
 *
 * 三态**必须是三种不同的东西**（契约 §八「错误响应」）：
 * - `400` 客户端构造的 content 不满足封闭 schema —— 是版本/实现问题，不是用户能改的
 * - `403` 发送者在**被分享群**里的角色不满足该群 `card_share_scope`（含「根本不是该群成员」）
 * - `404` **被分享的群**不存在或已解散
 *
 * 🔴 403 的措辞必须点明是「那个群的权限」而不是网络错误 —— 否则用户会一直重试。
 * `status` 为 null（拿不到状态码，如网络层失败）时回落到服务端/异常自带的原文，
 * **不猜**成三态里的任何一个。
 */
export function describeShareGroupCardError(status: number | null, fallback: string): string {
  switch (status) {
    case 400:
      return '群名片内容不被服务器接受（客户端版本可能过旧）';
    case 403:
      return '你在该群的权限不够，无法把这个群分享出去';
    case 404:
      return '该群聊不存在或已解散，无法分享';
    default:
      return fallback;
  }
}
