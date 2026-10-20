# PROMPT PARA O CLAUDE CODE — "Altina da Sorte🍀" (vídeo bingo de 4 cartelas)

> Cole este documento inteiro no Claude Code. Ele é a especificação completa do projeto. Leia tudo antes de começar, siga a organização em subagentes (seção 0) e entregue em fases (seção 15).

---

## 0. Como você deve trabalhar: orquestrador + subagentes

Você (sessão principal) é o **ORQUESTRADOR** do projeto. Você **não implementa tudo sozinho**: divide o trabalho em subagentes especializados, define contratos entre eles, integra os resultados e garante a qualidade final.

### 0.1 Crie as definições de subagentes
Antes de escrever código do jogo, crie os arquivos em `.claude/agents/` (frontmatter com `name`, `description`, `tools`) para cada agente abaixo. Cada definição deve conter: missão, arquivos pelos quais é responsável, arquivos que **não** pode alterar, critérios de pronto e como reportar ao orquestrador.

| Agente | Missão | Responsável por |
|---|---|---|
| `game-rules-engineer` | Regras do bingo: cartelas, padrões, prêmios, acumulado, bola extra, máquina de estados | `src/cards.ts`, `patterns.ts`, `payout.ts`, `state.ts`, testes correspondentes |
| `odds-director` | Matemática da dificuldade: Diretor, construção de sequências, simulador e calibração | `src/director.ts`, `drawBuilder.ts`, `rng.ts`, `scripts/simulate.ts`, testes |
| `elderly-ux-designer` | Interface, layout responsivo (tablet primeiro), identidade visual, acessibilidade para idosa | `src/ui/**`, `src/styles/**`, `index.html` |
| `audio-designer` | Narração animada, efeitos sonoros, música de fundo, mixagem e carregamento de áudio | `src/audio/**`, `public/audio/**`, `scripts/audio/**` |
| `perf-pwa-engineer` | Performance em tablet fraco, PWA offline, wake lock, persistência, build e deploy Vercel | `src/main.ts`, `storage.ts`, `sw.ts`, `vite.config.ts`, `vercel.json`, `manifest` |
| `qa-reviewer` | Revisor **independente**: testa, mede e critica sem ter escrito o código. Não corrige — reporta | Somente leitura + `tests/e2e/**`, relatórios em `docs/qa/` |

### 0.2 Regras de orquestração
1. **Contratos primeiro.** Antes de disparar os agentes, você mesmo escreve `src/types.ts` (tipos de cartela, padrão, estado, eventos) e `src/events.ts` (barramento de eventos tipado). Todos os agentes se comunicam por esses contratos. Eventos mínimos: `roundStart`, `ballDrawn`, `almost` (falta 1), `patternWon`, `extraOffer`, `extraBought`, `roundEnd`, `bingo`, `jackpot`, `giftCredits`, `dailyBonus`.
2. **Paralelize o que é independente**: na fase 1, `game-rules-engineer`, `odds-director`, `elderly-ux-designer` (com dados mockados) e `audio-designer` trabalham em paralelo. `perf-pwa-engineer` entra na integração.
3. **Escopo fechado**: cada agente só altera seus arquivos. Mudança de contrato passa por você.
4. **Integração é sua**: você junta as peças em `main.ts`, roda `npm test`, `npm run build` e `npm run simulate` a cada fase.
5. **Revisão independente**: ao fim de cada fase, acione o `qa-reviewer` com o checklist da seção 14. Devolva os problemas ao agente responsável até o checklist passar.
6. **Relatório de fase**: ao concluir cada fase, me mostre um resumo curto: o que foi feito, saída do simulador, tamanho do bundle e pendências.

---

## 1. Contexto e objetivo

Vamos criar um **vídeo bingo web** no estilo dos bingos de 4 cartelas da Play Store (linha, dupla linha, bola extra, acumulado) para **uma única jogadora: Dona Altina, 88 anos**, que joga num **tablet Android bem limitado**. Hoje ela joga apps que exigem compra de créditos sem retorno algum.

O **Altina da Sorte🍀**:
- tem **créditos infinitos** (nunca pede dinheiro, nunca mostra loja, anúncio ou link externo);
- replica a **mecânica** do gênero, com identidade, sons, voz e música **100% originais** (não copiar nome, arte, áudio ou trilha de nenhum app existente);
- é **narrado e animado** como os jogos que ela gosta: uma voz empolgada anuncia bolas e prêmios ("Linha duplaaa!", "BINGOOO!") sobre uma trilha alegre;
- tem dificuldade **controlada**: prêmios pequenos frequentes e **BINGO (cartela cheia) cerca de 2 a 3 vezes por mês**;
- é **extremamente simples de usar** e **leve**.

