/**
 * 相册（媒体组）气泡内容 —— Telegram 风格网格 + 整组配文
 *
 * @module chat/shared
 * @location src/chat/shared/AlbumMessage.tsx
 *
 * 由 chat/shared/mediaGroup.ts 折叠出的 AlbumNode 驱动，群聊 / 私聊共用同一份。
 *
 * ## 四个设计约束（都不是随手定的）
 *
 * 1. **配文渲染在整组下方，不挂在第一张图上** —— huanwei 明确要的效果是
 *    「视觉上成为一整个整体」。挂在首图上会让它看起来像"第一张的说明"。
 *    配文与网格由 chat/shared/MediaBubbleFrame 包进**同一个大气泡**（Telegram 式
 *    media + caption），与单图 / 单视频 + 文字共用同一层包裹；无配文时该层一个节点都不产生。
 *
 * 2. **格子高度靠 CSS aspect-ratio 预留，不等图片加载** —— 图片加载完再撑开会引发
 *    布局跳动，而消息列表是 column-reverse 的，任何高度跳变都会把用户正在看的位置顶走
 *    （v1.1.26 刚修好「点引用定位不顶起整页」，不能在这里再引入一次）。
 *
 * 3. **缺口用占位格补齐** —— 跨分页拆组时（字段对齐提案 R1）只加载到组的一部分，
 *    按已加载条数排版会让 loadMore 之后相册当着用户面从 7 格重排成 10 格。
 *    故按 expectedCount 排版，未到货的位次渲染成静默占位格。
 *
 * 3b. **排布必须铺满，不留空槽** —— 列数固定时 3 张会排成 2×2、右下空一整格，
 *    那一格露出的是气泡底色（当时是蓝的），huanwei 2026-08-13 明确否掉。
 *    改用「行分割」：行长度之和恒等于张数 ⇒ 空槽在几何上不可能出现。见下方 `albumRowLengths`。
 *    配套地，媒体区不再有任何气泡底色（底色只留给最下方那条 caption），
 *    见 src/styles/components/media-bubble.css 与 album.css。
 *
 * 4. **每个格子自带 `data-message-uuid` 定位锚点** —— 折叠后组内非代表成员在消息列表里
 *    不再产出任何节点，锚点只能挂在格子上；相应地相册态下外层消息行不写该属性。
 *    详见下方 `.album-cell` 处的注释（这是「定位图片后再定位别的消息就报『不在本地库』」
 *    与「定位图片位置不准」两个缺陷的共同根因）。
 *
 * ## 为什么每格复用 FileMessageContent 而不是自己写 <img>
 * 远程媒体必经安全反代（私有 CA 自签，裸 URL 在真 webview 里证书验不过）。
 * 这条不变量由 tests/secure-display-routing.test.ts 静态守着，**每多一个直接渲染
 * <img src={远程URL}> 的地方就多一处会漏的口子**。复用 = 不新增显示点。
 */

import { useMemo, type ReactNode } from 'react';
import { FileMessageContent } from './FileMessageContent';
import { MediaBubbleFrame } from './MediaBubbleFrame';
import type { MessageType } from '../../types/chat';
import type { AlbumNode } from './mediaGroup';

/** 相册项需要的字段（群消息 / 私聊消息都满足） */
export interface AlbumMediaItem {
  message_uuid: string;
  message_content: string;
  message_type: string;
  file_uuid: string | null;
  file_size: number | null;
  file_hash?: string | null;
  media_group_index?: number | null;
  /**
   * 乐观消息的 clientId（真实历史消息为 undefined）。
   *
   * 相册的**每一项都是一条独立消息、各有自己的 clientId** ——
   * 所以进度覆盖层必须按格子挂，不能整组挂一个：一组 9 张里第 3 张失败时，
   * 用户要能只重试那一张（spec §四：单项失败只重试那一项，不整条重发）。
   */
  clientId?: string;
}

interface AlbumMessageProps {
  album: AlbumNode<AlbumMediaItem>;
  /** 预签名 URL 的归属类型，与单条媒体消息同口径 */
  urlType?: 'user' | 'friend' | 'group';
  /** 好友 ID（用于错误上报，与单条媒体消息同口径） */
  friendId?: string;
  /**
   * 时间戳 + 已读状态槽（`.bubble-meta`）。原样透传给 MediaBubbleFrame，由它决定落点：
   * 有配文落配文条内、无配文落网格右下角药丸浮层。本组件不摆它。
   */
  meta?: ReactNode;
  /**
   * 群聊发送者昵称（`.bubble-sender-name`）。同样原样透传给 MediaBubbleFrame：
   * 有配文落大气泡内顶部、无配文落网格左上角药丸浮层。本组件不摆它。
   */
  senderName?: ReactNode;
}

