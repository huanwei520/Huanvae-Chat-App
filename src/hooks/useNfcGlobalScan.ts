/**
 * 全局 NFC 监听 hook
 *
 * 设计原则：
 * 1. App 启动即在 MobileMain 顶层 mount，触发 scan loop（仅 Android）
 * 2. plugin 内部 onPause/onResume 自动处理后台切换，JS 无需介入
 * 3. modal 显示中 loop 挂起（队列单深度，避免 modal stack）— 用 Promise resolver 同步
 * 4. NFC 关闭/不可用 → break loop；其他错误 → 短 sleep 后继续
 * 5. cleanup 用 ignoredRef，旧 Promise 不更新新 hook state
 * 6. 桌面端 platform 守卫直接 return，零开销
 */

/* eslint-disable no-await-in-loop */
// scan loop 设计本质就是 await + 循环（每轮等一次贴卡 resolve），no-await-in-loop 不适用

import { useCallback, useEffect, useRef, useState } from 'react';
import { platform } from '@tauri-apps/plugin-os';
import {
  bytesToHex,
  computePayloadHash,
  decodeNdefUriPayload,
  parseAction,
  summarizeAction,
} from '../nfc/parser';
import { trustStore } from '../nfc/trustStore';
import { dispatch } from '../nfc/executor';
import type { NfcScanResult } from '../nfc/types';
import type { MiniApp } from '../api/miniapps';
import { useGroupDetailStore } from '../stores';
import type { GroupJoinSource } from '../api/groups';

export interface NfcFeedback {
  variant: 'success' | 'error';
  message: string;
  /** 自增 key — 让连续相同 toast 也触发 AnimatePresence 重 mount */
  key: number;
}

export interface UseNfcGlobalScanOptions {
  setMiniAppLaunching: (app: MiniApp) => void;
  getMiniAppById: (id: string) => Promise<MiniApp | null>;
}

export interface UseNfcGlobalScanResult {
  /** 当前等待确认的扫卡结果（陌生卡时非 null）*/
  pendingConfirm: NfcScanResult | null;
  /** 当前 toast 反馈（success/error），null = 无 toast */
  feedback: NfcFeedback | null;
  /** modal 确认按钮回调 */
  onConfirmTrust: () => void;
  /** modal 取消按钮回调 */
  onCancelTrust: () => void;
  /** toast 关闭回调（点击或自动 dismiss）*/
  onDismissFeedback: () => void;
}

