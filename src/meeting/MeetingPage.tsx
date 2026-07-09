/**
 * 视频会议页面
 *
 * 作为独立窗口运行，与主应用窗口同时存在
 * 通过 localStorage 获取会议数据
 *
 * 功能：
 * - 本地视频预览
 * - 远程参与者视频显示
 * - 麦克风/摄像头控制
 * - 屏幕共享
 * - 参与者列表
 * - 全屏聚焦模式：点击任意 tile 弹出全窗口覆盖层（Spotlight Overlay），
 *   主画面铺满窗口，底部浮动缩略图条 + 操作按钮（鼠标静止 3s 自动隐藏），
 *   ⛶ 按钮可进入显示器全屏（Fullscreen API），Esc 分层退出
 *
 * @see backend-docs/webrtc/WebRTC房间.md
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  useWebRTC,
  type RemoteParticipant,
  type ScreenShareSettings,
  type ScreenShareResolution,
  type ScreenShareFrameRate,
  getAvailableResolutions,
  RESOLUTION_MAP,
} from './useWebRTC';
import { loadMeetingData, clearMeetingData, joinRoom, type MeetingWindowData, type IceServer } from './api';
import { createApiClient } from '../api/client';
import {
  MicOnIcon,
  MicOffIcon,
  VideoOnIcon,
  VideoOffIcon,
  ScreenShareIcon,
  ScreenShareOffIcon,
  PhoneEndIcon,
  ParticipantsIcon,
  CopyIcon,
  ShareIcon,
} from '../components/common/Icons';
import { MediaPermissionGuide } from './components/MediaPermissionGuide';
import { resolveServerAvatarUrl } from '../utils/avatar';
import { AvatarPlaceholder } from '../components/common/AvatarPlaceholder';
import './styles.css';

/**
 * 参与者视频组件
 *
 * 视频流优先级：
 * 1. screenStream（屏幕共享）- 优先显示
 * 2. cameraStream（摄像头）
 * 3. stream（未区分的混合流，兼容旧逻辑）
 *
 * 轨道状态检测使用事件监听（mute/unmute/ended）+ 500ms 轮询兜底，
 * srcObject 在 stream 或 hasActiveVideo 变化时直接更新，不使用缓存
 *
 * 支持聚焦模式：点击 tile 可将该参与者放大为主画面
 */
