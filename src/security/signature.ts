import { createHmac, timingSafeEqual } from 'node:crypto';

export type SignatureFailure = 'missing_headers' | 'bad_timestamp' | 'timestamp_out_of_tolerance' | 'signature_mismatch';

/** HMAC-SHA256 de `${timestamp}.${corpoBruto}`. O timestamp assinado impede reaproveitar uma assinatura antiga (replay). */
export function signPayload(secret: string, timestamp: number | string, rawBody: Buffer | string): string {
  return createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex');
}

export interface VerifyInput {
  secrets: string[]; // [atual, ...anteriores] — suporta rotação sem downtime
  timestamp?: string;
  signature?: string; // formato "v1=<hex>"
  rawBody?: Buffer;
  toleranceSeconds: number;
  nowMs?: number;
}

export function verifySignature(i: VerifyInput): { ok: true } | { ok: false; reason: SignatureFailure } {
  if (!i.timestamp || !i.signature || !i.rawBody) return { ok: false, reason: 'missing_headers' };
  if (!/^\d{10}$/.test(i.timestamp)) return { ok: false, reason: 'bad_timestamp' };

  const nowSec = Math.floor((i.nowMs ?? Date.now()) / 1000);
  if (Math.abs(nowSec - Number(i.timestamp)) > i.toleranceSeconds) {
    return { ok: false, reason: 'timestamp_out_of_tolerance' };
  }

  const hex = i.signature.startsWith('v1=') ? i.signature.slice(3) : '';
  if (!/^[0-9a-f]{64}$/i.test(hex)) return { ok: false, reason: 'signature_mismatch' };
  const provided = Buffer.from(hex, 'hex');

  // Compara contra todos os segredos sem curto-circuito e em tempo constante.
  let match = false;
  for (const secret of i.secrets) {
    const expected = Buffer.from(signPayload(secret, i.timestamp, i.rawBody), 'hex');
    match = timingSafeEqual(expected, provided) || match;
  }
  return match ? { ok: true } : { ok: false, reason: 'signature_mismatch' };
}
