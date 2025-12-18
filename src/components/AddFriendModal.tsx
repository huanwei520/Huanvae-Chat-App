/**
 * 添加好友弹窗组件
 *
 * 功能：
 * - 搜索用户
 * - 发送好友请求
 * - 查看待处理请求
 * - 同意/拒绝好友请求
 */

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useApi, useSession } from '../contexts/SessionContext';
import {
  sendFriendRequest,
  getPendingRequests,
  approveFriendRequest,
  rejectFriendRequest,
  type PendingRequest,
} from '../api/friends';

// ============================================
// 图标组件
// ============================================

const CloseIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width={20} height={20}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const SearchIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width={18} height={18}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
  </svg>
);

const UserPlusIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width={18} height={18}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM4 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 0110.374 21c-2.331 0-4.512-.645-6.374-1.766z" />
  </svg>
);

const CheckIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width={16} height={16}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
  </svg>
);

const XIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width={16} height={16}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const DefaultAvatar = ({ size = 40 }: { size?: number }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width={size} height={size}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
  </svg>
);

// ============================================
// 类型定义
// ============================================

interface AddFriendModalProps {
  isOpen: boolean;
  onClose: () => void;
  onFriendAdded?: () => void;
}

type TabType = 'add' | 'pending';

// ============================================
// 子组件
// ============================================

interface PendingRequestsListProps {
  loading: boolean;
  requests: PendingRequest[];
  onApprove: (request: PendingRequest) => void;
  onReject: (request: PendingRequest) => void;
}

function PendingRequestsList({ loading, requests, onApprove, onReject }: PendingRequestsListProps) {
  if (loading) {
    return <div className="loading-state">加载中...</div>;
  }

  if (requests.length === 0) {
    return <div className="empty-state">暂无待处理的好友请求</div>;
  }

  return (
    <div className="pending-list">
      {requests.map((request) => (
        <motion.div
          key={request.applicant_id}
          className="pending-item"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="pending-avatar">
            {request.applicant_avatar_url ? (
              <img src={request.applicant_avatar_url} alt={request.applicant_nickname} />
            ) : (
              <DefaultAvatar size={40} />
            )}
          </div>
          <div className="pending-info">
            <div className="pending-name">{request.applicant_nickname}</div>
            <div className="pending-id">@{request.applicant_id}</div>
            {request.reason && (
              <div className="pending-reason">{request.reason}</div>
            )}
          </div>
          <div className="pending-actions">
            <motion.button
              className="action-btn accept"
              onClick={() => onApprove(request)}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              title="同意"
            >
              <CheckIcon />
            </motion.button>
            <motion.button
              className="action-btn reject"
              onClick={() => onReject(request)}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              title="拒绝"
            >
              <XIcon />
            </motion.button>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

// ============================================
// 主组件
// ============================================

export function AddFriendModal({ isOpen, onClose, onFriendAdded }: AddFriendModalProps) {
  const api = useApi();
  const { session } = useSession();
  const userId = session?.userId || '';

  const [activeTab, setActiveTab] = useState<TabType>('add');
  const [searchQuery, setSearchQuery] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // 待处理请求
  const [pendingRequests, setPendingRequests] = useState<PendingRequest[]>([]);
  const [loadingPending, setLoadingPending] = useState(false);

  // 加载待处理请求
  const loadPendingRequests = useCallback(async () => {
    setLoadingPending(true);
    try {
      const response = await getPendingRequests(api);
      // 服务器返回格式: { items: PendingRequest[] }
      setPendingRequests(response.items || []);
    } catch {
      // 静默处理错误
      setPendingRequests([]);
    } finally {
      setLoadingPending(false);
    }
  }, [api]);

  // 切换到待处理标签时加载请求
  useEffect(() => {
    if (isOpen && activeTab === 'pending') {
      loadPendingRequests();
    }
  }, [isOpen, activeTab, loadPendingRequests]);

  // 发送好友请求
  const handleSendRequest = async () => {
    if (!searchQuery.trim()) {
      setError('请输入用户 ID');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      await sendFriendRequest(api, userId, searchQuery.trim(), reason);
      setSuccess(`已向 ${searchQuery} 发送好友请求`);
      setSearchQuery('');
      setReason('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '发送请求失败');
    } finally {
      setLoading(false);
    }
  };

  // 同意好友请求
  const handleApprove = async (request: PendingRequest) => {
    try {
      await approveFriendRequest(api, userId, request.applicant_id);
      setPendingRequests((prev) => prev.filter((r) => r.applicant_id !== request.applicant_id));
      onFriendAdded?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    }
  };

  // 拒绝好友请求
  const handleReject = async (request: PendingRequest) => {
    try {
      await rejectFriendRequest(api, userId, request.applicant_id);
      setPendingRequests((prev) => prev.filter((r) => r.applicant_id !== request.applicant_id));
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    }
  };

  const modalVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1 },
  };

  const contentVariants = {
    hidden: { opacity: 0, scale: 0.95, y: 20 },
    visible: {
      opacity: 1,
      scale: 1,
      y: 0,
      transition: { type: 'spring' as const, damping: 25, stiffness: 300 },
    },
    exit: { opacity: 0, scale: 0.95, y: 20 },
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="modal-overlay"
          variants={modalVariants}
          initial="hidden"
          animate="visible"
          exit="hidden"
          onClick={onClose}
        >
          <motion.div
            className="modal-content add-friend-modal"
            variants={contentVariants}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 头部 */}
            <div className="modal-header">
              <h2>添加好友</h2>
              <motion.button
                className="close-btn"
                onClick={onClose}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
              >
                <CloseIcon />
              </motion.button>
            </div>

            {/* 标签切换 */}
            <div className="profile-tabs">
              <button
                className={`tab-btn ${activeTab === 'add' ? 'active' : ''}`}
                onClick={() => setActiveTab('add')}
              >
                <UserPlusIcon />
                <span>添加好友</span>
              </button>
              <button
                className={`tab-btn ${activeTab === 'pending' ? 'active' : ''}`}
                onClick={() => setActiveTab('pending')}
              >
                <span>待处理</span>
                {pendingRequests.length > 0 && (
                  <span className="badge">{pendingRequests.length}</span>
                )}
              </button>
            </div>

            {/* 内容区域 */}
            <div className="add-friend-content">
              {activeTab === 'add' ? (
                <>
                  {/* 搜索输入 */}
                  <div className="search-section">
                    <div className="search-input-wrapper">
                      <SearchIcon />
                      <input
                        type="text"
                        className="glass-input"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="输入用户 ID"
                        onKeyDown={(e) => e.key === 'Enter' && handleSendRequest()}
                      />
                    </div>
                  </div>

                  {/* 验证消息 */}
                  <div className="form-group">
                    <label>验证消息（可选）</label>
                    <textarea
                      className="glass-input"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="介绍一下自己吧..."
                      maxLength={100}
                      rows={2}
                    />
                  </div>

                  {/* 发送按钮 */}
                  <motion.button
                    className="glass-button"
                    onClick={handleSendRequest}
                    disabled={loading || !searchQuery.trim()}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    {loading ? '发送中...' : '发送好友请求'}
                  </motion.button>
                </>
              ) : (
                <PendingRequestsList
                  loading={loadingPending}
                  requests={pendingRequests}
                  onApprove={handleApprove}
                  onReject={handleReject}
                />
              )}

              {/* 错误/成功提示 */}
              <AnimatePresence>
                {error && (
                  <motion.div
                    className="form-error"
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                  >
                    {error}
                  </motion.div>
                )}
                {success && (
                  <motion.div
                    className="form-success"
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                  >
                    {success}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
