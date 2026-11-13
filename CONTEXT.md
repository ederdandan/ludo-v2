# Ludo Supreme v2 — Contexto do Projeto

> Documento de retomada (humano ou agente de IA).
> **Versão 2.0 — "Madeira Nobre & Resina"**: diorama 3D em Three.js + HUD de vidro + PWA offline.
> Referência visual: `imagens/LudoV2.jpg`. Spec executável: `SPEC-V2.md`. Capturas: `imagens/v2-desktop.png`, `imagens/v2-mobile.png`, `imagens/v2-home.png`.

---

## 1. TL;DR

- **O que é:** Ludo clássico no navegador, com tabuleiro 3D de madeira/latão/resina sobre mesa de ardósia. Modos **Solo** (bots), **Local** (hotseat) e **Online P2P** (PeerJS).
- **Stack:** HTML + CSS + ES Modules puros. **Three.js r169 vendorado** (sem build). Tailwind, Font Awesome e canvas-confetti também vendorados.
- **Sem backend.** O convidado nunca roda regras: o anfitrião é a autoridade.
- **Offline:** `manifest.json` + `sw.js` pré-cacheiam tudo; funciona instalado como PWA.
- **Regras:** motor `LudoEngine` intacto (extraído da v1) — **38/38 testes verdes**.
- **Estado atual:** funcional de ponta a ponta (roll → animação → turno → bot → online), com fidelidade visual ~75–80% do render de referência.

---

## 2. Como rodar e testar

```powershell
node scripts/serve.cjs 5173     # http://localhost:5173
# ou
npm start

node tests/engine.test.mjs      # 38 testes do motor (Node 24)
# ou
npm test
```

- **Nunca** abra por `file://`: ES modules e service worker exigem http(s).
- Em `localhost` o SW registra e o modo offline funciona; em GitHub Pages (HTTPS) idem.
- `sw.js` usa `CACHE_NAME = 'ludo-v2.0.0-wood3d'` — **incremente ao mudar assets**, senão o navegador serve a versão antiga do cache.
- Para depurar sem cache: DevTools → Application → Service Workers → *Bypass for network* (ou perfil novo).

---

## 3. Estrutura de arquivos

| Caminho | Papel |
|---|---|
| `index.html` | Shell: canvas, vinheta, HUD da partida, telas, modais, boot. |
| `css/theme.css` | Tokens (madeira/latão/vidro), primitivos de UI, HUD, modais, animações. |
| `css/layout.css` | Posicionamento das pílulas (desktop × mobile), dock, breakpoints. |
| `js/game-engine.js` | **Motor puro** (marcadores `ENGINE-START/END` preservados para os testes). |
| `js/main.js` | Controlador: telas, timers, bots, save/resume, PeerJS, HUD, ponte com a cena. |
| `js/scene3d/WorldManager.js` | Renderer, câmera, luzes, ambiente PMREM, loop, qualidade, fachada `View`. |
| `js/scene3d/BoardBuilder.js` | Mesa, laje, moldura, 72 casas, bases, estrelas, hub, materiais. |
| `js/scene3d/PawnManager.js` | Peões (Lathe), realce, prévia, sombras de contato, tweens, raycast. |
| `js/scene3d/Dice3D.js` | Dado de marfim, pips, tumbling, clique. |
| `js/scene3d/WoodTextures.js` | Texturas procedurais (madeira, casa, ardósia, sombra). |
| `js/scene3d/GridMapper.js` | Grid 15×15 → mundo, rotação 45°, constantes de enquadramento. |
| `vendor/three.module.min.js` | Three.js r169 (pinado). |
| `vendor/tailwind.js` · `vendor/fontawesome/*` · `vendor/confetti.min.js` | Dependências vendoradas (offline). |
| `manifest.json`, `sw.js`, `icons/*` | PWA instalável. |
| `scripts/serve.cjs` | Servidor estático de dev com MIME correto. |
| `tests/engine.test.mjs` | 38 testes (lê `js/game-engine.js`). |
| `SPEC-V2.md` | Especificação corrigida (decisões, critérios, fases). |
| `imagens/` | Referência e capturas da v2. |

---

## 4. Arquitetura

```
index.html
  └─ js/main.js ──────────────► controlador (estado = Game.state)
        ├─ js/game-engine.js   motor puro (roll/move → eventos)
        └─ js/scene3d/*        cena 3D (visual, sem regra)
```

### 4.1 Fluxo de uma jogada

