export type Channel = 'api' | 'webhook';
export type EventChannel = Channel | 'system';
export type LeadStatus = 'unassigned' | 'assigned';
export type LeadEventType = 'lead.created' | 'lead.assigned' | 'lead.duplicate_attempt';
export type WebhookStatus = 'pending' | 'processing' | 'processed' | 'duplicate' | 'dead';

export interface Seller {
  id: string;
  name: string;
  email: string;
  active: boolean;
  lastAssignedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Lead {
  id: string;
  seq: number;
  name: string;
  email: string | null;
  phone: string; // E.164
  channel: Channel;
  origin: string | null;
  notes: string | null;
  status: LeadStatus;
  sellerId: string | null;
  assignedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface LeadEvent {
  seq: number;
  leadId: string;
  type: LeadEventType;
  channel: EventChannel;
  sellerId: string | null;
  webhookEventId: string | null;
  requestId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

export interface WebhookEvent {
  id: string;
  source: string;
  externalEventId: string;
  payload: WebhookEnvelope;
  payloadHash: string;
  status: WebhookStatus;
  attempts: number;
  nextAttemptAt: Date;
  enqueuedAt: Date | null;
  lockedUntil: Date | null;
  lastError: string | null;
  leadId: string | null;
  receivedAt: Date;
  processedAt: Date | null;
}

export interface CreateLeadInput {
  name: string;
  phone: string;
  email?: string;
  origin?: string;
  notes?: string;
}

export interface WebhookEnvelope {
  event_id: string;
  source: string;
  data: CreateLeadInput;
}