export function useNfcGlobalScan(opts: UseNfcGlobalScanOptions): UseNfcGlobalScanResult {
  const [pendingConfirm, setPendingConfirm] = useState<NfcScanResult | null>(null);
  const [feedback, setFeedback] = useState<NfcFeedback | null>(null);
  const feedbackKeyRef = useRef(0);

  // ref 持有最新 callback，避免 useEffect 闭包过期持有旧 props
  const setMiniAppLaunchingRef = useRef(opts.setMiniAppLaunching);
  const getMiniAppByIdRef = useRef(opts.getMiniAppById);
  setMiniAppLaunchingRef.current = opts.setMiniAppLaunching;
  getMiniAppByIdRef.current = opts.getMiniAppById;

  /**
   * 扫码加群落地：直接读全局 store，**不经 props 往上要**。
   *
   * 群详情面板本来就是顶层挂载 + store 驱动的（`GroupDetailView` 订阅 `groupDetailStore`），
   * 让它经 `UseNfcGlobalScanOptions` 一层层传下来只会多两个必须同步维护的接线点，
   * 而这个 hook 的调用方（MobileMain）对"贴卡落到哪个群"这件事没有任何决定权。
   * 用 `getState()` 而不是 `useGroupDetailStore(s => s.open)`：本函数在 scan loop 的
   * 闭包里被调用，订阅式读会把它绑到某一次 render 的快照上。
   */
  const openGroupDetail = (groupId: string, source: GroupJoinSource) => {
    useGroupDetailStore.getState().open(groupId, source);
  };

  // modal 单深度同步：loop 在 modal 显示时 await，等用户操作后续 loop
  const modalResolverRef = useRef<(() => void) | null>(null);

  // 当前等待用户确认的 result（onConfirm/onCancel 用，跨 setPendingConfirm 的异步边界）
  const pendingResultRef = useRef<NfcScanResult | null>(null);

  const ignoredRef = useRef(false);

  const showFeedback = useCallback((variant: NfcFeedback['variant'], message: string) => {
    feedbackKeyRef.current += 1;
    setFeedback({ variant, message, key: feedbackKeyRef.current });
  }, []);

  const onDismissFeedback = useCallback(() => {
    setFeedback(null);
  }, []);

  const onConfirmTrust = useCallback(() => {
    const result = pendingResultRef.current;
    pendingResultRef.current = null;
    setPendingConfirm(null);
    if (!result) {
      modalResolverRef.current?.();
      modalResolverRef.current = null;
      return;
    }
    (async () => {
      const summary = summarizeAction(result.action);
      try {
        await trustStore.addTrusted(result.uid, result.payloadHash, summary);
      } catch (e) {
        showFeedback('error', `保存信任记录失败: ${String((e as Error)?.message ?? e)}`);
        modalResolverRef.current?.();
        modalResolverRef.current = null;
        return;
      }
      try {
        await dispatch(result.action, {
          setMiniAppLaunching: setMiniAppLaunchingRef.current,
          getMiniAppById: getMiniAppByIdRef.current,
          openGroupDetail: openGroupDetail,
        });
        showFeedback('success', `已执行: ${summary}`);
      } catch (e) {
        showFeedback('error', `执行失败: ${String((e as Error)?.message ?? e)}`);
      }
      modalResolverRef.current?.();
      modalResolverRef.current = null;
    })();
  }, [showFeedback]);

  const onCancelTrust = useCallback(() => {
    pendingResultRef.current = null;
    setPendingConfirm(null);
    modalResolverRef.current?.();
    modalResolverRef.current = null;
  }, []);

  useEffect(() => {
    ignoredRef.current = false;

    // 仅 Android 启动 loop（桌面端 / iOS / Web 直接 return）
    let platformName: string;
    try {
      platformName = platform();
    } catch {
      return;
    }
    if (platformName !== 'android') { return; }

    (async () => {
      let scan: typeof import('@tauri-apps/plugin-nfc').scan;
      try {
        const mod = await import('@tauri-apps/plugin-nfc');
        scan = mod.scan;
      } catch {
        return; // plugin 不可用（非移动构建），静默
      }

      while (!ignoredRef.current) {
        try {
          // 不传第二参 ScanOptions，keepSessionAlive 默认 false（loop 模式必须 false）
          const tag = await scan({ type: 'tag' });
          if (ignoredRef.current) { return; }

          // 找 URI Record（TNF=1, type=0x55）
          const uriRec = tag.records.find((r) => r.tnf === 1 && r.kind[0] === 0x55);
          if (!uriRec) { continue; } // 静默：非 URI 卡（公交卡 / 银行卡等）

          const uri = decodeNdefUriPayload(uriRec.payload);
          const action = parseAction(uri);
          if (!action) { continue; } // 静默：非 huanvae:// 或不支持的指令

          const payloadHash = await computePayloadHash(uriRec.payload);
          if (ignoredRef.current) { return; }
          const uid = bytesToHex(tag.id);
          const result: NfcScanResult = { uid, rawUri: uri, payloadHash, action };
          const summary = summarizeAction(action);

          const trusted = await trustStore.isTrusted(uid, payloadHash);
          if (ignoredRef.current) { return; }

          if (trusted) {
            try {
              await dispatch(result.action, {
                setMiniAppLaunching: setMiniAppLaunchingRef.current,
                getMiniAppById: getMiniAppByIdRef.current,
                openGroupDetail: openGroupDetail,
              });
              showFeedback('success', `已执行: ${summary}`);
            } catch (e) {
              showFeedback('error', `执行失败: ${String((e as Error)?.message ?? e)}`);
            }
          } else {
            // 陌生卡：弹 modal，loop 挂起等用户操作
            pendingResultRef.current = result;
            setPendingConfirm(result);
            await new Promise<void>((resolve) => {
              modalResolverRef.current = resolve;
            });
            if (ignoredRef.current) { return; }
          }
        } catch (e) {
          if (ignoredRef.current) { return; }
          const msg = String((e as Error)?.message ?? e);
          // NFC 不可用 → break loop（用户开启 NFC 后需重启 App）
          if (/NFC (unavailable|is disabled)/i.test(msg)) {
            showFeedback('error', `NFC 不可用: ${msg}`);
            return;
          }
          // 其他错误 → 短 sleep 再继续，避免 hot loop
          showFeedback('error', `扫卡失败: ${msg}`);
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 1000);
          });
        }
      }
    })();

    return () => {
      ignoredRef.current = true;
      modalResolverRef.current = null;
    };
    // showFeedback 来自 useCallback 稳定引用，不会触发重 mount
  }, [showFeedback]);

  return {
    pendingConfirm,
    feedback,
    onConfirmTrust,
    onCancelTrust,
    onDismissFeedback,
  };
}
