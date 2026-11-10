# Backup e restauração do banco de licenças

Plano de robustez, item 7. O banco `pulse-license` (Cloudflare D1) guarda aparelhos, ativações, pedidos, revendas
e assinaturas. Ele **tem dados de clientes**: nenhum arquivo de backup entra no Git nem fica dentro da pasta do
projeto.

Todos os comandos são **PowerShell**, rodados na raiz do projeto que está publicado (hoje o worktree
`C:\dev\reprodutor_de_video\.claude\worktrees\project-review-updates-1b0035`; depois do merge, a pasta principal).

## 1. Backup mensal (você roda)

Uma vez por mês, e antes de qualquer mudança grande no banco:

```powershell
New-Item -ItemType Directory -Force D:\backups\pulse-license | Out-Null
```

```powershell
npx wrangler d1 export pulse-license --remote --config server/license/wrangler.jsonc --output "D:\backups\pulse-license\pulse-license-$(Get-Date -Format yyyy-MM-dd).sql"
```

- Confira que o arquivo tem tamanho maior que zero.
- Guarde uma cópia fora do PC (pendrive ou nuvem com senha). Apague backups com mais de 24 meses: a política de
  privacidade promete apagar dados antigos (`PRIVACY.md`), e um backup velho guardaria o que já foi apagado.

## 2. Voltar no tempo (até 30 dias, sem arquivo)

O D1 guarda sozinho o histórico dos últimos 30 dias ("Time Travel"). É o caminho para desfazer um erro recente,
como um comando apagado sem querer.

Ver o ponto de restauração de um horário (horário em UTC; Brasília é UTC-3):

```powershell
npx wrangler d1 time-travel info pulse-license --timestamp 2026-11-10T18:00:00Z --config server/license/wrangler.jsonc
```

Restaurar o banco inteiro para aquele horário:

```powershell
npx wrangler d1 time-travel restore pulse-license --timestamp 2026-11-10T18:00:00Z --config server/license/wrangler.jsonc
```

**Atenção:** tudo o que aconteceu depois desse horário some (pagamentos, ativações). Antes de restaurar, faça o
backup do passo 1 e anote o "bookmark" que o comando mostra: ele permite desfazer a restauração.

## 3. Restaurar de um arquivo (mais de 30 dias, ou banco novo)

Só num banco **vazio** (o arquivo cria as tabelas). Para trocar o banco inteiro:

1. Crie um banco novo: `npx wrangler d1 create pulse-license-restaurado` (ou no painel da Cloudflare, Workers &
   Pages → D1). Anote o `database_id` que ele mostra.
2. Troque o `database_name` e o `database_id` em `server/license/wrangler.jsonc` pelos do banco novo.
3. Carregue o arquivo no banco novo:

   ```powershell
   npx wrangler d1 execute pulse-license-restaurado --remote --config server/license/wrangler.jsonc --file "D:\backups\pulse-license\pulse-license-2026-11-10.sql"
   ```

4. Publique (`npm run license:deploy`) e faça o commit do `wrangler.jsonc`.

Pagamentos feitos entre a data do arquivo e a restauração ficam fora: confira em Pagamentos no painel e no
Mercado Pago, e use "Reprocessar" nos que faltarem.