Hospedagem: **Vercel**, site estático, sem backend. Persistência local no aparelho.

### Nome e textos
- Nome do jogo em todo lugar (título, manifest, tela inicial, ícone): **Altina da Sorte🍀**. O nome curto do PWA é "Altina da Sorte".
- A jogadora é tratada sempre como **Dona Altina**: "Boa tarde, Dona Altina! Vamos jogar?", "Parabéns, Dona Altina!", "Presente pra Dona Altina!".
- O trevo 🍀 é o símbolo do jogo: no logo, no ícone, no selo de sorte das cartelas e na comemoração.
- Centralize todos os textos em `src/texts.ts` para facilitar ajustes.

---

## 2. Stack e restrições técnicas

- **Vite + TypeScript, sem framework** (vanilla DOM). Nada de React, Phaser ou Pixi: o tablet é fraco.
- CSS puro com custom properties. Nenhuma lib de UI. Fonte do sistema (`system-ui`) ou no máximo 1 fonte woff2 com subset latino (< 30 KB).
- Animações **só com `transform` e `opacity`**. Proibido animar `width/height/top/left/box-shadow/filter`.
- Sem imagens bitmap grandes: bolas, cartelas, trevo e ícones em **CSS/SVG inline**.
- **PWA**: manifest + service worker (offline completo, ícone na tela inicial, `display: fullscreen`, orientação livre).
- **Screen Wake Lock API** durante a partida, com fallback silencioso.
- Persistência: `localStorage` envolvido em try/catch. O jogo funciona mesmo se falhar.
- Testes: **Vitest** para regras, padrões e motor de sorteio. **Playwright** para e2e em viewports de tablet.
- Deploy: `vercel.json` simples, build estático em `dist/`.

### Orçamento de performance (critério de aceite)
- JS ≤ **60 KB gzip**; CSS ≤ 15 KB gzip; **primeira carga (sem áudio) ≤ 250 KB**.
- **Pacote de áudio** carregado **depois do primeiro toque**, em segundo plano, e cacheado pelo service worker. Total ≤ **2,5 MB**. O jogo começa a funcionar antes de o áudio terminar de carregar: clipes ausentes são simplesmente pulados.
- Lighthouse mobile (CPU 6x throttle): Performance ≥ 95.
- Durante o sorteio, sem jank perceptível. No máximo 1 elemento com animação grande por vez.
- Marcar número = troca de classe CSS, com referências DOM em cache (`Map<numero, HTMLElement[]>`).
- Usar `requestAnimationFrame`/`setTimeout` encadeado. Nenhum `setInterval` solto; limpar tudo ao fim da rodada.
- **Modo leve** (automático se `prefers-reduced-motion` ou FPS baixo nas primeiras rodadas): remove brilhos e partículas e mantém o essencial. A música continua tocando.

---

## 3. Regras do jogo (vídeo bingo de 4 cartelas)

### 3.1 Cartelas
- **4 cartelas**, cada uma com **3 linhas × 5 colunas = 15 números**, sem repetição dentro da cartela.
- Números de **1 a 60**. A coluna `c` (0–4) contém números de `12c+1` a `12c+12`, ordenados de cima para baixo.
- Cartelas diferentes podem compartilhar números.
- Cada cartela pode ser **ativada ou desativada** (mínimo 1 ativa). Cartela inativa fica esmaecida.
- O botão **"Trocar cartelas"** gera novas cartelas (só entre rodadas).

### 3.2 Aposta
- Aposta **por cartela**: 1, 2, 5, 10 ou 20 créditos, com botões − e + grandes. A aposta total (aposta × cartelas ativas) fica sempre visível.
- Créditos iniciais: **1.000**.
- **Créditos infinitos**: se o saldo ficar abaixo da aposta total ou de 50, aparece a tela "🍀 Presente pra Dona Altina! +1.000 créditos", com narração alegre e um botão "PEGAR" que recarrega o saldo.
- **Bônus diário** de +300 na primeira abertura do dia ("Bom dia, Dona Altina! Seu presente de hoje!").
- Nunca falar em dinheiro, compra ou loja.

