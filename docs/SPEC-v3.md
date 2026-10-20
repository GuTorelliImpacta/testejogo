# PROMPT PARA O CLAUDE CODE — Altina da Sorte🍀 v3 (responsivo em tudo + painel do neto completo)

> Cole no Claude Code **dentro do repositório `testejogo`** (branch `claude/new-session-t2beg1`). O jogo está publicado e funcionando. **Não reescreva o projeto**: implemente só o que está aqui, mantendo regras, áudio, Turbo instantâneo, Diretor, testes e tudo que já passa. Atualize `docs/SPEC.md` no final.

---

## 0. Orquestração (subagentes já existentes em `.claude/agents/`)

Você é o **ORQUESTRADOR**. Atualize as definições dos agentes com o escopo abaixo e dispare em paralelo o que for independente.

| Agente | Nesta versão |
|---|---|
| `elderly-ux-designer` | Layouts para **todas as orientações e tamanhos** (seção 1); logo sempre visível; entrada do painel em Ajustes |
| `odds-director` | Dificuldade e frequência de bingo **ajustáveis em tempo de execução** (seção 2.3), presets validados no simulador |
| `game-rules-engineer` | Estado/configuração do painel no save, migração v2→v3, API `admin` nova, troca de PIN |
| `perf-pwa-engineer` | **Otimização máxima para tablet muito fraco (seção 3.5)**, compatibilidade com navegadores antigos, manifest sem travar orientação, rotação no meio da rodada, cache do SW v3, deploy |
| `audio-designer` | Áudio leve para tablet fraco (seção 3.5.4): música sem custo contínuo de CPU, memória de clipes controlada |
| `qa-reviewer` | Checklist da seção 4 em todos os viewports da seção 1.4; relatório `docs/qa/review-fase3.md` |

Regras: contratos primeiro (você atualiza `types.ts`, `config.ts`, `gameApi.ts`); cada agente só mexe nos seus arquivos; a cada fase rode `npm test`, `npm run build`, `npm run simulate` e os scripts de `tests/e2e/qa/`; me mande um resumo curto por fase.

---

## 1. Responsivo de verdade — `elderly-ux-designer`

### 1.1 Nenhuma orientação é obrigatória
- **Remova o aviso "Vire o celular em pé para jogar"** (`#rotate` em `index.html`). O jogo funciona deitado e em pé em qualquer aparelho.
- `manifest.webmanifest`: `"orientation": "any"` (nunca travar).
- Girar o aparelho **no meio da rodada, na oferta de bola extra ou na comemoração** não pode perder estado, reiniciar animação de forma estranha nem deixar nada fora da tela.

### 1.2 Prioridade: tablet deitado
A Dona Altina joga com o **tablet deitado**. Esse continua sendo o layout de referência (cartelas grandes à esquerda; bola, trilho e prêmios à direita; barra embaixo). Nenhuma mudança desta versão pode piorar os tablets deitados de 960×600, 1024×600, 1280×720, 1280×800, 1366×768 e 1920×1200.

### 1.3 Tudo aparece em todos os aparelhos
Em **todo** viewport da seção 1.4, estes itens ficam visíveis e tocáveis sem rolar a tela:
- **logo 🍀 Altina da Sorte** (pode virar só o trevo + "Altina" em telas pequenas, mas **sempre presente**, porque é a entrada do painel);
- créditos, acumulado, correio (quando houver), som, ajustes;
- bola atual + contador "Bola X de 30" (no celular pode ser a faixa compacta);
- trilho das bolas (no celular: últimas bolas + contador), tabela de prêmios;
- as **4 cartelas** com números legíveis (célula ≥ 20 px de altura, número ≥ 20 px);
- aposta (− +), cartelas (− +), Números, Turbo, JOGAR;
- painel de bola extra (BOLA EXTRA / TERMINAR) quando houver oferta.

Mantenha as regras atuais: alvos ≥ 64 px, espaço ≥ 12 px entre alvos, texto ≥ 20 px, sem rolagem do documento, diálogos sem rolagem com rodapé visível.

### 1.4 Layout de **celular deitado** (novo)
Telas com altura ≤ 500 px em paisagem (667×375, 740×360, 812×375, 844×390, 915×412, 932×430):
- Sem a linha de topo separada. Sugestão de grade:
  - **esquerda (~60%)**: as 4 cartelas em 2×2;
  - **direita (~40%)**, de cima para baixo: linha compacta com logo-trevo, créditos, acumulado, som e ajustes; faixa com contador + últimas bolas; tabela de prêmios 2×2 com nomes curtos; linha Números | Turbo; botão JOGAR;
  - **barra inferior só sob as cartelas**: Aposta (− +) e Cartelas (− +).