/** 一行最多放几张（再多单格就细到看不清内容了） */
const ALBUM_MAX_ROW_LENGTH = 4;

/**
 * 行分割：把 count 张切成若干行，**每一行都恰好铺满，任何张数都不留空槽**。
 *
 * 为什么不是「固定列数」（这正是被否掉的那版）：固定 2 列时 3 张排成 2×2，
 * 右下角空一整格 —— 那一格露的是气泡底色，huanwei 2026-08-13 原话
 * 「三张图那种奇数图就让其自适应排列铺满」。**行长度之和恒等于张数**是结构性保证：
 * 只要按行长度铺格子，空槽在几何上就不可能出现（tests 里逐 n 核对）。
 *
 * 规则（一条公式 + 一处例外，不是拍脑袋的查表）：
 * - count <= 3 → 一行放完（`[1] / [2] / [3]`）
 * - count === 4 → `[2, 2]`：**唯一的例外**。按公式会得到 `[4]`，
 *   而 280px 宽下 4 连排每格只剩 ~68px，经典 2×2 观感明显更好（Telegram 同此）。
 * - 其余 → 行数取 `ceil(count / 4)`，均分，余数补给**靠后**的行
 *   （5→[2,3] · 6→[3,3] · 7→[3,4] · 8→[4,4] · 9→[3,3,3] · 10→[3,3,4]）
 *
 * 公式而非查表，是因为 expectedCount 来自后端下发的 media_group_count（外部输入），
 * 发送端上限 ALBUM_MAX_ITEMS=10 拦不住一条脏数据 —— 查表在 11 张时就没有条目了，
 * 公式对任意张数都成立。
 *
 * 为什么不用 Telegram 那种「左一大 + 右两小」的马赛克：那需要每张图的真实宽高比，
 * 而 AlbumMediaItem 根本不带 width/height、刚发出的消息 image_width 是 null
 * （见 album.css 里 contain 那段注释）；退一步用固定的非方格子又会拉大 letterbox 带面积，
 * 与「每一张都要完整可见」这条硬判据相冲。方格 + 行分割是零元数据下唯一两全的解。
 */
