import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Exporta o contrato OpenAPI para docs/openapi.json a partir do código fonte.
// Implementação mínima: importa o objeto OpenAPI da aplicação.

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { openApiSpec } = require('../src/docs/openapi');

const out = resolve(__dirname, '..', 'docs', 'openapi.json');
writeFileSync(out, JSON.stringify(openApiSpec, null, 2), 'utf8');
console.log(`OpenAPI exportado para ${out}`);
