import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const sizes = [
  { name: 'mobile-320', width: 320, height: 800 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'desktop-1440', width: 1440, height: 1000 },
] as const;

for (const size of sizes) {
  test(`typed workbench is responsive and accessible at ${size.width}px`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.addInitScript(() => localStorage.setItem('ak_access', 'visual-test-session'));
    await page.route('**/api/chat', (route) => route.fulfill({ json: { conversations: [] } }));
    await page.route('**/api/workflows', (route) => route.fulfill({ json: { workflows: [] } }));
    await page.route('**/api/models', (route) => route.fulfill({ json: {
      models: [{ key: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', provider: 'google', available: false }],
    } }));
    await page.goto('/workspace', { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Ask. Think. Build.' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Chat' })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('tab', { name: 'Work' }).click();
    await expect(page.getByRole('heading', { name: 'From goal to verified artifact.' })).toBeVisible();
    const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, width: window.innerWidth }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(results.violations).toEqual([]);
    await expect(page.locator('main')).toHaveScreenshot(`workbench-${size.name}.png`, {
      animations: 'disabled', caret: 'hide', scale: 'css', maxDiffPixelRatio: 0.01,
    });
  });
}
