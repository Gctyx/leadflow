/**
 * Gera cabeçalhos assinados e imprime um curl pronto.
 *   WEBHOOK_SECRET=... npm run webhook:sign -- '{"event_id":"evt_0001","source":"landing","data":{"name":"Ana","phone":"11912345678"}}'
 */
import { signPayload } from '../src/security/signature';

const secret = process.env.WEBHOOK_SECRET ?? 'dev-webhook-secret-change-me-0001';
const url = process.env.URL ?? 'http://localhost:3000/api/v1/webhooks/leads';
const body =
  process.argv[2] ??
  JSON.stringify({ event_id: `evt_${Date.now()}`, source: 'landing_page', data: { name: 'Ana Souza', phone: '(11) 91234-5678', email: 'ana@example.com' } });

const ts = Math.floor(Date.now() / 1000);
const sig = signPayload(secret, ts, body);
console.log(`curl -i -X POST '${url}' \\
  -H 'Content-Type: application/json' \\
  -H 'X-Leadflow-Timestamp: ${ts}' \\
  -H 'X-Leadflow-Signature: v1=${sig}' \\
  --data-raw '${body}'`);
