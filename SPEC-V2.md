# SPEC v2.0 — "Madeira Nobre & Resina" (revisada e executável)

> Substitui a spec original gerada pelo Gemini. Corrige 4 premissas falsas sobre o código atual,
> 6 lacunas técnicas que impediam o resultado visual e fixa as decisões de arte.
> Referência visual: `imagens/LudoV2.jpg` (2048×2048).
> Base real: `index.html` (2.939 linhas, arquivo único) + `tests/engine.test.mjs` (38 testes).

---

## 0. Decisões fixadas

| # | Decisão | Escolha |
|---|---|---|
| D1 | Composição da cena | **Fiel à imagem**: tabuleiro girado **45°** (bases a N/L/S/O, retas na diagonal). |
| D2 | Retas finais | Mantidas **coerentes com o motor** (giro 45° do tabuleiro lógico). O render original é espelhado; não copiamos o erro. |
| D3 | Dados | **1 dado interativo no hub central** (o render mostra 2; o jogo usa 1). Segundo dado do render é decorativo e foi descartado. |
| D4 | HUD | **Pílulas de vidro** por jogador (avatar + nome + placar + anel de timer) nos quatro cantos; barra superior e dock inferior discretos. |
| D5 | Resina | **Opaca com verniz** (`clearcoat 1`, `roughness .3`, `envMapIntensity .5`) — saturação previsível e barata; `transmission` fica como opção de "qualidade alta" no futuro. |
| D6 | Estrutura | **Modular** (ES modules) com o motor isolado em `js/game-engine.js`, mantendo os marcadores `ENGINE-START/END` e atualizando os testes. |
| D7 | Offline | Tailwind, Font Awesome, confetti e Three.js **vendorados** e pré-cacheados no SW. Zero CDN em runtime. |
| D8 | Telas | Home, setup (Solo/Local), lobby, modais, estatísticas e emotes **preservados**; só o HUD da partida é redesenhado. |

---

## 1. Premissas corrigidas (o que a spec original assumia errado)

| Spec original | Realidade do repositório |
|---|---|
| `sw.js`, `manifest.json`, `CACHE_NAME` existentes | **não existiam**; são criados nesta versão |
| `js/game-engine.js` com a lógica já separada | motor estava embutido no `index.html` entre marcadores |
| API de eventos `onRollDice/onMovePawn/…` | o motor **devolve arrays de eventos** e a UI chama `E.roll()`/`E.move()`; a ponte é `playEvents()` no controlador |
| `gameState` global | o estado é `Game.state` |
| Latão metálico sem ambiente | **metal sem env map renderiza preto** → `PMREMGenerator` obrigatório |
| `transparent+opacity` como resina | é vidro colorido; sem `transmission` não há refração |
| Câmera `[0,24,14]` sem yaw | produz bases nos cantos, **diferente da imagem** → yaw de 45° |
| Enquadramento mobile por largura do quadrado | com 45° a pegada é um losango (√2 maior) → calcular pela bbox do losango |
| Mini-canvas para o dado | 2º contexto WebGL desnecessário → dado na cena principal |

---

## 2. Arquitetura

```
index.html                  → shell: canvas + HUD + telas + modais
css/theme.css               → tokens de cor/material, tipografia, componentes de vidro/madeira
css/layout.css              → grid do HUD desktop/mobile, safe-areas, breakpoints
js/main.js                  → controlador (portado do index.html): telas, timers, bots, PeerJS
js/game-engine.js           → LudoEngine extraído verbatim (marcadores preservados)
js/scene3d/WorldManager.js  → renderer, câmera, luzes, env, loop, qualidade adaptativa
js/scene3d/WoodTextures.js  → textura + normal map de madeira e ardósia (canvas→CanvasTexture)
js/scene3d/GridMapper.js    → grid 15×15 → mundo (x,z), rotação 45°, conversões
js/scene3d/BoardBuilder.js  → mesa, slab, moldura, casas, estrelas, anéis, hub central
js/scene3d/PawnManager.js   → peões LatheGeometry, highlight, raycast, animações
js/scene3d/Dice3D.js        → dado de marfim, faces, tumbling, clique
vendor/three.module.min.js  → Three.js r169 (pinado)
vendor/tailwind.js          → Tailwind Play 3.4.16 (vendorado p/ offline)
vendor/fontawesome/…        → FA 6.5.1 (CSS + woff2)
vendor/confetti.min.js      → canvas-confetti 1.9.3
manifest.json, sw.js, icons/→ PWA instalável e offline
tests/engine.test.mjs       → passa a ler js/game-engine.js (mesmos 38 testes)
```

