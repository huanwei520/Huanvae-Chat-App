/**
 * 创建群聊表单组件
 */

import { motion } from 'framer-motion';

interface CreateGroupFormProps {
  groupName: string;
  groupDesc: string;
  loading: boolean;
  onNameChange: (value: string) => void;
  onDescChange: (value: string) => void;
  onSubmit: () => void;
}

export function CreateGroupForm({
  groupName,
  groupDesc,
  loading,
  onNameChange,
  onDescChange,
  onSubmit,
}: CreateGroupFormProps) {
  return (
    <>
      <div className="form-group">
        <label>群名称</label>
        <input
          type="text"
          className="glass-input"
          value={groupName}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="输入群名称"
          maxLength={50}
        />
      </div>
      <div className="form-group">
        <label>群简介（可选）</label>
        <textarea
          className="glass-input"
          value={groupDesc}
          onChange={(e) => onDescChange(e.target.value)}
          placeholder="介绍一下这个群..."
          maxLength={200}
          rows={3}
        />
      </div>
      <motion.button
        className="glass-button"
        onClick={onSubmit}
        disabled={loading || !groupName.trim()}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
      >
        {loading ? '创建中...' : '创建群聊'}
      </motion.button>
    </>
  );
}

