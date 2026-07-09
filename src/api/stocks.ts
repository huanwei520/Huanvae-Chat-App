/**
 * 股票研究域 API 封装
 *
 * 覆盖股票研究窗口所需的只读数据接口，全部经统一数据面（secureFetch）访问
 * `/api/stocks/*`，由 createApiClient 自动解包 ApiResponse.data。
 *
 * 约定（对齐 src/api/miniapps.ts 范式）：
 * - 每个函数第一参为已绑定 serverUrl + token 的 ApiClient；
 * - 薄封装：只拼 path + query，不做 try/catch、不做兜底，错误向上抛给调用方处理；
 * - 字段名 snake_case，镜像后端冻结契约（本文件为消费端镜像，真值源在后端契约，
 *   字段命名/结构以生产真实响应为准，与后端契约链同步）。
 *
 * 数据新鲜度：多数响应带 `fetched_at`（数据抓取时点）/ `as_of`（业务日期），
 * 供 UI 显示"数据时点"，数据源停摆时不伪装新鲜。
 *
 * 说明：本模块只描述"股票研究域"对外接口与字段业务含义，不涉及任何数据来源实现细节。
 * 类型形状均以生产 `/api/stocks/*` 真实响应为准（阶段二真数据联调实核对齐）。
 */

import type { ApiClient } from './client';

// ============================================
// 通用 / 市场
// ============================================

/** 市场标识：A 股沪深 / 美股 / 场内 ETF */
export type StockMarket = 'cn' | 'us' | 'etf';

/** K 线周期 */
export type KlinePeriod = 'daily' | 'weekly';

/** 复权方式：前复权 / 不复权（空串） */
export type KlineAdjust = 'qfq' | '';

// ============================================
// 搜索
// ============================================

/** 搜索结果条目 */
export interface StockSearchItem {
  symbol: string;
  name: string;
  market: StockMarket;
  /** 展示名（可含市场后缀 / 别名归一后的显示文本） */
  display: string;
}

export interface StockSearchResult {
  results: StockSearchItem[];
  fetched_at?: string | null;
  as_of?: string | null;
}

// ============================================
// K 线
// ============================================

/** 单根 K 线（OHLCV，timestamp 为毫秒 UTC） */
export interface StockCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** 成交额（部分市场提供） */
  amount?: number;
}

export interface StockKlineData {
  symbol: string;
  market: StockMarket;
  name: string;
  currency: string;
  candles: StockCandle[];
  fetched_at: string | null;
  /** 业务日期（最新一根 bar 的交易日） */
  as_of?: string | null;
  /** 复权说明（ETF 恒为"不复权"；个股前复权时可省略） */
  adjust_note?: string;
}

// ============================================
// 盘口 / 行情
// ============================================

/** 五档中的单档（量单位「手」，原样透传） */
export interface StockDepthLevel {
  price: number;
  volume: number;
}

/**
 * 盘口五档载荷：买卖各五档 + 可用标记。
 * `available=false`（如美股无 L2 深度）时 bids/asks 可能为空，展示层以此判空。
 */
export interface StockBidAsk {
  /** 买五档（bids[0] = 买一），量单位「手」 */
  bids: StockDepthLevel[];
  /** 卖五档（asks[0] = 卖一），量单位「手」 */
  asks: StockDepthLevel[];
  /** 该标的是否有可用五档盘口 */
  available: boolean;
}

/** 实时行情 + 盘口五档 */
export interface StockQuoteData {
  symbol: string;
  market: StockMarket;
  name: string;
  price: number;
  /** 涨跌额 */
  change: number;
  /** 涨跌幅（百分比数值，如 3.21 表示 +3.21%） */
  change_pct: number;
  open: number;
  high: number;
  low: number;
  prev_close: number;
  volume: number;
  amount: number;
  /** 计价币种（如 CNY / USD） */
  currency: string;
  /** 盘口五档（嵌套载荷，含可用标记） */
  bid_ask: StockBidAsk;
  /** 交易所行情时间戳（源侧时点，可空） */
  timestamp?: string | null;
  /** 业务日期 */
  as_of?: string | null;
  fetched_at: string | null;
  /** ETF 专属：净值 */
  nav?: number | null;
  /** ETF 专属：品类 */
  category?: string;
  /** ETF 专属：子类 */
  sub?: string;
}

