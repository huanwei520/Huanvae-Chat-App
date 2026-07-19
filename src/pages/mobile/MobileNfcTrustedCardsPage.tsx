/**
 * 移动端"已信任的 NFC 卡"列表页
 *
 * 列出 trustStore.listTrusted 的所有记录，每条显示 summary + UID 短码 + 创建时间 +
 * 移除按钮。移除后立刻刷新列表。
 *
 * 动效（framer-motion 接管 transform/opacity，CSS 不得过渡这两个属性，
 * 见 tests/animation-conflict.test.ts 注册表）：
 * - 行入场 stagger（opacity + y）；移除时 AnimatePresence exit 左滑淡出
 * - 移除按钮的按压反馈由 AppButton 自带的 CSS :active（transform 归 CSS 所有）
 *   承担，不加 whileTap——避免 transform 双主人（规则一）
 */

import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { trustStore } from '../../nfc/trustStore';
import { AppButton } from '../../components/common/AppButton';
import type { TrustedNfcCard } from '../../nfc/types';

// 列表容器只做 stagger 编排；行 opacity+y 进场、exit 左滑淡出
const listVariants = {
  initial: {},
  animate: { transition: { staggerChildren: 0.03, delayChildren: 0.05 } },
};

const rowVariants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, x: -40, transition: { duration: 0.15 } },
};

const BackIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    width="24"
    height="24"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
  </svg>
);

function formatCreatedAt(ms: number): string {
  const d = new Date(ms);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

interface MobileNfcTrustedCardsPageProps {
  onBack: () => void;
}

export function MobileNfcTrustedCardsPage({ onBack }: MobileNfcTrustedCardsPageProps) {
  const [cards, setCards] = useState<TrustedNfcCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await trustStore.listTrusted();
      setCards(list);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleRemove = useCallback(
    async (uid: string, payloadHash: string) => {
      try {
        await trustStore.removeTrusted(uid, payloadHash);
        await load();
      } catch (e) {
        setError(String((e as Error).message ?? e));
      }
    },
    [load],
  );

  return (
    <div className="mobile-nfc-page">
      <div className="mobile-nfc-header">
        <button className="mobile-nfc-back" onClick={onBack} aria-label="返回">
          <BackIcon />
        </button>
        <div className="mobile-nfc-title">已信任的 NFC 卡</div>
        <div className="mobile-nfc-header-spacer" />
      </div>
      <div className="mobile-nfc-body">
        {loading && <div className="mobile-nfc-trusted-empty">加载中…</div>}
        {!loading && error && <div className="mobile-nfc-trusted-empty">加载失败: {error}</div>}
        {!loading && !error && cards.length === 0 && (
          <div className="mobile-nfc-trusted-empty">
            <div>暂无已信任的 NFC 卡</div>
            <div style={{ fontSize: 13 }}>扫卡并确认信任后会出现在此处</div>
          </div>
        )}
        {!loading && !error && cards.length > 0 && (
          <motion.ul
            className="mobile-nfc-trusted-list"
            variants={listVariants}
            initial="initial"
            animate="animate"
          >
            <AnimatePresence>
              {cards.map((c) => (
                <motion.li
                  key={`${c.uid}-${c.payload_hash}`}
                  className="mobile-nfc-trusted-item"
                  variants={rowVariants}
                  exit="exit"
                >
                  <div className="mobile-nfc-trusted-summary">{c.action_summary}</div>
                  <div className="mobile-nfc-trusted-meta">
                    UID: {c.uid.slice(0, 12)}…
                    <br />
                    payload: {c.payload_hash.slice(0, 16)}…
                    <br />
                    添加于: {formatCreatedAt(c.created_at)}
                  </div>
                  <div className="mobile-nfc-trusted-actions">
                    <AppButton
                      variant="danger"
                      size="sm"
                      onClick={() => handleRemove(c.uid, c.payload_hash)}
                    >
                      移除
                    </AppButton>
                  </div>
                </motion.li>
              ))}
            </AnimatePresence>
          </motion.ul>
        )}
      </div>
    </div>
  );
}
