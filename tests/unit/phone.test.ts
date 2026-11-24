import { describe, expect, it } from 'vitest';
import { normalizePhone } from '../../src/domain/phone';

describe('normalizePhone', () => {
  it.each([
    '(11) 91234-5678',
    '11 91234-5678',
    '11912345678',
    '+55 11 91234-5678',
    '+5511912345678',
    '0055 11 91234 5678'.replace('0055', '+55'),
  ])('normaliza %s para o mesmo E.164', (input) => {
    expect(normalizePhone(input)).toBe('+5511912345678');
  });

  it('aceita números internacionais', () => {
    expect(normalizePhone('+1 415 555 2671')).toBe('+14155552671');
  });

  it.each(['', 'abc', '123', '(11) 1234', '+55 11 00000-0000', '999999999999999999'])('rejeita %j', (input) => {
    expect(normalizePhone(input)).toBeNull();
  });
});
