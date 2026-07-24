import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * Regression guard for the 顶置架 (pinned-shelf) card truncation fix (req-18).
 *
 * vitest runs in jsdom with no layout engine, so it CANNOT observe CSS clipping /
 * wrapping visually — real-machine visual verification is separate. This test instead
 * asserts the two source-level CSS invariants that make card content fully visible stay
 * present, so they can't be silently reverted:
 *   1. Card markdown fenced code blocks wrap (white-space: pre-wrap) instead of the
 *      default `white-space: pre` horizontal-scroll that hid content in the narrow card.
 *   2. Cards fill the shelf overlay width (width: 100%) instead of the fixed 280px that
 *      left the card squished with empty space beside it.
 * Same static-scan pattern as tests/animation-conflict.test.ts / tests/css-encoding.test.ts.
 */

const cardCss = readFileSync(
  resolve(__dirname, '../../src/chat/shared/CardRenderer.css'),
  'utf-8',
);
const shelfCss = readFileSync(
  resolve(__dirname, '../../src/chat/shared/ConversationShelf.css'),
  'utf-8',
);

describe('req-18 card truncation fix — CSS invariants', () => {
  it('card markdown code blocks wrap (white-space: pre-wrap), not horizontal-scroll', () => {
    // block-bounded: the `.card-markdown ... pre code` rule's own block must set pre-wrap
    expect(cardCss).toMatch(
      /\.card-markdown[^{}]*\bpre code\b[^{}]*\{[^}]*white-space:\s*pre-wrap[^}]*\}/,
    );
  });

  it('shelf-overlay cards fill width (width: 100%), not the fixed 280px', () => {
    // (?<![-\w]) excludes `max-width: 100%` so this asserts the standalone `width` override
    // specifically — the declaration that beats the base `.card-renderer { width: 280px }`.
    expect(shelfCss).toMatch(
      /\.shelf-card-overlay\s+\.card-renderer\s*\{[^}]*(?<![-\w])width:\s*100%[^}]*\}/,
    );
  });
});
