# Revisão QA — Fase 1 (Altina da Sorte🍀)

Revisor independente. Nenhum código de produção foi alterado. Scripts em `tests/e2e/qa/` (rodar com `npx tsx tests/e2e/qa/<arquivo>.ts` contra `vite preview --port 4180`; `QA_BASE` muda a URL): `layout.ts` (5 viewports x 12 estados), `flows.ts` (rodada, narração, acelerar, reload, bingo na extra, presente, bônus, auto), `offline.ts`, `robust.ts` (storage corrompido, toques, segundo plano), `rules.ts` (regras e acumulado).

Veredito: **não aprovado ainda**. Nenhum BLOQUEANTE de jogabilidade; 3 IMPORTANTES de correção + 2 de robustez/PWA devem voltar aos responsáveis antes do deploy.

## Checklist (seção 14)

| Item | Resultado | Evidência |
|---|---|---|
| Rodada completa com 1 toque (JOGAR) | OK | `flows.ts [1]`: ENTRAR + JOGAR, 30 bolas, terminou em 55 s, sem erros JS; oferta/celebração aparecem como botões enormes quando ocorrem |
| Simulador 2–3 bingos/mês nos 3 perfis; saldo não trava | OK | `npm run simulate -- --seeds 5`: 100% dos meses completos com 2–3 bingos (média 2,2 / 2,4 / 2,4); 0 meses com 0 ou 4+; intervalo mín 7,1 d; RTP comuns 0,85/0,91/0,89; oferta de extra 30%; sem prêmio 58%; recargas 0 / 8 / 61 por seed |
| Vitest | OK | `npx vitest run`: 4 arquivos, 50 testes passando |
| Regras (linha, cantos, pirâmide, U, dupla, moldura, bingo, só o maior, acumulado até 30ª, extra) | OK, exceto crescimento do acumulado | `rules.ts`: máscaras iguais à spec, prêmios x2/3/8/12/15/40/300, bingo na 29ª/30ª paga acumulado, na extra paga só x300 (créditos 800 -> 2200 com custo 100), limite de 10 extras, sem oferta sem chance. **FALHA**: crescimento do acumulado (A1) |
| Narração em todos os eventos, sem sobreposição, com legenda | Parcial | Mapeamento completo em `src/audio/index.ts`; legendas vêm dos eventos (não da fala). Falha A2 ("Valendo!" nunca é ouvido). Sem clipes de voz em `public/audio/voice/` (só speechSynthesis) — ver A5 |
| Música com ducking e volumes separados | Revisado só no código | Grafo master→[music→duck, voice, sfx]; duck 0,3 com rampas 180/250 ms; 3 volumes + mudo. Não foi possível ouvir em headless |
| Sem rolagem, texto >= 20 px, alvos >= 64 px | OK no jogo; falhas em modais | `layout.ts`: 0 rolagem de documento, 0 texto < 20 px, 0 alvo < 64 px em 1280x800, 800x1280, 1024x768, 768x1024, 360x740 (idle, sorteio, oferta de extra, bingo, presente, prêmios, ajustes, PIN, admin, texto "muito grande"). Ver M1/M2/M3 |
| Bundle | OK | JS 74,1 KB bruto = **27,8 KB gzip** (orçamento 60); CSS 21,0 KB = **5,2 KB gzip** (15); HTML 0,5 KB; primeira carga ~34 KB gzip. Lighthouse **não medido** (sem ferramenta no ambiente) |
| Offline / instalado | **Falha parcial** | A4 |
| Estado preservado ao recarregar | OK | `flows.ts [3]`, `[3b]`, `[3c]` |
| Nome e tratamento | OK | "Altina da Sorte🍀" em `<title>`, manifest, `T.title`; "Dona Altina" em saudações, presente, bônus, acumulado, extra |
| Proibições | OK | Sem links externos/dinheiro/loja no bundle (grep de http/https = 0); chave de API só via `process.env` em `scripts/audio/generate.ts`; `.env*` no `.gitignore` |
| Regras de animação | OK | Keyframes/transições só com `transform` e `opacity`; 0 `setInterval` (hook em runtime: 0 chamadas); após a rodada: 0 animações CSS, 0 confete, 1 timeout vivo |

## Achados

### IMPORTANTE