function ParticipantVideo({
  participant,
  isLocal,
  roomName,
  isSpeaking,
  onClick,
}: {
  participant?: RemoteParticipant;
  isLocal?: boolean;
  roomName?: string;
  isSpeaking?: boolean;
  onClick?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  // 视频流优先级：屏幕共享 > 摄像头 > 混合流
  const stream = participant?.screenStream || participant?.cameraStream || participant?.stream;
  const [hasActiveVideo, setHasActiveVideo] = useState(false);
  // 是否正在共享屏幕（用于 UI 提示）：优先读粗粒度信令 media_state，
  // 让徽章在屏幕轨到达前即正确显示；回退到实际收到的 screenStream。
  const isScreenSharing = participant?.media_state?.screen ?? !!participant?.screenStream;

  // 检查视频轨道状态（事件监听 + 轮询兜底，与 LocalVideo 一致）
  useEffect(() => {
    if (!stream) {
      setHasActiveVideo(false);
      return;
    }

    const checkVideoTrack = () => {
      const videoTracks = stream.getVideoTracks();
      const hasLiveVideo = videoTracks.some(
        (track) => track.readyState === 'live' && !track.muted,
      );
      setHasActiveVideo(hasLiveVideo);
    };

    checkVideoTrack();

    const videoTracks = stream.getVideoTracks();
    const handleTrackChange = () => checkVideoTrack();

    videoTracks.forEach((track) => {
      track.addEventListener('ended', handleTrackChange);
      track.addEventListener('mute', handleTrackChange);
      track.addEventListener('unmute', handleTrackChange);
    });

    stream.addEventListener('addtrack', handleTrackChange);
    stream.addEventListener('removetrack', handleTrackChange);

    // 轮询兜底 enabled 属性变化（无原生事件）
    const interval = setInterval(checkVideoTrack, 500);

    return () => {
      videoTracks.forEach((track) => {
        track.removeEventListener('ended', handleTrackChange);
        track.removeEventListener('mute', handleTrackChange);
        track.removeEventListener('unmute', handleTrackChange);
      });
      stream.removeEventListener('addtrack', handleTrackChange);
      stream.removeEventListener('removetrack', handleTrackChange);
      clearInterval(interval);
    };
  }, [stream]);

  // 设置视频源（hasActiveVideo 变化时直接更新，不使用缓存）
  useEffect(() => {
    if (videoRef.current) {
      if (stream && hasActiveVideo) {
        videoRef.current.srcObject = stream;
      } else {
        videoRef.current.srcObject = null;
      }
    }
  }, [stream, hasActiveVideo]);

  // ============================================================
  // 修复：单独处理音频播放
  // 即使没有视频轨道，也需要播放远程音频
  // 注意：音频从原始 participant.stream 播放，不从区分后的视频流
  // ============================================================
  const audioStream = participant?.stream;
  useEffect(() => {
    // 本地用户不需要播放自己的音频（会产生回声）
    if (isLocal) {
      return undefined;
    }

    const audioElement = audioRef.current;
    if (audioElement && audioStream) {
      // 检查是否有音频轨道
      const audioTracks = audioStream.getAudioTracks();
      if (audioTracks.length > 0) {
        audioElement.srcObject = audioStream;
        // 尝试播放（处理 autoplay 限制）
        audioElement.play().catch(() => {
          // 忽略 autoplay 限制错误，用户交互后会自动播放
        });
      }
    }

    return () => {
      if (audioElement) {
        audioElement.srcObject = null;
      }
    };
  }, [audioStream, isLocal]);

  // 修复：如果创建者的名称与房间名称相同，说明后端返回的是房间名而非用户名
  const displayName = (() => {
    if (isLocal) {
      return '我';
    }
    if (!participant) {
      return '未知';
    }
    // 如果是创建者且名称与房间名相同，显示"主持人"
    if (participant.is_creator && participant.name === roomName) {
      return '主持人';
    }
    return participant.name;
  })();

  // 是否显示视频（有流且有活跃的视频轨道）
  const showVideo = stream && hasActiveVideo;

  // 确定是否正在说话：本地用户用 isSpeaking prop，远程用户用 participant.isSpeaking
  const speaking = isLocal ? isSpeaking : participant?.isSpeaking;

  return (
    <motion.div
      className={`participant-video ${isLocal ? 'local' : ''} ${speaking ? 'speaking' : ''} ${isScreenSharing ? 'screen-sharing' : ''}`}
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.8 }}
      onClick={onClick}
      style={{ cursor: onClick ? 'pointer' : undefined }}
    >
      {!isLocal && participant?.stream && (
        <audio
          ref={audioRef}
          autoPlay
          style={{ display: 'none' }}
        />
      )}

      {showVideo ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocal}
        />
      ) : (
        <div className="participant-placeholder">
          {participant?.user_info?.avatar_url ? (
            <img
              className="avatar-image"
              src={resolveServerAvatarUrl(participant.user_info.avatar_url) || ''}
              alt={displayName}
            />
          ) : (
            <div className="avatar-placeholder">
              <AvatarPlaceholder name={displayName} fontSize={32} />
            </div>
          )}
        </div>
      )}
      <div className="participant-name">
        {displayName}
        {participant?.is_creator && <span className="creator-badge">主持人</span>}
        {isScreenSharing && <span className="screen-share-badge">屏幕共享</span>}
      </div>
    </motion.div>
  );
}

