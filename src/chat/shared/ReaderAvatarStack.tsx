/**
 * 已读者头像堆叠
 *
 * @module chat/shared/ReaderAvatarStack
 * @location src/chat/shared/ReaderAvatarStack.tsx
 *
 * 横向重叠展示已读者头像（16px 圆形、-6px 重叠、1px 白边）。
 * 最多展示 maxVisible 个（默认 5），超出显示 "+N"。无头像用展示名首字母占位。
 */

import type { GroupReader } from '../group/useGroupReadReceipt';

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
  if (readers.length === 0) {
    return null;
  }
  const visible = readers.slice(0, maxVisible);
  const overflow = readers.length - visible.length;

  return (
    <span className="reader-avatar-stack">
      {visible.map((reader) => (
        <span key={reader.userId} className="reader-avatar-stack-item" title={reader.displayName}>
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