export function albumRowLengths(count: number): number[] {
  // expectedCount 是外部输入；这里与 Array.from({ length }) 的取整口径对齐，
  // 否则 spans 与格子数会对不上（一个小数就能让「每格一个 span」这条不变量破掉）
  const total = Math.max(0, Math.floor(count));
  if (total < 1) { return []; }
  if (total <= 3) { return [total]; }
  if (total === 4) { return [2, 2]; }

  const rows = Math.ceil(total / ALBUM_MAX_ROW_LENGTH);
  const base = Math.floor(total / rows);
  const longRows = total % rows;
  return Array.from({ length: rows }, (_, i) => (i >= rows - longRows ? base + 1 : base));
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** CSS grid 的排布计划：列基数 + 每一格占几列 */
export interface AlbumGridPlan {
  /** grid-template-columns 的列数，取各行长度的最小公倍数 */
  columnBase: number;
  /** 每格占多少列（长度 === 张数，顺序与格子顺序一致） */
  spans: number[];
}

/**
 * 把行分割翻译成单个 CSS grid：列基数取各行长度的**最小公倍数**，
 * 每格 `span 列基数 / 该行长度`。
 *
 * 用一个 grid 而不是每行一个容器，是为了不动 `.album-cell` 的层级 ——
 * 定位锚点 data-message-uuid 挂在格子上，多插一层容器就要重新核一遍寻址。
 *
 * gap 也是对得上的：列基数 B、行长度 L 时每格跨 B/L 列，
 * 一行 L 格共占 `L * (B/L 列 + (B/L - 1) 个 gap) + (L-1) 个 gap = B 列 + (B-1) 个 gap`
 * —— 与整行等宽，所以变宽的行与不变宽的行左右边缘严丝合缝。
 */
export function albumGridPlan(count: number): AlbumGridPlan {
  const rows = albumRowLengths(count);
  if (rows.length === 0) {
    // repeat(0, 1fr) 是非法值，会让整条 grid-template-columns 被丢弃
    return { columnBase: 1, spans: [] };
  }

  const columnBase = rows.reduce((a, b) => (a * b) / gcd(a, b));
  const spans = rows.flatMap((len) => Array.from({ length: len }, () => columnBase / len));
  return { columnBase, spans };
}

/**
 * 把组内一项的 message_type 收窄成 FileMessageContent 需要的类型。
 *
 * AlbumMediaItem.message_type 是 `string`（为了让私聊 Message 与群聊 GroupMessage
 * 都能结构化满足；后者还多一个 'system'）。相册项按后端约束只可能是媒体，
 * 故这里做一个**全域函数**式收窄：不是 video 就当 image 渲染。
 * 不用 `as` 强转 —— 强转会把「将来混进非媒体类型」这种情况静默放过去。
 */
function albumItemMediaType(rawType: string): MessageType {
  return rawType === 'video' ? 'video' : 'image';
}

export function AlbumMessage({ album, urlType = 'friend', friendId, meta, senderName }: AlbumMessageProps) {
  const { columnBase, spans } = useMemo(
    () => albumGridPlan(album.expectedCount),
    [album.expectedCount],
  );

  // 按位次铺格子：已加载的放真内容，未到货的放占位格。
  // 这样布局只取决于 expectedCount，与"这一刻加载到几张"无关 → loadMore 不会重排。
  const cells = useMemo(() => {
    const byIndex = new Map<number, AlbumMediaItem>();
    for (const item of album.items) {
      if (typeof item.media_group_index === 'number') {
        byIndex.set(item.media_group_index, item);
      }
    }
    return Array.from({ length: album.expectedCount }, (_, i) => byIndex.get(i) ?? null);
  }, [album.items, album.expectedCount]);

  return (
    // 配文与网格共用一个大气泡；无配文时 MediaBubbleFrame 直接吐回网格本身，不多一个节点。
    // 递的是**原始正文**（组首项的 message_content）—— 它到底算不算配文由
    // MediaBubbleFrame.resolveMediaCaption 一处判定：没给配文时后端下发的是
    // 「[图片] 文件名」派生正文，直接当配文渲染就会在每个无配文相册下面显示一行文件名。
    <MediaBubbleFrame content={album.caption} media="album" meta={meta} senderName={senderName}>
      <div
        className="album-grid"
        style={{ gridTemplateColumns: `repeat(${columnBase}, 1fr)` }}
        data-testid="album-grid"
      >
        {cells.map((item, index) => (
          <div
            className="album-cell"
            key={item?.message_uuid ?? `placeholder-${index}`}
            // 这一格横跨几列由行分割算出（albumGridPlan）：行长度之和恒等于张数，
            // 所以每一行都被恰好铺满 —— 3 张不会再排成「2×2 空一格」露出气泡底色。
            style={{ gridColumn: `span ${spans[index]}` }}
            // 🔴 定位锚点必须挂在**格子**上，不能只挂在外层消息行上。
            // 相册把 N 条独立消息折叠成一个气泡、只用组内首位当代表（见 mediaGroup.ts 的
            // `emitted` 跳过分支），于是 media_group_index >= 1 的每一张图/视频在 DOM 里
            // **一个节点都不产出** —— scrollMessageIntoView 靠 [data-message-uuid] 寻址，
            // 查不到就返回 false，用户点搜索结果 / 引用块只会得到「定位失败」。
            // 配套：相册态下外层行**不写**该属性（见 MessageBubble / GroupMessageBubble），
            // 否则代表消息（index=0）会有两个同名锚点，DOM 顺序在前的外层行胜出 ⇒
            // 定位第一张图仍然居中整块相册，B3「位置不准」修不掉。
            // 占位格（该位次尚未加载到）没有 uuid ⇒ 定位不到 —— 那是事实，不是缺陷。
            data-message-uuid={item?.message_uuid}
          >
            {item
              ? (
                <FileMessageContent
                  messageType={albumItemMediaType(item.message_type)}
                  messageContent={item.message_content}
                  fileUuid={item.file_uuid}
                  fileSize={item.file_size}
                  fileHash={item.file_hash}
                  urlType={urlType}
                  friendId={friendId}
                  // 每格各自一把钥匙：这一格在途就只有这一格转圈 / 只重试这一格
                  clientId={item.clientId}
                  displayVariant="album"
                />
              )
              : (
                // 未到货的位次：静默占位，不显示「加载失败」之类的噪音——
                // 它只是还没翻到那一页，不是错误
                <div className="album-cell-placeholder" aria-hidden="true" />
              )}
          </div>
        ))}
      </div>
    </MediaBubbleFrame>
  );
}
