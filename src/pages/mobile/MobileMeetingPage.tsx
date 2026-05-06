/**
 * 移动端视频会议页面
 *
 * 与桌面端 MeetingPage 功能相似，但针对移动端优化：
 * - 简化的控制按钮布局
 * - 移除屏幕共享功能（Android WebView 不支持）
 * - 全屏视频显示
 * - 适配触摸操作
 * - 支持最小化为悬浮图标（可同时使用其他功能）
 * - 全屏聚焦模式：双击 tile 弹出全屏覆盖层（CSS transform 强制横屏），
 *   右侧垂直缩略图条切换聚焦对象，单击 toggle 简化控制栏，
 *   双击或 Android 返回键退出聚焦
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
  ShareIcon,
} from '../../components/common/Icons';
import { ShareMeetingModal } from '../../meeting/components/ShareMeetingModal';
import { resolveServerAvatarUrl } from '../../utils/avatar';
import { useMobileBackHandler } from '../../hooks/useMobileBackHandler';

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
  onClick?: () => void;
}

function ParticipantVideo({
  participant,
  isLocal,
  stream: propStream,
  isSpeaking,
  avatarUrl,
  onClick,
}: ParticipantVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  // 视频流：本地使用 propStream，远程使用 participant.cameraStream 或 stream
  const stream = propStream || participant?.cameraStream || participant?.stream;
  const [hasActiveVideo, setHasActiveVideo] = useState(false);

  // 检查视频轨道状态（事件监听 + 轮询兜底，与桌面端一致）
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
  const displayAvatar = isLocal ? avatarUrl : resolveServerAvatarUrl(participant?.user_info?.avatar_url);

  return (
    <div
      className={`mobile-participant-video ${isLocal ? 'local' : ''} ${speaking ? 'speaking' : ''}`}
      onClick={onClick}
    >
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
// 常量
// ============================================

/** 双击判定间隔（ms） */
const DOUBLE_TAP_DELAY = 300;

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
  const [showShareModal, setShowShareModal] = useState(false);

  // 全屏聚焦模式状态
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [controlsVisible, setControlsVisible] = useState(false);

  // 双击检测 refs
  const lastGridTapRef = useRef(0);
  const lastGridTapIdRef = useRef<string | null>(null);
  const lastOverlayTapRef = useRef(0);
  const overlaySingleTapTimerRef = useRef<number>(0);
  const throttleRef = useRef(false);

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

  // --- 全屏聚焦模式逻辑 ---

  const enterFocus = useCallback((id: string) => {
    if (throttleRef.current) { return; }
    throttleRef.current = true;
    setFocusedId(id);
    setControlsVisible(false);
    setTimeout(() => { throttleRef.current = false; }, DOUBLE_TAP_DELAY);
  }, []);

  const exitFocus = useCallback(() => {
    if (throttleRef.current) { return; }
    throttleRef.current = true;
    setFocusedId(null);
    setControlsVisible(false);
    setTimeout(() => { throttleRef.current = false; }, DOUBLE_TAP_DELAY);
  }, []);

  // 网格双击检测：同一 tile 上 300ms 内两次点击 → 进入聚焦
  const handleGridTap = useCallback((id: string) => {
    const now = Date.now();
    if (now - lastGridTapRef.current < DOUBLE_TAP_DELAY && lastGridTapIdRef.current === id) {
      enterFocus(id);
      lastGridTapRef.current = 0;
    } else {
      lastGridTapRef.current = now;
      lastGridTapIdRef.current = id;
    }
  }, [enterFocus]);

  // 覆盖层点击检测：单击 toggle 控制栏（300ms 延迟确认），双击退出聚焦
  const handleOverlayTap = useCallback(() => {
    const now = Date.now();
    const elapsed = now - lastOverlayTapRef.current;
    lastOverlayTapRef.current = now;

    if (elapsed < DOUBLE_TAP_DELAY) {
      clearTimeout(overlaySingleTapTimerRef.current);
      exitFocus();
    } else {
      overlaySingleTapTimerRef.current = window.setTimeout(() => {
        setControlsVisible((prev) => !prev);
      }, DOUBLE_TAP_DELAY);
    }
  }, [exitFocus]);

  // 聚焦的参与者离开时自动退出
  useEffect(() => {
    if (focusedId && focusedId !== 'local') {
      const stillPresent = webrtc.participants.some((p) => p.id === focusedId);
      if (!stillPresent) {
        exitFocus();
      }
    }
  }, [focusedId, webrtc.participants, exitFocus]);

  // 组件卸载时清理定时器
  useEffect(() => {
    return () => {
      clearTimeout(overlaySingleTapTimerRef.current);
    };
  }, []);

  // Android 返回键：聚焦中优先退出聚焦
  useMobileBackHandler(() => {
    if (focusedId) {
      exitFocus();
      return true;
    }
    return false;
  });

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
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            className="mobile-meeting-header-btn"
            onClick={() => setShowShareModal(true)}
            title="分享会议"
          >
            <ShareIcon />
          </button>
          <button
            className={`mobile-meeting-header-btn ${showParticipants ? 'active' : ''}`}
            onClick={() => setShowParticipants(!showParticipants)}
          >
            <ParticipantsIcon />
            <span className="mobile-participant-count">{webrtc.participants.length + 1}</span>
          </button>
        </div>
      </header>

      {/* 视频区域 */}
      <main className="mobile-meeting-main">
        <div className="mobile-video-grid">
          {/* 本地视频（双击进入聚焦） */}
          <ParticipantVideo
            isLocal
            stream={webrtc.localStream}
            isSpeaking={webrtc.isSpeaking}
            avatarUrl={resolveServerAvatarUrl(meetingData?.userInfo?.avatar_url)}
            onClick={() => handleGridTap('local')}
          />

          {/* 远程参与者（双击进入聚焦） */}
          <AnimatePresence>
            {webrtc.participants.map((participant) => (
              <ParticipantVideo
                key={participant.id}
                participant={participant}
                isSpeaking={participant.isSpeaking}
                onClick={() => handleGridTap(participant.id)}
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
                      src={resolveServerAvatarUrl(meetingData.userInfo.avatar_url) || ''}
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
                        src={resolveServerAvatarUrl(p.user_info.avatar_url) || ''}
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

      {/* 全屏聚焦覆盖层（双击 tile 后弹出，横屏全窗口） */}
      <AnimatePresence>
        {focusedId && (
          <motion.div
            className="mobile-spotlight-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            {/* 主画面区域（单击 toggle 控制栏，双击退出） */}
            <div className="mobile-spotlight-main" onClick={handleOverlayTap}>
              {focusedId === 'local' ? (
                <ParticipantVideo
                  isLocal
                  stream={webrtc.localStream}
                  isSpeaking={webrtc.isSpeaking}
                  avatarUrl={resolveServerAvatarUrl(meetingData?.userInfo?.avatar_url)}
                />
              ) : (
                (() => {
                  const focused = webrtc.participants.find((p) => p.id === focusedId);
                  if (!focused) { return null; }
                  return (
                    <ParticipantVideo
                      participant={focused}
                      isSpeaking={focused.isSpeaking}
                    />
                  );
                })()
              )}

              {/* 简化控制栏（仅图标，胶囊样式） */}
              <AnimatePresence>
                {controlsVisible && (
                  <motion.div
                    className="mobile-spotlight-controls"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 20 }}
                    transition={{ duration: 0.2 }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      className={`mobile-spotlight-btn ${!webrtc.mediaState.micEnabled ? 'off' : ''}`}
                      onClick={() => webrtc.toggleMic()}
                    >
                      {webrtc.mediaState.micEnabled ? <MicOnIcon /> : <MicOffIcon />}
                    </button>
                    <button
                      className={`mobile-spotlight-btn ${!webrtc.mediaState.cameraEnabled ? 'off' : ''}`}
                      onClick={() => webrtc.toggleCamera()}
                    >
                      {webrtc.mediaState.cameraEnabled ? <VideoOnIcon /> : <VideoOffIcon />}
                    </button>
                    <button
                      className="mobile-spotlight-btn end-call"
                      onClick={onClose}
                    >
                      <PhoneEndIcon />
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* 右侧垂直缩略图条（点击切换聚焦对象） */}
            <div className="mobile-spotlight-sidebar">
              {focusedId !== 'local' && (
                <ParticipantVideo
                  isLocal
                  stream={webrtc.localStream}
                  isSpeaking={webrtc.isSpeaking}
                  avatarUrl={resolveServerAvatarUrl(meetingData?.userInfo?.avatar_url)}
                  onClick={() => setFocusedId('local')}
                />
              )}
              {webrtc.participants
                .filter((p) => p.id !== focusedId)
                .map((p) => (
                  <ParticipantVideo
                    key={p.id}
                    participant={p}
                    isSpeaking={p.isSpeaking}
                    onClick={() => setFocusedId(p.id)}
                  />
                ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 分享会议邀请弹窗 */}
      {showShareModal && meetingData && (
        <ShareMeetingModal
          isOpen={showShareModal}
          onClose={() => setShowShareModal(false)}
          meetingData={{
            roomId: meetingData.roomId,
            password: meetingData.password,
            roomName: meetingData.roomName,
            creatorName: meetingData.displayName,
            creatorAvatar: meetingData.userInfo?.avatar_url || '',
          }}
        />
      )}
    </motion.div>
  );
}