### 2.1 Contrato motor ↔ view (real, não hipotético)

O motor **não** tem observadores. A view é chamada pelo controlador:

```js
View.reset(state)                      // monta peões/dado para uma nova partida
View.sync(state, override, returning)  // posiciona todos os peões (substitui layoutTokens)
View.setPickable(color, validMoves)    // destaca peões jogáveis + raycast ativo
View.preview(color, piece, relTo)      // prévia de destino (hover/long-press)
View.animateMove(event)                // salto célula a célula
View.animateCapture(event)             // vítimas voam para a base
View.animateHome(event)                // entrada no hub
View.animateReturn(penalty)            // penalidade dos três 6
View.roll(value)                       // anima o dado e resolve no valor
View.describe(seat)                    // opcional: nome/avatar nos peões
View.onPick = (color, piece) => {}     // clique em peão válido
View.onDieClick = () => {}             // clique no dado
```

### 2.2 Estado e animação

- O estado já foi mutado pelo motor antes da animação; `Game.override` segura peões na posição antiga (comportamento atual preservado).
- Toda animação é `await`-ável: `playEvents()` continua sendo o único ponto de sequenciamento (assim o convidado online reproduz igual).
- Em partidas online nada muda no protocolo: host difunde `ACTION {events, state}`; a view do convidado anima os mesmos eventos.

---

## 3. Cena 3D

### 3.1 Câmera e enquadramento

- `PerspectiveCamera(fov = 32, near = 0.1, far = 200)`.
- Elevação ≈ 58°; **azimute = 45°** (tabuleiro girado): `boardGroup.rotation.y = +Math.PI/4`.
- Mapa resultante (verificado geometricamente): **vermelho a Oeste, verde ao Norte, amarelo a Leste, azul ao Sul** — igual à imagem.
- Enquadramento: `radius = 10.4` (meia-diagonal do tabuleiro com moldura) e
  `dist = radius / tan(fov/2) / min(1, aspect)` com folga de 1.06; no mobile reserva topo/base para o HUD (compensa no `camera.setViewOffset` ou no alvo).
- `lookAt(0, 0.15, 0)`; micro-parallax de ±2.5° no ponteiro (desativado em `prefers-reduced-motion` e em toque).

### 3.2 Render e cor

- `antialias: true`, `powerPreference: 'high-performance'`, `pixelRatio = min(devicePixelRatio, 2)` (1 em mobile).
- `outputColorSpace = SRGBColorSpace`, `toneMapping = ACESFilmicToneMapping`, `toneMappingExposure = 1.05`.
- Sombras `PCFSoftShadowMap`, mapa 2048 (desktop) / 1024 (mobile).
- **Ambiente**: `PMREMGenerator.fromScene(studioScene, 0.04)` — sala procedural (caixa escura + painéis emissivos quente/frio). Sem env map o latão fica preto.
- Luzes: `HemisphereLight(#fff8eb, #1b2130, 0.5)`, `DirectionalLight(#fffbeb, 2.2)` em `(10, 16, 8)` com sombra, `PointLight(#bae6fd, 25)` em `(-9, 8, -7)` para o especular frio da resina.
- Vinheta e grão via overlay CSS (não usar post-processing).

### 3.3 Materiais e paleta (medida na referência)

