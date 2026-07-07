/**
 * 标的 / 错误分类纯函数
 *
 * 供个股详情视图与面板收口点判定：
 *   - isIndexSymbol：是不是指数（指数无 AI 情报 / 财报，详情隐藏这两面板）。
 *   - isSnapshotMissing：后端 404「快照不存在」判定（这类"暂无数据"走优雅灰字空态，
 *     区别于网络 / 500 真错误的红字报错）。
 */

/**
 * 指数标的：symbol 以 `^` 开头（^IXIC / ^NDX / ^GSPC / ^DJI 等）。
 * 指数天然没有个股维度的 AI 情报 / 财报，详情视图据此隐藏这两面板。
 */
export function isIndexSymbol(symbol: string): boolean {
  return symbol.startsWith('^');
}

/**
 * 「快照不存在」类错误（后端 404）判定。
 *
 * 需求驱动端点（K 线 / 情报 / 财报）在快照尚未生成、或该标的天然无此数据时返回 404，
 * 错误文案含"快照不存在""不存在"（英文源亦兼容 "not found" / "404"）。这类"暂无数据"
 * 应走优雅灰字空态，而非红字"加载失败"；网络 / 500 等真错误不含这些文案，仍红字报错。
 *
 * 注：ApiClient（src/api/client.ts）对 `!response.ok` 抛出的是错误文案字符串（不带 HTTP
 * 状态码），故只能按文案判定，不能按 status 码。
 */
export function isSnapshotMissing(error: string | null | undefined): boolean {
  if (!error) { return false; }
  const lower = error.toLowerCase();
  return error.includes('不存在') || lower.includes('not found') || lower.includes('404');
}
