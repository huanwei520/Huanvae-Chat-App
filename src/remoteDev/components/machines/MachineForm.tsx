/**
 * 创建 / 编辑机器表单（模态）
 */

import { useCallback, useEffect, useState } from 'react';
import type { RemoteDevApiClient } from '../../services/apiClient';
import { createMachineService } from '../../services/machineService';
import { useRemoteDevStore } from '../../stores/remoteDevStore';
import type { AuthType } from '../../types/remoteDev';

export function MachineForm({
  api,
  machineId,
  onClose,
}: {
  api: RemoteDevApiClient;
  machineId: string | null;
  onClose: () => void;
}) {
  const setMachines = useRemoteDevStore((s) => s.setMachines);
  const isCreate = machineId === null;

  const [name, setName] = useState('');
  const [hostname, setHostname] = useState('');
  const [port, setPort] = useState('22');
  const [username, setUsername] = useState('');
  const [authType, setAuthType] = useState<AuthType>('password');
  const [credential, setCredential] = useState('');

  const [loadingDetail, setLoadingDetail] = useState(!isCreate);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshList = useCallback(async () => {
    try {
      const list = await createMachineService(api).listMachines();
      setMachines(list);
    } catch {
      /* 列表刷新失败不阻塞关闭 */
    }
  }, [api, setMachines]);

  useEffect(() => {
    if (isCreate) {
      setName('');
      setHostname('');
      setPort('22');
      setUsername('');
      setAuthType('password');
      setCredential('');
      setLoadingDetail(false);
      return;
    }

    let cancelled = false;
    setLoadingDetail(true);
    setError(null);
    void (async () => {
      try {
        const m = await createMachineService(api).getMachine(machineId);
        if (cancelled) {
          return;
        }
        setName(m.name);
        setHostname(m.hostname);
        setPort(String(m.port));
        setUsername(m.username);
        setAuthType(m.auth_type);
        setCredential('');
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : '加载机器详情失败');
        }
      } finally {
        if (!cancelled) {
          setLoadingDetail(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [api, machineId, isCreate]);

  const handleSubmit = async () => {
    setError(null);
    const portNum = Number.parseInt(port, 10);
    if (!name.trim() || !hostname.trim() || !username.trim()) {
      setError('请填写名称、主机名与用户名');
      return;
    }
    if (Number.isNaN(portNum) || portNum < 1 || portNum > 65535) {
      setError('端口须为 1–65535 的整数');
      return;
    }
    if (isCreate && !credential.trim()) {
      setError('请填写密码或 SSH 私钥');
      return;
    }

    setSubmitting(true);
    const svc = createMachineService(api);
    try {
      if (isCreate) {
        await svc.createMachine({
          name: name.trim(),
          hostname: hostname.trim(),
          port: portNum,
          username: username.trim(),
          auth_type: authType,
          credential: credential.trim(),
        });
      } else {
        const params: {
          name?: string;
          hostname?: string;
          port?: number;
          username?: string;
          auth_type?: AuthType;
          credential?: string;
        } = {
          name: name.trim(),
          hostname: hostname.trim(),
          port: portNum,
          username: username.trim(),
          auth_type: authType,
        };
        if (credential.trim()) {
          params.credential = credential.trim();
        }
        await svc.updateMachine(machineId, params);
      }
      void refreshList();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="rd-dialog-overlay"
      role="presentation"
      onClick={() => !submitting && !loadingDetail && onClose()}
    >
      <div
        className="rd-dialog"
        role="dialog"
        aria-labelledby="rd-machine-form-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="rd-machine-form-title" className="rd-dialog-title">
          {isCreate ? '添加机器' : '编辑机器'}
        </h3>

        {error && (
          <p style={{ color: 'var(--status-error)', marginBottom: 12 }}>{error}</p>
        )}

        {loadingDetail ? (
          <div className="rd-loading">加载中…</div>
        ) : (
          <>
            <div className="rd-form-group">
              <label className="rd-form-label" htmlFor="rd-m-name">
                名称
              </label>
              <input
                id="rd-m-name"
                className="rd-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="rd-form-group">
              <label className="rd-form-label" htmlFor="rd-m-host">
                主机名
              </label>
              <input
                id="rd-m-host"
                className="rd-input"
                value={hostname}
                onChange={(e) => setHostname(e.target.value)}
                placeholder="例如：192.168.1.10"
              />
            </div>
            <div className="rd-form-group">
              <label className="rd-form-label" htmlFor="rd-m-port">
                端口
              </label>
              <input
                id="rd-m-port"
                className="rd-input"
                type="number"
                min={1}
                max={65535}
                value={port}
                onChange={(e) => setPort(e.target.value)}
              />
            </div>
            <div className="rd-form-group">
              <label className="rd-form-label" htmlFor="rd-m-user">
                用户名
              </label>
              <input
                id="rd-m-user"
                className="rd-input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div className="rd-form-group">
              <label className="rd-form-label" htmlFor="rd-m-auth">
                认证方式
              </label>
              <select
                id="rd-m-auth"
                className="rd-input rd-select"
                value={authType}
                onChange={(e) => setAuthType(e.target.value as AuthType)}
              >
                <option value="password">密码</option>
                <option value="key">密钥</option>
              </select>
            </div>
            <div className="rd-form-group">
              <label className="rd-form-label" htmlFor="rd-m-cred">
                {authType === 'password' ? '密码' : 'SSH 私钥'}
              </label>
              {authType === 'password' ? (
                <input
                  id="rd-m-cred"
                  className="rd-input"
                  type="password"
                  autoComplete="new-password"
                  value={credential}
                  onChange={(e) => setCredential(e.target.value)}
                  placeholder={isCreate ? '' : '留空则不修改凭据'}
                />
              ) : (
                <textarea
                  id="rd-m-cred"
                  className="rd-input rd-textarea"
                  value={credential}
                  onChange={(e) => setCredential(e.target.value)}
                  placeholder={
                    isCreate
                      ? '粘贴私钥内容'
                      : '留空则不修改凭据；填写则更新私钥'
                  }
                />
              )}
            </div>
            <div className="rd-dialog-actions">
              <button
                type="button"
                className="rd-btn rd-btn-ghost"
                disabled={submitting}
                onClick={onClose}
              >
                取消
              </button>
              <button
                type="button"
                className="rd-btn rd-btn-primary"
                disabled={submitting}
                onClick={() => void handleSubmit()}
              >
                {submitting ? '保存中…' : '保存'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