// ============================================
// 财报
// ============================================

/** 财报关键指标条目 */
export interface StockFinancialHighlight {
  label: string;
  /** 指标所属报告期 */
  period: string;
  /** 指标数值（原始金额，展示层按「亿/万」格式化） */
  value: number;
}

/** 财报单行（指标名 + 各报告期数值映射） */
export interface StockStatementRow {
  item: string;
  /** 报告期 → 数值（键为报告期标识，如 "20260331"） */
  values: Record<string, number>;
}

/** 财报三表（利润 / 资产负债 / 现金流），各为若干行 */
export interface StockFinancialStatements {
  income: StockStatementRow[];
  balance: StockStatementRow[];
  cashflow: StockStatementRow[];
}

export interface StockFinancialsData {
  symbol: string;
  market: StockMarket;
  /** 计价币种 */
  currency: string;
  /** 报告期列表（表头顺序） */
  periods: string[];
  highlights: StockFinancialHighlight[];
  statements: StockFinancialStatements;
  /** 数据来源标注（业务口径说明，非实现细节） */
  source: string;
  /** 最新报告期日期 */
  as_of?: string | null;
  fetched_at: string | null;
}

// ============================================
// AI 情报
// ============================================

/** 情报 / 政策来源条目（逐条带真实源发布时间） */
export interface StockIntelSource {
  title: string;
  url: string;
  /** 来源渠道名 */
  source: string;
  /** 真实源发布时间（源无日期则为 null，不用抓取时间冒充） */
  published: string | null;
}

/**
 * 情报分节：四个固定维度，每个维度是若干条要点文本。
 * 无内容时后端以占位文案（如"公开渠道暂无明显信号"）填充。
 */
export interface StockIntelSections {
  /** 热点 */
  hotspots: string[];
  /** 政策 */
  policy: string[];
  /** 风险 */
  risks: string[];
  /** 相关新闻 */
  news: string[];
}

export interface StockIntelData {
  symbol: string;
  market: StockMarket;
  /** 标的名（部分响应可能为空串） */
  name?: string;
  summary: string;
  sections: StockIntelSections;
  sources: StockIntelSource[];
  /** 参与文章数 */
  article_count: number;
  /** 生成所用模型标识 */
  model: string;
  /** 生成时间 */
  generated_at?: string | null;
  as_of?: string | null;
  fetched_at: string | null;
}

// ============================================
// 总览首页（政策 + 新闻）
// ============================================

/** 政策条目（一句要点 + 一个标签） */
export interface StockPolicyItem {
  /** 政策要点文本 */
  point: string;
  /** 政策标签（分类） */
  tag: string;
}

export interface StockPolicyBlock {
  summary: string;
  items: StockPolicyItem[];
  /** 政策来源（块级，非每条） */
  sources: StockIntelSource[];
  model: string;
  /** 政策风向生成时间 */
  generated_at?: string | null;
}

/**
 * 新闻条目。
 * 注：生产当前 news 为空（count=0），本形状为业务域镜像，尚未经真数据核实。
 */
export interface StockNewsItem {
  title: string;
  source: string;
  /** 真实源发布时间（源无日期则为 null） */
  published: string | null;
  url: string;
}

export interface StockNewsBlock {
  items: StockNewsItem[];
  count?: number;
}

export interface StockHomeData {
  policy: StockPolicyBlock;
  news: StockNewsBlock;
  as_of?: string | null;
  fetched_at: string | null;
}

// ============================================
// AI 选股排行榜
// ============================================

/** 排行榜单条 */
export interface StockRankingItem {
  rank: number;
  symbol: string;
  /** 标的名（无归一名时为 null，展示层占位） */
  name: string | null;
  market: StockMarket;
  /** AI 综合评分（无有效评分时为 null） */
  score: number | null;
  /** 入选理由（逐条） */
  reasons: string[];
  /** 关联政策（可空） */
  policy_link: string | null;
  /** 关键财务指标（指标名 → 数值映射） */
  key_financials: Record<string, number>;
  /** 流通市值 */
  float_mktcap: number | null;
  /** 平均成交额 */
  avg_amount: number | null;
  /** 入选时价格 */
  price_at_ranking: number | null;
}

