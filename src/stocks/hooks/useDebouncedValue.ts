/**
 * 通用防抖值 Hook（股票搜索用，默认 220ms）
 *
 * 现有 SearchBox 只是受控输入外壳，不含防抖；此 hook 提供输入值的防抖版本，
 * 供搜索请求消费，避免每次按键都打后端。
 */

import { useEffect, useState } from 'react';

/**
 * 返回 value 的防抖版本：value 稳定 delay 毫秒后才更新。
 * @param value 源值
 * @param delay 防抖毫秒，默认 220
 */
export function useDebouncedValue<T>(value: T, delay = 220): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
