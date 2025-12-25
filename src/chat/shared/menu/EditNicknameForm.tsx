/**
 * 编辑群内昵称表单组件
 *
 * 允许用户修改自己在当前群聊中的昵称
 * 支持清除昵称（使用全局昵称显示）
 */

import { MenuHeader } from './MenuHeader';

interface EditNicknameFormProps {
  /** 当前昵称值 */
  value: string;
  /** 是否正在加载 */
  loading: boolean;
  /** 昵称变化回调 */
  onChange: (value: string) => void;
  /** 提交回调 */
  onSubmit: () => void;
  /** 清除昵称回调 */
  onClear: () => void;
  /** 返回回调 */
  onBack: () => void;
}

export function EditNicknameForm({
  value,
  loading,
  onChange,
  onSubmit,
  onClear,
  onBack,
}: EditNicknameFormProps) {
  return (
    <>
      <MenuHeader title="修改群内昵称" onBack={onBack} />
      <div className="menu-form">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="输入群内昵称（留空使用全局昵称）"
          className="menu-input"
          maxLength={30}
        />
        <div className="menu-form-buttons">
          <button
            className="menu-submit secondary"
            onClick={onClear}
            disabled={loading}
          >
            清除昵称
          </button>
          <button
            className="menu-submit"
            onClick={onSubmit}
            disabled={loading || !value.trim()}
          >
            {loading ? '保存中...' : '保存'}
          </button>
        </div>
        <p className="menu-hint">
          群内昵称仅在本群显示，不影响全局昵称
        </p>
      </div>
    </>
  );
}
