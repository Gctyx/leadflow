<div align="center">

# Leadflow Engine

**API REST para receber, deduplicar, distribuir e rastrear leads comerciais**<br>
Solução do desafio *Backend Sênior — LexVita*

![Node.js](https://img.shields.io/badge/Node.js-22-5FA04E?logo=nodedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Express](https://img.shields.io/badge/Express-5-000000?logo=express&logoColor=white)
![MySQL](https://img.shields.io/badge/MySQL-8-4479A1?logo=mysql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-Streams-DC382D?logo=redis&logoColor=white)
![OpenAPI](https://img.shields.io/badge/OpenAPI-3.0-6BA539?logo=openapiinitiative&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)

[Início rápido](#início-rápido) ·
[Swagger](#documentação-da-api-swagger--openapi) ·
[Executável](#executável-de-um-clique) ·
[Arquitetura](#arquitetura) ·
[Testes](#testes)

</div>

---

## Sumário

1. [Requisitos do desafio × onde estão](#requisitos-do-desafio--onde-estão)
2. [Início rápido](#início-rápido)
3. [Documentação da API (Swagger / OpenAPI)](#documentação-da-api-swagger--openapi)
4. [Executável de um clique](#executável-de-um-clique)
5. [Configuração (variáveis de ambiente)](#configuração-variáveis-de-ambiente)
6. [Testes](#testes)
7. [Arquitetura](#arquitetura)
8. [Concorrência e consistência](#concorrência-e-consistência)
9. [Segurança](#segurança)
10. [Resiliência](#resiliência-indisponibilidade-e-repetição-de-eventos)
11. [Modelo de dados](#modelo-de-dados)
12. [Endpoints](#endpoints)
13. [Diagramas (C4 + classes)](#diagramas-c4--classes)
14. [Admin Seguro (Auth)](#admin-seguro-auth)
15. [Estrutura do repositório](#estrutura-do-repositório)
16. [Limitações conhecidas e próximos passos](#limitações-conhecidas-e-próximos-passos)

---

## Requisitos do desafio × onde estão

| Requisito | Onde está |
|---|---|
| Leads: criar, consultar, filtrar, paginar | `POST/GET /api/v1/leads` — filtros combináveis + paginação por cursor |
| Vendedores ativo/inativo | `POST /api/v1/sellers`, `PATCH /api/v1/sellers/:id` |
| Deduplicação por telefone normalizado | E.164 (libphonenumber) + `UNIQUE KEY uq_leads_phone` |
| Distribuição para vendedor ativo | round-robin com `SELECT … FOR UPDATE SKIP LOCKED` |
| Rastreabilidade | tabela append-only `lead_events` (criação, atribuição, tentativa duplicada) |
| Webhook | `POST /api/v1/webhooks/leads` com HMAC, idempotência e fila Redis |
| Concorrência · Segurança · Resiliência | seções [Concorrência](#concorrência-e-consistência), [Segurança](#segurança) e [Resiliência](#resiliência-indisponibilidade-e-repetição-de-eventos) |
| Docker / Filas (diferencial) | `docker-compose.yml` endurecido + Redis Streams com consumer group + [executável de um clique](#executável-de-um-clique) |
| Documentação | **Swagger UI** em `/docs`, contrato em `/openapi.json` e [`docs/API.md`](docs/API.md) |
| C4 + diagrama de classes | [`docs/diagrams`](docs/diagrams) ([seção](#diagramas-c4--classes)) |

**Stack:** Node.js 22 · TypeScript (strict) · Express 5 · MySQL 8 (InnoDB) · Redis 7 (**Streams, sem BullMQ**) · Zod · Swagger UI · Vitest + Supertest · Docker Compose.

---

## Início rápido

Escolha **um** dos três caminhos.

### Opção A — Executável de um clique (só precisa de Docker)

Dê dois cliques em `Leadflow.exe` (Windows) ou execute `leadflow-macos-*` / `leadflow-linux-*`. Ele confere/instala o Docker, gera as senhas, sobe tudo, espera a API ficar pronta e abre um menu com a demonstração, as chaves, o Swagger e os logs. Detalhes em [Executável de um clique](#executável-de-um-clique).

### Opção B — Docker Compose

```bash
# 1) gere o .env com segredos aleatórios (nada de senha padrão: o compose recusa subir sem eles)
cp .env.example .env
#    edite .env e troque TODOS os valores CHANGE_ME / change-me, por exemplo:
#    openssl rand -hex 24      # para cada senha/chave (API_KEYS e WEBHOOK_SECRETS: mín. 16 caracteres)

# 2) suba MySQL + Redis + migrations + API + worker
docker compose up --build -d

# 3) confira
curl http://localhost:3000/health/ready      # {"status":"ok"}
```

> [!NOTE]
> A API escuta apenas em `127.0.0.1` e **MySQL/Redis não são publicados** no host. Para rodar os testes contra esses serviços use o override de desenvolvimento:
> `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d mysql redis`
>
> Escala do worker: `docker compose up -d --scale worker=3`.

### Nginx (Load Balancer)

- Serviço `nginx` incluso para TLS/HTTP2 e rate limit no perímetro. Em produção, monte certificados válidos em `nginx/certs/server.crt` e `server.key`.
- Atrás do LB, defina `TRUST_PROXY=true` no `.env` para o rate limit usar o IP real do cliente.

### Opção C — Local (sem Docker para a aplicação)

```bash
cp .env.example .env              # ajuste DATABASE_URL / REDIS_URL
npm install
npm run migrate                   # aplica migrations/*.sql
npm run dev                       # API (+ worker inline, WORKER_INLINE=true)
# produção: npm run build && npm start   e, em outro processo: npm run start:worker
```

Requisitos: Node ≥ 20, MySQL ≥ 8.0.16 (usa `SKIP LOCKED` e `CHECK`), Redis ≥ 6.2 (usa `XAUTOCLAIM`).

### Primeira chamada (smoke test)

```bash
export K='X-API-Key: <sua chave de API_KEYS>'
curl -s -X POST localhost:3000/api/v1/sellers -H "$K" -H 'Content-Type: application/json' \
  -d '{"name":"Carlos Lima","email":"carlos@example.com"}'
curl -s -X POST localhost:3000/api/v1/leads   -H "$K" -H 'Content-Type: application/json' \
  -d '{"name":"Ana Souza","phone":"(11) 91234-5678"}'

# webhook assinado (imprime um curl pronto):
WEBHOOK_SECRET=<seu segredo de WEBHOOK_SECRETS> npm run webhook:sign
```

Prefere clicar? Abra o **Swagger** em <http://localhost:3000/docs>.

---

## Documentação da API (Swagger / OpenAPI)

| O quê | Onde |
|---|---|
| **Swagger UI** (interativo, com *Try it out*) | <http://localhost:3000/docs> |
| Contrato OpenAPI 3.0 (importável no Postman / Insomnia / geradores de cliente) | <http://localhost:3000/openapi.json> · arquivo [`docs/openapi.json`](docs/openapi.json) |
| Guia com exemplos, erros e assinatura do webhook | [`docs/API.md`](docs/API.md) |

**Como usar o Swagger:** abra `/docs` → **Authorize** → cole uma chave de `API_KEYS` → *Try it out* em `POST /sellers` e `POST /leads`. A chave fica salva no navegador entre recargas (`persistAuthorization`).

> [!IMPORTANT]
> O webhook exige assinatura HMAC calculada sobre o corpo exato; o *Try it out* **não consegue** calculá-la. Use `npm run webhook:sign`, `Leadflow.exe sign` ou o snippet `openssl` da descrição da operação no próprio Swagger.

**Detalhes de implementação**

* O contrato vive em [`src/docs/openapi.ts`](src/docs/openapi.ts) e é servido por [`src/docs/swagger.ts`](src/docs/swagger.ts) (`swagger-ui-express`). Todas as respostas de erro, o formato único `{ error: { code, message, details, request_id } }`, cabeçalhos de rate limit e os três esquemas de segurança (`X-API-Key`, `X-Leadflow-Timestamp`, `X-Leadflow-Signature`) estão descritos.
* **Sem divergência:** `tests/unit/openapi.test.ts` valida os exemplos com os **schemas Zod reais**, compara campos/obrigatórios/filtros e confere que `docs/openapi.json` está em dia; `tests/unit/docs-route.test.ts` garante que **toda rota registrada no Express está documentada e vice-versa**.
* A página usa uma CSP própria (sem `upgrade-insecure-requests`, que deixa o Swagger em branco em `http://localhost` no Safari); o resto da API segue com o `helmet` padrão.
* Em produção exposta publicamente: `DOCS_ENABLED=false` desliga `/docs` e `/openapi.json`.
* Regenerar o arquivo após mudar o contrato: `npm run docs:openapi`.

---

## Executável de um clique

Para quem só quer ver o sistema funcionando. O executável **carrega o projeto dentro dele**, cuida do Docker e deixa tudo pronto.

```text
 Leadflow.exe ─▶ confere/instala Docker ─▶ gera .env (segredos aleatórios) ─▶ docker compose up
              ─▶ espera GET /health/ready ─▶ menu: demonstração · Swagger · chaves · logs · parar · limpar
```

**O que ele faz, em ordem**

1. **Docker** — confere `docker` + Compose v2. No Windows, se faltar, **instala o Docker Desktop** (via `winget` ou download oficial com **verificação da assinatura digital** antes de executar) e inicia o daemon. No macOS/Linux orienta a instalação.
2. **Configuração** — cria o `.env` com **segredos aleatórios** (CSPRNG; nenhuma senha padrão), recusa/substitui valores de exemplo (`CHANGE_ME`), faz backup antes de alterar e escolhe outra porta se a 3000 estiver ocupada.
3. **Sobe tudo** — MySQL + Redis + migrations + API + worker (`docker compose up -d --build`) e espera `GET /health/ready`.
4. **Menu** — demonstração completa, abrir o Swagger, mostrar chaves e exemplos, logs, status, reiniciar, parar e limpar.

**Segurança do executável:** a API escuta só em `127.0.0.1`; MySQL e Redis não são expostos; segredos nunca saem da máquina; "limpar" exige digitar `APAGAR`.

| Comando | O que faz |
|---|---|
| `Leadflow.exe` | sobe tudo e abre o menu (é o que o duplo clique faz) |
| `Leadflow.exe start [--yes] [--demo]` | sobe tudo; `--yes` aceita as perguntas; `--demo` roda a demonstração ao final |
| `Leadflow.exe docs` | abre o Swagger no navegador |
| `Leadflow.exe keys` | mostra API key, segredo do webhook e exemplos de uso |
| `Leadflow.exe status` · `logs` · `restart` | diagnóstico e controle |
| `Leadflow.exe stop` | para (mantém os dados) — também em `Parar-Leadflow.bat` |
| `Leadflow.exe clean [--yes]` | apaga contêineres, **dados** e imagens — também em `Limpar-Leadflow.bat` |
| `Leadflow.exe where` · `version` · `help` | pasta de trabalho, versão e ajuda |

Passo a passo para o usuário final: [`LEIA-ME.txt`](LEIA-ME.txt).

### Gerar o executável

O lançador é Node.js puro (sem dependências, código em [`launcher/`](launcher)) e vira um binário único com **Node SEA** (*Single Executable Applications*). Quem **usa** o `.exe` não precisa ter Node; quem **gera** precisa de Node ≥ 22.

```bash
npm install
npm run launcher:test            # testes do lançador (node:test, sem Docker)
npm run launcher:build           # release/Leadflow.exe + release/leadflow.cjs
# escolha o alvo (baixa o Node do alvo de nodejs.org e confere o SHA-256):
node scripts/build-launcher.mjs --target win-x64     # ou win-arm64 · linux-x64 · linux-arm64 · darwin-x64 · darwin-arm64
```

> [!TIP]
> Sem compilar nada: `node release/leadflow.cjs` (ou `node launcher/src/main.js` dentro do repositório) roda o mesmo lançador com qualquer Node ≥ 20.
> O workflow [`.github/workflows/ci.yml`](.github/workflows/ci.yml) testa tudo e publica os executáveis de Windows, Linux e macOS como artefatos.

---

## Configuração (variáveis de ambiente)

Validadas na inicialização com Zod (**fail-fast**: a aplicação não sobe com configuração inválida). Modelo completo e comentado em [`.env.example`](.env.example).

| Variável | Padrão | Descrição |
|---|---|---|
| `NODE_ENV` | `development` | Em `production` os segredos de exemplo (`change-me`) são **recusados** |
| `PORT` | `3000` | Porta HTTP da API |
| `DATABASE_URL` | — (obrigatória) | `mysql://usuário:senha@host:3306/banco` |
| `REDIS_URL` | `redis://127.0.0.1:6379` | Fila (Streams) e contadores de rate limit |
| `API_KEYS` | — (obrigatória) | Lista separada por vírgula, mín. 16 caracteres cada; várias = rotação sem downtime |
| `WEBHOOK_SECRETS` | — (obrigatória) | Idem, para a assinatura HMAC do webhook |
| `WEBHOOK_TOLERANCE_SECONDS` | `300` | Janela aceita entre o timestamp assinado e a hora do servidor |
| `RATE_LIMIT_WINDOW_SECONDS` · `RATE_LIMIT_API_MAX` · `RATE_LIMIT_WEBHOOK_MAX` | `60` · `120` · `600` | Rate limit por IP |
| `WORKER_INLINE` | `true` | `true` = worker dentro da API (dev); `false` = processo separado |
| `WEBHOOK_MAX_ATTEMPTS` · `WEBHOOK_BACKOFF_BASE_MS` · `WEBHOOK_BACKOFF_MAX_MS` | `5` · `2000` · `300000` | Retry com backoff exponencial + jitter |
| `DOCS_ENABLED` | `true` | Liga/desliga `/docs` e `/openapi.json` |
| `TRUST_PROXY` | `false` | `true` somente atrás de proxy/LB confiável (rate limit enxerga o IP real) |
| `LEADFLOW_PORT` · `MYSQL_PASSWORD` · `MYSQL_ROOT_PASSWORD` · `REDIS_PASSWORD` | — | Somente para o `docker-compose.yml` (o executável gera todos) |

---

## Testes

```bash
npm run test:unit                 # só unitários (sem infraestrutura): config, telefone, cursor, backoff, HMAC, OpenAPI, rotas
npm run launcher:test             # lançador de um clique (sem Docker)

# integração: precisa de MySQL e Redis locais e do banco de teste
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d mysql redis
TEST_DATABASE_URL=mysql://root:<MYSQL_ROOT_PASSWORD>@127.0.0.1:3306/leadflow_test npm test
```

O banco de teste é criado e migrado automaticamente (`TEST_DATABASE_URL`, padrão `mysql://root:root@127.0.0.1:3306/leadflow_test`; `TEST_REDIS_URL`, padrão `redis://127.0.0.1:6379/15`; com o Redis do compose use `redis://:<REDIS_PASSWORD>@127.0.0.1:6379/15`).

| Suíte | Cobre |
|---|---|
| `tests/unit` | normalização de telefone, cursor (round-trip e adulteração), backoff com jitter, assinatura HMAC (válida, rotação, corpo adulterado, replay, timestamp futuro, cabeçalhos mal formados), **validação de configuração** (fail-fast, recusa de segredos de exemplo em produção), **contrato OpenAPI** (exemplos × Zod, campos, filtros, `$ref`, arquivo em dia) e **Swagger/rotas** (`/docs`, `/openapi.json`, CSP, `DOCS_ENABLED`, toda rota documentada) |
| `tests/integration/leads` | autenticação e formato de erro, rate limit, validação (400/413/422), criação + atribuição + trilha, filtros e paginação sem repetir/perder itens, **30 requisições simultâneas com o mesmo telefone ⇒ 1 lead**, **40 leads simultâneos ⇒ nenhum perdido e distribuição equilibrada**, round-robin estrito, vendedor inativo, lead sem vendedor atribuído depois |
| `tests/integration/webhook` | assinatura/replay/rotação de segredo, envelope inválido sem persistência, 202 → inbox → fila → lead, reentrega (200) e `event_id` reutilizado (409), **20 entregas simultâneas do mesmo evento ⇒ 1 lead**, eventos distintos com o mesmo telefone ⇒ 1 lead + `duplicate`, mensagem duplicada no Redis, **Redis fora** (modo degradado), mensagem perdida no Redis, retry com backoff → `dead`, worker que morreu no meio, evento "veneno", **MySQL fora ⇒ 503** |
| `launcher/test` | geração/validação do `.env` (aleatoriedade, preservação, recusa de `CHANGE_ME`), extração do projeto embutido, escolha de porta, **demonstração inteira** contra uma API simulada (com a assinatura HMAC conferida contra o código TypeScript real) e o fluxo completo do executável com um `docker` simulado |

---

## Arquitetura

```mermaid
flowchart LR
    CRM["CRM / Cliente"] -- "REST + X-API-Key" --> API
    SRC["Fonte externa"] -- "Webhook + HMAC" --> API
    DOC["Swagger UI<br/>/docs"] -. "contrato /openapi.json" .- API
    subgraph Leadflow
        API["API REST<br/>(Express)"]
        W["Worker(s)"]
        R[("Redis 7<br/>Stream + rate limit")]
        M[("MySQL 8<br/>fonte da verdade")]
    end
    API -- "persiste o evento (inbox)" --> M
    API -- "enfileira (best-effort)" --> R
    R -- "consumer group" --> W
    W -- "claim atômico · cria lead · atribui" --> M
```

* **MySQL é a fonte da verdade.** Redis é acelerador (fila e contadores): se ele se perder, nada é perdido.
* Camadas: `http` (middlewares, rotas, DTOs) → `services` (regras) → `repositories` (SQL) → `infra` (pool, transações, Redis, migrations). Composition root único em [`src/container.ts`](src/container.ts) (injeção de dependência manual, sem framework).
* A API e o worker são o mesmo código; `WORKER_INLINE=true` roda o worker no processo da API (dev), `false` + `npm run start:worker` separa e escala de forma independente.

---

## Concorrência e consistência

**Problema:** duas requisições tentam cadastrar o mesmo lead ao mesmo tempo.

1. **A barreira é o banco, não a aplicação.** Não existe "SELECT e depois INSERT" (race clássica). O serviço faz `INSERT` direto e a `UNIQUE KEY uq_leads_phone (phone_e164)` decide: exatamente uma transação vence; as demais recebem `ER_DUP_ENTRY`, traduzido em `409 LEAD_ALREADY_EXISTS` apontando o lead existente. A chave é o telefone em **E.164** — `(11) 91234-5678`, `11912345678` e `+55 11 91234-5678` colidem.
2. **Atomicidade.** Lead + evento `lead.created` + escolha do vendedor + atribuição + evento `lead.assigned` (e, no webhook, a marcação do evento como `processed`) são confirmados na **mesma transação**: tudo ou nada.
3. **Distribuição concorrente sem corrida.** O round-robin escolhe o vendedor ativo com `last_assigned_at` mais antigo (NULL primeiro) usando `FOR UPDATE SKIP LOCKED`: transações simultâneas não esperam umas pelas outras, cada uma pega o próximo vendedor livre — sem lock global e sem "dois leads para o mesmo vendedor na mesma rodada" gerando desequilíbrio. Se todos estiverem travados naquele instante, espera pelo primeiro em vez de concluir "sem vendedor".
4. **Invariantes no banco.** `CHECK` em `leads` (assigned ⇒ vendedor e data; unassigned ⇒ nenhum dos dois), FKs, `UNIQUE` em e-mail de vendedor e em `(source, external_event_id)`. `UPDATE … WHERE status='unassigned'` protege a atribuição contra dupla atribuição.
5. **Desativar vendedor é seguro.** `PATCH` trava a linha do vendedor (`FOR UPDATE`): se há atribuição em andamento ele espera; nenhum lead é atribuído a vendedor já desativado.
6. **READ COMMITTED** por transação. Sob `REPEATABLE READ` os gap/next-key locks da varredura de índice com `FOR UPDATE` geraram **deadlocks medidos** nos testes de carga (40 leads simultâneos). Nenhuma regra depende de snapshot repetível (unicidade vem de `UNIQUE`, decisões usam leituras travadas). Mesmo assim `withTransaction` repete a transação inteira em `ER_LOCK_DEADLOCK`/`ER_LOCK_WAIT_TIMEOUT` (até 6x, backoff exponencial + jitter).
7. **Paginação por cursor (keyset em `seq DESC`)**: custo constante, estável com inserções concorrentes; `OFFSET` degradaria e repetiria itens.

## Segurança

| Ameaça | Controle |
|---|---|
| Acesso indevido à API | `X-API-Key` comparada por hash SHA-256 em **tempo constante** (sem vazar tamanho/prefixo); chaves múltiplas permitem rotação; 401 genérico |
| Webhook forjado | HMAC-SHA256 de `timestamp.corpoBruto` (bytes exatos recebidos) com `timingSafeEqual`; vários segredos aceitos ao mesmo tempo (rotação sem downtime) |
| Replay de webhook | timestamp assinado + tolerância (padrão 300 s, passado **e** futuro) + idempotência por `(source, event_id)` |
| Entrada maliciosa | Zod `.strict()` em tudo (campos extras rejeitados), tamanhos máximos, caracteres de controle proibidos, limites de corpo (50 KB REST / 100 KB webhook), UUID/cursor/filtros validados; SQL 100% parametrizado (`LIKE` com escape) |
| Exposição de informações | resposta de erro padronizada sem stack/SQL/valor recebido; 401 de webhook sempre genérico (motivo real só no log); DTOs públicos **não expõem** o id sequencial interno (`seq`) nem `phone_raw`; `x-powered-by` desabilitado; `helmet` |
| Vazamento em logs | `pino` com `redact` (API key, assinatura, telefone, e-mail); o logger da requisição **não registra query string nem corpo** |
| Abuso / força bruta | rate limit por IP (janela fixa, contadores no Redis, compartilhado entre instâncias) com limites separados para API e webhook; `Retry-After` |
| Configuração insegura | `loadConfig` valida o ambiente com Zod e **falha ao subir** (fail-fast); segredos com mínimo de 16 caracteres; `.env` fora do Git e da imagem; container roda como usuário sem privilégios |
| Correlação | `X-Request-Id` (gerado ou aceito em formato seguro) presente em resposta, log e `lead_events.request_id` |

## Resiliência: indisponibilidade e repetição de eventos

**Princípio do webhook: "persistir primeiro, processar depois".** A API valida, grava o evento no inbox (`webhook_events`) e só então responde `202`. O enfileiramento no Redis é best-effort; o processamento é assíncrono e **at-least-once**, com efeito **exatamente-uma-vez** no lead (ver abaixo).

| Cenário | Comportamento |
|---|---|
| **Evento repetido** (emissor reenvia) | `UNIQUE (source, event_id)`: mesmo hash ⇒ `200 duplicate` (emissor para de retentar); mesmo `event_id` com conteúdo diferente ⇒ `409`. Hash é do envelope validado, não do corpo bruto: espaços/ordem de chaves diferentes continuam idempotentes |
| **Mesma mensagem entregue 2× pelo Redis** (at-least-once) | O worker faz `claim` atômico (`UPDATE … WHERE status='pending'`/lock expirado); só um consegue. O outro vira no-op |
| **Dois eventos diferentes, mesmo telefone** | O primeiro cria o lead; o outro termina como `duplicate` (resultado final, sem retry) |
| **Efeito exatamente-uma-vez** | Lead criado e `webhook_events.status='processed'` na mesma transação: não existe estado "lead criado mas evento ainda pendente" |
| **Redis indisponível** | Recepção continua (`202`): o evento já está no MySQL. Rate limit falha aberto (autenticação continua valendo). O worker detecta pela varredura e **processa direto do MySQL** (modo degradado). `/health/ready` reporta `degraded` |
| **Mensagem perdida no Redis** (flush, failover sem AOF) | Varredura `findDue` re-enfileira eventos `pending` vencidos e não enfileirados |
| **Worker morreu no meio** | Sem ACK a mensagem fica na PEL do consumer group e é reassumida por `XAUTOCLAIM`; evento `processing` com `locked_until` vencido é retomado |
| **Falha transitória no processamento** | `scheduleRetry` com backoff exponencial + jitter (`WEBHOOK_BACKOFF_*`) |
| **Erro permanente / evento "veneno"** | Erro de validação ⇒ `dead` imediato; tentativas > `WEBHOOK_MAX_ATTEMPTS` (contadas no claim, então mesmo um evento que derruba o processo a cada vez) ⇒ `dead`. Nunca cria lead pela metade |
| **MySQL indisponível** | API responde `503` + `Retry-After` (o emissor deve reenviar; webhook ainda não foi aceito, então a garantia é do emissor). Worker aguarda e retoma. `/health/ready` ⇒ 503 |
| **Deploy / SIGTERM** | Para de aceitar conexões, drena requisições em andamento, finaliza o worker e fecha pool/Redis (timeout de 15 s) |
| **Sem vendedor ativo** | Lead é criado `unassigned` e atribuído quando um vendedor é ativado/cadastrado, ou pela varredura periódica do worker |
| **Dois workers / dois nós** | Consumer group distribui as mensagens; claim atômico garante que o mesmo evento não é processado em paralelo |

**Reprocessar eventos `dead` (operação manual):** corrigir a causa e executar
`UPDATE webhook_events SET status='pending', attempts=0, next_attempt_at=NOW(6), enqueued_at=NULL WHERE id=?` — a varredura do worker o recoloca na fila.

**Por que Redis Streams e não BullMQ?** Foi uma restrição do desafio (Redis sim, BullMQ não). Streams com consumer group oferecem o que importa aqui: entrega a um único consumidor, PEL (mensagens pendentes), `XAUTOCLAIM` (recuperação) e persistência AOF. O que o BullMQ daria pronto (retry/backoff/dead-letter) é implementado explicitamente — e de forma mais forte — no MySQL, que é quem guarda o estado.

## Modelo de dados

4 tabelas (migrations `migrations/001`–`004`, SQL puro, aplicadas por `npm run migrate` com `GET_LOCK` — várias instâncias subindo juntas não colidem — e checksum SHA-256: migration já aplicada não pode ser editada).

* `sellers` — `uq_sellers_email`, `idx_sellers_rr (active, last_assigned_at, id)` (cobre a consulta do round-robin).
* `leads` — `uq_leads_phone` (deduplicação), `seq` interno para cursor, `CHECK` de atribuição, índices `(status|seller_id|channel|origin, seq)` para filtro + paginação.
* `webhook_events` — inbox/idempotência (`uq_webhook_source_event`), máquina de estados (`pending → processing → processed | duplicate | dead`), índices de varredura.
* `lead_events` — auditoria append-only (`lead.created`, `lead.assigned`, `lead.duplicate_attempt`).

Datas em UTC (`DATETIME(6)`, `time_zone='+00:00'` por conexão), independentemente do fuso do servidor. Diagrama ER: [`08-modelo-de-dados-er.svg`](docs/diagrams/rendered/08-modelo-de-dados-er.svg).

## Endpoints

Contrato interativo em **[`/docs`](http://localhost:3000/docs)**; guia com exemplos, erros e assinatura do webhook em **[`docs/API.md`](docs/API.md)**.

| Método | Rota | Descrição |
|---|---|---|
| `POST` | `/api/v1/leads` | Criar lead (`201` / `409` / `422`) |
| `GET` | `/api/v1/leads` | Listar, filtrar e paginar por cursor |
| `GET` | `/api/v1/leads/:id` | Consultar lead |
| `GET` | `/api/v1/leads/:id/events` | Trilha de rastreabilidade do lead |
| `POST` | `/api/v1/sellers` | Cadastrar vendedor |
| `GET` | `/api/v1/sellers`, `/api/v1/sellers/:id` | Listar / consultar |
| `PATCH` | `/api/v1/sellers/:id` | Alterar status ativo/inativo |
| `POST` | `/api/v1/webhooks/leads` | Receber webhook assinado (`202` / `200` / `401` / `409` / `422`) |
| `GET` | `/health/live`, `/health/ready` | Liveness / readiness (`ok`, `degraded`, `unavailable`) |
| `GET` | `/docs` · `/openapi.json` | Swagger UI · contrato OpenAPI |

## Admin Seguro (Auth)

Objetivo: painel/admin API com autenticação forte e moderna.

- Provedores OAuth 2.0 / OIDC: Google, Microsoft e GitHub (ativados quando as credenciais forem definidas em `.env`).
- Login principal: senha forte (Argon2id) + MFA TOTP obrigatório; lockout e rate limit herdam o middleware (rota dedicada a ser incluída em versão futura).
- Tokens: JWT RS256 (access 10 min) e refresh rotativo (30 dias) emitidos em cookies HttpOnly/Secure/SameSite=Lax sob `/admin` + token CSRF (double-submit).
- JWKS: `GET /admin/.well-known/jwks.json` publica a chave pública atual (kid) para verificação.
  - Observação: Cookies `Secure` exigem HTTPS. Em dev sem TLS o navegador não gravará cookies.

Variáveis de ambiente (exemplo em `.env.example`):

- `ADMIN_JWT_PRIVATE_JWK`: JWK privado RSA (JSON) com `kid` (ex.: `leadflow-admin-1`).
- `ADMIN_JWT_AUDIENCE`: audiência dos JWTs (`leadflow-admin`).
- `ADMIN_ACCESS_TTL_SECONDS`: TTL do access token (padrão 600s).
- `ADMIN_REFRESH_TTL_DAYS`: TTL lógico do refresh (no DB; padrão 30 dias).
- `ADMIN_MFA_REQUIRED`: `true` para exigir TOTP em todo login.
- `ADMIN_AT_REST_KEY`: chave hex (>=32 bytes) para criptografar o segredo TOTP em repouso (AES-256-GCM).
- OAuth (opcionais): `ADMIN_OAUTH_{GOOGLE|MICROSOFT|GITHUB}_{CLIENT_ID|CLIENT_SECRET}`, `ADMIN_OAUTH_*_ISSUER`.

Endpoints iniciais (/admin):

- `POST /admin/auth/login` → cookies `admin_access`, `admin_refresh`, `admin_csrf` e `{ roles, csrf_token }` no corpo.
- `POST /admin/auth/logout` → limpa cookies.
- `GET /admin/.well-known/jwks.json` → JWKS público.
- `GET /admin/me` → placeholder (proteção por JWT será adicionada logo abaixo).

Princípios de segurança adotados:

- Argon2id para senhas e hash do refresh token (DB só vê hash; access token não é persistido).
- MFA TOTP obrigatório por padrão; segredo TOTP armazenado cifrado (AES-256-GCM) com chave da aplicação.
- JWT RS256 com rotação via `kid` e JWKS; audience verificada; sem `alg: none`.
- Cookies HttpOnly + SameSite=Lax + Secure; CSRF token via cookie não-HttpOnly (double submit) exigido em rotas de mutação (a ser conectado nas rotas protegidas).
- Auditoria (`admin_audit_log`) para sucesso/falhas de autenticação e operações sensíveis.

## Diagramas (C4 + classes)

Fontes **editáveis** em Mermaid (`docs/diagrams/source/*.mmd`); versões legíveis em SVG e PNG (`docs/diagrams/rendered/`). Para regenerar: `npm run diagrams` (usa `@mermaid-js/mermaid-cli`; defina `PUPPETEER_CFG` para apontar um Chromium local). O GitHub/GitLab também renderizam os `.mmd` diretamente.

| # | Diagrama | Nível | Arquivo |
|---|---|---|---|
| 01 | Contexto: atores e sistemas externos | **C1** | `01-c1-contexto` |
| 02 | Containers: API, Worker, Migrator, MySQL, Redis | **C2** | `02-c2-containers` |
| 03 | Componentes da API REST (HTTP, serviços, domínio, persistência) | **C3** | `03-c3-componentes-api` |
| 04 | Componentes do webhook e do Worker | **C3** | `04-c3-componentes-webhook-worker` |
| 05 | Ciclo de vida de `webhook_events` (máquina de estados) | **C4 (código)** | `05-c4-codigo-maquina-estados-webhook` |
| 06 | Classes de domínio: leads, vendedores, atribuição, deduplicação, rastreabilidade | **Diagrama de classes 1/2** | `06-classes-dominio` |
| 07 | Classes de aplicação: serviços, repositórios, fila, segurança, erros | **Diagrama de classes 2/2** | `07-classes-aplicacao` |
| 08 | Modelo de dados MySQL (ER) | apoio | `08-modelo-de-dados-er` |
| 09 | Sequência: `POST /leads` (concorrência + distribuição) | apoio | `09-sequencia-criar-lead` |
| 10 | Sequência: webhook → inbox → fila → worker, com recuperação | apoio | `10-sequencia-webhook` |

Os diagramas mostram **somente o que foi implementado**: API REST, recebimento de webhook, MySQL e Redis (Streams). Não há BullMQ, e o Docker aparece apenas como empacotamento (Dockerfile / Compose).

## Estrutura do repositório

```text
leadflow/
├── src/
│   ├── http/            middlewares, rotas, DTOs
│   │   └── admin.ts     rotas do admin (login, logout, jwks, me placeholder)
│   ├── services/        regras de negócio, worker de webhook
│   │   └── admin-auth.service.ts   autenticação de admin (senha+MFA, emissão de tokens)
│   ├── repositories/    SQL parametrizado
│   │   └── admin.ts     repositórios do admin (users, sessions, audit)
│   ├── infra/           pool MySQL, Redis, migrations, logger
│   ├── queue/           Redis Streams (consumer group, XAUTOCLAIM)
│   ├── security/        assinatura HMAC
│   │   ├── jwt.ts                 emissão/verificação de JWT (RS256 + JWKS)
│   │   └── crypto-at-rest.ts      AES-256-GCM para segredos em repouso (TOTP)
│   ├── docs/            contrato OpenAPI + Swagger UI
│   └── config.ts · container.ts · app.ts · server.ts · worker.ts
├── migrations/          SQL puro (001–005)
├── backup/              XtraBackup (full/inc/prepare/verify) + crontab (scheduler)
├── nginx/               nginx.conf + vhost (TLS, rate limit, health)
├── launcher/            executável de um clique (src/ + test/)
├── scripts/             sign-webhook, export-openapi, build-launcher, render-diagrams
├── docs/                API.md, openapi.json, diagrams/ (Mermaid + SVG/PNG)
├── tests/               unit/ e integration/
├── .github/workflows/   CI/CD (testes, build, push GHCR, deploy staging/prod, release, CodeQL)
├── .github/SECURITY.md  política de segurança
├── .github/CODEOWNERS   revisores padrão
├── .github/dependabot.yml  updates npm/docker
├── Dockerfile · docker-compose.yml · docker-compose.dev.yml
└── LEIA-ME.txt          guia do usuário final do executável
```

## Limitações conhecidas e próximos passos

* **Reatribuição:** desativar um vendedor não redistribui os leads que ele já recebeu (decisão de produto; seria um novo fluxo com evento próprio).
* **Cursor e commits fora de ordem:** `seq` é atribuído no `INSERT`, não no `COMMIT`; uma transação longa pode confirmar um lead com `seq` menor depois que um cliente já passou dele. Aceitável para esta listagem; mitigação possível: ordenar por `created_at` com margem ou usar leitura com `seq <= MAX(seq confirmado)`.
* **Rate limit** de janela fixa (permite rajada na virada da janela); para precisão, trocar por janela deslizante / token bucket (script Lua).
* **Segredos de webhook** são globais, não por `source`; API keys têm o mesmo privilégio (sem escopos/RBAC).
* **Reprocessamento de `dead`** é manual via SQL; um endpoint administrativo e métricas (Prometheus: profundidade da fila, tentativas, `dead`) seriam o próximo passo. O contrato OpenAPI é mantido à mão (e protegido contra divergência por testes), não gerado a partir dos schemas Zod.
* **Redis único:** com Sentinel/Cluster o código não muda; o inbox no MySQL mantém a garantia mesmo em failover com perda de dados.
* Sem `package-lock.json` no ZIP: rode `npm install` para gerar e versionar o lockfile (a imagem Docker e o executável usam `npm ci` quando ele existe).
* **Executável de um clique** é para avaliação/demonstração local (API só em `127.0.0.1`, segredos gerados na máquina). Não é um instalador de produção: em produção use o Compose/orquestrador com um secret manager.
* **Admin (em progresso):**
  * Falta proteger rotas com verificação completa de JWT + CSRF para mutações e implementar `/admin/auth/refresh` com rotação de refresh e detecção de reuse.
  * Lockout/limitação específica de `/admin/auth/*` usando Redis dedicada (hoje se beneficia do rate limit base).
  * Fluxos de OAuth2/OIDC (Google/Microsoft/GitHub) serão habilitados ao definir credenciais; callbacks e vinculação de conta serão adicionados.
  * UI Admin (SPA) não inclusa; endpoints prontos para integração segura.
