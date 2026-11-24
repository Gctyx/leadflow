# Leadflow Engine — Documentação dos endpoints

Base: `http://localhost:3000/api/v1` · Formato: JSON · Datas em ISO-8601 UTC.

## Autenticação

| Superfície | Mecanismo |
|---|---|
| `/leads`, `/sellers` | Cabeçalho `X-API-Key: <chave>` (valores em `API_KEYS`; mais de uma chave permite rotação) |
| `/webhooks/leads` | Assinatura HMAC (sem API key), ver [Webhook](#post-webhooksleads) |
| `/health/live`, `/health/ready` | Públicos (fora de `/api/v1`) |

Todas as respostas trazem `X-Request-Id` (aceita um `X-Request-Id` do cliente no formato `[\w-]{8,64}`) e `RateLimit-Limit` / `RateLimit-Remaining`.

## Formato de erro (único para toda a API)

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Dados inválidos",
             "details": [{ "in": "body", "path": "phone", "message": "Telefone inválido" }],
             "request_id": "0c0e5c0e-..." } }
```

Erros nunca incluem stack trace, SQL ou o valor enviado pelo cliente.

| HTTP | `code` | Quando |
|---|---|---|
| 400 | `INVALID_BODY` | JSON malformado / encoding não suportado |
| 401 | `UNAUTHORIZED` | API key ausente/inválida; assinatura de webhook ausente, inválida ou expirada (resposta sempre genérica) |
| 404 | `NOT_FOUND` | Recurso ou rota inexistente |
| 409 | `LEAD_ALREADY_EXISTS` | Telefone (normalizado) já cadastrado — `details.lead_id` aponta o existente |
| 409 | `SELLER_ALREADY_EXISTS` | E-mail de vendedor já cadastrado |
| 409 | `EVENT_ID_REUSED` | Webhook com `event_id` já usado e conteúdo diferente |
| 413 | `PAYLOAD_TOO_LARGE` | Corpo acima de 50 KB (REST) / 100 KB (webhook) |
| 422 | `VALIDATION_ERROR` | Campos inválidos, desconhecidos (`strict`) ou telefone inválido |
| 429 | `RATE_LIMITED` | Excedeu o limite; header `Retry-After` |
| 503 | `SERVICE_UNAVAILABLE` | MySQL indisponível; header `Retry-After: 5` (o cliente deve repetir) |
| 500 | `INTERNAL_ERROR` | Erro inesperado (detalhes só no log, correlacionados pelo `request_id`) |

---

## Leads

### `POST /leads` — criar lead

Corpo (campos extras são rejeitados):

| Campo | Tipo | Regra |
|---|---|---|
| `name` | string | obrigatório, 2–120, sem caracteres de controle |
| `phone` | string | obrigatório, 8–32; **normalizado para E.164** (região padrão `BR`); inválido → 422 |
| `email` | string | opcional, e-mail válido, minúsculo |
| `origin` | string | opcional, 2–60 (`letras números . : _ -`) |
| `notes` | string | opcional, até 1000 |

```bash
curl -i -X POST http://localhost:3000/api/v1/leads \
  -H 'X-API-Key: dev-api-key-change-me-0001' -H 'Content-Type: application/json' \
  -d '{"name":"Ana Souza","phone":"(11) 91234-5678","email":"ana@example.com","origin":"landing_page"}'
```

`201 Created` + `Location: /api/v1/leads/{id}`:

```json
{ "id": "0b7f...", "name": "Ana Souza", "email": "ana@example.com", "phone": "+5511912345678",
  "channel": "api", "origin": "landing_page", "notes": null, "status": "assigned",
  "seller_id": "9d1c...", "assigned_at": "2026-11-24T21:00:00.000Z",
  "created_at": "2026-11-24T21:00:00.000Z", "updated_at": "2026-11-24T21:00:00.000Z" }
