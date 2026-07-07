/**
 * 股票研究域 API 封装单元测试（src/api/stocks.ts）
 *
 * 用假 ApiClient（get/post 为 vi.fn）验证每个函数：
 *   - 正常：以正确 path/query 调用 api.get/post，并返回解包后的数据；
 *   - 异常：api 抛错时函数原样向上抛（薄封装不 try/catch 不兜底）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ApiClient } from '../../src/api/client';
import * as stocks from '../../src/api/stocks';

function makeApi() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
    getBaseUrl: vi.fn(),
    getAccessToken: vi.fn(),
    refreshAccessToken: vi.fn(),
  } as unknown as ApiClient & {
    get: ReturnType<typeof vi.fn>;
    post: ReturnType<typeof vi.fn>;
  };
}

describe('股票 API 封装 (api/stocks)', () => {
  let api: ReturnType<typeof makeApi>;

  beforeEach(() => {
    api = makeApi();
  });

  // ---- 正常路径：path/query 正确 + 返回数据 ----

  it('searchStocks 正常：拼 q+limit，返回 results', async () => {
    api.get.mockResolvedValue({ results: [] });
    const out = await stocks.searchStocks(api, '茅台', 5);
    expect(api.get).toHaveBeenCalledWith('/api/stocks/search?q=%E8%8C%85%E5%8F%B0&limit=5');
    expect(out).toEqual({ results: [] });
  });

  it('getKline 正常：拼 symbol/market/period/adjust', async () => {
    api.get.mockResolvedValue({ candles: [] });
    await stocks.getKline(api, '600519', 'cn', 'weekly', 'qfq');
    expect(api.get).toHaveBeenCalledWith(
      '/api/stocks/kline?symbol=600519&market=cn&period=weekly&adjust=qfq',
    );
  });

  it('getQuote 正常：拼 symbol/market', async () => {
    api.get.mockResolvedValue({ symbol: '600519' });
    const out = await stocks.getQuote(api, '600519', 'cn');
    expect(api.get).toHaveBeenCalledWith('/api/stocks/quote?symbol=600519&market=cn');
    expect(out).toEqual({ symbol: '600519' });
  });

  it('getFinancials 正常', async () => {
    api.get.mockResolvedValue({ periods: [] });
    await stocks.getFinancials(api, 'AAPL', 'us');
    expect(api.get).toHaveBeenCalledWith('/api/stocks/financials?symbol=AAPL&market=us');
  });

  it('getIntel 正常', async () => {
    api.get.mockResolvedValue({ summary: '' });
    await stocks.getIntel(api, 'AAPL', 'us');
    expect(api.get).toHaveBeenCalledWith('/api/stocks/intel?symbol=AAPL&market=us');
  });

  it('getHome 正常：无 query', async () => {
    api.get.mockResolvedValue({ policy: {}, news: {} });
    await stocks.getHome(api);
    expect(api.get).toHaveBeenCalledWith('/api/stocks/home');
  });

  it('getMarketWeather 正常：无 query', async () => {
    api.get.mockResolvedValue({ regime: 'bull', weather_label: '晴', history: [] });
    const out = await stocks.getMarketWeather(api);
    expect(api.get).toHaveBeenCalledWith('/api/stocks/market-weather');
    expect(out).toEqual({ regime: 'bull', weather_label: '晴', history: [] });
  });

  it('getRanking 正常：带 date', async () => {
    api.get.mockResolvedValue({ items: [] });
    await stocks.getRanking(api, '2026-07-04');
    expect(api.get).toHaveBeenCalledWith('/api/stocks/ranking?date=2026-07-04');
  });

  it('getRanking 正常：不带 date 时无 query', async () => {
    api.get.mockResolvedValue({ items: [] });
    await stocks.getRanking(api);
    expect(api.get).toHaveBeenCalledWith('/api/stocks/ranking');
  });

  it('runRanking 正常：POST 带 as_of', async () => {
    api.post.mockResolvedValue({ job_id: 'j1', status: 'accepted' });
    const out = await stocks.runRanking(api, '2026-07-04');
    expect(api.post).toHaveBeenCalledWith('/api/stocks/ranking/run', { as_of: '2026-07-04' });
    expect(out).toEqual({ job_id: 'j1', status: 'accepted' });
  });

  it('runRanking 正常：不带 as_of 时 body 为空对象', async () => {
    api.post.mockResolvedValue({ job_id: 'j2', status: 'accepted' });
    await stocks.runRanking(api);
    expect(api.post).toHaveBeenCalledWith('/api/stocks/ranking/run', {});
  });

  it('getAccuracy 正常', async () => {
    api.get.mockResolvedValue({ windows: [] });
    await stocks.getAccuracy(api);
    expect(api.get).toHaveBeenCalledWith('/api/stocks/track/accuracy');
  });

  it('getTrackHistory 正常：带 limit', async () => {
    api.get.mockResolvedValue({ records: [] });
    await stocks.getTrackHistory(api, 10);
    expect(api.get).toHaveBeenCalledWith('/api/stocks/track/history?limit=10');
  });

  it('getEtfList 正常', async () => {
    api.get.mockResolvedValue({ categories: [] });
    await stocks.getEtfList(api);
    expect(api.get).toHaveBeenCalledWith('/api/stocks/etf/list');
  });

  it('getEtfKline 正常：拼 symbol/period', async () => {
    api.get.mockResolvedValue({ candles: [] });
    await stocks.getEtfKline(api, '510300', 'daily');
    expect(api.get).toHaveBeenCalledWith('/api/stocks/etf/kline?symbol=510300&period=daily');
  });

  it('getEtfQuote 正常：拼 symbol', async () => {
    api.get.mockResolvedValue({ symbol: '510300' });
    await stocks.getEtfQuote(api, '510300');
    expect(api.get).toHaveBeenCalledWith('/api/stocks/etf/quote?symbol=510300');
  });

  // ---- 默认参数：默认值必须反映在 URL 上（默认值被改会失败）----

  it('searchStocks 默认 limit=10', async () => {
    api.get.mockResolvedValue({ results: [] });
    await stocks.searchStocks(api, 'x');
    expect(api.get).toHaveBeenCalledWith('/api/stocks/search?q=x&limit=10');
  });

  it('getKline 默认 period=daily&adjust=qfq', async () => {
    api.get.mockResolvedValue({ candles: [] });
    await stocks.getKline(api, '600519', 'cn');
    expect(api.get).toHaveBeenCalledWith('/api/stocks/kline?symbol=600519&market=cn&period=daily&adjust=qfq');
  });

  it('getTrackHistory 默认 limit=30', async () => {
    api.get.mockResolvedValue({ records: [] });
    await stocks.getTrackHistory(api);
    expect(api.get).toHaveBeenCalledWith('/api/stocks/track/history?limit=30');
  });

  it('getEtfKline 默认 period=daily', async () => {
    api.get.mockResolvedValue({ candles: [] });
    await stocks.getEtfKline(api, '510300');
    expect(api.get).toHaveBeenCalledWith('/api/stocks/etf/kline?symbol=510300&period=daily');
  });

  // ---- 异常路径：api 抛错时原样向上抛（无 try/catch 兜底）----

  it('searchStocks 异常：api.get 抛错时向上抛', async () => {
    api.get.mockRejectedValue(new Error('boom'));
    await expect(stocks.searchStocks(api, 'x')).rejects.toThrow('boom');
  });

  it('getKline 异常：向上抛', async () => {
    api.get.mockRejectedValue(new Error('kline-fail'));
    await expect(stocks.getKline(api, '600519', 'cn')).rejects.toThrow('kline-fail');
  });

  it('getQuote 异常：向上抛', async () => {
    api.get.mockRejectedValue(new Error('quote-fail'));
    await expect(stocks.getQuote(api, '600519', 'cn')).rejects.toThrow('quote-fail');
  });

  it('getFinancials 异常：向上抛', async () => {
    api.get.mockRejectedValue(new Error('fin-fail'));
    await expect(stocks.getFinancials(api, 'AAPL', 'us')).rejects.toThrow('fin-fail');
  });

  it('getIntel 异常：向上抛', async () => {
    api.get.mockRejectedValue(new Error('intel-fail'));
    await expect(stocks.getIntel(api, 'AAPL', 'us')).rejects.toThrow('intel-fail');
  });

  it('getHome 异常：向上抛', async () => {
    api.get.mockRejectedValue(new Error('home-fail'));
    await expect(stocks.getHome(api)).rejects.toThrow('home-fail');
  });

  it('getMarketWeather 异常：向上抛', async () => {
    api.get.mockRejectedValue(new Error('weather-fail'));
    await expect(stocks.getMarketWeather(api)).rejects.toThrow('weather-fail');
  });

  it('getRanking 异常：向上抛', async () => {
    api.get.mockRejectedValue(new Error('rank-fail'));
    await expect(stocks.getRanking(api)).rejects.toThrow('rank-fail');
  });

  it('runRanking 异常：向上抛', async () => {
    api.post.mockRejectedValue(new Error('run-fail'));
    await expect(stocks.runRanking(api)).rejects.toThrow('run-fail');
  });

  it('getAccuracy 异常：向上抛', async () => {
    api.get.mockRejectedValue(new Error('acc-fail'));
    await expect(stocks.getAccuracy(api)).rejects.toThrow('acc-fail');
  });

  it('getTrackHistory 异常：向上抛', async () => {
    api.get.mockRejectedValue(new Error('hist-fail'));
    await expect(stocks.getTrackHistory(api)).rejects.toThrow('hist-fail');
  });

  it('getEtfList 异常：向上抛', async () => {
    api.get.mockRejectedValue(new Error('etf-fail'));
    await expect(stocks.getEtfList(api)).rejects.toThrow('etf-fail');
  });

  it('getEtfKline 异常：向上抛', async () => {
    api.get.mockRejectedValue(new Error('etfk-fail'));
    await expect(stocks.getEtfKline(api, '510300')).rejects.toThrow('etfk-fail');
  });

  it('getEtfQuote 异常：向上抛', async () => {
    api.get.mockRejectedValue(new Error('etfq-fail'));
    await expect(stocks.getEtfQuote(api, '510300')).rejects.toThrow('etfq-fail');
  });
});
