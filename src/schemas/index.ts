import { z } from 'zod';

// Rejeita caracteres de controle (log/header injection, lixo invisível) em campos de linha única.
const singleLine = (min: number, max: number) =>
  z.string().trim().min(min).max(max).regex(/^[^\u0000-\u001f\u007f]+$/, 'caracteres de controle não são permitidos');

const email = z.string().trim().toLowerCase().max(254).email();
const uuid = z.string().uuid();
const slug = z.string().trim().min(2).max(60).regex(/^[\w.:\- ]+$/, 'use apenas letras, números e . : _ -');

/** `.strict()` em tudo: campos desconhecidos são rejeitados (nada de mass assignment silencioso). */
export const createLeadSchema = z
  .object({
    name: singleLine(2, 120),
    phone: z.string().trim().min(8).max(32),
    email: email.optional(),
    origin: slug.optional(),
    notes: z.string().trim().max(1000).optional(),
  })
  .strict();

export const idParamSchema = z.object({ id: uuid }).strict();

export const listLeadsQuerySchema = z
  .object({
    status: z.enum(['unassigned', 'assigned']).optional(),
    seller_id: uuid.optional(),
    channel: z.enum(['api', 'webhook']).optional(),
    origin: slug.optional(),
    phone: z.string().trim().min(8).max(32).optional(),
    email: email.optional(),
    name: singleLine(1, 120).optional(),
    created_from: z.string().datetime({ offset: true }).optional(),
    created_to: z.string().datetime({ offset: true }).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().max(40).regex(/^[A-Za-z0-9_-]+$/).optional(),
  })
  .strict();

export const createSellerSchema = z
  .object({ name: singleLine(2, 120), email, active: z.boolean().default(true) })
  .strict();

export const updateSellerSchema = z.object({ active: z.boolean() }).strict();

export const listSellersQuerySchema = z
  .object({
    active: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

export const webhookEnvelopeSchema = z
  .object({
    event_id: z.string().min(8).max(100).regex(/^[\w.:\-]+$/, 'formato inválido'),
    source: slug,
    data: createLeadSchema,
  })
  .strict();
