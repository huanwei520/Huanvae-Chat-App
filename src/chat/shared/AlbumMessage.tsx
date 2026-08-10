/**
 * 相册（媒体组）气泡内容 —— Telegram 风格网格 + 整组配文
 *
 * @module chat/shared
 * @location src/chat/shared/AlbumMessage.tsx
 *
 * 由 chat/shared/mediaGroup.ts 折叠出的 AlbumNode 驱动，群聊 / 私聊共用同一份。
 *
 * ## 三个设计约束（都不是随手定的）
 *
 * 1. **配文渲染在整组下方，不挂在第一张图上** —— huanwei 明确要的效果是
 *    「视觉上成为一整个整体」。挂在首图上会让它看起来像"第一张的说明"。
 *
 * 2. **格子高度靠 CSS aspect-ratio 预留，不等图片加载** —— 图片加载完再撑开会引发
 *    布局跳动，而消息列表是 column-reverse 的，任何高度跳变都会把用户正在看的位置顶走
 *    （v1.1.26 刚修好「点引用定位不顶起整页」，不能在这里再引入一次）。
 *
 * 3. **缺口用占位格补齐** —— 跨分页拆组时（字段对齐提案 R1）只加载到组的一部分，
 *    按已加载条数排版会让 loadMore 之后相册当着用户面从 7 格重排成 10 格。
 *    故按 expectedCount 排版，未到货的位次渲染成静默占位格。
 *
 * ## 为什么每格复用 FileMessageContent 而不是自己写 <img>
 * 远程媒体必经安全反代（私有 CA 自签，裸 URL 在真 webview 里证书验不过）。
 * 这条不变量由 tests/secure-display-routing.test.ts 静态守着，**每多一个直接渲染
 * <img src={远程URL}> 的地方就多一处会漏的口子**。复用 = 不新增显示点。
 */

import { useMemo } from 'react';
import { FileMessageContent } from './FileMessageContent';
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
}

interface AlbumMessageProps {
  album: AlbumNode<AlbumMediaItem>;
  /** 预签名 URL 的归属类型，与单条媒体消息同口径 */
  urlType?: 'user' | 'friend' | 'group';
  /** 好友 ID（用于错误上报，与单条媒体消息同口径） */
  friendId?: string;
}

/**
 * 网格列数：按组大小选，贴近 Telegram 的观感。
 * 2 张 → 2 列；3/4 张 → 2 列；5 张以上 → 3 列。
 * 用固定列数而不是 auto-fill，是为了让「同样张数的相册在两端长得一样」（两端对齐硬指标）。
 */
export function albumColumns(count: number): number {
  if (count <= 4) { return 2; }
  return 3;
}

export function AlbumMessage({ album, urlType = 'friend', friendId }: AlbumMessageProps) {
  const columns = albumColumns(album.expectedCount);

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
    <div className="album-message">
      <div
        className="album-grid"
        style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}
        data-testid="album-grid"
      >
        {cells.map((item, index) => (
          <div className="album-cell" key={item?.message_uuid ?? `placeholder-${index}`}>
            {item
              ? (
                <FileMessageContent
                  messageType={item.message_type as never}
                  messageContent={item.message_content}
                  fileUuid={item.file_uuid}
                  fileSize={item.file_size}
                  fileHash={item.file_hash}
                  urlType={urlType}
                  friendId={friendId}
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

      {/* 整组配文：在网格**下方**，与整组构成一个整体（不是挂在第一张上） */}
      {album.caption && (
        <div className="album-caption">{album.caption}</div>
      )}
    </div>
  );
}
