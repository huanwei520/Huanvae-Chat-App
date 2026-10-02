/**
 * 屏幕共享设置共用面板（块 pvmk3dxq：分享框独立窗口化）
 *
 * 自 MeetingPage「屏幕共享设置」弹窗抽出的选项 UI（标题+分辨率组+帧率组+动作区），
 * 两个宿主共用同一份面板组件（单一事实源，不复制两份逻辑）：
 * - 会议窗内兜底弹窗（MeetingPage.tsx，WebviewWindow 创建失败/非桌面时）；
 * - 桌面端独立分享窗口页面（ScreenShareWindowPage.tsx，路由 /screen-share）。
 *
 * 面板本体不含遮罩/进出场动画：宿主各自包裹（窗内弹窗用 motion 遮罩，
 * 独立窗是整页直接渲染）。样式复用全局 .setting-* 类（styles/index.css 已全局
 * @import meeting/styles.css，所有窗口可用）。
 *
 * @module meeting/components/ScreenShareSettingsPanel
 */

import {
  FRAME_RATE_OPTIONS,
  RESOLUTION_LABELS,
  RESOLUTION_MAP,
  type ScreenShareFrameRate,
  type ScreenShareResolution,
} from '../screenShareSettings';

export interface ScreenShareSettingsPanelProps {
  resolution: ScreenShareResolution;
  frameRate: ScreenShareFrameRate;
  /** 当前显示器可用的分辨率档位（超出显示器能力的档位禁用） */
  availableResolutions: ScreenShareResolution[];
  onResolutionChange: (resolution: ScreenShareResolution) => void;
  onFrameRateChange: (frameRate: ScreenShareFrameRate) => void;
  onConfirm: () => void;
  onCancel: () => void;
  /** 确认按钮禁用（独立窗等待主窗判定期间） */
  confirmDisabled?: boolean;
  /** 状态提示（独立窗：主窗回传的失败原因/等待文案；无则不渲染） */
  statusNote?: string | null;
}

export function ScreenShareSettingsPanel({
  resolution,
  frameRate,
  availableResolutions,
  onResolutionChange,
  onFrameRateChange,
  onConfirm,
  onCancel,
  confirmDisabled = false,
  statusNote = null,
}: ScreenShareSettingsPanelProps) {
  return (
    <div className="screen-share-settings-panel">
      <h3>屏幕共享设置</h3>

      <div className="setting-group">
        <label>分辨率</label>
        <div className="setting-options">
          {(['1080p', '2k', '4k'] as ScreenShareResolution[]).map((res) => {
            const isAvailable = availableResolutions.includes(res);
            const { width, height } = RESOLUTION_MAP[res];
            const label = RESOLUTION_LABELS[res];
            return (
              <button
                key={res}
                className={`setting-option ${resolution === res ? 'active' : ''} ${!isAvailable ? 'disabled' : ''}`}
                onClick={() => isAvailable && onResolutionChange(res)}
                disabled={!isAvailable}
                title={!isAvailable ? '超出显示器分辨率' : `${width}×${height}`}
              >
                {label} ({width}×{height})
                {!isAvailable && <span className="option-hint">不可用</span>}
              </button>
            );
          })}
        </div>
      </div>

      <div className="setting-group">
        <label>帧率</label>
        <div className="setting-options">
          {FRAME_RATE_OPTIONS.map((fps) => (
            <button
              key={fps}
              className={`setting-option ${frameRate === fps ? 'active' : ''}`}
              onClick={() => onFrameRateChange(fps)}
            >
              {fps} FPS
            </button>
          ))}
        </div>
      </div>

      {statusNote && <p className="screen-share-window-note">{statusNote}</p>}

      <div className="setting-actions">
        <button
          className="setting-cancel"
          onClick={onCancel}
        >
          取消
        </button>
        <button
          className="setting-confirm"
          onClick={onConfirm}
          disabled={confirmDisabled}
        >
          开始共享
        </button>
      </div>
    </div>
  );
}