### 3.3 Sorteio
- Ao tocar **JOGAR**, o jogo debita a aposta total e sorteia **30 bolas** sem repetição, uma por vez.
- Cada bola aparece grande no painel de bola, é **narrada pela voz animada** ("Bola vinte e três!"), vai para o histórico e é **marcada automaticamente** em todas as cartelas ativas. A jogadora não precisa marcar nada.
- Velocidade configurável: Lenta (2,0 s), Normal (1,4 s, padrão) e Rápida (0,9 s). O intervalo nunca corta uma narração no meio: a próxima bola espera a fala terminar.
- Botão "Acelerar" durante o sorteio: termina as bolas restantes rapidamente e narra só os prêmios.

### 3.4 Padrões de prêmio
Cada cartela paga **apenas o maior padrão** que completar. Prêmio = aposta da cartela × multiplicador. Nas máscaras, a linha 0 é o topo e `X` marca posição exigida:

| # | Padrão | Máscara 3×5 | Qtd | Mult. | Narração |
|---|---|---|---|---|---|
| 1 | **Linha** (qualquer linha horizontal) | uma linha inteira | 5 | ×2 | "Linhaaa!" |
| 2 | **Cantos** | `X...X / ..X.. / X...X` | 5 | ×3 | "Cantos!" |
| 3 | **Pirâmide** | `..X.. / .XXX. / XXXXX` | 9 | ×8 | "Pirâmide!" |
| 4 | **U** | `X...X / X...X / XXXXX` | 9 | ×12 | "Deu U!" |
| 5 | **Linha dupla** (quaisquer 2 linhas) | duas linhas inteiras | 10 | ×15 | "Linha duplaaa!" |
| 6 | **Moldura** | `XXXXX / X...X / XXXXX` | 12 | ×40 | "Moldura! Que beleza!" |
| 7 | **BINGO** (cartela cheia) | todas | 15 | ×300 | "BINGOOO!!!" |

- **Acumulado (jackpot)**: começa em 5.000 e cresce +2% da aposta total a cada rodada. Paga **o acumulado inteiro** se o BINGO sair **até a 30ª bola**. Bingo nas bolas extras paga só o ×300. Depois de pago, volta a 5.000. Narração: "ACUMULADOOO! A Dona Altina levou tudo!"
- Tabela de prêmios acessível no botão "Prêmios", com desenho de cada padrão e o valor em créditos para a aposta atual.
- Durante o sorteio, cada cartela mostra um selo 🍀 com o **melhor padrão já garantido** e destaca em amarelo pulsante os números que **faltam 1** para o próximo padrão ("FALTA 1!"). Quando uma cartela fica a 1 número de um padrão ≥ linha dupla pela primeira vez na rodada, a voz avisa: "Falta uma!" ou, no bingo, "Falta uma pro bingo!".

### 3.5 Bola extra
- Ao fim das 30 bolas, se **alguma cartela ativa estiver a 1 número** de um padrão melhor que o atual, o jogo oferece **BOLA EXTRA**, narrada ("Bola extra! Vai, Dona Altina!").
- Até **10 bolas extras** por rodada.
- Custo exibido no botão: `max(1, round(0,08 × maior prêmio adicional possível))`, arredondado para valores redondos (1, 2, 5, 10, 20, 50…). Se não houver mais chance de melhora, a oferta não aparece.
- Dois botões enormes: **"BOLA EXTRA (custa X)"** e **"TERMINAR"**. Sem timer de pressão.
- As bolas extras usam o mesmo motor de sorteio (seção 4).

### 3.6 Fim da rodada
- Soma dos prêmios com animação de contagem do saldo (≤ 1,5 s) e som de moedas.
- Ganho pequeno: feedback discreto e narração curta ("Ganhou!").
- Linha dupla ou maior: tela de comemoração com narração do padrão e um trecho musical de vitória.
- **BINGO**: celebração grande, com confete leve em CSS, trevos caindo, fanfarra original, "BINGO!!!" gigante e a voz "BINGOOO! Parabéns, Dona Altina!". Botão "CONTINUAR".
- O botão **JOGAR** volta a ficar disponível com as mesmas cartelas e a opção de trocá-las.
- **Jogo automático** (opcional): o toggle "Automático" repete a rodada com a mesma aposta e para em qualquer oferta de bola extra, prêmio ≥ linha dupla ou presente de créditos.

---

## 4. Motor de sorteio e dificuldade ("Diretor") — agente `odds-director`

O sorteio **não é puramente aleatório**. `director.ts` decide o resultado-alvo da rodada e `drawBuilder.ts` monta uma sequência de bolas coerente com esse alvo. Para a jogadora, tudo deve parecer natural.

