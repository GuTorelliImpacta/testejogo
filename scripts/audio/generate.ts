// @ts-nocheck  (scripts Node; o projeto não instala @types/node)
/**
 * Gera os clipes de voz a partir de src/audio/script.ts usando um serviço de TTS neural pt-BR
 * e os processa com ffmpeg (corte de silêncio, ~-16 LUFS, Opus/WebM mono + MP3 mono).
 *
 *   npx tsx scripts/audio/generate.ts [opções]
 *
 *   --provider azure|piper   provedor de voz (ou TTS_PROVIDER no ambiente; padrão azure)
 *   --only a,b,prize_*   gera só estes ids (aceita prefixo com *)
 *   --force              regenera mesmo que o arquivo já exista
 *   --list               lista ids e textos (não precisa de chave)
 *   --dry-run            mostra o SSML que seria enviado (não precisa de chave)
 *   --prep-custom <dir>  normaliza gravações caseiras de <dir>/<id>.<ext> para public/audio/voice-custom/
 *
 * Provedores (ver scripts/audio/README.md):
 *   azure  TTS neural na nuvem (PAGO; precisa de chave)
 *   piper  TTS local/offline (sem chave) + pós-processamento: velocidade +10%, tom +4%, vogais esticadas nos prêmios
 *          PIPER_BIN (padrão 'piper'), PIPER_MODEL (caminho do .onnx pt-BR; obrigatório), PIPER_SAMPLE_RATE (22050),
 *          PIPER_SPEED (1.10), PIPER_PITCH (1.04)
 *
 * Variáveis de ambiente (NUNCA commitar):
 *   AZURE_SPEECH_KEY, AZURE_SPEECH_REGION (ex.: brazilsouth)
 *   AZURE_TTS_VOICE (padrão pt-BR-FranciscaNeural), AZURE_TTS_STYLE (padrão cheerful),
 *   AZURE_TTS_STYLE_DEGREE (padrão 1.5)
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VOICE_LINES } from '../../src/audio/script';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const OUT = join(ROOT, 'public/audio/voice');
const CUSTOM = join(ROOT, 'public/audio/voice-custom');
const MAX_KB = 25;

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};

function fail(msg, code = 2) {
  console.error(`\nERRO: ${msg}\n`);
  process.exit(code);
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function ssmlFor(line) {
  const voice = process.env.AZURE_TTS_VOICE || 'pt-BR-FranciscaNeural';
  const style = process.env.AZURE_TTS_STYLE || 'cheerful';
  const degree = process.env.AZURE_TTS_STYLE_DEGREE || '1.5';
  const big = line.energy === 'big';
  const isNum = line.category === 'number';
  const rate = isNum ? '+8%' : big ? '+2%' : '+5%';
  const pitch = isNum ? '+4%' : big ? '+10%' : '+5%';
  const text = esc(line.speak ?? line.text);
  return (
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="pt-BR">` +
    `<voice name="${voice}"><mstts:express-as style="${style}" styledegree="${degree}">` +
    `<prosody rate="${rate}" pitch="${pitch}">${text}</prosody></mstts:express-as></voice></speak>`
  );
}

async function azureTts(ssml) {
  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION;
  const res = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': key,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'riff-24khz-16bit-mono-pcm',
      'User-Agent': 'altina-da-sorte-audio',
    },
    body: ssml,
  });
  if (!res.ok) throw new Error(`TTS HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Estica a última vogal tônica de falas de prêmio ("Linha!" → "Linhaaa!") para TTS que lê o texto cru. */
function stretch(text) {
  if (/([aeiouáéíóúâêôãõ])\1\1!+$/i.test(text)) return text; // já esticado no roteiro
  return text.replace(/([aeiouáéíóúâêôãõ])(!+)$/i, (_, v, ex) => v + v.toLowerCase().repeat(2) + ex);
}

/**
 * Provedor = { name, check(): string|null (mensagem de erro), describe(line): string, synth(line, tmpDir): Promise<{file, preFilter}> }
 * `file` = WAV/qualquer entrada do ffmpeg; `preFilter` = filtro ffmpeg opcional aplicado antes do corte/normalização.
 */
