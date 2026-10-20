# Revisão QA — Fase 2 (Altina da Sorte🍀 v2)

Revisor independente (`qa-reviewer`). Nenhum código de produção foi alterado. Escopo: tudo da seção 7 de `docs/SPEC-v2.md`, **exceto** Lighthouse, offline/SW e migração v1→v2 (do `perf-pwa`). Tudo foi medido no **app real** (build de produção em `vite preview --port 4181`), forçando estados por `localStorage` (plano determinístico em `round.plan`, aposta, saldo, correio), além de testes de `RoundSession`/`game.ts` em Node e das ferramentas do simulador.

**Veredito: sem BLOQUEANTES. Aprovado condicionalmente: 4 IMPORTANTES precisam voltar aos responsáveis antes do deploy** (1 é bug de saldo: pagamento duplicado ao recarregar logo depois da última bola). O resto do checklist passa com evidência.

## Como reproduzir

```
npm run build && npx vite preview --port 4181 &          # QA_BASE padrão = http://localhost:4181
npx tsx tests/e2e/qa/rules.ts      # regras puras (RoundSession/payout/patterns/cards/diretor), 55 checagens
npx tsx tests/e2e/qa/game.ts       # game.ts em Node, 1 processo por cenário (retomada, turbo, correio, admin, presente, auto, acumulado)
npx tsx tests/e2e/qa/flows.ts      # app real: rodada normal, Turbo, extras, acumulado, controles, trilho, correio, reload, M7, M12 ...
SHOT=docs/qa npx tsx tests/e2e/qa/layout.ts   # 38 estados x 5 viewports no app real + screenshots docs/qa/review2-*.png
npx tsx tests/e2e/qa/static.ts     # clipes/manifest, WAV, palavras proibidas, animações, setInterval, viewport, tamanhos, narração por eventos
npx tsx tests/e2e/qa/robust.ts     # storage corrompido, sem localStorage, toques repetidos, segundo plano
npx tsx scripts/simulate.ts --seeds 30
npx vitest run && npx playwright test
```
Scripts atualizados para a API v2: `fixtures.ts` (saves v2, `mkPlan`, `nearBingo`, `nearDouble`, `withRound`), `browser.ts` (instrumentação: timers vivos, setInterval, falas sintetizadas, legendas com classe `spk`/`hot`, AudioContext, requisições de áudio), `rules.ts`, `game.ts`, `flows.ts`, `layout.ts`, `robust.ts`, `static.ts`. (`offline.ts` é do perf e não foi tocado.)

Resultados desta rodada: `npx vitest run` 98/98 (5 arquivos); `npx playwright test` 3/3 (`round.spec.ts`, 1280x800, 800x1280, 360x740); `rules.ts` tudo OK; `static.ts` tudo OK; `robust.ts` tudo OK; `game.ts` e `flows.ts` com as falhas listadas em "Achados" (cada uma é um achado real, não erro de teste).

## Checklist (seção 7)