### 4.1 Metas (em `config.ts`)
```ts
export const TUNING = {
  bingoPorMesAlvo: 2.5,
  bingoMaxPorMes: 3,           // teto rígido por mês-calendário
  diasMinEntreBingos: 7,       // nunca dois bingos em menos de 7 dias
  diasAlvoEntreBingos: 12,     // a chance começa a subir forte
  diasForcarBingo: 16,         // a partir daqui, garantir bingo em ~20 rodadas jogadas
  rtpAlvo: 0.88,               // retorno médio dos prêmios comuns (sem bingo/acumulado)
  chanceBingoNaExtra: 0.6,     // 60% dos bingos acontecem via bola extra (mais emoção)
  taxaQuaseBingo: 0.04,        // rodadas com "falta 1 pro bingo" que não viram bingo
};
```

### 4.2 Lógica do bingo (baseada no calendário)
Não sabemos quantas rodadas ela joga por dia, então a regra usa datas. Guardar: `ultimoBingoEm`, `bingosPorMes` (ex.: `{ "2026-10": 1 }`) e `rodadasDesdeUltimoBingo`.

Para cada rodada:
1. Se `bingosNoMesAtual >= bingoMaxPorMes` ou `diasDesdeUltimo < diasMinEntreBingos`, o bingo está proibido.
2. Caso contrário, a chance por rodada cresce com `diasDesdeUltimo`:
   - de `diasMin` a `diasAlvo`: rampa suave (≈ 0,3% → 2%);
   - de `diasAlvo` a `diasForcar`: 2% → 8%;
   - depois de `diasForcar`: chance crescente que garante o bingo em até ~20 rodadas.
3. No primeiro uso, considerar que o último bingo foi há 5 dias, para o primeiro sair em 1 a 2 semanas.

### 4.3 Prêmios comuns
Sortear o nível da rodada com pesos que resultem em RTP ≈ `rtpAlvo`, validado por simulação. Ponto de partida:
- ~55%: nada, ou só linha/cantos em 1 cartela;
- ~30%: linha, cantos ou pirâmide em 1–2 cartelas;
- ~10%: U ou linha dupla;
- ~1,5%: moldura;
- bingo conforme 4.2.

Ofertas de bola extra devem aparecer em ~25–35% das rodadas. Em parte delas a bola extra realmente completa o padrão, sem que isso vire regra.

### 4.4 Construção da sequência (`drawBuilder.ts`)
- **Entrada**: cartelas ativas e alvo por cartela (melhor padrão permitido e, no caso de bingo, a posição da bola decisiva: entre 24–30 ou na extra 1–10).
- **Algoritmo**: incluir os números necessários para o alvo e completar com números aleatórios que **não** façam nenhuma cartela ultrapassar o alvo. Espalhar os números decisivos de forma natural: só o número final do padrão principal cai na posição planejada.
- **Validação**: simular a sequência e conferir o resultado, com *rejection sampling* de até 200 tentativas. Se falhar, rebaixar o alvo um nível. O jogo nunca pode travar.
- Pré-gerar as até 10 bolas extras junto com a rodada.
- Usar `crypto.getRandomValues` como base, com RNG injetável e seed nos testes. Funções puras.

### 4.5 Simulador (obrigatório)
`npm run simulate` simula 90 dias com três perfis (10, 40 e 120 rodadas/dia) e imprime:
- bingos por mês e intervalo entre bingos;
- RTP e frequência de cada padrão;
- % de rodadas com bola extra;
- evolução do saldo e número de recargas de presente.

Ajustar os pesos até obter **2–3 bingos/mês em todos os perfis**, nunca 0 nem 4 ou mais.

---

## 5. Áudio: narração, efeitos e música — agente `audio-designer`

O áudio é parte central da experiência: o jogo precisa ter **a energia de um apresentador de bingo animado**, como nos apps que a Dona Altina já joga, sem nenhum material copiado.

### 5.1 Narração (voz animada)
- **Voz em português brasileiro, tom empolgado e caloroso**, como um apresentador de programa de auditório: vogais esticadas nos prêmios ("Linhaaa!", "BINGOOO!"), ritmo claro e volume confortável para quem ouve pouco.
- **Fonte da voz** (implementar nesta ordem de preferência, com o pipeline documentado em `scripts/audio/README.md`):
  1. **Clipes pré-gerados no build** com um serviço de TTS neural de alta qualidade em pt-BR (voz expressiva, com estilo animado/"cheerful" se disponível). O script `scripts/audio/generate.ts` lê `src/audio/script.ts`, gera os arquivos e os salva em `public/audio/voice/`. A chave de API fica em variável de ambiente local e **nunca** vai para o repositório ou para o bundle. Os arquivos gerados são commitados.
  2. **Suporte a gravações caseiras**: se existir um arquivo com o mesmo id em `public/audio/voice-custom/`, ele substitui o clipe gerado. Assim a família pode gravar falas com a própria voz (ex.: "Parabéns, vó!"). Documentar o padrão de nomes.
  3. **Fallback** para `speechSynthesis` pt-BR com `rate`/`pitch` ajustados para soar mais animado, caso um clipe não exista.