- Se faltar altura, pode usar ícones com rótulo curto, mas **nada some** e nada fica com alvo < 64 px. Ajuste a grade como achar melhor, desde que passe a auditoria.
- O painel de bola extra ocupa o lugar da faixa + tabela na coluna direita.

### 1.5 Viewports obrigatórios na auditoria (`QA_VP` em `tests/e2e/qa/layout.ts`)
```
1280x800,800x1280,1024x768,768x1024,960x600,600x960,1024x600,600x1024,
1280x720,1366x768,1180x820,820x1180,1366x1024,1920x1080,1920x1200,
360x740,375x667,390x844,412x915,430x932,
740x360,667x375,844x390,915x412,932x430
```
Todos os estados de `layout.ts` (ocioso, correio, sorteio, Turbo, oferta paga/grátis, comemoração, presente, prêmios, ajustes, PIN, painel, texto grande/muito grande) em todos esses viewports, com **0 achados** em texto normal. Em "Muito grande", no máximo cortes de 1–3 px documentados.

---

## 2. Painel do neto — acesso em qualquer aparelho e controle de verdade

### 2.1 Acesso (`elderly-ux-designer`)
- Continua: **5 toques no logo** abrem o teclado do PIN, agora em **todos** os layouts (o logo nunca some).
- Novo: em **Ajustes**, aba "Tela" ou nova aba "Neto", um botão discreto **"Painel do neto 🔒"** que abre o mesmo teclado do PIN. Assim dá para entrar mesmo se o toque no logo falhar.
- Teclado do PIN e painel cabem sem rolagem em todos os viewports da 1.5 (painel pode ter abas internas).

### 2.2 PIN (`game-rules-engineer`)
- O PIN padrão hoje está em `src/config.ts` (`ADMIN_PIN`). Mantenha esse valor como padrão.
- Novo no painel: **"Trocar PIN"** (digita o novo duas vezes). O PIN trocado fica salvo no aparelho (no save) e vale no lugar do padrão.
- **"Esqueci o PIN"** não existe na tela da vó. Para o neto: um parâmetro de URL `?resetpin=1` volta ao PIN padrão depois de confirmar com o PIN padrão. Documente no README.
- **No relatório final, me diga explicitamente o PIN padrão, onde ele está no código, como trocá-lo pelo painel e como voltar ao padrão.**

### 2.3 O painel precisa realmente ajustar a dificuldade (`odds-director` + `game-rules-engineer`)
Hoje o painel só mostra um JSON de estatísticas, exporta/importa, zera acumulado/créditos e troca o conjunto de padrões. **Ele não ajusta a frequência de bingo nem a dificuldade**, porque `TUNING` é constante de compilação. Mude isso:

1. **Configuração em tempo de execução**: `TUNING` e os pesos do Diretor passam a vir de `data.tuning` (salvo no aparelho), com os valores atuais como padrão. `director.ts` e o simulador leem essa configuração (injeção, não constante global).
2. **Controles no painel** (botões grandes, sem digitar números soltos):
   - **Bingos por mês**: `1` | `2` | `2 a 3 (padrão)` | `3 a 4`. Cada opção ajusta `bingoPorMesAlvo`, `bingoMaxPorMes`, `diasMinEntreBingos`, `diasAlvoEntreBingos`, `diasForcarBingo`.
   - **Prêmios do dia a dia** (linha/linha dupla): `Menos` | `Normal (padrão)` | `Mais`. Ajusta RTP comum e % de rodadas sem prêmio.
   - **Bola extra**: frequência de oferta `Menos | Normal | Mais`; chance de bola grátis `Menos | Normal | Mais`; custo `Mais barata | Normal`.
   - **Presente de créditos**: valor da recarga (500 / 1.000 / 2.000) e bônus do correio diário (300 / 500).
   - **Conjunto de padrões**: Clássico / Variado (já existe; manter).
   - **Restaurar padrão** (volta tudo ao valor original, com confirmação).
3. **Validação**: cada preset precisa ser calibrado e validado no simulador (3 perfis × 30 seeds). `npm run simulate -- --preset <nome>` imprime as metas de cada um. Exemplos de metas: "2 a 3" mantém as metas atuais; "1" dá 1 bingo/mês em ≥ 90% dos meses; "3 a 4" dá 3–4 em ≥ 90% e nunca menos de 5 dias entre bingos. Inclua a tabela de resultados no relatório.
4. A mudança vale **a partir da próxima rodada** (nunca no meio de uma) e o histórico de bingos do mês é respeitado (se já saiu o máximo do mês, não sai mais).
5. **Estatísticas legíveis** no lugar do JSON: bingos deste mês e datas dos últimos, dias desde o último bingo, rodadas por dia (média), prêmios por tipo, RTP real, recargas de presente, configuração ativa. Manter "Exportar/Importar" para trocar de tablet (a configuração e o PIN vão junto no export).

