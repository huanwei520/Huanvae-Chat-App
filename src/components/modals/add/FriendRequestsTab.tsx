/**
 * 好友申请列表 Tab
 */

import { motion } from 'framer-motion';
import { UserIcon, CheckIcon, XIcon } from '../../common/Icons';
import type { PendingRequest } from '../../../api/friends';

interface FriendRequestsTabProps {
  loading: boolean;
  requests: PendingRequest[];
  onApprove: (request: PendingRequest) => void;
  onReject: (request: PendingRequest) => void;
}

// 大尺寸用户图标用于空状态
const UserIconLarge = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width={32} height={32}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
  </svg>
);

export function FriendRequestsTab({
  loading,
  requests,
  onApprove,
  onReject,
}: FriendRequestsTabProps) {
  if (loading) {
    return <div className="loading-state">加载中...</div>;
  }

  if (requests.length === 0) {
    return (
      <div className="empty-state">
        <UserIconLarge />
        <p>暂无好友申请</p>
      </div>
    );
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
              <UserIcon />
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

