// Offline via service worker: primeira visita -> (sem recarregar online) -> offline -> recarregar.
import { chromium } from '@playwright/test';
import { BASE, EXE } from './fixtures';

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  for (const variant of ['A: 1ª visita, depois offline direto', 'B: 1ª visita, 1 reload online, depois offline']) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const failed: string[] = [];
    page.on('requestfailed', (r) => failed.push(r.url().replace(BASE, '')));
    page.on('pageerror', (e) => failed.push('pageerror ' + e));
    await page.goto(BASE + '/');
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => 1));
    await page.waitForTimeout(1500);
    const ctrl = await page.evaluate(() => !!navigator.serviceWorker.controller);
    if (variant.startsWith('B')) { await page.reload(); await page.waitForTimeout(1500); }
    const caches = await page.evaluate(async () => { const o: Record<string, string[]> = {}; for (const k of await caches.keys()) o[k] = (await (await caches.open(k)).keys()).map((r) => new URL(r.url).pathname); return o; });
    await ctx.setOffline(true);
    failed.length = 0;
    await page.reload().catch((e) => failed.push('reload: ' + String(e).split('\n')[0]));
    await page.waitForTimeout(1500);
    const ok = await page.getByText('ENTRAR').isVisible().catch(() => false);
    let played = false;
    if (ok) { await page.getByText('ENTRAR').click(); await page.waitForTimeout(500); await page.locator('button.play').click(); await page.waitForTimeout(3500); played = (await page.evaluate(() => document.querySelectorAll('.hist i').length)) === 60 && (await page.locator('button.play').isDisabled()); }
    console.log(`[${variant}] controlado no 1º load=${ctrl}; caches=${JSON.stringify(caches)}`);
    console.log(`   offline: ENTRAR visível=${ok}, rodada iniciou=${played}; falhas=${JSON.stringify(failed.slice(0, 8))}`);
    await ctx.close();
  }
  await browser.close();
})();
