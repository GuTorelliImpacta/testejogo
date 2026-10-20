# PROMPT PARA O CLAUDE CODE — Altina da Sorte🍀 v2 (fidelidade ao vídeo bingo + pendências)

> Cole este documento no Claude Code **dentro do repositório `testejogo`**. O jogo já existe e está bom. **Não reescreva o projeto**: implemente só as alterações descritas aqui, mantendo arquitetura, contratos, testes e decisões que já funcionam. `docs/SPEC.md` continua valendo em tudo que este documento não altera; ao final, atualize o `SPEC.md` com as mudanças.

---

## 0. Como trabalhar (orquestrador + subagentes)

Você é o **ORQUESTRADOR**. Os subagentes já existem em `.claude/agents/`. Reutilize-os e **atualize as definições** com o novo escopo abaixo (missão, arquivos, critérios de pronto). Não crie agentes novos sem necessidade.

| Agente | Nesta versão é responsável por |
|---|---|
| `game-rules-engineer` | Bolas 1–90, novas regras de prêmio, acumulado por nível de aposta, 9 bolas extras + bola grátis, aposta 1–10, botão Números, Turbo, correio da sorte (regra), migração do save |
| `odds-director` | Recalibrar Diretor, drawBuilder e simulador para 90 bolas e a nova tabela; bola extra grátis; metas da seção 4 |
| `elderly-ux-designer` | Novo layout estilo vídeo bingo (seção 3), tabela de prêmios fixa, trilho de bolas, contador, painel de bola extra, correio da sorte, correções de modais/espaçamento |
| `audio-designer` | Clipes de voz reais (1–90 + falas), som do globo, novas falas, prévia de áudio em arquivo, correções de áudio pendentes |
| `perf-pwa-engineer` | Migração de dados v1→v2, Lighthouse medido, modo leve, viewport, manifests de áudio, cache do SW para o pacote de voz, deploy |
| `qa-reviewer` | Revisão independente ao fim de cada fase com o checklist da seção 7; relatório em `docs/qa/review-fase2.md` |

Regras:
1. **Contratos primeiro**: você atualiza `src/types.ts`, `src/events.ts` e `src/config.ts` antes de disparar os agentes (novos eventos: `freeExtra`, `mailbox`, `turboChanged`; `ballDrawn` passa a carregar `index` e `total`).
2. **Paralelize**: fase B roda `game-rules-engineer`, `odds-director`, `elderly-ux-designer` e `audio-designer` ao mesmo tempo.
3. **Escopo fechado** por agente; mudança de contrato passa por você.
4. A cada fase: `npm test`, `npm run build`, `npm run simulate` e relatório curto para mim (o que mudou, saída do simulador, bundle, pendências).
5. **Antes de chamar qualquer API paga de TTS, pare e me pergunte** (seção 5.1).

---

## 1. Diagnóstico da versão atual (já verificado)

**Funciona e deve ser preservado:** 50 testes passando; build OK (JS 28 KB gzip, CSS 5,2 KB gzip); simulador com 2–3 bingos/mês em 100% dos meses nos 3 perfis; layout sem rolagem nos 5 viewports; retomada de rodada; música procedural e efeitos sintetizados originais; correções A1–A4 da revisão QA.

**Divergências em relação ao jogo de referência (vídeo bingo de 90 bolas, que é o que a Dona Altina joga):**
- bolas de 1 a 60 (a referência usa **1 a 90**);
- 10 bolas extras (a referência usa **9**, com bola extra **grátis** de vez em quando);
- 7 padrões de prêmio (a referência paga **Linha, Linha dupla e Bingo**, mais o **Acumulado**);
- aposta 1/2/5/10/20 (a referência usa **1 a 10** por cartela);
- não existe Turbo, botão "Números", contador de bolas, tabela de prêmios fixa na tela nem bônus em forma de correio.

