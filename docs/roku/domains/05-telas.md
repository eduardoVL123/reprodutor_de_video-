# D5 — Telas de navegação (home, catálogo, detalhes, busca, conta)

## Estado atual
- `src/views/Dashboard.vue` (1149): abas home/live/vod/series/favoritos/busca/conta L77-78; coesão 0,036 no grafo
  (`graphify-out/GRAPH_REPORT.md`) — várias responsabilidades.
- `src/components/CatalogBrowser.vue` (806), `GridView.vue` (235), `GridItem.vue` (126), `ui/HorizontalRail.vue` (185),
  `SideMenu.vue` (284), `MediaDetailsModal.vue` (618; "do início" a partir de 15 s L29), `SearchScreen.vue` (535;
  debounce 300 ms, 60 caracteres, 40 resultados L25-27), `AccountScreen.vue` (207), `NetworkStatus.vue` (42).
- Utils: `seriesPlaylist.js`, `seriesTitle.js`, `formatTime.js`, `artwork.js`.
- Visual aprovado: layout B, `docs/design-2.0/mockups.html` (RFC-014); cores e marca na `CLAUDE.md`.
- Testes-spec: `tests/sideMenu.test.js` (13), `tests/horizontalRail.test.js` (13), `tests/catalogBrowser.test.js` (7),
  `tests/mediaDetailsModal.test.js` (7), `tests/dashboardHome.test.js` (6), `tests/bottomNav.test.js` (7, só celular).

## Estado alvo
- `HomeScreen` com menu lateral (LabelList) + fileiras (**RowList/ZoomRowList**) — mesmo layout B.
- `CatalogScreen` (categorias + **MarkupGrid**), `DetailsScreen` (temporadas/episódios), `SearchScreen` com
  **DynamicKeyboard** (cert. 4.12), `AccountScreen` (perfil, assinatura Roku Pay, diagnóstico, sair).
- Itens de `GridItem` viram componentes de item do RowList/MarkupGrid com pôster no tamanho exibido (memória de textura).
- `BottomNav` não existe na Roku (só celular).

## Passos

### 1. Home e menu lateral
**Teste**: e2e — foco começa no menu, Direita entra na fileira, Voltar em aba não-home vai à home.
**Sucesso**: troca de tela ≤ 3 s e resposta a tecla ≤ 250 ms (cert. 3.x).

### 2. Catálogo, detalhes e séries
**Teste**: Rooibos para `seriesPlaylist`/`seriesTitle`/`formatTime`/`artwork` (casos de `tests/seriesPlaylist.test.js`,
`tests/seriesTitle.test.js`, `tests/formatTime.test.js`, `tests/artwork.test.js`); e2e de abrir filme e série.

### 3. Busca e conta
**Teste**: e2e — busca com 3+ letras, resultados por seção, buscas recentes por perfil.
**Rollback**: cada tela é um componente; reverter commit. 

## Riscos
| Risco | Impacto | Mitigação | Evidência |
|---|---|---|---|
| Dashboard monolítico | Médio | dividir em telas SceneGraph independentes | coesão 0,036 no grafo |
| Pôsteres grandes estouram textura | Médio | redimensionar e limitar fileiras visíveis | `research/stack-research.md` |

## Dependências
Depende de D3, D4. Bloqueia D6 (abrir player), D7, Fase 6.