- **Roteiro mínimo** (`src/audio/script.ts`, com id, texto e categoria). Para as falas de prêmio, gerar **2 a 3 variações** e sortear para não ficar repetitivo:
  - Números: "Um!" a "Sessenta!" (60 clipes, curtos e enérgicos).
  - Início: "Boa sorte, Dona Altina!", "Vamos lá!", "Valendo!".
  - Falta 1: "Falta uma!", "Tá quase!", "Falta uma pro bingo!".
  - Prêmios: "Linhaaa!", "Cantos!", "Pirâmide!", "Deu U!", "Linha duplaaa!", "Moldura! Que beleza!", "BINGOOO!!!", "ACUMULADOOO! A Dona Altina levou tudo!".
  - Bola extra: "Bola extra! Vai, Dona Altina!", "Mais uma chance!".
  - Sem prêmio: "Na próxima vai!", "Quase, quase!" (tom leve, nunca triste).
  - Presentes: "Presente pra Dona Altina!", "Bom dia, Dona Altina! Seu presente de hoje!".
  - Saudação por horário: "Bom dia/Boa tarde/Boa noite, Dona Altina! Vamos jogar?".
- **Formato**: Opus/WebM (≈ 24–32 kbps mono) com fallback MP3 (≈ 48 kbps mono). Cada clipe ≤ 25 KB. Normalizar o volume de todos os clipes (≈ −16 LUFS) e cortar silêncios das pontas.
- **Fila de narração** (`narrator.ts`): prioridades (bingo/acumulado > prêmio > falta 1 > número > comentário). Uma fala de prioridade maior cancela a menor; números nunca se sobrepõem. Em rodada acelerada, narrar só os prêmios.

### 5.2 Música de fundo
- Trilha **alegre, animada e original, sem clichê**: nada de "música de cassino" genérica, órgão de bingo ou loop de app. Direção sugerida: **groove leve brasileiro** (bossa/samba-jazz suave ou MPB instrumental animada), com violão/cavaquinho, piano elétrico, baixo e percussão leve, por volta de 100–115 BPM. A música deve dar vontade de balançar a cabeça sem cansar em sessões longas.
- **Origem permitida** (escolher uma e documentar a licença em `public/audio/LICENSES.md`):
  1. **Música gerada proceduralmente via Web Audio** (`src/audio/music.ts`): sequenciador leve com progressões de acordes que variam, linhas de baixo e percussão sintetizadas. Peso zero de download; prioridade se ficar musicalmente agradável.
  2. Ou **faixas com licença livre de uso** (CC0 ou equivalente), sem obrigações incompatíveis com o projeto, comprimidas em Opus ≈ 48 kbps, **2 a 3 faixas** de 1–2 min em loop sem emenda audível, que alternam.
- **Duas camadas**: trilha calma no menu e entre rodadas; trilha um pouco mais animada durante o sorteio; e um trecho curto de vitória (3–6 s) para prêmios grandes, que volta à trilha normal com fade.
- **Ducking**: abaixar a música para ~30% enquanto a narração fala e voltar suavemente (rampas de 150–250 ms com `GainNode`).

### 5.3 Efeitos sonoros
Curtos e originais, gerados por Web Audio ou arquivos minúsculos (≤ 15 KB): sorteio da bola, marcação (bem suave), "falta 1" (brilho), prêmio pequeno, moedas na contagem do saldo, prêmio grande e fanfarra de bingo.

### 5.4 Mixagem e controles
- Três volumes independentes nos Ajustes, com botões grandes (−/+ ou 5 níveis): **Música**, **Voz** e **Efeitos**. Padrões: música 40%, voz 100%, efeitos 70%.
- Um botão grande de som (ligar/desligar tudo) sempre visível na tela de jogo.
- Usar um único `AudioContext` com grafo `master → [music, voice, sfx]`. Decodificar e manter em memória só os clipes usados; liberar o que não for necessário.
- O áudio só inicia após o primeiro toque (política dos navegadores). A tela inicial tem um botão grande "🍀 ENTRAR" que libera o áudio e toca a saudação.
- Pausar a música quando a aba ou app for para segundo plano (`visibilitychange`) e retomar ao voltar.

