/**
 * 通知会话深链服务（Android）
 *
 * 链路（C1→C2→C3，MainActivity.kt 同名注释为原生侧真值源）：
 *
 * 1. **发布（C1）**：notifyNewMessage → notify({ deepLink }) → 原生桥
 *    `postMessageNotification`（content intent 携带 huanvae_deeplink extra）。
 *    不能走插件 sendNotification 带自定义数据：tauri-plugin-notification 的
 *    content intent extra `LocalNotficationObject` 取自 Kotlin Notification.sourceJson，
 *    tauri 2.11.1 下无赋值来源恒为 null —— 插件路径点击 intent 带不上 extra。
 *
 * 2. **热启动（C2）**：Activity 存活（launchMode=singleTask）→ onNewIntent →
 *    原生暂存 + evaluateJavascript poke → [registerDeepLinkPoke] 注册的
 *    `window.__huanvaeOnNotificationDeepLink` 回调 → takePendingDeepLink 原子取走 → 跳会话。
 *
 * 3. **冷启动（C3）**：WebView/前端未就绪，onNewIntent 不会来（onCreate intent），
 *    深链滞留原生静态暂存槽；MobileMain 登录态 + 好友/群列表加载完成后 boot-pull
 *    消费。take-once 语义保证热/冷两路并发只跳一次。
 *
 * 4. **登出/切账号**：SessionContext.clearSession 统一调用 [clearPendingDeepLink]，
 *    防止 A 账号的通知深链跳进 B 账号的会话。
 *
 * 深链载荷是最小字段集 { sourceType, sourceId }：会话路由所需的全部信息，
 * 不含消息内容/昵称等（那些本就只该出现在通知标题/正文里，不进路由）。
 *
 * @module services/deepLinkService
 */

/** 通知点击后要直达的会话（好友私聊含 bot；群聊按 group_id） */
export interface NotificationDeepLink {
  sourceType: 'friend' | 'group';
  sourceId: string;
}

/**
 * MainActivity 注入的原生 JS 桥（android.webkit.JavascriptInterface）。
 * 命名空间 `window.HuanvaeDeepLink`；桌面端/桥注入前为 undefined。
 */
interface HuanvaeDeepLinkBridge {
  /** 发布带深链的消息通知；true=已发布，false=失败（如未授权） */
  postMessageNotification(
    title: string,
    body: string,
    channelId: string,
    deepLinkJson: string | null,
  ): boolean;
  /** 原子取走暂存深链（take-once，取走即清）；无则 null */
  takePendingDeepLink(): string | null;
  /** 清空暂存（登出/切账号） */
  clearPendingDeepLink(): void;
}

declare global {
  interface Window {
    HuanvaeDeepLink?: HuanvaeDeepLinkBridge;
    /** MainActivity onNewIntent 的 evaluateJavascript poke 入口 */
    __huanvaeOnNotificationDeepLink?: () => void;
  }
}

/** 取原生桥；不可用（桌面端/WebView 桥未注入）返回 null */
export function getDeepLinkBridge(): HuanvaeDeepLinkBridge | null {
  if (typeof window === 'undefined') { return null; }
  return window.HuanvaeDeepLink ?? null;
}

/**
 * 解析并校验原生侧传来的深链 JSON。
 * 只认最小字段集，越界/缺失/坏 JSON 一律 null —— 绝不让脏数据进路由。
 */
export function parseDeepLinkJson(raw: string | null): NotificationDeepLink | null {
  if (!raw) { return null; }
  try {
    const obj = JSON.parse(raw) as Partial<NotificationDeepLink>;
    if (
      (obj.sourceType === 'friend' || obj.sourceType === 'group') &&
      typeof obj.sourceId === 'string' &&
      obj.sourceId.length > 0
    ) {
      return { sourceType: obj.sourceType, sourceId: obj.sourceId };
    }
    return null;
  } catch {
    return null;
  }
}

/** 原子取走暂存深链（take-once）；无桥/无值/坏数据返回 null */
export function takePendingDeepLink(): NotificationDeepLink | null {
  const bridge = getDeepLinkBridge();
  if (!bridge) { return null; }
  try {
    return parseDeepLinkJson(bridge.takePendingDeepLink());
  } catch (e) {
    console.warn('[DeepLink] 取走暂存深链失败:', e);
    return null;
  }
}

/** 清空原生暂存槽（登出/切账号；桌面端/桥不可用时 no-op） */
export function clearPendingDeepLink(): void {
  try {
    getDeepLinkBridge()?.clearPendingDeepLink();
  } catch {
    // 桥不存在（桌面端）或 WebView 环境异常：静默忽略
  }
}

/**
 * 注册热启动 poke 回调（MainActivity onNewIntent → evaluateJavascript 调用）。
 * 只注册一次（模块加载/MobileMain 挂载时），handler 闭包经调用方 ref 取最新值。
 */
export function registerDeepLinkPoke(handler: () => void): void {
  if (typeof window === 'undefined') { return; }
  window.__huanvaeOnNotificationDeepLink = handler;
}
