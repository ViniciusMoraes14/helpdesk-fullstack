# Help Desk Online — Full Stack

## Stack
- Front-end: HTML/CSS/JavaScript
- Back-end: Node.js + Express
- Banco: PostgreSQL
- API externa: ViaCEP
- API própria: REST
- CORS habilitado

## Rodar localmente
1. Instale Node.js 18+.
2. Crie um banco PostgreSQL (local ou online).
3. Copie `.env.example` para `.env` e configure `DATABASE_URL`.
4. Execute:
```bash
npm install
npm start
```
5. Abra `http://localhost:3000`.

A tabela `tickets` é criada automaticamente.

## Publicar online
Você pode hospedar o Node.js em um serviço de aplicação e o PostgreSQL em um serviço gerenciado. Configure `DATABASE_URL` como variável de ambiente e use o comando `npm start`.

## APIs
- `GET /api/health`
- `GET /api/tickets`
- `POST /api/tickets`
- `PATCH /api/tickets/:id`
- `DELETE /api/tickets/:id`
- `GET /api/cep/:cep` (proxy seguro para ViaCEP)

## Observação
O projeto é preparado para API/banco online, mas não contém uma URL de banco pública ou credenciais reais. Para produção, configure autenticação, HTTPS, rate limiting, logs, backup e permissões por perfil.
