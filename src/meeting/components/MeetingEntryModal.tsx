/**
 * 会议入口弹窗组件
 *
 * 提供会议创建和加入功能：
 * - 创建会议：生成房间号和密码
 * - 加入会议：输入房间号和密码加入
 * - 复制房间信息
 *
 * 会议窗口通过 Tauri WebviewWindow API 打开为独立窗口
 * 与主页面同时存在
 */

import { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { useApi, useSession } from '../../contexts/SessionContext';
import {
  createRoom,
  joinRoom,
  saveMeetingData,
  type CreateRoomResponse,
} from '../api';
import { CopyIcon, VideoMeetingIcon } from '../../components/common/Icons';

/**
 * 打开会议窗口
 * 使用 Tauri WebviewWindow API 创建独立窗口
 */
async function openMeetingWindow(): Promise<void> {
  // 检查是否已有会议窗口
  const existing = await WebviewWindow.getByLabel('meeting');
  if (existing) {
    // 如果已存在，聚焦到该窗口
    await existing.setFocus();
    return;
  }

  // 创建新的会议窗口
  const meetingWindow = new WebviewWindow('meeting', {
    url: '/meeting',
    title: '视频会议',
    width: 1200,
    height: 800,
    center: true,
    decorations: true,
    resizable: true,
    focus: true,
  });

  // 监听窗口创建结果
  meetingWindow.once('tauri://error', (e) => {
    console.error('创建会议窗口失败:', e);
  });
}

interface MeetingEntryModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Tab = 'create' | 'join';

/** 弹窗动画配置 */
const overlayVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};

const modalVariants = {
  hidden: { opacity: 0, scale: 0.95, y: 20 },
  visible: { opacity: 1, scale: 1, y: 0 },
};

