# Áudio leve (v3, seção 3.5.4): números antes e depois

Medido em Chromium headless (Playwright + CDP) com `npx tsx scripts/audio/perf-music.ts <raiz-src> <segundos> [eco|none]`
(`THROTTLE=6|20` liga `Emulation.setCPUThrottlingRate`). "Antes" = commit `496457b` (música agendada nota a nota);
"depois" = música pré-renderizada com `OfflineAudioContext` e tocada como `AudioBuffer`.
A máquina de teste é lenta (renderização offline ~0,2x tempo real), então os tempos absolutos de preparo são pessimistas.

## 1. Custo da música tocando (30 s, calmo, 1x)

| Métrica | Antes | Depois | Observação |
|---|---|---|---|
| Nós Web Audio criados por segundo | 57 | **0,03** (1 fonte por loop de ~19 s) | contagem em `BaseAudioContext.create*` |
| Callbacks de `setTimeout` por segundo | 9 | **0,03** | antes: lookahead a cada 110 ms |
| CPU de todos os processos (inclui thread de áudio), 30 s | 1,95 s / 1,81 s (6,3 %) | **0,67 s / 0,71 s (2,3 %)** | linha de base com o contexto aberto e **sem música**: 0,63 s por 30 s (2,1 %) |
| CPU atribuível à música | ~1,25 s por 30 s (4,2 %) | **~0,05 s (≈ 0)** | |
| Thread principal (`TaskDuration`), 30 s | 0,139 / 0,132 s | **0,037 / 0,041 s** | |
| Thread principal com CPU 6x, 30 s | 0,545 s (`ScriptDuration` 0,433) | **0,269 s** (`ScriptDuration` 0,002) | |

Conclusão: depois de pronta, a trilha custa praticamente só o mixador nativo (um `AudioBufferSourceNode` + 1 `GainNode`).

## 2. Custo único da pré-renderização (depois do ENTRAR, em tempo ocioso)

| Cenário | Pronto p/ tocar (calmo+animado, 1ª variação) | Tudo pronto (3 variações + stingers) | Memória dos buffers |
|---|---|---|---|
| Normal (44,1 kHz do dispositivo), 1x | 7,9 s | 30 s | 20,6 MB |
| **Econômico (24 kHz)**, 1x | 4,3 s | 12 s (2 variações) | **7,8 MB** |
| Normal, CPU 6x | 9,5 s | 38 s | — |

- A construção do grafo é feita em fatias de ≤ 5 ms de JS com 12 ms de pausa entre elas (`setTimeout`); a renderização em si é nativa
  (fora da thread principal). Depois da 1ª variação, as tarefas seguintes são espaçadas de 1,5 s para não disputar CPU com o jogo.
- Tarefas longas da thread principal (PerformanceObserver `longtask`, ≥ 50 ms): **0 em 1x e 0 em 6x** (numa rodada anterior a
  montagem do stinger numa só tacada gerou 56–118 ms a 6x; foi dividida em fatias). Com **CPU 20x**: tarefas de 50–106 ms
  (equivalem a 3–5 ms reais; vêm da finalização nativa/GC), fora o `unlock()` inicial (~190 ms a 20x, que já existia).
- Enquanto o 1º loop não está pronto não toca nada (conforme pedido); na prática são ~4–8 s depois do ENTRAR nesta máquina,
  durante a saudação. Se `OfflineAudioContext` não existe ou a renderização falha antes do 1º loop, cai na música procedural ao vivo (v2).

## 3. Soa igual?

Prévia WAV (`npm run audio:preview`, 48 s) antes x depois (as harmonias/tonalidades são sorteadas a cada execução, então compara-se o perfil):

- RMS total: -22,36 dBFS x -22,39 dBFS. Pico: 0,68 x 0,76 (a variação vem do sorteio da tonalidade).
- Energia por banda (dB relativos ao total) 0–100/100–250/250–500/500–1k/1–2k/2–4k/4–8k/8k+ Hz:
  antes -6,2/-13,4/-6,3/-4,8/-8,8/-18,3/-27,6/-35,3; depois -5,5/-14,1/-6,2/-5,2/-9,0/-18,5/-27,7/-36,2 (diferenças ≤ 0,8 dB).
