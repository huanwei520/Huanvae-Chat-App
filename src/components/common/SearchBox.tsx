/**
 * 可复用的搜索框组件
 *
 * 支持折叠状态下显示为图标按钮，点击后弹出搜索框
 */

import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { SearchIcon } from './Icons';
import { useSearchPopup } from '../../hooks/useSearchPopup';
import { SEARCH_COLLAPSE_WIDTH } from '../../constants/listAnimations';

interface SearchBoxProps {
  /** 搜索关键词 */
  searchQuery: string;
  /** 搜索关键词变化回调 */
  onSearchChange: (query: string) => void;
  /** 面板宽度，用于判断是否折叠 */
  panelWidth: number;
  /** 搜索框占位符 */
  placeholder?: string;
}

export function SearchBox({
  searchQuery,
  onSearchChange,
  panelWidth,
  placeholder = '搜索',
}: SearchBoxProps) {
  const {
    showSearchPopup,
    searchInputRef,
    isCollapsed,
    openPopup,
    closePopup,
  } = useSearchPopup({ panelWidth, collapseWidth: SEARCH_COLLAPSE_WIDTH });

  return (
    <>
      {/* 搜索框 - 通过 CSS 过渡实现平滑形态变化 */}
      <div
        className={`search-box-wrapper ${isCollapsed ? 'collapsed' : ''}`}
        onClick={isCollapsed ? openPopup : undefined}
        title={isCollapsed ? placeholder : undefined}
      >
        <SearchIcon />
        <input
          type="text"
          placeholder={placeholder}
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          tabIndex={isCollapsed ? -1 : 0}
        />
      </div>

      {/* 弹出式搜索框 - 使用 Portal 渲染到 body 级别 */}
      {showSearchPopup && createPortal(
        <AnimatePresence>
          <motion.div
            className="search-popup-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closePopup}
          >
            <motion.div
              className="search-popup"
              initial={{ opacity: 0, scale: 0.9, y: -10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: -10 }}
              transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="search-popup-box">
                <SearchIcon />
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder={placeholder}
                  value={searchQuery}
                  onChange={(e) => onSearchChange(e.target.value)}
                  onKeyDown={(e) => e.key === 'Escape' && closePopup()}
                />
              </div>
            </motion.div>
          </motion.div>
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
