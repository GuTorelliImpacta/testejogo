// QA v2.1: Turbo instantâneo. Com Turbo ligado, as 30 bolas devem aparecer de uma vez (sem bola a bola).
// Uso: npx tsx tests/e2e/qa/turbo.ts
import { baseSave } from './fixtures';
import { finishRound, launch, open } from './browser';
const filled = (p: import('@playwright/test').Page) => p.evaluate(() => document.querySelectorAll('.tr-main .tc.on').length);
(async () => {
  const b = await launch();
  const out: string[] = [];
  // 1) Turbo ligado antes de jogar
  for (let r = 0; r < 5; r++) {
    const s = baseSave(r + 1); s.settings.turbo = true;
    const c = await open(b, s, { width: 1280, height: 800 });
    await c.page.getByText('ENTRAR').click(); await c.page.waitForTimeout(300);
    const t0 = Date.now();
    await c.page.locator('button.play').click();
    await c.page.waitForFunction(() => document.querySelectorAll('.tr-main .tc.on').length === 30, null, { timeout: 5000 });
    const ms = Date.now() - t0;
    const marked = await c.page.evaluate(() => document.querySelectorAll('.card .cell.hit, .card .cell.on, .card .cell.mk').length);
    const res = await finishRound(c.page, 30000);
    out.push(`turbo rodada ${r + 1}: 30 bolas em ${ms} ms; células marcadas ${marked}; terminou=${res.ok} [${res.seen.join(',')}] erros=${c.errs.length}`);
    await c.ctx.close();
  }
  // 2) Liga o Turbo no meio da rodada
  {
    const s = baseSave(9); s.settings.turbo = false; s.settings.speed = 'lenta';
    const c = await open(b, s, { width: 1280, height: 800 });
    await c.page.getByText('ENTRAR').click(); await c.page.waitForTimeout(300);
    await c.page.locator('button.play').click();
    await c.page.waitForTimeout(4500);
    const before = await filled(c.page);
    const t0 = Date.now();
    await c.page.locator('.g-turbo').click();
    await c.page.waitForFunction(() => document.querySelectorAll('.tr-main .tc.on').length === 30, null, { timeout: 8000 });
    out.push(`turbo no meio: tinha ${before} bolas; completou 30 em ${Date.now() - t0} ms; erros=${c.errs.length}`);
    const res = await finishRound(c.page, 30000);
    out.push(`  terminou=${res.ok}`);
    await c.ctx.close();
  }
  // 3) Sem Turbo continua bola a bola
  {
    const s = baseSave(3); s.settings.turbo = false;
    const c = await open(b, s, { width: 1280, height: 800 });
    await c.page.getByText('ENTRAR').click(); await c.page.waitForTimeout(300);
    await c.page.locator('button.play').click();
    await c.page.waitForTimeout(3000);
    out.push(`sem turbo: após 3 s há ${await filled(c.page)} bolas (esperado poucas)`);
    await c.ctx.close();
  }
  await b.close();
  console.log(out.join('\n'));
})();
