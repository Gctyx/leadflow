/**
 * Contrato OpenAPI 3.0.3 da API (fonte da documentação interativa em /docs e do arquivo docs/openapi.json).
 *
 * Mantido à mão para ser legível e fiel ao comportamento real. Os testes (tests/unit/openapi.test.ts) impedem divergência:
 * exemplos validados com os schemas Zod reais, mesmos campos/filtros, todas as rotas do Express documentadas
 * e docs/openapi.json sempre igual a este arquivo (`npm run docs:openapi` regenera).
 */
type Json = Record<string, any>;

export const API_VERSION = '1.0.0';

const ref = (name: string): Json => ({ $ref: `#/components/schemas/${name}` });
const resp = (name: string): Json => ({ $ref: `#/components/responses/${name}` });
const jsonBody = (schema: Json, example?: unknown): Json => ({
  'application/json': { schema, ...(example === undefined ? {} : { example }) },
});

// ---------------------------------------------------------------------------------------------------------------------
// Exemplos reutilizados (também validados nos testes)
// ---------------------------------------------------------------------------------------------------------------------
export const examples = {
  createLead: { name: 'Ana Souza', phone: '(11) 91234-5678', email: 'ana@example.com', origin: 'landing_page', notes: 'Pediu contato à tarde' },
  createSeller: { name: 'Carlos Lima', email: 'carlos@example.com', active: true },
  updateSeller: { active: false },
  webhook: {
    event_id: 'evt_20261124_0001',
    source: 'landing_page',
    data: { name: 'Ana Souza', phone: '(11) 91234-5678', email: 'ana@example.com' },
  },
  lead: {
    id: '0b7f6a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b',
    name: 'Ana Souza',
    email: 'ana@example.com',
    phone: '+5511912345678',
    channel: 'api',
    origin: 'landing_page',
    notes: null,
    status: 'assigned',
    seller_id: '9d1c2b3a-4f5e-4a6b-9c7d-8e9f0a1b2c3d',
    assigned_at: '2026-11-24T21:00:00.000Z',
    created_at: '2026-11-24T21:00:00.000Z',
    updated_at: '2026-11-24T21:00:00.000Z',
  },
  seller: {
    id: '9d1c2b3a-4f5e-4a6b-9c7d-8e9f0a1b2c3d',
    name: 'Carlos Lima',
    email: 'carlos@example.com',
    active: true,
    last_assigned_at: '2026-11-24T21:00:00.000Z',
    created_at: '2026-11-24T20:00:00.000Z',
    updated_at: '2026-11-24T21:00:00.000Z',
  },
};

const errorExample = (code: string, message: string, details?: unknown): Json => ({
  error: { code, message, ...(details ? { details } : {}), request_id: '0c0e5c0e-6f0e-4c3a-9d2b-1a2b3c4d5e6f' },
});

// ---------------------------------------------------------------------------------------------------------------------
// Campos reutilizáveis
// ---------------------------------------------------------------------------------------------------------------------
const uuid = (description: string): Json => ({ type: 'string', format: 'uuid', description });
const dateTime = (description: string): Json => ({ type: 'string', format: 'date-time', description });
const slug: Json = { type: 'string', minLength: 2, maxLength: 60, pattern: '^[\\w.:\\- ]+$', description: 'Letras, números e `. : _ -`.' };

const idParam: Json = { name: 'id', in: 'path', required: true, description: 'Identificador (UUID).', schema: { type: 'string', format: 'uuid' } };
const q = (name: string, schema: Json, description: string): Json => ({ name, in: 'query', required: false, description, schema });

const pageSize = (def: number): Json => ({ type: 'integer', minimum: 1, maximum: 100, default: def });

const rateLimitHeaders: Json = {
  'RateLimit-Limit': { description: 'Limite de requisições por janela.', schema: { type: 'integer' } },
  'RateLimit-Remaining': { description: 'Requisições restantes na janela atual.', schema: { type: 'integer' } },
  'X-Request-Id': { description: 'Id de correlação (use-o ao reportar problemas; aparece também nos logs).', schema: { type: 'string' } },
};

