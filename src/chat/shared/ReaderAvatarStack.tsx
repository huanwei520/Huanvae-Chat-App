/**
 * 已读者头像堆叠
 *
 * @module chat/shared/ReaderAvatarStack
 * @location src/chat/shared/ReaderAvatarStack.tsx
 *
 * 横向重叠展示已读者头像（16px 圆形、-6px 重叠、1px 白边）。
 * 最多展示 maxVisible 个（默认 5），超出显示 "+N"。无头像用展示名首字母占位。
 *
 * 动画（GSAP，见 .claude/skills/gsap-react / gsap-core / gsap-performance）：
 * - 首次出现：所有头像 stagger 错峰淡入 + 微缩放（opacity 0→1 + scale 0.8→1）。
 * - 后续新读到的头像：单独滑入（x 位移 + scale + opacity 进场），既有头像不重播。
 *
 * 动画防冲突（单一所有权）：
 * - 仅 GSAP 控制 transform/opacity；这些 className 在 CSS 中无 transform/opacity 的 transition。
 * - 本组件不使用 framer-motion，避免同元素同属性双控。
 * - 所有 tween 用 overwrite:'auto'；useGSAP 单 scope 自动 revert，revertOnUpdate 防止 matchMedia 累积。
 * - prefers-reduced-motion 经 gsap.matchMedia() 兜底为瞬时无动。
 * - 已动画到位的头像用 seenIdsRef 记忆，避免无关 re-render 重播（仅真正新增的头像才进场）。
 */

import { useRef } from 'react';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import type { GroupReader } from '../group/useGroupReadReceipt';

gsap.registerPlugin(useGSAP);

interface ReaderAvatarStackProps {
  readers: GroupReader[];
  /** 最多展示的头像数，默认 5 */
  maxVisible?: number;
}

/** 取展示名首字母（占位头像用），供已读回执相关组件复用 */
export function avatarInitial(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : '?';
}

export function ReaderAvatarStack({ readers, maxVisible = 5 }: ReaderAvatarStackProps) {
  const stackRef = useRef<HTMLSpanElement>(null);
  /** 已完成进场动画的 userId 集合（区分"首次全员 stagger"与"后续单个新头像滑入"） */
  const seenIdsRef = useRef<Set<string>>(new Set());

  useGSAP(
    () => {
      const scope = stackRef.current;
      if (!scope) {
        return;
      }
      const items = gsap.utils.toArray<HTMLElement>(
        scope.querySelectorAll('.reader-avatar-stack-item'),
      );
      const moreEls = gsap.utils.toArray<HTMLElement>(
        scope.querySelectorAll('.reader-avatar-stack-more'),
      );
      if (items.length === 0) {
        return;
      }

      const firstRun = seenIdsRef.current.size === 0;
      const newItems = items.filter((el) => {
        const id = el.dataset.userId;
        return id !== undefined && !seenIdsRef.current.has(id);
      });
      items.forEach((el) => {
        if (el.dataset.userId !== undefined) {
          seenIdsRef.current.add(el.dataset.userId);
        }
      });

      const mm = gsap.matchMedia();

      mm.add('(prefers-reduced-motion: no-preference)', () => {
        if (firstRun) {
          gsap.from([...items, ...moreEls], {
            opacity: 0,
            scale: 0.8,
            duration: 0.3,
            ease: 'power2.out',
            stagger: 0.05,
            overwrite: 'auto',
            clearProps: 'opacity,scale',
          });
        } else if (newItems.length > 0) {
          gsap.from(newItems, {
            opacity: 0,
            scale: 0.8,
            x: 12,
            duration: 0.3,
            ease: 'power2.out',
            stagger: 0.05,
            overwrite: 'auto',
            clearProps: 'opacity,scale,x',
          });
        }
      });

      mm.add('(prefers-reduced-motion: reduce)', () => {
        gsap.set([...items, ...moreEls], { opacity: 1, scale: 1, x: 0, clearProps: 'opacity,scale,x' });
      });
    },
    { scope: stackRef, dependencies: [readers], revertOnUpdate: true },
  );

  if (readers.length === 0) {
    return null;
  }
  const visible = readers.slice(0, maxVisible);
  const overflow = readers.length - visible.length;

  return (
    <span className="reader-avatar-stack" ref={stackRef}>
      {visible.map((reader) => (
        <span
          key={reader.userId}
          className="reader-avatar-stack-item"
          data-user-id={reader.userId}
          title={reader.displayName}
        >
          {reader.avatarUrl ? (
            <img src={reader.avatarUrl} alt={reader.displayName} />
          ) : (
            <span className="reader-avatar-stack-placeholder">{avatarInitial(reader.displayName)}</span>
          )}
        </span>
      ))}
      {overflow > 0 && <span className="reader-avatar-stack-more">+{overflow}</span>}
    </span>
  );
}
