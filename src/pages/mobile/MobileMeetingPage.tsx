/**
 * 移动端视频会议页面
 *
 * 与桌面端 MeetingPage 功能相似，但针对移动端优化：
 * - 简化的控制按钮布局
 * - 移除屏幕共享功能（Android WebView 不支持）
 * - 全屏视频显示
 * - 适配触摸操作
 *
 * 注意：
 * - Android 需要 CAMERA 和 RECORD_AUDIO 权限
 * - 需要在 AndroidManifest.xml 中声明权限
 *
 * @module pages/mobile/MobileMeetingPage
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  useWebRTC,
  type RemoteParticipant,
} from '../../meeting/useWebRTC';
import { loadMeetingData, clearMeetingData, type MeetingWindowData, type IceServer } from '../../meeting/api';
import {
  MicOnIcon,
  MicOffIcon,
  VideoOnIcon,
  VideoOffIcon,
  PhoneEndIcon,
  ParticipantsIcon,
} from '../../components/common/Icons';
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

interface MobileMeetingPageProps {
  onClose: () => void;
}

export function MobileMeetingPage({ onClose }: MobileMeetingPageProps) {
  const [meetingData, setMeetingData] = useState<MeetingWindowData | null>(null);
  const [showParticipants, setShowParticipants] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);

  const webrtc = useWebRTC();

  // 初始化：读取会议数据
  useEffect(() => {
    const data = loadMeetingData();
    if (!data) {
      onClose();
      return;
    }
    setMeetingData(data);
  }, [onClose]);

  // 初始化媒体设备并连接
  useEffect(() => {
    if (!meetingData) { return; }

    const init = async () => {
      try {
        // 初始化本地媒体流
        await webrtc.initLocalStream();

        // 获取 ICE 服务器配置
        const iceServers: IceServer[] = meetingData.iceServers?.length
          ? meetingData.iceServers
          : [
            { urls: ['stun:stun.l.google.com:19302'] },
            { urls: ['stun1.l.google.com:19302'] },
          ];

        // 连接信令服务器
        webrtc.connect(
          meetingData.roomId,
          meetingData.token,
          iceServers,
          meetingData.serverUrl,
        );
      } catch (err) {
        console.error('[MobileMeeting] 初始化失败:', err);
        setPermissionError('无法访问摄像头或麦克风，请检查权限设置');
      }
    };

    init();

    return () => {
      webrtc.disconnect();
      webrtc.stopLocalStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingData]);

  // 离开会议
  const handleLeave = useCallback(() => {
    webrtc.disconnect();
    webrtc.stopLocalStream();
    clearMeetingData();
    onClose();
  }, [webrtc, onClose]);

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
          <h1>{meetingData.roomName}</h1>
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
        {(webrtc.error || permissionError) && (
          <div className="mobile-meeting-error">
            <span>{webrtc.error || permissionError}</span>
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
          onClick={webrtc.toggleMic}
        >
          {webrtc.mediaState.micEnabled ? <MicOnIcon /> : <MicOffIcon />}
          <span>麦克风</span>
        </button>

        {/* 摄像头 */}
        <button
          className={`mobile-control-btn ${!webrtc.mediaState.cameraEnabled ? 'off' : ''}`}
          onClick={webrtc.toggleCamera}
        >
          {webrtc.mediaState.cameraEnabled ? <VideoOnIcon /> : <VideoOffIcon />}
          <span>摄像头</span>
        </button>

        {/* 离开会议 */}
        <button className="mobile-control-btn end-call" onClick={handleLeave}>
          <PhoneEndIcon />
          <span>离开</span>
        </button>
      </footer>
    </motion.div>
  );
}
