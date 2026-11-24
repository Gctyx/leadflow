import type { Lead, LeadEvent, Seller } from '../domain/types';

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** Contratos públicos: nunca expõe ids sequenciais internos (`seq`), phone_raw nem campos de infraestrutura. */
export const leadDto = (l: Lead) => ({
  id: l.id,
  name: l.name,
  email: l.email,
  phone: l.phone,
  channel: l.channel,
  origin: l.origin,
  notes: l.notes,
  status: l.status,
  seller_id: l.sellerId,
  assigned_at: iso(l.assignedAt),
  created_at: iso(l.createdAt),
  updated_at: iso(l.updatedAt),
});

export const sellerDto = (s: Seller) => ({
  id: s.id,
  name: s.name,
  email: s.email,
  active: s.active,
  last_assigned_at: iso(s.lastAssignedAt),
  created_at: iso(s.createdAt),
  updated_at: iso(s.updatedAt),
});

export const eventDto = (e: LeadEvent) => ({
  type: e.type,
  channel: e.channel,
  seller_id: e.sellerId,
  webhook_event_id: e.webhookEventId,
  request_id: e.requestId,
  metadata: e.metadata,
  created_at: iso(e.createdAt),
});
