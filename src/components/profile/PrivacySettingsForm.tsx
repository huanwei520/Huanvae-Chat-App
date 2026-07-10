/**
 * 隐私 / 申请处理设置表单
 *
 * @location src/components/profile/PrivacySettingsForm.tsx
 *
 * 编辑当前用户的：
 * - 搜索可见性：总开关 allow_search + 按 ID/用户名可见 search_visible_by_id
 *   （总开关式：总开关关闭即完全不可被搜索/添加，覆盖并禁用按 ID 开关）
 * - 申请默认处理策略：好友申请 / 群邀请，各 手动 / 自动通过 / 自动拒绝
 *
 * 进入时拉一次 getProfile 取当前值（session.profile 不含隐私字段）。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { MotionAppButton } from '../common/AppButton';
import { useApi } from '../../contexts/SessionContext';
import { getProfile, updateProfile, type RequestPolicy } from '../../api/profile';

interface PrivacySettingsFormProps {
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
  /** 隐藏内部提交按钮（移动端把保存动作提到页面顶部 header）。默认 false（桌面照旧展示按钮） */
  hideSubmit?: boolean;
  /** 上报提交态给外部（移动端顶部 header 保存键用）：canSave=有改动且可存，saving=提交中，submit=触发保存 */
  onSubmitStateChange?: (s: { canSave: boolean; saving: boolean; submit: () => void }) => void;
}

const POLICY_OPTIONS: { value: RequestPolicy; label: string }[] = [
  { value: 'manual', label: '手动处理' },
  { value: 'auto_accept', label: '自动通过' },
  { value: 'auto_reject', label: '自动拒绝' },
];

export function PrivacySettingsForm({ onSuccess, onError, hideSubmit = false, onSubmitStateChange }: PrivacySettingsFormProps) {
  const api = useApi();

  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [allowSearch, setAllowSearch] = useState(true);
  const [searchVisibleById, setSearchVisibleById] = useState(true);
  const [friendPolicy, setFriendPolicy] = useState<RequestPolicy>('manual');
  const [groupPolicy, setGroupPolicy] = useState<RequestPolicy>('manual');

  // 有改动检测基线（加载完成后落定；保存成功后归位），供移动端 header 保存键置灰/高亮。
  const baseline = useRef({ allowSearch: true, searchVisibleById: true, friendPolicy: 'manual' as RequestPolicy, groupPolicy: 'manual' as RequestPolicy });

  // 用 ref 持有最新 onError，避免把它放进 effect 依赖导致父级 re-render 时重复拉取
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    let cancelled = false;
    getProfile(api)
      .then((p) => {
        if (cancelled) { return; }
        setAllowSearch(p.allow_search);
        setSearchVisibleById(p.search_visible_by_id);
        setFriendPolicy(p.friend_request_policy);
        setGroupPolicy(p.group_invite_policy);
        baseline.current = {
          allowSearch: p.allow_search,
          searchVisibleById: p.search_visible_by_id,
          friendPolicy: p.friend_request_policy,
          groupPolicy: p.group_invite_policy,
        };
        setLoaded(true);
      })
      .catch((err) => {
        if (cancelled) { return; }
        onErrorRef.current(err instanceof Error ? err.message : '加载隐私设置失败');
        // 置终态，避免错误时永久停留"加载中"（展示空表单，用户仍可重试保存）
        setLoaded(true);
      });
    return () => { cancelled = true; };
  }, [api]);

  const handleSubmit = async () => {
    setSaving(true);
    try {
      await updateProfile(api, {
        allow_search: allowSearch,
        search_visible_by_id: searchVisibleById,
        friend_request_policy: friendPolicy,
        group_invite_policy: groupPolicy,
      });
      onSuccess('隐私设置已更新');
      baseline.current = { allowSearch, searchVisibleById, friendPolicy, groupPolicy };
    } catch (err) {
      onError(err instanceof Error ? err.message : '更新失败');
    } finally {
      setSaving(false);
    }
  };

  // 有改动检测 + 稳定 submit 包装（供移动端 header 保存键；桌面内部按钮 disabled 不受影响）
  const isDirty = loaded && (
    allowSearch !== baseline.current.allowSearch ||
    searchVisibleById !== baseline.current.searchVisibleById ||
    friendPolicy !== baseline.current.friendPolicy ||
    groupPolicy !== baseline.current.groupPolicy
  );
  const submitRef = useRef(handleSubmit);
  submitRef.current = handleSubmit;
  const stableSubmit = useCallback(() => { void submitRef.current(); }, []);
  useEffect(() => {
    onSubmitStateChange?.({ canSave: isDirty && !saving, saving, submit: stableSubmit });
  }, [onSubmitStateChange, isDirty, saving, stableSubmit]);

  if (!loaded) {
    return <div className="privacy-loading">加载中...</div>;
  }

  return (
    <div className="privacy-settings">
      <div className="privacy-section-title">搜索可见性</div>

      <label className="privacy-row">
        <span className="privacy-row-label">允许被搜索 / 添加</span>
        <input
          type="checkbox"
          className="privacy-toggle"
          checked={allowSearch}
          onChange={(e) => setAllowSearch(e.target.checked)}
        />
      </label>

      <label className={`privacy-row ${allowSearch ? '' : 'disabled'}`}>
        <span className="privacy-row-label">允许通过 ID / 用户名被添加</span>
        <input
          type="checkbox"
          className="privacy-toggle"
          checked={allowSearch && searchVisibleById}
          disabled={!allowSearch}
          onChange={(e) => setSearchVisibleById(e.target.checked)}
        />
      </label>
      {!allowSearch && (
        <div className="privacy-hint">已关闭被搜索：他人即使有你的精确 ID 也无法添加你。</div>
      )}

      <div className="privacy-section-title">申请默认处理</div>

      <div className="form-group">
        <label>好友申请</label>
        <select
          className="glass-input"
          value={friendPolicy}
          onChange={(e) => setFriendPolicy(e.target.value as RequestPolicy)}
        >
          {POLICY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <label>群邀请</label>
        <select
          className="glass-input"
          value={groupPolicy}
          onChange={(e) => setGroupPolicy(e.target.value as RequestPolicy)}
        >
          {POLICY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {!hideSubmit && (
        <MotionAppButton
          variant="primary"
          size="lg"
          block
          onClick={handleSubmit}
          disabled={saving}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          {saving ? '保存中...' : '保存设置'}
        </MotionAppButton>
      )}
    </div>
  );
}
