/**
 * 会议内远程控制——remote-control 独立窗口单例（先例 MeetingEntryModal.tsx:34-41
 * getByLabel 聚焦复用形态；label=`remote-control`，设计 §4.2 窗口规格）
 *
 * @module remote-control/openWindow
 */

import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

export const REMOTE_CONTROL_LABEL = 'remote-control';

/** 打开（或聚焦已存在的）remote-control 独立控制窗口；返回是否新开 */
export async function openRemoteControlWindow(): Promise<boolean> {
  const existing = await WebviewWindow.getByLabel(REMOTE_CONTROL_LABEL);
  if (existing) {
    await existing.setFocus();
    return false;
  }
  const win = new WebviewWindow(REMOTE_CONTROL_LABEL, {
    url: '/remote-control',
    title: '远程控制',
    width: 1024,
    height: 640,
    center: true,
    decorations: true,
    resizable: true,
    focus: true,
  });
  win.once('tauri://error', (e) => {
    console.error('[RemoteControl] 创建控制窗口失败:', e);
  });
  return true;
}
