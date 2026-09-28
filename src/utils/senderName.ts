/**
 * 发送者昵称统一解析（写入侧 + 显示侧唯一收口点）
 *
 * @location src/utils/senderName.ts
 *
 * ## 病史（为什么这个模块必须存在）
 *
 * 消息落库有三条写入路径 —— 历史加载（historyService）、HTTP 增量同步（syncService）、
 * WebSocket 推送（wsHandlers.saveMessageToLocal）—— 曾各写各的三元表达式：
 *
 * - historyService 好友分支：`sender_name: null` 写死，而群分支是
 *   `msg.sender_nickname || null`，两个分支互不相认。契约事实（评审 R-1 采纳，
 *   2026-09-26 复核）：REST 好友历史接口 GET /api/messages（好友消息.md:190-320，
 *   字段表 :246-271）**不下发** sender_nickname（群历史的 GroupMessage 才有）；
 *   WS new_message 载荷（:695-753，字段表 :732）才带该字段，由 wsHandlers 直读。
 *   因此好友会话单一对端，sender_name 走「会话对方本地资料昵称回退」是正确行为
 *   （任务卡明示），仍走同一 helper（historyService profileNicknameOf）。
 *   好友 Message 类型未声明该字段，historyService.ts:162 以内联断言宽松读，
 *   src/types/chat.ts 未改（:131 是 GroupMessage 既有字段，评审 R-2 采纳）。
 *   而群分支是 `msg.sender_nickname || null`，两个分支互不相认；
 * - syncService.toLocalMessage 与 wsHandlers：均为 `msg.sender_nickname || null`。
 *
 * 结果：同一份服务端消息经不同路径落库 sender_name 不一致；好友历史加载出来的行
 * sender_name 恒为空，显示层 `sender_name ?? sender_id` 直接裸露用户 ID。
 *
 * ## 契约
 *
 * 写入侧（resolveSenderName）：服务端昵称非空白优先 → 本地资料昵称回退 → 最后空值。
 * 三条写入路径一律调用本函数，禁止再写 `|| null` 三元表达式。
 *
 * 显示侧（displaySenderName）：落库昵称非空白优先 → 本地资料昵称回退 → 兜底文案
 * 「未知用户」。**绝不返回空串、绝不返回 sender_id** —— 存量已落库的空 sender_name 行
 * 在读取展示层由此收口（不做数据迁移）。
 *
 * 资料回退取值来源（均为本地已内存/已落库数据，**不给热路径引入任何网络请求**）：
 * - 好友资料：chatStore.friends（useChatStore.getState().friends）或 db.getFriends()；
 * - 群成员资料：会话成员列表（members）/ 已读位置快照 display_name。
 * 资料也没有时按兜底文案处理，不整段裸露长 ID。
 */

/** 显示层兜底文案：昵称、资料都拿不到时用它，绝不裸露用户 ID */
export const UNKNOWN_SENDER_NAME = '未知用户';

/** trim 后非空白才视为有效；返回 trim 后的值或 null */
function nonBlank(value: string | null | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}

/**
 * 写入侧唯一收口：服务端昵称优先，本地资料昵称回退，最后空值。
 *
 * @param serverNickname  服务端消息携带的 sender_nickname（可能缺失/空串/纯空白）
 * @param profileNickname 本地资料昵称（好友资料 / 群成员资料；拿不到传 null/undefined）
 * @returns 应落库的 sender_name；两路都拿不到时为 null（与既有「回退空值」行为一致）
 */
export function resolveSenderName(
  serverNickname: string | null | undefined,
  profileNickname?: string | null,
): string | null {
  return nonBlank(serverNickname) ?? nonBlank(profileNickname);
}

/**
 * 由本地资料组合「可显示的资料名」：备注 → 昵称 → null。
 *
 * 供显示侧调用方把一份资料（Friend / GroupMember）折成一个 profile 字符串。
 * **绝不回退到 ID** —— 与 friendDisplayName 的「最后回退 friend_id」不同，这里是
 * 昵称兜底链的中间层，ID 兜底交由 displaySenderName 的「未知用户」终点处理。
 */
export function profileDisplayName(
  remark?: string | null,
  nickname?: string | null,
): string | null {
  return nonBlank(remark) ?? nonBlank(nickname);
}

/**
 * 显示侧唯一收口：落库昵称 → 资料昵称 → 兜底文案「未知用户」。
 *
 * @param storedName    消息行落库的 sender_name（或群消息 UI 形态的 sender_nickname）
 * @param profileName   本地资料昵称（可选；没有就传空，直接落兜底文案）
 * @returns 永远非空的展示文本
 */
export function displaySenderName(
  storedName: string | null | undefined,
  profileName?: string | null,
): string {
  return resolveSenderName(storedName, profileName) ?? UNKNOWN_SENDER_NAME;
}