---

## 6. UX para idosa de 88 anos (prioridade máxima) — agente `elderly-ux-designer`

- **Uma ação principal por tela**: botão **JOGAR** enorme (mín. 96 px de altura), verde-trevo, sempre no mesmo lugar.
- Alvos de toque **≥ 64 px**, com espaçamento ≥ 12 px. Nenhum gesto (swipe, pinch, long-press) para a jogadora.
- Texto com no mínimo **20 px**. Números da cartela grandes, preenchendo a célula. Bola sorteada gigante.
- **Alto contraste** (WCAG AAA para números e botões). Número marcado: fundo de cor forte com o número ainda legível.
- Linguagem simples e carinhosa: "Jogar", "Bola extra", "Terminar", "Parabéns, Dona Altina!". Sem jargão e sem inglês.
- O que a voz fala também aparece escrito na tela, em letra grande (legenda curta), para o caso de ela não ouvir bem.
- Sem pop-ups inesperados, sem timers que pressionam e sem botão de sair fácil de tocar sem querer.
- Saldo sempre visível, grande, no topo.
- Debounce de 400 ms nos botões principais e `touch-action: manipulation`. O layout deve ser legível sem zoom.
- Ao reabrir, o jogo volta exatamente ao estado anterior.

---

## 7. Layout responsivo

Mobile-first, mas **o alvo principal é tablet**. Testar em 800×1280, 1280×800, 1024×768, 768×1024 e celular 360×740.

- **Tablet paisagem (principal)**: à esquerda, grade 2×2 com as 4 cartelas (~70% da largura); à direita, coluna com bola atual grande, histórico em grade 6×10 (1–60, acende quando sorteada), acumulado, saldo e botões.
- **Tablet retrato**: topo com saldo e acumulado; bola atual e histórico compacto; cartelas 2×2; barra inferior fixa com aposta (−/+), Trocar cartelas e JOGAR.
- **Celular**: cartelas 2×2 compactas, histórico recolhido (só as últimas 5 bolas) e botões no rodapé.
- CSS Grid + `clamp()` e media queries de orientação. Nenhuma rolagem durante o jogo em tablet.

---

## 8. Direção visual

- Clima de "salão de bingo aconchegante e de sorte": fundo verde-trevo profundo com detalhes em dourado; cartelas em creme claro com números escuros.
- Logo **"Altina da Sorte🍀"** em letra arredondada, grande, com o trevo dourado e verde.
- Cada cartela com uma cor de borda própria (vermelho, azul, verde e roxo) e o número 1–4 bem visível.
- Bolas em CSS com gradiente radial e cor por faixa (1–12, 13–24, 25–36, 37–48, 49–60).
- Marcação: círculo de cor forte "carimbado", com micro-animação de escala (150 ms).
- Animações sincronizadas com a narração: o selo do padrão aparece junto com a fala.
- Comemoração do bingo com confete e trevos em CSS (máx. 40 elementos; desligado no modo leve).

---

## 9. Configurações

- Tela "Ajustes" (engrenagem grande): velocidade do sorteio, volumes de música/voz/efeitos, legendas, modo leve e tamanho do texto (Normal / Grande / Muito grande).
- **Painel do administrador (para o neto)**: acesso escondido com 5 toques no logo + PIN de 4 dígitos definido em `config.ts`. Mostra o histórico de bingos com datas, estatísticas, RTP real e rodadas por dia. Permite ajustar `TUNING`, resetar acumulado e créditos e exportar/importar o estado em JSON (para trocar de tablet).

---

## 10. Persistência (`storage.ts`)
Salvar: saldo, aposta, cartelas atuais e ativas, acumulado, configurações (incluindo volumes), estado do Diretor, rodada em andamento, data do último bônus diário e estatísticas. Esquema versionado (`version: 1`) com migração. Salvar ao fim de cada bola e rodada (debounced).

---

## 11. Arquitetura sugerida