const standardErrors = (...names: string[]): Json => {
  const map: Record<string, number> = { InvalidBody: 400, Unauthorized: 401, NotFound: 404, PayloadTooLarge: 413, ValidationError: 422, RateLimited: 429, InternalError: 500, ServiceUnavailable: 503 };
  return Object.fromEntries(names.map((n) => [String(map[n]), resp(n)]));
};

// ---------------------------------------------------------------------------------------------------------------------
// Documento
// ---------------------------------------------------------------------------------------------------------------------
export function buildOpenApiSpec(): Json {
  return {
    openapi: '3.0.3',
    info: {
      title: 'Leadflow Engine API',
      version: API_VERSION,
      description: [
        'API REST para **receber, deduplicar, distribuir e rastrear leads comerciais** (desafio Backend Sênior — LexVita).',
        '',
        '## Como testar nesta página',
        '1. Clique em **Authorize** e informe a sua `X-API-Key` (no executável: opção *Mostrar chaves*; no Docker: variável `API_KEYS`).',
        '2. Cadastre um vendedor em `POST /sellers` e depois um lead em `POST /leads` — o lead é distribuído (round-robin) para um vendedor ativo.',
        '3. Consulte a trilha de auditoria em `GET /leads/{id}/events`.',
        '',
        '## Autenticação',
        '| Superfície | Mecanismo |',
        '|---|---|',
        '| `/leads`, `/sellers` | Cabeçalho `X-API-Key` (mais de uma chave válida permite rotação sem downtime) |',
        '| `/webhooks/leads` | Assinatura HMAC-SHA256 (sem API key) — veja a operação para o algoritmo |',
        '| `/health/*` | Públicos |',
        '',
        '## Convenções',
        '* JSON em UTF-8; datas em ISO-8601 UTC; telefones normalizados para **E.164** (região padrão `BR`).',
        '* Todas as respostas trazem `X-Request-Id` (aceita o seu, no formato `[\\w-]{8,64}`) e `RateLimit-Limit` / `RateLimit-Remaining`.',
        '* Campos desconhecidos no corpo são **rejeitados** (`422`). Erros nunca incluem stack trace, SQL nem o valor enviado.',
        '* Paginação por **cursor** (keyset): use `page.next_cursor` como `cursor` na próxima chamada; `null` indica o fim.',
        '',
        'Documentação completa: `docs/API.md` e `README.md` do repositório.',
      ].join('\n'),
      license: { name: 'ISC' },
    },
    servers: [{ url: '/api/v1', description: 'Mesma origem desta página' }],
    tags: [
      { name: 'Leads', description: 'Cadastro, consulta, filtros, paginação e trilha de rastreabilidade.' },
      { name: 'Sellers', description: 'Vendedores (ativo/inativo) que participam da distribuição.' },
      { name: 'Webhooks', description: 'Entrada assíncrona e idempotente de leads de fontes externas.' },
      { name: 'Health', description: 'Liveness e readiness (fora de `/api/v1`).' },
    ],
    security: [{ ApiKeyAuth: [] }],
    paths: {
      '/leads': {
        post: {
          tags: ['Leads'],
          operationId: 'createLead',
          summary: 'Criar lead',
          description:
            'Normaliza o telefone para E.164 e distribui o lead para o vendedor ativo menos recentemente atendido (round-robin).\n\n' +
            '* Sem vendedor ativo: o lead nasce `unassigned` (`seller_id: null`) e é atribuído quando houver um vendedor.\n' +
            '* Telefone repetido, em **qualquer formato** (`11912345678`, `+55 11 91234-5678`…), retorna `409 LEAD_ALREADY_EXISTS`.',
          requestBody: { required: true, content: jsonBody(ref('CreateLeadRequest'), examples.createLead) },
          responses: {
            '201': {
              description: 'Lead criado (e atribuído, se havia vendedor ativo).',
              headers: { Location: { description: 'URL do lead criado.', schema: { type: 'string', example: '/api/v1/leads/0b7f6a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b' } }, ...rateLimitHeaders },
              content: jsonBody(ref('Lead'), examples.lead),
            },
            '409': {
              description: 'Já existe um lead com este telefone (normalizado). `details.lead_id` aponta o existente.',
              content: jsonBody(ref('ErrorResponse'), errorExample('LEAD_ALREADY_EXISTS', 'Já existe um lead com este telefone', { lead_id: examples.lead.id })),
            },
            ...standardErrors('InvalidBody', 'Unauthorized', 'PayloadTooLarge', 'ValidationError', 'RateLimited', 'InternalError', 'ServiceUnavailable'),
          },
        },
        get: {
          tags: ['Leads'],
          operationId: 'listLeads',
          summary: 'Listar, filtrar e paginar leads',
          description: 'Filtros combináveis (todos opcionais). Ordem: mais recentes primeiro. Paginação **keyset** — custo constante e sem repetir/perder itens com inserções concorrentes.',
          parameters: [
            q('status', { type: 'string', enum: ['unassigned', 'assigned'] }, 'Situação da atribuição.'),
            q('seller_id', { type: 'string', format: 'uuid' }, 'Somente leads deste vendedor.'),
            q('channel', { type: 'string', enum: ['api', 'webhook'] }, 'Canal de entrada.'),
            q('origin', slug, 'Origem informada no cadastro.'),
            q('phone', { type: 'string', minLength: 8, maxLength: 32 }, 'Telefone (normalizado antes de comparar; qualquer formato).'),
            q('email', { type: 'string', format: 'email', maxLength: 254 }, 'E-mail exato (minúsculo).'),
            q('name', { type: 'string', minLength: 1, maxLength: 120 }, 'Prefixo do nome.'),
            q('created_from', { type: 'string', format: 'date-time' }, 'Criados a partir de (ISO-8601, com fuso).'),
            q('created_to', { type: 'string', format: 'date-time' }, 'Criados até (ISO-8601, com fuso).'),
            q('limit', pageSize(20), 'Itens por página (1–100).'),
            q('cursor', { type: 'string', maxLength: 40, pattern: '^[A-Za-z0-9_-]+$' }, 'Cursor opaco retornado em `page.next_cursor`.'),
          ],
          responses: {
            '200': {
              description: 'Página de leads.',
              headers: rateLimitHeaders,
              content: jsonBody(ref('LeadPage'), { data: [examples.lead], page: { limit: 20, next_cursor: 'MTQ5' } }),
            },
            ...standardErrors('Unauthorized', 'ValidationError', 'RateLimited', 'InternalError', 'ServiceUnavailable'),
          },
        },
      },
      '/leads/{id}': {
        get: {
          tags: ['Leads'],
          operationId: 'getLead',
          summary: 'Consultar lead',
          parameters: [idParam],
          responses: {
            '200': { description: 'O lead.', headers: rateLimitHeaders, content: jsonBody(ref('Lead'), examples.lead) },
            ...standardErrors('Unauthorized', 'NotFound', 'ValidationError', 'RateLimited', 'InternalError', 'ServiceUnavailable'),
          },
        },
      },
      '/leads/{id}/events': {
        get: {
          tags: ['Leads'],
          operationId: 'listLeadEvents',
          summary: 'Trilha de rastreabilidade do lead',
          description:
            'Registro **append-only** do que aconteceu com o lead: `lead.created`, `lead.assigned` e `lead.duplicate_attempt` (cada nova tentativa de cadastrar o mesmo telefone). ' +
            'Canais: `api`, `webhook` e `system` (atribuição posterior feita pelo sistema).',
          parameters: [idParam],
          responses: {
            '200': {
              description: 'Eventos em ordem cronológica.',
              headers: rateLimitHeaders,
              content: jsonBody(ref('LeadEventList'), {
                data: [
                  { type: 'lead.created', channel: 'api', seller_id: null, webhook_event_id: null, request_id: '0c0e5c0e-6f0e-4c3a-9d2b-1a2b3c4d5e6f', metadata: null, created_at: '2026-11-24T21:00:00.000Z' },
                  { type: 'lead.assigned', channel: 'api', seller_id: examples.seller.id, webhook_event_id: null, request_id: '0c0e5c0e-6f0e-4c3a-9d2b-1a2b3c4d5e6f', metadata: { strategy: 'round_robin' }, created_at: '2026-11-24T21:00:00.000Z' },
                ],
              }),
            },
            ...standardErrors('Unauthorized', 'NotFound', 'ValidationError', 'RateLimited', 'InternalError', 'ServiceUnavailable'),
          },
        },
      },
      '/sellers': {
        post: {
          tags: ['Sellers'],
          operationId: 'createSeller',
          summary: 'Cadastrar vendedor',
          description: 'Se nascer ativo, os leads represados (`unassigned`) são distribuídos.',
          requestBody: { required: true, content: jsonBody(ref('CreateSellerRequest'), examples.createSeller) },
          responses: {
            '201': {
              description: 'Vendedor criado.',
              headers: { Location: { description: 'URL do vendedor criado.', schema: { type: 'string' } }, ...rateLimitHeaders },
              content: jsonBody(ref('Seller'), examples.seller),
            },
            '409': {
              description: 'Já existe um vendedor com este e-mail.',
              content: jsonBody(ref('ErrorResponse'), errorExample('SELLER_ALREADY_EXISTS', 'Já existe um vendedor com este e-mail')),
            },
            ...standardErrors('InvalidBody', 'Unauthorized', 'PayloadTooLarge', 'ValidationError', 'RateLimited', 'InternalError', 'ServiceUnavailable'),
          },
        },
        get: {
          tags: ['Sellers'],
          operationId: 'listSellers',
          summary: 'Listar vendedores',
          parameters: [q('active', { type: 'boolean' }, 'Filtra por ativo (`true`) ou inativo (`false`).'), q('limit', pageSize(50), 'Máximo de itens (1–100).')],
          responses: {
            '200': { description: 'Vendedores.', headers: rateLimitHeaders, content: jsonBody(ref('SellerList'), { data: [examples.seller] }) },
            ...standardErrors('Unauthorized', 'ValidationError', 'RateLimited', 'InternalError', 'ServiceUnavailable'),
          },
        },
      },
      '/sellers/{id}': {
        get: {
          tags: ['Sellers'],
          operationId: 'getSeller',
          summary: 'Consultar vendedor',
          parameters: [idParam],
          responses: {
            '200': { description: 'O vendedor.', headers: rateLimitHeaders, content: jsonBody(ref('Seller'), examples.seller) },
            ...standardErrors('Unauthorized', 'NotFound', 'ValidationError', 'RateLimited', 'InternalError', 'ServiceUnavailable'),
          },
        },
        patch: {
          tags: ['Sellers'],
          operationId: 'updateSeller',
          summary: 'Ativar / desativar vendedor',
          description:
            'Desativar tira o vendedor da rotação **imediatamente** (a linha é travada: nenhuma atribuição em andamento chega a um vendedor já desativado). ' +
            'Leads já atribuídos permanecem com ele. Reativar devolve o vendedor à rotação e drena leads represados.',
          parameters: [idParam],
          requestBody: { required: true, content: jsonBody(ref('UpdateSellerRequest'), examples.updateSeller) },
          responses: {
            '200': { description: 'Vendedor atualizado.', headers: rateLimitHeaders, content: jsonBody(ref('Seller'), { ...examples.seller, active: false }) },
            ...standardErrors('InvalidBody', 'Unauthorized', 'NotFound', 'PayloadTooLarge', 'ValidationError', 'RateLimited', 'InternalError', 'ServiceUnavailable'),
          },
        },
      },
      '/webhooks/leads': {
        post: {
          tags: ['Webhooks'],
          operationId: 'receiveLeadWebhook',
          summary: 'Receber lead por webhook assinado',
          description: [
            '**Persistir primeiro, processar depois:** o evento é validado e gravado de forma durável (`202`); o lead será criado de forma assíncrona pelo worker, com efeito exatamente-uma-vez.',
            '',
            '**Idempotência:** `(source, event_id)` é a chave. Reentrega idêntica → `200 duplicate` (o emissor deve parar de retentar); mesmo `event_id` com conteúdo diferente → `409 EVENT_ID_REUSED`.',
            '',
            '### Assinatura (HMAC-SHA256)',
            '| Cabeçalho | Valor |',
            '|---|---|',
            '| `X-Leadflow-Timestamp` | epoch em **segundos** (10 dígitos); aceito dentro de ±`WEBHOOK_TOLERANCE_SECONDS` (padrão 300 s) |',
            '| `X-Leadflow-Signature` | `v1=` + hex( HMAC-SHA256( segredo, `"{timestamp}." + corpoBrutoExato` ) ) |',
            '',
            'A assinatura cobre os **bytes exatos** enviados: não reformate o JSON depois de assinar.',
            '',
            '```bash',
            'TS=$(date +%s)',
            'BODY=\'{"event_id":"evt_20261124_0001","source":"landing_page","data":{"name":"Ana Souza","phone":"11912345678"}}\'',
            'SIG=$(printf \'%s.%s\' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | sed \'s/^.* //\')',
            'curl -i -X POST http://localhost:3000/api/v1/webhooks/leads -H "Content-Type: application/json" \\',
            '  -H "X-Leadflow-Timestamp: $TS" -H "X-Leadflow-Signature: v1=$SIG" --data-raw "$BODY"',
            '```',
            '',
            'Atalhos: `npm run webhook:sign` ou `Leadflow.exe sign`. O botão *Try it out* **não consegue** calcular o HMAC — use um dos comandos acima.',
          ].join('\n'),
          security: [{ WebhookSignature: [], WebhookTimestamp: [] }],
          requestBody: { required: true, content: jsonBody(ref('WebhookEnvelope'), examples.webhook) },
          responses: {
            '202': {
              description: 'Evento aceito e gravado de forma durável; o lead será criado de forma assíncrona.',
              headers: rateLimitHeaders,
              content: jsonBody(ref('WebhookAccepted'), { status: 'accepted', event_id: examples.webhook.event_id }),
            },
            '200': {
              description: 'Reentrega do mesmo evento (idempotência). Nada foi duplicado; o emissor deve parar de retentar.',
              content: jsonBody(ref('WebhookDuplicate'), { status: 'duplicate', event_id: examples.webhook.event_id, processing_status: 'processed' }),
            },
            '409': {
              description: 'Mesmo `event_id` já usado com conteúdo diferente.',
              content: jsonBody(ref('ErrorResponse'), errorExample('EVENT_ID_REUSED', 'event_id já utilizado com outro conteúdo')),
            },
            ...standardErrors('InvalidBody', 'Unauthorized', 'PayloadTooLarge', 'ValidationError', 'RateLimited', 'InternalError', 'ServiceUnavailable'),
          },
        },
      },
      '/health/live': {
        get: {
          tags: ['Health'],
          operationId: 'healthLive',
          summary: 'Liveness',
          description: 'O processo está no ar.',
          servers: [{ url: '/' }],
          security: [],
          responses: { '200': { description: 'Processo no ar.', content: jsonBody(ref('Health'), { status: 'ok' }) } },
        },
      },
      '/health/ready': {
        get: {
          tags: ['Health'],
          operationId: 'healthReady',
          summary: 'Readiness',
          description: '`ok`; `degraded` (Redis fora: a API continua atendendo e os webhooks ficam no MySQL); `unavailable` (MySQL fora → 503).',
          servers: [{ url: '/' }],
          security: [],
          responses: {
            '200': { description: 'Pronta (`ok`) ou degradada (`degraded`).', content: jsonBody(ref('Health'), { status: 'ok' }) },
            '503': { description: 'MySQL indisponível.', content: jsonBody(ref('Health'), { status: 'unavailable' }) },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        ApiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-API-Key', description: 'Chave da API (valores de `API_KEYS`).' },
        WebhookTimestamp: { type: 'apiKey', in: 'header', name: 'X-Leadflow-Timestamp', description: 'Epoch em segundos usado na assinatura.' },
        WebhookSignature: { type: 'apiKey', in: 'header', name: 'X-Leadflow-Signature', description: '`v1=` + HMAC-SHA256 em hexadecimal.' },
      },
      schemas: {
        CreateLeadRequest: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'phone'],
          properties: {
            name: { type: 'string', minLength: 2, maxLength: 120, description: 'Sem caracteres de controle.', example: 'Ana Souza' },
            phone: { type: 'string', minLength: 8, maxLength: 32, description: 'Qualquer formato; normalizado para E.164 (região padrão `BR`). Inválido → 422.', example: '(11) 91234-5678' },
            email: { type: 'string', format: 'email', maxLength: 254, description: 'Convertido para minúsculas.', example: 'ana@example.com' },
            origin: { ...slug, example: 'landing_page' },
            notes: { type: 'string', maxLength: 1000 },
          },
        },
        Lead: {
          type: 'object',
          required: ['id', 'name', 'email', 'phone', 'channel', 'origin', 'notes', 'status', 'seller_id', 'assigned_at', 'created_at', 'updated_at'],
          properties: {
            id: uuid('Identificador público do lead.'),
            name: { type: 'string' },
            email: { type: 'string', format: 'email', nullable: true },
            phone: { type: 'string', description: 'E.164.', example: '+5511912345678' },
            channel: { type: 'string', enum: ['api', 'webhook'] },
            origin: { type: 'string', nullable: true },
            notes: { type: 'string', nullable: true },
            status: { type: 'string', enum: ['unassigned', 'assigned'] },
            seller_id: { ...uuid('Vendedor responsável.'), nullable: true },
            assigned_at: { ...dateTime('Momento da atribuição.'), nullable: true },
            created_at: dateTime('Criação.'),
            updated_at: dateTime('Última alteração.'),
          },
        },
        LeadPage: {
          type: 'object',
          required: ['data', 'page'],
          properties: {
            data: { type: 'array', items: ref('Lead') },
            page: {
              type: 'object',
              required: ['limit', 'next_cursor'],
              properties: {
                limit: { type: 'integer' },
                next_cursor: { type: 'string', nullable: true, description: 'Cursor opaco da próxima página; `null` quando acabou.' },
              },
            },
          },
        },
        LeadEvent: {
          type: 'object',
          required: ['type', 'channel', 'seller_id', 'webhook_event_id', 'request_id', 'metadata', 'created_at'],
          properties: {
            type: { type: 'string', enum: ['lead.created', 'lead.assigned', 'lead.duplicate_attempt'] },
            channel: { type: 'string', enum: ['api', 'webhook', 'system'] },
            seller_id: { ...uuid('Vendedor envolvido (atribuição).'), nullable: true },
            webhook_event_id: { type: 'string', nullable: true, description: 'Evento de webhook de origem, se houver.' },
            request_id: { type: 'string', nullable: true, description: 'Correlaciona com `X-Request-Id` e com os logs.' },
            metadata: { type: 'object', nullable: true, additionalProperties: true },
            created_at: dateTime('Quando ocorreu.'),
          },
        },
        LeadEventList: { type: 'object', required: ['data'], properties: { data: { type: 'array', items: ref('LeadEvent') } } },
        CreateSellerRequest: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'email'],
          properties: {
            name: { type: 'string', minLength: 2, maxLength: 120, example: 'Carlos Lima' },
            email: { type: 'string', format: 'email', maxLength: 254, description: 'Único; convertido para minúsculas.', example: 'carlos@example.com' },
            active: { type: 'boolean', default: true },
          },
        },
        UpdateSellerRequest: { type: 'object', additionalProperties: false, required: ['active'], properties: { active: { type: 'boolean' } } },
        Seller: {
          type: 'object',
          required: ['id', 'name', 'email', 'active', 'last_assigned_at', 'created_at', 'updated_at'],
          properties: {
            id: uuid('Identificador do vendedor.'),
            name: { type: 'string' },
            email: { type: 'string', format: 'email' },
            active: { type: 'boolean' },
            last_assigned_at: { ...dateTime('Última atribuição (critério do round-robin).'), nullable: true },
            created_at: dateTime('Criação.'),
            updated_at: dateTime('Última alteração.'),
          },
        },
        SellerList: { type: 'object', required: ['data'], properties: { data: { type: 'array', items: ref('Seller') } } },
        WebhookEnvelope: {
          type: 'object',
          additionalProperties: false,
          required: ['event_id', 'source', 'data'],
          properties: {
            event_id: { type: 'string', minLength: 8, maxLength: 100, pattern: '^[\\w.:\\-]+$', description: 'Id do evento no emissor. Com `source`, forma a chave de idempotência.', example: 'evt_20261124_0001' },
            source: { ...slug, example: 'landing_page' },
            data: ref('CreateLeadRequest'),
          },
        },
        WebhookAccepted: {
          type: 'object',
          required: ['status', 'event_id'],
          properties: { status: { type: 'string', enum: ['accepted'] }, event_id: { type: 'string' } },
        },
        WebhookDuplicate: {
          type: 'object',
          required: ['status', 'event_id', 'processing_status'],
          properties: {
            status: { type: 'string', enum: ['duplicate'] },
            event_id: { type: 'string' },
            processing_status: { type: 'string', enum: ['pending', 'processing', 'processed', 'duplicate', 'dead'], description: 'Situação atual do evento original.' },
          },
        },
        FieldIssue: {
          type: 'object',
          required: ['in', 'path', 'message'],
          properties: { in: { type: 'string', enum: ['body', 'query', 'params'] }, path: { type: 'string', example: 'phone' }, message: { type: 'string', example: 'Telefone inválido' } },
        },
        ErrorResponse: {
          type: 'object',
          required: ['error'],
          description: 'Formato único de erro de toda a API.',
          properties: {
            error: {
              type: 'object',
              required: ['code', 'message', 'request_id'],
              properties: {
                code: {
                  type: 'string',
                  enum: ['INVALID_BODY', 'UNAUTHORIZED', 'NOT_FOUND', 'LEAD_ALREADY_EXISTS', 'SELLER_ALREADY_EXISTS', 'EVENT_ID_REUSED', 'PAYLOAD_TOO_LARGE', 'VALIDATION_ERROR', 'RATE_LIMITED', 'SERVICE_UNAVAILABLE', 'INTERNAL_ERROR'],
                },
                message: { type: 'string' },
                details: { description: 'Lista de `FieldIssue` (422) ou objeto com contexto (ex.: `{ "lead_id": "..." }` no 409).', oneOf: [{ type: 'array', items: ref('FieldIssue') }, { type: 'object', additionalProperties: true }] },
                request_id: { type: 'string' },
              },
            },
          },
        },
        Health: {
          type: 'object',
          required: ['status'],
          properties: { status: { type: 'string', enum: ['ok', 'degraded', 'unavailable'] } },
        },
      },
      responses: {
        InvalidBody: { description: 'JSON malformado ou encoding não suportado.', content: jsonBody(ref('ErrorResponse'), errorExample('INVALID_BODY', 'Corpo da requisição inválido')) },
        Unauthorized: {
          description: 'API key ausente/inválida, ou assinatura de webhook ausente/inválida/expirada (resposta sempre genérica; o motivo real só vai para o log).',
          headers: { 'WWW-Authenticate': { description: 'Esquema esperado.', schema: { type: 'string', example: 'ApiKey' } } },
          content: jsonBody(ref('ErrorResponse'), errorExample('UNAUTHORIZED', 'Credenciais ausentes ou inválidas')),
        },
        NotFound: { description: 'Recurso inexistente.', content: jsonBody(ref('ErrorResponse'), errorExample('NOT_FOUND', 'Lead não encontrado')) },
        PayloadTooLarge: { description: 'Corpo acima de 50 KB (REST) ou 100 KB (webhook).', content: jsonBody(ref('ErrorResponse'), errorExample('PAYLOAD_TOO_LARGE', 'Corpo da requisição excede o limite')) },
        ValidationError: {
          description: 'Campos inválidos, desconhecidos (`strict`) ou telefone inválido. Nada é persistido.',
          content: jsonBody(ref('ErrorResponse'), errorExample('VALIDATION_ERROR', 'Dados inválidos', [{ in: 'body', path: 'phone', message: 'Telefone inválido' }])),
        },
        RateLimited: {
          description: 'Limite de requisições excedido.',
          headers: { 'Retry-After': { description: 'Segundos até poder tentar de novo.', schema: { type: 'integer' } } },
          content: jsonBody(ref('ErrorResponse'), errorExample('RATE_LIMITED', 'Muitas requisições')),
        },
        InternalError: { description: 'Erro inesperado (detalhes só no log, correlacionados pelo `request_id`).', content: jsonBody(ref('ErrorResponse'), errorExample('INTERNAL_ERROR', 'Erro interno')) },
        ServiceUnavailable: {
          description: 'MySQL indisponível. Repita a requisição após `Retry-After`.',
          headers: { 'Retry-After': { description: 'Sempre `5`.', schema: { type: 'integer', example: 5 } } },
          content: jsonBody(ref('ErrorResponse'), errorExample('SERVICE_UNAVAILABLE', 'Serviço temporariamente indisponível')),
        },
      },
    },
  };
}

export const openApiSpec = buildOpenApiSpec();
