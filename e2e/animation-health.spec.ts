/**
 * Animation health checks using Chrome DevTools Protocol (CDP).
 *
 * These tests detect animation-related issues:
 * - Excessive running animations after page idle
 * - Transform conflicts (multiple concurrent animations on same element)
 * - Layout thrashing during navigation
 *
 * Chromium-only: CDP is not available in Firefox/WebKit.
 * Run with: npx playwright test --project=animation-health
 */

import { test, expect } from './helpers/test-fixtures';

test.describe('Animation Health', () => {
  test('no excessive animations after page load settles', async ({ page }) => {
    const client = await page.context().newCDPSession(page);
    await client.send('Animation.enable');

    await page.goto('/');
    // Wait for entrance animations to complete
    await page.waitForTimeout(3000);

    // Start observing — collect animations during "quiet period"
    const quietPeriodAnimations: any[] = [];
    client.on('Animation.animationStarted', (event) => {
      quietPeriodAnimations.push(event.animation);
    });

    await page.waitForTimeout(2000);

    // Filter out known acceptable persistent animations (CSS keyframe loops like pulse indicators)
    const unexpected = quietPeriodAnimations.filter((a) => {
      // Allow CSS animations (keyframe-based, typically decorative pulses/spins)
      if (a.type === 'CSSAnimation') return false;
      // Allow very short transitions (< 100ms, typically hover/focus micro-interactions)
      if (a.source?.duration && a.source.duration < 100) return false;
      return true;
    });

    expect(
      unexpected.length,
      `Found ${unexpected.length} unexpected animations during quiet period`
    ).toBeLessThanOrEqual(3);

    await client.send('Animation.disable');
  });

  test('no animation conflicts on same element', async ({ page }) => {
    const client = await page.context().newCDPSession(page);
    await client.send('Animation.enable');

    const animationsByNode = new Map<number, any[]>();
    client.on('Animation.animationStarted', (event) => {
      const nodeId = event.animation.source?.backendNodeId;
      if (nodeId) {
        if (!animationsByNode.has(nodeId)) animationsByNode.set(nodeId, []);
        animationsByNode.get(nodeId)!.push(event.animation);
      }
    });

    await page.goto('/');
    await page.waitForTimeout(3000);

    // Check: no single node should have more than 2 concurrent animations
    // (a common sign of CSS transition + framer-motion transform conflict)
    const conflicts: string[] = [];
    for (const [nodeId, anims] of animationsByNode) {
      const concurrent = anims.filter(
        (a) => a.source?.duration && a.source.duration > 0
      );
      if (concurrent.length > 2) {
        conflicts.push(
          `Node ${nodeId}: ${concurrent.length} concurrent animations`
        );
      }
    }

    expect(conflicts, `Animation conflicts detected:\n${conflicts.join('\n')}`).toHaveLength(0);

    await client.send('Animation.disable');
  });

  test('page load does not cause excessive layouts', async ({ page }) => {
    const client = await page.context().newCDPSession(page);
    await client.send('Performance.enable');

    await page.goto('/');
    await page.waitForTimeout(2000);

    const { metrics } = await client.send('Performance.getMetrics');
    const layoutCount = metrics.find((m: any) => m.name === 'LayoutCount');

    // A healthy page load should not trigger more than 500 layouts
    expect(
      layoutCount?.value ?? 0,
      `Excessive layout count: ${layoutCount?.value}`
    ).toBeLessThan(500);

    await client.send('Performance.disable');
  });

  test('JS heap usage is reasonable after page load', async ({ page }) => {
    const client = await page.context().newCDPSession(page);
    await client.send('Performance.enable');

    await page.goto('/');
    await page.waitForTimeout(3000);

    const { metrics } = await client.send('Performance.getMetrics');
    const jsHeap = metrics.find((m: any) => m.name === 'JSHeapUsedSize');
    const heapMB = (jsHeap?.value ?? 0) / (1024 * 1024);

    // JS heap should stay under 100MB for the initial page
    expect(heapMB, `JS heap: ${heapMB.toFixed(1)}MB`).toBeLessThan(100);

    await client.send('Performance.disable');
  });
});
