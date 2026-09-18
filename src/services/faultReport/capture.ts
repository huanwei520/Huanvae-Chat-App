/**
 * 故障采集 —— 前端面（console 劫持 / 未捕获异常 / 网络错误摘要）
 *
 * 【只新增通道】劫持均为"记录后原样转发"，不改变既有行为语义；
 * 网络错误摘要只记 URL + 状态码，**不记任何请求头/请求体/响应体**。
 *
 * 【聊天正文零采集】本模块只挂接 console / window 错误事件 / 全局 fetch 失败摘要，
 * 不读取消息数据库、不挂接任何消息渲染或存储层 —— 聊天正文物理上进不了采集面。
 *
 * @module services/faultReport/capture
 */

import { sanitizeUrlForFaultLog, stringifyAndSanitize } from './sanitizer';
import { faultReportInstance } from './instance';

interface ConsoleLike {
  (message?: unknown, ...optionalParams: unknown[]): void;
}

interface Installed {
  originalConsole: Partial<Record<'debug' | 'info' | 'log' | 'warn' | 'error', ConsoleLike>>;
  originalOnError: typeof window.onerror;
  originalFetch: typeof fetch | null;
  onErrorMessage: typeof window.onerror;
  onUnhandledRejection: (event: PromiseRejectionEvent) => void;
}

let installed: Installed | null = null;

function recordConsole(level: string, args: unknown[]): void {
  faultReportInstance.pushEntry({
    at: Date.now(),
    source: 'console',
    level,
    text: args.map((a) => stringifyAndSanitize(a)).join(' '),
  });
}

/**
 * 安装全局采集（幂等；重复调用返回已有卸载器）。
 * 必须在应用入口尽早调用（main.tsx 之后任意时点皆可，越早窗口越完整）。
 */
export function installFaultCapture(): () => void {
  if (installed) {
    return () => installed && uninstallFaultCapture(installed);
  }

  const consoleRef = console as unknown as Record<string, undefined | ((...args: unknown[]) => void)>;
  const originalConsole: Installed['originalConsole'] = {};
  for (const level of ['debug', 'info', 'log', 'warn', 'error'] as const) {
    const original = consoleRef[level];
    if (!original) {
      continue;
    }
    originalConsole[level] = original;
    consoleRef[level] = (...args: unknown[]) => {
      try {
        recordConsole(level, args);
      } catch {
        // 采集自身异常绝不影响原行为
      }
      original.apply(console, args);
    };
  }

  const originalOnError = window.onerror;
  const onErrorMessage: typeof window.onerror = (message, source, lineno, colno, error) => {
    try {
      const where = source ? ` @${String(source)}:${lineno}:${colno}` : '';
      faultReportInstance.pushEntry({
        at: Date.now(),
        source: 'exception',
        level: 'error',
        text: stringifyAndSanitize(error ?? `${message}${where}`),
      });
    } catch {
      // 同上
    }
    if (originalOnError) {
      return originalOnError.call(window, message, source, lineno, colno, error);
    }
    return false;
  };
  window.onerror = onErrorMessage;

  const onUnhandledRejection = (event: PromiseRejectionEvent): void => {
    try {
      faultReportInstance.pushEntry({
        at: Date.now(),
        source: 'exception',
        level: 'error',
        text: `unhandledrejection: ${stringifyAndSanitize(event.reason)}`,
      });
    } catch {
      // 同上
    }
  };
  window.addEventListener('unhandledrejection', onUnhandledRejection);

  // 全局 fetch 透传包装：仅统计失败（>=400 或网络异常），只记 URL+状态码
  const originalFetch = window.fetch.bind(window);
  function requestUrlOf(input: Parameters<typeof fetch>[0]): string {
    if (typeof input === 'string') {
      return input;
    }
    if (input instanceof URL) {
      return input.href;
    }
    return input.url;
  }
  const wrappedFetch: typeof fetch = async (input, init) => {
    // 写入前脱敏（硬红线）：query 值/hash 一律剥除，防止 token 类敏感值随失败 URL 入缓冲
    const url = sanitizeUrlForFaultLog(requestUrlOf(input));
    try {
      const response = await originalFetch(input, init);
      if (response.status >= 400) {
        faultReportInstance.recordNetworkError({ at: Date.now(), url, status: response.status });
      }
      return response;
    } catch (err) {
      // 网络层异常（DNS/连接/中断）：status 记 0，同样只记 URL
      faultReportInstance.pushEntry({
        at: Date.now(),
        source: 'network',
        level: 'error',
        text: `网络请求失败(网络异常) url=${url} status=0 err=${stringifyAndSanitize(err)}`,
      });
      faultReportInstance.recordNetworkError({ at: Date.now(), url, status: 0 });
      throw err;
    }
  };
  window.fetch = wrappedFetch;

  installed = {
    originalConsole,
    originalOnError,
    originalFetch,
    onErrorMessage,
    onUnhandledRejection,
  };

  return () => installed && uninstallFaultCapture(installed);
}

function uninstallFaultCapture(target: Installed): void {
  const consoleRef = console as unknown as Record<string, unknown>;
  for (const level of ['debug', 'info', 'log', 'warn', 'error'] as const) {
    const original = target.originalConsole[level];
    if (original) {
      consoleRef[level] = original;
    }
  }
  window.onerror = target.originalOnError;
  window.removeEventListener('unhandledrejection', target.onUnhandledRejection);
  if (target.originalFetch) {
    window.fetch = target.originalFetch;
  }
  installed = null;
}

/** 测试用：当前是否已安装 */
export function isFaultCaptureInstalled(): boolean {
  return installed !== null;
}
