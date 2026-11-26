# D2 — Identidade, plataforma e armazenamento

## Estado atual
- `src/services/deviceIdentity.js` (113): `devicePlatform()` L19-25, ID por plataforma L47-59,
  `deviceKey = sha256Hex("pulse-license:" + id)` L61-64/103, fallback aleatório L66-77.
- `src/services/storage.js` (47): localforage `app` L8-13; FTUE L15-20.
- `src/services/crypto.js` (80): AES-GCM-256 com chave não extraível L38-61; protege senha Xtream e URL M3U
  (`src/stores/authStore.js:37-56`) e `directUrl` (`src/stores/playerItems.js:61-71`).
- `src/services/errorLog.js` (84): últimos 20 erros mascarados L9-11.
- Servidor aceita `deviceKey` `^[A-Za-z0-9_-]{16,128}$` (`server/license/license-core.mjs:39`).
- Testes-spec: `tests/platform.test.js` (18), `tests/errorLog.test.js` (6), `tests/crypto.test.js` (2),
  `tests/licenseClient.test.js` (parte de deviceIdentity).

## Estado alvo
- ID: `roDeviceInfo.GetChannelClientId()` → `deviceKey = sha256("pulse-license:" + id)` com `roEVPDigest`
  (mesmo formato hex de 64 caracteres).
- Armazenamento: `roRegistrySection` (32 KB) só para estado pequeno — sessão, licença, perfis, PIN, FTUE; histórico,
  fila e listas salvas em arquivo JSON (`tmp:` é volátil, então persistir no registro só o essencial; ver R9).
- Segredos em repouso: `roDeviceCrypto` (chave do app) no lugar de AES-GCM-256 (`research/stack-research.md`,
  "Criptografia").
- `platform`: sair com `END` da cena; sem PiP/Cast/orientação.

## Passos

### 1. deviceKey e plataforma
**Teste**: Rooibos — formato `^[0-9a-f]{64}$`, estável entre execuções.
**Sucesso**: `/v1/access` aceita a chave (após DS).

### 2. Camada de armazenamento
**O que muda**: módulo `Store` com `get/set/remove` sobre registro + arquivo, `Flush()` em lote, alarme se
`GetSpaceAvailable()` < 4 KB.
**Teste**: Rooibos — gravar/ler/apagar; estado sobrevive a relançar o app (e2e).
**Rollback**: reverter commit.

### 3. Cifra de segredos e log de erros
**Teste**: cifrar/decifrar ida e volta; `maskSecrets` com os casos de `tests/maskSecrets.test.js`.

## Riscos
| Risco | Impacto | Mitigação | Evidência |
|---|---|---|---|
| Registro de 32 KB estoura (R9) | Médio | só estado pequeno no registro | `research/risk-assessment.md` |
| `tmp:` some no reboot | Médio | histórico curto no registro, catálogo re-baixável | `research/stack-research.md` |

## Dependências
Depende de D0. Bloqueia D3, D7, D8.
