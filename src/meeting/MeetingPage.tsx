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
import {
  useWebRTC,
  type RemoteParticipant,
  type ScreenShareSettings,
  type ScreenShareResolution,
  type ScreenShareFrameRate,
  getAvailableResolutions,
  RESOLUTION_MAP,
} from './useWebRTC';
import { loadMeetingData, clearMeetingData, type MeetingWindowData, type IceServer } from './api';
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
import './styles.css';

/**
 * 参与者视频组件
 *
 * 视频流优先级：
 * 1. screenStream（屏幕共享）- 优先显示
 * 2. cameraStream（摄像头）
 * 3. stream（未区分的混合流，兼容旧逻辑）
 */
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
  const audioRef = useRef<HTMLAudioElement>(null);
  // 记录上次设置的 stream id，避免不必要的更新
  const lastStreamIdRef = useRef<string | null>(null);

  // 视频流优先级：屏幕共享 > 摄像头 > 混合流
  const stream = participant?.screenStream || participant?.cameraStream || participant?.stream;
  const [hasActiveVideo, setHasActiveVideo] = useState(false);
  // 是否正在共享屏幕（用于 UI 提示）
  const isScreenSharing = !!participant?.screenStream;

  // 简化的视频轨道状态检查（低频轮询代替高频事件监听）
  useEffect(() => {
    if (!stream) {
      setHasActiveVideo(false);
      return;
    }

    // 初始检查
    const checkVideoTrack = () => {
      const videoTracks = stream.getVideoTracks();
      return videoTracks.some((track) => track.readyState === 'live' && !track.muted);
    };

    setHasActiveVideo(checkVideoTrack());

    // 使用低频轮询（500ms）代替高频事件监听，减少状态更新
    const interval = setInterval(() => {
      setHasActiveVideo(checkVideoTrack());
    }, 500);

    return () => clearInterval(interval);
  }, [stream]);

  // 设置视频源（使用 ref 缓存避免不必要更新）
  useEffect(() => {
    if (!videoRef.current) { return; }

    // 获取当前 stream 的唯一标识
    const currentStreamId = stream?.id ?? null;

    // 只有 stream 真正变化时才更新 srcObject
    if (currentStreamId !== lastStreamIdRef.current || !hasActiveVideo) {
      lastStreamIdRef.current = currentStreamId;

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
    >
      {/* 隐藏的音频元素：用于播放远程音频（使用原始 stream，不是区分后的视频流） */}
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

  // 屏幕共享设置弹窗
  const [showScreenShareSettings, setShowScreenShareSettings] = useState(false);
  const [screenShareResolution, setScreenShareResolution] = useState<ScreenShareResolution>('1080p');
  const [screenShareFrameRate, setScreenShareFrameRate] = useState<ScreenShareFrameRate>(60);

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
