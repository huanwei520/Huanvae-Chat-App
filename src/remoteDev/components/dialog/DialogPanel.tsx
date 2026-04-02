/**
 * Claude 多轮对话面板 (Phase 8)
 *
 * 布局：
 *   ┌─────────────────────┐
 *   │ Header + status     │
 *   ├─────────────────────┤
 *   │ History / Messages  │  ← scrollable
 *   ├─────────────────────┤
 *   │ Input bar           │  ← 固定在底部
 *   └─────────────────────┘
 *
 * 状态机：
 *   idle        → 显示对话列表 + 新建表单
 *   creating    → POST /conversations + WS 连接中
 *   streaming   → 正在接收 Claude 事件流
 *   waitInput   → 收到 result，等待用户输入下一轮
 *   viewHistory → 只读查看已关闭对话的历史消息
 *   error       → 出错
 *
 * 多轮对话通过双向 WS 实现：
 *   客户端 → 服务端：{type:'user_message', content:'...'}
 *   服务端 → 客户端：stream-json NDJSON 事件
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RemoteDevApiClient } from '../../services/apiClient';
import { createConversationService } from '../../services/conversationService';
import { useRemoteDevStore } from '../../stores/remoteDevStore';
import type { ClaudeDialogEvent, Conversation, ConversationMessage } from '../../types/remoteDev';
import { DialogMessage } from './DialogMessage';
import { FolderPicker } from '../files/FolderPicker';

type DialogState = 'idle' | 'creating' | 'streaming' | 'waitInput' | 'viewHistory' | 'error';

/** 聊天流中的显示条目：用户发送的提问 或 WS 接收的事件 */
type ChatItem =
  | { kind: 'prompt'; text: string }
  | { kind: 'event'; event: ClaudeDialogEvent };

