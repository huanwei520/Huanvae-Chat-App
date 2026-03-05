/**
 * AI 语音通话 Hook
 *
 * 管理 WebSocket 连接、录音、TTS 播放和通话状态。
 * 协议严格遵循后端 AI助手.md 8.1-8.11 节。
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import type { ApiClient } from '../../../api/client';
import { VoiceRecorder, TtsAudioQueue } from './voiceAudio';

export interface VoiceCallState {
  isActive: boolean;
  isConnecting: boolean;
  isMinimized: boolean;
  isMuted: boolean;
  isProcessing: boolean;
  sessionId: string | null;
  duration: number;
  transcript: string;
  aiReply: string;
  isAiSpeaking: boolean;
  toolStatus: { name: string; status: 'calling' | 'done' | 'failed' } | null;
  error: string | null;
}

/** 对话轮次记录（用于转写文本区的历史展示） */
export interface VoiceTurn {
  id: number;
  userText: string;
  aiText: string;
}

export interface UseVoiceCallReturn {
  state: VoiceCallState;
  turns: VoiceTurn[];
  startCall: (conversationId?: string, voiceProfileId?: string) => void;
  disconnect: () => void;
  toggleMute: () => void;
  minimize: () => void;
  restore: () => void;
}

const INITIAL_STATE: VoiceCallState = {
  isActive: false,
  isConnecting: false,
  isMinimized: false,
  isMuted: false,
  isProcessing: false,
  sessionId: null,
  duration: 0,
  transcript: '',
  aiReply: '',
  isAiSpeaking: false,
  toolStatus: null,
  error: null,
};

