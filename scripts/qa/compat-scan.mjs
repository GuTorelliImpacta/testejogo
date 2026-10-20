// Varredura estática de compatibilidade (piso: Chrome/WebView 60). Uso: node scripts/qa/compat-scan.mjs [dist]
// Lê dist/assets/*.js, dist/sw.js e dist/assets/*.css; lista cada recurso, versão mínima do Chrome e onde aparece.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dist = process.argv[2] ?? 'dist';
const files = (ext) => readdirSync(join(dist, 'assets')).filter((f) => f.endsWith(ext)).map((f) => join(dist, 'assets', f));
const FLOOR = 60;

// [nome, regex, chromeMin, observação]
const JS = [
  ['structuredClone', /\bstructuredClone\b/, 98],
  ['Array.prototype.at / String.at', /\.at\(/, 92],
  ['??= ||= &&=', /(\?\?|\|\||&&)=/, 85],
  ['replaceAll', /\.replaceAll\(/, 85],
  ['Object.hasOwn', /Object\.hasOwn\b/, 93],
  ['Array.prototype.flat', /\.flat\(/, 69],
  ['Array.prototype.flatMap', /\.flatMap\(/, 69],
  ['Object.fromEntries', /Object\.fromEntries\b/, 73],
  ['String.prototype.matchAll', /\.matchAll\(/, 73],
  ['Promise.allSettled', /allSettled\b/, 76],
  ['Promise.prototype.finally', /\.finally\(/, 63],
  ['queueMicrotask', /\bqueueMicrotask\b/, 71],
  ['globalThis', /\bglobalThis\b/, 71],
  ['ResizeObserver', /\bResizeObserver\b/, 64],
  ['IntersectionObserver', /\bIntersectionObserver\b/, 51],
  ['AbortController', /\bAbortController\b/, 66],
  ['fetch', /\bfetch\(/, 42],
  ['optional chaining ?.', /[\w)\]]\?\.[\w([]/, 80, 'sintaxe: esbuild baixa para chrome60'],
  ['nullish ??', /[\w)\]"'] \?\? /, 80, 'sintaxe: esbuild baixa para chrome60'],
  ['catch sem parâmetro', /catch\s*\{/, 66, 'sintaxe: esbuild baixa para chrome60'],
  ['top-level await', /^\s*await\s/m, 89],
  ['import()/import.meta', /\bimport\.meta\b|\bimport\(/, 63],
  ['type="module" no HTML', null, 61],
  ['BigInt literal', /\b\d+n\b/, 67],
  ['Array.prototype.findLast / toSorted', /\.(findLast|toSorted|toReversed)\(/, 97],
  ['navigator.clipboard', /navigator\.clipboard/, 66, 'opcional (Exportar)'],
  ['navigator.wakeLock', /wakeLock/, 84, 'opcional, detecta antes de usar'],
  ['serviceWorker', /serviceWorker/, 40, 'opcional'],
  ['OfflineAudioContext', /OfflineAudioContext/, 35, 'opcional (cai na música ao vivo)'],
  ['Element.animate (WAAPI)', /\.animate\(/, 36, 'protegido por if (el.animate)'],
  ['URL.createObjectURL/Blob', /createObjectURL/, 23],
  ['Intl / toLocaleString', /toLocaleString\(/, 24],
  ['matchMedia().addEventListener', /\.addEventListener\?\.|addEventListener\("change"/, 45],
];
const CSS = [
  ['dvh/svh/lvh', /\d(dvh|svh|lvh)\b/, 108, 'precedido por 100vh'],
  ['inset:', /[\s;{]inset\s*:/, 87],
  [':has()', /:has\(/, 105],
  ['CSS nesting (&)', /[{;]\s*&[\s.:#]/, 112],
  ['aspect-ratio', /aspect-ratio\s*:/, 88, '@supports not (...) com altura calculada'],
  ['clamp()', /clamp\(/, 79, 'dentro de @supports'],
  ['min()/max()', /[\s:,(]((min|max)\()/, 79, 'valor-reserva antes (sem var()) ou em @supports'],
  ['container queries / cqh cqmin cqw', /container-type|\d(cqh|cqw|cqmin|cqmax)\b/, 105, 'precedido por valor-reserva'],
  ['env()', /env\(/, 69],
  [':focus-visible', /:focus-visible/, 86, 'regra isolada; sem ela só some o anel no teclado'],
  [':is()/:where()', /:(is|where)\(/, 88],
  ['gap em flex (gap:/column-gap)', /[\s;{](row-)?gap\s*:/, 84, 'grid-gap/gap em grid vale desde 66; em flex a UI usa margens (.nogap)'],
  ['cores #RRGGBBAA', /#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{4}\b/, 62, 'cssTarget=chrome60 converte para rgba()'],
  ['overscroll-behavior', /overscroll-behavior/, 63, 'ignorado sem prejuízo'],
  ['place-items / place-self', /place-(items|self|content)/, 59],
  ['grid-gap', /grid-(row-|column-)?gap/, 57],
  ['@supports', /@supports/, 28],
  ['contain:', /[\s;{]contain\s*:/, 52],
  ['will-change', /will-change/, 36],
  ['backdrop-filter / filter', /(backdrop-)?filter\s*:/, 53, 'não usado nas partes dinâmicas'],
  ['color-mix / @layer / accent-color', /color-mix\(|@layer|accent-color/, 99],
  ['translate/scale/rotate (propriedades)', /[\s;{](translate|scale|rotate)\s*:/, 104],
  ['calc() com var()', /calc\([^)]*var\(/, 51],
];

function ctx(src, m) {
  const i = m.index;
  return src.slice(Math.max(0, i - 40), i + 70).replace(/\s+/g, ' ');
}
const rows = [];
function scan(kind, list, src, where) {
  for (const [name, re, min, note] of list) {
    if (!re) continue;
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    const ms = [...src.matchAll(g)];
    if (ms.length) rows.push({ kind, where, name, n: ms.length, min, note: note ?? '', ex: ctx(src, ms[0]), bad: min > FLOOR });
  }
}
for (const f of files('.js')) scan('js', JS, readFileSync(f, 'utf8'), f.replace(dist + '/', ''));
if (existsSync(join(dist, 'sw.js'))) scan('js', JS, readFileSync(join(dist, 'sw.js'), 'utf8'), 'sw.js');
for (const f of files('.css')) scan('css', CSS, readFileSync(f, 'utf8'), f.replace(dist + '/', ''));
const html = readFileSync(join(dist, 'index.html'), 'utf8');
rows.push({ kind: 'html', where: 'index.html', name: 'type="module"', n: (html.match(/type="module"/g) ?? []).length, min: 61, note: 'deve ser 0 (script clássico)', ex: '', bad: /type="module"/.test(html) });

console.log(`Piso: Chrome ${FLOOR}. "ACIMA" = exige versão maior que o piso (precisa de guarda/fallback; ver docs/qa/compat-fase3.md).\n`);
for (const r of rows) console.log(`${r.bad ? 'ACIMA ' : 'ok    '} [${r.kind}] ${r.name} (Chrome ${r.min}+) x${r.n} em ${r.where}${r.note ? ' | ' + r.note : ''}${r.ex ? '\n        ex: ' + r.ex : ''}`);
const worst = rows.filter((r) => r.bad && r.kind === 'js' && /syntax|sintaxe/.test(r.note));
process.exit(worst.length ? 1 : 0);