| Item | Resultado | Evidência |
|---|---|---|
| Bolas 1–90, 30 sorteadas, cartelas 3×5, faixas de 18 | OK | `rules.ts`: 4000 cartelas aleatórias, 0 violações (coluna c usa 18c+1..18c+18, ordenada, sem repetidas); cada coluna vê as 18 bolas; 1500 planos do Diretor (2 conjuntos): 30 principais distintas, ≤9 extras, sem repetição, 1..90, cobertura 90/90. `flows.ts [controls]`: cartelas na tela com faixa correta. Trilho: cor da bola por faixa de 18 (`r1..r5`) conferida |
| Aposta 1–10 | OK | `flows.ts [controls]`: percorre 10,9…1 pelos botões; − desabilita em 1, + em 10; "Total 40" a 10×4; tabela atualiza (aposta 1: 5/25/500, 2: 10/50/1.000, 3: 15/75/1.500, 10: 50/250/5.000) |
| Cartelas 1–4 pelo controle; tocar na cartela não faz nada | OK | `[controls]`: − até 1 → 3 cartelas "Desligada"; + até 4; tocar em cartela e célula (ocioso e durante o sorteio) não muda `active` nem a aposta total (M11). `game.ts [limits]`: limites e que durante a rodada aposta/cartelas/Números são ignorados |
| Linha ×5, Linha dupla ×25, Bingo ×500 (só o maior) | OK | `rules.ts`: cada padrão paga só o seu; 2 linhas = Linha dupla (não soma); classico: U e moldura pagam Linha / Linha dupla; variado mantém os 7 (×3/×8/×12/×40); 4 cartelas pagam cada uma o seu maior |
| Acumulado só até a 30ª, 100%/75%/50% (apostas ≥3/2/1) | OK | `rules.ts`: apostas 1..10 × 2 conjuntos × acumulado 5400 e 5001: paga floor(acumulado × parcela); bingo nas bolas 15/20/29/30 paga; bingo na extra 1 e na extra 9 NÃO paga (só ×500); 2 cartelas com bingo na mesma bola pagam o acumulado 1 vez. **App real** (`flows.ts [jackpot]`, plano injetado, bolas 29→30): aposta 1 → celebração **+3.200** (2.700 + 500), aposta 2 → **+5.050**, aposta 3 → **+6.900**, aposta 10 → **+10.400**; créditos 500→3.700/5.550/7.400/10.900; acumulado volta a 5.000; bingo na bola extra → **+2.500 sem texto "ACUMULADO"**. Tabela mostra "Acumulado: 50%" / "75%" nas apostas 1/2 e 5.000 cheio a partir de 3. `game.ts [bingo-jackpot-share]` repete no `createGame` |
| Até 9 extras, só com "falta 1" | OK | `rules.ts`: plano com 13 extras → só 9 ofertas; 3 e 2 números faltando → nenhuma oferta; cartela cheia → nenhuma. App real: 9 compras seguidas (contadores "Extra 1 de 9"… "Resta 1 bola extra"), depois nenhuma oferta; trilho com 30 + 9 extras acesas |
| Extra grátis aparece e não debita | OK | App real (`flows.ts [extra]`, plano `free:[true]`, bet 5): título "BOLA EXTRA GRÁTIS!", botão "BOLA GRÁTIS", classe `free` dourada, selo "FALTA 1 → Linha dupla: +125"; saldo **800 antes / 800 logo após comprar**; final 925 (800+125). Paga (`free:[false]`): "custa 10"; **800 → 790**; final 915. `game.ts [free-extra]`/`[paid-extra]`: mesmos números + `extraCost`/`freeExtras` no sumário, evento `freeExtra` só quando grátis |
| Turbo antes e durante; voz só nos prêmios | OK | App real: Turbo ligado antes → 30 bolas em 5,4 s, mediana **121 ms** por bola; liga/desliga persiste após reload; **Turbo no meio** (clique na UI na 3ª bola) → mediana 121 ms e termina. `game.ts [turbo-mid]`: dorme 2 s é acordado (0 ms); desligar volta a 2000 ms. Voz: em Turbo as legendas faladas foram só a saudação e "Linhaaa!/Fez linha!"; `static.ts` com eventos do bus: números/bordões/"falta 1" calados, Linha, Linha dupla, oferta ("Linha dupla, valendo!") e "Bola extra grátis!" (1 vez) falados, "Turbo!" ao ligar |
| Correio da sorte | OK | App real: diário na 1ª abertura do dia — ícone 76×76 px balançando com 🍀, créditos NÃO entram sozinhos (M6), toque abre tela "🍀 Correio da sorte da Dona Altina! +300 créditos / PEGAR"; PEGAR → 1.300, ícone some, `lastDailyBonus`=hoje, reabrir no dia não repete. Nunca sobre a oferta de extra (carta pendente + oferta: nem ícone nem tela) nem durante o sorteio (ícone some). `game.ts [mail-bonus]` (relógio injetado): com 5 min jogados nada; após >30 min chega bônus de 10–100 só em `idle`; segundo só com ≥60 min; **3º/4º não vêm (máx. 2/dia)**; dia seguinte reinicia |
| Trilho 30+9, contador, tabela fixa com a aposta atual | OK | `flows.ts [trail]`: 3 fileiras de 10 (offsetTop), em ordem de sorteio, 9 casas tracejadas, contador "Bola N de 30" avança 1→5, "Extra N de 9"; tabela fixa por aposta (acima). Celular: trilho vira faixa das últimas 10 + contador (`layout.ts`) |
| Simulador dentro das metas | OK | `npx tsx scripts/simulate.ts --seeds 30` (3 perfis × 30 seeds) e `--seeds 6`: "todas as metas atendidas". 100% dos meses completos com 2–3 bingos (média 2,3–2,4/mês, 0 meses com 0 ou 4+), intervalo mín 7,0 d, 1º bingo mín 2,0 d (decorridos = dia 3), sem prêmio 58,3/59,2/59,2% (55–62), ≥1 Linha 36,7/36,0/36,0% (30–38), Linha dupla 5,9/6,2/6,2% (5–8), ofertas de extra 27,6/27,2/26,9% (25–35), grátis/ofertas 17,5/17,1/17,6% (15–20), RTP comuns 0,881/0,894/0,893, recargas em 90 d: máx 0/1/**8** (meta ≤ ~20). Parcial do acumulado: aposta 1 paga 50% (média 2.534), aposta 2 paga 75% (3.853). Margem pequena: ≥1 Linha em 36–37% (teto 38%) |
| Clipes de voz, 0 × 404, legenda = fala | OK (ver I2) | `public/audio/voice/manifest.json`: **142 ids** = as 142 falas de `script.ts` (90 números, 5 bordões, extra grátis, correio, turbo, linha dupla valendo…); todos com `.webm` e `.mp3` > 1,5 KB; pacote 1,40 MB (≤3 MB); `voice-custom/manifest.json` = `{"ids":[]}`. Rodada completa no app real: **144 requisições de áudio, todas 200, 0 × 404**, 0 erros JS. Legenda: das 33 legendas faladas da rodada, 33 são exatamente textos do roteiro (M9) |
| `docs/qa/audio-preview.wav` | OK | existe, RIFF/WAVE 44,1 kHz 16 bits estéreo, 48,0 s, RMS −22,4 dBFS, pico 0,68, 1 de 96 trechos de 0,5 s silencioso. (Não foi possível ouvir; só validado tecnicamente) |
| Bundle JS ≤ 60 KB; 1ª carga sem áudio ≤ 250 KB | OK | build: JS 89,75 KB / **33,4 KB gzip**, CSS 27,6 KB / **6,5 KB gzip**; html+css+js+manifest+ícone = **62,6 KB gzip** |
| M1–M12 | Ver tabela abaixo | |
| Nenhuma menção a dinheiro/loja/anúncio/app de terceiros/link externo | OK | `static.ts`: varredura de `src/`, `public/`, `dist/` (JS, HTML, CSS, manifest) por R$, reais, dinheiro, loja, anúncio, nomes de apps/redes, `http(s)://`, `www.` → 0 ocorrências; strings de UI/voz sem "compra"/"dinheiro". `bola extra` custa "créditos" fictícios |
| Testes unitários e e2e | OK | vitest 98/98; playwright 3/3 |
| Screenshots nos 5 viewports | OK | `docs/qa/review2-<estado>-<WxH>.png` (112 arquivos): todos os estados-chave nos 5 viewports, demais em 1280×800 e 360×740 |

### Layout em estados reais (5 viewports: 1280×800, 800×1280, 1024×768, 768×1024, 360×740)
`layout.ts`: 38 estados × 5 = 190 combinações no app real: splash, ocioso (aposta 1/10, 1 cartela, **créditos e acumulado de 7 dígitos**), correio chegando/bônus/aberto, sorteio, sorteio com Linha, Turbo, **oferta de extra paga / grátis / para bingo / 7 dígitos / "Extra 3 de 9"**, **celebração Linha dupla / Bingo / modo leve / 7 dígitos**, presente, Prêmios (aposta 1, variado), Ajustes (3 abas), PIN, admin, e tamanhos de texto grande/muito grande.
Com texto **normal**: **0 rolagem de documento, 0 alvo < 64 px, 0 texto < 20 px, 0 espaço < 12 px entre alvos, 0 diálogo com rolagem, 0 FECHAR/PEGAR/CONTINUAR fora da tela**, 0 sobreposição de regiões, 0 erros JS, 0 requisições ruins — nos 5 viewports, incluindo oferta de extra, celebração e correio. Exceções (achados I4, M-g e M-h): texto "Muito grande" em 360×740; selo "FALTA 1 → BINGO: +2.500" cortado em 5 px em 360×740; PIN/admin não abrem em 360×740 (logo escondido).

### M1–M12

| # | Status | Evidência |
|---|---|---|
| M1 modais exigem rolagem | Resolvido | `layout.ts`: diálogos (Prêmios, Ajustes 3 abas, PIN, admin, presente, correio, celebração) sem rolagem interna e com rodapé (FECHAR/PEGAR/CONTINUAR) dentro da tela nos 5 viewports; screenshots `review2-settings-360x740.png`, `review2-prizes-*` |
| M2 espaçamento < 12 px | Resolvido | `layout.ts`: 0 achados "ESPACO" em 190 combinações (texto normal) |
| M3 "Acumulado" cortado | Resolvido | `idle-7digitos`, `extra-7digitos`, `celebracao-7digitos` (1.234.567 em créditos e acumulado) sem CORTE em 360×740 |
| M4 ~414 requisições 404 | Resolvido | manifest com ids; rodada real: 144 requisições de áudio, todas 200 (`flows.ts [normal]`) |
| M5 auto após presente | Resolvido | `game.ts [gift-auto]`: PEGAR o presente desliga o automático; auto joga até a oferta e desliga |
| M6 bônus diário sem tela | Resolvido | ícone + tela + PEGAR (tabela do checklist). Ver MENOR M-d/M-e |
| M7 modo leve sozinho | Resolvido | `flows.ts [m7]`: 1ª abertura com `prefers-reduced-motion` sugere leve (`light:true`, `lightManual:false`); desligar manualmente grava `lightManual:true`; reload mantém; com CPU 25× mais lenta o leve **não** liga no carregamento nem nas rodadas 1–3, liga só no sorteio da 4ª rodada e **nunca sobrescreve a escolha manual** |
| M8 `user-scalable=no` | Resolvido | `index.html:5` só `width=device-width, initial-scale=1, viewport-fit=cover`; `touch-action: manipulation` presente |
| M9 legenda ≠ fala | Resolvido (nota M-j) | legendas faladas = texto do roteiro (33/33); `main.ts` liga `audio.onCaption(setSpokenCaption)`; em Turbo o efeito "falta 1" também fica calado (`static.ts` com spy em `sfx.almost`: 1 no normal, 0 em Turbo) |
| M10 `extraSpent` perdido ao retomar | Resolvido | `game.ts [resume-offer]`: retoma na oferta com `extraSpent=10`, compra mais uma → `extraCost` do sumário = **20**; `flows.ts` idem; `robust.ts R11` |
| M11 tocar na cartela a desliga | Resolvido | `flows.ts [controls]` (tabela do checklist) |
| M12 espera infinita de fala | Resolvido | código: `engine.ts` `CLIP_SLACK_MS=1500` (duração do clipe + 1,5 s), `DECODE_TIMEOUT_MS`, retoma `AudioContext` suspenso. App real: `AudioContext.suspend()` chamado 8× em 12 s no meio da rodada → a rodada **continua** (bolas 2→7), sem travar |

## Achados

### BLOQUEANTE
Nenhum.

### IMPORTANTE

**I1. Recarregar/fechar logo depois da última bola paga o prêmio DUAS vezes (e repete a rodada)** — `src/game.ts:196-242` (`settle`) com `persist` em `:84-100` e o flush em `src/storage.ts:172-177`.
`settle()` credita o prêmio e atualiza estatísticas/Diretor em `:202-218`, mas `data.round` (a rodada em andamento, com `mainIdx=30`) só é zerado em `:238` (`persist(false)` ao voltar a `idle`) ou `:226` (celebração). Entre os dois há `await sleep(prêmio>0 ? 1800 : 900)` (`:233`). Se a página for recarregada/escondida nessa janela, `pagehide`/`visibilitychange` gravam o `data` já creditado **com** `round` ainda preenchido; ao reabrir, a rodada é "retomada", cai em `settle` de novo e paga outra vez.
Reproduzir: `npx tsx tests/e2e/qa/flows.ts reload` (plano com Linha na 30ª bola, Turbo; recarregar 450 ms depois de ENTRAR). Medido: créditos 980 → **1.030** (esperado 1.005), `stats.rodadas = 2`. Manual: jogar com Turbo uma rodada que pague Linha e dar F5 1 s depois da última bola. Efeito colateral: Diretor/estatísticas contam a rodada duas vezes; em rodadas sem prêmio o jogo reabre "sorteando" uma rodada que já terminou.
Correção sugerida: em `settle`, logo após creditar, fazer `data.round = null; saveNow(data)` (antes do `sleep`).

**I2. A saudação ao entrar sai na voz do tablet (speechSynthesis), não no clipe** — `src/game.ts:328` (`audio.greet` logo após `audio.unlock`), `src/audio/index.ts:222-224`, `src/audio/narrator.ts` (`start`: se `clips.has(id)` for falso cai no `synth`).
Medido (`flows.ts [normal]` e `[turbo]`): 1 fala sintetizada, "Boa tarde, Dona Altina! Vamos jogar?" a ~230 ms do toque em ENTRAR; os clipes só começam a baixar nesse mesmo instante. Contraria 5.1 ("o jogo nunca depende da voz do tablet"): a primeira coisa que ela ouve é a voz robótica, diferente do resto. O mesmo vale para os primeiros números se ela jogar antes do pacote baixar (números são os últimos na ordem de pré-carga) em rede lenta.
Sugestão: pré-carregar `greet_*`/`start_*` na splash (antes do ENTRAR) e esperar o clipe (ou calar o sintetizador quando houver manifest de voz).

**I3. O painel do administrador não tem como trocar o conjunto de padrões** — `src/ui/modals.ts:293-345` (diálogo `A`: só Exportar/Importar/Zerar acumulado/Zerar créditos) vs `src/game.ts:541-550` e `src/gameApi.ts:58` (`admin.setPatternSet` existe e funciona).
A spec 2.3 diz "Troca só pelo painel do administrador". Reproduzir: logo ×5 → PIN 1958 → não há botão "classico/variado". A API foi validada em Node (`game.ts [admin-set]`: exige PIN, ignora durante a rodada, grava `altina-da-sorte:patternSet`, tabela passa a 7 padrões, acumulado e valores corretos), mas ninguém consegue acioná-la. O conjunto `variado` está coberto por testes, só não é alcançável.

**I4. Texto "Muito grande" (e em parte "Grande") quebra as cartelas no celular 360×740** — `src/styles/tokens.css:47-48` (`--ts:1.25`) com o layout de celular (`src/styles/components.css:370-402`, `layout.css:94+`).
Medido (`layout.ts`): célula da cartela com **13 px** de altura em "Muito grande" (números sobrepostos e ilegíveis, `docs/qa/review2-idle-textomuito-360x740.png`) e 19 px em "Grande" (`...idle-textogrande-360x740.png`); botão JOGAR com texto cortado (118>114 px). Em tablets (1280, 1024, 800, 768) está ok (só 3 px de linha cortados nos valores de crédito, `CORTE-V 45>42`, sem perda visível; "TERMINAR" 9 px estreito em 1024×768/muito e contador cortado 26 px em 1024×768/celebração/muito). Reproduzir: Ajustes → Tela → Muito grande, viewport 360×740.

### MENOR

- **M-a. Valor do acumulado parcial mostrado ≠ valor pago (±1 crédito)** — `src/ui/prizeView.ts:~507` e `src/ui/modals.ts:399` usam `fmt(jackpot × parcela)` (`dom.ts` arredonda com `Math.round`), enquanto o pagamento usa `Math.floor` (`src/payout.ts:224`, `round.ts`). Aposta 2, acumulado 5.001: tabela mostra **3.751**, paga **3.750**; aposta 1, 5.003: mostra 2.502, paga 2.501 (`flows.ts jpdisplay`). Usar `Math.floor` na exibição.
- **M-b. Em Turbo a bola extra comprada é muda** — `src/game.ts:122` (`ballDrawn.fast` leva a variável `fast` do Turbo também nas extras, `extraLoop` não a zera) e `src/audio/index.ts:126`. Só toca "Mais uma chance!" e o tique; o número da bola decisiva não é falado (`static.ts`: `Turbo + bola EXTRA: falas=[]`). Sugestão: `fast:false` para `extra:true`.
- **M-c. `updateSettings` antes de ENTRAR descarta a rodada salva (aposta perdida)** — `src/game.ts:84-98`: `persist(false)` faz `data.round = null` mesmo com rodada carregada do disco e ainda não retomada. Alcançável por `src/main.ts:56` (1ª abertura com `prefers-reduced-motion` que já tenha save) ou mexendo em ajustes por teclado atrás da splash. Teste: `game.ts splash-wipe` (rodada salva some após `updateSettings`; ENTRAR vai para `idle`). Latente (raro).
- **M-d. Tablet aberto atravessando a meia-noite não recebe o correio diário** — `src/game.ts:350` (só `enter()` cria o correio diário). `game.ts midnight`. Como o app mantém a tela acesa, isso é plausível; ela só o recebe ao reabrir.
- **M-e. "Automático" fica ligado e parado com correio pendente** — `src/game.ts:244-246` e `:471`: `setAuto(true)` com carta pendente não joga e não desliga; depois do PEGAR nada reinicia (`game.ts auto-mail`).
- **M-f. Celular: selo de prêmio cobre a cartela e o aviso "FALTA 1 → BINGO: +2.500" fica cortado em 5 px em 360×740** — `src/styles/components.css:217-229`, `:397-402` (`review2-extra-bingo-360x740.png`: selo "LINHA DUPLA +125" sobre a cartela 1; `layout.ts` `CORTE-H 153>148`).
- **M-g. Celular: painel/PIN inacessível** — o logo é escondido em 360 (`src/styles/layout.css:109`) e, na splash, o diálogo do PIN (z-index 50, `components.css:254`) fica atrás da splash (z-index 60, `:334`). Só tablet abre o painel do neto. `layout.ts` não consegue forçar `pin/admin` em 360×740.
- **M-h. Contador volta a "Bola 30 de 30" depois de extras** — `src/ui/index.ts:151-154` + `getView().extrasDrawn` zera quando a sessão acaba (`src/game.ts:309`): ao fim de uma rodada com 9 extras o trilho mostra 39 bolas e o contador diz "Bola 30 de 30". Cosmético.
- **M-i. Legendas ≠ voz em 8 falas e aviso visual em Turbo** — 8 falas têm legenda esticada ("Linhaaa!", "BINGOOO!!!", "ACUMULADOOO!…") e voz normal ("Linha!", "Bingo!", "Acumulado!"): mesma palavra, aceito. Em Turbo o aviso visual "FALTA 1!" (classe `hot`) aparece sem fala correspondente; é um aviso, não legenda, mas se o critério for estrito "legenda = fala" convém ocultá-lo em Turbo.
- **M-j. Admin acessível durante o sorteio** — `importJson`/`resetCredits` funcionam no meio da rodada (`game.ts admin-mid`: sem erro, saldo importado vale); sem risco para a jogadora, mas sem trava de fase.

## Travas, timers e animações
- **Travas (jogo preso)**: nenhuma encontrada. 11 variações de rodada salva corrompida (sem `extras`, `main` curto, bola 91, sem `active`, `free` inválido, `mainIdx` 99, `extraSpent` negativo, aposta 20, cartela fora da faixa, `credits` string, `version:3`) → o jogo sempre abre jogável (`robust.ts`); JSON inválido e `localStorage` bloqueado → joga uma rodada inteira sem erro; duplo/triplo toque em JOGAR debita 1×; segundo plano e volta continua; `AudioContext` suspenso não trava (M12). Ofertas de extra e celebração esperam o toque por design.
- **Timers**: 0 `setInterval` em `src/` (grep) e 0 chamadas em runtime; 6 rodadas em Turbo seguidas: 1 timeout vivo em repouso (constante), 466 nós de DOM (constante), 0 animações ativas, 0 confete.
- **Animações**: 7 `@keyframes`, transitions e `.animate()` usam só `transform`/`opacity`; modo leve e `prefers-reduced-motion` desligam tudo. Ícone do correio balança em loop enquanto houver carta (por spec).
- **Retomada** (`game.ts`): meio da rodada (12 bolas, crédito 777 sem novo débito, histórico no trilho, termina 1×), oferta com extra paga (M10), oferta grátis, reload na oferta (saldo intacto), reload na celebração (já correto: `round=null` + `saveNow`). A única falha é a janela de liquidação (I1).
- **Auto/presente/Turbo no meio/correio/admin**: ver `game.ts` (todos OK exceto M-d, M-e).

## Não verificado
Lighthouse, offline/SW, migração v1→v2 (perf-pwa). Qualidade, volume e ducking reais de voz/música/prévia (só validação técnica do WAV e eventos). Teste em tablet físico; contraste AAA medido (inspeção visual). Instalação na tela inicial.

---

## Correções (atualizar após o retorno dos responsáveis)
- [ ] I1 pagamento duplicado — `game-rules-engineer`
- [ ] I2 saudação em clipe — `audio-designer`
- [ ] I3 controle de conjunto de padrões no painel — `elderly-ux-designer`
- [ ] I4 "Muito grande" no celular — `elderly-ux-designer`

---
## Correções do orquestrador após a revisão
- I1 prêmio pago 2x ao recarregar: `data.round=null` + `saveNow` logo após creditar (`game.ts`); verificado com `tests/e2e/qa/flows.ts reload`.
- I2 saudação agora espera o clipe carregar (até 1,5 s) antes de falar (`audio/index.ts`).
- I3 botão de conjunto de padrões no painel admin (`ui/modals.ts`).
- I4 texto grande/muito grande limitado em telas ≤480 px (`styles/tokens.css`).
- Menor: acumulado parcial exibido com `floor` (igual ao pago).
- Não corrigidos (menores): extra comprada em Turbo muda; correio diário não chega se o tablet atravessa a meia-noite aberto; botão Automático parado com correio pendente; PIN/admin no celular; legenda esticada x fala.
- Screenshots `review2-*.png` (23 MB) removidos do repositório; regeneráveis com `tests/e2e/qa/layout.ts`.