export interface StockRankingData {
  as_of: string;
  /** 榜单条目 */
  ranking: StockRankingItem[];
  /** 生成所用模型标识（无榜单数据期为 null） */
  model: string | null;
  /** 政策上下文（恒随榜落库） */
  policy_context: string;
  /** 候选池规模 */
  universe_size: number | null;
  /** 候选数 */
  candidate_count: number;
  generated_at: string | null;
  /** 风险免责声明（恒返回） */
  disclaimer: string;
  /** 无榜单数据时的提示文案（仅该日无数据时出现） */
  note?: string;
  fetched_at?: string | null;
}

/** 手动触发排序响应（202 已受理） */
export interface StockRankingRunResponse {
  job_id: string;
  status: string;
}

// ============================================
// 准确率追踪
// ============================================

/** 单窗口统计（无满窗样本时各值为 null） */
export interface StockAccuracyStat {
  /** 超额收益为正的占比（ratio 0-1，无样本为 null） */
  hit_rate: number | null;
  /** 平均收益（百分数值，0.81 = +0.81%，无样本为 null） */
  avg_return: number | null;
  /** 平均超额收益（百分数值，7.48 = +7.48%，无样本为 null） */
  avg_excess: number | null;
  /** 样本数 */
  n: number;
}

/** top5 与全体对比（单窗口） */
export interface StockTop5VsAllEntry {
  all: StockAccuracyStat;
  top5: StockAccuracyStat;
}

export interface StockAccuracyData {
  /** 窗口标识列表（如 ["1d","5d","20d"]） */
  windows: string[];
  /** 各窗口总体统计（键为窗口标识） */
  overall: Record<string, StockAccuracyStat>;
  /** 各窗口 top5 vs 全体（键为窗口标识） */
  top5_vs_all: Record<string, StockTop5VsAllEntry>;
  /** 基准（沪深300） */
  benchmark: string;
  /** 已参与评估的记录数（0 = 尚无满窗记录） */
  records_evaluated: number;
  /** 计算口径说明 */
  note: string;
  /** 无数据时的提示文案（仅无满窗记录时出现） */
  hint?: string;
  /** 报告生成时间 */
  as_of: string;
  fetched_at: string | null;
}

/** 历史榜单条记录 */
export interface StockTrackHistoryItem {
  as_of: string;
  symbol: string;
  /** 标的名（无归一名时为 null，展示层占位） */
  name: string | null;
  /** 入选排名 */
  rank: number;
  /** 入选时价格 */
  price_at_ranking?: number | null;
  /** 1d 收益（百分数值，0.81 = +0.81%，未满窗为 null） */
  ret_1d: number | null;
  /** 5d 收益（百分数值，未满窗为 null） */
  ret_5d: number | null;
  /** 20d 收益（百分数值，未满窗为 null） */
  ret_20d: number | null;
  /** 1d 超额收益（百分数值，7.48 = +7.48%，未满窗为 null） */
  excess_1d: number | null;
  /** 5d 超额收益（百分数值，未满窗为 null） */
  excess_5d: number | null;
  /** 20d 超额收益（百分数值，未满窗为 null） */
  excess_20d: number | null;
  /** 前向涨幅更新时间（未满窗为 null） */
  returns_updated_at?: string | null;
  is_backfill: boolean;
}

export interface StockTrackHistoryData {
  records: StockTrackHistoryItem[];
  fetched_at?: string | null;
  as_of?: string | null;
}

// ============================================
// ETF
// ============================================

/** ETF 列表单条行情 */
export interface StockEtfItem {
  symbol: string;
  name: string;
  price: number;
  change_pct: number;
  /** 涨跌额 */
  change?: number;
  /** 昨收 */
  prev_close?: number;
  /** 计价币种 */
  currency?: string;
  /** 最新价所属交易日 */
  latest_date?: string;
  /** 市场标识（ETF 为 "etf"） */
  market?: StockMarket;
  /** 子类标签 */
  sub?: string;
  /** 净值（部分品类提供） */
  nav?: number | null;
}

