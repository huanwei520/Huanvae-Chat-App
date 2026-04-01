/**
 * Claude Code 安装状态面板（模态）
 */

import { useCallback, useEffect, useState } from 'react';
import type { RemoteDevApiClient } from '../../services/apiClient';
import { createSetupService } from '../../services/setupService';
import type { SetupStatus, SetupStatusResponse } from '../../types/remoteDev';

function statusBadgeClass(status: SetupStatus): string {
  switch (status) {
    case 'ready':
      return 'rd-badge rd-badge-success';
    case 'in_progress':
      return 'rd-badge rd-badge-warning';
    case 'failed':
      return 'rd-badge rd-badge-danger';
    case 'none':
    default:
      return 'rd-badge rd-badge-neutral';
  }
}

function statusLabel(status: SetupStatus): string {
  switch (status) {
    case 'none':
      return '未开始';
    case 'in_progress':
      return '安装进行中';
    case 'ready':
      return '已就绪';
    case 'failed':
      return '安装失败';
    default:
      return status;
  }
}

export function SetupStatusPanel({
  api,
  machineId,
  onClose,
}: {
  api: RemoteDevApiClient;
  machineId: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<SetupStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setError(null);
    try {
      const s = await createSetupService(api).getSetupStatus(machineId);
      setData(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : '获取状态失败');
    } finally {
      setLoading(false);
    }
  }, [api, machineId]);

  useEffect(() => {
    setLoading(true);
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (data?.status !== 'in_progress') {
      return;
    }
    const id = window.setInterval(() => {
      void loadStatus();
    }, 5000);
    return () => window.clearInterval(id);
  }, [data?.status, loadStatus]);

  const handleInstall = async () => {
    setInstalling(true);
    setError(null);
    try {
      await createSetupService(api).startSetup(machineId);
      void loadStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : '启动安装失败');
    } finally {
      setInstalling(false);
    }
  };

  const status = data?.status ?? 'none';
  const showInstall = status === 'none' || status === 'failed';

  return (
    <div
      className="rd-dialog-overlay"
      role="presentation"
      onClick={() => !installing && onClose()}
    >
      <div
        className="rd-dialog"
        role="dialog"
        aria-labelledby="rd-setup-title"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 640 }}
      >
        <h3 id="rd-setup-title" className="rd-dialog-title">
          Claude Code 安装状态
        </h3>

        {error && (
          <p style={{ color: 'var(--status-error)', marginBottom: 12 }}>{error}</p>
        )}

        {loading && !data ? (
          <div className="rd-loading">加载中…</div>
        ) : (
          <>
            <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
              <span>当前状态：</span>
              <span className={statusBadgeClass(status)}>{statusLabel(status)}</span>
            </div>
            {data?.relay_token_name && (
              <p className="rd-machine-info" style={{ marginBottom: 12 }}>
                关联中继 Token：{data.relay_token_name}
              </p>
            )}
            {showInstall && (
              <div style={{ marginBottom: 16 }}>
                <button
                  type="button"
                  className="rd-btn rd-btn-primary"
                  disabled={installing}
                  onClick={() => void handleInstall()}
                >
                  {installing ? '启动中…' : '开始安装'}
                </button>
              </div>
            )}
            <div className="rd-form-label" style={{ marginBottom: 8 }}>
              安装日志
            </div>
            <pre className="rd-setup-log">
              {data?.log?.trim() ? data.log : '（暂无日志）'}
            </pre>
            <div className="rd-dialog-actions">
              <button
                type="button"
                className="rd-btn rd-btn-ghost"
                disabled={installing}
                onClick={onClose}
              >
                关闭
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