const PROVIDERS = {
  azure: {
    name: 'azure',
    check() {
      return process.env.AZURE_SPEECH_KEY && process.env.AZURE_SPEECH_REGION
        ? null
        : 'chave do serviço TTS ausente.\nDefina AZURE_SPEECH_KEY e AZURE_SPEECH_REGION no ambiente (nunca no repositório):\n' +
            '  export AZURE_SPEECH_KEY=...  AZURE_SPEECH_REGION=brazilsouth\n' +
            '  npx tsx scripts/audio/generate.ts --provider azure';
    },
    describe: (line) => ssmlFor(line),
    async synth(line, tmp) {
      const wav = join(tmp, `${line.id}.wav`);
      await writeFile(wav, await azureTts(ssmlFor(line)));
      return { file: wav, preFilter: '' };
    },
  },
  piper: {
    name: 'piper',
    check() {
      return process.env.PIPER_MODEL && existsSync(process.env.PIPER_MODEL)
        ? null
        : 'modelo do Piper ausente. Defina PIPER_MODEL=/caminho/pt_BR-<voz>.onnx (e PIPER_BIN se o binário não estiver no PATH).\n' +
            'Baixe um modelo pt-BR e CONFIRME a licença dele (cartão do modelo) antes de redistribuir o áudio. Veja scripts/audio/README.md.';
    },
    describe: (line) => `echo ${JSON.stringify(piperText(line))} | ${process.env.PIPER_BIN || 'piper'} --model $PIPER_MODEL --output_file ${line.id}.wav\n  ffmpeg -af "${piperFilter(line)}"`,
    async synth(line, tmp) {
      const wav = join(tmp, `${line.id}.wav`);
      await run(process.env.PIPER_BIN || 'piper', ['--model', process.env.PIPER_MODEL, '--output_file', wav], piperText(line));
      return { file: wav, preFilter: piperFilter(line) };
    },
  },
};

function piperText(line) {
  const t = line.speak ?? line.text;
  return line.energy === 'big' || line.category === 'prize' ? stretch(t) : t;
}

/** Animação: +10% de velocidade, leve subida de tom (asetrate + atempo para manter a duração), prêmios um pouco mais agudos. */
function piperFilter(line) {
  const sr = Number(process.env.PIPER_SAMPLE_RATE || 22050);
  const speed = Number(process.env.PIPER_SPEED || 1.1);
  const pitch = Number(process.env.PIPER_PITCH || 1.04) * (line.energy === 'big' ? 1.03 : 1);
  return `asetrate=${Math.round(sr * pitch)},aresample=${sr},atempo=${(speed / pitch).toFixed(4)}`;
}

function run(cmd, argv, stdin) {
  return new Promise((ok, ko) => {
    const p = spawn(cmd, argv, { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => ko(new Error(e.code === 'ENOENT' ? `${cmd} não encontrado (defina PIPER_BIN)` : String(e))));
    p.on('close', (c) => (c === 0 ? ok() : ko(new Error(`${cmd} saiu com ${c}: ${err.slice(-300)}`))));
    p.stdin.end(stdin);
  });
}

function getProvider() {
  const n = opt('--provider') || process.env.TTS_PROVIDER || 'azure';
  const p = PROVIDERS[n];
  if (!p) fail(`provedor desconhecido "${n}". Opções: ${Object.keys(PROVIDERS).join(', ')}.`, 1);
  return p;
}

function ffmpeg(argv) {
  return new Promise((ok, ko) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-nostats', '-y', ...argv], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) =>
      ko(new Error(e.code === 'ENOENT' ? 'ffmpeg não encontrado no PATH (instale: apt/brew install ffmpeg)' : String(e))),
    );
    p.on('close', (c) => (c === 0 ? ok(err) : ko(new Error(`ffmpeg saiu com ${c}:\n${err.slice(-600)}`))));
  });
}

const TRIM =
  'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.03:detection=peak,' +
  'areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05:detection=peak,areverse';
const LN = 'loudnorm=I=-16:TP=-1.5:LRA=11';

