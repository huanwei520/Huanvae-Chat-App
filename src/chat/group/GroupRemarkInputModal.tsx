/**
 * 群内私有备注输入弹窗（D7）
 *
 * @module chat/group/GroupRemarkInputModal
 * @location src/chat/group/GroupRemarkInputModal.tsx
 *
 * 给某群成员设置仅自己可见的备注名。由群消息右键菜单「设置备注」触发。
 * 纯（非 framer-motion）Portal 弹窗：避免与 CSS transition 抢同帧，无需进 animation-conflict 注册表。
 * 提交规则：保存非空备注 = 设置/更新；清除 = 删除备注（onSave 传空串）。
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** 备注长度上限（与后端 REMARK_MAX_LEN 对齐） */
const REMARK_MAX_LEN = 50;

interface GroupRemarkInputModalProps {
  isOpen: boolean;
  /** 被备注成员的当前显示名（占位提示用） */
  memberName: string;
  /** 当前已设备注（编辑时回填；未设为空串） */
  currentRemark: string;
  /** 保存：传非空串=设置/更新，传空串=清除 */
  onSave: (remark: string) => void;
  onClose: () => void;
}

export function GroupRemarkInputModal({
  isOpen,
  memberName,
  currentRemark,
  onSave,
  onClose,
}: GroupRemarkInputModalProps) {
  const [value, setValue] = useState(currentRemark);
  const inputRef = useRef<HTMLInputElement>(null);

  // 每次打开时用当前备注回填，并聚焦
  useEffect(() => {
    if (isOpen) {
      setValue(currentRemark);
      const timer = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen, currentRemark]);

  // ESC 关闭
  useEffect(() => {
    if (!isOpen) { return; }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) { return null; }

  const trimmed = value.trim();
  const handleSave = () => {
    onSave(trimmed);
    onClose();
  };
  const handleClear = () => {
    onSave('');
    onClose();
  };

  const content = (
    <div className="group-remark-overlay" onClick={onClose}>
      <div className="group-remark-panel" onClick={(e) => e.stopPropagation()}>
        <div className="group-remark-title">设置群内备注</div>
        <div className="group-remark-sub">仅自己可见，作用于「{memberName}」在本群的显示名</div>
        <input
          ref={inputRef}
          className="group-remark-input"
          type="text"
          value={value}
          maxLength={REMARK_MAX_LEN}
          placeholder="输入备注名"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && trimmed) { handleSave(); } }}
        />
        <div className="group-remark-actions">
          {currentRemark && (
            <button type="button" className="group-remark-btn group-remark-btn-clear" onClick={handleClear}>
              清除备注
            </button>
          )}
          <div className="group-remark-actions-right">
            <button type="button" className="group-remark-btn" onClick={onClose}>取消</button>
            <button
              type="button"
              className="group-remark-btn group-remark-btn-primary"
              onClick={handleSave}
              disabled={!trimmed}
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
