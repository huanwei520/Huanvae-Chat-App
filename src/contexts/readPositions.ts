/**
 * 读位内存模块 —— per 会话 { last_seq, last_read_seq } 的同步快照
 *
 * connected 快照纠正原本要 await db.getConversations()（数十 ms），UI 先后出现
 * 「基线（unread>0）→ 纠正（清 0）」两个可见中间态，再叠加登录补发的 new_message
 * 回加未读，形成 V 型翻转，被会话卡片 layout 动画放大成"抽搐"。
 *
 * 本模块把读位常驻内存：写路径同步写穿（db/index.ts 的 advanceConversationRead /
 * updateConversationLastSeq 收口 + wsHandlers 消息处理的同步更新），connected 时
 * 可同步算好「快照 ∖ 本地已读」一步 setUnreadSummary，无中间态。
 *
 * 约束：
 * - 零依赖纯内存模块。db/index.ts 反向写穿本模块，本模块不得 import db（否则成环）。
 * - 所有更新单调只升（max 合并），seed 与写穿任意交错不会回退。
 * - 登出/账号切换由 WebSocketContext.disconnect()（与 unreadSummary 同一清理时机）
 *   调 resetReadPositions() 清空。
 */

export interface ReadPosition {
  /** 本地已收到的最新消息 seq（增量同步游标的内存镜像） */
  last_seq: number;
  /** 本地已读位置（单调只升） */
  last_read_seq: number;
}

const positions = new Map<string, ReadPosition>();
let loaded = false;

/** Map 是否已用 db 会话快照灌入过（未载入时 connected 走两段式兜底路径） */
export function isReadPositionsLoaded(): boolean {
  return loaded;
}

/**
 * 用 db 会话快照灌入（登录预载 / connected 兜底路径顺手灌入）。
 * 单调 max 合并：灌入期间写穿已推进的值不会被快照回退。
 */
export function seedReadPositions(
  conversations: ReadonlyArray<{ id: string; last_seq: number; last_read_seq: number }>,
): void {
  for (const conv of conversations) {
    const cur = positions.get(conv.id);
    if (cur) {
      cur.last_seq = Math.max(cur.last_seq, conv.last_seq);
      cur.last_read_seq = Math.max(cur.last_read_seq, conv.last_read_seq);
    } else {
      positions.set(conv.id, { last_seq: conv.last_seq, last_read_seq: conv.last_read_seq });
    }
  }
  loaded = true;
}

/** 消息落库抬 last_seq（镜像 db.updateConversationLastSeq；单调 max） */
export function noteMessageSeq(conversationId: string, seq: number): void {
  if (seq <= 0) {
    return;
  }
  const cur = positions.get(conversationId);
  if (cur) {
    cur.last_seq = Math.max(cur.last_seq, seq);
  } else {
    positions.set(conversationId, { last_seq: seq, last_read_seq: 0 });
  }
}

/**
 * 推进读位（镜像 db.advanceConversationRead）：
 * - 无 seq：推进到本地已收最新（last_read_seq = max(last_read_seq, last_seq)）。
 * - 带 seq：显式读位（收到消息当帧标读 / 多端 read_sync 自读），
 *   last_read_seq = max(last_read_seq, seq)。不取 max(last_seq)：read_sync 的 seq
 *   来自别端，本端可能有别端没读过的更新消息，不能凭空标到本地最新。
 */
export function noteRead(conversationId: string, seq?: number): void {
  const cur = positions.get(conversationId);
  if (cur) {
    cur.last_read_seq = Math.max(cur.last_read_seq, seq ?? cur.last_seq);
  } else if (seq !== undefined && seq > 0) {
    positions.set(conversationId, { last_seq: 0, last_read_seq: seq });
  }
  // 无条目且无显式 seq：last_seq 未知，无从推进，交由 db 真值（connected 兜底路径覆盖）
}

/** 查询单会话读位（read_sync 自读判定"别端是否读到 >= 本地已收最新"用） */
export function getReadPosition(conversationId: string): Readonly<ReadPosition> | undefined {
  return positions.get(conversationId);
}

/** connected 同步纠正用快照（computeConnectedReadCorrection 入参形状） */
export function getReadPositionsSnapshot(): Array<{ id: string; last_seq: number; last_read_seq: number }> {
  return Array.from(positions, ([id, pos]) => ({
    id,
    last_seq: pos.last_seq,
    last_read_seq: pos.last_read_seq,
  }));
}

/** 登出/账号切换清空（与 unreadSummary 同一清理钩子：WebSocketContext.disconnect） */
export function resetReadPositions(): void {
  positions.clear();
  loaded = false;
}