**A1. O acumulado nunca cresce com a aposta padrão** — `src/payout.ts:10-12`
`Math.round(current + totalBet * 0.02)` arredonda a cada rodada. Aposta total 20 (5x4, padrão) soma 0,4 e volta a 5000. Medido: após 100 rodadas, aposta total 4/8/20 deixa 5000 (esperado 5008/5016/5040); total 40 dá 5100 (esperado 5080). O mesmo código está no simulador, então o simulador não detecta. Reproduzir: abrir o jogo, jogar 5 rodadas, "Acumulado" continua 5.000. Sugestão: guardar o acumulado com decimais (ou acumular em centésimos) e arredondar só na exibição/pagamento; adicionar teste.

**A2. A fala de início de rodada é sempre cortada pelo primeiro número** — `src/audio/index.ts:100-103` + `src/audio/narrator.ts:110`
"Boa sorte/Vamos lá/Valendo!" tem prioridade 1 (comentário) e a primeira bola é emitida no mesmo tick (prioridade 2), que cancela a fala. Medido: `Valendo!` aos 828 ms e `Seis!` aos 830 ms. Com clipes reais o início nunca será audível (só a legenda). Sugestão: `preempt:false` + `dropIfBusy:false` no número da 1ª bola, ou atrasar a 1ª bola até a fala terminar, ou dar à fala de início prioridade >= número.

**A3. Estado salvo corrompido trava o jogo para sempre** — `src/storage.ts:65`, `src/game.ts:266-282`
`migrate` só confere `plan.main` ser array. Testado em `robust.ts`: `plan.extras` ausente -> `TypeError` dentro do laço assíncrono e a tela fica sem botões (JOGAR desabilitado, sem modal) [R3]; `round.active` ausente -> ENTRAR não faz nada [R5]; `plan.main` curto -> idem [R4]. Como o `round` é regravado e relido a cada abertura, o travamento é permanente (sem recuperação, sem tela de erro). Origem plausível: importação do painel admin ou esquema antigo. Sugestão: validar `round` por inteiro (30 bolas distintas 1–60, extras array, active de 4 booleanos, cartelas válidas) e descartar a rodada se inválida; envolver `enter()`/laços em try/catch que volta a `idle`.

**A4. Offline falha se o app for aberto só uma vez antes de ficar sem rede** — `public/sw.js:11`
O `install` pré-cacheia só `/`, manifest e ícones; JS e CSS hasheados só entram no cache em tempo de execução, e a primeira carga acontece antes de o SW controlar a página. Medido (`offline.ts`): 1ª visita, depois offline -> reload falha em `/assets/index-*.js` e `.css`, página em branco; com 1 reload online antes, funciona (rodada inicia offline). Impacto: instalar na tela inicial e usar sem Wi-Fi no mesmo dia pode dar tela vazia. Sugestão: injetar a lista de assets no build (ou precachear no `install` lendo `index.html`) e versionar o cache; limpar assets antigos (hoje o cache runtime só cresce).

**A5. Sem clipes de voz commitados (spec 5.1, preferência 1)** — `public/audio/voice/` vazio
A voz cai 100% no `speechSynthesis` do aparelho (qualidade e animação variam; não foi possível avaliar em headless). Pendência conhecida (exige chave TTS local). Efeito colateral: ver M4.

### MENOR

