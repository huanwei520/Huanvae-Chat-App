/**
 * Claude 对话面板
 *
 * 通过 WebSocket 连接 /ws/claude-dialog/{machine_id} 接收流式事件
 * 支持 embedded 模式（无外层面板包装，适配 IDE 侧边栏）
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RemoteDevApiClient } from '../../services/apiClient';
import { createSessionService } from '../../services/sessionService';
import { useRemoteDevStore } from '../../stores/remoteDevStore';
import type { ClaudeDialogEvent, ClaudeSession } from '../../types/remoteDev';
import { DialogMessage } from './DialogMessage';

type DialogState = 'idle' | 'starting' | 'streaming' | 'completed' | 'error';

export function DialogPanel({ api, embedded }: { api: RemoteDevApiClient; embedded?: boolean }) {
  const selectedMachineId = useRemoteDevStore((s) => s.selectedMachineId);
  const machines = useRemoteDevStore((s) => s.machines);
  const selected = machines.find((m) => m.machine_id === selectedMachineId);

  const [workingDir, setWorkingDir] = useState('');
  const [prompt, setPrompt] = useState('');
  const [state, setState] = useState<DialogState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<ClaudeDialogEvent[]>([]);
  const [sessions, setSessions] = useState<ClaudeSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events]);

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const list = await createSessionService(api).listSessions();
      setSessions(list);
    } catch {
      // ignore
    } finally {
      setSessionsLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const connectWs = useCallback((sessionId: string) => {
    if (!selectedMachineId) return;

    const serverUrl = api.getServerUrl();
    const token = api.getAccessToken();
    const wsProto = serverUrl.startsWith('https') ? 'wss' : 'ws';
    const host = serverUrl.replace(/^https?:\/\//, '');
    const url = `${wsProto}://${host}/ws/claude-dialog/${selectedMachineId}?token=${encodeURIComponent(token)}&session=${encodeURIComponent(sessionId)}`;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setState('streaming');
    };

    ws.onmessage = (ev) => {
      try {
        const event = JSON.parse(ev.data as string) as ClaudeDialogEvent;
        setEvents((prev) => [...prev, event]);

        if (event.type === 'result') {
          setState('completed');
        }
      } catch {
        // ignore unparseable
      }
    };

    ws.onclose = () => {
      setState((prev) => prev === 'streaming' ? 'completed' : prev);
    };

    ws.onerror = () => {
      setState('error');
      setError('WebSocket 连接失败');
    };
  }, [api, selectedMachineId]);

  const handleStart = useCallback(async () => {
    if (!selectedMachineId) return;

    const wd = workingDir.trim();
    const p = prompt.trim();
    if (!wd || !p) {
      setError('请填写工作目录与提示内容');
      return;
    }

    setError(null);
    setEvents([]);
    setState('starting');

    try {
      const session = await createSessionService(api).startSession(selectedMachineId, {
        working_dir: wd,
        prompt: p,
      });
      connectWs(session.session_id);
      void loadSessions();
    } catch (e) {
      setState('error');
      setError(e instanceof Error ? e.message : '启动会话失败');
    }
  }, [api, selectedMachineId, workingDir, prompt, connectWs, loadSessions]);

  useEffect(() => {
    return () => {
      wsRef.current?.close();
    };
  }, []);

  if (!selectedMachineId || !selected) {
    return (
      <div className={embedded ? '' : 'rd-panel'}>
        {!embedded && (
          <div className="rd-panel-header">
            <h2 className="rd-panel-title">Claude 对话</h2>
          </div>
        )}
        <div className="rd-empty">请先选择一台机器</div>
      </div>
    );
  }

  const isActive = state === 'starting' || state === 'streaming';
  const setupReady = selected.claude_setup_status === 'ready';

  const content = (
    <>
      {/* setup_status 前置检查 — 文档第⑨条：只有 ready 才可发起对话 */}
      {!setupReady && (
        <div style={{
          padding: '12px 14px',
          marginBottom: 12,
          borderRadius: 8,
          background: 'var(--primary-subtle, rgba(59,130,246,0.06))',
          border: '1px solid var(--border-subtle)',
          fontSize: 13,
          color: 'var(--text-secondary)',
          lineHeight: 1.6,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text-primary)' }}>
            Claude Code 未就绪
          </div>
          {selected.claude_setup_status === 'none' && '请先在机器管理中安装 Claude Code。'}
          {selected.claude_setup_status === 'in_progress' && '安装正在进行中，请等待完成后再发起对话。'}
          {selected.claude_setup_status === 'failed' && '安装失败，请在机器管理中重新安装。'}
          {!selected.claude_setup_status && '请先在机器管理中安装 Claude Code。'}
        </div>
      )}

      {/* 状态指示 */}
      {state !== 'idle' && (
        <div style={{ marginBottom: 8 }}>
          <span className={`rd-badge ${
            state === 'streaming' ? 'rd-badge-success' :
            state === 'starting' ? 'rd-badge-warning' :
            state === 'completed' ? 'rd-badge-info' :
            'rd-badge-danger'
          }`}>
            {state === 'streaming' ? '对话中' :
             state === 'starting' ? '启动中' :
             state === 'completed' ? '已完成' :
             '错误'}
          </span>
        </div>
      )}

      {error && (
        <p style={{ color: 'var(--status-error)', fontSize: 12, marginBottom: 8 }}>{error}</p>
      )}

      {/* 启动表单 — 仅 setup_status === 'ready' 时可用 */}
      {!isActive && (
        <>
          <div className="rd-form-group">
            <label className="rd-form-label" htmlFor="rd-dialog-wd">工作目录</label>
            <input
              id="rd-dialog-wd"
              className="rd-input"
              value={workingDir}
              onChange={(e) => setWorkingDir(e.target.value)}
              placeholder="/path/to/project"
              disabled={isActive || !setupReady}
              style={{ fontSize: 13, padding: '8px 10px' }}
            />
          </div>
          <div className="rd-form-group">
            <label className="rd-form-label" htmlFor="rd-dialog-prompt">初始提示</label>
            <textarea
              id="rd-dialog-prompt"
              className="rd-input rd-textarea"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="描述你希望 Claude 完成的任务…"
              disabled={isActive || !setupReady}
              style={{ fontSize: 13, padding: '8px 10px', minHeight: 60 }}
            />
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            <button
              type="button"
              className="rd-btn rd-btn-primary rd-btn-sm"
              disabled={isActive || !setupReady}
              onClick={() => void handleStart()}
              title={!setupReady ? 'Claude Code 未安装或安装失败' : undefined}
            >
              开始会话
            </button>
            {state === 'completed' && (
              <button
                type="button"
                className="rd-btn rd-btn-ghost rd-btn-sm"
                onClick={() => { setState('idle'); setEvents([]); setError(null); }}
              >
                新建
              </button>
            )}
          </div>
        </>
      )}

      {/* 消息流 */}
      {events.length > 0 && (
        <div className="rd-dialog-messages" style={{ maxHeight: embedded ? undefined : 500, overflowY: 'auto' }}>
          {events.map((event, i) => (
            <DialogMessage key={i} event={event} />
          ))}
          <div ref={messagesEndRef} />
        </div>
      )}

      {isActive && (
        <div className="rd-loading" style={{ padding: 12, fontSize: 12 }}>
          {state === 'starting' ? '正在启动会话…' : '接收事件中…'}
        </div>
      )}

      {/* 历史会话 */}
      {sessions.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <button
            type="button"
            className="rd-btn rd-btn-ghost rd-btn-sm"
            onClick={() => setShowHistory(!showHistory)}
            style={{ width: '100%', textAlign: 'left', fontSize: 12 }}
          >
            {showHistory ? '▼' : '▶'} 历史会话 ({sessions.length})
          </button>
          {showHistory && (
            <>
              {sessionsLoading && <div className="rd-loading" style={{ padding: 8 }}>加载中…</div>}
              <div style={{ maxHeight: 200, overflowY: 'auto', marginTop: 6 }}>
                {sessions.map((s) => (
                  <div key={s.session_id} style={{
                    padding: '4px 8px',
                    fontSize: 11,
                    borderBottom: '1px solid var(--border-subtle)',
                    color: 'var(--text-muted)',
                    display: 'flex',
                    justifyContent: 'space-between',
                  }}>
                    <span style={{ fontFamily: 'monospace' }}>{s.session_id.slice(0, 10)}…</span>
                    <span>{new Date(s.started_at).toLocaleDateString()}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </>
  );

  if (embedded) return content;

  return (
    <div className="rd-panel">
      <div className="rd-panel-header">
        <h2 className="rd-panel-title">Claude 对话 · {selected.name}</h2>
      </div>
      {content}
    </div>
  );
}
