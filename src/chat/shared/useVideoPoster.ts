/**
 * 视频封面解析 Hook —— `<VideoThumbnail>` 的内部状态机
 *
 * @location src/chat/shared/useVideoPoster.ts
 *
 * ## 三态，以及为什么 pending 什么都不渲染
 *
 * - `pending`：正在问 Rust「这个视频有没有存过封面」。**调用方此时不要渲染 `<video>`** ——
 *   否则一屏几十个格子会各自开一次元数据拉取，恰好是本功能要消灭的成本；而且拿到封面后
 *   还要再换成 `<img>`，用户看到的就是「先黑再显示」原样复发。这一步是本地 IPC + SQLite +
 *   一次 `stat`，毫秒级。
 * - `poster`：本地已有封面 ⇒ 渲染 `<img src=posterSrc>`，**不建 `<video>` 元素**。
 *   这才是「杀掉 App 重开、封面立刻出现」的实现。
 * - `capture`：本地没有 ⇒ 照旧渲染 `<video>`（用户马上有画面），同时在**离屏**元素上截一帧
 *   落盘；落盘成功后本 Hook 自动切到 `poster`，下次挂载起就走本地。
 *
 * ## 没有 posterKey 时同步退化成 `capture`
 *
 * 封面的键是**文件身份键**（消息面 = `file_uuid`，个人文件面 = 服务端下发的 `file_hash`；
 * 2026-08-16 两层键起，理由见 services/videoPoster.ts 模块头）。调用方拿不到它时
 * （历史脏数据，或还没接线的消费点）本 Hook **同步**给出 `capture` —— 行为与本功能落地前
 * 逐字节相同，不会多一帧空白。
 */

import { useEffect, useState } from 'react';
import { captureAndSaveVideoPoster, loadVideoPosterSrc } from '../../services/videoPoster';

export type VideoPosterStatus = 'pending' | 'poster' | 'capture';

export interface VideoPosterState {
  status: VideoPosterStatus;
  /** 仅 status === 'poster' 时有值 */
  posterSrc: string | null;
}

/** 无 posterKey ⇒ 没有键可查，直接进 capture（= 落地前的行为） */
function initialState(posterKey: string | null | undefined): VideoPosterState {
  return posterKey
    ? { status: 'pending', posterSrc: null }
    : { status: 'capture', posterSrc: null };
}

/**
 * @param posterKey 视频的稳定身份（封面的键）；缺失时本 Hook 恒为 `capture`
 * @param src      已经过取源收口点解析的**裸**可显示视频 src（截帧用）
 */
export function useVideoPoster(
  posterKey: string | null | undefined,
  src: string,
): VideoPosterState {
  const [state, setState] = useState<VideoPosterState>(() => initialState(posterKey));

  // posterKey 变了（列表项复用同一个组件实例）要重新解析，否则会把上一条视频的封面留在屏上
  useEffect(() => {
    setState(initialState(posterKey));
  }, [posterKey]);

  // 第一步：问本地有没有存过
  useEffect(() => {
    if (!posterKey) {
      return undefined;
    }
    let cancelled = false;
    loadVideoPosterSrc(posterKey).then((posterSrc) => {
      if (cancelled) {
        return;
      }
      setState(posterSrc ? { status: 'poster', posterSrc } : { status: 'capture', posterSrc: null });
    });
    return () => {
      cancelled = true;
    };
  }, [posterKey]);

  // 第二步：本地没有就截一帧存下来（截好后本组件立刻切到 <img>，无需等下次挂载）
  useEffect(() => {
    if (state.status !== 'capture' || !posterKey || !src) {
      return undefined;
    }
    let cancelled = false;
    captureAndSaveVideoPoster(posterKey, src).then((posterSrc) => {
      if (!cancelled && posterSrc) {
        setState({ status: 'poster', posterSrc });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [state.status, posterKey, src]);

  return state;
}
