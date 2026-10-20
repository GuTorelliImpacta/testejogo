# Pipeline de voz

O jogo funciona **sem nenhum arquivo de áudio** (usa a voz do navegador, `speechSynthesis` pt-BR). Os clipes abaixo só melhoram a qualidade.

Ordem de preferência na hora de falar (ver `src/audio/engine.ts`):

1. `public/audio/voice-custom/<id>.webm|.mp3`: gravações da família (vencem sempre);
2. `public/audio/voice/<id>.webm|.mp3`: clipes gerados por TTS neural (este pipeline);
3. `speechSynthesis` pt-BR com `rate`/`pitch` animados.

Os clipes são baixados **depois do primeiro toque**, em segundo plano. Os que ainda não chegaram são pulados sem erro.

## Gerar os clipes (TTS neural)

Requisitos: Node 20+, `ffmpeg` com `libopus` e `libmp3lame` no PATH, e uma chave do provedor.

```bash
export AZURE_SPEECH_KEY=...          # só no seu terminal; NUNCA commitar
export AZURE_SPEECH_REGION=brazilsouth
# opcionais:
export AZURE_TTS_VOICE=pt-BR-FranciscaNeural
export AZURE_TTS_STYLE=cheerful      # estilo "animado" (depende da voz)
export AZURE_TTS_STYLE_DEGREE=1.5

npx tsx scripts/audio/generate.ts                 # gera o que falta (~125 clipes)
npx tsx scripts/audio/generate.ts --only 'prize_*,jackpot_*' --force
npx tsx scripts/audio/generate.ts --list          # ids e textos (sem chave)
npx tsx scripts/audio/generate.ts --dry-run       # mostra o SSML (sem chave)
```

Sem chave o script termina com mensagem clara e **não** altera nada.

Para cada linha de `src/audio/script.ts`:

1. envia SSML (voz neural pt-BR, estilo `cheerful`, `prosody` mais rápido/agudo nas falas de prêmio);
2. corta silêncio das pontas (`silenceremove`, limiar −50 dB);
3. normaliza em ≈ −16 LUFS (`loudnorm` em duas passadas, pico −1,5 dBTP);
4. codifica **Opus/WebM** mono 28 kbps (`<id>.webm`) e **MP3** mono 48 kbps (`<id>.mp3`);
5. avisa se algum clipe passar de 25 KB e atualiza `public/audio/voice/manifest.json` (lista de ids; evita requisições 404).

Commite os arquivos gerados (`public/audio/voice/*`). Orçamento total do pacote de áudio: ≤ 2,5 MB. Hoje cada clipe tem poucos KB.

### Vozes e estilos

As vozes neurais mudam de nome e de estilos disponíveis com o tempo. Confira a lista de vozes pt-BR do provedor e teste algumas falas com `--only` antes de gerar tudo. Se a voz não aceitar `cheerful`, o estilo é ignorado; compense com `prosody` (editável em `ssmlFor()` no script).

### Alternativas ao Azure

O script é um adaptador pequeno: troque `azureTts()` e `ssmlFor()` e mantenha o resto (ffmpeg + manifest).

| Provedor | Observações |
|---|---|
| ElevenLabs (`eleven_multilingual_v2`/`v3`) | Vozes muito expressivas em pt-BR; controle de estilo/estabilidade; checar licença comercial do plano |
| Google Cloud Text-to-Speech (Chirp 3 HD, pt-BR) | Boa naturalidade; sem "estilos", ajuste por `speakingRate`/`pitch` |
| OpenAI `gpt-4o-mini-tts` | Parâmetro `instructions` permite pedir "apresentador de bingo empolgado, caloroso" |
| Amazon Polly (pt-BR neural/generative) | Simples e barato; menos expressivo |
| Gravar com a própria voz | Veja a seção abaixo |

Tudo é opcional: o jogo cai no `speechSynthesis` se não houver clipe.

## Gravações da família (`public/audio/voice-custom/`)

Qualquer clipe com o **mesmo id** de uma fala substitui o gerado. Basta colocar os arquivos em `public/audio/voice-custom/` com o nome:

```
public/audio/voice-custom/<id>.webm     (preferido, Opus)
public/audio/voice-custom/<id>.mp3      (alternativa/fallback)
```

Exemplos: `n07.webm` ("Sete!"), `prize_bingo_1.mp3`, `greet_morning.webm`, `start_1.mp3`.
Números: `n01` a `n60` (dois dígitos). Prêmios têm 2 a 3 variações (`prize_<padrao>_1`, `_2`, `_3`); gravar só algumas é ok, as demais continuam com a voz gerada. Para trocar todas as variações de um prêmio, grave todas.

Dica para quem grava no celular: grave cada fala em um arquivo (m4a/wav/mp3/ogg) com o nome do id (ex.: `prize_bingo_1.m4a`) numa pasta qualquer e rode:

```bash
npx tsx scripts/audio/generate.ts --prep-custom ~/minhas-gravacoes
```

Isso corta os silêncios, nivela o volume em ≈ −16 LUFS e gera `.webm` + `.mp3` em `voice-custom/`. Não é preciso chave de API.

Sem passar pelo script, o jogo toca o arquivo como está (sem nivelar). Opcional: `public/audio/voice-custom/manifest.json` com `{"ids":["n07","prize_bingo_1"]}` (ou nomes com extensão) para o jogo não pedir arquivos inexistentes; sem o manifest ele tenta `<id>.webm` e `<id>.mp3` de cada fala.

Se o app é offline (PWA), o service worker deve incluir `/audio/voice/` e `/audio/voice-custom/` no cache (os arquivos são buscados em segundo plano após o primeiro toque).

## Ids do roteiro (além de `n01`..`n60`)

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