/** 本地视频预览组件 */
function LocalVideo({
  stream,
  isSpeaking,
  avatarUrl,
  displayName,
  onClick,
}: {
  stream: MediaStream | null;
  isSpeaking: boolean;
  avatarUrl?: string | null;
  /** 当前用户展示名，用于无头像时的占位首字（缺省回退「我」） */
  displayName?: string | null;
  onClick?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hasActiveVideo, setHasActiveVideo] = useState(false);

  // 检查视频轨道状态
  useEffect(() => {
    if (!stream) {
      setHasActiveVideo(false);
      return;
    }

    const checkVideoTrack = () => {
      const videoTracks = stream.getVideoTracks();
      const hasLiveVideo = videoTracks.some(
        (track) => track.readyState === 'live' && track.enabled && !track.muted,
      );
      setHasActiveVideo(hasLiveVideo);
    };

    checkVideoTrack();

    const videoTracks = stream.getVideoTracks();
    const handleTrackChange = () => checkVideoTrack();

    videoTracks.forEach((track) => {
      track.addEventListener('ended', handleTrackChange);
      track.addEventListener('mute', handleTrackChange);
      track.addEventListener('unmute', handleTrackChange);
    });

    stream.addEventListener('addtrack', handleTrackChange);
    stream.addEventListener('removetrack', handleTrackChange);

    // 监听 enabled 属性变化（需要轮询，因为没有原生事件）
    const interval = setInterval(checkVideoTrack, 500);

    return () => {
      videoTracks.forEach((track) => {
        track.removeEventListener('ended', handleTrackChange);
        track.removeEventListener('mute', handleTrackChange);
        track.removeEventListener('unmute', handleTrackChange);
      });
      stream.removeEventListener('addtrack', handleTrackChange);
      stream.removeEventListener('removetrack', handleTrackChange);
      clearInterval(interval);
    };
  }, [stream]);

  useEffect(() => {
    if (videoRef.current) {
      if (stream && hasActiveVideo) {
        videoRef.current.srcObject = stream;
      } else {
        videoRef.current.srcObject = null;
      }
    }
  }, [stream, hasActiveVideo]);

  const showVideo = stream && hasActiveVideo;

  return (
    <motion.div
      className={`participant-video local ${isSpeaking ? 'speaking' : ''}`}
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      onClick={onClick}
      style={{ cursor: onClick ? 'pointer' : undefined }}
    >
      {showVideo ? (
        <video ref={videoRef} autoPlay playsInline muted />
      ) : (
        <div className="participant-placeholder">
          {avatarUrl ? (
            <img className="avatar-image" src={avatarUrl} alt="我" />
          ) : (
            <div className="avatar-placeholder">
              <AvatarPlaceholder name={displayName || '我'} fontSize={32} />
            </div>
          )}
        </div>
      )}
      <div className="participant-name">我</div>
    </motion.div>
  );
}

