import { Router } from 'express';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import { openApiSpec } from './openapi';

/**
 * Documentação interativa: Swagger UI em `/docs` e o contrato em `/openapi.json` (importável no Postman/Insomnia).
 *
 * Montado ANTES do `helmet()` global porque o Swagger UI precisa de uma CSP própria: a padrão do helmet inclui
 * `upgrade-insecure-requests`, que faz o navegador (Safari, principalmente) tentar HTTPS em http://localhost e deixa a
 * página em branco. Todas as demais diretivas continuam restritivas (`'self'`), e o resto da API segue com o helmet padrão.
 * Desligue tudo com `DOCS_ENABLED=false`.
 */
export function docsRouter(): Router {
  const csp = helmet.contentSecurityPolicy.getDefaultDirectives();
  delete csp['upgrade-insecure-requests'];
  const docsHeaders = helmet({ contentSecurityPolicy: { useDefaults: false, directives: csp } });

  const r = Router();

  r.get('/openapi.json', docsHeaders, (_req, res) => {
    res.type('application/json').send(JSON.stringify(openApiSpec, null, 2));
  });

  // `/docs` -> `/docs/` (os recursos da página são relativos). Sem isso `/docs` carregaria CSS/JS do caminho errado.
  // O Express não distingue as duas formas no roteamento, então a barra final é checada na URL original.
  r.get('/docs', (req, res, next) => {
    if (req.originalUrl.split('?')[0].endsWith('/')) return next();
    res.redirect(301, 'docs/');
  });

  r.use(
    '/docs',
    docsHeaders,
    swaggerUi.serve,
    swaggerUi.setup(openApiSpec, {
      customSiteTitle: 'Leadflow Engine — API',
      swaggerOptions: { persistAuthorization: true, displayRequestDuration: true, docExpansion: 'list', filter: true, tryItOutEnabled: true },
    }),
  );

  return r;
}
