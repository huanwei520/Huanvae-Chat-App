/**
 * 股票搜索框（总览视图顶部）
 *
 * 受控输入 + 220ms 防抖（useDebouncedValue）+ 结果下拉。
 * 键盘导航（ARIA combobox 模式）：
 *   - 焦点在输入框即可直接操作，无需先 Tab 到列表；
 *   - ↑/↓ 移动高亮（夹紧不循环，见 searchNav.moveActiveIndex），高亮项滚入可视区；
 *   - Enter 打开当前高亮项；Esc 关闭下拉、焦点留输入框（并 stopPropagation 避免上层 Esc 误触发）；
 *   - 高亮项 box-shadow/background 反馈（非 transform/opacity，无 GSAP 抢帧），并同步 aria-activedescendant。
 *
 * 语义：input role="combobox" + aria-controls/expanded/activedescendant；ul role="listbox"；li role="option"。
 * 用原生 input（非通用 SearchBox 外壳）以便完整挂载 combobox ARIA 与 onKeyDown；沿用 .search-box-wrapper 视觉。
 */

import { useEffect, useRef, useState } from 'react';
import { SearchIcon } from '../../components/common/Icons';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { searchStocks, type StockSearchItem } from '../../api/stocks';
import type { ApiClient } from '../../api/client';
import { SEARCH_LISTBOX_ID, searchOptionId, moveActiveIndex } from './searchNav';

interface StockSearchBoxProps {
  api: ApiClient;
  onSelect: (item: StockSearchItem) => void;
}

export function StockSearchBox({ api, onSelect }: StockSearchBoxProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<StockSearchItem[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const debounced = useDebouncedValue(query, 220);
  const reqRef = useRef(0);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const q = debounced.trim();
    if (q.length === 0) {
      setResults([]);
      setOpen(false);
      setActiveIndex(-1);
      return;
    }
    const reqId = ++reqRef.current;
    searchStocks(api, q)
      .then((res) => {
        // 仅采纳最新一次请求（防竞态）
        if (reqId === reqRef.current) {
          setResults(res.results);
          setOpen(true);
          setActiveIndex(-1);
        }
      })
      .catch(() => {
        if (reqId === reqRef.current) {
          setResults([]);
          setOpen(false);
          setActiveIndex(-1);
        }
      });
  }, [debounced, api]);

  const handleSelect = (item: StockSearchItem) => {
    onSelect(item);
    setQuery('');
    setResults([]);
    setOpen(false);
    setActiveIndex(-1);
  };

  // 把第 index 个结果滚入下拉可视区（手动 scrollTop，避免 scrollIntoView 沿祖先链冒泡）
  const scrollOptionIntoView = (index: number) => {
    const ul = listRef.current;
    if (!ul) { return; }
    const el = ul.children[index] as HTMLElement | undefined;
    if (!el) { return; }
    const cRect = ul.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();
    if (eRect.top < cRect.top) {
      ul.scrollTop += eRect.top - cRect.top;
    } else if (eRect.bottom > cRect.bottom) {
      ul.scrollTop += eRect.bottom - cRect.bottom;
    }
  };

  const move = (delta: number) => {
    if (results.length === 0) { return; }
    if (!open) { setOpen(true); }
    const next = moveActiveIndex(activeIndex, results.length, delta);
    setActiveIndex(next);
    scrollOptionIntoView(next);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        move(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        move(-1);
        break;
      case 'Enter':
        if (open && activeIndex >= 0 && activeIndex < results.length) {
          e.preventDefault();
          handleSelect(results[activeIndex]);
        }
        break;
      case 'Escape':
        if (open) {
          // 只关下拉、焦点留输入框；阻止冒泡避免上层（详情视图）Esc 误触发返回
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
          setActiveIndex(-1);
        }
        break;
      default:
        break;
    }
  };

  const listboxOpen = open && results.length > 0;

  return (
    <div className="stock-search">
      <div className="search-box-wrapper">
        <SearchIcon />
        <input
          type="text"
          role="combobox"
          aria-expanded={listboxOpen}
          aria-controls={SEARCH_LISTBOX_ID}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 ? searchOptionId(activeIndex) : undefined}
          aria-label="搜索股票 / ETF"
          placeholder="搜索股票 / ETF"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
      </div>
      {listboxOpen && (
        <ul ref={listRef} id={SEARCH_LISTBOX_ID} role="listbox" className="stock-search-results">
          {results.map((item, i) => (
            <li
              key={`${item.market}:${item.symbol}`}
              id={searchOptionId(i)}
              role="option"
              aria-selected={i === activeIndex}
              className={`stock-search-item${i === activeIndex ? ' stock-search-item--active' : ''}`}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => handleSelect(item)}
            >
              <span className="stock-search-name">{item.display}</span>
              <span className="stock-search-symbol">{item.symbol}</span>
              <span className="stock-search-market">{item.market.toUpperCase()}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
