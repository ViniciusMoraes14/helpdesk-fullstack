# Publicação do Help Desk Online no Render + Neon

## Build e start
- Runtime: Node
- Build command: `npm install`
- Start command: `npm start`
- Root directory: `.` (diretório que contém este package.json)

## Variáveis obrigatórias no Render
- `NODE_ENV=production`
- `DATABASE_URL`: connection string do Neon (com `sslmode=require`)
- `HELPDESK_USER`: nome do administrador inicial
- `HELPDESK_PASSWORD`: senha forte exclusiva para o administrador (mínimo 10 caracteres)
- `SESSION_SECRET`: segredo aleatório com pelo menos 32 caracteres

## Recuperação de senha
Para habilitar envio de e-mail, configure também:
- `RESEND_API_KEY`
- `EMAIL_FROM`: remetente verificado no provedor de e-mail
- `APP_BASE_URL`: URL pública HTTPS do serviço Render

## Banco
Na primeira inicialização, `server.js` executa `init()` e cria/adiciona as tabelas necessárias, inclusive `helpdesk_sessions`. Use um banco Neon vazio para a primeira implantação. Não execute scripts SQL destrutivos.

## Segurança e operação
- Não envie `.env`, credenciais ou `.git` ao repositório/pacote de publicação.
- Se credenciais do `.env` já foram enviadas ao GitHub, revogue/troque-as; apagar o arquivo em um commit posterior não apaga o histórico.
- O serviço gratuito do Render pode dormir por inatividade e não é recomendado para produção empresarial. O armazenamento do banco Neon também tem limites do plano gratuito; faça backups e monitore consumo.
- A sessão é armazenada no PostgreSQL para persistir entre reinicializações/instâncias. O proxy HTTPS do Render é reconhecido para cookies `Secure`.
- As rotas de API de dados são protegidas por sessão; gerenciamento de usuários e alterações de políticas/feriados exigem administrador.
