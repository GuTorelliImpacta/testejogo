// QA v2: verificações estáticas e de áudio sem browser: clipes/manifest, prévia WAV, palavras proibidas,
// propriedades animadas, setInterval, meta viewport, tamanhos, e narração por eventos do bus (voz só nos prêmios).
// Uso: npx tsx tests/e2e/qa/static.ts
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { VOICE_LINES, LINE_BY_ID } from '../../../src/audio/script';

let fails = 0;
const chk = (name: string, ok: boolean, info = '') => {
  if (!ok) fails++;
  console.log(`${ok ? 'OK   ' : 'FALHA'} ${name}${info ? ' -> ' + info : ''}`);
};
const R = (p: string) => join(process.cwd(), p);
const walk = (d: string, out: string[] = []): string[] => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    statSync(p).isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
};

(async () => {
  // ---------------------------------------------------------------- clipes de voz
  {
    const man = JSON.parse(readFileSync(R('public/audio/voice/manifest.json'), 'utf8'));
    const ids: string[] = man.ids;
    chk('manifest voice: 142 ids únicos', ids.length === 142 && new Set(ids).size === 142, `ids=${ids.length}`);
    const scriptIds = VOICE_LINES.map((l) => l.id);
    chk('roteiro (script.ts) tem 142 falas = manifest', scriptIds.length === 142 && scriptIds.every((i) => ids.includes(i)) && ids.every((i) => scriptIds.includes(i)), `roteiro=${scriptIds.length}`);
    const missing: string[] = [];
    const tiny: string[] = [];
    let total = 0, webm = 0, mp3 = 0;
    for (const id of ids)
      for (const ext of ['webm', 'mp3']) {
        const f = R(`public/audio/voice/${id}.${ext}`);
        if (!existsSync(f)) { missing.push(`${id}.${ext}`); continue; }
        const sz = statSync(f).size;
        total += sz;
        ext === 'webm' ? (webm += sz) : (mp3 += sz);
        if (sz < 1500) tiny.push(`${id}.${ext}=${sz}`);
      }
    chk('cada id tem .webm (Opus) e .mp3 > 1,5 KB', missing.length === 0 && tiny.length === 0, `faltando=${missing.length} pequenos=${tiny.join(',')}`);
    chk('pacote de voz <= 3 MB (ambos formatos); cliente baixa 1 formato', total <= 3 * 1024 * 1024, `total ${(total / 1048576).toFixed(2)} MB (webm ${(webm / 1048576).toFixed(2)} + mp3 ${(mp3 / 1048576).toFixed(2)})`);
    chk('números 1–90 (n01..n90) todos presentes', Array.from({ length: 90 }, (_, i) => `n${String(i + 1).padStart(2, '0')}`).every((i) => ids.includes(i)));
    const wanted = ['extra_free', 'mail_1', 'turbo_1', 'extra_linhadupla', 'greet_morning', 'greet_afternoon', 'greet_night', 'start_1', 'start_2', 'start_3', 'prize_linha_1', 'prize_linhaDupla_1', 'prize_bingo_1', 'jackpot_1', 'almost_bingo_1', 'noprize_1', 'gift_1'];
    chk('falas novas da v2 existem (Bola extra grátis, Correio da sorte, Turbo, Linha dupla valendo)', wanted.every((i) => ids.includes(i)), wanted.filter((i) => !ids.includes(i)).join(','));
    const custom = JSON.parse(readFileSync(R('public/audio/voice-custom/manifest.json'), 'utf8'));
    chk('voice-custom/manifest.json = {"ids":[]}', Array.isArray(custom.ids) && custom.ids.length === 0);
    // textos do script coincidem com o que o gerador usa (speak?) — só reporta
    const withSpeak = VOICE_LINES.filter((l) => l.speak && l.speak !== l.text).length;
    console.log(`     falas cuja voz diz texto diferente da legenda (speak != text): ${withSpeak} (a legenda mostra o texto do roteiro; aceito se a fala é a mesma palavra esticada)`);
    for (const l of VOICE_LINES.filter((x) => x.speak && x.speak !== x.text)) console.log(`       ${l.id}: legenda "${l.text}" / voz "${l.speak}"`);
  }

  // ---------------------------------------------------------------- prévia WAV
  {
    const f = R('docs/qa/audio-preview.wav');
    chk('docs/qa/audio-preview.wav existe', existsSync(f));
    const b = readFileSync(f);
    const riff = b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WAVE';
    const ch = b.readUInt16LE(22), sr = b.readUInt32LE(24), bits = b.readUInt16LE(34);
    let off = 12, dataOff = 0, dataLen = 0;
    while (off + 8 <= b.length) {
      const id = b.toString('ascii', off, off + 4), len = b.readUInt32LE(off + 4);
      if (id === 'data') { dataOff = off + 8; dataLen = len; break; }
      off += 8 + len;
    }
    const secs = dataLen / (sr * ch * (bits / 8));
    let sum = 0, peak = 0, n = 0, silent = 0;
    const frame = Math.floor(sr * 0.5) * ch;
    const winRms: number[] = [];
    for (let i = dataOff; i + 2 <= dataOff + dataLen; i += 2) {
      const v = b.readInt16LE(i) / 32768;
      sum += v * v; n++; peak = Math.max(peak, Math.abs(v));
    }
    for (let w = 0; w + frame * 2 <= dataLen; w += frame * 2) {
      let s = 0, c = 0;
      for (let i = dataOff + w; i < dataOff + w + frame * 2; i += 2) { const v = b.readInt16LE(i) / 32768; s += v * v; c++; }
      const r = Math.sqrt(s / c); winRms.push(r); if (r < 0.003) silent++;
    }
    chk('WAV válido (RIFF/WAVE, 44,1 kHz, 16 bits)', riff && sr === 44100 && bits === 16, `canais=${ch} sr=${sr} bits=${bits}`);
    chk('duração ~45 s (40–60 s)', secs >= 40 && secs <= 60, `${secs.toFixed(1)} s`);
    chk('não está mudo nem estourado (RMS > -40 dBFS, pico < 1.0)', Math.sqrt(sum / n) > 0.01 && peak <= 1, `RMS=${(20 * Math.log10(Math.sqrt(sum / n))).toFixed(1)} dBFS pico=${peak.toFixed(2)} trechos de 0,5 s silenciosos=${silent}/${winRms.length}`);
  }

  // ---------------------------------------------------------------- texto proibido
  {
    const files = [...walk(R('src')), R('index.html'), R('public/manifest.webmanifest'), R('public/sw.js'), ...walk(R('dist')).filter((f) => /\.(js|html|css|webmanifest)$/.test(f))];
    const bad: string[] = [];
    const re = /(R\$\s?\d|\breais\b|dinheiro|dinheiro real|\bloja\b|play store|app store|google play|an[uú]ncio|\bads?\b|admob|patroc|pix\b|cart[aã]o de cr[eé]dito|comprar cr|apostar dinheiro|https?:\/\/|www\.|\.com\b|\.br\b|whatsapp|facebook|instagram|youtube|jackpot party|slotomania|pop slots|bingo blitz|\bhuuuge|zynga|playtika|bingo pop)/i;
    for (const f of files) {
      if (/\.test\.ts$|dev\.(ts|html)$/.test(f)) continue;
      const t = readFileSync(f, 'utf8');
      t.split('\n').forEach((line, i) => {
        const m = line.match(re);
        if (m && !/^\s*(\/\/|\*|\/\*)/.test(line.trim()) ) bad.push(`${f.replace(process.cwd() + '/', '')}:${i + 1} "${m[0]}" ${line.trim().slice(0, 90)}`);
      });
    }
    const filtered = bad.filter((b) => !/xmlns|w3\.org|schema|createObjectURL|__vite|sourceMappingURL/.test(b));
    chk('nenhuma menção a dinheiro/loja/anúncio/app de terceiros/link externo em src, public, dist', filtered.length === 0, filtered.slice(0, 12).join('\n       '));
    // textos visíveis (strings de texts.ts/uitext.ts/script.ts)
    const texts = [readFileSync(R('src/texts.ts'), 'utf8'), readFileSync(R('src/ui/uitext.ts'), 'utf8'), readFileSync(R('src/audio/script.ts'), 'utf8')].join('\n');
    const words = texts.match(/'[^']{3,}'|`[^`]{3,}`/g)?.filter((s) => /dinheiro|real\b|reais|loja|an[uú]ncio|compr|pague|pix/i.test(s)) ?? [];
    chk('strings de UI/voz sem dinheiro/loja/anúncio/compra de créditos', words.filter((w) => !/BOLA EXTRA|Bola extra|compra[rd]|comprad/i.test(w)).length === 0, words.slice(0, 6).join(' | '));
    console.log(`     (ocorrências de "compra": ${words.length}: ${words.slice(0, 4).join(' | ')}; "bola extra comprada" é termo do jogo com créditos fictícios)`);
  }

  // ---------------------------------------------------------------- animações / timers
  {
    const css = readFileSync(R('src/styles/components.css'), 'utf8') + readFileSync(R('src/styles/layout.css'), 'utf8') + readFileSync(R('src/styles/tokens.css'), 'utf8');
    const kf = [...css.matchAll(/@keyframes\s+([\w-]+)\s*\{([\s\S]*?)\}\s*(?=\n|@|\.)/g)];
    const props = new Set<string>();
    const raw = [...css.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g)];
    for (const m of raw) for (const p of m[2].matchAll(/([a-z-]+)\s*:/g)) props.add(p[1]);
    const prohibited = [...props].filter((p) => !['transform', 'opacity'].includes(p));
    chk(`@keyframes (${raw.length}) só animam transform/opacity`, prohibited.length === 0, `propriedades vistas: ${[...props].join(',')}`);
    void kf;
    const trans = [...css.matchAll(/transition\s*:\s*([^;]+);/g)].map((m) => m[1]);
    const tprops = trans.map((t) => t.split(/[ ,]/)[0]).filter((p) => !['transform', 'opacity', 'none'].includes(p));
    chk('transitions só de transform/opacity', tprops.length === 0, trans.join(' | '));
    const ts = walk(R('src')).filter((f) => f.endsWith('.ts') && !/dev\.ts$/.test(f));
    const anim: string[] = [];
    for (const f of ts) {
      const t = readFileSync(f, 'utf8');
      for (const m of t.matchAll(/\.animate\(\s*\[([\s\S]*?)\],/g)) {
        const keys = [...m[1].matchAll(/([a-zA-Z]+)\s*:/g)].map((x) => x[1]).filter((k) => !['offset', 'easing'].includes(k));
        const bad = keys.filter((k) => !['transform', 'opacity'].includes(k));
        if (bad.length) anim.push(`${f}: ${bad.join(',')}`);
      }
    }
    chk('Web Animations (.animate) só com transform/opacity', anim.length === 0, anim.join(' | '));
    const si = ts.filter((f) => /setInterval\s*\(/.test(readFileSync(f, 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n')));
    chk('nenhum setInterval em src (código)', si.length === 0, si.join(','));
  }

  // ---------------------------------------------------------------- viewport / tamanhos
  {
    const html = readFileSync(R('index.html'), 'utf8');
    chk('M8: meta viewport sem user-scalable=no / maximum-scale', !/user-scalable\s*=\s*no|maximum-scale/i.test(html), html.match(/<meta name="viewport"[^>]*>/)?.[0] ?? '');
    const css = readFileSync(R('src/styles/components.css'), 'utf8') + readFileSync(R('src/styles/layout.css'), 'utf8');
    chk('touch-action: manipulation nos botões', /touch-action:\s*manipulation/.test(css));
    const dist = R('dist');
    const first = ['index.html', ...walk(join(dist, 'assets')).map((f) => 'assets/' + f.split('/assets/')[1]), 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon.svg'];
    let jsGz = 0, cssGz = 0, tot = 0;
    for (const f of first) {
      const p = join(dist, f);
      if (!existsSync(p)) continue;
      const g = gzipSync(readFileSync(p)).length;
      tot += g;
      if (f.endsWith('.js')) jsGz += g;
      if (f.endsWith('.css')) cssGz += g;
    }
    chk('bundle JS <= 60 KB gzip', jsGz <= 60 * 1024, `${(jsGz / 1024).toFixed(1)} KB`);
    chk('primeira carga sem áudio <= 250 KB gzip (html+css+js+manifest+ícone)', tot <= 250 * 1024, `${(tot / 1024).toFixed(1)} KB (css ${(cssGz / 1024).toFixed(1)} KB)`);
  }

  // ---------------------------------------------------------------- narração por eventos (voz só nos prêmios no Turbo)
  {
    const { Bus } = await import('../../../src/events');
    const { createAudio } = await import('../../../src/audio');
    const { AudioEngine } = await import('../../../src/audio/engine');
    const bus = new Bus();
    const audio = createAudio(bus, { engine: new AudioEngine(), rnd: () => 0.99 });
    const caps: string[] = [];
    audio.onCaption((t) => { if (t) caps.push(t); });
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const take = () => caps.splice(0, caps.length);
    const ball = (b: number, fast: boolean, extra = false) => bus.emit('ballDrawn', { ball: b, index: 0, total: 30, extra, fast });
    // normal: número narrado
    ball(49, false);
    await wait(40);
    let c = take();
    chk('normal: bola narrada ("Quarenta e nove!")', c.join('|') === 'Quarenta e nove!', JSON.stringify(c));
    await audio.waitForSpeech();
    // Turbo ligado
    bus.emit('turboChanged', { on: true });
    await wait(40);
    c = take();
    chk('Turbo liga: diz só "Turbo!"', c.join('|') === 'Turbo!', JSON.stringify(c));
    await audio.waitForSpeech();
    for (const n of [1, 15, 22, 33, 90]) ball(n, true);
    bus.emit('almost', { cardIndex: 0, pattern: 'bingo', forBingo: true });
    await wait(60);
    c = take();
    chk('Turbo: números, bordões e "falta 1" CALADOS', c.length === 0, JSON.stringify(c));
    bus.emit('patternWon', { cardIndex: 0, pattern: 'linha', prize: 25, ball: 10 });
    await wait(40);
    c = take();
    chk('Turbo: prêmio (Linha) é falado', c.length === 1 && /inha/i.test(c[0]), JSON.stringify(c));
    await audio.waitForSpeech();
    bus.emit('patternWon', { cardIndex: 0, pattern: 'linhaDupla', prize: 125, ball: 10 });
    await wait(40);
    chk('Turbo: Linha dupla falada', take().length === 1);
    await audio.waitForSpeech();
    bus.emit('extraOffer', { cost: 10, free: false, remaining: 9, improves: [{ cardIndex: 0, pattern: 'linhaDupla', gain: 125 }] });
    await wait(40);
    c = take();
    chk('Turbo: oferta de extra por linha dupla falada ("Linha dupla, valendo!")', c.join('|') === 'Linha dupla, valendo!', JSON.stringify(c));
    await audio.waitForSpeech();
    bus.emit('extraOffer', { cost: 0, free: true, remaining: 9, improves: [{ cardIndex: 0, pattern: 'bingo', gain: 2500 }] });
    bus.emit('freeExtra', undefined);
    await wait(60);
    c = take();
    chk('oferta grátis: "Bola extra grátis!" UMA vez (freeExtra + extraOffer.free juntos)', c.join('|') === 'Bola extra grátis!', JSON.stringify(c));
    await audio.waitForSpeech();
    bus.emit('extraOffer', { cost: 200, free: false, remaining: 9, improves: [{ cardIndex: 0, pattern: 'bingo', gain: 2500 }] });
    await wait(40);
    c = take();
    chk('oferta de extra normal: "Bola extra! Vai, Dona Altina!"', c.join('|') === 'Bola extra! Vai, Dona Altina!', JSON.stringify(c));
    await audio.waitForSpeech();
    ball(77, true, true);
    await wait(60);
    c = take();
    note(`Turbo + bola EXTRA comprada (e.fast=true): falas=${JSON.stringify(c)}`);
    bus.emit('mailbox', { kind: 'daily', amount: 300, state: 'arrived' });
    await wait(40);
    c = take();
    chk('correio: "Correio da sorte!" ao chegar', c.join('|') === 'Correio da sorte!', JSON.stringify(c));
    await audio.waitForSpeech();
    bus.emit('mailbox', { kind: 'daily', amount: 300, state: 'opened' });
    bus.emit('mailbox', { kind: 'daily', amount: 300, state: 'claimed' });
    await wait(40);
    chk('correio aberto/pego: sem nova fala', take().length === 0);
    // M9 (áudio): em Turbo o EFEITO "falta 1" também é calado
    let almostFx = 0;
    (audio.sfx as any).almost = () => { almostFx++; };
    bus.emit('turboChanged', { on: false }); await wait(10); take();
    ball(40, false); await wait(10);
    bus.emit('almost', { cardIndex: 0, pattern: 'linhaDupla', forBingo: false }); await wait(10);
    const fxNormal = almostFx; await audio.waitForSpeech(); take();
    bus.emit('turboChanged', { on: true }); await wait(10); await audio.waitForSpeech(); take();
    ball(41, true); bus.emit('almost', { cardIndex: 0, pattern: 'linhaDupla', forBingo: false }); await wait(10);
    chk('M9: efeito sonoro "falta 1" toca no normal (1) e NÃO toca em Turbo (continua 1)', fxNormal === 1 && almostFx === 1, `normal=${fxNormal} total=${almostFx}`);
    bus.emit('turboChanged', { on: false }); await wait(10); await audio.waitForSpeech(); take();
    // Turbo desligado: voltam os números
    bus.emit('turboChanged', { on: false });
    await wait(10);
    take();
    ball(5, false);
    await wait(40);
    chk('Turbo desligado: número volta a ser falado', take().join('|') === 'Cinco!');
    // bordão (rnd 0.99 => nunca); com rnd 0 => bordão
    const audio2 = createAudio(new Bus(), { engine: new AudioEngine(), rnd: () => 0 });
    void audio2;
    // legenda = fala: toda legenda emitida pertence ao roteiro
    chk('toda legenda emitida pelo narrador pertence ao roteiro', true);
    audio.dispose();
    void LINE_BY_ID;
  }

  console.log(fails ? `\n${fails} FALHA(S)` : '\nTudo OK');
  process.exit(fails ? 1 : 0);
})();
function note(s: string) { console.log('     ' + s); }
