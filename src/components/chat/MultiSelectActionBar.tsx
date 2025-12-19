/**
 * 多选操作栏组件
 *
 * 多选模式下替换输入栏显示批量操作按钮
 * 包含丝滑的进入/退出动画
 */

import { motion } from 'framer-motion';
import { TrashIcon, RecallIcon, CloseIcon, SelectAllIcon } from '../common/Icons';

interface MultiSelectActionBarProps {
  selectedCount: number;
  totalCount: number;
  /** 是否可以批量撤回（需要有权限且选中了可撤回的消息） */
  canBatchRecall: boolean;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onBatchDelete: () => void;
  onBatchRecall: () => void;
  onCancel: () => void;
}

export function MultiSelectActionBar({
  selectedCount,
  totalCount,
  canBatchRecall,
  onSelectAll,
  onDeselectAll,
  onBatchDelete,
  onBatchRecall,
  onCancel,
}: MultiSelectActionBarProps) {
  const isAllSelected = selectedCount === totalCount && totalCount > 0;

  return (
    <motion.div
      className="multi-select-action-bar"
      initial={{ y: 40, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 40, opacity: 0 }}
      transition={{ 
        type: 'spring', 
        damping: 28, 
        stiffness: 350,
        mass: 0.8,
      }}
    >
      <div className="action-bar-left">
        <motion.button
          className="action-bar-btn cancel"
          onClick={onCancel}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <CloseIcon />
          <span>取消</span>
        </motion.button>

        <motion.button
          className="action-bar-btn select-all"
          onClick={isAllSelected ? onDeselectAll : onSelectAll}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <SelectAllIcon />
          <span>{isAllSelected ? '取消全选' : '全选'}</span>
        </motion.button>
      </div>

      <div className="action-bar-center">
        <motion.span
          className="selected-count"
          key={selectedCount}
          initial={{ scale: 1.2 }}
          animate={{ scale: 1 }}
          transition={{ duration: 0.2 }}
        >
          已选择 <strong>{selectedCount}</strong> 条消息
        </motion.span>
      </div>

      <div className="action-bar-right">
        {canBatchRecall && (
          <motion.button
            className="action-bar-btn recall"
            onClick={onBatchRecall}
            disabled={selectedCount === 0}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <RecallIcon />
            <span>撤回</span>
          </motion.button>
        )}

        <motion.button
          className="action-bar-btn delete"
          onClick={onBatchDelete}
          disabled={selectedCount === 0}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <TrashIcon />
          <span>删除</span>
        </motion.button>
      </div>
    </motion.div>
  );
}

