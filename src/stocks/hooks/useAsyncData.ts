/**
 * 通用异步数据 Hook — 每个面板独立 loading / error / data
 *
 * 配合 ListStates（ListLoading / ListError / ListEmpty）实现「逐面板独立状态」。
 * 卸载后不 setState（避免竞态 / stale warning）。
 *
 * 可选 retry：需求驱动端点（个股详情的 K 线 / 情报 / 财报）首次打开时后端快照可能尚未生成
 * （返回「快照不存在」），盘口轮询注册需求后数秒内才填充。给这类 loader 配 retry 让首屏
 * loading 吸收这段填充延迟（PLAN D1「前端 loading 吸收」），而不是一次失败就永久锁在 error 态。
 * 重试期间保持 loading=true；重试耗尽后才落 error。总览类始终可用端点不配 retry。
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface AsyncRetryOpts {
  /** 最多尝试次数（含首次）。<=1 等于不重试 */
  attempts: number;
  /** 每次重试间隔（ms） */
  delayMs: number;
}

export interface AsyncDataState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  /** 手动重新加载 */
  reload: () => void;
}

/**
 * @param loader 拉取函数（内部已绑定 api / 参数）
 * @param deps 依赖数组：变化时自动重拉
 * @param retry 可选重试策略（需求驱动端点用；省略=失败即落 error）
 */
export function useAsyncData<T>(
  loader: () => Promise<T>,
  deps: React.DependencyList,
  retry?: AsyncRetryOpts,
): AsyncDataState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  // retry 配置放 ref，避免把对象字面量塞进 effect deps（否则每次 render 都重跑）
  const retryRef = useRef(retry);
  retryRef.current = retry;

  useEffect(() => {
    // 每次运行独立 cancelled 标记：既处理卸载，也让旧请求被新一轮（依赖变化/reload）作废，
    // 避免乱序 resolve 覆盖（如日/周 K 快速切换时旧响应后到）。
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const attempts = Math.max(1, retryRef.current?.attempts ?? 1);
    const delayMs = retryRef.current?.delayMs ?? 0;

    setLoading(true);
    setError(null);

    const run = (attempt: number): void => {
      loader()
        .then((result) => {
          if (!cancelled) {
            setData(result);
            setError(null);
            setLoading(false);
          }
        })
        .catch((e: unknown) => {
          if (cancelled) { return; }
          if (attempt < attempts) {
            // 还有重试机会：保持 loading，延迟后再拉（吸收后端快照填充延迟）
            timer = setTimeout(() => {
              if (!cancelled) { run(attempt + 1); }
            }, delayMs);
          } else {
            setError(e instanceof Error ? e.message : String(e));
            setLoading(false);
          }
        });
    };

    run(1);

    return () => {
      cancelled = true;
      if (timer) { clearTimeout(timer); }
    };
    // loader 由调用方用 useCallback 稳定；deps 显式声明拉取依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, reloadTick]);

  const reload = useCallback(() => setReloadTick((t) => t + 1), []);

  return { data, loading, error, reload };
}