/** Qualquer entrada → webm/opus + mp3 normalizados em outDir/<id>.* */
async function encode(inputFile, id, outDir, preFilter = '') {
  const tmp = await mkdtemp(join(tmpdir(), 'altina-'));
  try {
    const trimmed = join(tmp, 'trim.wav');
    await ffmpeg(['-i', inputFile, '-af', (preFilter ? preFilter + ',' : '') + TRIM, '-ac', '1', trimmed]);
    // passada 1: mede; passada 2: aplica linear (mais fiel em clipes curtos)
    let af = LN;
    try {
      const log = await ffmpeg(['-i', trimmed, '-af', `${LN}:print_format=json`, '-f', 'null', '-']);
      const m = JSON.parse(log.slice(log.lastIndexOf('{'), log.lastIndexOf('}') + 1));
      if (Number.isFinite(Number(m.input_i))) {
        af = `${LN}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
      }
    } catch {
      /* clipe curto demais para medir: usa passada única */
    }
    await mkdir(outDir, { recursive: true });
    await ffmpeg(['-i', trimmed, '-af', af, '-ac', '1', '-ar', '24000', '-c:a', 'libopus', '-b:a', '28k', '-vbr', 'on', '-application', 'voip', '-f', 'webm', join(outDir, `${id}.webm`)]);
    await ffmpeg(['-i', trimmed, '-af', af, '-ac', '1', '-ar', '24000', '-c:a', 'libmp3lame', '-b:a', '48k', join(outDir, `${id}.mp3`)]);
    const kb = (await stat(join(outDir, `${id}.webm`))).size / 1024;
    const kb2 = (await stat(join(outDir, `${id}.mp3`))).size / 1024;
    return { kb, kb2 };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function writeManifest() {
  const files = (await readdir(OUT)).filter((f) => f.endsWith('.webm'));
  const ids = files.map((f) => f.slice(0, -5)).filter((id) => VOICE_LINES.some((l) => l.id === id)).sort();
  await writeFile(join(OUT, 'manifest.json'), JSON.stringify({ ids }, null, 0) + '\n');
  return ids.length;
}

/** Manifest de voice-custom: ids com gravação (o jogo só busca o que está listado). */
async function writeCustomManifest() {
  await mkdir(CUSTOM, { recursive: true });
  const files = (await readdir(CUSTOM)).filter((f) => f.endsWith('.webm') || f.endsWith('.mp3'));
  const ids = [...new Set(files.map((f) => f.replace(/\.(webm|mp3)$/, '')))].sort();
  await writeFile(join(CUSTOM, 'manifest.json'), JSON.stringify({ ids }) + '\n');
  return ids.length;
}

function selectLines() {
  const only = opt('--only');
  if (!only) return VOICE_LINES;
  const pats = only.split(',').map((s) => s.trim()).filter(Boolean);
  return VOICE_LINES.filter((l) => pats.some((p) => (p.endsWith('*') ? l.id.startsWith(p.slice(0, -1)) : l.id === p)));
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

async function main() {
  if (flag('--list')) {
    for (const l of selectLines()) console.log(`${l.id.padEnd(22)} [${l.category}/p${l.priority}] ${l.text}`);
    return;
  }

  if (opt('--prep-custom')) {
    const dir = resolve(opt('--prep-custom'));
    const ids = new Set(VOICE_LINES.map((l) => l.id));
    const files = (await readdir(dir)).filter((f) => ids.has(basename(f, extname(f))));
    if (!files.length) fail(`nenhum arquivo <id>.<ext> reconhecido em ${dir}. Veja scripts/audio/README.md.`);
    for (const f of files) {
      const id = basename(f, extname(f));
      const r = await encode(join(dir, f), id, CUSTOM);
      console.log(`ok ${id}  webm ${r.kb.toFixed(1)} KB  mp3 ${r.kb2.toFixed(1)} KB`);
    }
    console.log(`voice-custom/manifest.json atualizado (${await writeCustomManifest()} ids).`);
    return;
  }

  const lines = selectLines();
  if (!lines.length) fail('--only não casou com nenhum id (use --list).', 1);

  if (flag('--dry-run')) {
    const prov = getProvider();
    for (const l of lines) console.log(`# ${l.id}\n${prov.describe(l)}\n`);
    console.log(`${lines.length} clipes, provedor ${prov.name} (dry-run, nada foi gerado nem enviado).`);
    return;
  }

  const prov = getProvider();
  const problem = prov.check();
  if (problem) {
    fail(
      problem +
        '\nSem os clipes o jogo funciona normalmente (usa a voz do navegador). Use --dry-run ou --list para inspecionar sem chave.',
    );
  }
  await mkdir(OUT, { recursive: true });

  const todo = [];
  for (const l of lines) {
    const done = (await exists(join(OUT, `${l.id}.webm`))) && (await exists(join(OUT, `${l.id}.mp3`)));
    if (!done || flag('--force')) todo.push(l);
  }
  console.log(`${todo.length} de ${lines.length} clipes a gerar (provedor ${prov.name}).`);

  let bad = 0;
  const tmp = await mkdtemp(join(tmpdir(), 'altina-tts-'));
  try {
    await pool(todo, 3, async (l) => {
      try {
        const src = await prov.synth(l, tmp);
        const r = await encode(src.file, l.id, OUT, src.preFilter);
        const warn = r.kb > MAX_KB ? `  AVISO: > ${MAX_KB} KB` : '';
        console.log(`ok ${l.id.padEnd(20)} webm ${r.kb.toFixed(1)} KB  mp3 ${r.kb2.toFixed(1)} KB${warn}`);
      } catch (e) {
        bad++;
        console.error(`FALHOU ${l.id}: ${e.message}`);
      }
    });
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
  const n = await writeManifest();
  console.log(`manifest.json atualizado (${n} clipes).${bad ? ` ${bad} falharam: rode de novo.` : ''}`);
  if (bad) process.exit(1);
}

main().catch((e) => fail(e.message, 1));
