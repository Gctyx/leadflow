import { describe, expect, it } from 'vitest';
import { computeBackoffMs } from '../../src/domain/backoff';
import { decodeCursor, encodeCursor } from '../../src/domain/cursor';
import { ValidationError } from '../../src/domain/errors';

describe('computeBackoffMs', () => {
  it('cresce exponencialmente e respeita o teto', () => {
    const max = (n: number) => computeBackoffMs(n, 1000, 10_000, () => 1);
    expect([max(1), max(2), max(3), max(4), max(10)]).toEqual([1000, 2000, 4000, 8000, 10_000]);
  });
  it('aplica jitter entre 50% e 100%', () => {
    expect(computeBackoffMs(3, 1000, 60_000, () => 0)).toBe(2000);
    expect(computeBackoffMs(3, 1000, 60_000, () => 1)).toBe(4000);
  });
});

describe('cursor', () => {
  it('faz round-trip', () => expect(decodeCursor(encodeCursor(12345))).toBe(12345));
  it('rejeita cursor adulterado', () => {
    expect(() => decodeCursor('bm90LWEtbnVtYmVy')).toThrow(ValidationError);
    expect(() => decodeCursor(Buffer.from("1 OR 1=1").toString('base64url'))).toThrow(ValidationError);
  });
});
