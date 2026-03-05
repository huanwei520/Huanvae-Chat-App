/**
 * 声音配置管理面板
 *
 * 支持：声音列表展示、上传 WAV 文件、实时录音上传、设为默认、删除。
 * 以弹窗形式展示，入口在 AI 聊天头部区域。
 */

import { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { stat, readFile } from '@tauri-apps/plugin-fs';
import { platform } from '@tauri-apps/plugin-os';
import { selectFilesForTransfer } from '../../../utils/androidFileHandler';
import type { VoiceProfile } from '../../../api/ai';
import { encodeWAV } from './voiceAudio';

interface VoiceProfileManagerProps {
  open: boolean;
  onClose: () => void;
  profiles: VoiceProfile[];
  selectedId: string | null;
  loading: boolean;
  uploading: boolean;
  error: string | null;
  onUpload: (name: string, audioBlob: Blob, fileName: string, systemPrompt?: string) => Promise<void>;
  onSetDefault: (profileId: string) => Promise<void>;
  onDelete: (profileId: string) => Promise<void>;
  onSelect: (profileId: string | null) => void;
  onUpdatePrompt: (profileId: string, systemPrompt: string | null) => Promise<void>;
}

type UploadMode = 'idle' | 'file' | 'recording' | 'recorded';

const SAMPLE_RATE = 24000;

export function VoiceProfileManager({
  open,
  onClose,
  profiles,
  selectedId,
  loading,
  uploading,
  error,
  onUpload,
  onSetDefault,
  onDelete,
  onSelect,
  onUpdatePrompt,
}: VoiceProfileManagerProps) {
  const [mode, setMode] = useState<UploadMode>('idle');
  const [voiceName, setVoiceName] = useState('');
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioFileName, setAudioFileName] = useState('');
  const [recordDuration, setRecordDuration] = useState(0);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [editingPromptId, setEditingPromptId] = useState<string | null>(null);
  const [editingPromptText, setEditingPromptText] = useState('');

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [fileSelecting, setFileSelecting] = useState(false);

  const resetUploadState = useCallback(() => {
    setMode('idle');
    setVoiceName('');
    setSystemPrompt('');
    setAudioBlob(null);
    setAudioFileName('');
    setRecordDuration(0);
    setLocalError(null);
    setConfirmDeleteId(null);
  }, []);

  const handleFileSelect = useCallback(async () => {
    if (fileSelecting) { return; }
    setFileSelecting(true);
    setLocalError(null);

    try {
      const os = await platform();
      console.warn('[VPM-File] 平台:', os);

      let filePath: string | null = null;

      if (os === 'android') {
        console.warn('[VPM-File] Android: 使用 Android FS 插件选择文件');
        const paths = await selectFilesForTransfer({ multiple: false });
        filePath = paths.length > 0 ? paths[0] : null;
      } else {
        console.warn('[VPM-File] 桌面端: 使用 Tauri dialog 选择文件');
        const selected = await openDialog({
          multiple: false,
          filters: [{ name: '音频文件', extensions: ['wav'] }],
        });
        filePath = selected && typeof selected === 'string' ? selected : null;
      }

      if (!filePath) {
        console.warn('[VPM-File] 用户取消了文件选择');
        return;
      }

      const fileName = filePath.split(/[/\\]/).pop() || 'audio.wav';
      console.warn('[VPM-File] 选择文件', { filePath, fileName });

      if (!fileName.toLowerCase().endsWith('.wav')) {
        console.warn('[VPM-File] 文件格式不是 WAV，已拒绝');
        setLocalError('请选择 WAV 格式的音频文件');
        return;
      }

      const fileStat = await stat(filePath);
      const fileContent = await readFile(filePath);

      console.warn('[VPM-File] 文件读取完成', {
        size: fileContent.byteLength,
        mtime: fileStat.mtime,
      });

      const blob = new Blob([fileContent], { type: 'audio/wav' });
      setAudioBlob(blob);
      setAudioFileName(fileName);
      setMode('file');
    } catch (err) {
      const errStr = String(err);
      if (!errStr.includes('cancelled') && !errStr.includes('Canceled')) {
        console.error('[VPM-File] 选择文件失败:', err);
        setLocalError('选择文件失败');
      }
    } finally {
      setFileSelecting(false);
    }
  }, [fileSelecting]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;

      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      chunksRef.current = [];

      processor.onaudioprocess = (ev) => {
        chunksRef.current.push(new Float32Array(ev.inputBuffer.getChannelData(0)));
      };
      source.connect(processor);
      processor.connect(ctx.destination);

      setRecordDuration(0);
      setMode('recording');
      setLocalError(null);
      timerRef.current = setInterval(() => {
        setRecordDuration(d => d + 1);
      }, 1000);
    } catch {
      setLocalError('麦克风权限获取失败');
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    processorRef.current?.disconnect();
    processorRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }

    const chunks = chunksRef.current;
    if (chunks.length === 0) {
      setMode('idle');
      return;
    }

    const nativeSampleRate = audioCtxRef.current?.sampleRate ?? 48000;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;

    const totalLen = chunks.reduce((s, c) => s + c.length, 0);
    console.warn('[VPM-Record] 停止录制', {
      chunkCount: chunks.length,
      totalSamples: totalLen,
      nativeSampleRate,
      durationSec: (totalLen / nativeSampleRate).toFixed(2),
    });

    const merged = new Float32Array(totalLen);
    let off = 0;
    for (const c of chunks) { merged.set(c, off); off += c.length; }
    chunksRef.current = [];

    // Resample to 24kHz if needed
    let resampled = merged;
    if (nativeSampleRate !== SAMPLE_RATE) {
      const ratio = nativeSampleRate / SAMPLE_RATE;
      const newLen = Math.round(merged.length / ratio);
      console.warn('[VPM-Record] 重采样', { from: nativeSampleRate, to: SAMPLE_RATE, ratio: ratio.toFixed(4), newLen });
      resampled = new Float32Array(newLen);
      for (let i = 0; i < newLen; i++) {
        const srcIdx = i * ratio;
        const lo = Math.floor(srcIdx);
        const hi = Math.min(lo + 1, merged.length - 1);
        const frac = srcIdx - lo;
        resampled[i] = merged[lo] * (1 - frac) + merged[hi] * frac;
      }
    } else {
      console.warn('[VPM-Record] 采样率一致，无需重采样');
    }

    // Float32 → Int16
    const pcm16 = new Int16Array(resampled.length);
    for (let i = 0; i < resampled.length; i++) {
      const s = Math.max(-1, Math.min(1, resampled[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }

    const wav = encodeWAV(pcm16, SAMPLE_RATE);
    const blob = new Blob([wav], { type: 'audio/wav' });
    console.warn('[VPM-Record] WAV 编码完成', {
      pcmSamples: pcm16.length,
      wavBytes: wav.byteLength,
      blobSize: blob.size,
      finalDurationSec: (pcm16.length / SAMPLE_RATE).toFixed(2),
    });

    setAudioBlob(blob);
    setAudioFileName('recording.wav');
    setMode('recorded');
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!audioBlob || !voiceName.trim()) {
      setLocalError('请输入声音名称并提供音频');
      return;
    }
    console.warn('[VPM-Submit] 开始提交', {
      voiceName: voiceName.trim(),
      audioFileName,
      blobSize: audioBlob.size,
      blobType: audioBlob.type,
      systemPrompt: systemPrompt || '(未设置)',
    });
    try {
      await onUpload(voiceName.trim(), audioBlob, audioFileName, systemPrompt.trim() || undefined);
      console.warn('[VPM-Submit] 上传成功');
      resetUploadState();
    } catch (err) {
      console.error('[VPM-Submit] 上传失败', err);
    }
  }, [audioBlob, voiceName, audioFileName, systemPrompt, onUpload, resetUploadState]);

  const handleStartEditPrompt = useCallback((p: VoiceProfile) => {
    setEditingPromptId(p.profile_id);
    setEditingPromptText(p.system_prompt || '');
  }, []);

  const handleSavePrompt = useCallback(async () => {
    if (!editingPromptId) { return; }
    const trimmed = editingPromptText.trim();
    await onUpdatePrompt(editingPromptId, trimmed || null);
    setEditingPromptId(null);
    setEditingPromptText('');
  }, [editingPromptId, editingPromptText, onUpdatePrompt]);

  const handleDelete = useCallback(async (profileId: string) => {
    await onDelete(profileId);
    setConfirmDeleteId(null);
  }, [onDelete]);

  const formatDuration = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  if (!open) { return null; }

  return (
    <div className="vpm-overlay" onClick={onClose}>
      <motion.div
        className="vpm-panel"
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.95 }}
        transition={{ duration: 0.2 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="vpm-header">
          <h3>声音管理</h3>
          <button className="vpm-close" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Error display */}
        {(error || localError) && (
          <div className="vpm-error">{localError || error}</div>
        )}

        {/* Upload area */}
        <div className="vpm-upload-area">
          {mode === 'idle' && (
            <div className="vpm-upload-actions">
              <button className="vpm-action-btn" onClick={handleFileSelect} disabled={fileSelecting}>
                <UploadIcon />
                <span>{fileSelecting ? '选择中...' : '选择文件'}</span>
              </button>
              <button className="vpm-action-btn" onClick={startRecording}>
                <MicIcon />
                <span>录制声音</span>
              </button>
            </div>
          )}

          {mode === 'recording' && (
            <div className="vpm-recording">
              <div className="vpm-recording-indicator">
                <span className="vpm-recording-dot" />
                <span>录制中 {formatDuration(recordDuration)}</span>
              </div>
              <p className="vpm-hint">建议录制 5-30 秒清晰人声</p>
              <button className="vpm-stop-btn" onClick={stopRecording}>停止录制</button>
            </div>
          )}

          {(mode === 'file' || mode === 'recorded') && (
            <div className="vpm-upload-form">
              <div className="vpm-audio-info">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
                <span className="vpm-filename">{audioFileName}</span>
                {mode === 'recorded' && <span className="vpm-duration">{formatDuration(recordDuration)}</span>}
                <button className="vpm-remove-file" onClick={resetUploadState}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
              </div>
              <input
                className="vpm-name-input"
                type="text"
                placeholder="为这个声音起个名字"
                value={voiceName}
                onChange={(e) => setVoiceName(e.target.value)}
                maxLength={30}
              />
              <textarea
                className="vpm-prompt-input"
                placeholder="自定义语音人设（可选），如：你是一个温柔的女性助手"
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                rows={2}
                maxLength={2000}
              />
              <button
                className="vpm-submit-btn"
                onClick={handleSubmit}
                disabled={uploading || !voiceName.trim()}
              >
                {uploading ? '上传中...' : '上传声音'}
              </button>
            </div>
          )}
        </div>

        {/* Profiles list */}
        <div className="vpm-list">
          {loading && profiles.length === 0 && (
            <div className="vpm-empty">加载中...</div>
          )}
          {!loading && profiles.length === 0 && (
            <div className="vpm-empty">暂无自定义声音，上传参考音频即可克隆</div>
          )}
          <AnimatePresence>
            {profiles.map(p => (
              <motion.div
                key={p.profile_id}
                className={`vpm-item ${selectedId === p.profile_id ? 'selected' : ''}`}
                layout
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.15 }}
              >
                <div className="vpm-item-row">
                  <button
                    className="vpm-item-main"
                    onClick={() => onSelect(selectedId === p.profile_id ? null : p.profile_id)}
                  >
                    <span className="vpm-item-radio">
                      {selectedId === p.profile_id && <span className="vpm-item-radio-dot" />}
                    </span>
                    <span className="vpm-item-name">{p.voice_name}</span>
                    {p.is_default && <span className="vpm-item-badge">默认</span>}
                  </button>
                  <div className="vpm-item-actions">
                    <button
                      className="vpm-item-action"
                      title="编辑人设"
                      onClick={() => handleStartEditPrompt(p)}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                    </button>
                    {!p.is_default && (
                      <button
                        className="vpm-item-action"
                        title="设为默认"
                        onClick={() => onSetDefault(p.profile_id)}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
                      </button>
                    )}
                    {confirmDeleteId === p.profile_id ? (
                      <div className="vpm-confirm-delete">
                        <button className="vpm-confirm-yes" onClick={() => handleDelete(p.profile_id)}>确认</button>
                        <button className="vpm-confirm-no" onClick={() => setConfirmDeleteId(null)}>取消</button>
                      </div>
                    ) : (
                      <button
                        className="vpm-item-action delete"
                        title="删除"
                        onClick={() => setConfirmDeleteId(p.profile_id)}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                      </button>
                    )}
                  </div>
                </div>
                {p.system_prompt && (
                  <div className="vpm-prompt-preview" onClick={() => handleStartEditPrompt(p)}>
                    <span className="vpm-prompt-label">人设：</span>
                    <span className="vpm-prompt-text">{p.system_prompt}</span>
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        <div className="vpm-footer">
          <p>通话时将使用选中的声音，未选择则使用系统默认</p>
        </div>
      </motion.div>

      {/* Prompt 全屏编辑面板 */}
      <AnimatePresence>
        {editingPromptId && (
          <motion.div
            className="vpm-prompt-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={() => setEditingPromptId(null)}
          >
            <motion.div
              className="vpm-prompt-panel"
              initial={{ opacity: 0, y: 40, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 40, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="vpm-prompt-panel-header">
                <h4>编辑语音人设</h4>
                <button className="vpm-close" onClick={() => setEditingPromptId(null)}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
              <p className="vpm-prompt-panel-hint">
                设置后语音通话时 AI 将使用此提示词替换默认系统提示词，留空则使用默认人设。
              </p>
              <textarea
                className="vpm-prompt-panel-input"
                value={editingPromptText}
                onChange={(e) => setEditingPromptText(e.target.value)}
                placeholder="例如：你是一个温柔的女性助手，说话轻声细语，喜欢用可爱的语气。"
                maxLength={2000}
                autoFocus
              />
              <div className="vpm-prompt-panel-footer">
                <span className="vpm-prompt-counter">{editingPromptText.length}/2000</span>
                <div className="vpm-prompt-panel-actions">
                  <button className="vpm-prompt-cancel" onClick={() => setEditingPromptId(null)}>取消</button>
                  <button className="vpm-prompt-save" onClick={handleSavePrompt}>保存</button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function UploadIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}
