/**
 * 群公告列表组件
 */

import { useState } from 'react';
import { MenuHeader } from './MenuHeader';
import { TrashIcon, EditIcon } from '../../../components/common/Icons';
import type { GroupNotice } from '../../../api/groups';

interface NoticesListProps {
  notices: GroupNotice[];
  loading: boolean;
  isOwnerOrAdmin: boolean;
  onBack: () => void;
  onCreateNotice: () => void;
  onDeleteNotice: (noticeId: string) => void;
}

export function NoticesList({
  notices,
  loading,
  isOwnerOrAdmin,
  onBack,
  onCreateNotice,
  onDeleteNotice,
}: NoticesListProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const formatTime = (timeStr: string) => {
    const date = new Date(timeStr);
    return date.toLocaleDateString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <>
      <MenuHeader title="群公告" onBack={onBack} />
      <div className="menu-notices-list">
        {isOwnerOrAdmin && (
          <button className="menu-item create-notice-btn" onClick={onCreateNotice}>
            <EditIcon />
            <span>发布新公告</span>
          </button>
        )}

        {loading && <div className="menu-loading">加载中...</div>}
        {!loading && notices.length === 0 && (
          <div className="menu-empty">暂无公告</div>
        )}
        {!loading && notices.length > 0 && notices.map((notice) => (
          <div
            key={notice.id}
            className={`notice-item ${expandedId === notice.id ? 'expanded' : ''}`}
            onClick={() => setExpandedId(expandedId === notice.id ? null : notice.id)}
          >
            <div className="notice-header">
              <span className="notice-title">
                {notice.is_pinned && <span className="notice-pin">置顶</span>}
                {notice.title}
              </span>
              <span className="notice-time">{formatTime(notice.published_at)}</span>
            </div>
            {expandedId === notice.id && (
              <div className="notice-body">
                <p className="notice-content">{notice.content}</p>
                <div className="notice-footer">
                  <span className="notice-publisher">
                      发布者: {notice.publisher_nickname}
                  </span>
                  {isOwnerOrAdmin && (
                    <button
                      className="notice-delete-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteNotice(notice.id);
                      }}
                    >
                      <TrashIcon />
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

interface CreateNoticeFormProps {
  loading: boolean;
  onBack: () => void;
  onSubmit: (title: string, content: string, isPinned: boolean) => void;
}

export function CreateNoticeForm({
  loading,
  onBack,
  onSubmit,
}: CreateNoticeFormProps) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [isPinned, setIsPinned] = useState(false);

  const handleSubmit = () => {
    if (title.trim() && content.trim()) {
      onSubmit(title.trim(), content.trim(), isPinned);
    }
  };

  return (
    <>
      <MenuHeader title="发布公告" onBack={onBack} />
      <div className="menu-form">
        <input
          type="text"
          className="menu-input"
          placeholder="公告标题"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={50}
        />
        <textarea
          className="menu-textarea"
          placeholder="公告内容..."
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={4}
          maxLength={500}
        />
        <label className="menu-checkbox">
          <input
            type="checkbox"
            checked={isPinned}
            onChange={(e) => setIsPinned(e.target.checked)}
          />
          <span>置顶公告</span>
        </label>
        <button
          className="submit-btn"
          onClick={handleSubmit}
          disabled={loading || !title.trim() || !content.trim()}
        >
          {loading ? '发布中...' : '发布公告'}
        </button>
      </div>
    </>
  );
}
