/**
 * 组合消息（原消息快照 + 回复正文）信封 —— 纯函数层（零 React / 零 Tauri）
 *
 * @module chat/shared
 * @location src/chat/shared/combinedMessage.ts
 *
 * ## 为什么存在
 *
 * 旧行为：引用回复只带 `reply_to`（原消息 uuid），气泡里的「原消息」那一半要靠客户端
 * 拿 uuid 去已加载窗口反查；回复很早的历史消息时反查落空 ⇒ 「原消息未加载，点击定位」
 * 灰条占位，原话内容根本看不见（owner 2026-09-24 实拍截图）。
 *
 * 新行为（owner 定案「发一个原消息加回复的组合消息」）：发文本引用回复时，把被引用原消息的
 * **内容快照**（发送者、正文/类型摘要、时间、原消息 uuid）随回复正文一起打包进消息负载；
 * 接收端直接渲染随包快照，不再依赖本地是否加载过原消息。点击定位仍用 reply_to 锚点。
 *
 * ## 为什么走 message_content（协议主干零改动）
 *
 * 服务端消息表只存固定列，`message_content` 是唯一能自由承载客户端数据的通道——
 * `meeting_invite` / `card` / `group_card` 三类消息的 content 本来就是 JSON 载荷
 * （见 backend-docs/group_messages/群消息.md 消息类型表），本模块沿用同一先例：
 * **message_type 仍是 `text`**，content 从裸文本变成「信封 JSON」。
 * 服务端按不透明字符串中转/落库/下发（≤10000 字符限制内），协议主干一字不动。
 *
 * ## 兼容性
 *
 * - 旧消息（无信封）：`parseCombinedMessageContent` 返回 null ⇒ 一切照旧，
 *   引用块继续走本地反查 + 占位兜底，不崩溃。
 * - 旧客户端收到新组合消息：把信封 JSON 当普通文本显示（不崩溃，内容可见但形态难看）；
 *   三端（桌面/Android/Web）同仓同发，混合版本窗口极短。
 * - 用户手打/粘贴一段恰好长得像信封的 JSON：解析必须**全字段合格**才认（严格校验），
 *   缺一个字段都按普通文本处理。
 *
 * ## 拆信封的唯一正确姿势
 *
 * 信封只在**数据入口**拆（DB→UI 转换、WS→UI、预览文本收口点），拆完下游看到的
 * `message_content` 就是纯正文 —— 气泡渲染 / 会话预览 / 转发 / 多选全都无需感知信封。
 * 本地数据库里存的是**原样信封**（与服务端一致），所以重启后快照依然可用。
 */

/** 被引用原消息的内容快照（随组合消息一起上行的那份） */
export interface ReplySnapshot {
  /** 原消息 uuid —— 点击定位锚点，与外层 reply_to 同值（冗余带是防两字段失配） */
  reply_to: string;
  /** 原消息发送者显示名（群聊已套用发送时刻的群内私有备注口径） */
  sender_name: string;
  /** 原消息单行摘要（正文截断 / [图片] 等类型标签，见 replyPreview.summarizeMessageForReply） */
  summary: string;
  /** 原消息 message_type（快照完整性用；渲染走 summary，不按它二次分支） */
  message_type: string;
  /** 原消息发送时间（ISO，取自原消息 send_time）；拿不到时为 null */
  send_time: string | null;
  /**
   * 原消息发送者 user_id（跨端身份锚点，可选——首版信封没有该字段，解析容忍缺失）。
   * 为什么需要它：sender_name 是**发送方视角**的名字（好友私聊里自己的消息叫「我」），
   * 直接把它渲染到对端会把别人的消息错标成「我」。接收端拿 sender_id 与本地 userId
   * 比对，命中才本地化成「我」，否则原样显示 sender_name。
   */
  sender_id?: string;
}