```
.claude/agents/            // definições dos 6 subagentes
src/
  main.ts                  // bootstrap, PWA, wake lock (perf-pwa-engineer)
  types.ts, events.ts      // contratos (orquestrador)
  config.ts, texts.ts
  state.ts, cards.ts, patterns.ts, payout.ts        // game-rules-engineer
  director.ts, drawBuilder.ts, rng.ts               // odds-director
  storage.ts, sw.ts                                 // perf-pwa-engineer
  audio/
    engine.ts              // AudioContext, grafo, ducking, loader
    narrator.ts            // fila de narração com prioridades
    music.ts               // trilha (procedural ou player de faixas)
    sfx.ts
    script.ts              // roteiro de falas
  ui/
    layout.ts, cardView.ts, ballView.ts, controls.ts, modals.ts, captions.ts, admin.ts
  styles/ (tokens.css, layout.css, components.css)
public/audio/ (voice/, voice-custom/, music/, sfx/, LICENSES.md)
scripts/simulate.ts
scripts/audio/ (generate.ts, normalize, README.md)
tests/ (unit) e tests/e2e/
```

Cada cartela é um array de 15 números + bitmask de marcados (15 bits). Padrões também são bitmasks, e a detecção é `(marcados & mascara) === mascara`. A UI e o áudio **apenas escutam eventos**; nenhuma regra de jogo dentro deles.

---

## 12. Acessibilidade e qualidade
- Vitest cobrindo: geração de cartelas válida, todas as máscaras, "só o maior padrão paga", acumulado só até a 30ª bola, custo da bola extra, Diretor respeitando mínimo/máximo/mês e drawBuilder nunca excedendo o alvo.
- Teste da fila de narração: prioridades, cancelamento e ausência de sobreposição.
- `aria-live` para bolas e prêmios; botões com rótulos claros.
- Testar no Chrome Android com throttling e, se possível, em um tablet real antigo.

---

## 13. Proibições
- Nenhuma menção a dinheiro real, compra, loja, assinatura, anúncios, rede social ou links externos.
- Nenhum asset, nome, voz, som ou música copiado de jogos ou faixas existentes. Toda trilha de terceiros precisa de licença livre documentada.
- Nenhuma chave de API no repositório ou no bundle.
- Nenhuma dependência pesada e nenhum tracking de terceiros.

---

## 14. Checklist do `qa-reviewer` (rodar ao fim de cada fase)
- [ ] Uma rodada completa com 1 toque (JOGAR), sem ler instruções.
- [ ] Simulador: 2–3 bingos/mês nos 3 perfis; prêmios pequenos frequentes; saldo nunca trava o jogo.
- [ ] Linha, cantos, pirâmide, U, linha dupla, moldura, bingo, acumulado e bola extra conforme as regras.
- [ ] Narração animada em todos os eventos da seção 5.1, sem sobreposição, com legenda na tela.
- [ ] Música alegre tocando, com ducking na narração e volumes separados funcionando.
- [ ] Sem rolagem em tablet, legível sem zoom, alvos ≥ 64 px.
- [ ] Bundle e Lighthouse dentro do orçamento; áudio carregado depois e sem atrasar o início.
- [ ] Funciona offline, instalado na tela inicial como "Altina da Sorte".
- [ ] Estado preservado ao fechar e reabrir.
- [ ] Nome "Altina da Sorte🍀" e tratamento "Dona Altina" em todos os textos e falas.

---

## 15. Fases de entrega

1. **Fundação (orquestrador)**: criar `.claude/agents/`, `types.ts`, `events.ts`, `config.ts`, `texts.ts` e o esqueleto do projeto Vite.
2. **Paralelo**:
   - `game-rules-engineer`: regras + testes;
   - `odds-director`: Diretor, drawBuilder e simulador calibrado (me mostre a saída do `npm run simulate`);
   - `elderly-ux-designer`: UI tablet paisagem com dados mockados;
   - `audio-designer`: roteiro, pipeline de geração da voz, música e efeitos.
3. **Integração (orquestrador)**: ligar regras, Diretor, UI e áudio pelo barramento de eventos. Rodada completa jogável com narração e música.
4. **Responsividade e polimento** (`elderly-ux-designer` + `audio-designer`): retrato, celular, legendas, comemorações sincronizadas com a voz.
5. **PWA e persistência** (`perf-pwa-engineer`): offline, cache do áudio, wake lock, ajustes e painel admin.
6. **Otimização** (`perf-pwa-engineer`): medir bundle e Lighthouse, modo leve, eliminar jank.
7. **Revisão final** (`qa-reviewer`) e **deploy na Vercel**, com relatório final para mim.


---
# Atualização v2 (fidelidade ao vídeo bingo de 90 bolas) — o que mudou
Detalhes do pedido em `docs/SPEC-v2.md`. Onde houver conflito, **vale esta seção**.

