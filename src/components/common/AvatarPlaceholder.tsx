/**
 * Unified default-avatar placeholder.
 *
 * The standard "no avatar image" look: a white circle with a faint ring and the name's
 * first character filled with a fixed blue gradient (design tokens --avatar-placeholder-*
 * in variables.css — literal blue hex, theme-independent). Uniform for everyone
 * (personal / friend / group / any placeholder) — no per-user color, no theme tint.
 *
 * Usage: drop it inside a parent that already sets size + border-radius + overflow:hidden;
 * it fills the parent and inherits the parent's border-radius. Each call site passes the
 * fontSize appropriate for its avatar size.
 *
 * Note: this component only draws the placeholder — it never accepts or resolves a server
 * avatar URL. When an avatar image exists the caller renders <img src={resolved URL}>
 * directly; this component is the fallback for the no-image case (the private-CA hardening
 * boundary is the caller's resolve step, not here).
 */

import type { CSSProperties } from 'react';
import {
  avatarInitial,
  isEmojiChar,
  AVATAR_PLACEHOLDER_BG,
  AVATAR_PLACEHOLDER_BORDER,
  AVATAR_INITIAL_GRADIENT,
} from '../../utils/avatarColor';

interface AvatarPlaceholderProps {
  /** Name used to derive the first-character glyph (nickname / remark / group name / account). */
  name: string | null | undefined;
  /** Font size; inherits the parent font-size when omitted. Pass per avatar size (e.g. 18 / 28 / 'calc(...)'). */
  fontSize?: string | number;
  /** Extra class name. */
  className?: string;
  /** Extra inline style (overrides defaults). */
  style?: CSSProperties;
}

export function AvatarPlaceholder({ name, fontSize, className, style }: AvatarPlaceholderProps) {
  const initial = avatarInitial(name);
  const isEmoji = isEmojiChar(initial);

  // White ring container. background-clip:text on the glyph would clip ALL backgrounds,
  // so the white ground + gradient text must live on two separate elements.
  const containerStyle: CSSProperties = {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 'inherit',
    boxSizing: 'border-box',
    backgroundColor: AVATAR_PLACEHOLDER_BG,
    border: AVATAR_PLACEHOLDER_BORDER,
    fontWeight: 600,
    lineHeight: 1,
    userSelect: 'none',
    ...(fontSize !== undefined ? { fontSize } : null),
    ...style,
  };

  // Emoji glyphs render in their own colors (no clipping). Letters / CJK / digits / '?'
  // get the fixed blue gradient clipped to the glyph.
  const glyphStyle: CSSProperties = isEmoji
    ? {}
    : {
      backgroundImage: AVATAR_INITIAL_GRADIENT,
      WebkitBackgroundClip: 'text',
      backgroundClip: 'text',
      WebkitTextFillColor: 'transparent',
      color: 'transparent',
    };

  return (
    <div
      className={className ? `avatar-placeholder-unified ${className}` : 'avatar-placeholder-unified'}
      aria-hidden="true"
      style={containerStyle}
    >
      <span style={glyphStyle}>{initial}</span>
    </div>
  );
}

export default AvatarPlaceholder;