```
clique no dado / peão
  → actRoll/actMove (guards: busy, paused, turno, canControl)
  → E.roll/E.move mutam Game.state e devolvem eventos
  → Net.broadcastAction(events)        (host online)
  → playEvents(events)                 anima som/dado/peão/HUD
      → View.roll / View.animateMove / View.animateCapture / View.animateHome
  → afterAction() → save() → proceed() → scheduleNext() (bot, timer, autoplay)
```

O estado é mutado **antes** da animação; `Game.override` mantém peões na posição antiga até o tween chegar neles (mesmo padrão da v1).

### 4.2 Contrato `View` (WorldManager)

| Método | Uso |
|---|---|
| `reset(state)` | Reconstrói peões para uma partida (ou para o modo atração). |
| `sync(state, override, returning, opts)` | Posiciona todos os peões; `opts.pickableColor/validMoves` acende os jogáveis. |
| `setPickable(color, moves)` | Atualiza destaque/raycast. |
| `preview(color, rel, piece)` / `clearPreview()` | Anel de destino (hover/touch longo). |
| `animateMove(e)` | Salto célula a célula (160 ms/casa; 40 ms com movimento reduzido). |
| `animateCapture(e)` | Vítimas voam em arco para a base (520 ms). |
| `animateHome(e)` / `animateReturn(p)` | Chegada ao centro / penalidade dos três 6. |
| `roll(v)` | Tumbling do dado e resolve no valor. |
| `setDie(v)` | Coloca o dado na face sem animar. |
| `onPick(color, piece)` · `onDieClick` | Callbacks ligados em `createView`. |

**Importante:** toda animação tem *fallback* por `setTimeout` — se o `requestAnimationFrame` for suspenso (aba oculta), o jogo não trava. `actRoll`/`actMove` também usam `try/finally` para nunca deixar `Game.busy` preso.

### 4.3 Cena

- Renderer `antialias`, `ACESFilmicToneMapping`, exposição **0.94**, `SRGBColorSpace`, sombras `PCFSoft` 2048 (desligadas no mobile).
- Câmera `PerspectiveCamera(32°)`; elevação **55°** (desktop) / **64°** (retrato), alvo `(0, -0.75, 0)`.
- Tabuleiro girado **+45°** (`BOARD_YAW`) → **vermelho a Oeste, verde ao Norte, amarelo a Leste, azul ao Sul**, como na referência.
- Enquadramento: raio 12,6 (meia-diagonal + moldura), margem 1,3 (desktop) / 1,03 (mobile).
- Ambiente: `PMREMGenerator.fromScene` com sala procedural (teto quente, painéis quente/frio). **Sem env map o latão fica preto** — não remover.
- Luzes: hemisférica 0,34; key 2,85 em `(8,14,7)`; rim 0,85; frontal fria 1,05; direcional superior 0,6.
- Micro-parallax ±2,5° no ponteiro (desligado em `prefers-reduced-motion`).

### 4.4 Materiais e paleta

| Material | Parâmetros |
|---|---|
| Madeira (laje/moldura) | `map` + `normalMap` procedurais, `roughness .44–.48`, `metalness .03`, repeat 0,3 |
| Casas | textura de 256 px com moldura gravada, `normalizeUV`, variação por `instanceColor` |
| Ardósia | textura procedural repetida 8×, `roughness .9` |
| Latão | `#e0bb7d`, `metalness .95`, `roughness .18`, `envMapIntensity 1.7`, emissivo discreto |
| Resina (casas/bases) | `#a5140d`, `#0b6b1f`, `#b8811c`, `#223a86`; `clearcoat 1`, `roughness .3`, **sem transmission** (mais previsível e barato) |
| Peões | `LatheGeometry` (altura ~1,0 célula), cores mais claras que as casas, `clearcoat`, emissivo 0,17 |
| Dado | cubo arredondado por projeção de SDF, marfim `#efe3cc`, pips `#191512` salientes |

Geometria do tabuleiro: 52 casas de percurso + 20 de reta + 4 bases 6×6 + hub 3×3 + moldura 16,9. Casas comuns usam `InstancedMesh` (1 draw call).

### 4.5 Regras e rede (herdadas da v1, intactas)

