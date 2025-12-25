/**
 * 编辑群名称表单组件
 */

import { MenuHeader } from './MenuHeader';

interface EditNameFormProps {
  value: string;
  loading: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onBack: () => void;
}

export function EditNameForm({
  value,
  loading,
  onChange,
  onSubmit,
  onBack,
}: EditNameFormProps) {
  return (
    <>
      <MenuHeader title="修改群名称" onBack={onBack} />
      <div className="menu-form">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="输入新群名称"
          className="menu-input"
          maxLength={50}
        />
        <button
          className="menu-submit"
          onClick={onSubmit}
          disabled={loading || !value.trim()}
        >
          {loading ? '保存中...' : '保存'}
        </button>
      </div>
    </>
  );
}
