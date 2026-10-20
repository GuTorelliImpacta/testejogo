# Lighthouse e evidências de performance/PWA (v2)

Lighthouse 13.5.0, perfil mobile (emulação Moto G), CPU 4x, rede simulada padrão (slow 4G: RTT 150 ms, 1,6 Mbps), Chromium do Playwright, contra `vite preview` do build de produção. Relatório: `docs/qa/lighthouse.json`.

| Categoria | Nota |
|---|---|
| Performance | 100 (também 100 com CPU 6x: LCP 1,3–1,4 s, TBT 40–70 ms) |
| Acessibilidade | 100 |
| Boas práticas | 100 |
| SEO | 91 (falta só robots.txt, irrelevante para app PWA) |

Métricas (CPU 4x): FCP 1,1 s, LCP 1,2 s, TBT 20 ms, CLS 0, Speed Index 1,1 s, TTI 1,4 s.

## Orçamento
- JS 33,4 KB gzip (limite 60); CSS 6,5 KB gzip (limite 15); HTML 0,6 KB.
- Primeira carga: 4 requisições, 0 de áudio, ~41 KB transferidos gzip (119 KB brutos); limite 250 KB.
- Áudio só é baixado após o toque em ENTRAR (144 requisições, ~592 KB, todas 200). Nenhuma resposta >=400 ao entrar e jogar uma rodada completa.

## Service worker (v2-<hash do build>)
- Versão do cache vira `v2-<hash>` a cada build (plugin em vite.config.ts), então cada deploy gera SW novo e apaga caches antigos (verificado: `altina-shell-v1` e a versão anterior foram removidas após atualização).
- 1ª visita: shell (7 itens) + manifest de voz + 285 itens de voz em cache; app abre offline e roda uma rodada sem falha de rede, também depois de reabrir e depois de atualizar o SW.
- Manifests de voz: rede primeiro, cache offline. Instalação não bloqueia por falha de voz.

## M7 / M8 / M10 / migração (scripts/qa/perf-pwa.mjs, scripts/qa/sw-test.mjs)
- M7: com FPS forçado a ~8, `light` fica false nas rodadas 1–3 e liga na 4ª (lightManual=false). Com escolha manual (light=false, lightManual=true) segue false nas 4 rodadas.
- M8: viewport `width=device-width, initial-scale=1, viewport-fit=cover` (sem user-scalable=no).
- M10: extra pago comprado (extraSpent=2), recarga no meio: saldo 918 antes e depois, extraSpent=2 e extrasUsed=1 mantidos; ao final apostadoTotal subiu 22 = aposta 20 + extra 2.
- Migração v1: saldo 4.321 e acumulado 7.123 preservados, aposta 20 -> 10, cartelas novas (1–89, 4x15), speed/stats/diretor preservados, versão 2 salva, sem erros.