| Material | Parâmetros | Cor base |
|---|---|---|
| Madeira clara | `MeshStandardMaterial`, `map` + `normalMap`, `roughness .45`, `metalness .02`, `envMapIntensity 1` | `#e3c5a4` (veio `#925029`, sombra `#6b4226`) |
| Madeira escura (sulcos/moldura) | idem, `roughness .6` | `#7a4a2a` |
| Ardósia da mesa | `roughness .92`, `metalness 0` | `#2c333f` (variação `#3c434e`) |
| Latão | `metalness .92`, `roughness .24`, `envMapIntensity 1.15` | `#d4af6a` |
| Resina vermelha | `MeshPhysicalMaterial` | `#a5140d` (luz `#d15e60`) |
| Resina verde | idem | `#0b6b1f` |
| Resina amarela | idem | `#b8811c` |
| Resina azul | idem | `#223a86` |
| Marfim do dado | `roughness .35`, `clearcoat .4` | `#e9dcc4` |
| Pips | `roughness .8` | `#1b1713` |

Resina: `clearcoat 1`, `clearcoatRoughness .14`, `roughness .3`, `envMapIntensity .5`, emissivo discreto. `transmission` 0 (economia + saturação); avaliar em "qualidade alta" no futuro. Fallback mobile é o mesmo material (sem custo extra).

### 3.4 Anatomia do tabuleiro

- Mesa: plano 60×60 com textura de ardósia procedural e **sombra de contato** (plano com textura radial alfa) sob o tabuleiro.
- Slab: laje 16.4×16.4×0.85 com cantos arredondados (r≈0.55), topo em `y=0`.
- Moldura: lábio elevado 0.18 em madeira, com bisel e sulco escuro interno.
- Casas (52 do percurso + 20 das retas): plaquinha de madeira levemente elevada (0.025) com sulco perimetral escuro; **saídas e retas finais** em resina colorida embutida; **casas seguras** com estrela de latão extrudada (5 pontas, 0.02 de altura) no centro.
- Bases 6×6: rebaixo de resina com moldura de madeira e **4 anéis de latão** (`TorusGeometry`, r 0.3) para as cavidades.
- Hub central 3×3: tampo de madeira, 4 triângulos de resina com divisórias de latão convergindo ao centro; os dados repousam nele.
- Filete dourado de 0.01 unidade entre casas.

### 3.5 Peões

- `LatheGeometry` com perfil torneado (base 0.30 → corpo cônico → colar → esfera 0.16), altura 0.62.
- Resina colorida (mesmo material das casas, com `transmission` reduzida para 0.5 e `thickness .35`).
- Base com `CylinderGeometry` de latão discreto.
- Jogável: sobe 0.14, anel emissivo pulsante sob ele, oscilação senoidal; bloqueado: opacidade 0.55, sem anel.

### 3.6 Dado

- Cubo 0.62 com cantos arredondados (geometria própria por `ExtrudeGeometry` de quadrado arredondado + bisel).
- Pips: 9 posições por face, discos escuros levemente rebaixados.
- Repousa no hub central; `roll(value)` faz tumbling (0.7 s) com eixos aleatórios e assenta na face do valor (quaternions fixos por face).
- Clique/toque no dado = rolar; tecla `Espaço` mantida.

---

## 4. HUD

### 4.1 Estrutura

```
┌─ topbar: voltar · título/status · info · histórico · pausa · som ─┐
│ pill R (avatar+nome+placar+anel)            pill G                │
│                    [canvas 3D]                                   │
│ pill Y                                      pill B                │
└─ dock: [dado 3D] · dica contextual · 3 indicadores de 6 ─────────┘
```

- **Pílulas**: fundo `rgba(15,20,30,.42)`, `backdrop-filter: blur(14px) saturate(1.2)`, borda 1px `rgba(255,255,255,.14)`, raio 999px, sombra suave; avatar 44px com anel de progresso (`conic-gradient`) = timer; nome 13px; placar = 4 losangos que acendem por peão no centro; `opacity .72` fora da vez, `1` na vez + brilho na cor.
- **Desktop (≥ 900px)**: pílulas nos cantos, alinhadas às bases (O, N, L, S conforme rotação); tabuleiro ocupa ~76% da altura.
- **Mobile (≤ 899px)**: duas pílulas no topo (lado a lado) e duas na base, dock compacto; tabuleiro ocupa ~92% da largura útil.
- **Dock**: botão redondo de madeira/latão com o dado 3D ao lado (o dado vive no canvas; o botão é a affordance), dica curta, três pontos de "6 seguidos".
- **Histórico** e **regras** em modal (mantém a funcionalidade "Últimas jogadas").
- **Emotes** (online): faixa flutuante acima do dock.
- **Turn banner**: texto central sobre o tabuleiro, vidro escuro com borda na cor.
- Acessibilidade: status `aria-live`, botões com `aria-label`, foco visível, `prefers-reduced-motion` desliga parallax/oscilação.

