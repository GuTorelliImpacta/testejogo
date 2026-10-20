// QA v2.1: mede posição/tamanho de regiões da tela. Uso: npx tsx tests/e2e/qa/measure.ts 960x600,375x667 ".cards,.bar"
import { launch, open } from './browser';
import { blankRound } from './fixtures';
(async () => {
  const b = await launch();
  const sels = (process.argv[3] || '.top,.cards,.ballsec,.strip,.trail,.ptab,.bar,.capslot,.top .cred,.top .snd,.bar .rowa,.bar .rowb,.card .card-head').split(',');
  for (const [w, h] of (process.argv[2] || '960x600').split(',').map((s) => s.split('x').map(Number))) {
    const c = await open(b, blankRound({ mainIdx: 8, credits: 980 }), { width: w, height: h });
    await c.page.getByText('ENTRAR').click(); await c.page.waitForTimeout(800);
    const r = await c.page.evaluate((sels) => sels.map((s) => { const e = document.querySelector(s) as HTMLElement | null; if (!e) return s + ':none'; const r = e.getBoundingClientRect(); return `${s} y${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)} sh${e.scrollHeight} disp:${getComputedStyle(e).display}`; }).join('\n'), sels);
    console.log(`== ${w}x${h}\n${r}`);
    await c.ctx.close();
  }
  await b.close();
})();