export function useVoiceCall(api: ApiClient | null): UseVoiceCallReturn {
  const [state, setState] = useState<VoiceCallState>(INITIAL_STATE);
  const [turns, setTurns] = useState<VoiceTurn[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<VoiceRecorder | null>(null);
  const ttsQueueRef = useRef<TtsAudioQueue | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const turnIdRef = useRef(0);

  // Mutable refs for values accessed in WS callbacks
  const stateRef = useRef(state);
  stateRef.current = state;

  const patch = useCallback((p: Partial<VoiceCallState>) => {
    setState(prev => ({ ...prev, ...p }));
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };

  }, []);

  function cleanup() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    recorderRef.current?.stop();
    recorderRef.current = null;
    ttsQueueRef.current?.destroy();
    ttsQueueRef.current = null;
    if (wsRef.current) {
      wsRef.current.onmessage = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.close();
      wsRef.current = null;
    }
  }

  function startTimer() {
    if (timerRef.current) { return; }
    timerRef.current = setInterval(() => {
      setState(prev => ({ ...prev, duration: prev.duration + 1 }));
    }, 1000);
  }

  function sendInterrupt() {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) { return; }
    ws.send(JSON.stringify({ type: 'interrupt' }));
    ttsQueueRef.current?.flush();
    patch({ isProcessing: false, isAiSpeaking: false });
  }

  const startCall = useCallback((conversationId?: string, voiceProfileId?: string) => {
    if (!api || stateRef.current.isActive) { return; }

    patch({ ...INITIAL_STATE, isConnecting: true });
    setTurns([]);
    turnIdRef.current = 0;

    const baseUrl = api.getBaseUrl();
    const token = api.getAccessToken();
    const wsUrl = `${baseUrl.replace(/^http/, 'ws')}/api/ai/voice/stream?token=${encodeURIComponent(token)}`;

    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    // TTS queue
    const ttsQueue = new TtsAudioQueue();
    ttsQueueRef.current = ttsQueue;
    ttsQueue.onPlayStateChange = (playing) => {
      setState(prev => ({ ...prev, isAiSpeaking: playing }));
    };

    // Accumulator for current turn AI reply (needed outside React state for perf)
    let currentAiReply = '';
    let currentTranscript = '';

    ws.onopen = () => {
      const msg: Record<string, unknown> = { type: 'start_session' };
      if (conversationId) { msg.conversation_id = conversationId; }
      if (voiceProfileId) { msg.voice_profile_id = voiceProfileId; }
      ws.send(JSON.stringify(msg));
    };

    ws.onmessage = (event) => {
      // Binary frame = TTS audio
      if (event.data instanceof ArrayBuffer) {
        ttsQueue.enqueue(event.data);
        return;
      }

      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(event.data as string);
      } catch {
        return;
      }

      switch (msg.type) {
        case 'session_started': {
          const sessionId = msg.session_id as string;
          patch({
            isActive: true,
            isConnecting: false,
            sessionId,
            error: null,
          });
          startTimer();
          startRecorder(ws);
          break;
        }

        case 'transcript': {
          const text = msg.text as string;
          currentTranscript += text;
          patch({ transcript: currentTranscript, isProcessing: true, error: null });
          break;
        }

        case 'ai_text': {
          const isFinal = msg.is_final as boolean;
          if (!isFinal) {
            currentAiReply += msg.text as string;
            patch({ aiReply: currentAiReply });
          }
          break;
        }

        case 'tool_call':
          patch({ toolStatus: { name: msg.name as string, status: 'calling' } });
          break;

        case 'tool_result':
          patch({
            toolStatus: {
              name: msg.name as string,
              status: (msg.success as boolean) ? 'done' : 'failed',
            },
          });
          break;

        case 'turn_end': {
          if (currentTranscript || currentAiReply) {
            const tid = ++turnIdRef.current;
            const turn: VoiceTurn = {
              id: tid,
              userText: currentTranscript,
              aiText: currentAiReply,
            };
            setTurns(prev => [...prev, turn]);
          }
          currentAiReply = '';
          currentTranscript = '';
          patch({
            isProcessing: false,
            transcript: '',
            aiReply: '',
            toolStatus: null,
          });
          break;
        }

        case 'interrupted':
          ttsQueue.flush();
          currentAiReply = '';
          patch({ isProcessing: false, aiReply: '', isAiSpeaking: false, toolStatus: null });
          break;

        case 'error':
          patch({ error: msg.message as string, isProcessing: false });
          break;

        case 'session_ended':
          cleanup();
          patch({
            isActive: false,
            isConnecting: false,
            isProcessing: false,
            isAiSpeaking: false,
            sessionId: null,
          });
          break;
      }
    };

    ws.onerror = () => {
      patch({ error: 'WebSocket 连接失败', isConnecting: false });
    };

    ws.onclose = () => {
      if (stateRef.current.isActive) {
        cleanup();
        patch({ ...INITIAL_STATE });
      }
    };
  }, [api, patch]);

  function startRecorder(ws: WebSocket) {
    const recorder = new VoiceRecorder();
    recorderRef.current = recorder;

    recorder.onAudioFrame = (wav) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(wav);
      }
    };

    recorder.onSpeechDetected = () => {
      if (stateRef.current.isProcessing) {
        sendInterrupt();
      }
    };

    recorder.start().catch((err) => {
      patch({ error: `麦克风权限获取失败: ${err.message}` });
    });
  }

  const disconnect = useCallback(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'end_session' }));
    }
    cleanup();
    setState(INITIAL_STATE);
    setTurns([]);
  }, []);

  const toggleMute = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder) { return; }
    if (recorder.isMuted) {
      recorder.unmute();
      patch({ isMuted: false });
    } else {
      recorder.mute();
      patch({ isMuted: true });
    }
  }, [patch]);

  const minimize = useCallback(() => {
    patch({ isMinimized: true });
  }, [patch]);

  const restore = useCallback(() => {
    patch({ isMinimized: false });
  }, [patch]);

  return {
    state,
    turns,
    startCall,
    disconnect,
    toggleMute,
    minimize,
    restore,
  };
}
