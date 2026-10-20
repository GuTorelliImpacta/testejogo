# Altina da Sorte

Jogo de bingo para tablet, feito para a Dona Altina: cartelas grandes, voz narrando as bolas, créditos que nunca acabam (o jogo dá um presente quando o saldo zera) e um "painel do neto" protegido por PIN para ajustar a dificuldade. Funciona offline (PWA); o progresso fica salvo no aparelho.

## Comandos

- `npm run dev` abre o jogo em modo de desenvolvimento.
- `npm run build` confere os tipos e gera `dist/`.
- `npm test` roda os testes (regras, migração de save, painel/PIN, Diretor).
- `npm run simulate` simula rodadas para calibrar o Diretor de sorte.
- `npm run e2e` roda os testes de tela (Playwright).

## Estrutura

- `src/config.ts`: constantes do jogo, PIN padrão, ajustes padrão (`DEFAULT_TUNING`).
- `src/types.ts`, `src/gameApi.ts`, `src/events.ts`: contratos entre regras, UI e áudio.
- `src/cards.ts`, `patterns.ts`, `payout.ts`, `round.ts`: regras (cartelas, padrões, prêmios, bola extra).
- `src/director.ts`, `drawBuilder.ts`: Diretor de sorte (frequência de bingo, prêmios do dia a dia).
- `src/game.ts`: máquina de estados do jogo e API do painel do neto.
- `src/storage.ts`: save no aparelho (`version: 3`) e migração de saves v1/v2.
- `src/ui`, `src/audio`: telas e som (só escutam eventos).

## Painel do neto, PIN e ajustes

- **PIN padrão: `1958`.** Está em `src/config.ts` (`ADMIN_PIN`). Ele é só para a vó não entrar sem querer; o código é público, então não é segurança de verdade. O PIN nunca aparece em tela, legenda ou voz.
- **Abrir o painel:** 5 toques no logo, ou o botão "Painel do neto" em Ajustes. Digite o PIN.
- **Trocar o PIN:** no painel, "Trocar PIN" (digite o novo PIN de 4 números duas vezes). O novo PIN fica salvo no aparelho (`adminPin` no save) e passa a valer no lugar do padrão; o antigo deixa de funcionar.
- **Voltar ao PIN padrão (esqueci o PIN):** abra o jogo com `?resetpin=1` no final do endereço (ex.: `https://.../?resetpin=1`). O jogo pede o PIN padrão (o de `src/config.ts`) e, se conferir, apaga o PIN trocado. O código que liga isso é `handleResetPinParam` em `src/game.ts`, chamado por `src/main.ts`.
- **Ajustes (valem a partir da PRÓXIMA rodada, nunca no meio de uma):** bingos por mês, prêmios do dia a dia, frequência de bola extra, chance de bola grátis, custo da bola extra, valor do presente (500/1.000/2.000), correio diário (300/500) e conjunto de padrões (Clássico/Variado). "Restaurar padrão" volta tudo ao original.
- **Estatísticas:** bingos do mês e datas dos últimos, dias desde o último, rodadas por dia, prêmios por tipo, RTP real, recargas e configuração ativa.
- **Exportar/Importar:** no painel, "Exportar" gera um texto com o save completo, incluindo os ajustes e o PIN; "Importar" no outro tablet (já destravado) cola esse texto e restaura tudo, menos a rodada em andamento.
