/**
 * 聊天输入区域组件
 *
 * 包含：
 * - 文件附件按钮
 * - 文本输入框（支持多行）
 * - 发送按钮
 * - 上传进度条
 */

import { useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FileAttachButton, type AttachmentType } from './FileAttachButton';
import { UploadProgress } from './UploadProgress';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { SendIcon } from '../common/Icons';
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
      onSendMessage();
    }
  }, [onSendMessage]);

  // 发送完成后重新聚焦
  useEffect(() => {
    if (!isSending) {
      textareaRef.current?.focus();
    }
  }, [isSending]);

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
