/**
 * 会议页音频设备入口（会议窗内可见的音频输入/输出选择）
 *
 * 背景：MeetingAudioSettings 原先只挂在主窗 SettingsPanel（桌面端「设置 → 会议音频」段），
 * 会议窗（/meeting 独立窗口）内没有任何可见入口——owner 报「会议模式里看不到音频
 * 输入/输出选择项」即此。本组件把入口补进会议页顶部栏：
 * - 齿轮按钮（仅桌面端渲染，isDesktop() 门控，与 SettingsPanel 段级门控同款红线）；
 * - 点击弹出音频设备面板，内容直接复用 <MeetingAudioSettings />：
 *   麦克风/扬声器两个下拉、设备枚举、即时持久化（localStorage）与降级标注全部同源；
 *   面板内选择 → 本窗 notifyListeners 即时生效（MeetingPage 订阅 → 麦克风
 *   switchAudioInputDevice 热切换 / 远端 <audio> applyAudioOutputSink 重应用），
 *   主窗设置页与会议窗双向经 storage 事件保持同步（既有链路，零改动）。
 * - 点击面板外/Esc 关闭；移动端零渲染零监听（按钮与面板都不挂）。
 *
 * @module meeting/components/MeetingAudioEntry
 */

import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { SettingsIcon } from '../../components/common/Icons';
import { MeetingAudioSettings } from '../../components/settings/MeetingAudioSettings';
import { isDesktop } from '../../utils/platform';
// 面板内容复用设置页样式体系（.settings-audio-devices 等）；
// 会议窗不渲染 SettingsPanel，这里显式引入保证类样式在会议窗可用（vite 去重，零重复打包）
import '../../components/settings/styles.css';

export const MeetingAudioEntry: React.FC = () => {
  const [open, setOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);

  // Esc 关闭（面板打开时）
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [open, close]);

  // 移动端零渲染：不挂按钮、不挂面板、不挂监听（与 MeetingAudioSettings 门控红线一致）
  if (!isDesktop()) {
    return null;
  }

  return (
    <>
      <motion.button
        className={`meeting-header-btn ${open ? 'active' : ''}`}
        onClick={() => setOpen((v) => !v)}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        title="音频设备设置"
        aria-label="音频设备设置"
        aria-expanded={open}
      >
        <SettingsIcon />
      </motion.button>

      <AnimatePresence>
        {open && (
          <>
            {/* 透明遮罩：点击面板外任意处关闭（面板自身 stopPropagation） */}
            <div
              className="meeting-audio-backdrop"
              onClick={close}
              data-testid="meeting-audio-backdrop"
            />
            <motion.div
              className="meeting-audio-popover"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-label="会议音频设备"
            >
              <h4 className="meeting-audio-popover-title">音频设备</h4>
              <MeetingAudioSettings />
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
};

export default MeetingAudioEntry;
