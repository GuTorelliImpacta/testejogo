import { test, expect } from '@playwright/test';

for (const vp of [
  { width: 1280, height: 800 },
  { width: 800, height: 1280 },
  { width: 360, height: 740 },
]) {
  test(`rodada completa com 1 toque em ${vp.width}x${vp.height}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.setViewportSize(vp);
    await page.goto('/');
    await page.getByText('ENTRAR').click();
    const play = page.locator('button.play');
    await expect(play).toBeVisible();
    await play.click();
    await expect(play).toBeDisabled();
    await page.getByRole('button', { name: /Turbo/ }).first().click({ timeout: 5000 }).catch(() => {});
    // trata ofertas e celebrações até voltar ao estado ocioso
    const deadline = Date.now() + 100_000;
    let finished = false;
    while (Date.now() < deadline) {
      const terminar = page.getByRole('button', { name: /TERMINAR/ });
      const cont = page.getByRole('button', { name: /CONTINUAR/ });
      if (await terminar.isVisible().catch(() => false)) await terminar.click();
      else if (await cont.isVisible().catch(() => false)) await cont.click();
      else if (await play.isEnabled().catch(() => false)) {
        finished = true;
        break;
      }
      await page.waitForTimeout(300);
    }
    expect(finished).toBe(true);
    // sem rolagem
    const scroll = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    expect(scroll).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });
}