/** ETF 一个品类 */
export interface StockEtfCategory {
  /** 品类名 */
  name: string;
  items: StockEtfItem[];
}

export interface StockEtfListData {
  categories: StockEtfCategory[];
  as_of?: string | null;
  fetched_at: string | null;
  generated_at?: string | null;
  /** 口径说明（如"场内实时价；不复权"） */
  note?: string;
}

// ============================================
// 市场天气
// ============================================

/** regime 色带单点：某交易日的市场 regime + 置信度 */
export interface RegimeBand {
  /** 交易日 'YYYY-MM-DD' */
  as_of: string;
  /** regime 标识（bull / range / bear） */
  regime: string;
  /** 该日置信度（0-1） */
  confidence: number;
}

/**
 * 市场天气：最新一日市场 regime 天气标签 + 近 30 日 regime 色带（决策支持 / 市场语境，非投资建议）。
 *
 * 可空 / 透传字段守卫（吸取空数据 null 穿透教训）：
 * - `fear_greed_score` / `sentiment_label` / `model` 可为 null；`note` 仅无数据时出现。
 * - `breadth` / `features` / `posterior` 为后端透传对象（passthrough object，无则 `{}`），取值需防御 `?.`；
 * - `drivers` / `flags` / `history` 无则 `[]`。
 * - 无数据态：`as_of` 为空串、`regime`/`weather_label` 为空串、`history` 为 `[]`、`fetched_at` 为 null、
 *   `note` 存在 —— 展示层据此走空态。
 */
export interface MarketWeatherData {
  /** 决策交易日 'YYYY-MM-DD'（无数据为空串） */
  as_of: string;
  /** 市场（v1 恒 'cn'） */
  market: string;
  /** 基准指数代码（如 '000300'） */
  index_symbol: string;
  /** regime（bull / range / bear；无数据为空串） */
  regime: string;
  /** 展示天气标签：晴 / 多云 / 阴雨（无数据为空串） */
  weather_label: string;
  /** 综合置信度（0-1） */
  confidence: number;
  /** 恐惧-贪婪指数（0-100；无则 null） */
  fear_greed_score: number | null;
  /** 情绪标签（无则 null） */
  sentiment_label: string | null;
  /** 市场广度摘要 {adv,dec,unchanged,limit_up,limit_down,breadth_pct,adr}（透传对象；无则 {}） */
  breadth: Record<string, unknown>;
  /** 情绪驱动短语（无则 []） */
  drivers: string[];
  /** 提示标 [{code,text}]（无则 []） */
  flags: Array<{ code: string; text: string }>;
  /** 特征 {ret,rv20}（透传对象；无则 {}） */
  features: Record<string, unknown>;
  /** 后验概率 {bull,range,bear}（透传对象；无则 {}） */
  posterior: Record<string, unknown>;
  /** 模型标识（无则 null） */
  model: string | null;
  /** 能力边界免责声明（恒非空；展示层原样透传，不在前端硬编码任何算法描述） */
  disclaimer: string;
  /** 近 30 日 regime 色带，按日期升序（旧→新） */
  history: RegimeBand[];
  /** 仅无数据时出现（"暂无市场天气数据"） */
  note?: string;
  /** 该天气批次生成时间（RFC3339；无数据为 null） */
  fetched_at: string | null;
}

// ============================================
// 搜索
// ============================================

/** 搜索股票 / ETF（读搜索索引，含别名归一） */
export function searchStocks(
  api: ApiClient,
  q: string,
  limit = 10,
): Promise<StockSearchResult> {
  const query = new URLSearchParams({ q, limit: String(limit) });
  return api.get<StockSearchResult>(`/api/stocks/search?${query.toString()}`);
}

// ============================================
// K 线 / 行情
// ============================================

/** 获取个股 K 线（日/周，前复权或不复权） */
export function getKline(
  api: ApiClient,
  symbol: string,
  market: StockMarket,
  period: KlinePeriod = 'daily',
  adjust: KlineAdjust = 'qfq',
): Promise<StockKlineData> {
  const query = new URLSearchParams({ symbol, market, period, adjust });
  return api.get<StockKlineData>(`/api/stocks/kline?${query.toString()}`);
}

