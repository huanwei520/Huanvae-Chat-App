/**
 * 声音配置管理 Hook
 *
 * 管理声音克隆配置的 CRUD 操作和选中状态。
 * 通话时优先使用用户选择的声音，否则使用默认声音。
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import type { ApiClient } from '../../../api/client';
import {
  getVoiceProfiles,
  createVoiceProfile,
  setDefaultVoiceProfile,
  deleteVoiceProfile,
  updateVoiceProfilePrompt,
  type VoiceProfile,
} from '../../../api/ai';

export interface UseVoiceProfilesReturn {
  profiles: VoiceProfile[];
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  uploading: boolean;
  refresh: () => void;
  upload: (name: string, audioBlob: Blob, fileName: string, systemPrompt?: string) => Promise<void>;
  setDefault: (profileId: string) => Promise<void>;
  remove: (profileId: string) => Promise<void>;
  select: (profileId: string | null) => void;
  updatePrompt: (profileId: string, systemPrompt: string | null) => Promise<void>;
}

export function useVoiceProfiles(api: ApiClient | null): UseVoiceProfilesReturn {
  const [profiles, setProfiles] = useState<VoiceProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const loadedRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!api) { return; }
    setLoading(true);
    setError(null);
    try {
      const list = await getVoiceProfiles(api);
      setProfiles(list);
      // 自动选中默认声音
      const defaultProfile = list.find(p => p.is_default);
      if (defaultProfile && !selectedId) {
        setSelectedId(defaultProfile.profile_id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [api, selectedId]);

  useEffect(() => {
    if (api && !loadedRef.current) {
      loadedRef.current = true;
      refresh();
    }
  }, [api, refresh]);

  const upload = useCallback(async (name: string, audioBlob: Blob, fileName: string, systemPrompt?: string) => {
    if (!api) { return; }
    setUploading(true);
    setError(null);
    console.log('[VoiceProfiles] upload 开始', { name, fileName, blobSize: audioBlob.size, blobType: audioBlob.type, systemPrompt });
    try {
      const profile = await createVoiceProfile(api, name, audioBlob, fileName, systemPrompt);
      console.log('[VoiceProfiles] upload 成功，返回配置:', profile);
      setProfiles(prev => [profile, ...prev]);
      if (profile.is_default) {
        setSelectedId(profile.profile_id);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[VoiceProfiles] upload 失败:', msg);
      setError(msg);
      throw err;
    } finally {
      setUploading(false);
    }
  }, [api]);

  const setDefault = useCallback(async (profileId: string) => {
    if (!api) { return; }
    try {
      await setDefaultVoiceProfile(api, profileId);
      setProfiles(prev => prev.map(p => ({
        ...p,
        is_default: p.profile_id === profileId,
      })));
      setSelectedId(profileId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [api]);

  const remove = useCallback(async (profileId: string) => {
    if (!api) { return; }
    try {
      await deleteVoiceProfile(api, profileId);
      setProfiles(prev => prev.filter(p => p.profile_id !== profileId));
      if (selectedId === profileId) {
        setSelectedId(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [api, selectedId]);

  const select = useCallback((profileId: string | null) => {
    setSelectedId(profileId);
  }, []);

  const updatePrompt = useCallback(async (profileId: string, systemPrompt: string | null) => {
    if (!api) { return; }
    try {
      await updateVoiceProfilePrompt(api, profileId, systemPrompt);
      setProfiles(prev => prev.map(p =>
        p.profile_id === profileId ? { ...p, system_prompt: systemPrompt } : p,
      ));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [api]);

  return {
    profiles,
    loading,
    error,
    selectedId,
    uploading,
    refresh,
    upload,
    setDefault,
    remove,
    select,
    updatePrompt,
  };
}