### 2.4 Segurança simples
O PIN é só para a vó não entrar sem querer (não é segurança de verdade, o código é público). Não exiba o PIN em nenhuma tela do jogo nem em legenda/voz.

---

## 3. Dados e PWA — `perf-pwa-engineer`
- Esquema do save `version: 3` com `tuning` e `adminPin`. Migração v2→v3 preserva saldo, acumulado, histórico do Diretor, estatísticas, configurações e rodada em andamento. Teste de migração.
- Rotação durante a rodada: teste e2e que gira 1280×800 → 800×1280 → 844×390 no meio do sorteio e na oferta de extra e confere estado e layout.
- Cache do SW versionado (v3); conferir que o tablet recebe a versão nova ao reabrir.
- Deploy na Vercel (projeto `altina-da-sorte`) e conferência do site publicado em 1280×800, 960×600 e 844×390.

---

## 3.5 Otimização máxima: rodar liso num tablet muito fraco — `perf-pwa-engineer` (+ `audio-designer`)

O tablet da Dona Altina é **realmente muito ruim**. A meta é a experiência fluida de um app nativo de vídeo bingo, na web. A nota do Lighthouse já é 100, mas isso mede só o carregamento. Agora o foco é **o jogo rodando**: sorteio, marcação, Turbo, comemoração, música e voz, por horas seguidas, sem travar, esquentar ou ficar lento.

### 3.5.1 Primeiro, conhecer o aparelho
- No painel do neto, aba **"Aparelho"**: modelo/navegador (`userAgent`), versão do Chrome/WebView, `navigator.deviceMemory`, `hardwareConcurrency`, tamanho da tela e `devicePixelRatio`, FPS médio e pior quadro das últimas rodadas, memória JS (quando disponível) e se o modo econômico está ligado. Assim eu abro no tablet dela e te passo os números.
- **Me pergunte** o modelo do tablet e a versão do Android/Chrome antes de definir o alvo de compatibilidade. Enquanto eu não responder, assuma **Android 7+ com Chrome/WebView 80+**.

### 3.5.2 Compatibilidade com navegador antigo
- `build.target` do Vite compatível com o alvo (ex.: `es2019`/`chrome80`). Conferir que o bundle não usa sintaxe nem APIs que o alvo não tem (`structuredClone`, `Array.prototype.at`, `??=`, top-level await etc.). Se precisar, use substitutos próprios (sem polyfills pesados).
- CSS com **fallback** para o que navegador antigo não entende: `100dvh` (com `100vh` antes), `aspect-ratio`, `inset`, `gap` em flex, `:has()`, nesting e `clamp()`. O layout não pode quebrar se uma dessas propriedades for ignorada.
- Teste de fumaça num Chromium antigo, se for possível baixar um (ex.: Chromium 80–90 via Playwright/arquivo). Se não for possível, documente e faça a varredura estática de recursos.

### 3.5.3 Render e animação
- **Orçamento por quadro**: nenhuma tarefa > 50 ms durante o sorteio, a marcação, o Turbo (30 bolas + até ~30 células marcadas de uma vez) e a comemoração, medido com **CPU 6× e 20×** (Playwright + CDP `Emulation.setCPUThrottlingRate` e trace de performance). Relate a tarefa mais longa e o FPS de cada cena.
- O Turbo atualiza o DOM **em um único lote** (um `requestAnimationFrame`, sem ler layout entre escritas). A animação de "carimbo" das células no Turbo é única e curta, ou nenhuma no modo econômico.
- Reduzir custo de pintura: evitar `box-shadow` grande, `filter`, `backdrop-filter`, gradientes complexos e sombras de texto em elementos que mudam; usar `contain: layout paint` nas cartelas, no trilho e na tabela; `will-change` só durante a animação. Fundo da página estático (um gradiente simples ou cor).
- Menos nós de DOM onde der (cartelas, trilho), nada de `innerHTML` no laço do sorteio, nenhum `setInterval`, nada de layout síncrono (`getBoundingClientRect`/`offsetWidth`) dentro do sorteio.
- Comemoração do bingo: no máximo ~20 partículas em `transform`/`opacity`, ≤ 2,5 s, nenhuma no modo econômico.

### 3.5.4 Áudio leve
- A música procedural hoje agenda notas continuamente no Web Audio, o que custa CPU o tempo todo. **Renderize os loops uma única vez** (`OfflineAudioContext`, em tempo ocioso depois do ENTRAR) e toque como `AudioBuffer` em loop, ou use faixas curtas pré-renderizadas no build. O resultado tem que soar igual. Meça a CPU antes e depois.
- Taxa de amostragem do contexto razoável (ex.: 22.050–24.000 Hz no modo econômico, se soar bem). Decodificar clipes de voz **sob demanda** (números perto da vez + falas de prêmio), com limite de memória e liberação dos menos usados. Nunca decodificar os 142 clipes de uma vez num aparelho fraco.
- A música pausa em segundo plano (já faz) e o `AudioContext` é suspenso quando o jogo fica parado por muito tempo; volta no próximo toque.

