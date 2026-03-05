/**
 * AI 语音通话全屏界面
 *
 * 替换 AIChatMessages 区域，显示通话状态、AI 头像动画、
 * 转写文本和控制按钮（静音 + 挂断）。
 */

import { useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { AIAvatar } from '../../../components/common/AIAvatar';
import type { VoiceCallState, VoiceTurn } from './useVoiceCall';

interface VoiceCallViewProps {
  state: VoiceCallState;
  turns: VoiceTurn[];
  onToggleMute: () => void;
  onDisconnect: () => void;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const TOOL_NAME_MAP: Record<string, string> = {
  get_friend_list: '好友列表',
  send_message: '发送消息',
  get_user_profile: '用户资料',
  get_group_list: '群组列表',
  get_recent_messages: '聊天记录',
  send_friend_request: '好友请求',
};

function getToolDisplayName(name: string): string {
  return TOOL_NAME_MAP[name] || name;
}

export function VoiceCallView({
  state,
  turns,
  onToggleMute,
  onDisconnect,
}: VoiceCallViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
  }, [turns, state.transcript, state.aiReply]);

  // eslint-disable-next-line no-nested-ternary
  const statusText = state.isConnecting
    ? '连接中...'
    : state.isProcessing
      ? 'AI 处理中'
      : '通话中';

  const avatarClass = [
    'voice-call-avatar-ring',
    state.isAiSpeaking ? 'speaking' : '',
    state.isProcessing && !state.isAiSpeaking ? 'processing' : '',
  ].filter(Boolean).join(' ');

  return (
    <motion.div
      className="voice-call-view"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
    >
      {/* 顶部状态 */}
      <div className="voice-call-status">
        <span className="voice-call-status-dot" />
        <span className="voice-call-status-text">{statusText}</span>
        <span className="voice-call-duration">{formatDuration(state.duration)}</span>
      </div>

      {/* AI 头像 + 动画 */}
      <div className="voice-call-center">
        <div className={avatarClass}>
          <div className="voice-call-avatar">
            <AIAvatar />
          </div>
        </div>
      </div>

      {/* 转写文本区 */}
      <div className="voice-call-transcript-area" ref={scrollRef}>
        {turns.map((turn) => (
          <div key={turn.id} className="voice-call-turn">
            {turn.userText && (
              <div className="voice-call-bubble user">
                <MicIcon />
                <span>{turn.userText}</span>
              </div>
            )}
            {turn.aiText && (
              <div className="voice-call-bubble ai">
                <span>{turn.aiText}</span>
              </div>
            )}
          </div>
        ))}

        {/* 当前轮次（进行中） */}
        {state.transcript && (
          <motion.div
            className="voice-call-bubble user current"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.15 }}
          >
            <MicIcon />
            <span>{state.transcript}</span>
          </motion.div>
        )}

        {state.aiReply && (
          <motion.div
            className="voice-call-bubble ai current"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.15 }}
          >
            <span>{state.aiReply}</span>
            <span className="voice-call-typing-cursor" />
          </motion.div>
        )}

        {state.toolStatus && (
          <div className="voice-call-tool-status">
            {state.toolStatus.status === 'calling' ? (
              <>
                <span className="voice-call-tool-dot" />
                正在查询{getToolDisplayName(state.toolStatus.name)}...
              </>
            ) : (
              <>
                <span style={{ color: state.toolStatus.status === 'done' ? '#22c55e' : '#ef4444' }}>
                  {state.toolStatus.status === 'done' ? '✓' : '✗'}
                </span>
                {getToolDisplayName(state.toolStatus.name)}
                {state.toolStatus.status === 'done' ? '完成' : '失败'}
              </>
            )}
          </div>
        )}

        {state.error && (
          <div className="voice-call-error">
            {state.error}
          </div>
        )}
      </div>

      {/* 控制栏 */}
      <div className="voice-call-controls">
        <button
          className={`voice-call-btn mute ${state.isMuted ? 'active' : ''}`}
          onClick={onToggleMute}
          title={state.isMuted ? '取消静音' : '静音'}
        >
          {state.isMuted ? <MicOffIcon /> : <MicOnIcon />}
        </button>
        <button
          className="voice-call-btn hangup"
          onClick={onDisconnect}
          title="挂断"
        >
          <HangupIcon />
        </button>
      </div>
    </motion.div>
  );
}

/* ---- Inline SVG Icons ---- */

function MicIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

function MicOnIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

function MicOffIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="1" y1="1" x2="23" y2="23" />
      <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
      <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .76-.13 1.5-.36 2.18" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

function HangupIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91" />
      <line x1="23" y1="1" x2="1" y2="23" />
    </svg>
  );
}
