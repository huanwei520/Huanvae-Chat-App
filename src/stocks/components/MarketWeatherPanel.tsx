/**
 * 市场天气面板（总览视图）
 *
 * 展示最新一日市场 regime 天气标签（晴/多云/阴雨，按 regime 配色：bull 暖 / range 中性 / bear 冷）、
 * 置信度、市场情绪（fear_greed + 标签）、市场广度摘要、提示标 chips、近 30 日 regime 色带、
 * 以及 API 返回的免责声明（原样透传，不在前端硬编码任何算法描述）。
 *
 * 决策支持 / 市场语境仪表，非投资建议、非涨跌预测。
 *
 * 动画：进场 stagger（fade+y，GSAP）。登记：.market-weather-row（transform/opacity）。
 * 空数据（as_of 空 / note 存在）→ 优雅空态文案（镜像 PanelBody empty 处理）。
 */

import { useRef } from 'react';
import { PanelBody } from './PanelBody';
import { useStockIntro } from '../animations';
import { formatDataTime, formatPercent } from '../format';
import type { MarketWeatherData } from '../../api/stocks';

interface MarketWeatherPanelProps {
  data: MarketWeatherData | null;
  loading: boolean;
  error: string | null;
}

/** regime → 天气展示词（色带格 title 用；主标签仍以 API 的 weather_label 为准）。 */
function regimeWeather(regime: string): string {
  if (regime === 'bull') { return '晴'; }
  if (regime === 'range') { return '多云'; }
  if (regime === 'bear') { return '阴雨'; }
  return '—';
}

/** 透传对象字段安全取数：非有限数值一律 null（防 null/undefined/字符串穿透）。 */
function readNum(obj: Record<string, unknown> | null | undefined, key: string): number | null {
  const v = obj?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function MarketWeatherPanel({ data, loading, error }: MarketWeatherPanelProps) {
  const scopeRef = useRef<HTMLElement>(null);

  useStockIntro(
    scopeRef,
    ({ reduce, from }) => {
      from('.market-weather-row', {
        opacity: 0,
        y: 12,
        duration: reduce ? 0 : 0.35,
        stagger: reduce ? 0 : 0.05,
        overwrite: 'auto',
      });
    },
    [data],
  );

  // 无数据态：as_of 空串 / note 存在 / data 为 null（含 fakeApi 未命中返 {} 的空对象）→ 走空态。
  const hasData = !!data && !!data.as_of && !data.note;

  // 以下取值仅在 hasData 分支消费，但一律防御（透传对象/可空字段可能缺失）。
  const weatherLabel = data?.weather_label ?? '';
  const regime = data?.regime ?? '';
  const confidence = typeof data?.confidence === 'number' ? data.confidence : 0;
  const fearGreed = data?.fear_greed_score;
  const sentimentLabel = data?.sentiment_label;
  const breadth = data?.breadth;
  const flags = Array.isArray(data?.flags) ? data.flags : [];
  const history = Array.isArray(data?.history) ? data.history : [];
  const disclaimer = data?.disclaimer ?? '';

  const adv = readNum(breadth, 'adv');
  const dec = readNum(breadth, 'dec');
  const limitUp = readNum(breadth, 'limit_up');
  const limitDown = readNum(breadth, 'limit_down');
  const hasBreadth = adv !== null || dec !== null || limitUp !== null || limitDown !== null;

  return (
    <section className="stocks-panel market-weather-panel" ref={scopeRef}>
      <div className="stock-panel-head">
        <span className="stock-panel-title">市场天气</span>
        {hasData && (
          <span className="stock-panel-time">数据时点：{formatDataTime(data?.fetched_at)}</span>
        )}
      </div>

      <PanelBody
        loading={loading}
        error={error}
        isEmpty={!hasData}
        loadingMessage="加载市场天气..."
        emptyMessage="暂无市场天气数据"
      >
        <>
          {/* ① 天气标签大字 + ② 置信度（按 regime 配色） */}
          <div className="market-weather-row market-weather-hero" data-regime={regime || 'range'}>
            <span className="market-weather-label">{weatherLabel || '—'}</span>
            <div className="market-weather-hero-meta">
              {data?.as_of && <span className="market-weather-asof">{data.as_of}</span>}
              <span className="market-weather-confidence">
                置信度 {formatPercent(confidence * 100, 0)}
              </span>
            </div>
          </div>

          {/* ③ 市场情绪（fear_greed + 情绪标签；分值缺失则整行不渲染） */}
          {typeof fearGreed === 'number' && Number.isFinite(fearGreed) && (
            <div className="market-weather-row market-weather-metric">
              <span className="market-weather-metric-label">市场情绪</span>
              <span className="market-weather-metric-value">
                {sentimentLabel && (
                  <span className="market-weather-sentiment-tag">{sentimentLabel}</span>
                )}
                <span className="stock-num">{fearGreed.toFixed(0)}</span>
              </span>
            </div>
          )}

          {/* ④ 广度摘要（涨/跌家数 + 涨停/跌停；透传对象缺失整块不渲染） */}
          {hasBreadth && (
            <div className="market-weather-row market-weather-metric">
              <span className="market-weather-metric-label">市场广度</span>
              <span className="market-weather-metric-value market-weather-breadth">
                {adv !== null && (
                  <span className="stock-dir--up stock-num">涨 {adv}</span>
                )}
                {dec !== null && (
                  <span className="stock-dir--down stock-num">跌 {dec}</span>
                )}
                {limitUp !== null && (
                  <span className="stock-dir--up stock-num">涨停 {limitUp}</span>
                )}
                {limitDown !== null && (
                  <span className="stock-dir--down stock-num">跌停 {limitDown}</span>
                )}
              </span>
            </div>
          )}

          {/* ⑤ 提示标 chips（空数组不渲染区块） */}
          {flags.length > 0 && (
            <div className="market-weather-row market-weather-flags">
              {flags.map((f) => (
                <span key={f.code} className="market-weather-chip" title={f.code}>
                  {f.text}
                </span>
              ))}
            </div>
          )}

          {/* ⑥ 近 N 日 regime 色带（每日一格按 regime 着色） */}
          {history.length > 0 && (
            <div className="market-weather-row market-weather-band-wrap">
              <span className="market-weather-metric-label">近 {history.length} 日</span>
              <div
                className="market-weather-band"
                role="img"
                aria-label={`近 ${history.length} 日市场 regime 色带`}
              >
                {history.map((h, i) => (
                  <span
                    key={`${h.as_of}-${i}`}
                    className="market-weather-band-cell"
                    data-regime={h.regime || 'range'}
                    title={`${h.as_of} · ${regimeWeather(h.regime)}`}
                  />
                ))}
              </div>
            </div>
          )}

          {/* ⑦ 免责声明（恒展示，原样透传 API 文案） */}
          {disclaimer && <p className="market-weather-row market-weather-disclaimer">{disclaimer}</p>}
        </>
      </PanelBody>
    </section>
  );
}
