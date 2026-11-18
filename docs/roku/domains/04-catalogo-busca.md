# D4 — Catálogo e busca

## Estado atual
- `src/stores/catalogStore.js` (276): ações por seção L21-25, timeout 120 s L19, remapeamento de séries L103-118,
  carga em RAM antes de salvar L183-198, erros L206-213.
- `src/services/catalogDb.js` (430): chunks de 500 L25, LRU 6 L29, versão 3 L28/132, filtro de visibilidade L63-112,
  itens em várias categorias L52-61, falta de cota L216-222.
- `src/services/catalogSearch.js` (153): mínimo 3 caracteres, ranking 0-3 L11-26, busca incremental L36-55.
- `src/utils/normalizeText.js` (20): NFD + remoção de acentos.
- Testes-spec: `tests/catalogDb.test.js` (8), `tests/catalogStore.m3u.test.js` (6), `tests/parental.test.js` (12),
  `tests/searchScreen.test.js` (3).

## Estado alvo
- `CatalogTask`: baixa cada seção com `AsyncGetToFile`, faz `ParseJson` no Task, grava um **índice compacto** (por
  categoria: ids + nome normalizado + ícone) e páginas de itens em arquivos; carrega páginas sob demanda.
- Cache: arquivos em `cachefs:`/`tmp:` (somem no reboot → re-download com tela de progresso); versão de catálogo como hoje.
- Busca: mesma regra de ranking sobre o índice de nomes normalizados; `foldText` com tabela de acentos (R10).
- Filtro parental aplicado no índice (categorias ocultas/bloqueadas fora de "Todos", busca e zapping).

## Passos

### 1. Benchmark (vem da Fase 0)
Decide tamanho de página e se o índice cabe em RAM em aparelho de 512 MB (R5). **Sucesso**: < 15 s até a home.

### 2. Índice e páginas
**Teste**: Rooibos com os casos de `tests/catalogDb.test.js` (contagem por categoria, item em várias categorias,
versão força re-download).

### 3. Busca
**Teste**: casos de ranking de `src/services/catalogSearch.js` portados; `foldText` com nomes acentuados, grego e
cirílico preservados.

## Riscos
| Risco | Impacto | Mitigação | Evidência |
|---|---|---|---|
| Lista de 50k+ estoura memória (R5) | Alto | parse por seção no Task, índice compacto, páginas | `src/services/catalogDb.js:5` |
| Sem `String.normalize` (R10) | Baixo | tabela de acentos | `src/utils/normalizeText.js:1-20` |

## Dependências
Depende de D1, D3. Bloqueia D5, D6, D7.