**Pendências da especificação anterior que ainda não foram entregues (obrigatórias nesta versão):**
- **A5** — nenhum clipe de voz commitado; a narração depende 100% do `speechSynthesis` do tablet, que não tem o tom animado pedido.
- **M1** modais exigem rolagem / FECHAR fora da tela; **M2** espaçamento < 12 px; **M3** "Acumulado" cortado em 360 px.
- **M4** ~414 requisições de áudio inexistentes a cada ENTRAR.
- **M6** bônus diário entra sem tela (ela nem percebe).
- **M7** modo leve liga sozinho e fica gravado; **M8** `user-scalable=no`.
- **M9** legenda diferente da fala; **M10** custo de extras perdido ao retomar; **M11** tocar na cartela a desliga sem querer; **M12** possível espera infinita de fala.
- **Lighthouse nunca foi medido.**

---

## 2. Regras novas (fidelidade ao vídeo bingo de 90 bolas) — `game-rules-engineer`

> Replique a **mecânica**. Não use o nome, a arte, os sons nem os textos de nenhum app existente. O nome continua **Altina da Sorte🍀** e a jogadora continua sendo tratada por **Dona Altina**. O app de referência tem outros jogos (caça-níqueis etc.); **ignore-os**: o Altina da Sorte é só o bingo, sem menu de jogos.

### 2.1 Bolas e cartelas
- Globo com **90 bolas (1 a 90)**. Sorteio principal de **30 bolas**.
- 4 cartelas de **3 × 5 = 15 números**. Coluna `c` (0–4) usa a faixa `18c+1` a `18c+18`, ordenada de cima para baixo.
- Cores das bolas por faixa de 18 números (5 cores).

### 2.2 Aposta e cartelas
- Aposta **por cartela de 1 a 10** créditos (passo 1), botões − e + grandes. Padrão: **5**.
- Quantidade de cartelas (1 a 4) **sai do toque na cartela** (corrige M11). Ela vai para um controle "Cartelas: 4" com − e + na barra inferior (ou em Ajustes, se faltar espaço). Padrão: 4.
- O botão "Trocar cartelas" passa a se chamar **"Números"**: gera cartelas novas para todas as cartelas de uma vez, só entre rodadas, com uma animação curta de embaralhar.

### 2.3 Prêmios (tabela padrão, configurável em `config.ts`)
Cada cartela paga **só o maior prêmio** que completar:

| Prêmio | Regra | Mult. sobre a aposta da cartela |
|---|---|---|
| **Linha** | qualquer linha horizontal completa | ×5 |
| **Linha dupla** | quaisquer 2 linhas completas | ×25 |
| **Bingo** | cartela cheia (15 números) | ×500 |
| **Acumulado** | Bingo **até a 30ª bola** | acumulado inteiro (ver 2.4) |

- Os padrões antigos (cantos, pirâmide, U, moldura) **não são apagados**: ficam em `PATTERN_SETS` no `config.ts`. Ativo por padrão: `'classico'` = Linha, Linha dupla, Bingo. O conjunto `'variado'` mantém os 7 padrões. Troca só pelo painel do administrador. Os testes cobrem os dois conjuntos.

### 2.4 Acumulado
- Começa em 5.000 e cresce com cada rodada (manter o cálculo fracionário corrigido em A1).
- Paga se o Bingo sair **até a 30ª bola**, conforme a aposta por cartela:
  - aposta **≥ 3**: 100% do acumulado;
  - aposta **2**: 75%;
  - aposta **1**: 50%.
- A tabela de prêmios na tela mostra esse percentual quando a aposta for 1 ou 2 ("Acumulado: 50%").
- Depois de pago, volta a 5.000.

### 2.5 Bolas extras
- Até **9 bolas extras** por rodada. Só são oferecidas quando alguma cartela ativa está **a 1 número** de um prêmio melhor que o atual (regra atual mantida).
- O custo continua dinâmico (proporcional ao maior prêmio que ainda pode sair) e aparece no **painel central de bola extra** (seção 3.4).
- **Bola extra grátis**: em parte das ofertas, a próxima extra é **GRÁTIS**. Ela aparece com destaque dourado, narração "Bola extra grátis!" e não debita nada. Frequência controlada pelo Diretor (seção 4).
- A jogadora pode **TERMINAR** a qualquer momento. Sem timer de pressão.

### 2.6 Turbo
- Substituir "Acelerar" por um toggle **"Turbo"** (liga/desliga, salvo nas configurações). Com Turbo ligado, as 30 bolas caem em sequência rápida (~120 ms cada), as cartelas marcam e a voz narra **só os prêmios** e a oferta de extra.
- Turbo pode ser ligado no meio da rodada.

