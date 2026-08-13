/**
 * 待发区 → 发送计划（纯逻辑，零 React / 零 Tauri 依赖）
 *
 * @module chat/shared
 * @location src/chat/shared/composerTrayPlan.ts
 *
 * 「回车那一刻，待发区里的 N 个附件 + 输入框里的文字，到底变成几条什么样的消息」——
 * 这件事是产品决策（huanwei 2026-08-12 11:01 定死的四格矩阵），不是实现细节，
 * 所以抽成纯函数让它可被单测钉死。
 *
 * ## 四格矩阵（真值源：/private/tmp/fw-spec-composer-tray.md §二）
 * | 待发区里的媒体数 | 有没有文字 | 发出去的形态 |
 * |---|---|---|
 * | 多个 | 无 | 合成相册 |
 * | 多个 | 有 | 相册 + 文字（文字 = 整组 caption） |
 * | **单个** | 无 | **保持原样：单条媒体消息，绝不带 media_group 三件套** |
 * | **单个** | 有 | **该媒体 + 文字（caption 直接作正文），同样不带三件套** |
 *
 * 🔴 「单条不包相册」是硬约束。理由写在 AlbumMessage.tsx 的折叠注释里：
 * 相册折叠会把组内非代表成员的 DOM 锚点抹掉 ⇒ 定位报「原消息不在本地记录中」。
 * 把单条也包成相册 = 主动把那个坑扩大到所有媒体消息。
 * 本模块里它的机器口径是 {@link planComposerTraySend} 对 `size === 1` 的分片
 * **不产出 groupId / index / count** 三个字段（连 `undefined` 都不写进对象也可以，
 * 但显式写 undefined 便于断言「确实没有值」）。
 *
 * ## 后端契约（核过，不是猜的）
 * - `caption` **只有 storage 上传链路一条通道**：`POST /api/storage/upload/request`
 *   与 `POST /api/storage/upload/confirm` 两处各带一次；
 *   **两个消息端点（`/api/messages`、`/api/group_messages`）都没有 caption 字段**。
 *   （backend-docs/messages/好友消息.md「创建入口（两条）」第 1 条原文）
 * - caption 会**取代**该条由文件名派生的正文，即成为这条消息的 `message_content`（零新列）。
 * - 合法用法只有两种：① 不成组的**单条**媒体消息可直接带 caption（单图配文）；
 *   ② 成组时只随 `media_group_index = 0` 那一项提交。挂到组内其它位次 → 后端 400。
 *   （backend-docs/storage/文件存储管理.md 参数表 `caption` 行）
 * - **类型分族**：`image` 与 `video` 可同组，`file` 只能与 `file` 同组
 *   （好友消息.md 服务端强制规则表第 5 条）⇒ 混选「图 + 文档」**不能**塞进同一个相册，
 *   必须按族切成多个形态。这一条 spec 没提，是本模块从契约反推出来的，见 {@link familyOf}。
 *
 * ## 本模块不做随机数
 * `groupId` 由调用方生成后传入（与 albumSend.ts 同口径）——纯函数保持确定性，
 * 单测才能逐字节断言产物。
 */

import { ALBUM_MAX_ITEMS, ALBUM_MIN_ITEMS } from './albumSend';

/** 待发项的类型（与 FileAttachButton 的 AttachmentType 同名同义） */
export type TrayItemKind = 'image' | 'video' | 'file';

/**
 * 后端的「类型分族」：同族才能成组。
 *
 * image 与 video 同族；file 自成一族。判据来自后端强制规则，不是本端偏好 ——
 * 混族塞进同一个 media_group_id 会被后端 400，且失败发生在**上传完之后**
 * （消息是在 upload/confirm 那一步建的），用户已经等完了整个上传才看到失败。
 */
export type TrayFamily = 'media' | 'file';

export function familyOf(kind: TrayItemKind): TrayFamily {
  return kind === 'file' ? 'file' : 'media';
}

/** 计划输入：只要求这两个字段，具体的 TrayItem 由调用方传（泛型透传） */
export interface PlannableItem {
  kind: TrayItemKind;
}

/**
 * 一项的发送计划。
 *
 * 🔴 三件套 `groupId` / `index` / `count` **同生同灭**（后端强制，违反 400）：
 * 单条形态下三者恒为 `undefined`，这就是「单条不包相册」的机器表达。
 */
export interface TraySendPlanItem<T> {
  item: T;
  /** 该项属于第几个形态（0-based）；同一形态内的项共享同一个 shapeIndex */
  shapeIndex: number;
  /** 形态：`album` = 成组（带三件套）；`single` = 单条（绝不带三件套） */
  shapeKind: 'album' | 'single';
  /** 媒体组三件套 —— 仅 album 形态有值 */
  groupId?: string;
  index?: number;
  count?: number;
  /**
   * 本项要提交的配文。
   *
   * 整批**只有一项**非空：第一个形态的第一项（album 时即其 index 0，single 时即它本身）。
   * 其余位次带 caption 会被后端直接 400。
   */
  caption?: string;
}

