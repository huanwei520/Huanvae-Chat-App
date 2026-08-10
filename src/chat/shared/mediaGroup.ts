/**
 * 媒体组（相册）聚合纯逻辑（群聊 + 私聊共用）
 *
 * @module chat/shared
 * @location src/chat/shared/mediaGroup.ts
 *
 * 后端 migration 036 起，相册的每一张图/视频**仍是一条独立消息**，靠三个字段成组：
 *   media_group_id    组标识（客户端生成 UUID，同组各项共用）
 *   media_group_index 组内位次，0-based，`0 <= index < count`
 *   media_group_count 组的期望总数，2..10
 * 且 caption（整组配文）**只挂在 index = 0 那一条**上（后端约束：其余位次带 caption 直接 400）。
 *
 * 本模块把「N 条独立消息」折叠成「1 个相册渲染节点」，是接收侧的核心。纯函数、零 React 依赖。
 *
 * ## 三个必须处理对的点（都来自真实会踩的坑）
 *
 * 1. **跨分页拆组**（字段对齐提案 R1）：一页 50 条正好切在第 7 张 ⇒ 只加载到组的一部分。
 *    此时**不能**按已加载条数渲染，否则 loadMore 之后相册会当着用户面从 7 格重排成 10 格。
 *    故保留 expectedCount，让 UI 为未到货的项预留占位。
 *
 * 2. **组内顺序不依赖到达顺序**：列表是按 send_time 倒序拿到的，同组各项 send_time 可能相同
 *    （同一批上传），倒序还会让组内顺序反过来。**显示顺序一律以 media_group_index 升序为准。**
 *
 * 3. **caption 可能不在已加载窗口内**：index=0 那条被分页切掉时 caption 取不到。
 *    此时给空串而不是瞎猜 —— UI 不渲染配文行，比渲染一个错的好。
 */

/** 聚合所需的最小消息形状（群消息 / 私聊消息都满足） */
export interface AlbumableMessage {
  message_uuid: string;
  message_content: string;
  media_group_id?: string | null;
  media_group_index?: number | null;
  media_group_count?: number | null;
}

/** 相册节点：由同一 media_group_id 的多条消息折叠而成 */
export interface AlbumNode<T> {
  kind: 'album';
  /** 组标识，可直接用作 React key */
  groupId: string;
  /** 已加载到的组内成员，**按 media_group_index 升序** */
  items: T[];
  /** 组的期望总数（后端下发）；已加载数 < 它时 UI 应为缺口预留占位 */
  expectedCount: number;
  /** 整组配文（来自 index=0 那条的 message_content）；index=0 未加载时为空串 */
  caption: string;
  /** 是否已集齐（items.length === expectedCount） */
  isComplete: boolean;
}

/** 普通单条消息节点 */
export interface SingleNode<T> {
  kind: 'single';
  message: T;
}

export type RenderNode<T> = AlbumNode<T> | SingleNode<T>;

/** 后端允许的组大小上限（与 huanwei 定的一致；后端同样校验，前端不是唯一闸） */
export const MEDIA_GROUP_MAX = 10;

/**
 * 判断一条消息是否属于某个相册
 *
 * 三件套必须**同时**有效才算成组：只有 id 没有 index/count 的消息按普通单条处理，
 * 而不是折叠成一个残缺相册 —— 宁可退化成「N 张独立图」也不要渲染出错位的格子。
 */
export function isAlbumItem(message: AlbumableMessage): boolean {
  return (
    typeof message.media_group_id === 'string'
    && message.media_group_id.length > 0
    && typeof message.media_group_index === 'number'
    && typeof message.media_group_count === 'number'
    && message.media_group_count >= 2
  );
}

/**
 * 把消息列表折叠成渲染节点列表
 *
 * @param messages 已加载的消息，**保持调用方给的顺序**（列表是 send_time 倒序）
 * @returns 渲染节点；相册占据它**首次出现**的位置，其余成员不再单独占位
 *
 * 非相册消息的相对顺序原样保留 —— 聚合只折叠，不重排。
 */
export function groupMessagesIntoAlbums<T extends AlbumableMessage>(
  messages: readonly T[],
): RenderNode<T>[] {
  // 先按 groupId 归拢，同时记住每组首次出现的位置，保证折叠后位置不跳
  const buckets = new Map<string, T[]>();
  for (const message of messages) {
    if (!isAlbumItem(message)) { continue; }
    const key = message.media_group_id as string;
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(message);
    } else {
      buckets.set(key, [message]);
    }
  }

  const emitted = new Set<string>();
  const nodes: RenderNode<T>[] = [];

  for (const message of messages) {
    if (!isAlbumItem(message)) {
      nodes.push({ kind: 'single', message });
      continue;
    }

    const groupId = message.media_group_id as string;
    if (emitted.has(groupId)) {
      continue; // 该组已在首次出现处折叠输出过
    }
    emitted.add(groupId);

    const members = [...(buckets.get(groupId) ?? [])].sort(
      (a, b) => (a.media_group_index ?? 0) - (b.media_group_index ?? 0),
    );
    // expectedCount 取组内出现过的最大 count（各项都冗余带同一个值；取 max 是为了
    // 容忍个别项字段缺失时不至于把整组的期望总数算小、少预留占位）
    const expectedCount = members.reduce(
      (max, m) => Math.max(max, m.media_group_count ?? 0),
      0,
    );
    const first = members.find((m) => m.media_group_index === 0);

    nodes.push({
      kind: 'album',
      groupId,
      items: members,
      expectedCount,
      caption: first ? first.message_content : '',
      isComplete: members.length === expectedCount,
    });
  }

  return nodes;
}
