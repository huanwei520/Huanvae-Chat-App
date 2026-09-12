/**
 * 移动端视频会议入口页面
 *
 * 提供创建会议和加入会议的入口：
 * - 创建会议：生成房间号和密码
 * - 加入会议：输入房间号和密码加入
 * - 支持粘贴解析房间信息
 *
 * 与桌面端 MeetingEntryModal 功能相同，但使用全屏页面替代弹窗
 *
 * @module pages/mobile/MobileMeetingEntryPage
 */

import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useApi, useSession } from '../../contexts/SessionContext';
import {
  createRoom,
  joinRoom,
  saveMeetingData,
} from '../../meeting/api';
import { getMeetingIdentity } from '../../meeting/identity';
import { fetchCreatorIceServers } from '../../meeting/creatorIce';
import {
  VideoMeetingIcon,
} from '../../components/common/Icons';

// 返回按钮图标（内联定义，避免导入不存在的图标）
const BackIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    width="24"
    height="24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M15.75 19.5L8.25 12l7.5-7.5"
    />
  </svg>
);

// ============================================
// 类型定义
// ============================================

interface MobileMeetingEntryPageProps {
  onClose: () => void;
  onEnterMeeting: () => void;
}

type Tab = 'create' | 'join';

// ============================================
// 主组件
// ============================================

