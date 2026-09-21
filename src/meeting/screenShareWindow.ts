/**
 * 屏幕共享独立窗口 API（块 pvmk3dxq：分享框独立窗口化）
 *
 * 桌面端点「共享屏幕」后，分享选择 UI（分辨率/帧率/开始共享）不再以弹窗嵌在
 * 会议窗内部，而是弹出一个**独立的系统窗口**（Tauri WebviewWindow，路由
 * /screen-share），与会议窗平行存在、可独立拖动/关闭。与 theme-editor /
 * lan-transfer / meeting 等既有独立窗口同一模式（getByLabel 幂等守卫 + 运行时
 * 创建，tauri.conf.json 不需静态声明）。
 *
 * 事件/状态通道（会议窗 ⇄ 分享窗，全部走 Tauri 全局事件）：
 * - CONFIRM  分享窗→会议窗：用户点「开始共享」，载荷为 ScreenShareSettings；
 *   会议窗收到后执行与既有窗内弹窗同一起始链（toggleScreenShare + controlArm）。
 * - RESULT   会议窗→分享窗：start 判定结果（轮询 mediaState.screenSharing），
 *   started=会议窗关分享窗；failed=分享窗留窗显示原因可重试。
 * - STATE    会议窗→分享窗（状态同步广播）：{sharing:boolean}；分享窗收
 *   sharing=true 即自关（RESULT 丢失时的兜底，保证两窗状态一致）。
 *
 * 关闭语义：开始共享成功→会议窗关分享窗；用户点取消或标题栏 X→窗口自毁
 * （会议窗监听 destroyed 清 pending=取消分享，此时共享尚未发起）。
 *
 * @module meeting/screenShareWindow
 */

import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import type { ScreenShareSettings } from './screenShareSettings';

/** 独立分享窗口 label（capability desktop-default.windows 已登记） */
export const SCREEN_SHARE_WINDOW_LABEL = 'screen-share';

/** 事件：分享窗→会议窗，确认开始共享 */
export const SCREEN_SHARE_EV_CONFIRM = 'screen-share-window:confirm';

/** 事件：会议窗→分享窗，start 判定结果 */
export const SCREEN_SHARE_EV_RESULT = 'screen-share-window:result';

/** 事件：会议窗→分享窗，共享状态同步广播 */
export const SCREEN_SHARE_EV_STATE = 'screen-share-window:state';

/** RESULT 事件载荷 */
export interface ScreenShareResultPayload {
  status: 'started' | 'failed';
  /** failed 时的原因描述（取自 mediaError 或轮询超时说明） */
  message?: string;
  /** failed 时的原始诊断（lastScreenShareError 遥测，仅供状态区展示/排查） */
  detail?: string;
}

/** STATE 事件载荷 */
export interface ScreenShareStatePayload {
  sharing: boolean;
}

/** CONFIRM 事件载荷（即 ScreenShareSettings，显式别名以自文档化） */
export type ScreenShareConfirmPayload = ScreenShareSettings;

/** 会议窗判定 start 成败的轮询节奏（250ms × 16 ≈ 4s，覆盖 getDisplayMedia 选窗时间） */
export const SCREEN_SHARE_POLL_INTERVAL_MS = 250;
export const SCREEN_SHARE_POLL_MAX_TRIES = 16;

/**
 * 打开独立分享窗口（幂等：已存在则聚焦）
 *
 * 窗口参数：420×480（min 360×420），系统标题栏（decorations:true ⇒ 可拖动），
 * 可缩放；位置=主屏右侧留 40px 边距，与居中的会议窗并排、两窗标题栏同框可见。
 *
 * @returns 是否成功（含已存在聚焦）。false=非 Tauri 环境/创建失败，调用方回退窗内弹窗。
 * @param onDestroyed 窗口被销毁（用户点 X/取消）时的回调（会议窗用于清 pending=取消分享）
 */
export async function openScreenShareWindow(
  onDestroyed?: () => void,
): Promise<boolean> {
  let existing: WebviewWindow | null = null;
  try {
    existing = await WebviewWindow.getByLabel(SCREEN_SHARE_WINDOW_LABEL);
  } catch {
    // getByLabel 在非 Tauri 环境（纯浏览器/vitest jsdom）可能抛错 → 走回退
    return false;
  }
  if (existing) {
    try {
      if (onDestroyed) {
        void existing.once('tauri://destroyed', () => onDestroyed());
      }
      await existing.setFocus();
      return true;
    } catch {
      return false;
    }
  }

  // 主屏右侧留边定位；取不到显示器信息则交由系统默认摆放
  let x: number | undefined;
  let y: number | undefined;
  try {
    const { currentMonitor } = await import('@tauri-apps/api/window');
    const mon = await currentMonitor();
    if (mon) {
      const width = 420;
      x = Math.round(mon.position.toLogical(mon.scaleFactor).x
        + mon.size.toLogical(mon.scaleFactor).width - width - 40);
      y = 120;
    }
  } catch {
    // 定位失败不阻断开窗
  }

  const shareWindow = new WebviewWindow(SCREEN_SHARE_WINDOW_LABEL, {
    url: '/screen-share',
    title: '屏幕共享',
    width: 420,
    height: 480,
    minWidth: 360,
    minHeight: 420,
    ...(x !== undefined ? { x, y } : {}),
    decorations: true,
    resizable: true,
    focus: true,
  });

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (!settled) {
        settled = true;
        resolve(ok);
      }
    };
    if (onDestroyed) {
      void shareWindow.once('tauri://destroyed', () => onDestroyed());
    }
    shareWindow.once('tauri://created', () => done(true));
    shareWindow.once('tauri://error', (e) => {
      console.error('[ScreenShareWindow] 创建独立分享窗口失败:', e);
      done(false);
    });
    // 极端情况下事件不来（老事件总线竞态），1.5s 后按已创建放行，不阻塞主链路
    setTimeout(() => done(true), 1500);
  });
}

/**
 * 关闭独立分享窗口（幂等；不存在时静默）
 * 会议窗在共享成功开始后调用（「开始共享后窗口关闭」）
 */
export async function closeScreenShareWindow(): Promise<void> {
  try {
    const existing = await WebviewWindow.getByLabel(SCREEN_SHARE_WINDOW_LABEL);
    if (existing) {
      await existing.close();
    }
  } catch (err) {
    console.error('[ScreenShareWindow] 关闭独立分享窗口失败:', err);
  }
}
