/**
 * 设置好友备注表单组件
 *
 * 允许用户为好友设置仅自己可见的备注名
 * 支持清除备注（恢复显示昵称）
 */

import { MenuHeader } from './MenuHeader';

interface EditRemarkFormProps {
  /** 当前备注值 */
  value: string;
  /** 是否正在加载 */
  loading: boolean;
  /** 备注变化回调 */
  onChange: (value: string) => void;
  /** 提交回调 */
  onSubmit: () => void;
  /** 清除备注回调 */
  onClear: () => void;
  /** 返回回调 */
  onBack: () => void;
}

export function EditRemarkForm({
  value,
  loading,
  onChange,
  onSubmit,
  onClear,
  onBack,
}: EditRemarkFormProps) {
  return (
    <>
      <MenuHeader title="设置备注" onBack={onBack} />
      <div className="menu-form">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="输入好友备注（留空显示昵称）"
          className="menu-input"
          maxLength={30}
        />
        <div className="menu-form-buttons">
          <button
            className="menu-submit secondary"
            onClick={onClear}
            disabled={loading}
          >
            清除备注
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
          备注仅自己可见，不影响对方昵称
        </p>
      </div>
    </>
  );
}
