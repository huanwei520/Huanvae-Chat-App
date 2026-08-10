/**
 * 搜索关键词高亮（全局搜索 + 会话内搜索共用）
 *
 * 把文本按 query 切片，命中子串包成 `<mark className="msg-search-mark">`。
 * 不区分大小写；query 为空或文本为空时原样返回。
 */

/** 把文本按 query 切片并高亮匹配子串（不区分大小写） */
export function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query.trim() || !text) {
    return text;
  }
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const idx = lower.indexOf(q, cursor);
    if (idx === -1) {
      parts.push(text.slice(cursor));
      break;
    }
    if (idx > cursor) {
      parts.push(text.slice(cursor, idx));
    }
    parts.push(
      <mark key={idx} className="msg-search-mark">
        {text.slice(idx, idx + q.length)}
      </mark>,
    );
    cursor = idx + q.length;
  }
  return <>{parts}</>;
}