export function DialogPanel({ api, embedded }: { api: RemoteDevApiClient; embedded?: boolean }) {
  const selectedMachineId = useRemoteDevStore((s) => s.selectedMachineId);
  const machines = useRemoteDevStore((s) => s.machines);
  const selected = machines.find((m) => m.machine_id === selectedMachineId);

  const convService = useMemo(() => createConversationService(api), [api]);

  const [workingDir, setWorkingDir] = useState('');
  const [inputText, setInputText] = useState('');
  const [state, setState] = useState<DialogState>('idle');
  const [error, setError] = useState<string | null>(null);

  // 当前活跃对话
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);

  // 聊天流（用户消息 + WS 事件统一排列）
  const [chatItems, setChatItems] = useState<ChatItem[]>([]);

  // 是否已经收到过第一批 system 事件（用于跳过后续轮次重复的 system init）
  const seenFirstResultRef = useRef(false);

  // 对话列表
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [listLoading, setListLoading] = useState(false);

  // 历史查看模式
  const [historyMessages, setHistoryMessages] = useState<ConversationMessage[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const stateRef = useRef<DialogState>(state);
  stateRef.current = state;

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatItems]);

  // ─── 加载对话列表 ───
  const loadConversations = useCallback(async () => {
    setListLoading(true);
    try {
      const list = await convService.list();
      setConversations(list);
    } catch {
      // ignore
    } finally {
      setListLoading(false);
    }
  }, [convService]);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  // ─── WS 连接 ───
  const connectWs = useCallback((conversationId: string) => {
    if (!selectedMachineId) return;

    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onmessage = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      if (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING) {
        wsRef.current.close();
      }
    }

    const serverUrl = api.getServerUrl();
    const token = api.getAccessToken();
    const wsProto = serverUrl.startsWith('https') ? 'wss' : 'ws';
    const host = serverUrl.replace(/^https?:\/\//, '');
    const url = `${wsProto}://${host}/ws/claude-dialog/${selectedMachineId}?token=${encodeURIComponent(token)}&conversation=${encodeURIComponent(conversationId)}`;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (stateRef.current === 'creating') {
        setState('streaming');
      }
    };

    ws.onmessage = (ev) => {
      try {
        const event = JSON.parse(ev.data as string) as ClaudeDialogEvent;

        // 跳过后续轮次重复的 system init 事件
        if (event.type === 'system' && seenFirstResultRef.current) {
          return;
        }
        if (event.type === 'result') {
          seenFirstResultRef.current = true;
          setState('waitInput');
        }

        setChatItems((prev) => [...prev, { kind: 'event', event }]);
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = () => {
      if (stateRef.current === 'streaming') {
        setState('waitInput');
      }
    };

    ws.onerror = () => {
      setState('error');
      setError('WebSocket 连接失败');
    };
  }, [api, selectedMachineId]);

  // ─── 通过 WS 发送用户消息 ───
  const sendUserMessage = useCallback((text: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setError('WebSocket 未连接');
      return;
    }
    // 先将用户消息插入聊天流显示
    setChatItems((prev) => [...prev, { kind: 'prompt', text }]);
    ws.send(JSON.stringify({ type: 'user_message', content: text }));
    setState('streaming');
  }, []);

  // ─── 创建新对话 ───
  const handleCreateAndSend = useCallback(async (firstMessage: string) => {
    if (!selectedMachineId || !workingDir.trim() || !firstMessage.trim()) return;

    setError(null);
    setState('creating');
    setChatItems([]);
    seenFirstResultRef.current = false;
    setHistoryMessages(null);

    try {
      const conv = await convService.create({
        machine_id: selectedMachineId,
        working_dir: workingDir.trim(),
      });
      setActiveConversation(conv);

      // 将首条消息插入聊天流显示
      const trimmed = firstMessage.trim();
      setChatItems([{ kind: 'prompt', text: trimmed }]);

      connectWs(conv.conversation_id);

      // WS 连接后发送首条消息
      const waitAndSend = () => {
        const ws = wsRef.current;
        if (!ws) return;
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'user_message', content: trimmed }));
          setState('streaming');
        } else {
          ws.addEventListener('open', () => {
            ws.send(JSON.stringify({ type: 'user_message', content: trimmed }));
            setState('streaming');
          }, { once: true });
        }
      };
      waitAndSend();

      void loadConversations();
    } catch (e) {
      setState('error');
      setError(e instanceof Error ? e.message : '创建对话失败');
    }
  }, [selectedMachineId, workingDir, convService, connectWs, loadConversations]);

  // ─── 发送 (新建 or 追加) ───
  const handleSend = useCallback(() => {
    const p = inputText.trim();
    if (!p) return;

    if (activeConversation) {
      sendUserMessage(p);
    } else {
      void handleCreateAndSend(p);
    }
    setInputText('');
  }, [inputText, activeConversation, sendUserMessage, handleCreateAndSend]);

  // ─── 查看历史对话消息 ───
  const handleViewHistory = useCallback(async (conv: Conversation) => {
    setError(null);
    setHistoryMessages(null);
    setHistoryLoading(true);
    setState('viewHistory');

    try {
      const messages = await convService.getMessages(conv.conversation_id);
      setHistoryMessages(messages);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载历史消息失败');
      setHistoryMessages([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [convService]);

  // ─── 恢复 disconnected 对话 ───
  const handleResumeConversation = useCallback(async (conv: Conversation) => {
    setError(null);
    setState('creating');
    setChatItems([]);
    seenFirstResultRef.current = false;
    setHistoryMessages(null);

    try {
      const resumed = await convService.resume(conv.conversation_id);
      setActiveConversation(resumed);
      connectWs(resumed.conversation_id);
      setState('waitInput');
      void loadConversations();
    } catch (e) {
      setState('error');
      setError(e instanceof Error ? e.message : '恢复对话失败');
    }
  }, [convService, connectWs, loadConversations]);

  // ─── 点击对话卡片 ───
  const handleClickConversation = useCallback((conv: Conversation) => {
    if (conv.status === 'active') {
      setActiveConversation(conv);
      setChatItems([]);
      seenFirstResultRef.current = false;
      setHistoryMessages(null);
      connectWs(conv.conversation_id);
      setState('streaming');
    } else if (conv.status === 'disconnected') {
      void handleResumeConversation(conv);
    } else {
      void handleViewHistory(conv);
    }
  }, [connectWs, handleResumeConversation, handleViewHistory]);

  // ─── 新建对话（重置状态） ───
  const handleNewConversation = useCallback(() => {
    wsRef.current?.close();
    setState('idle');
    setActiveConversation(null);
    setChatItems([]);
    seenFirstResultRef.current = false;
    setHistoryMessages(null);
    setError(null);
    setInputText('');
    void loadConversations();
  }, [loadConversations]);

  // ─── 关闭对话 ───
  const handleCloseConversation = useCallback(async (convId: string) => {
    try {
      await convService.close(convId);
      if (activeConversation?.conversation_id === convId) {
        handleNewConversation();
      } else {
        void loadConversations();
      }
    } catch {
      // ignore
    }
  }, [convService, activeConversation, handleNewConversation, loadConversations]);

  useEffect(() => {
    return () => {
      wsRef.current?.close();
    };
  }, []);

  // ─── 无机器选择 ───
  if (!selectedMachineId || !selected) {
    const emptyContent = <div className="rd-empty" style={{ flex: 1 }}>请先选择一台机器</div>;
    if (embedded) return emptyContent;
    return (
      <div className="rd-panel">
        <div className="rd-panel-header"><h2 className="rd-panel-title">Claude 对话</h2></div>
        {emptyContent}
      </div>
    );
  }

  const setupReady = selected.claude_setup_status === 'ready';
  const isActive = state === 'creating' || state === 'streaming';
  const canSend = state === 'waitInput' || (state === 'idle' && !activeConversation);
  const showInputBar = state !== 'viewHistory';

  // ─── 状态 badge 文案 ───
  const badgeInfo = (() => {
    switch (state) {
      case 'streaming': return { cls: 'rd-badge-success', text: '对话中' };
      case 'creating': return { cls: 'rd-badge-warning', text: '创建中' };
      case 'waitInput': return { cls: 'rd-badge-info', text: '等待输入' };
      case 'viewHistory': return { cls: 'rd-badge-info', text: '历史记录' };
      case 'error': return { cls: 'rd-badge-danger', text: '错误' };
      default: return null;
    }
  })();

  const content = (
    <div className="rd-dialog-panel">
      {/* ═══════ Header ═══════ */}
      <div className="rd-dialog-panel-header">
        <span className="rd-ide-panel-title">Claude 对话</span>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {state === 'viewHistory' && (
            <button
              type="button"
              className="rd-btn rd-btn-ghost"
              style={{ fontSize: 11, padding: '2px 6px' }}
              onClick={handleNewConversation}
            >
              ← 返回
            </button>
          )}
          {badgeInfo && (
            <span className={`rd-badge ${badgeInfo.cls}`}>{badgeInfo.text}</span>
          )}
          {(activeConversation || state === 'viewHistory') && (
            <button
              type="button"
              className="rd-btn rd-btn-ghost"
              style={{ fontSize: 11, padding: '2px 6px' }}
              onClick={handleNewConversation}
            >
              新建
            </button>
          )}
        </div>
      </div>

      {/* ═══════ Scrollable body ═══════ */}
      <div className="rd-dialog-panel-body">
        {!setupReady && state !== 'viewHistory' && (
          <div className="rd-dialog-notice">
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Claude Code 未就绪</div>
            {selected.claude_setup_status === 'none' && '请先在机器管理中安装 Claude Code。'}
            {selected.claude_setup_status === 'in_progress' && '安装正在进行中，请等待完成。'}
            {selected.claude_setup_status === 'failed' && '安装失败，请在机器管理中重新安装。'}
            {!selected.claude_setup_status && '请先在机器管理中安装 Claude Code。'}
          </div>
        )}

        {error && (
          <p style={{ color: 'var(--status-error)', fontSize: 12, padding: '0 2px', margin: '4px 0' }}>{error}</p>
        )}

        {/* ─── Idle 视图：对话列表 + 新建表单 ─── */}
        {state === 'idle' && !activeConversation && (
          <>
            {listLoading && <div className="rd-loading" style={{ padding: 12 }}>加载对话列表…</div>}
            {conversations.length > 0 && (
              <div className="rd-dialog-history">
                <div className="rd-dialog-section-title">对话列表</div>
                {conversations.map((c) => (
                  <div
                    key={c.conversation_id}
                    className="rd-dialog-conversation-card"
                    role="button"
                    tabIndex={0}
                    onClick={() => handleClickConversation(c)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleClickConversation(c);
                      }
                    }}
                  >
                    <div className="rd-dialog-conversation-top">
                      <span className="rd-dialog-conversation-title">
                        {c.title || c.conversation_id.slice(0, 12) + '…'}
                      </span>
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                        <span className={`rd-badge rd-badge-${
                          c.status === 'active' ? 'success' :
                          c.status === 'disconnected' ? 'warning' : 'info'
                        }`} style={{ fontSize: 10, padding: '1px 5px' }}>
                          {c.status === 'active' ? '活跃' :
                           c.status === 'disconnected' ? '已断开' : '已关闭'}
                        </span>
                        {c.status !== 'closed' && (
                          <button
                            type="button"
                            className="rd-btn rd-btn-ghost"
                            style={{ fontSize: 10, padding: '1px 4px' }}
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleCloseConversation(c.conversation_id);
                            }}
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="rd-dialog-conversation-meta">
                      {c.working_dir} · {new Date(c.created_at).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {setupReady && (
              <div className="rd-dialog-new-form">
                <div className="rd-dialog-section-title">新建对话</div>
                <div className="rd-form-group">
                  <label className="rd-form-label">工作目录</label>
                  <FolderPicker
                    api={api}
                    machineId={selectedMachineId}
                    value={workingDir}
                    onChange={setWorkingDir}
                    disabled={isActive}
                  />
                </div>
              </div>
            )}
          </>
        )}

        {/* ─── 历史查看横幅 ─── */}
        {state === 'viewHistory' && (
          <div className="rd-dialog-history-banner">
            正在查看历史对话记录（只读）
          </div>
        )}

        {/* ─── 历史消息渲染 ─── */}
        {state === 'viewHistory' && historyLoading && (
          <div className="rd-loading" style={{ padding: 12 }}>加载历史消息…</div>
        )}
        {state === 'viewHistory' && historyMessages && (
          <div className="rd-dialog-messages-list">
            {historyMessages.map((msg, i) => {
              if (msg.role === 'user') {
                const text = typeof msg.content === 'string'
                  ? msg.content
                  : msg.content.map((b) => ('text' in b ? b.text : '')).join('');
                return (
                  <div key={i} className="rd-msg rd-msg-my-prompt">
                    <div className="rd-msg-my-prompt-label">你</div>
                    <div className="rd-msg-my-prompt-text">{text}</div>
                  </div>
                );
              }
              if (msg.role === 'assistant') {
                const syntheticEvent: ClaudeDialogEvent = {
                  type: 'assistant',
                  message: {
                    content: typeof msg.content === 'string'
                      ? [{ type: 'text' as const, text: msg.content }]
                      : msg.content,
                  },
                };
                return <DialogMessage key={i} event={syntheticEvent} />;
              }
              return null;
            })}
          </div>
        )}

        {/* ─── 实时聊天流渲染（用户消息 + WS 事件） ─── */}
        {chatItems.length > 0 && state !== 'viewHistory' && (
          <div className="rd-dialog-messages-list">
            {chatItems.map((item, i) => {
              if (item.kind === 'prompt') {
                return (
                  <div key={i} className="rd-msg rd-msg-my-prompt">
                    <div className="rd-msg-my-prompt-label">你</div>
                    <div className="rd-msg-my-prompt-text">{item.text}</div>
                  </div>
                );
              }
              return <DialogMessage key={i} event={item.event} />;
            })}
            <div ref={messagesEndRef} />
          </div>
        )}

        {isActive && chatItems.length === 0 && (
          <div className="rd-loading" style={{ padding: 12, fontSize: 12 }}>
            {state === 'creating' ? '正在创建对话…' : '等待事件…'}
          </div>
        )}
      </div>

      {/* ═══════ Bottom input bar ═══════ */}
      {showInputBar && (
        <div className="rd-dialog-input-bar">
          <textarea
            className="rd-dialog-input-textarea"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={
              !setupReady ? 'Claude Code 未就绪' :
              !workingDir && !activeConversation ? '请先选择工作目录' :
              isActive ? '对话进行中…' :
              activeConversation ? '继续对话…（Shift+Enter 换行）' :
              '输入消息开始新对话…'
            }
            disabled={isActive || !setupReady || (!workingDir && !activeConversation)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (canSend) handleSend();
              }
            }}
            rows={1}
          />
          <button
            type="button"
            className="rd-dialog-send-btn"
            disabled={isActive || !setupReady || (!workingDir && !activeConversation) || !inputText.trim()}
            onClick={handleSend}
          >
            ▶
          </button>
        </div>
      )}
    </div>
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
