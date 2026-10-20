# Pipeline de voz

O jogo funciona **sem nenhum arquivo de áudio** (usa a voz do navegador, `speechSynthesis` pt-BR). Os clipes abaixo só melhoram a qualidade.

Ordem de preferência na hora de falar (ver `src/audio/engine.ts`):

1. `public/audio/voice-custom/<id>.webm|.mp3`: gravações da família (vencem sempre);
2. `public/audio/voice/<id>.webm|.mp3`: clipes gerados por TTS neural (este pipeline);
3. `speechSynthesis` pt-BR com `rate`/`pitch` animados.

Os clipes são baixados **depois do primeiro toque**, em segundo plano. Os que ainda não chegaram são pulados sem erro.

**Manifests (M4).** O jogo só busca clipes listados em `public/audio/voice/manifest.json` e `public/audio/voice-custom/manifest.json` (`{"ids":[...]}`). Se os dois estiverem vazios ou ausentes, **nenhum clipe é pedido** e a voz cai direto no `speechSynthesis`. Hoje ambos estão `{"ids":[]}`; o gerador (e `--prep-custom`) os atualiza.

**Voz ainda não gerada.** O provedor de voz não foi escolhido e nenhum clipe foi gerado. Prepare tudo com `--list` e `--dry-run` (não precisam de chave).

## Gerar os clipes

Requisitos: Node 20+ e `ffmpeg` com `libopus` e `libmp3lame` no PATH. Escolha o provedor com `--provider azure|piper` (ou `TTS_PROVIDER`).

```bash
npx tsx scripts/audio/generate.ts --list                          # ids e textos (sem chave)
npx tsx scripts/audio/generate.ts --dry-run --provider piper      # mostra o que seria feito (sem chave, sem rede)
npx tsx scripts/audio/generate.ts --provider azure                # gera o que falta (~140 clipes)
npx tsx scripts/audio/generate.ts --provider azure --only 'prize_*,jackpot_*' --force
```

Sem chave/modelo o script termina com mensagem clara e **não** altera nada. Para cada linha de `src/audio/script.ts` ele sintetiza, corta silêncio das pontas (−50 dB), normaliza em ≈ −16 LUFS (duas passadas, pico −1,5 dBTP), codifica **Opus/WebM** mono 28 kbps + **MP3** mono 48 kbps, avisa se algum passar de 25 KB e atualiza `public/audio/voice/manifest.json`. Orçamento do pacote de voz: **≤ 3 MB** (hoje ≈ 140 clipes × poucos KB).

### Provedor `azure` (nuvem, PAGO, precisa de chave)

```bash
export AZURE_SPEECH_KEY=...          # só no terminal ou em .env.local; NUNCA commitar
export AZURE_SPEECH_REGION=brazilsouth
# opcionais:
export AZURE_TTS_VOICE=pt-BR-FranciscaNeural
export AZURE_TTS_STYLE=cheerful      # estilo "animado" (depende da voz)
export AZURE_TTS_STYLE_DEGREE=1.5
```

Envia SSML (voz neural pt-BR, estilo `cheerful`, `prosody` mais rápido/agudo). **Custo:** cobrado por caracteres; o roteiro inteiro tem na ordem de 3 mil caracteres, ou seja centavos de dólar (e há cota gratuita mensal). Confira a tabela atual do provedor e se o plano permite redistribuir o áudio dentro de um app.

### Provedor `piper` (local/offline, sem chave)

