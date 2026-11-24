import { describe, expect, it } from 'vitest';
import { signPayload, verifySignature } from '../../src/security/signature';

const secret = 'current-secret-0123456789';
const old = 'previous-secret-0123456789';
const body = Buffer.from('{"a":1}');
const now = 1_800_000_000_000;
const ts = String(Math.floor(now / 1000));
const sig = (s = secret, t = ts, b: Buffer = body) => `v1=${signPayload(s, t, b)}`;
const base = { secrets: [secret, old], rawBody: body, timestamp: ts, signature: sig(), toleranceSeconds: 300, nowMs: now };

describe('verifySignature', () => {
  it('aceita assinatura válida', () => expect(verifySignature(base)).toEqual({ ok: true }));
  it('aceita segredo anterior (rotação)', () => expect(verifySignature({ ...base, signature: sig(old) }).ok).toBe(true));
  it('rejeita corpo adulterado', () =>
    expect(verifySignature({ ...base, rawBody: Buffer.from('{"a":2}') })).toEqual({ ok: false, reason: 'signature_mismatch' }));
  it('rejeita segredo desconhecido', () =>
    expect(verifySignature({ ...base, signature: sig('other-secret-0123456789') }).ok).toBe(false));
  it('rejeita timestamp fora da tolerância (replay)', () => {
    const stale = String(Number(ts) - 301);
    expect(verifySignature({ ...base, timestamp: stale, signature: sig(secret, stale) })).toEqual({ ok: false, reason: 'timestamp_out_of_tolerance' });
  });
  it('rejeita timestamp futuro demais', () => {
    const future = String(Number(ts) + 301);
    expect(verifySignature({ ...base, timestamp: future, signature: sig(secret, future) }).ok).toBe(false);
  });
  it('rejeita cabeçalhos ausentes, timestamp mal formado e assinatura mal formada', () => {
    expect(verifySignature({ ...base, signature: undefined })).toEqual({ ok: false, reason: 'missing_headers' });
    expect(verifySignature({ ...base, timestamp: 'abc' })).toEqual({ ok: false, reason: 'bad_timestamp' });
    expect(verifySignature({ ...base, signature: 'v1=zzzz' }).ok).toBe(false);
    expect(verifySignature({ ...base, signature: signPayload(secret, ts, body) }).ok).toBe(false); // sem prefixo v1=
  });
  it('a assinatura depende do timestamp', () => {
    const other = String(Number(ts) + 1);
    expect(verifySignature({ ...base, timestamp: other }).ok).toBe(false);
  });
});
