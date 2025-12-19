/**
 * 可调整大小面板的 Hook
 *
 * 用于实现拖拽调整侧边栏宽度
 */

import { useState, useRef, useEffect, useCallback } from 'react';

interface UseResizablePanelOptions {
  /** 最小宽度 */
  minWidth: number;
  /** 最大宽度 */
  maxWidth: number;
  /** 初始宽度，默认为最大宽度 */
  initialWidth?: number;
}

interface UseResizablePanelReturn {
  /** 当前面板宽度 */
  panelWidth: number;
  /** 是否正在调整大小 */
  isResizing: boolean;
  /** 开始调整大小的处理函数 */
  handleResizeStart: (e: React.MouseEvent) => void;
}

export function useResizablePanel({
  minWidth,
  maxWidth,
  initialWidth,
}: UseResizablePanelOptions): UseResizablePanelReturn {
  const [panelWidth, setPanelWidth] = useState(initialWidth ?? maxWidth);
  const [isResizing, setIsResizing] = useState(false);
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  // 处理拖拽开始
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    resizeRef.current = { startX: e.clientX, startWidth: panelWidth };
  }, [panelWidth]);

  // 处理拖拽移动和结束
  useEffect(() => {
    if (!isResizing) { return; }

    const handleMouseMove = (e: MouseEvent) => {
      if (!resizeRef.current) { return; }
      const delta = e.clientX - resizeRef.current.startX;
      const newWidth = Math.min(maxWidth, Math.max(minWidth, resizeRef.current.startWidth + delta));
      setPanelWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      resizeRef.current = null;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, minWidth, maxWidth]);

  return {
    panelWidth,
    isResizing,
    handleResizeStart,
  };
}
