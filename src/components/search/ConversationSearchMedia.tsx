/**
 * 会话内查找结果里的媒体缩略图（图片 / 视频）
 *
 * 单独成文件的两个理由：
 * 1. 它是**每条结果一个 Hook 实例**（useFileCache 按 file_uuid 各自取源），必须是独立组件；
 * 2. 它把 SessionContext（useApi）依赖挡在 ConversationMessageSearch 之外，
 *    列表组件本身仍是纯展示 + DB 查询，测试无需搭整套 Provider。
 *
 * 🔴 显示 src **必须**来自 useFileCache（内部 fileCache.getFileSource / getVideoSource
 * 已经过唯一收口点 resolveDisplayUrl 改写成回环反代 URL）。**不得**把消息行里的
 * `file_url` 裸喂给 `<img>/<video>` —— 私有 CA 自签 leaf 过不了 webview 的系统信任库，
 * 真机上会静默变成裂图（见 .claude/rules/frontend-test.md「所有 X 必经 Y」与
 * tests/secure-display-routing.test.ts）。
 *
 * autoCache 关掉：浏览态一页可能几十个媒体，逐个触发后台下载会把带宽和磁盘打满；
 * 真正要落盘的时机仍在消息气泡本身（FileMessageContent）。
 */

import { useFileCache } from '../../hooks/useFileCache';
import type { LocalMessage } from '../../db';

interface ConversationSearchMediaProps {
  /** 命中消息（取 file_uuid / file_hash / content 作文件名 / conversation_type 定 URL 域） */
  message: LocalMessage;
}

export function ConversationSearchMedia({ message }: ConversationSearchMediaProps) {
  const isVideo = message.content_type === 'video';
  const fileUuid = message.file_uuid ?? '';

  const { src } = useFileCache({
    fileUuid,
    fileHash: message.file_hash,
    fileName: message.content,
    fileType: isVideo ? 'video' : 'image',
    // 本地库里群消息的 conversation_type 是 'group'，其余（好友 / bot）走 friend 域
    urlType: message.conversation_type === 'group' ? 'group' : 'friend',
    autoCache: false,
    enabled: !!fileUuid,
  });

  if (!src) {
    // 取源未完成 / 该消息没有 file_uuid（历史脏数据）：给同尺寸占位，避免列表逐条抖动
    return <div className="conv-msg-search-thumb conv-msg-search-thumb--empty" aria-hidden="true" />;
  }

  if (isVideo) {
    return (
      <video
        className="conv-msg-search-thumb"
        src={src}
        preload="metadata"
        muted
        playsInline
        aria-hidden="true"
      />
    );
  }

  return <img className="conv-msg-search-thumb" src={src} alt="" loading="lazy" />;
}
