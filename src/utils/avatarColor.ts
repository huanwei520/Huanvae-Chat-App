/**
 * Default avatar placeholder helpers: initial glyph + fixed white/blue styling.
 *
 * Single source of truth for the "no avatar image" placeholder look across the App.
 * The placeholder is intentionally NOT per-user colored: every default avatar shares
 * the same white ground with a blue -> light-blue gradient initial.
 *
 * Pure, side-effect free. The styling constants reference design tokens
 * (--avatar-placeholder-* in src/styles/variables.css) so the look is tuned in one
 * place; those tokens are a fixed blue and do NOT follow the active theme (the
 * default avatar stays the same blue whatever theme color the user picks). The
 * exported strings stay easy to assert in tests.
 *
 * Note: this module only describes the "no avatar" placeholder look. It never resolves
 * or renders a server avatar URL. Avatar images still go through
 * resolveServerAvatarUrl / resolveDisplayUrl (private-CA hardening boundary).
 */

/**
 * White ground shared by every default avatar.
 * Design token: --avatar-placeholder-bg (src/styles/variables.css).
 */
export const AVATAR_PLACEHOLDER_BG = 'var(--avatar-placeholder-bg)';

/**
 * Faint ring so the pure-white placeholder stays visible on white surfaces
 * (cards, sheets). Design token: --avatar-placeholder-ring; tune it in one place.
 */
export const AVATAR_PLACEHOLDER_BORDER = '1px solid var(--avatar-placeholder-ring)';

/**
 * Gradient filling the initial glyph: a fixed blue -> light-blue, theme-independent
 * (design tokens --avatar-placeholder-initial-start/end, which are literal blue hex,
 * NOT var(--color-primary-*)). The default avatar stays the same blue whatever theme
 * color the user picks; the light end stays readable against the white ground.
 */
export const AVATAR_INITIAL_GRADIENT =
  'linear-gradient(135deg, var(--avatar-placeholder-initial-start) 0%, var(--avatar-placeholder-initial-end) 100%)';

/**
 * First character of the name (upper-cased) as the placeholder glyph; '?' when empty.
 *
 * Uses Array.from to take the first code point, so CJK / emoji / surrogate pairs are
 * handled correctly. Upper-casing an emoji or CJK char is a no-op.
 */
export function avatarInitial(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) {
    return '?';
  }
  const first = Array.from(trimmed)[0];
  return first ? first.toUpperCase() : '?';
}

const EMOJI_PATTERN = /\p{Extended_Pictographic}/u;

/**
 * Whether the given glyph is a pictographic emoji.
 *
 * Emoji must be excluded from `background-clip: text` gradient clipping: clipping an
 * emoji renders it as a flat/transparent silhouette. Emoji glyphs are drawn in their
 * own colors instead. Letters / CJK / digits / '?' are not emoji and get the gradient.
 */
export function isEmojiChar(char: string): boolean {
  return EMOJI_PATTERN.test(char);
}