### 2.7 Correio da sorte (bônus) — corrige M6
- O bônus diário (+300) deixa de ser só uma legenda. Na primeira abertura do dia, um **ícone de carta/correio** grande aparece balançando no topo da tela, com o selo 🍀.
- Ao tocar: abre uma tela grande "🍀 Correio da sorte da Dona Altina! +300 créditos" com narração e botão **PEGAR**.
- Além do diário, de vez em quando (no máximo 2 vezes por dia, depois de pelo menos 30 min jogando) aparece um correio com **10 a 100 créditos**.
- O correio **nunca aparece durante o sorteio** e nunca cobre a bola extra.

### 2.8 Migração do save
- Esquema `version: 2`. Ao abrir um save v1: preservar saldo, acumulado, histórico de bingos do Diretor, estatísticas e configurações. **Descartar a rodada em andamento** e gerar cartelas novas (1–90). Converter aposta para o valor válido mais próximo (20 → 10). Teste de migração obrigatório.

---

## 3. Tela estilo vídeo bingo — `elderly-ux-designer`

Objetivo: a Dona Altina deve **reconhecer** a tela como "o bingo dela", mas com letra grande e sem poluição. Manter as regras de acessibilidade já atendidas (texto ≥ 20 px, alvos ≥ 64 px, sem rolagem, alto contraste).

### 3.1 Estrutura (tablet paisagem, principal)
```
┌──────────────────────────────────────────────────────────────┐
│ 🍀 Altina da Sorte   📬(quando houver)  Créditos  Acumulado ⚙🔊│
├────────────────────────────────┬─────────────────────────────┤
│                                │  BOLA GRANDE   "Bola 17/30" │
│   Cartela 1      Cartela 2     │  ───────────────────────────│
│                                │  TRILHO: 30 bolas em ordem  │
│   Cartela 3      Cartela 4     │  (3 fileiras de 10)         │
│                                │  + 9 casas de bola extra    │
│                                │  ───────────────────────────│
│                                │  TABELA DE PRÊMIOS (fixa)   │
├────────────────────────────────┴─────────────────────────────┤
│ Aposta −5+ │ Cartelas −4+ │ Números │ Turbo │   [ JOGAR ]    │
└──────────────────────────────────────────────────────────────┘
```

### 3.2 Trilho de bolas (substitui a grade 1–60)
- A grade fixa de números sai. Entra o **trilho**: 30 casas em 3 fileiras de 10, preenchidas **na ordem do sorteio**, cada uma com uma bolinha colorida e o número legível (≥ 20 px).
- Abaixo, **9 casas de bola extra** com contorno dourado tracejado; ficam acesas conforme são compradas.
- **Contador grande**: "Bola 17 de 30" (nas extras: "Extra 2 de 9").

### 3.3 Tabela de prêmios fixa
- Sempre visível ao lado das cartelas: Linha, Linha dupla, Bingo e Acumulado com **valores em créditos para a aposta atual** (atualiza ao mudar a aposta).
- A linha do prêmio que acabou de sair pisca dourada por 2 s.
- O botão "Prêmios" continua existindo para a explicação com os desenhos.

### 3.4 Painel de bola extra
- No lugar da bola grande (não como modal cobrindo as cartelas): "BOLA EXTRA — custa 8", ou "BOLA EXTRA GRÁTIS!" em dourado, com os botões **BOLA EXTRA** e **TERMINAR** enormes.
- As cartelas continuam visíveis, com o número que falta piscando em amarelo e um selo "FALTA 1 → Linha dupla: +125" mostrando o que ela ganha se a bola vier.

### 3.5 Cartelas
- Quando uma cartela ganha, mostrar um selo grande sobre ela: "LINHA +25", "LINHA DUPLA +125", "BINGO +2.500".
- Tocar na cartela **não faz nada** (corrige M11).

### 3.6 Outros layouts
- **Tablet retrato**: topo (créditos, acumulado), bola + contador, trilho, tabela de prêmios compacta em 1 linha, cartelas 2×2 e barra inferior.
- **Celular**: trilho mostra só as últimas 10 bolas + contador; tabela de prêmios em 1 linha.

