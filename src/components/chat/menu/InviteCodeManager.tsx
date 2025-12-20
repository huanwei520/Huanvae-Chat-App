/**
 * 邀请码管理组件
 */

import { useState } from 'react';
import { MenuHeader } from './MenuHeader';
import { TrashIcon, ClipboardIcon } from '../../common/Icons';
import type { InviteCode } from '../../../api/groups';

interface InviteCodeListProps {
  codes: InviteCode[];
  loading: boolean;
  onBack: () => void;
  onGenerate: () => void;
  onRevoke: (codeId: string) => void;
  onCopy: (code: string) => void;
}

export function InviteCodeList({
  codes,
  loading,
  onBack,
  onGenerate,
  onRevoke,
  onCopy,
}: InviteCodeListProps) {
  const formatTime = (timeStr: string) => {
    const date = new Date(timeStr);
    return date.toLocaleDateString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const isExpired = (expiresAt: string) => {
    return new Date(expiresAt) < new Date();
  };

  // 过滤掉已过期的邀请码
  const activeCodes = codes.filter((code) => !isExpired(code.expires_at));

  return (
    <>
      <MenuHeader title="邀请码管理" onBack={onBack} />
      <div className="menu-invite-codes">
        <button className="menu-item create-code-btn" onClick={onGenerate}>
          <span className="create-code-icon">+</span>
          <span>生成新邀请码</span>
        </button>

        {loading && <div className="menu-loading">加载中...</div>}
        {!loading && activeCodes.length === 0 && (
          <div className="menu-empty">暂无有效邀请码</div>
        )}
        {!loading && activeCodes.length > 0 && activeCodes.map((code) => (
          <div key={code.id} className="invite-code-item">
            <div className="invite-code-main">
              <div className="invite-code-value">
                <span className="code-text">{code.code}</span>
                <span className={`code-type ${code.code_type}`}>
                  {code.code_type === 'direct' ? '直通' : '需审核'}
                </span>
              </div>
              <div className="invite-code-info">
                <span>已使用 {code.used_count}/{code.max_uses}</span>
                <span>·</span>
                <span>过期: {formatTime(code.expires_at)}</span>
              </div>
            </div>
            <div className="invite-code-actions">
              <button
                className="code-action-btn copy"
                onClick={() => onCopy(code.code)}
                title="复制邀请码"
              >
                <ClipboardIcon />
              </button>
              <button
                className="code-action-btn delete"
                onClick={() => onRevoke(code.id)}
                title="撤销邀请码"
              >
                <TrashIcon />
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

interface GenerateCodeFormProps {
  loading: boolean;
  onBack: () => void;
  onSubmit: (maxUses: number, expiresInHours: number) => void;
}

export function GenerateCodeForm({
  loading,
  onBack,
  onSubmit,
}: GenerateCodeFormProps) {
  const [maxUses, setMaxUses] = useState(10);
  const [expiresInHours, setExpiresInHours] = useState(24);

  const handleSubmit = () => {
    onSubmit(maxUses, expiresInHours);
  };

  const expiresOptions = [
    { value: 1, label: '1小时' },
    { value: 6, label: '6小时' },
    { value: 24, label: '1天' },
    { value: 72, label: '3天' },
    { value: 168, label: '7天' },
  ];

  const usesOptions = [
    { value: 1, label: '1次' },
    { value: 5, label: '5次' },
    { value: 10, label: '10次' },
    { value: 50, label: '50次' },
    { value: 100, label: '100次' },
  ];

  return (
    <>
      <MenuHeader title="生成邀请码" onBack={onBack} />
      <div className="menu-form">
        <div className="form-group">
          <label className="form-label">最大使用次数</label>
          <div className="option-buttons">
            {usesOptions.map((opt) => (
              <button
                key={opt.value}
                className={`option-btn ${maxUses === opt.value ? 'active' : ''}`}
                onClick={() => setMaxUses(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">有效期</label>
          <div className="option-buttons">
            {expiresOptions.map((opt) => (
              <button
                key={opt.value}
                className={`option-btn ${expiresInHours === opt.value ? 'active' : ''}`}
                onClick={() => setExpiresInHours(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <button
          className="submit-btn"
          onClick={handleSubmit}
          disabled={loading}
        >
          {loading ? '生成中...' : '生成邀请码'}
        </button>
      </div>
    </>
  );
}
