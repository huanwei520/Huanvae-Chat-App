/**
 * 会话媒体序列（左右滑动切上一张 / 下一张的数据面）—— 纯逻辑，零 React 依赖
 *
 * @module chat/shared
 * @location src/chat/shared/mediaGallery.ts
 *
 * ## 切图范围是什么（这一条是设计的地基，不是随手定的）
 *
 * 范围 = **当前会话已加载的那批消息里的全部媒体（图片 + 视频）**，按时间**升序**（旧 → 新）；
 * 相册（media_group）内部按 `media_group_index` 升序，与网格里眼睛看到的顺序逐格一致。
 *
 * 为什么不是「只在同一条相册内切」：相册在数据层本来就是 N 条独立消息
 * （见 mediaGroup.ts 顶部注释），把范围限制在组内会让「单独发的一张图」永远没有邻居 ——
 * 而用户按左右滑动时想要的是"这个会话里的上一张图"，不是"这一组里的上一张"。
 *
 * 为什么范围只到「已加载」：消息列表本身就是分页窗口（`hasMore` / `onLoadMore`），
 * 全量图片索引在客户端根本不存在 —— 后端没有「某会话全部图片」这个端点
 * （现查：`src/api/messages.ts` / `src/api/groupMessages.ts` 只有按时间翻页的历史接口）。
 * 所以序列 = 当前列表里能看到的那批，**与用户往上翻了多少历史严格同步**：
 * 翻得越多，能左右滑到的越多。这是可解释的，也不需要扩任何数据契约。
 *
 * ## 为什么图片和视频算同一条序列
 *
 * 相册网格里图片与视频是混排的（AlbumMessage 每格复用同一个 FileMessageContent）。
 * 若序列只收图片，用户在网格上看到「第 3 格是视频」，滑动时却被静默跳过 ——
 * 眼睛看到的位次与手滑到的位次对不上。收全部媒体，位次才恒等于网格里的位次。
 *
 * ## 被排除的项（每一条都有理由，不是顺手过滤）
 *
 * - `is_recalled` —— 撤回后气泡本身就不再渲染媒体，滑过去只会是一个取不到源的空屏
 * - `file_uuid` 为空 —— 乐观消息（还在上传、服务端尚未分配 uuid）；预览窗与本地缓存
 *   都以 file_uuid 为键（两层键，见 services/fileCache.fileIdentityKey），没有键就取不到源
 * - 非 image / video —— 文本、文件、卡片、系统消息不是媒体
 */

import type { RenderNode } from './mediaGroup';

/** 序列里的一项：预览侧取源所需的最小信息（不含 src —— 由预览侧自己解析） */
export interface MediaGalleryItem {
  /** 消息 uuid：序列内的稳定身份（同一个文件可能被发过两次，file_uuid 会重复） */
  messageUuid: string;
  /** 文件 uuid：取源 / 本地缓存 / 下载任务的键 */
  fileUuid: string;
  /** 展示用文件名（已剥掉「[图片] 」这类后端派生前缀） */
  filename: string;
  /** 文件大小；未知为 undefined */
  fileSize?: number;
  /** 媒体类型 */
  type: 'image' | 'video';
  /** 预签名 URL 的归属类型，与气泡侧同口径 */
  urlType: 'user' | 'friend' | 'group';
  /** 好友 ID（仅用于错误上报，与气泡侧同口径） */
  friendId?: string;
}

/** 建序列所需的最小消息形状（私聊 Message / 群聊 GroupMessage 都满足） */
export interface GalleryableMessage {
  message_uuid: string;
  message_content: string;
  message_type: string;
  file_uuid: string | null;
  file_size: number | null;
  is_recalled: boolean;
}

/**
 * 从后端派生正文里剥出文件名。
 *
 * 后端对媒体消息下发的 `message_content` 形如「[图片] a.png」；没有配文时这就是全部内容。
 * 气泡（FileMessageContent）与序列必须用**同一条**剥法，否则同一张图在气泡标题与
 * 全屏预览标题上会显示成两个名字。
 */
export function mediaFilenameFromContent(messageContent: string): string {
  return messageContent.replace(/^\[(图片|视频|文件)\]\s*/, '');
}