/** 主会议页面 */
export default function MeetingPage() {
  const [meetingData, setMeetingData] = useState<MeetingWindowData | null>(null);
  const [showParticipants, setShowParticipants] = useState(false);
  const [copied, setCopied] = useState(false);

  // 屏幕共享设置弹窗
  const [showScreenShareSettings, setShowScreenShareSettings] = useState(false);
  const [screenShareResolution, setScreenShareResolution] = useState<ScreenShareResolution>('1080p');
  const [screenShareFrameRate, setScreenShareFrameRate] = useState<ScreenShareFrameRate>(60);

  // 权限修复引导弹窗
  const [showPermissionGuide, setShowPermissionGuide] = useState(false);

  // 全屏聚焦模式：'local' = 本地全屏, participant.id = 远程全屏, null = 网格模式
  const [focusedId, setFocusedId] = useState<string | null>(null);
  // 全屏覆盖层中控制区可见性（鼠标移动时显示，静止 3 秒后自动隐藏）
  const [overlayVisible, setOverlayVisible] = useState(true);
  const hideTimerRef = useRef<number>(0);
  const overlayRef = useRef<HTMLDivElement>(null);

  // 获取可用的分辨率选项（根据显示器分辨率过滤）
  const availableResolutions = getAvailableResolutions();

  const webrtc = useWebRTC();

  // 初始化：读取会议数据
  useEffect(() => {
    const data = loadMeetingData();
    if (!data) {
      // 没有会议数据，关闭窗口
      window.close();
      return;
    }
    setMeetingData(data);
  }, []);

  // 初始化媒体设备并连接
  useEffect(() => {
    if (!meetingData) {
      return;
    }

    const init = async () => {
      // 初始化本地媒体流
      await webrtc.initLocalStream();

      // 获取 ICE 服务器配置
      // 优先使用加入房间时返回的 ICE 服务器配置
      // 如果没有（创建者情况），使用默认的公共 STUN 服务器
      const iceServers: IceServer[] = meetingData.iceServers?.length
        ? meetingData.iceServers
        : [
          { urls: ['stun:stun.l.google.com:19302'] },
          { urls: ['stun:stun1.l.google.com:19302'] },
        ];

      // 断线重连回调：用房间号 + 密码重新加入（join 无需登录），拿新 ws token + ICE。
      // 会议窗口无会话上下文，故用 serverUrl 直接构造无鉴权 API 客户端调公开的 join 端点。
      const rejoin = async () => {
        try {
          const api = createApiClient({
            baseUrl: meetingData.serverUrl,
            accessToken: '',
            refreshToken: '',
          });
          const resp = await joinRoom(
            api,
            meetingData.roomId,
            meetingData.password,
            meetingData.displayName,
            meetingData.userInfo?.avatar_url ?? undefined,
          );
          return { token: resp.ws_token, iceServers: resp.ice_servers };
        } catch {
          return null;
        }
      };

      // 连接信令服务器
      webrtc.connect(
        meetingData.roomId,
        meetingData.token,
        iceServers,
        meetingData.serverUrl,
        rejoin,
      );
    };

    init();

    // 清理函数
    return () => {
      webrtc.disconnect();
      webrtc.stopLocalStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingData]);

  // 监听页面关闭
  useEffect(() => {
    const handleBeforeUnload = () => {
      webrtc.disconnect();
      clearMeetingData();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [webrtc]);

  // 当权限被拒绝时显示引导弹窗
  useEffect(() => {
    if (webrtc.mediaError?.reason === 'denied') {
      setShowPermissionGuide(true);
    }
  }, [webrtc.mediaError]);

  // Esc 退出聚焦模式（显示器全屏时浏览器先退出 fullscreen，再按 Esc 退出窗口全屏）
  useEffect(() => {
    if (!focusedId) {
      return undefined;
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.fullscreenElement) {
        setFocusedId(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusedId]);

  // 聚焦的参与者离开时自动退出聚焦模式
  useEffect(() => {
    if (focusedId && focusedId !== 'local') {
      const stillPresent = webrtc.participants.some((p) => p.id === focusedId);
      if (!stillPresent) {
        setFocusedId(null);
      }
    }
  }, [focusedId, webrtc.participants]);

  // 退出聚焦时同步退出显示器全屏 + 清理定时器
  useEffect(() => {
    if (!focusedId) {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
      clearTimeout(hideTimerRef.current);
      setOverlayVisible(true);
    }
  }, [focusedId]);

  // 点击 tile 进入全屏聚焦
  const handleTileClick = useCallback((id: string) => {
    setFocusedId(id);
    setOverlayVisible(true);
  }, []);

  // 全屏覆盖层鼠标移动：显示控制区，3 秒后自动隐藏
  const handleOverlayMouseMove = useCallback(() => {
    setOverlayVisible(true);
    clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => {
      setOverlayVisible(false);
    }, 3000);
  }, []);

  // 切换显示器全屏（Fullscreen API）
  const toggleDisplayFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      overlayRef.current?.requestFullscreen().catch(() => {});
    }
  }, []);

  // 离开会议
  const handleLeave = useCallback(() => {
    webrtc.disconnect();
    webrtc.stopLocalStream();
    clearMeetingData();
    window.close();
  }, [webrtc]);

  // 分享会议到聊天（通过 Tauri 事件通知主窗口）
  const handleShareToChat = useCallback(async () => {
    if (!meetingData) { return; }
    try {
      const { emit } = await import('@tauri-apps/api/event');
      await emit('share-meeting-to-chat', {
        roomId: meetingData.roomId,
        password: meetingData.password,
        roomName: meetingData.roomName,
        creatorName: meetingData.displayName,
        creatorAvatar: meetingData.userInfo?.avatar_url || '',
      });
    } catch (err) {
      console.error('Failed to emit share event:', err);
    }
  }, [meetingData]);

  // 复制房间信息
  const handleCopyInfo = useCallback(() => {
    if (!meetingData) {
      return;
    }

    const text = `会议名称: ${meetingData.roomName}\n房间号: ${meetingData.roomId}\n密码: ${meetingData.password}`;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [meetingData]);

  // 处理屏幕共享按钮点击
  const handleScreenShareClick = useCallback(() => {
    if (webrtc.mediaState.screenSharing) {
      // 已在共享，直接停止
      webrtc.toggleScreenShare();
    } else {
      // 未共享，显示设置弹窗
      setShowScreenShareSettings(true);
    }
  }, [webrtc]);

  // 开始屏幕共享（使用选择的设置）
  const handleStartScreenShare = useCallback(() => {
    const settings: ScreenShareSettings = {
      resolution: screenShareResolution,
      frameRate: screenShareFrameRate,
    };
    webrtc.toggleScreenShare(settings);
    setShowScreenShareSettings(false);
  }, [webrtc, screenShareResolution, screenShareFrameRate]);

  if (!meetingData) {
    return (
      <div className="meeting-loading">
        <div className="meeting-loading-spinner" />
        <p>加载中...</p>
      </div>
    );
  }

  return (
    <div className="meeting-page">
      {/* 顶部栏 */}
      <header className="meeting-header">
        <div className="meeting-info">
          <h1>{meetingData.roomName}</h1>
          <span className="meeting-id">房间号: {meetingData.roomId}</span>
        </div>
        <div className="meeting-header-actions">
          <button
            className="meeting-header-btn"
            onClick={handleShareToChat}
            title="分享到聊天"
          >
            <ShareIcon />
          </button>
          <button
            className="meeting-header-btn"
            onClick={handleCopyInfo}
            title="复制会议信息"
          >
            <CopyIcon />
            {copied && <span className="copy-toast">已复制</span>}
          </button>
          <button
            className={`meeting-header-btn ${showParticipants ? 'active' : ''}`}
            onClick={() => setShowParticipants(!showParticipants)}
            title="参与者列表"
          >
            <ParticipantsIcon />
            <span className="participant-count">{webrtc.participants.length + 1}</span>
          </button>
        </div>
      </header>

      {/* 视频区域 */}
      <main className="meeting-main">
        <div className={`video-grid ${showParticipants ? 'with-sidebar' : ''}`}>
          {/* 网格模式：所有 tile 作为 grid 直接子元素 */}
          <LocalVideo
            stream={webrtc.localStream}
            isSpeaking={webrtc.isSpeaking}
            avatarUrl={resolveServerAvatarUrl(meetingData?.userInfo?.avatar_url)}
            displayName={meetingData?.displayName}
            onClick={() => handleTileClick('local')}
          />
          <AnimatePresence>
            {webrtc.participants.map((participant) => (
              <ParticipantVideo
                key={participant.id}
                participant={participant}
                roomName={meetingData.roomName}
                isSpeaking={participant.isSpeaking}
                onClick={() => handleTileClick(participant.id)}
              />
            ))}
          </AnimatePresence>
        </div>

        {/* 参与者侧边栏 */}
        <AnimatePresence>
          {showParticipants && (
            <motion.aside
              className="participants-sidebar"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
            >
              <h3>参与者 ({webrtc.participants.length + 1})</h3>
              <ul className="participants-list">
                <li className="participant-item">
                  {/* 本地用户头像 */}
                  {meetingData.userInfo?.avatar_url ? (
                    <img
                      className="participant-avatar-img"
                      src={resolveServerAvatarUrl(meetingData.userInfo.avatar_url) || ''}
                      alt={meetingData.displayName}
                    />
                  ) : (
                    <div className="participant-avatar">
                      <AvatarPlaceholder name={meetingData.displayName} fontSize={14} />
                    </div>
                  )}
                  <span className="participant-name">{meetingData.displayName}</span>
                  <span className="participant-badge self">我</span>
                  {meetingData.role === 'creator' && (
                    <span className="participant-badge host">主持人</span>
                  )}
                </li>
                {webrtc.participants.map((p) => {
                  // 修复：如果创建者的名称与房间名称相同，说明后端返回的是房间名而非用户名
                  // 这种情况下使用 "主持人" 作为默认显示名称
                  const displayName = (p.is_creator && p.name === meetingData.roomName)
                    ? '主持人'
                    : p.name;
                  return (
                    <li key={p.id} className="participant-item">
                      {/* 远程参与者头像 */}
                      {p.user_info?.avatar_url ? (
                        <img
                          className="participant-avatar-img"
                          src={resolveServerAvatarUrl(p.user_info.avatar_url) || ''}
                          alt={displayName}
                        />
                      ) : (
                        <div className="participant-avatar">
                          <AvatarPlaceholder name={displayName} fontSize={14} />
                        </div>
                      )}
                      <span className="participant-name">{displayName}</span>
                      {p.is_creator && <span className="participant-badge host">主持人</span>}
                    </li>
                  );
                })}
              </ul>
            </motion.aside>
          )}
        </AnimatePresence>

        {/* 连接状态提示 - 放在 main 内部以相对于视频区域居中 */}
        {webrtc.meetingState === 'connecting' && (
          <div className="meeting-status connecting">
            <div className="meeting-loading-spinner" />
            <span>正在连接...</span>
          </div>
        )}

        {webrtc.error && (
          <div className="meeting-status error">
            <span>{webrtc.error}</span>
          </div>
        )}

        {/* 媒体权限错误提示 */}
        <AnimatePresence>
          {webrtc.mediaError && (
            <motion.div
              className="meeting-status media-error"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
            >
              <span>{webrtc.mediaError.message}</span>
              {webrtc.mediaError.reason === 'denied' && (
                <span className="media-error-hint">请在系统设置中允许应用访问</span>
              )}
              <button
                className="media-error-close"
                onClick={webrtc.clearMediaError}
                title="关闭"
              >
                ×
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* 控制栏 */}
      <footer className="meeting-controls">
        <div className="controls-center">
          {/* 麦克风 */}
          <motion.button
            className={`control-btn ${!webrtc.mediaState.micEnabled ? 'off' : ''}`}
            onClick={webrtc.toggleMic}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
            title={webrtc.mediaState.micEnabled ? '关闭麦克风' : '开启麦克风'}
          >
            {webrtc.mediaState.micEnabled ? <MicOnIcon /> : <MicOffIcon />}
          </motion.button>

          {/* 摄像头 */}
          <motion.button
            className={`control-btn ${!webrtc.mediaState.cameraEnabled ? 'off' : ''}`}
            onClick={webrtc.toggleCamera}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
            title={webrtc.mediaState.cameraEnabled ? '关闭摄像头' : '开启摄像头'}
          >
            {webrtc.mediaState.cameraEnabled ? <VideoOnIcon /> : <VideoOffIcon />}
          </motion.button>

          {/* 屏幕共享 */}
          <motion.button
            className={`control-btn ${webrtc.mediaState.screenSharing ? 'sharing' : ''}`}
            onClick={handleScreenShareClick}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
            title={webrtc.mediaState.screenSharing ? '停止共享' : '共享屏幕'}
          >
            {webrtc.mediaState.screenSharing ? <ScreenShareOffIcon /> : <ScreenShareIcon />}
          </motion.button>

          {/* 离开会议 */}
          <motion.button
            className="control-btn end-call"
            onClick={handleLeave}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
            title="离开会议"
          >
            <PhoneEndIcon />
          </motion.button>
        </div>
      </footer>

      {/* 全屏聚焦覆盖层：点击 tile 后弹出，覆盖整个窗口 */}
      <AnimatePresence>
        {focusedId && (
          <motion.div
            ref={overlayRef}
            className="spotlight-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onMouseMove={handleOverlayMouseMove}
          >
            {/* 主画面 */}
            <div className="spotlight-main">
              <AnimatePresence mode="wait">
                {focusedId === 'local' ? (
                  <LocalVideo
                    key="spotlight-local"
                    stream={webrtc.localStream}
                    isSpeaking={webrtc.isSpeaking}
                    avatarUrl={resolveServerAvatarUrl(meetingData?.userInfo?.avatar_url)}
                    displayName={meetingData?.displayName}
                  />
                ) : (
                  (() => {
                    const focused = webrtc.participants.find((p) => p.id === focusedId);
                    if (!focused) { return null; }
                    return (
                      <ParticipantVideo
                        key={`spotlight-${focused.id}`}
                        participant={focused}
                        roomName={meetingData.roomName}
                        isSpeaking={focused.isSpeaking}
                      />
                    );
                  })()
                )}
              </AnimatePresence>
            </div>

            {/* 底部控制区：缩略图 + 操作按钮（鼠标静止 3s 自动隐藏） */}
            <div className={`spotlight-controls ${overlayVisible ? '' : 'hidden'}`}>
              <div className="spotlight-thumbnails">
                {focusedId !== 'local' && (
                  <LocalVideo
                    stream={webrtc.localStream}
                    isSpeaking={webrtc.isSpeaking}
                    avatarUrl={resolveServerAvatarUrl(meetingData?.userInfo?.avatar_url)}
                    displayName={meetingData?.displayName}
                    onClick={() => setFocusedId('local')}
                  />
                )}
                {webrtc.participants
                  .filter((p) => p.id !== focusedId)
                  .map((p) => (
                    <ParticipantVideo
                      key={p.id}
                      participant={p}
                      roomName={meetingData.roomName}
                      isSpeaking={p.isSpeaking}
                      onClick={() => setFocusedId(p.id)}
                    />
                  ))}
              </div>
              <div className="spotlight-actions">
                <button
                  className="spotlight-btn"
                  onClick={toggleDisplayFullscreen}
                  title="显示器全屏"
                >
                  ⛶
                </button>
                <button
                  className="spotlight-btn"
                  onClick={() => setFocusedId(null)}
                  title="退出聚焦"
                >
                  ✕
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 权限修复引导弹窗 */}
      <AnimatePresence>
        {showPermissionGuide && webrtc.mediaError && (
          <MediaPermissionGuide
            errorType={webrtc.mediaError.type}
            errorReason={webrtc.mediaError.reason}
            onClose={() => {
              setShowPermissionGuide(false);
              webrtc.clearMediaError();
            }}
            onRetry={() => {
              setShowPermissionGuide(false);
              webrtc.clearMediaError();
              // 重新尝试获取权限
              if (webrtc.mediaError?.type === 'mic') {
                webrtc.toggleMic();
              } else if (webrtc.mediaError?.type === 'camera') {
                webrtc.toggleCamera();
              } else {
                webrtc.toggleScreenShare();
              }
            }}
          />
        )}
      </AnimatePresence>

      {/* 屏幕共享设置弹窗 */}
      <AnimatePresence>
        {showScreenShareSettings && (
          <motion.div
            className="screen-share-settings-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowScreenShareSettings(false)}
          >
            <motion.div
              className="screen-share-settings-modal"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3>屏幕共享设置</h3>

              <div className="setting-group">
                <label>分辨率</label>
                <div className="setting-options">
                  {(['1080p', '2k', '4k'] as ScreenShareResolution[]).map((res) => {
                    const isAvailable = availableResolutions.includes(res);
                    const { width, height } = RESOLUTION_MAP[res];
                    const labelMap = { '1080p': '1080p', '2k': '2K', '4k': '4K' };
                    const label = labelMap[res];
                    return (
                      <button
                        key={res}
                        className={`setting-option ${screenShareResolution === res ? 'active' : ''} ${!isAvailable ? 'disabled' : ''}`}
                        onClick={() => isAvailable && setScreenShareResolution(res)}
                        disabled={!isAvailable}
                        title={!isAvailable ? '超出显示器分辨率' : `${width}×${height}`}
                      >
                        {label} ({width}×{height})
                        {!isAvailable && <span className="option-hint">不可用</span>}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="setting-group">
                <label>帧率</label>
                <div className="setting-options">
                  {([60, 120] as ScreenShareFrameRate[]).map((fps) => (
                    <button
                      key={fps}
                      className={`setting-option ${screenShareFrameRate === fps ? 'active' : ''}`}
                      onClick={() => setScreenShareFrameRate(fps)}
                    >
                      {fps} FPS
                    </button>
                  ))}
                </div>
              </div>

              <div className="setting-actions">
                <button
                  className="setting-cancel"
                  onClick={() => setShowScreenShareSettings(false)}
                >
                  取消
                </button>
                <button
                  className="setting-confirm"
                  onClick={handleStartScreenShare}
                >
                  开始共享
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