- **M1. Modais não cabem em telas menores e exigem rolagem interna** — `src/styles/components.css:200-204` (`.dlg` com `max-height:100%; overflow:auto`). Botão FECHAR fica fora da tela em: Ajustes 1024x768 (bottom 771/768), 768x1024 (1032/1024), 360x740 (também os +/- de volume); Prêmios 360x740 (952/740). Para a Dona Altina o Prêmios no celular exige gesto de rolar para fechar. Sugestão: botão FECHAR fixo no topo/rodapé do diálogo, ou compactar.
- **M2. Espaçamento entre alvos < 12 px** (spec 6): Ajustes `.seg` 8 px (`components.css:239`), teclado do PIN 10 px (`:288`), celular `--gap: 8px` (`layout.css`, bloco "celular"), JOGAR e FECHAR a 3 px em 1024x768 com Prêmios aberto.
- **M3. "Acumulado" cortado em 360x740** — `components.css:55-59` e `:321-323`: "5.00(" truncado; valores de 5 dígitos vão cortar. Também células das cartelas apertadas a 360 px e "Prêmios"/"Rápido" encostando nas bordas.
- **M4. 414 requisições a arquivos de áudio inexistentes a cada ENTRAR** — `src/audio/engine.ts` (`fetchClip`/`candidates`) + `index.ts:168`. Sem `manifest.json`, o carregador tenta `voice-custom/<id>.webm|mp3` e `voice/<id>...` para ~105 falas (medido: 414 em 8 s; no preview voltam como HTML, na Vercel como 404). Desperdício de rede/CPU no tablet fraco. Resolve-se ao gerar os clipes (o `generate.ts` escreve o manifest) ou ao commitar manifests vazios `{"ids":[]}`.
- **M5. Jogo automático após presente de créditos fica "ligado" sem rodar** — `src/game.ts:301-307`: `play()` abre o presente mas não zera `auto`; depois do PEGAR nada reinicia e o botão segue "Automático ✔" (o primeiro toque seguinte desliga). Spec: auto deve parar no presente.
- **M6. Bônus diário só aparece como legenda de 3 s + voz, sem tela** — `src/game.ts:~290` (`enter`) e `src/ui/index.ts` (`dailyBonus` só chama `captions.show`). Os +300 entram silenciosamente; a jogadora pode nem perceber. (A tela de presente do dev harness existe, mas não é usada no jogo real.)
- **M7. Modo leve pode ser ligado sem querer e fica gravado** — `src/main.ts:40,49`: FPS < 24 nos 3 primeiros segundos (inclui o jank de carga) chama `updateSettings({light:true})`, persistente; com `prefers-reduced-motion` força `light` a cada abertura, desfazendo a escolha do usuário.
- **M8. `user-scalable=no`** — `index.html:5`: impede zoom do sistema; spec pede legível sem zoom (ok), mas remove a rede de segurança.
- **M9. Legenda e fala podem divergir** — `src/ui/index.ts` monta legendas a partir dos eventos, não do narrador (`onCaption` não é usado): "Na próxima vai!" aparece mesmo quando a voz diz "Quase, quase!"; "Linhaaa!" vs variações "Fez linha!". Em rodada acelerada o `almost` ainda toca o efeito sonoro (`audio/index.ts:~106`), embora a fala seja suprimida.
- **M10. Estatística de custo de extra se perde ao retomar rodada** — `src/game.ts:271-273`: `extraSpent` é recalculado a 0 ao reabrir, então `apostadoTotal`/RTP do painel do neto subcontam extras já pagas antes do reload.
- **M11. Tocar em uma cartela (ocioso) a desativa sem confirmação** — `src/ui/index.ts` (`toggleCard`): alvo grande, risco de toque acidental reduzir a aposta sem ela perceber (cartela fica só esmaecida).
- **M12. Possível espera infinita por fala** — `src/audio/engine.ts:361-375`: o `done` de um clipe só resolve em `onended`; se o `AudioContext` for suspenso/interrompido pelo sistema (ligação, foco de áudio) com um clipe tocando, `waitForSpeech()` segura o próximo sorteio até o contexto voltar. Sem timeout de segurança (o caminho `speechSynthesis` tem). Não reproduzido (headless); risco teórico.

## Travas (jogo preso)
- Rodadas normais: nenhuma trava encontrada; duplo toque em JOGAR debita 1x; Acelerar/Automático/aposta respeitam fase; sem localStorage o jogo roda (R2); JSON inválido cai em save novo (R1); minimo 1 cartela ativa (R8); ir para segundo plano e voltar continua a rodada (R9).
- Travas reais apenas via estado salvo inválido (A3). Oferta de extra e celebração esperam o toque por design (sem timer).

## Retomada de rodada (`game.ts`)
Reabrir no meio: bolas e créditos preservados (980 antes e depois, histórico reconstruído, rodada termina e contabiliza 1x). Reabrir na oferta de extra após comprar uma: créditos 799 e `extrasUsed=1` preservados, oferta volta. Reabrir na celebração do bingo: créditos pagos 1x (7700 -> 7700), `round=null`, JOGAR liberado. Reabrir após pagar acumulado: ok.

## Não verificado
Lighthouse (Performance >= 95) e jank em tablet real; qualidade/volume reais de voz, música e ducking (sem áudio no ambiente); contraste AAA medido (apenas inspeção visual dos screenshots); instalação na tela inicial em dispositivo.

---
## Correções do orquestrador após a revisão
- A1 acumulado fracionário (exibe/paga `floor`) — corrigido (`payout.ts`, `game.ts`).
- A2 "Valendo!" não é mais cortado pela 1ª bola (`audio/index.ts`).
- A3 validação estrita da rodada salva (`storage.ts`).
- A4 SW pré-cacheia JS/CSS e usa `ignoreVary`; offline na 1ª visita verificado.
- Presente cancela o modo automático.
- Pendentes: A5 (clipes de voz — requer chave TTS), menores de modais/espaçamento, Lighthouse, teste em tablet real.
