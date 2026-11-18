# D7 — Perfis e controle parental

## Estado atual
- `src/stores/profileStore.js` (152): até 5 perfis L8, padrões Principal/Família/Convidado L27-31, seletor a cada
  abertura L36.
- `src/stores/parentalStore.js` (150): estados visível/bloqueada/oculta; `ADULT_NAME` L23 e bloqueio automático L72-78;
  PIN `^\d{4,8}$` L15, sem PIN de fábrica L97-114; 5 erros → 30 s L20-21/119-124; hash `SHA-256("pulse-pin:"+pin)`
  L27-34; por perfil e lista, herda de p1 L17/53-55; desbloqueio vale só na sessão L39; storage ilegível bloqueia tudo
  L62-67.
- Telas: `ProfileGate.vue` (208), `ParentalModal.vue` (135), `PinDialog.vue` (89).
- Testes-spec: `tests/profileStore.test.js` (5), `tests/profileGate.test.js` (5), `tests/parental.test.js` (12).

## Estado alvo
- `ProfileState` e `ParentalState` em `m.global`, gravados no registro (D2).
- `ProfileScreen`; `ParentalScreen`; PIN com **DynamicPinpad** (cert. 4.12).
- Mesmo hash do PIN com `roEVPDigest`.

## Passos

### 1. Regras portadas
**Teste**: casos de `tests/parental.test.js` e `tests/profileStore.test.js` portados (auto-bloqueio adulto, lockout,
herança de p1, sem PIN não desbloqueia).

### 2. Telas
**Teste**: e2e — escolher perfil ao abrir, bloquear categoria, pedir PIN ao entrar, 5 erros travam 30 s.
**Rollback**: reverter commit.

## Riscos
Baixos — lógica pura com boa cobertura de testes.

## Dependências
Depende de D2, D4, D5.