/** 获取实时行情 + 盘口五档（打开详情会记录需求信号，用于热集刷新） */
export function getQuote(
  api: ApiClient,
  symbol: string,
  market: StockMarket,
): Promise<StockQuoteData> {
  const query = new URLSearchParams({ symbol, market });
  return api.get<StockQuoteData>(`/api/stocks/quote?${query.toString()}`);
}

/** 获取财报摘要（关键指标 + 三表） */
export function getFinancials(
  api: ApiClient,
  symbol: string,
  market: StockMarket,
): Promise<StockFinancialsData> {
  const query = new URLSearchParams({ symbol, market });
  return api.get<StockFinancialsData>(`/api/stocks/financials?${query.toString()}`);
}

/** 获取 AI 情报（摘要 + 分节 + 逐条真实源） */
export function getIntel(
  api: ApiClient,
  symbol: string,
  market: StockMarket,
): Promise<StockIntelData> {
  const query = new URLSearchParams({ symbol, market });
  return api.get<StockIntelData>(`/api/stocks/intel?${query.toString()}`);
}

// ============================================
// 总览
// ============================================

/** 获取总览首页（政策风向 + 新闻） */
export function getHome(api: ApiClient): Promise<StockHomeData> {
  return api.get<StockHomeData>('/api/stocks/home');
}

/** 获取市场天气（regime 天气标签 + 近 30 日色带；无参，v1 CN-only 沪深300） */
export function getMarketWeather(api: ApiClient): Promise<MarketWeatherData> {
  return api.get<MarketWeatherData>('/api/stocks/market-weather');
}

/** 获取 AI 选股排行榜（不传 date 取最新一期） */
export function getRanking(
  api: ApiClient,
  date?: string,
): Promise<StockRankingData> {
  const query = new URLSearchParams();
  if (date) { query.set('date', date); }
  const qs = query.toString();
  return api.get<StockRankingData>(`/api/stocks/ranking${qs ? `?${qs}` : ''}`);
}

/** 手动触发排序（插入任务请求，返回 202 job 句柄，UI 轮询 ranking 更新） */
export function runRanking(
  api: ApiClient,
  asOf?: string,
): Promise<StockRankingRunResponse> {
  const body: Record<string, unknown> = {};
  if (asOf) { body.as_of = asOf; }
  return api.post<StockRankingRunResponse>('/api/stocks/ranking/run', body);
}

// ============================================
// 准确率追踪
// ============================================

/** 获取准确率（1/5/20d 窗口 + 总体 + top5 对比，基准沪深300） */
export function getAccuracy(api: ApiClient): Promise<StockAccuracyData> {
  return api.get<StockAccuracyData>('/api/stocks/track/accuracy');
}

/** 获取历史榜（含回填标记） */
export function getTrackHistory(
  api: ApiClient,
  limit = 30,
): Promise<StockTrackHistoryData> {
  const query = new URLSearchParams({ limit: String(limit) });
  return api.get<StockTrackHistoryData>(`/api/stocks/track/history?${query.toString()}`);
}

// ============================================
// ETF
// ============================================

/** 获取 ETF 两品类列表 */
export function getEtfList(api: ApiClient): Promise<StockEtfListData> {
  return api.get<StockEtfListData>('/api/stocks/etf/list');
}

/** 获取 ETF K 线（恒不复权，adjust_note:"不复权"） */
export function getEtfKline(
  api: ApiClient,
  symbol: string,
  period: KlinePeriod = 'daily',
): Promise<StockKlineData> {
  const query = new URLSearchParams({ symbol, period });
  return api.get<StockKlineData>(`/api/stocks/etf/kline?${query.toString()}`);
}

/** 获取 ETF 实时行情 + 盘口五档 */
export function getEtfQuote(
  api: ApiClient,
  symbol: string,
): Promise<StockQuoteData> {
  const query = new URLSearchParams({ symbol });
  return api.get<StockQuoteData>(`/api/stocks/etf/quote?${query.toString()}`);
}
