/**
 * 用量统计面板
 */

import { useCallback, useEffect, useState } from 'react';
import type { RemoteDevApiClient } from '../../services/apiClient';
import { createRelayTokenService } from '../../services/relayTokenService';
import type { DailyUsage, UsageRecord } from '../../types/remoteDev';

export function UsagePanel({ api }: { api: RemoteDevApiClient }) {
  const [daily, setDaily] = useState<DailyUsage[]>([]);
  const [records, setRecords] = useState<UsageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const relay = createRelayTokenService(api);
      const [d, r] = await Promise.all([
        relay.getDailyUsage(),
        relay.getUsage(100, 0),
      ]);
      setDaily(d);
      setRecords(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载用量失败');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="rd-panel">
      <div className="rd-panel-header">
        <h2 className="rd-panel-title">用量统计</h2>
      </div>

      {error && (
        <p style={{ color: 'var(--status-error)', marginBottom: 12 }}>{error}</p>
      )}

      {loading ? (
        <div className="rd-loading">加载中…</div>
      ) : (
        <>
          <h3 className="rd-panel-title" style={{ fontSize: 14, marginBottom: 12 }}>
            按日汇总
          </h3>
          {daily.length === 0 ? (
            <div className="rd-empty">暂无按日数据</div>
          ) : (
            <div className="rd-usage-stats">
              {daily.map((d) => (
                <div key={d.date} className="rd-stat-card">
                  <div className="rd-stat-value">{d.request_count}</div>
                  <div className="rd-stat-label">请求数 · {d.date}</div>
                  <div
                    className="rd-stat-label"
                    style={{ marginTop: 8, lineHeight: 1.5 }}
                  >
                    输入 {d.total_input_tokens.toLocaleString()} · 输出{' '}
                    {d.total_output_tokens.toLocaleString()} · 缓存读取{' '}
                    {d.total_cache_read_tokens.toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}

          <h3 className="rd-panel-title" style={{ fontSize: 14, margin: '20px 0 12px' }}>
            最近请求明细
          </h3>
          {records.length === 0 ? (
            <div className="rd-empty">暂无明细记录</div>
          ) : (
            <table className="rd-table">
              <thead>
                <tr>
                  <th>模型</th>
                  <th>输入 Token</th>
                  <th>输出 Token</th>
                  <th>缓存读取</th>
                  <th>耗时</th>
                  <th>状态码</th>
                  <th>时间</th>
                </tr>
              </thead>
              <tbody>
                {records.map((u) => (
                  <tr key={u.usage_id}>
                    <td>{u.model}</td>
                    <td>{u.input_tokens.toLocaleString()}</td>
                    <td>{u.output_tokens.toLocaleString()}</td>
                    <td>{u.cache_read_tokens.toLocaleString()}</td>
                    <td>
                      {typeof u.request_duration_ms === 'number'
                        ? `${u.request_duration_ms} ms`
                        : '—'}
                    </td>
                    <td>{u.status_code ?? '—'}</td>
                    <td>{new Date(u.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