### 3.7 Correções pendentes de layout
- **M1**: diálogos com cabeçalho e rodapé fixos; FECHAR sempre visível; nenhum diálogo exige rolar em 1024×768, 768×1024 e 360×740.
- **M2**: espaçamento ≥ 12 px entre alvos em todos os estados.
- **M3**: créditos e acumulado com até 7 dígitos sem cortar em 360 px.
- **M9**: a legenda mostra **exatamente** o texto da fala que tocou (usar o `onCaption` do narrador como fonte).

---

## 4. Diretor recalibrado — `odds-director`

- Adaptar `director.ts`, `drawBuilder.ts`, testes e `scripts/simulate.ts` para **90 bolas**, **9 extras**, **bola extra grátis** e o conjunto de prêmios ativo.
- Manter todas as metas do bingo: 2–3 por mês, mínimo 7 dias entre bingos, teto 3/mês, forçar depois de 16 dias.
- Metas novas (validar em simulação, 3 perfis × 30 seeds):
  - rodadas sem prêmio: **55–62%**;
  - pelo menos 1 Linha em **30–38%** das rodadas; Linha dupla em **5–8%**;
  - oferta de bola extra em **25–35%** das rodadas;
  - bola extra grátis em **15–20%** das ofertas;
  - RTP dos prêmios comuns ≈ **0,88**;
  - perfil de 120 rodadas/dia com **no máximo ~20 recargas de presente em 90 dias** (hoje são ~58; o saldo não pode viver zerado). Ajustar RTP ou custo das extras até atingir.
- O drawBuilder continua garantindo que o resultado real **nunca excede o alvo**, inclusive comprando as 9 extras.
- O simulador imprime também: frequência da bola grátis e do pagamento parcial do acumulado (aposta 1 e 2).
- Manter o primeiro bingo entre o 3º e o 10º dia de uso.

---

## 5. Áudio — `audio-designer`

### 5.1 Voz animada de verdade (corrige A5) — obrigatório
1. **Pergunte para mim antes de gerar**: qual serviço de TTS usar e se tenho chave. Recomendação: uma voz neural pt-BR **expressiva** (estilo apresentador animado). A chave entra só em `.env.local`, nunca no repositório.
2. **Se eu não tiver chave**, gere os clipes com um TTS **open source e offline** com voz pt-BR (ex.: Piper), e aplique pós-processamento para animar: velocidade +8–12%, leve subida de tom, vogais esticadas nos prêmios ("Linhaaa", "BINGOOO"). Assim o jogo nunca depende da voz do tablet.
3. Roteiro atualizado em `src/audio/script.ts`:
   - números **"Um!" a "Noventa!"** (90 clipes);
   - "Bola extra grátis!", "Correio da sorte!", "Turbo!" (curto), "Linha dupla, valendo!" (ao entrar na oferta de extra por linha dupla);
   - manter todas as falas existentes e as variações.
4. **Bordões de bingo (opcional, ligado por padrão, desligável em Ajustes)**: em ~1 a cada 8 bolas, quando houver, a voz usa um bordão tradicional e conhecido de bingo brasileiro para o número (ex.: 22 "Dois patinhos na lagoa!"). Use só bordões populares e de domínio público; liste-os em `script.ts` com o número; se tiver dúvida sobre um bordão, não inclua.
5. Commitar os clipes (Opus + MP3), os `manifest.json` de `voice/` e `voice-custom/` (este pode ser `{"ids":[]}`). **Isso também elimina as 414 requisições (M4).**
6. Pacote total de voz ≤ **3 MB**, baixado depois do primeiro toque e cacheado pelo service worker.

### 5.2 Som do globo e prêmios
- Antes de cada bola, um **som curto de globo girando/bola rolando** (sintetizado, ≤ 400 ms; no Turbo, só um tique).
- Jingle diferente para Linha, Linha dupla, Bingo e Acumulado (já existem stingers; diferenciar por prêmio).
- Som de "plim" dourado para bola extra grátis e para o correio.

### 5.3 Correções pendentes
- **M12**: timeout de segurança na espera de cada clipe (duração do clipe + 1,5 s) e retomada se o `AudioContext` for suspenso.
- Em Turbo/rodada acelerada, não tocar o efeito "falta 1" se a fala também for suprimida (M9, parte de áudio).