```

* Se não houver vendedor ativo: `status: "unassigned"`, `seller_id: null` — o lead é atribuído assim que um vendedor for ativado/criado (ou pela varredura do worker).
* Telefone repetido (em qualquer formato: `11912345678`, `+55 11 91234-5678`...) → `409 LEAD_ALREADY_EXISTS`.

### `GET /leads` — listar, filtrar e paginar

Filtros (todos opcionais, combináveis): `status` (`unassigned|assigned`), `seller_id` (uuid), `channel` (`api|webhook`), `origin`, `phone` (normalizado antes de comparar), `email`, `name` (prefixo), `created_from`, `created_to` (ISO-8601). Paginação: `limit` (1–100, padrão 20) e `cursor`.

```bash
curl -s 'http://localhost:3000/api/v1/leads?status=assigned&limit=2' -H 'X-API-Key: ...'
```

```json
{ "data": [ { "id": "...", "...": "..." } ], "page": { "limit": 2, "next_cursor": "MTQ5" } }
```

Ordem: mais recentes primeiro. `next_cursor` é opaco; `null` quando acabou. Paginação **keyset** (não `OFFSET`): custo constante e sem repetir/perder itens com inserções concorrentes.

### `GET /leads/{id}` — consultar lead
`200` com o objeto do lead · `404` se não existir · `422` se `id` não for UUID.

### `GET /leads/{id}/events` — trilha de rastreabilidade
```json
{ "data": [
  { "type": "lead.created",  "channel": "api", "seller_id": null,   "webhook_event_id": null, "request_id": "...", "metadata": null, "created_at": "..." },
  { "type": "lead.assigned", "channel": "api", "seller_id": "9d1c", "webhook_event_id": null, "request_id": "...", "metadata": { "strategy": "round_robin" }, "created_at": "..." } ] }
```
Tipos: `lead.created`, `lead.assigned`, `lead.duplicate_attempt` (cada tentativa repetida de cadastro do mesmo telefone). Canais: `api`, `webhook`, `system` (atribuição posterior pelo sistema).

---

## Vendedores

### `POST /sellers` — cadastrar
Corpo: `name` (2–120), `email` (único), `active` (boolean, padrão `true`). `201` · `409 SELLER_ALREADY_EXISTS`. Se nascer ativo, leads represados são distribuídos.

### `PATCH /sellers/{id}` — alterar status
Corpo: `{ "active": false }`. Retorna o vendedor atualizado. Desativar tira o vendedor da rotação **imediatamente** (a linha é travada: nenhuma atribuição em andamento chega a um vendedor já desativado). Leads já atribuídos permanecem com ele. Reativar devolve o vendedor à rotação e drena leads represados.

### `GET /sellers` e `GET /sellers/{id}`
`GET /sellers?active=true&limit=50` · retorna `{ "data": [...] }` (campos: `id, name, email, active, last_assigned_at, created_at, updated_at`).

---

## `POST /webhooks/leads`

Corpo (mesma estrutura de lead dentro de `data`):

```json
{ "event_id": "evt_20261124_0001", "source": "landing_page",
  "data": { "name": "Ana Souza", "phone": "(11) 91234-5678", "email": "ana@example.com" } }
```

`event_id` (8–100, `[\w.:-]`) + `source` formam a **chave de idempotência**.

### Assinatura (HMAC-SHA256)

Cabeçalhos obrigatórios:

| Cabeçalho | Valor |
|---|---|
| `X-Leadflow-Timestamp` | epoch em segundos (10 dígitos); aceito dentro de ±`WEBHOOK_TOLERANCE_SECONDS` (padrão 300 s) |
| `X-Leadflow-Signature` | `v1=` + hex(HMAC-SHA256(segredo, `"{timestamp}." + corpoBrutoExato`)) |

Gerar um `curl` pronto e assinado:

```bash
WEBHOOK_SECRET=dev-webhook-secret-change-me-0001 npm run webhook:sign -- \
  '{"event_id":"evt_20261124_0001","source":"landing_page","data":{"name":"Ana Souza","phone":"11912345678"}}'
```

### Respostas

| HTTP | Significado | O que o emissor deve fazer |
|---|---|---|
| `202` | `{"status":"accepted","event_id":"..."}` — evento gravado de forma durável; o lead será criado de forma assíncrona | nada |
| `200` | `{"status":"duplicate","event_id":"...","processing_status":"..."}` — reentrega do mesmo evento | parar de retentar |
| `401` | assinatura ausente/inválida/expirada (mensagem genérica) | corrigir a assinatura |
| `409` | `EVENT_ID_REUSED` — mesmo `event_id`, conteúdo diferente | gerar novo `event_id` |
| `422` | envelope/telefone inválido (nada é persistido) | corrigir o payload |
| `429` / `503` | limite excedido / MySQL indisponível | reenviar após `Retry-After` |

Resultado final de cada evento (consultável em `webhook_events.status`): `processed` (lead criado) · `duplicate` (telefone já existia — sem retry) · `dead` (erro permanente ou tentativas esgotadas).

---

## Saúde

* `GET /health/live` → `200 {"status":"ok"}` (processo no ar).
* `GET /health/ready` → `200 {"status":"ok"}`, `200 {"status":"degraded"}` (Redis fora: a API continua atendendo; webhooks ficam no MySQL) ou `503 {"status":"unavailable"}` (MySQL fora).
