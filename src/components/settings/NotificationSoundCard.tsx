/**
 * 消息提示音设置卡片
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSettingsStore } from '../../stores/settingsStore';
import { useNotificationSounds } from '../../hooks/useNotificationSounds';

// ============================================
// 图标组件
// ============================================

const VolumeIcon: React.FC<{ muted?: boolean }> = ({ muted }) => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    {!muted && (
      <>
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
      </>
    )}
    {muted && (
      <>
        <line x1="23" y1="9" x2="17" y2="15" />
        <line x1="17" y1="9" x2="23" y2="15" />
      </>
    )}
  </svg>
);

const PlayIcon: React.FC = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="currentColor"
    stroke="none"
  >
    <polygon points="5 3 19 12 5 21 5 3" />
  </svg>
);

const StopIcon: React.FC = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="currentColor"
    stroke="none"
  >
    <rect x="6" y="6" width="12" height="12" rx="1" />
  </svg>
);

const UploadIcon: React.FC = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);

const TrashIcon: React.FC = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

const CheckIcon: React.FC = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="3"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

// ============================================
// 组件实现
// ============================================

export const NotificationSoundCard: React.FC = () => {
  const { notification, setNotificationSound, setNotificationEnabled, setNotificationVolume } =
    useSettingsStore();
  const {
    sounds,
    loading,
    playingSound,
    playSound,
    stopSound,
    uploadSound,
    deleteSound,
    refresh,
  } = useNotificationSounds();

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // 处理选择提示音
  const handleSelectSound = (name: string) => {
    setNotificationSound(name);
    // 播放预览
    playSound(name, notification.volume);
  };

  // 处理上传
  const handleUpload = async () => {
    setUploading(true);
    setUploadError(null);

    try {
      const result = await uploadSound();
      if (result) {
        // 上传成功后自动选中
        setNotificationSound(result.name);
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  };

  // 处理删除
  const handleDelete = async (name: string) => {
    try {
      await deleteSound(name);
      // 如果删除的是当前选中的，切换到默认
      if (notification.soundName === name) {
        setNotificationSound('water');
      }
      setDeleteConfirm(null);
    } catch (err) {
      console.error('删除提示音失败:', err);
    }
  };

  return (
    <div className="settings-card notification-sound-card">
      <div className="settings-card-header">
        <div className="settings-card-icon">
          <VolumeIcon muted={!notification.enabled} />
        </div>
        <div className="settings-card-title">
          <h3>消息提示音</h3>
          <p>选择新消息到达时的提示音效</p>
        </div>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={notification.enabled}
            onChange={(e) => setNotificationEnabled(e.target.checked)}
          />
          <span className="toggle-slider" />
        </label>
      </div>

      <AnimatePresence>
        {notification.enabled && (
          <motion.div
            className="settings-card-content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {/* 音量控制 */}
            <div className="volume-control">
              <span className="volume-label">音量</span>
              <input
                type="range"
                min="0"
                max="100"
                value={notification.volume}
                onChange={(e) => setNotificationVolume(Number(e.target.value))}
                className="volume-slider"
              />
              <span className="volume-value">{notification.volume}%</span>
            </div>

            {/* 提示音列表 */}
            <div className="sounds-list">
              {loading ? (
                <div className="sounds-loading">加载中...</div>
              ) : sounds.length === 0 ? (
                <div className="sounds-empty">
                  <p>暂无提示音，请上传 MP3 文件</p>
                  <button className="refresh-btn" onClick={refresh}>
                    刷新列表
                  </button>
                </div>
              ) : (
                sounds.map((sound) => (
                  <div
                    key={sound.name}
                    className={`sound-item ${notification.soundName === sound.name ? 'selected' : ''}`}
                  >
                    <button
                      className="sound-select-btn"
                      onClick={() => handleSelectSound(sound.name)}
                    >
                      <span className="sound-check">
                        {notification.soundName === sound.name && <CheckIcon />}
                      </span>
                      <span className="sound-name">{sound.name}</span>
                    </button>

                    <div className="sound-actions">
                      {/* 播放/停止按钮 */}
                      <button
                        className="sound-action-btn play-btn"
                        onClick={() =>
                          playingSound === sound.name
                            ? stopSound()
                            : playSound(sound.name, notification.volume)
                        }
                        title={playingSound === sound.name ? '停止' : '试听'}
                      >
                        {playingSound === sound.name ? <StopIcon /> : <PlayIcon />}
                      </button>

                      {/* 删除按钮（不能删除默认的 water） */}
                      {sound.name !== 'water' && (
                        <>
                          {deleteConfirm === sound.name ? (
                            <div className="delete-confirm">
                              <button
                                className="confirm-yes"
                                onClick={() => handleDelete(sound.name)}
                              >
                                确定
                              </button>
                              <button
                                className="confirm-no"
                                onClick={() => setDeleteConfirm(null)}
                              >
                                取消
                              </button>
                            </div>
                          ) : (
                            <button
                              className="sound-action-btn delete-btn"
                              onClick={() => setDeleteConfirm(sound.name)}
                              title="删除"
                            >
                              <TrashIcon />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* 上传按钮 */}
            <button
              className="upload-sound-btn"
              onClick={handleUpload}
              disabled={uploading}
            >
              <UploadIcon />
              <span>{uploading ? '上传中...' : '上传自定义提示音'}</span>
            </button>

            {/* 上传错误提示 */}
            {uploadError && (
              <div className="upload-error">
                {uploadError}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default NotificationSoundCard;