### 5.4 Prévia para eu ouvir
- Criar `npm run audio:preview`, que usa Playwright + `OfflineAudioContext` para renderizar **`docs/qa/audio-preview.wav`** (~45 s): música do sorteio com ducking, 5 bolas narradas, uma Linha dupla, uma oferta de extra grátis e o Bingo. Quero avaliar a voz e a música sem precisar do tablet.

---

## 6. Performance, PWA e dados — `perf-pwa-engineer`

- **Lighthouse**: medir de verdade (Lighthouse via Node + Chromium do Playwright, perfil mobile, CPU 4–6x). Meta Performance ≥ 95. Salvar o relatório em `docs/qa/lighthouse.json` e o resumo no relatório da fase.
- **M7**: o modo leve automático por FPS só pode ser ligado depois de 3 rodadas (não no carregamento) e **não sobrescreve a escolha manual**; `prefers-reduced-motion` só sugere o padrão na primeira abertura.
- **M8**: remover `user-scalable=no` (manter `touch-action: manipulation` nos botões).
- **M10**: persistir `extraSpent` da rodada em andamento.
- Service worker: versionar o cache para v2, precachear o novo bundle e o `manifest.json` de voz, baixar os clipes em segundo plano e limpar caches antigos.
- Migração v1→v2 (seção 2.8) com teste.
- Deploy na Vercel e conferir a versão publicada abrindo em 1280×800 e 800×1280.

---

## 7. Checklist do `qa-reviewer` (fase final; relatório `docs/qa/review-fase2.md` com screenshots novos)

- [ ] Bolas 1–90, 30 sorteadas, cartelas 3×5 com faixas de 18 por coluna.
- [ ] Aposta 1–10; Cartelas 1–4 pelo controle (tocar na cartela não faz nada).
- [ ] Linha, Linha dupla, Bingo e Acumulado conforme 2.3/2.4, incluindo 50%/75% nas apostas 1 e 2.
- [ ] Até 9 extras, só com "falta 1"; bola extra grátis aparece e não debita.
- [ ] Turbo funciona antes e durante a rodada; narra só prêmios.
- [ ] Correio da sorte: diário com tela e PEGAR; ocasional limitado; nunca durante o sorteio.
- [ ] Trilho de 30 + 9 extras, contador "Bola X de 30", tabela de prêmios fixa com valores da aposta atual.
- [ ] Simulador dentro de todas as metas da seção 4.
- [ ] Clipes de voz commitados (1–90 + falas); 0 requisições 404 de áudio; legenda = fala.
- [ ] `docs/qa/audio-preview.wav` gerado.
- [ ] Lighthouse mobile ≥ 95 medido; bundle JS ≤ 60 KB gzip; primeira carga sem áudio ≤ 250 KB.
- [ ] M1–M12 resolvidos (citar evidência de cada um).
- [ ] Save v1 migra sem perder saldo, acumulado nem histórico.
- [ ] Nenhuma menção a dinheiro, loja, anúncio, nome de app de terceiros ou link externo.
- [ ] Testes unitários e e2e passando; screenshots novos nos 5 viewports.

---

## 8. Fases

- **A — Contratos (orquestrador):** atualizar `types.ts`, `events.ts`, `config.ts` (90 bolas, 9 extras, `PATTERN_SETS`, aposta 1–10, acumulado por nível) e as definições dos agentes.
- **B — Paralelo:** regras + migração (`game-rules-engineer`); Diretor + simulador (`odds-director`, me mostre a saída); layout novo com dados mockados (`elderly-ux-designer`); roteiro e geração de voz após minha resposta sobre TTS, globo e prévia (`audio-designer`).
- **C — Integração (orquestrador):** rodada completa com as novas regras, tela e áudio.
- **D — Performance e PWA (`perf-pwa-engineer`):** Lighthouse, M7/M8/M10, SW v2, migração.
- **E — Revisão (`qa-reviewer`)** com o checklist da seção 7; devolver achados aos responsáveis até passar.
- **F — Deploy na Vercel** e relatório final para mim, com a lista do que mudou.