/** 序列归属信息：一个会话内对所有项都相同，故由列表层一次性注入 */
export interface MediaGalleryScope {
  urlType: 'user' | 'friend' | 'group';
  friendId?: string;
}

/**
 * 把消息列表的渲染节点摊平成媒体序列。
 *
 * @param nodes 渲染节点，**必须是 groupMessagesIntoAlbums 的产物**（相册内部已按
 *   media_group_index 升序）。调用方给的是消息列表的顺序，即 send_time **倒序**（新 → 旧）。
 * @returns 媒体序列，**升序**（旧 → 新）—— 于是「下一张」= 更新的那张，与列表向下看的方向一致
 *
 * 为什么吃 RenderNode 而不是直接吃 messages：相册内各项 `send_time` 常常一模一样
 * （同一批上传），按 send_time 排会得到一个不稳定且与网格不一致的组内顺序。
 * mediaGroup 已经把「组内按 index 升序」这件事做对了，这里直接复用，不再造第二套排序。
 */
export function buildMediaGallery<T extends GalleryableMessage>(
  nodes: readonly RenderNode<T>[],
  scope: MediaGalleryScope,
): MediaGalleryItem[] {
  const items: MediaGalleryItem[] = [];

  // 节点是倒序（新 → 旧）：整体反过来遍历得到升序；相册内部本来就是升序，原样保留
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const node = nodes[i];
    const members = node.kind === 'album' ? node.items : [node.message];
    for (const message of members) {
      const item = toGalleryItem(message, scope);
      if (item) { items.push(item); }
    }
  }

  return items;
}

function toGalleryItem(
  message: GalleryableMessage,
  scope: MediaGalleryScope,
): MediaGalleryItem | null {
  if (message.is_recalled) { return null; }
  if (message.message_type !== 'image' && message.message_type !== 'video') { return null; }
  if (!message.file_uuid) { return null; }

  return {
    messageUuid: message.message_uuid,
    fileUuid: message.file_uuid,
    filename: mediaFilenameFromContent(message.message_content),
    fileSize: message.file_size ?? undefined,
    type: message.message_type,
    urlType: scope.urlType,
    friendId: scope.friendId,
  };
}

/**
 * 在序列里定位一项。
 *
 * 找不到只可能出现在「宿主没挂 MediaGalleryProvider」（items 恒空）这一种情况下，
 * 此时序列就是这一张 —— 与"会话里只有这一张图"完全同一条路径，不是为了兼容多出来的分支。
 * 移动端全屏预览与桌面独立窗 handoff **共用**这一个函数，避免两侧各写一份定位口径。
 */
export function locateInGallery(
  items: readonly MediaGalleryItem[],
  item: MediaGalleryItem,
): { list: MediaGalleryItem[]; index: number } {
  const index = items.findIndex((i) => i.messageUuid === item.messageUuid);
  return index >= 0 ? { list: [...items], index } : { list: [item], index: 0 };
}

/** 切图方向：-1 上一张（更旧）、+1 下一张（更新） */
export type MediaStepDirection = -1 | 1;

/**
 * 边界定义 —— **到头就是到头：不循环、不跳转，返回 null 表示「这个方向没有下一张」**。
 *
 * 上层拿到 null 时的表现是**回弹**（图片跟手位移打折、松手弹回原位），不是"没反应"。
 * 理由：「没反应」在画面上与「手势压根没被识别」完全同形 —— 用户无法区分
 * "我已经在最后一张了" 和 "这个 App 的滑动坏了"。回弹自带反馈，两者形状不同。
 * （不做循环是因为循环会让"我到底看完没有"失去终点感，且从最后一张一滑就回到第一张
 *   在相册场景里极易被误读成"回到开头了？我是不是漏看了"。）
 */
export function stepGalleryIndex(
  index: number,
  count: number,
  direction: MediaStepDirection,
): number | null {
  const next = index + direction;
  if (next < 0 || next >= count) { return null; }
  return next;
}

/** 序列位置指示文案（如「3 / 12」）；序列只有一项时不显示（返回 null） */
export function galleryPositionLabel(index: number, count: number): string | null {
  if (count <= 1) { return null; }
  return `${index + 1} / ${count}`;
}