[Piper](https://github.com/rhasspy/piper) roda no próprio computador. **Não está instalado neste repositório** (não é dependência do jogo); instale o binário e um modelo pt-BR por conta própria e **leia a licença do modelo** (cartão do modelo) antes de redistribuir o áudio.

```bash
export PIPER_BIN=piper                         # se não estiver no PATH
export PIPER_MODEL=~/piper/pt_BR-<voz>.onnx    # obrigatório
export PIPER_SAMPLE_RATE=22050                 # taxa do modelo (veja o .onnx.json)
export PIPER_SPEED=1.10                        # +10% de velocidade
export PIPER_PITCH=1.04                        # leve subida de tom (prêmios: +3% extra)
npx tsx scripts/audio/generate.ts --provider piper
```

Pós-processamento para animar (ffmpeg, antes do corte/normalização): `asetrate`+`atempo` sobem o tom e aceleram o clipe; nas falas de prêmio (`energy: 'big'`) o script estica a última vogal do texto enviado ("Linha!" → "Linhaaa!", "Turbo!" → "Turbooo!") e usa tom um pouco mais agudo. A qualidade é de voz neural leve: ouça com `--only` antes de gerar tudo.

### Outros provedores

O script tem uma tabela `PROVIDERS` pequena: cada provedor é `{ name, check(), describe(line), synth(line, tmpDir) → { file, preFilter } }`. Para adicionar outro, copie `azure` ou `piper`; o resto (ffmpeg + manifest) é comum.

| Provedor | Observações |
|---|---|
| ElevenLabs (`eleven_multilingual_v2`/`v3`) | Vozes muito expressivas em pt-BR; chave paga; checar licença comercial do plano |
| Google Cloud Text-to-Speech (Chirp 3 HD, pt-BR) | Boa naturalidade; ajuste por `speakingRate`/`pitch` |
| OpenAI `gpt-4o-mini-tts` | Parâmetro `instructions` permite pedir "apresentador de bingo empolgado" |
| Amazon Polly (pt-BR neural/generative) | Simples e barato; menos expressivo |
| Gravar com a própria voz | Veja "Gravações da família" |

Tudo é opcional: o jogo cai no `speechSynthesis` se não houver clipe.

## Prévia de áudio (`npm run audio:preview`)

Gera `docs/qa/audio-preview.wav` (~48 s) com Playwright + Chromium (usa `CHROMIUM_PATH` ou `/opt/pw-browsers/chromium`; não precisa de `playwright install`) e `OfflineAudioContext`: música do sorteio com ducking, 5 bolas (uma com bordão), Linha, Linha dupla, bola extra grátis e Bingo. **A voz real ainda não existe**: cada fala é um "beep falado" sintético que marca onde a voz entra e aciona o ducking de verdade. Só música, efeitos, jingles e ducking são avaliáveis; rode de novo depois de gerar os clipes só se a prévia passar a carregá-los (hoje não carrega).

## Bordões

`BORDOES` em `src/audio/script.ts` (número → texto): 15 "a debutante", 22 "Dois patinhos na lagoa!", 33 "idade de Cristo", 77 "dois machadinhos", 90 "o velhinho". São ditos populares de bingo, sem autoria; a lista é curta de propósito (só os que têm certeza). Em ~1 de cada 8 bolas que têm bordão a voz diz o bordão (ids `bordao_15`, `bordao_22`, ...), se `Settings.bordoes` estiver ligado (`audio.setBordoes(on)`).

### Vozes e estilos

As vozes neurais mudam de nome e de estilos disponíveis com o tempo. Confira a lista de vozes pt-BR do provedor e teste algumas falas com `--only` antes de gerar tudo. Se a voz não aceitar `cheerful`, o estilo é ignorado; compense com `prosody` (editável em `ssmlFor()` no script).

## Gravações da família (`public/audio/voice-custom/`)

Qualquer clipe com o **mesmo id** de uma fala substitui o gerado. Basta colocar os arquivos em `public/audio/voice-custom/` com o nome:

```
public/audio/voice-custom/<id>.webm     (preferido, Opus)
public/audio/voice-custom/<id>.mp3      (alternativa/fallback)
```

Exemplos: `n07.webm` ("Sete!"), `prize_bingo_1.mp3`, `greet_morning.webm`, `start_1.mp3`.
Números: `n01` a `n90` (dois dígitos); bordões: `bordao_22` etc. Prêmios têm 2 a 3 variações (`prize_<padrao>_1`, `_2`, `_3`); gravar só algumas é ok, as demais continuam com a voz gerada. Para trocar todas as variações de um prêmio, grave todas.

Dica para quem grava no celular: grave cada fala em um arquivo (m4a/wav/mp3/ogg) com o nome do id (ex.: `prize_bingo_1.m4a`) numa pasta qualquer e rode:

```bash
npx tsx scripts/audio/generate.ts --prep-custom ~/minhas-gravacoes
```

Isso corta os silêncios, nivela o volume em ≈ −16 LUFS e gera `.webm` + `.mp3` em `voice-custom/`. Não é preciso chave de API.

Sem passar pelo script, o jogo toca o arquivo como está (sem nivelar). **Obrigatório** listar o id em `public/audio/voice-custom/manifest.json` (`{"ids":["n07","prize_bingo_1"]}`; `--prep-custom` faz isso sozinho). Id fora do manifest nunca é buscado.

Se o app é offline (PWA), o service worker deve incluir `/audio/voice/` e `/audio/voice-custom/` no cache (os arquivos são buscados em segundo plano após o primeiro toque).

## Ids do roteiro (além de `n01`..`n90`)

| id | texto |
|---|---|
| `greet_morning` | Bom dia, Dona Altina! Vamos jogar? |
| `gift_daily_morning` | Bom dia, Dona Altina! Seu presente de hoje! |
| `greet_afternoon` | Boa tarde, Dona Altina! Vamos jogar? |
| `gift_daily_afternoon` | Boa tarde, Dona Altina! Seu presente de hoje! |
| `greet_night` | Boa noite, Dona Altina! Vamos jogar? |
| `gift_daily_night` | Boa noite, Dona Altina! Seu presente de hoje! |
| `start_1` | Boa sorte, Dona Altina! |
| `start_2` | Vamos lá! |
| `start_3` | Valendo! |
| `almost_1` | Falta uma! |
| `almost_2` | Tá quase! |
| `almost_bingo_1` | Falta uma pro bingo! |
| `almost_bingo_2` | Tá quase o bingo! |
| `extra_1` | Bola extra! Vai, Dona Altina! |
| `extra_2` | Mais uma chance! |
| `extra_free` | Bola extra grátis! |
| `extra_linhadupla` | Linha dupla, valendo! |
| `mail_1` | Correio da sorte! |
| `turbo_1` | Turbo! |
| `bordao_15`, `_22`, `_33`, `_77`, `_90` | bordões (ver acima) |
| `noprize_1` | Na próxima vai! |
| `noprize_2` | Quase, quase! |
| `noprize_3` | Vamos de novo? |
| `gift_1` | Presente pra Dona Altina! |
| `gift_2` | Olha o presente, Dona Altina! |
| `prize_linha_1` | Linhaaa! |
| `prize_linha_2` | Linha! Muito bem! |
| `prize_linha_3` | Fez linha! |
| `prize_cantos_1` | Cantos! |
| `prize_cantos_2` | Os quatro cantos! |
| `prize_cantos_3` | Cantooos! |
| `prize_piramide_1` | Pirâmide! |
| `prize_piramide_2` | Pirâmide! Olha só! |
| `prize_piramide_3` | Piraaâmide! |
| `prize_u_1` | Deu U! |
| `prize_u_2` | Deu Úúú! |
| `prize_u_3` | U! Que lindo! |
| `prize_linhaDupla_1` | Linha duplaaa! |
| `prize_linhaDupla_2` | Linha dupla! Que sorte! |
| `prize_linhaDupla_3` | Duas linhas! |
| `prize_moldura_1` | Moldura! Que beleza! |
| `prize_moldura_2` | Moldurinha completa! |
| `prize_moldura_3` | Moldura! Uhuuu! |
| `prize_bingo_1` | BINGOOO!!! |
| `prize_bingo_2` | BINGO! Parabéns! |
| `prize_bingo_3` | É bingooo! |
| `jackpot_1` | ACUMULADOOO! A Dona Altina levou tudo! |
| `jackpot_2` | ACUMULADO! Parabéns, Dona Altina! |

Os textos entre aspas vêm de `src/audio/script.ts` (fonte única); rode `--list` para ver a versão atual.
