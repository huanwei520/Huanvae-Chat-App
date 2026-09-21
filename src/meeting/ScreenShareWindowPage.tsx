/**
 * 屏幕共享独立窗口页面（块 pvmk3dxq：分享框独立窗口化）
 *
 * 桌面端「共享屏幕」的分享选择 UI 以独立系统窗口呈现（路由 /screen-share，
 * 由 meeting 窗经 screenShareWindow.openScreenShareWindow() 创建）。
 *
 * 职责：
 * - 渲染共用面板 ScreenShareSettingsPanel（与会议窗内兜底弹窗同一组件）；
 * - 「开始共享」→ emit CONFIRM 给会议窗 → 等 RESULT：
 *   started → 自关窗口（「开始共享后窗口关闭」）；
 *   failed → 留窗显示原因，可改档重试；
 * - 「取消」→ 自关窗口（会议窗 destroyed 监听按取消处理，共享未发起）；
 * - STATE 广播（共享状态同步）：meeting 窗告知 sharing=true 时自关（兜底）；
 *   sharing=false 且本窗仍在 → 恢复可重试态。
 *
 * 本窗口不做任何后端数据面调用（纯 UI+事件），故不进 main.tsx 的
 * DATA_PLANE_SUBWINDOWS。
 *
 * @module meeting/ScreenShareWindowPage
 */

import { useEffect, useRef, useState } from 'react';
import { emit, listen } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { ScreenShareSettingsPanel } from './components/ScreenShareSettingsPanel';
import { getAvailableResolutions, type ScreenShareFrameRate, type ScreenShareResolution } from './screenShareSettings';
import {
  SCREEN_SHARE_EV_CONFIRM,
  SCREEN_SHARE_EV_RESULT,
  SCREEN_SHARE_EV_STATE,
  type ScreenShareResultPayload,
  type ScreenShareStatePayload,
} from './screenShareWindow';

export function ScreenShareWindowPage() {
  const [resolution, setResolution] = useState<ScreenShareResolution>('1080p');
  const [frameRate, setFrameRate] = useState<ScreenShareFrameRate>(60);
  const [availableResolutions, setAvailableResolutions] = useState<ScreenShareResolution[]>(['1080p', '2k', '4k']);
  const [pending, setPending] = useState(false);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const unlistedRef = useRef(false);

  useEffect(() => {
    setAvailableResolutions(getAvailableResolutions());
  }, []);

  useEffect(() => {
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    const currentWindow = getCurrentWebviewWindow();
    const closeSelf = () => {
      if (unlistedRef.current) { return; }
      unlistedRef.current = true;
      void currentWindow.close();
    };

    void listen<ScreenShareResultPayload>(SCREEN_SHARE_EV_RESULT, (event) => {
      if (disposed) { return; }
      if (event.payload.status === 'started') {
        closeSelf();
      } else {
        setPending(false);
        setStatusNote(event.payload.message ?? '共享未能开始，可调整后重试');
      }
    }).then((un) => { if (disposed) { un(); } else { unlisteners.push(un); } });

    // 共享状态同步：会议窗广播 sharing=true → 本窗自关（RESULT 丢失兜底）
    void listen<ScreenShareStatePayload>(SCREEN_SHARE_EV_STATE, (event) => {
      if (disposed) { return; }
      if (event.payload.sharing) {
        closeSelf();
      }
    }).then((un) => { if (disposed) { un(); } else { unlisteners.push(un); } });

    return () => {
      disposed = true;
      unlisteners.forEach((un) => un());
    };
  }, []);

  const handleConfirm = () => {
    setPending(true);
    setStatusNote('正在发起共享…');
    void emit(SCREEN_SHARE_EV_CONFIRM, { resolution, frameRate });
  };

  const handleCancel = () => {
    void getCurrentWebviewWindow().close();
  };

  return (
    <div className="screen-share-window-page">
      <ScreenShareSettingsPanel
        resolution={resolution}
        frameRate={frameRate}
        availableResolutions={availableResolutions}
        onResolutionChange={(res) => { setResolution(res); setStatusNote(null); }}
        onFrameRateChange={(fps) => { setFrameRate(fps); setStatusNote(null); }}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
        confirmDisabled={pending}
        statusNote={statusNote}
      />
    </div>
  );
}