/** 组合消息拆包结果 */
export interface CombinedMessagePayload {
  /** 回复正文（气泡正文渲染它） */
  text: string;
  /** 被引用原消息快照（引用块兜底渲染它） */
  reply: ReplySnapshot;
}

/** 信封标记键。值恒为 1 —— 恰好长成这样的普通文本概率可忽略，且校验还不止看这一个键。 */
const COMBO_MARKER_KEY = 'hv_combo_v1';

/** 快照各字符串字段的类型要求（send_time 特殊：允许 null） */
const SNAPSHOT_STRING_FIELDS = ['reply_to', 'sender_name', 'summary', 'message_type'] as const;

/**
 * 把回复正文 + 原消息快照打包成组合消息信封（上行 wire format）
 *
 * 只在文本回复路径调用：`replyTo` 为空时调用方根本不该有 snapshot。
 */
export function buildCombinedMessageContent(text: string, snapshot: ReplySnapshot): string {
  return JSON.stringify({
    [COMBO_MARKER_KEY]: 1,
    text,
    reply: snapshot,
  });
}

/**
 * 识别并拆开组合消息信封
 *
 * @returns 非信封（旧消息 / 普通文本 / 畸形 JSON / 字段不全）一律返回 null ——
 *          调用方拿到 null 就当普通文本处理，这就是「旧消息零感知」的实现点。
 */
export function parseCombinedMessageContent(content: string): CombinedMessagePayload | null {
  // 快速否决：信封必以 '{' 开头。绝大多数消息（普通文本）在这里一行就返回，
  // 不付 JSON.parse 的成本，也不会把任何解析异常漏成崩溃。
  if (!content.startsWith('{')) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  if (record[COMBO_MARKER_KEY] !== 1) {
    return null;
  }
  const { text, reply } = record;
  if (typeof text !== 'string' || typeof reply !== 'object' || reply === null || Array.isArray(reply)) {
    return null;
  }
  const replyRecord = reply as Record<string, unknown>;
  // 快照字段全量严格校验：任何一处不合格都整包拒收（按普通文本显示，绝不半拆）。
  for (const field of SNAPSHOT_STRING_FIELDS) {
    if (typeof replyRecord[field] !== 'string') {
      return null;
    }
  }
  const sendTime = replyRecord.send_time;
  // send_time 是快照元数据（现版渲染不读它）：缺键容忍为 null，但出现就必须是字符串
  if (sendTime !== null && sendTime !== undefined && typeof sendTime !== 'string') {
    return null;
  }
  // sender_id 可选（首版信封无此字段）：出现就必须是字符串，缺失则不带
  const senderId = replyRecord.sender_id;
  if (senderId !== undefined && typeof senderId !== 'string') {
    return null;
  }
  return {
    text,
    reply: {
      reply_to: replyRecord.reply_to as string,
      sender_name: replyRecord.sender_name as string,
      summary: replyRecord.summary as string,
      message_type: replyRecord.message_type as string,
      send_time: typeof sendTime === 'string' ? sendTime : null,
      ...(typeof senderId === 'string' ? { sender_id: senderId } : {}),
    },
  };
}

/**
 * 只取「给人看的正文」：是组合消息返回回复正文，否则原样返回
 *
 * 供预览 / 搜索 / 通知这类**只要正文不要快照**的路径用——一个调用点替代
 * 「parse + 判空 + 取 text」三步，漏判空导致的 undefined 扩散就堵死了。
 */
export function stripCombinedEnvelope(content: string): string {
  return parseCombinedMessageContent(content)?.text ?? content;
}

/**
 * stripCombinedEnvelope 的可空包装
 *
 * 会话列表兜底值（服务端 Group.last_message_content 等裸透传字段，可能为 null）直接喂给它，
 * 避免「null 判断 + strip」两步在调用点重复展开。
 */
export function stripCombinedEnvelopeNullable(content: string | null | undefined): string | null {
  if (content === null || content === undefined) { return null; }
  return stripCombinedEnvelope(content);
}
