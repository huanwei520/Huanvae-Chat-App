/**
 * NFC 指令执行器：根据 NfcAction.kind 派发到对应副作用
 *
 * 接口设计：
 * - 不直接依赖 MiniApp 类型 / SessionContext / store，所有副作用通过 ExecuteContext 传入
 * - 调用方（useNfcGlobalScan via MobileMain）负责绑定真实数据源
 * - 纯 dispatch 函数 + 显式依赖 → 易于单元测试
 */

import type { MiniApp } from '../api/miniapps';
import type { GroupJoinSource } from '../api/groups';
import type { NfcAction } from './types';

export interface ExecuteContext {
  /** 触发移动端 iframe 启动小程序（MobileMain 提供 setMiniAppLaunching） */
  setMiniAppLaunching: (app: MiniApp) => void;
  /** 按 id 查找小程序（找不到返 null） */
  getMiniAppById: (id: string) => Promise<MiniApp | null>;
  /**
   * 打开群详情面板（扫码加群落地）。
   *
   * 🔴 `source` 由**调用方**（本文件）固定传 `'qr'`，不让上层自己填 —— 走到这条派发臂
   * 就说明载体是「群二维码里那串 payload」，服务端要据此查 `allow_join_via_qr`。
   * 让上层填等于把"这次到底算哪条来源"交给一个离现场更远的地方决定。
   */
  openGroupDetail: (groupId: string, source: GroupJoinSource) => void;
  /** http 请求执行器（默认走 plugin-http；测试可注入 mock） */
  httpFetch?: (
    url: string,
    init: { method: string; headers?: Record<string, string>; body?: string },
  ) => Promise<Response>;
}

/** 按 action.kind 派发执行；失败抛错由调用方 catch 显示 */
export async function dispatch(action: NfcAction, ctx: ExecuteContext): Promise<void> {
  if (action.kind === 'miniapp/open') {
    const app = await ctx.getMiniAppById(action.miniappId);
    if (!app) {
      throw new Error(`小程序未找到: ${action.miniappId}`);
    }
    ctx.setMiniAppLaunching(app);
    return;
  }

  if (action.kind === 'group/join') {
    // 只打开详情面板，**不在这里加任何群** —— 加不加由用户在面板上再点一次。
    // 直接 apply 会让"贴一下卡/扫一下码"变成一次不可撤销的入群动作。
    ctx.openGroupDetail(action.groupId, 'qr');
    return;
  }

  if (action.kind === 'http/request') {
    const fetchFn =
      ctx.httpFetch ??
      (async (url, init) => {
        const { fetch } = await import('@tauri-apps/plugin-http');
        return fetch(url, init);
      });
    const init: { method: string; headers?: Record<string, string>; body?: string } = {
      method: action.method,
    };
    if (action.body !== null) {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(action.body);
    }
    const response = await fetchFn(action.url, init);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return;
  }

  // 穷尽性检查 — 编译期保证所有 kind 都被处理
  const _exhaustive: never = action;
  throw new Error(`未知指令类型: ${JSON.stringify(_exhaustive)}`);
}
