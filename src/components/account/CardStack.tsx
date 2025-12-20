/**
 * 卡片堆叠组件
 *
 * 管理多个 CardSlot 的位置和动画
 */

import { useMemo, useCallback } from 'react';
import { CardSlot } from './CardSlot';
import type { SavedAccount } from '../../types/account';

// ============================================
// 辅助函数
// ============================================

export function getLoopIndex(index: number, length: number): number {
  if (length === 0) { return 0; }
  return ((index % length) + length) % length;
}

// ============================================
// 组件
// ============================================

interface CardStackProps {
  accounts: SavedAccount[];
  mainIndex: number;
  positionOffset: number;
  resetCounter: number;
  onPrev: () => void;
  onNext: () => void;
}

export function CardStack({
  accounts,
  mainIndex,
  positionOffset,
  resetCounter,
  onPrev,
  onNext,
}: CardStackProps) {
  const accountCount = accounts.length;

  const slots = useMemo(() => {
    const result = [];
    for (let slotIdx = 0; slotIdx < 5; slotIdx++) {
      const basePosition = slotIdx;
      const actualPosition = basePosition + positionOffset;
      const accountOffset = slotIdx - 2;
      const accountIndex = getLoopIndex(mainIndex + accountOffset, accountCount);

      result.push({
        slotIdx,
        account: accounts[accountIndex],
        positionIndex: actualPosition,
      });
    }
    return result;
  }, [accounts, mainIndex, accountCount, positionOffset]);

  const getClickHandler = useCallback((posIndex: number) => {
    if (posIndex === 1) { return onPrev; }
    if (posIndex === 3) { return onNext; }
    return undefined;
  }, [onPrev, onNext]);

  return (
    <div className="stack-container">
      {slots.map((slot) => (
        <CardSlot
          key={`slot-${slot.slotIdx}-${resetCounter}`}
          account={slot.account}
          positionIndex={slot.positionIndex}
          onClick={getClickHandler(slot.positionIndex)}
        />
      ))}
    </div>
  );
}