export function MobileMeetingEntryPage({ onClose, onEnterMeeting }: MobileMeetingEntryPageProps) {
  const api = useApi();
  const { session } = useSession();

  // 当前标签页
  const [activeTab, setActiveTab] = useState<Tab>('create');

  // 创建房间状态
  const [roomName, setRoomName] = useState('');
  const [roomPassword, setRoomPassword] = useState('');
  const [maxParticipants, setMaxParticipants] = useState(10);
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

  /**
   * 解析粘贴的房间信息
   */
  const parseRoomInfo = useCallback((text: string) => {
    setPasteText(text);
    setParseSuccess(false);

    if (!text.trim()) {
      return;
    }

    const roomIdMatch = text.match(/房间号[：:]\s*([A-Za-z0-9]+)/);
    const passwordMatch = text.match(/密码[：:]\s*([0-9]+)/);

    if (roomIdMatch && roomIdMatch[1]) {
      setJoinRoomId(roomIdMatch[1].trim());
    }
    if (passwordMatch && passwordMatch[1]) {
      setJoinPassword(passwordMatch[1].trim());
    }

    if (roomIdMatch && passwordMatch) {
      setParseSuccess(true);
      setTimeout(() => setParseSuccess(false), 2000);
    }
  }, []);

  // 创建会议房间并直接入会
  // 2026-09-10 会议分享改版（块 1788982832352-3）①：创建成功后不再展示「会议信息」
  // 中间页（房间号/密码/复制信息/进入会议），而是取 ICE → 存会议数据 → 进会议页
  // 一气呵成；任一步失败即在本页报错，不半途进会。
  const handleCreate = useCallback(async () => {
    setIsCreating(true);
    setError(null);

    try {
      const room = await createRoom(api, {
        name: roomName || undefined,
        display_name: session?.profile.user_nickname || undefined,
        avatar_url: session?.profile.user_avatar_url || undefined,
        password: roomPassword || undefined,
        max_participants: maxParticipants,
        // 8.2 同账号同设备重复入会顶替：创建者也带设备标识
        device_id: (await getMeetingIdentity(session?.profile.user_id)).deviceId,
      });

      // 与桌面端同一件事：createRoom 的响应不带 ice_servers，创建者必须自己取一次，
      // 否则会议页只能退到公共 STUN（见 meeting/creatorIce 的模块注释）。
      const iceServers = await fetchCreatorIceServers(api);

      saveMeetingData({
        role: 'creator',
        roomId: room.room_id,
        password: room.password,
        roomName: room.name,
        displayName: session?.profile.user_nickname || '会议主持人',
        token: room.ws_token,
        iceServers,
        userInfo: room.user_info,
        serverUrl: session?.serverUrl || '',
      });

      // 直接进入会议页面（无信息中间页）
      onEnterMeeting();
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建会议失败');
    } finally {
      setIsCreating(false);
    }
  }, [api, roomName, roomPassword, maxParticipants, session, onEnterMeeting]);

  // 加入会议房间（作为参与者）
  const handleJoin = useCallback(async () => {
    if (!joinRoomId || !joinPassword) {
      setError('请输入房间号和密码');
      return;
    }

    setIsJoining(true);
    setError(null);

    try {
      const avatarUrl = session?.profile.user_avatar_url || undefined;
      // 8.2 同账号同设备重复入会顶替：登录用户上报 user_id + device_id（访客两参皆空不参与）
      const identity = await getMeetingIdentity(session?.profile.user_id);
      const response = await joinRoom(api, joinRoomId, joinPassword, displayName, avatarUrl, identity);

      saveMeetingData({
        role: 'participant',
        roomId: joinRoomId,
        password: joinPassword,
        roomName: response.room_name,
        displayName,
        token: response.ws_token,
        iceServers: response.ice_servers,
        userInfo: response.user_info,
        serverUrl: session?.serverUrl || '',
      });

      // 进入会议页面
      onEnterMeeting();
    } catch (err) {
      setError(err instanceof Error ? err.message : '加入会议失败');
    } finally {
      setIsJoining(false);
    }
  }, [api, joinRoomId, joinPassword, displayName, session, onEnterMeeting]);

  return (
    <motion.div
      className="mobile-meeting-entry-page"
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'tween', duration: 0.25 }}
    >
      {/* 顶部导航栏 */}
      <header className="mobile-meeting-entry-header">
        <button className="mobile-back-btn" onClick={onClose}>
          <BackIcon />
        </button>
        <h1>视频会议</h1>
        <div className="mobile-header-placeholder" />
      </header>

      {/* 内容区域 */}
      <main className="mobile-meeting-entry-content">
        {/* 图标 */}
        <div className="mobile-meeting-icon">
          <VideoMeetingIcon />
        </div>

        {/* 标签页切换 */}
        <div className="mobile-meeting-tabs">
          <button
            className={`mobile-meeting-tab ${activeTab === 'create' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('create');
              setError(null);
            }}
          >
            创建会议
          </button>
          <button
            className={`mobile-meeting-tab ${activeTab === 'join' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('join');
              setError(null);
            }}
          >
            加入会议
          </button>
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="mobile-meeting-error">
            {error}
          </div>
        )}

        {/* 创建会议表单（创建成功直接入会，无信息中间页） */}
        {activeTab === 'create' && (
          <div className="mobile-meeting-form">
            <div className="mobile-meeting-field">
              <label>会议名称（可选）</label>
              <input
                type="text"
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                placeholder="输入会议名称"
              />
            </div>
            <div className="mobile-meeting-field">
              <label>密码（可选，自动生成）</label>
              <input
                type="text"
                value={roomPassword}
                onChange={(e) => setRoomPassword(e.target.value)}
                placeholder="6位数字密码"
                maxLength={6}
              />
            </div>
            <div className="mobile-meeting-field">
              <label>最大人数</label>
              <select
                value={maxParticipants}
                onChange={(e) => setMaxParticipants(Number(e.target.value))}
              >
                <option value={5}>5人</option>
                <option value={10}>10人</option>
                <option value={20}>20人</option>
                <option value={50}>50人</option>
              </select>
            </div>
            <button
              className="mobile-meeting-submit"
              onClick={handleCreate}
              disabled={isCreating}
            >
              {isCreating ? '创建并进入中...' : '创建会议'}
            </button>
          </div>
        )}

        {/* 加入会议表单 */}
        {activeTab === 'join' && (
          <div className="mobile-meeting-form">
            <div className="mobile-meeting-field">
              <label>粘贴房间信息（可选）</label>
              <textarea
                value={pasteText}
                onChange={(e) => parseRoomInfo(e.target.value)}
                placeholder="粘贴包含房间号和密码的文本"
                rows={3}
              />
              {parseSuccess && (
                <span className="parse-success">✓ 解析成功</span>
              )}
            </div>
            <div className="mobile-meeting-field">
              <label>房间号</label>
              <input
                type="text"
                value={joinRoomId}
                onChange={(e) => setJoinRoomId(e.target.value)}
                placeholder="输入房间号"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
            <div className="mobile-meeting-field">
              <label>密码</label>
              <input
                type="text"
                value={joinPassword}
                onChange={(e) => setJoinPassword(e.target.value)}
                placeholder="输入6位数字密码"
                maxLength={6}
              />
            </div>
            <div className="mobile-meeting-field">
              <label>显示名称</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="在会议中显示的名称"
              />
            </div>
            <button
              className="mobile-meeting-submit"
              onClick={handleJoin}
              disabled={isJoining || !joinRoomId || !joinPassword}
            >
              {isJoining ? '加入中...' : '加入会议'}
            </button>
          </div>
        )}
      </main>
    </motion.div>
  );
}