export function MeetingEntryModal({ isOpen, onClose }: MeetingEntryModalProps) {
  const api = useApi();
  const { session } = useSession();

  // 当前标签页
  const [activeTab, setActiveTab] = useState<Tab>('create');

  // 创建房间状态
  const [roomName, setRoomName] = useState('');
  const [roomPassword, setRoomPassword] = useState('');
  const [maxParticipants, setMaxParticipants] = useState(10);
  const [createdRoom, setCreatedRoom] = useState<CreateRoomResponse | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // 加入房间状态
  const [joinRoomId, setJoinRoomId] = useState('');
  const [joinPassword, setJoinPassword] = useState('');
  const [displayName, setDisplayName] = useState(session?.profile.user_nickname || '');
  const [isJoining, setIsJoining] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [parseSuccess, setParseSuccess] = useState(false);

  // 错误提示
  const [error, setError] = useState<string | null>(null);
  // 复制成功提示
  const [copied, setCopied] = useState(false);

  /**
   * 解析粘贴的房间信息
   * 支持格式：
   * 会议名称: xxx
   * 房间号: xxx
   * 密码: xxx
   */
  const parseRoomInfo = useCallback((text: string) => {
    setPasteText(text);
    setParseSuccess(false);

    if (!text.trim()) {
      return;
    }

    // 正则匹配房间号和密码（匹配到行尾或下一个字段之前）
    // 使用 [^\n\r]* 匹配到行尾，然后 trim 去除空白
    const roomIdMatch = text.match(/房间号[：:]\s*([A-Za-z0-9]+)/);
    const passwordMatch = text.match(/密码[：:]\s*([0-9]+)/);

    if (roomIdMatch && roomIdMatch[1]) {
      setJoinRoomId(roomIdMatch[1].trim());
    }
    if (passwordMatch && passwordMatch[1]) {
      setJoinPassword(passwordMatch[1].trim());
    }

    // 如果成功解析到房间号和密码，显示成功提示
    if (roomIdMatch && passwordMatch) {
      setParseSuccess(true);
      setTimeout(() => setParseSuccess(false), 2000);
    }
  }, []);

  // 创建会议房间
  const handleCreate = useCallback(async () => {
    setIsCreating(true);
    setError(null);

    try {
      const room = await createRoom(api, {
        name: roomName || undefined,
        display_name: session?.profile.user_nickname || undefined,
        avatar_url: session?.profile.user_avatar_url || undefined, // 传入创建者头像URL
        password: roomPassword || undefined,
        max_participants: maxParticipants,
      });
      setCreatedRoom(room);
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建会议失败');
    } finally {
      setIsCreating(false);
    }
  }, [api, roomName, roomPassword, maxParticipants, session]);

  // 重置表单状态
  const resetState = useCallback(() => {
    setCreatedRoom(null);
    setError(null);
    setRoomName('');
    setRoomPassword('');
    setJoinRoomId('');
    setJoinPassword('');
    setPasteText('');
    setParseSuccess(false);
    setActiveTab('create');
  }, []);

  // 加入已创建的房间（作为创建者）
  const handleJoinCreatedRoom = useCallback(async () => {
    if (!createdRoom) {
      return;
    }

    setIsJoining(true);
    setError(null);

    try {
      // 保存会议数据到 localStorage（使用创建房间返回的 ws_token）
      saveMeetingData({
        role: 'creator',
        roomId: createdRoom.room_id,
        password: createdRoom.password,
        roomName: createdRoom.name,
        displayName: session?.profile.user_nickname || '会议主持人',
        token: createdRoom.ws_token,
        userInfo: createdRoom.user_info, // 保存创建者用户信息
        serverUrl: session?.serverUrl || '', // 当前登录的服务器地址
      });

      // 打开会议窗口（使用 Tauri WebviewWindow）
      await openMeetingWindow();

      // 重置状态并关闭弹窗
      resetState();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '加入会议失败');
    } finally {
      setIsJoining(false);
    }
  }, [createdRoom, session, resetState, onClose]);

  // 加入会议房间（作为参与者）
  const handleJoin = useCallback(async () => {
    if (!joinRoomId || !joinPassword) {
      setError('请输入房间号和密码');
      return;
    }

    setIsJoining(true);
    setError(null);

    try {
      // 如果用户已登录，传入头像URL
      const avatarUrl = session?.profile.user_avatar_url || undefined;
      const response = await joinRoom(api, joinRoomId, joinPassword, displayName, avatarUrl);

      // 保存会议数据到 localStorage
      saveMeetingData({
        role: 'participant',
        roomId: joinRoomId,
        password: joinPassword,
        roomName: response.room_name,
        displayName,
        token: response.ws_token,
        iceServers: response.ice_servers,
        userInfo: response.user_info, // 保存用户信息
        serverUrl: session?.serverUrl || '', // 当前登录的服务器地址
      });

      // 打开会议窗口（使用 Tauri WebviewWindow）
      await openMeetingWindow();

      // 重置状态并关闭弹窗
      resetState();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '加入会议失败');
    } finally {
      setIsJoining(false);
    }
  }, [api, joinRoomId, joinPassword, displayName, session, resetState, onClose]);

  // 复制房间信息
  const handleCopy = useCallback(() => {
    if (!createdRoom) {
      return;
    }

    const text = `会议名称: ${createdRoom.name}\n房间号: ${createdRoom.room_id}\n密码: ${createdRoom.password}`;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [createdRoom]);

  // 关闭弹窗并重置状态
  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [resetState, onClose]);

  const modalContent = (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="meeting-modal-overlay"
          variants={overlayVariants}
          initial="hidden"
          animate="visible"
          exit="hidden"
          onClick={handleClose}
        >
          <motion.div
            className="meeting-modal"
            variants={modalVariants}
            initial="hidden"
            animate="visible"
            exit="hidden"
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 标题 */}
            <div className="meeting-modal-header">
              <VideoMeetingIcon />
              <h2>视频会议</h2>
            </div>

            {/* 标签页切换 */}
            <div className="meeting-tabs">
              <button
                className={`meeting-tab ${activeTab === 'create' ? 'active' : ''}`}
                onClick={() => {
                  setActiveTab('create');
                  setError(null);
                }}
              >
                创建会议
              </button>
              <button
                className={`meeting-tab ${activeTab === 'join' ? 'active' : ''}`}
                onClick={() => {
                  setActiveTab('join');
                  setError(null);
                }}
              >
                加入会议
              </button>
            </div>

            {/* 内容区域 */}
            <div className="meeting-modal-content">
              {activeTab === 'create' && (
                <>
                  {createdRoom ? (
                    // 创建成功后显示房间信息
                    <div className="meeting-created-info">
                      <div className="meeting-info-row">
                        <span className="meeting-info-label">会议名称</span>
                        <span className="meeting-info-value">{createdRoom.name}</span>
                      </div>
                      <div className="meeting-info-row">
                        <span className="meeting-info-label">房间号</span>
                        <span className="meeting-info-value">{createdRoom.room_id}</span>
                      </div>
                      <div className="meeting-info-row">
                        <span className="meeting-info-label">密码</span>
                        <span className="meeting-info-value">{createdRoom.password}</span>
                      </div>

                      <div className="meeting-actions">
                        <button
                          className="meeting-btn secondary"
                          onClick={handleCopy}
                          disabled={copied}
                        >
                          <CopyIcon />
                          {copied ? '已复制' : '复制信息'}
                        </button>
                        <button
                          className="meeting-btn primary"
                          onClick={handleJoinCreatedRoom}
                          disabled={isJoining}
                        >
                          {isJoining ? '加入中...' : '加入会议'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    // 创建表单
                    <div className="meeting-form">
                      <div className="meeting-form-group">
                        <label>会议名称（可选）</label>
                        <input
                          type="text"
                          value={roomName}
                          onChange={(e) => setRoomName(e.target.value)}
                          placeholder="输入会议名称"
                          className="meeting-input"
                        />
                      </div>
                      <div className="meeting-form-group">
                        <label>会议密码（可选，6位数字）</label>
                        <input
                          type="text"
                          value={roomPassword}
                          onChange={(e) => setRoomPassword(e.target.value)}
                          placeholder="不填则自动生成"
                          maxLength={6}
                          className="meeting-input"
                        />
                      </div>
                      <div className="meeting-form-group">
                        <label>最大人数</label>
                        <input
                          type="number"
                          value={maxParticipants}
                          onChange={(e) => setMaxParticipants(Number(e.target.value))}
                          min={2}
                          max={50}
                          className="meeting-input"
                        />
                      </div>

                      <button
                        className="meeting-btn primary full-width"
                        onClick={handleCreate}
                        disabled={isCreating}
                      >
                        {isCreating ? '创建中...' : '创建会议'}
                      </button>
                    </div>
                  )}
                </>
              )}

              {activeTab === 'join' && (
                <div className="meeting-form">
                  {/* 快速解析区域 */}
                  <div className="meeting-form-group">
                    <label>
                      快速加入（粘贴房间信息）
                      {parseSuccess && <span className="parse-success">✓ 已解析</span>}
                    </label>
                    <textarea
                      value={pasteText}
                      onChange={(e) => parseRoomInfo(e.target.value)}
                      onPaste={(e) => {
                        // 直接获取粘贴的文本并解析
                        const text = e.clipboardData.getData('text');
                        parseRoomInfo(text);
                      }}
                      placeholder={'粘贴房间信息自动填入，格式：\n会议名称: xxx\n房间号: xxx\n密码: xxx'}
                      className="meeting-input meeting-textarea"
                      rows={3}
                    />
                  </div>

                  <div className="meeting-form-divider">
                    <span>或手动输入</span>
                  </div>

                  <div className="meeting-form-group">
                    <label>房间号</label>
                    <input
                      type="text"
                      value={joinRoomId}
                      onChange={(e) => setJoinRoomId(e.target.value)}
                      placeholder="输入房间号"
                      className="meeting-input"
                    />
                  </div>
                  <div className="meeting-form-group">
                    <label>密码</label>
                    <input
                      type="text"
                      value={joinPassword}
                      onChange={(e) => setJoinPassword(e.target.value)}
                      placeholder="输入会议密码"
                      className="meeting-input"
                    />
                  </div>
                  <div className="meeting-form-group">
                    <label>显示名称</label>
                    <input
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="输入您的显示名称"
                      className="meeting-input"
                    />
                  </div>

                  <button
                    className="meeting-btn primary full-width"
                    onClick={handleJoin}
                    disabled={isJoining}
                  >
                    {isJoining ? '加入中...' : '加入会议'}
                  </button>
                </div>
              )}

              {/* 错误提示 */}
              {error && <div className="meeting-error">{error}</div>}
            </div>

            {/* 关闭按钮 */}
            <button className="meeting-modal-close" onClick={handleClose}>
              ×
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return createPortal(modalContent, document.body);
}
