/**
 * 机器列表面板
 */

import { useCallback, useEffect, useState, type MouseEvent } from 'react';
import type { RemoteDevApiClient } from '../../services/apiClient';
import { createMachineService } from '../../services/machineService';
import { useRemoteDevStore } from '../../stores/remoteDevStore';
import type { Machine, SetupStatus, SSHTestResult } from '../../types/remoteDev';

function setupBadgeClass(status: SetupStatus | null): string {
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

function setupLabel(status: SetupStatus | null): string {
  switch (status) {
    case 'ready':
      return 'Claude 就绪';
    case 'in_progress':
      return '安装中';
    case 'failed':
      return '安装失败';
    case 'none':
    default:
      return '未安装';
  }
}

export function MachineListPanel({
  api,
  onAdd,
  onEdit,
  onSetup,
}: {
  api: RemoteDevApiClient;
  onAdd: () => void;
  onEdit: (machineId: string) => void;
  onSetup: (machineId: string) => void;
}) {
  const machines = useRemoteDevStore((s) => s.machines);
  const setMachines = useRemoteDevStore((s) => s.setMachines);
  const selectedMachineId = useRemoteDevStore((s) => s.selectedMachineId);
  const setSelectedMachineId = useRemoteDevStore((s) => s.setSelectedMachineId);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sshResultById, setSshResultById] = useState<Record<string, SSHTestResult | null>>({});
  const [sshLoadingId, setSshLoadingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadMachines = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await createMachineService(api).listMachines();
      setMachines(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载机器列表失败');
    } finally {
      setLoading(false);
    }
  }, [api, setMachines]);

  useEffect(() => {
    void loadMachines();
  }, [loadMachines]);

  const handleTestSsh = async (machineId: string, e: MouseEvent) => {
    e.stopPropagation();
    setSshLoadingId(machineId);
    setSshResultById((prev) => ({ ...prev, [machineId]: null }));
    try {
      const res = await createMachineService(api).testSSH(machineId);
      setSshResultById((prev) => ({ ...prev, [machineId]: res }));
    } catch (err) {
      setSshResultById((prev) => ({
        ...prev,
        [machineId]: {
          success: false,
          latency_ms: null,
          message: err instanceof Error ? err.message : '测试失败',
        },
      }));
    } finally {
      setSshLoadingId(null);
    }
  };

  const handleDelete = async (machineId: string, e: MouseEvent) => {
    e.stopPropagation();
    // eslint-disable-next-line no-alert -- 简单确认
    if (!window.confirm('确定删除此机器？')) {
      return;
    }
    setDeletingId(machineId);
    try {
      await createMachineService(api).deleteMachine(machineId);
      if (selectedMachineId === machineId) {
        setSelectedMachineId(null);
      }
      void loadMachines();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="rd-panel">
      <div className="rd-panel-header">
        <h2 className="rd-panel-title">远程机器</h2>
        <button type="button" className="rd-btn rd-btn-primary" onClick={onAdd}>
          添加机器
        </button>
      </div>

      {error && (
        <p style={{ color: 'var(--status-error)', marginBottom: 12 }}>{error}</p>
      )}

      {loading && <div className="rd-loading">加载中…</div>}
      {!loading && machines.length === 0 && (
        <div className="rd-empty">暂无机器，请点击「添加机器」</div>
      )}
      {!loading && machines.length > 0 && (
        <div className="rd-machine-grid">
          {machines.map((m: Machine) => {
            const selected = selectedMachineId === m.machine_id;
            const ssh = sshResultById[m.machine_id];
            return (
              <div
                key={m.machine_id}
                className={`rd-machine-card${selected ? ' selected' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedMachineId(m.machine_id)}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault();
                    setSelectedMachineId(m.machine_id);
                  }
                }}
              >
                <div className="rd-machine-card-header">
                  <span className="rd-machine-name">{m.name}</span>
                </div>
                <div className="rd-machine-info">
                  {m.hostname}:{m.port}
                </div>
                <div className="rd-machine-info">用户：{m.username}</div>
                <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  <span
                    className={
                      m.auth_type === 'key'
                        ? 'rd-badge rd-badge-info'
                        : 'rd-badge rd-badge-neutral'
                    }
                  >
                    {m.auth_type === 'key' ? '密钥' : '密码'}
                  </span>
                  <span className={setupBadgeClass(m.claude_setup_status)}>
                    {setupLabel(m.claude_setup_status)}
                  </span>
                </div>

                {ssh && (
                  <div
                    className="rd-machine-info"
                    style={{
                      marginTop: 8,
                      color: ssh.success ? 'var(--status-success)' : 'var(--status-error)',
                    }}
                  >
                    SSH：{ssh.success ? '成功' : '失败'} ·{' '}
                    {typeof ssh.latency_ms === 'number'
                      ? `${ssh.latency_ms} ms`
                      : '—'}{' '}
                    · {ssh.message}
                  </div>
                )}

                <div className="rd-machine-actions">
                  <button
                    type="button"
                    className="rd-btn rd-btn-ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit(m.machine_id);
                    }}
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    className="rd-btn rd-btn-ghost"
                    disabled={sshLoadingId === m.machine_id}
                    onClick={(e) => void handleTestSsh(m.machine_id, e)}
                  >
                    {sshLoadingId === m.machine_id ? '测试中…' : 'SSH 测试'}
                  </button>
                  <button
                    type="button"
                    className="rd-btn rd-btn-ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedMachineId(m.machine_id);
                    }}
                  >
                    终端
                  </button>
                  <button
                    type="button"
                    className="rd-btn rd-btn-ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedMachineId(m.machine_id);
                    }}
                  >
                    文件
                  </button>
                  <button
                    type="button"
                    className="rd-btn rd-btn-ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSetup(m.machine_id);
                    }}
                  >
                    安装 Claude
                  </button>
                  <button
                    type="button"
                    className="rd-btn rd-btn-danger"
                    disabled={deletingId === m.machine_id}
                    onClick={(e) => void handleDelete(m.machine_id, e)}
                  >
                    {deletingId === m.machine_id ? '删除中…' : '删除'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
