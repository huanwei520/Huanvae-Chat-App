/**
 * 移动端视频会议页面
 *
 * 与桌面端 MeetingPage 功能相似，但针对移动端优化：
 * - 简化的控制按钮布局
 * - 移除屏幕共享功能（Android WebView 不支持）
 * - 全屏视频显示
 * - 适配触摸操作
 * - 支持最小化为悬浮图标（可同时使用其他功能）
 *
 * 架构说明：
 * - WebRTC 实例在 MobileMain.tsx 中创建，通过 props 传入
 * - 最小化时组件卸载，但 WebRTC 连接保持（由 MobileMain 维护）
 * - 展开时重新挂载组件，复用同一个 WebRTC 实例
 *
 * 注意：
 * - Android 需要 CAMERA 和 RECORD_AUDIO 权限
 * - 需要在 AndroidManifest.xml 中声明权限
 *
 * @module pages/mobile/MobileMeetingPage
 */

import { useRef, useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { RemoteParticipant } from '../../meeting/useWebRTC';
import { loadMeetingData, type MeetingWindowData } from '../../meeting/api';
import {
  MicOnIcon,
  MicOffIcon,
  VideoOnIcon,
  VideoOffIcon,
  PhoneEndIcon,
  ParticipantsIcon,
} from '../../components/common/Icons';

// 最小化图标（内联定义）
const MinimizeIcon = () => (
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
      d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25"
    />
  </svg>
);
import '../../styles/mobile/meeting-page.css';

// ============================================
// 参与者视频组件
// ============================================

interface ParticipantVideoProps {
  participant?: RemoteParticipant;
  isLocal?: boolean;
  stream?: MediaStream | null;
  isSpeaking?: boolean;
  avatarUrl?: string | null;
}

function ParticipantVideo({
  participant,
  isLocal,
  stream: propStream,
  isSpeaking,
  avatarUrl,
}: ParticipantVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const lastStreamIdRef = useRef<string | null>(null);

  // 视频流：本地使用 propStream，远程使用 participant.cameraStream 或 stream
  const stream = propStream || participant?.cameraStream || participant?.stream;
  const [hasActiveVideo, setHasActiveVideo] = useState(false);

  // 检查视频轨道状态
  useEffect(() => {
    if (!stream) {
      setHasActiveVideo(false);
      return;
    }

    const checkVideoTrack = () => {
      const videoTracks = stream.getVideoTracks();
      return videoTracks.some((track) => track.readyState === 'live' && !track.muted);
    };

    setHasActiveVideo(checkVideoTrack());

    const interval = setInterval(() => {
      setHasActiveVideo(checkVideoTrack());
    }, 500);

    return () => clearInterval(interval);
  }, [stream]);

  // 设置视频源
  useEffect(() => {
    if (!videoRef.current) { return; }

    const currentStreamId = stream?.id ?? null;

    if (currentStreamId !== lastStreamIdRef.current || !hasActiveVideo) {
      lastStreamIdRef.current = currentStreamId;

      if (stream && hasActiveVideo) {
        videoRef.current.srcObject = stream;
      } else {
        videoRef.current.srcObject = null;
      }
    }
  }, [stream, hasActiveVideo]);

  // 处理远程音频
  const audioStream = participant?.stream;
  useEffect(() => {
    if (isLocal) { return; }

    const audioElement = audioRef.current;
    if (audioElement && audioStream) {
      const audioTracks = audioStream.getAudioTracks();
      if (audioTracks.length > 0) {
        audioElement.srcObject = audioStream;
        audioElement.play().catch(() => {});
      }
    }

    return () => {
      if (audioElement) {
        audioElement.srcObject = null;
      }
    };
  }, [audioStream, isLocal]);

  const displayName = isLocal ? '我' : (participant?.name || '未知');
  const showVideo = stream && hasActiveVideo;
  const speaking = isLocal ? isSpeaking : participant?.isSpeaking;
  const displayAvatar = isLocal ? avatarUrl : participant?.user_info?.avatar_url;

  return (
    <div className={`mobile-participant-video ${isLocal ? 'local' : ''} ${speaking ? 'speaking' : ''}`}>
      {/* 远程音频 */}
      {!isLocal && participant?.stream && (
        <audio ref={audioRef} autoPlay style={{ display: 'none' }} />
      )}

      {showVideo ? (
        <video ref={videoRef} autoPlay playsInline muted={isLocal} />
      ) : (
        <div className="mobile-participant-placeholder">
          {displayAvatar ? (
            <img className="mobile-avatar-image" src={displayAvatar} alt={displayName} />
          ) : (
            <div className="mobile-avatar-placeholder">{displayName.charAt(0)}</div>
          )}
        </div>
      )}
      <div className="mobile-participant-name">
        {displayName}
        {participant?.is_creator && <span className="mobile-creator-badge">主持人</span>}
      </div>
    </div>
  );
}

// ============================================
// 主组件
// ============================================

/** WebRTC 实例类型（从 useWebRTC 推导） */
type WebRTCInstance = ReturnType<typeof import('../../meeting/useWebRTC').useWebRTC>;

interface MobileMeetingPageProps {
  /** WebRTC 实例（从 MobileMain 传入，最小化时保持连接） */
  webrtc: WebRTCInstance;
  /** 会议房间名 */
  roomName?: string;
  /** 关闭/离开会议回调 */
  onClose: () => void;
  /** 最小化回调 */
  onMinimize?: () => void;
}

export function MobileMeetingPage({ webrtc, roomName, onClose, onMinimize }: MobileMeetingPageProps) {
  const [meetingData, setMeetingData] = useState<MeetingWindowData | null>(null);
  const [showParticipants, setShowParticipants] = useState(false);

  // 读取会议数据（仅用于显示）
  useEffect(() => {
    const data = loadMeetingData();
    if (data) {
      setMeetingData(data);
    }
  }, []);

  // 使用传入的 roomName 作为备选显示
  const displayRoomName = meetingData?.roomName || roomName || '会议';

  // 最小化会议（保持连接，显示悬浮图标）
  const handleMinimize = useCallback(() => {
    if (onMinimize) {
      onMinimize();
    }
  }, [onMinimize]);

  // 加载中
  if (!meetingData) {
    return (
      <div className="mobile-meeting-loading">
        <div className="mobile-meeting-spinner" />
        <p>加载中...</p>
      </div>
    );
  }

  return (
    <motion.div
      className="mobile-meeting-page"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {/* 顶部栏 */}
      <header className="mobile-meeting-header">
        <div className="mobile-meeting-info">
          <h1>{displayRoomName}</h1>
          <span className="mobile-meeting-id">房间: {meetingData.roomId}</span>
        </div>
        <button
          className={`mobile-meeting-header-btn ${showParticipants ? 'active' : ''}`}
          onClick={() => setShowParticipants(!showParticipants)}
        >
          <ParticipantsIcon />
          <span className="mobile-participant-count">{webrtc.participants.length + 1}</span>
        </button>
      </header>

      {/* 视频区域 */}
      <main className="mobile-meeting-main">
        <div className="mobile-video-grid">
          {/* 本地视频 */}
          <ParticipantVideo
            isLocal
            stream={webrtc.localStream}
            isSpeaking={webrtc.isSpeaking}
            avatarUrl={meetingData?.userInfo?.avatar_url}
          />

          {/* 远程参与者 */}
          <AnimatePresence>
            {webrtc.participants.map((participant) => (
              <ParticipantVideo
                key={participant.id}
                participant={participant}
                isSpeaking={participant.isSpeaking}
              />
            ))}
          </AnimatePresence>
        </div>

        {/* 参与者列表 */}
        <AnimatePresence>
          {showParticipants && (
            <motion.div
              className="mobile-participants-panel"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
            >
              <h3>参与者 ({webrtc.participants.length + 1})</h3>
              <ul className="mobile-participants-list">
                <li className="mobile-participant-item">
                  {meetingData.userInfo?.avatar_url ? (
                    <img
                      className="mobile-participant-avatar"
                      src={meetingData.userInfo.avatar_url}
                      alt={meetingData.displayName}
                    />
                  ) : (
                    <div className="mobile-participant-avatar-placeholder">
                      {meetingData.displayName.charAt(0)}
                    </div>
                  )}
                  <span>{meetingData.displayName}</span>
                  <span className="mobile-badge">我</span>
                </li>
                {webrtc.participants.map((p) => (
                  <li key={p.id} className="mobile-participant-item">
                    {p.user_info?.avatar_url ? (
                      <img
                        className="mobile-participant-avatar"
                        src={p.user_info.avatar_url}
                        alt={p.name}
                      />
                    ) : (
                      <div className="mobile-participant-avatar-placeholder">
                        {p.name.charAt(0)}
                      </div>
                    )}
                    <span>{p.name}</span>
                    {p.is_creator && <span className="mobile-badge host">主持人</span>}
                  </li>
                ))}
              </ul>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 连接状态 */}
        {webrtc.meetingState === 'connecting' && (
          <div className="mobile-meeting-status">
            <div className="mobile-meeting-spinner" />
            <span>正在连接...</span>
          </div>
        )}

        {/* 错误提示 */}
        {webrtc.error && (
          <div className="mobile-meeting-error">
            <span>{webrtc.error}</span>
          </div>
        )}

        {/* 媒体权限错误 */}
        {webrtc.mediaError && (
          <div className="mobile-meeting-error">
            <span>{webrtc.mediaError.message}</span>
            {webrtc.mediaError.reason === 'denied' && (
              <span className="mobile-error-hint">请在系统设置中允许应用访问摄像头和麦克风</span>
            )}
          </div>
        )}
      </main>

      {/* 控制栏 */}
      <footer className="mobile-meeting-controls">
        {/* 麦克风 */}
        <button
          className={`mobile-control-btn ${!webrtc.mediaState.micEnabled ? 'off' : ''}`}
          onClick={() => {
            console.warn('[MobileMeeting] 点击麦克风按钮');
            webrtc.toggleMic();
          }}
        >
          {webrtc.mediaState.micEnabled ? <MicOnIcon /> : <MicOffIcon />}
          <span>麦克风</span>
        </button>

        {/* 摄像头 */}
        <button
          className={`mobile-control-btn ${!webrtc.mediaState.cameraEnabled ? 'off' : ''}`}
          onClick={() => {
            console.warn('[MobileMeeting] 点击摄像头按钮');
            webrtc.toggleCamera();
          }}
        >
          {webrtc.mediaState.cameraEnabled ? <VideoOnIcon /> : <VideoOffIcon />}
          <span>摄像头</span>
        </button>

        {/* 最小化（悬浮窗模式） */}
        {onMinimize && (
          <button className="mobile-control-btn" onClick={handleMinimize}>
            <MinimizeIcon />
            <span>最小化</span>
          </button>
        )}

        {/* 离开会议 */}
        <button className="mobile-control-btn end-call" onClick={onClose}>
          <PhoneEndIcon />
          <span>离开</span>
        </button>
      </footer>
    </motion.div>
  );
}
