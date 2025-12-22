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
 *
 * @see backend-docs/webrtc/WebRTC房间.md
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useWebRTC, type RemoteParticipant } from '../hooks/useWebRTC';
import { loadMeetingData, clearMeetingData, type MeetingWindowData, type IceServer } from '../api/webrtc';
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
} from '../components/common/Icons';
import '../styles/pages/meeting.css';

/** 参与者视频组件 */
function ParticipantVideo({
  participant,
  isLocal,
  roomName,
  isSpeaking,
}: {
  participant?: RemoteParticipant;
  isLocal?: boolean;
  stream?: MediaStream | null;
  roomName?: string;
  /** 是否正在说话（本地用户使用此属性） */
  isSpeaking?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const stream = participant?.stream;
  const [hasActiveVideo, setHasActiveVideo] = useState(false);

  // 检查是否有活跃的视频轨道
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

    // 初始检查
    checkVideoTrack();

    // 监听所有视频轨道的状态变化
    const videoTracks = stream.getVideoTracks();
    const handleTrackChange = () => checkVideoTrack();

    videoTracks.forEach((track) => {
      track.addEventListener('ended', handleTrackChange);
      track.addEventListener('mute', handleTrackChange);
      track.addEventListener('unmute', handleTrackChange);
    });

    // 监听流的轨道变化
    stream.addEventListener('addtrack', handleTrackChange);
    stream.addEventListener('removetrack', handleTrackChange);

    return () => {
      videoTracks.forEach((track) => {
        track.removeEventListener('ended', handleTrackChange);
        track.removeEventListener('mute', handleTrackChange);
        track.removeEventListener('unmute', handleTrackChange);
      });
      stream.removeEventListener('addtrack', handleTrackChange);
      stream.removeEventListener('removetrack', handleTrackChange);
    };
  }, [stream]);

  // 设置视频源
  useEffect(() => {
    if (videoRef.current) {
      if (stream && hasActiveVideo) {
        videoRef.current.srcObject = stream;
      } else {
        videoRef.current.srcObject = null;
      }
    }
  }, [stream, hasActiveVideo]);

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
      className={`participant-video ${isLocal ? 'local' : ''} ${speaking ? 'speaking' : ''}`}
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.8 }}
    >
      {showVideo ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocal}
        />
      ) : (
        <div className="participant-placeholder">
          {/* 如果有头像URL（登录用户），显示头像图片；否则显示首字母 */}
          {participant?.user_info?.avatar_url ? (
            <img
              className="avatar-image"
              src={participant.user_info.avatar_url}
              alt={displayName}
            />
          ) : (
            <div className="avatar-placeholder">
              {displayName.charAt(0)}
            </div>
          )}
        </div>
      )}
      <div className="participant-name">
        {displayName}
        {participant?.is_creator && <span className="creator-badge">主持人</span>}
      </div>
    </motion.div>
  );
}

/** 本地视频预览组件 */
function LocalVideo({
  stream,
  isSpeaking,
  avatarUrl,
}: {
  stream: MediaStream | null;
  isSpeaking: boolean;
  /** 本地用户头像URL */
  avatarUrl?: string | null;
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
    >
      {showVideo ? (
        <video ref={videoRef} autoPlay playsInline muted />
      ) : (
        <div className="participant-placeholder">
          {/* 如果有头像URL，显示头像图片；否则显示"我" */}
          {avatarUrl ? (
            <img className="avatar-image" src={avatarUrl} alt="我" />
          ) : (
            <div className="avatar-placeholder">我</div>
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

      // 连接信令服务器
      webrtc.connect(
        meetingData.roomId,
        meetingData.token,
        iceServers,
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

  // 离开会议
  const handleLeave = useCallback(() => {
    webrtc.disconnect();
    webrtc.stopLocalStream();
    clearMeetingData();
    window.close();
  }, [webrtc]);

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
          {/* 本地视频 */}
          <LocalVideo
            stream={webrtc.localStream}
            isSpeaking={webrtc.isSpeaking}
            avatarUrl={meetingData?.userInfo?.avatar_url}
          />

          {/* 远程参与者视频 */}
          <AnimatePresence>
            {webrtc.participants.map((participant) => (
              <ParticipantVideo
                key={participant.id}
                participant={participant}
                roomName={meetingData.roomName}
                isSpeaking={participant.isSpeaking}
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
                      src={meetingData.userInfo.avatar_url}
                      alt={meetingData.displayName}
                    />
                  ) : (
                    <div className="participant-avatar">{meetingData.displayName.charAt(0)}</div>
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
                          src={p.user_info.avatar_url}
                          alt={displayName}
                        />
                      ) : (
                        <div className="participant-avatar">{displayName.charAt(0)}</div>
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
            onClick={webrtc.toggleScreenShare}
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

      {/* 连接状态提示 */}
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
    </div>
  );
}
