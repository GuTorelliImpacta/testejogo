import { chromium } from '@playwright/test';
const [prefix, vps, scs] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
for (const vp of vps.split(',')) {
  const [w, h] = vp.split('x').map(Number);
  const c = await b.newContext({ viewport: { width: w, height: h } });
  const p = await c.newPage();
  for (const s of scs.split(',')) {
    await p.goto(`http://127.0.0.1:4191/src/ui/dev.html?s=${s}`);
    await p.waitForTimeout(500);
    await p.screenshot({ path: `${prefix.startsWith("/") ? prefix : "/home/user/testejogo/docs/qa/" + prefix}-${s}-${vp}.png` });
  }
  await c.close();
}
await b.close();