- Por trechos de 8–16 s, a diferença de RMS é ≤ 0,3 dB.
- Mesmos instrumentos, ganhos e padrões (o sequenciador foi extraído sem mudar nenhum número); por isso `docs/qa/audio-preview.wav`
  **não foi regenerado** (mudança não audível). A prévia agora espera a pré-renderização antes de iniciar (`music.whenReady(true)`).

## 4. Voz sob demanda (LRU)

- `preload()` só baixa (comprimido, ~7 KB/clipe, 142 clipes ≈ 1 MB); **nunca decodifica**. Teste: 142 clipes baixados, 0 decodificações.
- Decodificação só em `play()` (+ `warm()` de poucos ids). Cache LRU limitado por quantidade **e** bytes (vale o que estourar primeiro):
  **48 clipes / 24 MB** (normal) e **32 clipes / 12 MB** (econômico). Um clipe de ~1,5 s a 48 kHz mono pesa ~290 KB → o limite
  de 48 (~14 MB) é o que vale na prática; o de bytes protege contra clipes longos/estéreo. Escolha: o menor valor que mantém folgado o ciclo
  de 30–40 números recentes + prêmios sem redecodificar durante uma rodada (a redecodificação custa ~10–30 ms e é feita antes de tocar).
- Falas de prêmio/oferta (2 primeiras variações de cada padrão + oferta/grátis) são decodificadas em `roundStart` e **fixadas** (até 24):
  só saem do cache se não houver mais nada a liberar. `AudioApi.hintNext(balls)` decodifica até 6 números prováveis (opcional, a integração decide).
- Testes: 142 clipes tocados em sequência nunca passam de 48 buffers vivos; clipes grandes respeitam 24 MB; econômico libera na hora até 32.

## 5. AudioContext suspenso quando parado

- Sem fala/efeito/evento por 90 s **e** sem música audível tocando → `ctx.suspend()`. Volta com `wake()`: `unlock()`, `play()`, qualquer efeito
  (`Sfx`), `setSpeaking(true)`, qualquer evento do barramento e `setMode`. O handler M12 de `onstatechange` não retoma um contexto suspenso por ociosidade.
- Música tocando em primeiro plano (não mutada) mantém o contexto; se a música for desligada/silenciada o contexto suspende na próxima conferência.
  Segundo plano continua pausando por `visibilitychange` (a música derruba seus nós ao pausar).
- Um único timer de ociosidade (rearmado sob demanda), 2000 chamadas de `wake()` não criam timers.

## 6. Resistência (tests/music.test.ts)

500 rodadas de eventos no barramento (30 bolas, quase, prêmio, oferta, fim) com motor falso e relógio simulado: listeners idênticos
no início e no fim, timers ≤ +2, fontes de áudio vivas ≤ +4, buffers decodificados ≤ 48; após `dispose()` 0 listeners e 0 timers.

## 7. Alvo Android 5/6 (Chrome/WebView ~60–72)

- `OfflineAudioContext` (ou `webkitOfflineAudioContext`) **sempre com o construtor de 3 argumentos** `(canais, quadros, taxa)`.
- `startRendering()` aceita Promise **ou** o evento `oncomplete`; `decodeAudioData` usa callbacks e Promise (o que vier primeiro);
  `AudioContext` sem prefixo ou `webkitAudioContext`. Nada de `new AudioBuffer()`, `copyToChannel` ou construtor com objeto de opções.
- Cobertos em `tests/music.test.ts` (construtor de 3 args, decode só com callbacks, fallback procedural sem OfflineAudioContext ou com falha).
- Não testado em aparelho real (só Chromium atual): confirmar no tablet o tempo até o 1º loop e a taxa de 24 kHz no modo econômico.
