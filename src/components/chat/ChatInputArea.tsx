/**
 * 聊天输入区域组件
 *
 * 包含：
 * - 文件附件按钮
 * - 文本输入框（支持多行）
 * - 发送按钮
 * - 上传进度条
 * - 禁言状态检测和提示
 */

import { useRef, useCallback, useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FileAttachButton, type AttachmentType } from './FileAttachButton';
import { UploadProgress } from './UploadProgress';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { SendIcon, MuteIcon } from '../common/Icons';
import { useChatStore, selectCurrentMuteStatus } from '../../stores';
import type { UploadProgress as UploadProgressType } from '../../hooks/useFileUpload';

interface ChatInputAreaProps {
  messageInput: string;
  onMessageChange: (value: string) => void;
  onSendMessage: () => void;
  onFileSelect: (file: File, type: AttachmentType) => void;
  isSending: boolean;
  uploading: boolean;
  uploadingFile: File | null;
  uploadProgress: UploadProgressType | null;
  onCancelUpload: () => void;
}

/**
 * 格式化剩余时间
 * @param ms 毫秒
 * @returns 格式化的时间字符串
 */
function formatRemainingTime(ms: number): string {
  if (ms <= 0) { return ''; }

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}天${hours % 24}小时`;
  }
  if (hours > 0) {
    return `${hours}小时${minutes % 60}分钟`;
  }
  if (minutes > 0) {
    return `${minutes}分钟`;
  }
  return `${seconds}秒`;
}

export function ChatInputArea({
  messageInput,
  onMessageChange,
  onSendMessage,
  onFileSelect,
  isSending,
  uploading,
  uploadingFile,
  uploadProgress,
  onCancelUpload,
}: ChatInputAreaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 从 store 获取当前群的禁言状态
  const muteInfo = useChatStore(selectCurrentMuteStatus);
  const chatTarget = useChatStore((state) => state.chatTarget);
  const getMuteRemaining = useChatStore((state) => state.getMuteRemaining);

  // 计算禁言剩余时间
  const [muteRemaining, setMuteRemaining] = useState(0);

  // 判断是否在群聊中
  const isGroup = chatTarget?.type === 'group';
  const groupId = isGroup ? chatTarget.data.group_id : null;

  // 定时更新禁言剩余时间
  useEffect(() => {
    if (!groupId || !muteInfo) {
      setMuteRemaining(0);
      return;
    }

    // 立即计算一次
    setMuteRemaining(getMuteRemaining(groupId));

    // 每秒更新一次
    const timer = setInterval(() => {
      const remaining = getMuteRemaining(groupId);
      setMuteRemaining(remaining);

      // 禁言结束后自动清除
      if (remaining <= 0) {
        clearInterval(timer);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [groupId, muteInfo, getMuteRemaining]);

  // 是否被禁言
  const isMuted = muteRemaining > 0;

  // 禁言提示文本
  const muteMessage = useMemo(() => {
    if (!isMuted) { return ''; }
    const timeStr = formatRemainingTime(muteRemaining);
    return `您已被禁言，剩余 ${timeStr}`;
  }, [isMuted, muteRemaining]);

  // 自动调整输入框高度
  const adjustTextareaHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) { return; }

    textarea.style.height = 'auto';
    const maxHeight = window.innerHeight / 5;
    const newHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${newHeight}px`;
  }, []);

  // 处理键盘事件
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isMuted) {
        onSendMessage();
      }
    }
  }, [onSendMessage, isMuted]);

  // 发送完成后重新聚焦
  useEffect(() => {
    if (!isSending && !isMuted) {
      textareaRef.current?.focus();
    }
  }, [isSending, isMuted]);

  // 禁言状态下的输入区域
  if (isMuted) {
    return (
      <motion.div
        key="input-area-muted"
        className="chat-input-area muted"
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }}
        transition={{ type: 'spring', damping: 28, stiffness: 350, mass: 0.8 }}
      >
        <div className="mute-notice">
          <MuteIcon />
          <span>{muteMessage}</span>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      key="input-area"
      className="chat-input-area"
      initial={{ y: 40, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 40, opacity: 0 }}
      transition={{ type: 'spring', damping: 28, stiffness: 350, mass: 0.8 }}
    >
      {/* 上传进度条 */}
      <AnimatePresence>
        {uploading && uploadingFile && uploadProgress && (
          <UploadProgress
            filename={uploadingFile.name}
            fileSize={uploadingFile.size}
            progress={uploadProgress}
            onCancel={onCancelUpload}
          />
        )}
      </AnimatePresence>

      <div className="input-wrapper multiline">
        {/* 文件附件按钮 */}
        <FileAttachButton
          disabled={isSending || uploading}
          onFileSelect={onFileSelect}
        />

        <textarea
          ref={textareaRef}
          placeholder="输入消息... (Shift+Enter 换行)"
          value={messageInput}
          onChange={(e) => {
            onMessageChange(e.target.value);
            adjustTextareaHeight();
          }}
          onKeyDown={handleKeyDown}
          disabled={isSending || uploading}
          rows={1}
        />
        <motion.button
          className="send-btn"
          onClick={onSendMessage}
          disabled={!messageInput.trim() || isSending || uploading}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          {isSending ? <LoadingSpinner /> : <SendIcon />}
        </motion.button>
      </div>
    </motion.div>
  );
}
