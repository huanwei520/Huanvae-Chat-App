/**
 * 跨平台更新 Hook
 *
 * 根据当前平台自动选择使用桌面端或 Android 的更新逻辑。
 * 在 App.tsx 中使用此 Hook 可以实现一次调用，自动适配所有平台。
 *
 * 使用方式：
 * ```tsx
 * function App() {
 *   const { toastProps } = usePlatformUpdate();
 *   return (
 *     <>
 *       <UpdateToast {...toastProps} />
 *       <div>...</div>
 *     </>
 *   );
 * }
 * ```
 */

import { useSilentUpdate } from './useSilentUpdate';
import { useSilentUpdateAndroid } from './useSilentUpdate.android';
import { type UpdateToastProps } from './components';

/**
 * 判断当前是否为移动端
 * 复用 App.tsx 中的逻辑
 */
function isMobile(): boolean {
  const ua = navigator.userAgent.toLowerCase();
  return /android|iphone|ipad|ipod|mobile/i.test(ua);
}

/**
 * 跨平台更新 Hook
 *
 * 根据当前平台自动选择：
 * - 桌面端: useSilentUpdate（使用 @tauri-apps/plugin-updater）
 * - Android: useSilentUpdateAndroid（使用自定义服务）
 *
 * @returns 更新弹窗的 props
 */
export function usePlatformUpdate(): { toastProps: UpdateToastProps } {
  // 根据平台选择不同的 Hook
  // 注意：React Hooks 规则要求在组件顶层调用，不能在条件语句中
  // 但由于两个 Hook 返回相同的接口，可以安全地使用条件判断

  const desktopResult = useSilentUpdate();
  const androidResult = useSilentUpdateAndroid();

  // 返回对应平台的结果
  if (isMobile()) {
    return androidResult;
  }

  return desktopResult;
}