- Motor: `rel = -1` base, `0..50` percurso, `51..55` reta, `56` centro. `SAFE = {0,8,13,21,26,34,39,47}`.
- Eventos: `FIRST, TURN, ROLL, NO_MOVES, EXTRA, THREE_SIXES, MOVE, PIECE_HOME, CAPTURE, PLAYER_FINISHED, TEAM_FINISHED, GAME_OVER`.
- Online: host autoritativo, protocolo `JOIN/REJOIN/READY/PICK_COLOR/ROLL_REQUEST/MOVE_REQUEST/EMOTE` → `WELCOME/LOBBY/STATE/ACTION/REJECT/PONG`, heartbeats, reconexão e migração por `epoch`. Detalhes em `CONTEXT.md` histórico/`SPEC-V2.md`.
- Persistência: `ludo:profile`, `ludo:mute`, `ludo:solo`, `ludo:local`, `ludo:soloConfig`, `ludo:localConfig`, `ludo:onlineRules`, `ludo:onlineTime`, `ludo:host:<CODE>`, `ludo:lastHost`, `ludo:session:<CODE>`, `ludo:stats`, `ludo:statsLast`.

---

## 5. HUD

- **Topo:** voltar, título (desktop), status (`aria-live`), regras, histórico, pausa, som.
- **Pílulas dos jogadores:** avatar com anel de timer (`conic-gradient` em `--p`), nome, estado ("Sua vez"/pronto/offline), 4 losangos de peões no centro e contador.
  - Desktop: cantos (vermelho TL, verde TR, azul BL, amarelo BR).
  - Mobile: 2 no topo, 2 acima do dock; status vira segunda linha da topbar.
- **Dock:** botão do dado + dica contextual + 3 indicadores de seis + tempo restante.
- **Turn banner**, **emotes** (online), **histórico em modal**, **modais** de regras/pausa/saída/resultados preservados.
- Acessibilidade: `aria-live` no status, alvos ≥ 44 px, foco visível, `prefers-reduced-motion` desliga parallax e animações.

---

## 6. PWA

- `manifest.json`: standalone, tema `#141922`, ícones 192/512 + maskable.
- `sw.js`: pré-cache de HTML/CSS/JS/vendor/ícones; navegação *network-first* com fallback; assets *cache-first*; `activate` limpa caches antigos.
- Registro apenas em `https:`/`localhost` (ver fim de `js/main.js`).

---

## 7. Verificação rápida

1. `node tests/engine.test.mjs` → 38/38.
2. `node --check` nos módulos (já validado).
3. Abrir `http://localhost:5173`, iniciar Solo, rolar o dado, mover um peão, conferir:
   - dado 3D gira e assenta no valor;
   - peão salta casa a casa com sombra;
   - captura devolve a vítima à base;
   - HUD atualiza nome/vez/timer;
   - Console sem erros.
4. Mobile (DevTools 412×900): pílulas em duas linhas, dock sem sobrepor o tabuleiro.
5. Offline: DevTools → Network → Offline → recarregar (com SW ativo).

Capturas usadas como referência de regressão: `imagens/v2-desktop.png`, `imagens/v2-mobile.png`, `imagens/v2-home.png`.

---

## 8. Dívidas e próximos passos

1. **Fidelidade ao render** (~75–80%): falta brilho/refração real na resina, grain mais rico, sombras mais dramáticas e peões mais “vidro”. O caminho é `transmission` seletiva + quality tiers, não mais polígonos.
2. **Performance:** ~226 draw calls. Próximo passo: agrupar bases/aneís e materiais; medir em aparelho real (o headless usa SwiftShader).
3. **Qualidade adaptativa** mede FPS só nos primeiros 3 s e desliga sombras; falta reduzir DPR/resina progressivamente e reavaliar.
4. **Câmera mobile** usa elevação 64°; validar em iPhone/Android reais (safe areas).
5. **Serviço de sala**: PeerJS Cloud é dependência externa; sem TURN o online falha em NAT restritivo.
6. **Testes de UI/rede** inexistentes (só o motor tem cobertura). Um teste de fumaça headless (CDP) já foi usado e pode ser formalizado.
7. **i18n**: strings pt-BR espalhadas em JS/CSS.
8. **Cache versionado**: lembrar de subir `CACHE_NAME` a cada release.
9. **Hook de debug** `window.__ludo` só existe em localhost; remover quando não for mais útil.
10. **Git**: repositório ainda sem commits — criar o primeiro commit antes de evoluir.

---

## 9. Onde mexer

| Objetivo | Arquivo |
|---|---|
| Regra de jogo | `js/game-engine.js` (+ `tests/engine.test.mjs`) |
| Dado, peões, animações | `js/scene3d/Dice3D.js`, `PawnManager.js` |
| Tabuleiro, materiais, cores | `js/scene3d/BoardBuilder.js`, `WoodTextures.js` |
| Câmera, luz, enquadramento, qualidade | `js/scene3d/WorldManager.js` |
| HUD, telas, rede, save | `js/main.js` |
| Aparência do HUD | `css/theme.css`, `css/layout.css` |
| Offline/PWA | `manifest.json`, `sw.js` |
