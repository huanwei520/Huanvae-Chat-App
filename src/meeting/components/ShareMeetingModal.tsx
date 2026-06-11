import { useState, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useApi } from '../../contexts/SessionContext';
import { useChatStore } from '../../stores/chatStore';
import { sendMessage } from '../../api/messages';
import { sendGroupMessage } from '../../api/groupMessages';
import { friendDisplayName } from '../../utils/friendName';
import type { Friend, Group } from '../../types/chat';
import './ShareMeetingModal.css';

interface ShareMeetingModalProps {
  isOpen: boolean;
  onClose: () => void;
  meetingData: {
    roomId: string;
    password: string;
    roomName: string;
    creatorName: string;
    creatorAvatar: string;
  };
}

type SelectionItem =
  | { type: 'friend'; id: string; name: string; avatar: string | null }
  | { type: 'group'; id: string; name: string; avatar: string };

export function ShareMeetingModal({ isOpen, onClose, meetingData }: ShareMeetingModalProps) {
  const api = useApi();
  const friends = useChatStore((s) => s.friends);
  const groups = useChatStore((s) => s.groups);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<SelectionItem[]>([]);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [activeTab, setActiveTab] = useState<'friends' | 'groups'>('friends');

  const filteredFriends = useMemo(() => {
    if (!search) { return friends; }
    const q = search.toLowerCase();
    return friends.filter((f: Friend) => friendDisplayName(f).toLowerCase().includes(q));
  }, [friends, search]);

  const filteredGroups = useMemo(() => {
    if (!search) { return groups; }
    const q = search.toLowerCase();
    return groups.filter((g: Group) => g.group_name.toLowerCase().includes(q));
  }, [groups, search]);

  const toggleSelect = useCallback((item: SelectionItem) => {
    setSelected((prev) => {
      const exists = prev.some((s) => s.type === item.type && s.id === item.id);
      return exists
        ? prev.filter((s) => !(s.type === item.type && s.id === item.id))
        : [...prev, item];
    });
  }, []);

  const isSelected = useCallback(
    (type: 'friend' | 'group', id: string) =>
      selected.some((s) => s.type === type && s.id === id),
    [selected],
  );

  const handleSend = useCallback(async () => {
    if (selected.length === 0 || sending) { return; }

    setSending(true);
    const content = JSON.stringify({
      room_id: meetingData.roomId,
      password: meetingData.password,
      room_name: meetingData.roomName,
      creator_name: meetingData.creatorName,
      creator_avatar: meetingData.creatorAvatar,
    });

    try {
      const promises = selected.map((item) => {
        if (item.type === 'friend') {
          return sendMessage(api, {
            receiver_id: item.id,
            message_content: content,
            message_type: 'meeting_invite',
          });
        } else {
          return sendGroupMessage(api, {
            group_id: item.id,
            message_content: content,
            message_type: 'meeting_invite',
          });
        }
      });

      await Promise.all(promises);
      setSent(true);
      setTimeout(() => {
        onClose();
        setSent(false);
        setSelected([]);
        setSearch('');
      }, 1000);
    } catch (err) {
      console.error('Failed to send meeting invite:', err);
    } finally {
      setSending(false);
    }
  }, [selected, sending, meetingData, api, onClose]);

  const handleClose = useCallback(() => {
    if (!sending) {
      onClose();
      setSelected([]);
      setSearch('');
    }
  }, [sending, onClose]);

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="share-meeting-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={handleClose}
        >
          <motion.div
            className="share-meeting-modal"
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.2 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="share-meeting-header">
              <h3>分享会议邀请</h3>
              <button className="share-meeting-close" onClick={handleClose}>&times;</button>
            </div>

            <div className="share-meeting-info">
              <span className="share-meeting-room-name">{meetingData.roomName}</span>
              <span className="share-meeting-room-id">#{meetingData.roomId}</span>
            </div>

            <input
              className="share-meeting-search"
              type="text"
              placeholder="搜索好友或群组..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />

            <div className="share-meeting-tabs">
              <button
                className={`share-meeting-tab ${activeTab === 'friends' ? 'active' : ''}`}
                onClick={() => setActiveTab('friends')}
              >
                好友 ({filteredFriends.length})
              </button>
              <button
                className={`share-meeting-tab ${activeTab === 'groups' ? 'active' : ''}`}
                onClick={() => setActiveTab('groups')}
              >
                群组 ({filteredGroups.length})
              </button>
            </div>

            <div className="share-meeting-list">
              {activeTab === 'friends'
                ? filteredFriends.map((f: Friend) => (
                  <div
                    key={f.friend_id}
                    className={`share-meeting-item ${isSelected('friend', f.friend_id) ? 'selected' : ''}`}
                    onClick={() =>
                      toggleSelect({
                        type: 'friend',
                        id: f.friend_id,
                        name: friendDisplayName(f),
                        avatar: f.friend_avatar_url,
                      })
                    }
                  >
                    <div className={`share-meeting-checkbox ${isSelected('friend', f.friend_id) ? 'checked' : ''}`} />
                    {f.friend_avatar_url ? (
                      <img className="share-meeting-avatar" src={f.friend_avatar_url} alt="" />
                    ) : (
                      <div className="share-meeting-avatar share-meeting-avatar-placeholder">
                        {friendDisplayName(f).charAt(0)}
                      </div>
                    )}
                    <span className="share-meeting-name">{friendDisplayName(f)}</span>
                  </div>
                ))
                : filteredGroups.map((g: Group) => (
                  <div
                    key={g.group_id}
                    className={`share-meeting-item ${isSelected('group', g.group_id) ? 'selected' : ''}`}
                    onClick={() =>
                      toggleSelect({
                        type: 'group',
                        id: g.group_id,
                        name: g.group_name,
                        avatar: g.group_avatar_url,
                      })
                    }
                  >
                    <div className={`share-meeting-checkbox ${isSelected('group', g.group_id) ? 'checked' : ''}`} />
                    <img className="share-meeting-avatar" src={g.group_avatar_url} alt="" />
                    <span className="share-meeting-name">{g.group_name}</span>
                  </div>
                ))}
            </div>

            <div className="share-meeting-footer">
              {selected.length > 0 && (
                <span className="share-meeting-count">已选 {selected.length} 个</span>
              )}
              <button
                className="share-meeting-send-btn"
                onClick={handleSend}
                disabled={selected.length === 0 || sending}
              >
                {(() => {
                  if (sent) { return '已发送'; }
                  if (sending) { return '发送中...'; }
                  return '发送';
                })()}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