---

## 5. Performance e qualidade adaptativa

- Orçamento: ≤ 120 draw calls típicas (meshes de casas agrupados por material via `InstancedMesh` quando possível; estrelas e anéis clonados).
- `InstancedMesh` para casas comuns (72), estrelas (8), anéis (16), filetes.
- Qualidade: mede FPS nos primeiros 3 s; se `< 30`, desliga sombras, força `pixelRatio 1`, troca resina para fallback e reduz `antialias` (reload não necessário).
- `visibilitychange` → pausa o loop de render (economia de bateria).

---

## 6. PWA

- `manifest.json`: nome "Ludo Supreme", `display: standalone`, `background_color #141922`, `theme_color #141922`, ícones 192/512 (gerados a partir do logo de 4 quadrantes).
- `sw.js`: `CACHE_NAME = 'ludo-v2.0.0-wood3d'`; pré-cache de `./`, `./index.html`, `./css/*`, `./js/*`, `./js/scene3d/*`, `./vendor/**`, `./icons/*`, `./manifest.json`; `activate` limpa caches antigos; navegação `network-first` com fallback ao cache; assets `cache-first`.
- Registro somente em `https:`/`localhost`.

---

## 7. Preservação funcional (checklist de regressão)

- [ ] Regras: número exato, captura, casas seguras, três 6 (limite e penalidade), bloqueio, bônus, duplas, modo rápido.
- [ ] Bots: fácil/médio/difícil, dificuldade por robô, velocidade, autoplay de movimento único.
- [ ] Timers: limite por ação, AFK após 3 estouros, pausa, retomada com `deadline`.
- [ ] Solo, Local (hotseat) e Online (PeerJS): criar/entrar por código, link e QR, ready, cores, espectador, heartbeat, reconexão, migração de host, emotes.
- [ ] Save/resume (`ludo:solo`, `ludo:local`, `ludo:host:*`), estatísticas, perfil/avatar.
- [ ] Modais: regras, pausa, saída, humanos concluídos, resultados/revanche.
- [ ] Teclado (`Espaço`, `1–4`), toque longo para prévia, som, mute, confetti.
- [ ] `tests/engine.test.mjs` com 38/38 verdes.

---

## 8. Critérios de aceite visuais

1. A cena é lida como "tabuleiro de madeira sobre mesa de ardósia" a 1 m de distância.
2. Bases N/L/S/O com retas diagonais, como na referência.
3. Latão com reflexo visível (não preto) e estrelas legíveis.
4. Resina translúcida com profundidade e especular; sem aparência de plástico opaco.
5. Dado de marfim com pips legíveis e sombra consistente.
6. HUD de vidro legível sobre a cena em desktop e mobile, sem cobrir o tabuleiro.
7. Nenhuma tela branca, nenhum erro de console, 60 FPS em desktop e ≥ 30 FPS em mobile intermediário.

## 9. Não-objetivos

- Fotorrealismo/ray tracing, DOF, bloom (substituídos por vinheta CSS e materiais bem calibrados).
- Modelos/texturas externos, build step, framework.
- Novas regras de jogo ou mudanças no protocolo online.
- Rotação livre da câmera (fixa + parallax).

## 10. Fases

| Fase | Entrega |
|---|---|
| 1 | Esqueleto modular, motor extraído, testes verdes, vendor/PWA |
| 2 | Cena: mesa, slab, moldura, casas, bases, hub, luzes, env, câmera 45° |
| 3 | Peões, dado, animações, raycast e bridge com `playEvents` |
| 4 | HUD de vidro responsivo + telas preservadas |
| 5 | Qualidade adaptativa, polimento, screenshots comparativos |