### 3.5.5 Modo econômico automático
- Liga sozinho quando `deviceMemory ≤ 2`, `hardwareConcurrency ≤ 4`, ou FPS medido baixo nas primeiras rodadas (regra atual de 3 rodadas), e sempre pode ser ligado/desligado à mão em Ajustes ("Modo leve"). A escolha manual nunca é sobrescrita.
- No modo econômico: sem sombras/brilhos/partículas, animações mínimas, música pré-renderizada em taxa menor, `devicePixelRatio` não influencia nada caro. **O jogo tem que continuar bonito e claro**, só mais simples.

### 3.5.6 Longas sessões
- Teste de **resistência**: 200 rodadas seguidas em Turbo e 50 sem Turbo (com áudio ligado) sob CPU 6×. A memória JS e o número de nós de DOM ficam estáveis (sem vazamento). Nenhum timer, listener ou nó de áudio acumula.
- Wake Lock continua; nada de trabalho em segundo plano quando a aba não está visível.

### 3.5.7 Metas (critério de aceite)
- Carregamento: Lighthouse mobile ≥ 95 com CPU 6× (manter os 100 atuais se der); JS ≤ 60 KB gzip; primeira carga sem áudio ≤ 250 KB.
- Com **CPU 20×**: sorteio sem Turbo sem quadro > 100 ms; Turbo preenche tudo em ≤ 300 ms; toque em JOGAR/BOLA EXTRA responde (INP) em ≤ 200 ms.
- Com **CPU 6×**: ≥ 50 FPS nas animações de bola/marcação e nenhuma tarefa > 50 ms.
- Memória estável no teste de resistência.
- Relatório `docs/qa/perf-fase3.md` com os números **antes e depois** de cada otimização.

---

## 4. Checklist do `qa-reviewer` (`docs/qa/review-fase3.md`)
- [ ] Nenhum aviso de "vire a tela"; jogo jogável deitado e em pé em todos os viewports da 1.5.
- [ ] Logo visível e "5 toques" abre o PIN em todos; "Painel do neto 🔒" em Ajustes abre o PIN em todos.
- [ ] Todos os itens da 1.3 visíveis e tocáveis em todos os viewports; auditoria de layout com 0 achados (texto normal).
- [ ] Tablet deitado não piorou (screenshots antes/depois em 960×600, 1280×800, 1920×1200).
- [ ] Rotação no meio da rodada, na oferta de extra e na comemoração sem perda de estado.
- [ ] Painel: todos os controles da 2.3 funcionam, valem da próxima rodada, persistem após recarregar e vão no export.
- [ ] Simulador: tabela de metas por preset, todas atendidas.
- [ ] Trocar PIN, PIN antigo deixa de valer, `?resetpin=1` volta ao padrão.
- [ ] Migração v2→v3 sem perder nada; testes unitários e e2e passando; Turbo instantâneo intacto.
- [ ] Metas de desempenho da seção 3.5.7 atingidas e medidas (CPU 6× e 20×), com `docs/qa/perf-fase3.md` antes/depois.
- [ ] Bundle compatível com o alvo de navegador antigo; layout não quebra sem `dvh`/`aspect-ratio`/`:has()`.
- [ ] Música e voz soam igual depois da otimização; CPU do áudio menor (medido).
- [ ] Teste de resistência (200 rodadas Turbo + 50 normais) sem vazamento de memória, timers ou nós.
- [ ] Aba "Aparelho" no painel mostra os dados do tablet e o FPS das últimas rodadas.

---

## 5. Fases
- **A** (orquestrador): contratos (`types.ts`, `config.ts`, `gameApi.ts`), save v3, definições dos agentes.
- **B** (paralelo): layouts e acesso ao painel (`elderly-ux-designer`); tuning em tempo de execução + presets + simulador (`odds-director`); API do painel, PIN, migração (`game-rules-engineer`).
- **C** (orquestrador): integração; painel completo funcionando.
- **D** (`perf-pwa-engineer` + `audio-designer`): medir o estado atual (CPU 6× e 20×), aplicar a seção 3.5 inteira, medir de novo; rotação, SW v3, manifest. **Me pergunte o modelo do tablet e a versão do Android/Chrome no início desta fase.**
- **E** (`qa-reviewer`): checklist da seção 4; corrigir até passar.
- **F**: deploy na Vercel e **relatório final para mim** com: link, o que mudou, tabela do simulador por preset, **números de desempenho antes/depois** e **o PIN padrão com as instruções de troca e de reset**.