export interface ComposerTraySendPlan<T> {
  /** 逐项计划，顺序 = 用户在待发区看到的顺序 */
  items: TraySendPlanItem<T>[];
  /** 需要多少个 groupId（= album 形态的个数）；调用方按这个数量生成 UUID */
  albumCount: number;
  /**
   * 附件为空时，文字要作为普通文本消息单独发出（保持既有行为）。
   * 附件非空时恒为 null —— 文字已经变成 caption 挂在第一项上，再发一条会重复。
   */
  standaloneText: string | null;
}

/**
 * 把待发区按后端的成组约束切成若干「形态」。
 *
 * 切法：**保序**按族分段（连续同族的为一段），每段长度 >= {@link ALBUM_MIN_ITEMS} 即成一个相册，
 * 否则各自是单条。
 *
 * ⚠️ 不做分块：待发区总量由 {@link import('../../stores/composerTrayStore').TRAY_MAX_ITEMS}
 * 卡在 {@link ALBUM_MAX_ITEMS} 以内，故任何一段都不可能超过组上限。
 * **若将来放宽待发区上限，必须在这里补分块**，否则会构造出 count > 10 的组被后端 400。
 * 这条不是"以防万一"，是把约束的依赖关系写下来 —— 两个常量现在是绑死的。
 */
export function splitIntoShapes<T extends PlannableItem>(items: readonly T[]): T[][] {
  const shapes: T[][] = [];
  let current: T[] = [];
  let currentFamily: TrayFamily | null = null;

  for (const item of items) {
    const family = familyOf(item.kind);
    if (currentFamily !== null && family !== currentFamily) {
      shapes.push(current);
      current = [];
    }
    currentFamily = family;
    current.push(item);
  }
  if (current.length > 0) {
    shapes.push(current);
  }
  return shapes;
}

/**
 * 生成整批发送计划。
 *
 * @param items   待发区里的项（顺序即用户看到的顺序）
 * @param text    输入框里的文字（未 trim）
 * @param groupIds 调用方预先生成的组标识，个数需 >= album 形态数；不足时抛错
 *                （宁可当场炸，也不要静默降级成单条 —— 那会让"多个"悄悄退化成 N 条散图）
 */
export function planComposerTraySend<T extends PlannableItem>(
  items: readonly T[],
  text: string,
  groupIds: readonly string[],
): ComposerTraySendPlan<T> {
  const caption = text.trim();

  if (items.length === 0) {
    return { items: [], albumCount: 0, standaloneText: caption || null };
  }

  const shapes = splitIntoShapes(items);
  const albumShapeCount = shapes.filter((s) => s.length >= ALBUM_MIN_ITEMS).length;
  if (groupIds.length < albumShapeCount) {
    throw new Error(
      `需要 ${albumShapeCount} 个 groupId，只收到 ${groupIds.length} 个`,
    );
  }

  const plans: TraySendPlanItem<T>[] = [];
  let albumCursor = 0;
  let captionUsed = false;

  shapes.forEach((shape, shapeIndex) => {
    const isAlbum = shape.length >= ALBUM_MIN_ITEMS;
    const groupId = isAlbum ? groupIds[albumCursor++] : undefined;

    shape.forEach((item, indexInShape) => {
      // 配文只挂整批的第一项（第一个形态的第一项）。后端对「组内其它位次带 caption」直接 400，
      // 而"每个形态都挂一次"会让同一句话在混族场景里出现两遍。
      const isFirstOfBatch = shapeIndex === 0 && indexInShape === 0;
      const thisCaption = isFirstOfBatch && caption && !captionUsed ? caption : undefined;
      if (thisCaption) { captionUsed = true; }

      plans.push({
        item,
        shapeIndex,
        shapeKind: isAlbum ? 'album' : 'single',
        // 单条形态：三件套全部 undefined —— 「单条不包相册」的机器口径
        groupId: isAlbum ? groupId : undefined,
        index: isAlbum ? indexInShape : undefined,
        count: isAlbum ? shape.length : undefined,
        caption: thisCaption,
      });
    });
  });

  return { items: plans, albumCount: albumShapeCount, standaloneText: null };
}

/**
 * 待发区能不能塞下这一批（数量维度）。
 *
 * 分开导出而不是写进 store，是因为「上限是多少」这件事要能被单测直接问，
 * 且 UI 要在**加入之前**就告诉用户会被挡掉几个（不静默截断，见 AlbumComposer 的同款教训）。
 */
export function splitByCapacity<T>(
  existingCount: number,
  incoming: readonly T[],
  capacity: number,
): { accepted: T[]; overflow: T[] } {
  const room = Math.max(0, capacity - existingCount);
  return { accepted: incoming.slice(0, room), overflow: incoming.slice(room) };
}

export { ALBUM_MAX_ITEMS, ALBUM_MIN_ITEMS };