- **Bolas 1–90**; sorteio principal de 30; cartelas 3×5, coluna `c` usa `18c+1..18c+18`.
- **Aposta por cartela 1–10** (padrão 5); **cartelas 1–4** por controle − / + (tocar na cartela não faz nada); botão **Números** gera cartelas novas.
- **Prêmios (conjunto `classico`, padrão):** Linha ×5, Linha dupla ×25, Bingo ×500 (+ Acumulado). Conjunto `variado` (7 padrões) por `PATTERN_SETS` em `config.ts`, trocado no painel do administrador.
- **Acumulado:** começa em 5.000 e cresce 2% da aposta total por rodada (fracionário; exibido/pago com `floor`). Paga se o Bingo sair até a 30ª bola: 100% (aposta ≥3), 75% (aposta 2), 50% (aposta 1), somado ao ×500. Bingo na bola extra não paga acumulado.
- **Bolas extras:** até **9**; só com "falta 1" para prêmio melhor; custo dinâmico (8% do maior ganho, valor redondo); **bola extra grátis** (≈17,5% das ofertas, `plan.free`).
- **Turbo** (toggle, salvo): bolas a ~120 ms, voz só nos prêmios e na oferta de extra.
- **Correio da sorte:** carta 📬 no topo; diário (+300) na 1ª abertura do dia, e ocasional (10–100, máx. 2/dia, após 30 min jogados); nunca durante o sorteio.
- **Tela:** trilho de 30 bolas + 9 casas de extra, contador, tabela de prêmios fixa, painel de bola extra no lugar da bola (não modal), selos de prêmio nas cartelas.
- **Voz:** 142 clipes pt-BR gerados com **Piper (voz "faber", dataset CC0)** + pós-processamento animado (+10% velocidade, tom, vogais esticadas); `manifest.json` evita requisições 404; voz própria em `voice-custom/` substitui. Bordões de bingo (liga/desliga em Ajustes). Prévia: `npm run audio:preview` → `docs/qa/audio-preview.wav`.
- **Dados:** save `version: 2` (migra v1 preservando saldo, acumulado, diretor e estatísticas; descarta a rodada em andamento, aposta 20→10).
- **Modo leve:** automático só depois de 3 rodadas e nunca sobrescreve a escolha manual; `prefers-reduced-motion` só sugere na 1ª abertura.
- **Diretor:** metas v2 validadas por `npm run simulate` (2–3 bingos/mês; sem prêmio 55–62%; ≥1 Linha 30–38%; extra 25–35%; ≤~20 recargas/90 dias no perfil de 120 rodadas/dia).
- **Medido:** Lighthouse mobile Performance 100 (`docs/qa/lighthouse.md`); JS 33 KB gzip; CSS 6,5 KB; primeira carga ≈41 KB gzip; voz ≈0,6 MB baixada após ENTRAR.


---
# Atualização v3 (responsivo em tudo + painel do neto) — o que mudou
Pedido completo em `docs/SPEC-v3.md`. Onde houver conflito, **vale esta seção**.

- **Responsivo:** sem aviso de girar; layouts para 25 viewports (tablet deitado/em pé, celular deitado/em pé); logo sempre visível; alvos ≥64 px, texto ≥20 px, sem rolagem; auditoria `tests/e2e/ui-audit.ts` com 0 achados.
- **Painel do neto:** 5 toques no logo ou Ajustes → "Painel do neto 🔒". Abas Resumo, Jogo, PIN, Aparelho. PIN padrão `1958` (`ADMIN_PIN` em `src/config.ts`); troca pelo painel; `?resetpin=1` volta ao padrão.
- **Tuning em tempo de execução** (`RuntimeTuning`, no save v3): bingos por mês 1 | 2 | 2–3 | 3–4; prêmios do dia a dia; oferta e chance de grátis da extra; custo da extra; presente 500/1000/2000; correio 300/500; conjunto de padrões. Vale na próxima rodada. 12 presets validados: `npm run simulate -- --preset all`.
- **Save v3:** migra v1/v2 preservando saldo, acumulado, diretor, estatísticas e (v2) rodada em andamento.
- **Áudio leve:** música pré-renderizada em `OfflineAudioContext` (CPU da música ≈ 0), decodificação de voz sob demanda com LRU, `AudioContext` suspenso quando parado, modo econômico (24 kHz).
- **Compatibilidade:** alvo Android 5/6 (Chrome/WebView ~60); CSS com fallbacks.
- **Pendente (não medido):** metas de desempenho 3.5.7 em CPU 6×/20×, teste de resistência de 250 rodadas, teste de rotação no app real e revisão QA completa da fase 3 (agentes interrompidos). Dados reais virão da aba "Aparelho" no tablet.
