/**
 * 提示音管理 Hook
 *
 * 提供提示音列表获取、上传、删除等功能
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { convertFileSrc } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';

// ============================================
// 类型定义
// ============================================

/** 提示音信息 */
export interface SoundInfo {
  /** 显示名称（不含扩展名） */
  name: string;
  /** 文件名（含扩展名） */
  filename: string;
  /** 完整文件路径 */
  path: string;
}

// ============================================
// Hook 实现
// ============================================

export function useNotificationSounds() {
  const [sounds, setSounds] = useState<SoundInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 音频播放器
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingSound, setPlayingSound] = useState<string | null>(null);

  // 加载提示音列表
  const loadSounds = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // 确保目录存在
      await invoke('ensure_sounds_directory');

      // 获取提示音列表
      const list = await invoke<SoundInfo[]>('list_notification_sounds');
      setSounds(list);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      console.error('[NotificationSounds] 加载失败:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // 初始加载
  useEffect(() => {
    loadSounds();
  }, [loadSounds]);

  // 播放提示音
  const playSound = useCallback(async (name: string, volume: number = 70) => {
    try {
      // 停止当前播放
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }

      // 获取文件路径
      const path = await invoke<string>('get_notification_sound_path', { name });
      const src = convertFileSrc(path);

      // 创建新的音频
      const audio = new Audio(src);
      audio.volume = volume / 100;

      audio.onended = () => {
        setPlayingSound(null);
        audioRef.current = null;
      };

      audio.onerror = () => {
        setPlayingSound(null);
        audioRef.current = null;
        console.error('[NotificationSounds] 播放失败:', name);
      };

      audioRef.current = audio;
      setPlayingSound(name);
      await audio.play();
    } catch (err) {
      console.error('[NotificationSounds] 播放错误:', err);
      setPlayingSound(null);
    }
  }, []);

  // 停止播放
  const stopSound = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPlayingSound(null);
  }, []);

  // 上传提示音
  const uploadSound = useCallback(async (): Promise<SoundInfo | null> => {
    try {
      // 打开文件选择对话框
      const selected = await openDialog({
        multiple: false,
        filters: [
          { name: '音频文件', extensions: ['mp3'] },
        ],
      });

      if (!selected) {
        return null;
      }

      const sourcePath = selected as unknown as string;
      const fileName = sourcePath.split(/[/\\]/).pop() || 'sound.mp3';
      const name = fileName.replace(/\.mp3$/i, '');

      // 保存到提示音目录
      const soundInfo = await invoke<SoundInfo>('save_notification_sound', {
        sourcePath,
        name,
      });

      // 刷新列表
      await loadSounds();

      return soundInfo;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[NotificationSounds] 上传失败:', err);
      throw new Error(message);
    }
  }, [loadSounds]);

  // 删除提示音
  const deleteSound = useCallback(async (name: string) => {
    try {
      await invoke('delete_notification_sound', { name });
      await loadSounds();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[NotificationSounds] 删除失败:', err);
      throw new Error(message);
    }
  }, [loadSounds]);

  // 组件卸载时停止播放
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  return {
    sounds,
    loading,
    error,
    playingSound,
    playSound,
    stopSound,
    uploadSound,
    deleteSound,
    refresh: loadSounds,
  };
}
