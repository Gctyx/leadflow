import express, { Router } from 'express';
import type { Container } from '../container';
import { asyncHandler, requestId, validate, webhookSignature } from './middleware';
import { eventDto, leadDto, sellerDto } from './dto';
import {
  createLeadSchema, createSellerSchema, idParamSchema, listLeadsQuerySchema,
  listSellersQuerySchema, updateSellerSchema, webhookEnvelopeSchema,
} from '../schemas';

export function leadRoutes(c: Container): Router {
  const r = Router();

  r.post('/', validate({ body: createLeadSchema }), asyncHandler(async (req, res) => {
    const lead = await c.leadService.create(req.validated!.body, { channel: 'api', requestId: requestId(req) });
    res.status(201).location(`/api/v1/leads/${lead.id}`).json(leadDto(lead));
  }));

  r.get('/', validate({ query: listLeadsQuerySchema }), asyncHandler(async (req, res) => {
    const { items, nextCursor } = await c.leadService.list(req.validated!.query);
    res.json({ data: items.map(leadDto), page: { limit: req.validated!.query.limit, next_cursor: nextCursor } });
  }));

  r.get('/:id', validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
    res.json(leadDto(await c.leadService.getById(req.validated!.params.id)));
  }));

  r.get('/:id/events', validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
    const events = await c.leadService.getEvents(req.validated!.params.id);
    res.json({ data: events.map(eventDto) });
  }));

  return r;
}

export function sellerRoutes(c: Container): Router {
  const r = Router();

  r.post('/', validate({ body: createSellerSchema }), asyncHandler(async (req, res) => {
    const seller = await c.sellerService.create(req.validated!.body);
    res.status(201).location(`/api/v1/sellers/${seller.id}`).json(sellerDto(seller));
  }));

  r.get('/', validate({ query: listSellersQuerySchema }), asyncHandler(async (req, res) => {
    const { active, limit } = req.validated!.query;
    res.json({ data: (await c.sellerService.list({ active }, limit)).map(sellerDto) });
  }));

  r.get('/:id', validate({ params: idParamSchema }), asyncHandler(async (req, res) => {
    res.json(sellerDto(await c.sellerService.get(req.validated!.params.id)));
  }));

  r.patch('/:id', validate({ params: idParamSchema, body: updateSellerSchema }), asyncHandler(async (req, res) => {
    res.json(sellerDto(await c.sellerService.setActive(req.validated!.params.id, req.validated!.body.active)));
  }));

  return r;
}

export function webhookRoutes(c: Container): Router {
  const r = Router();

  // O corpo BRUTO é guardado porque a assinatura HMAC é calculada sobre os bytes exatos recebidos.
  r.use(express.json({ limit: '100kb', verify: (req, _res, buf) => { (req as any).rawBody = buf; } }));

  r.post(
    '/leads',
    webhookSignature(c.config.WEBHOOK_SECRETS, c.config.WEBHOOK_TOLERANCE_SECONDS, c.logger),
    validate({ body: webhookEnvelopeSchema }),
    asyncHandler(async (req, res) => {
      const result = await c.webhookIngest.ingest(req.validated!.body);
      if (result.duplicate) {
        // Reentrega do mesmo evento: 200 (não 4xx) para o emissor parar de retentar.
        return void res.status(200).json({ status: 'duplicate', event_id: result.eventId, processing_status: result.status });
      }
      res.status(202).json({ status: 'accepted', event_id: result.eventId });
    }),
  );

  return r;
}
