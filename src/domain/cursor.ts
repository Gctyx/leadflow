import { ValidationError } from './errors';

export const encodeCursor = (seq: number): string => Buffer.from(String(seq)).toString('base64url');

export function decodeCursor(cursor: string): number {
  const raw = Buffer.from(cursor, 'base64url').toString('utf8');
  if (!/^\d{1,18}$/.test(raw)) {
    throw new ValidationError('Dados inválidos', [{ in: 'query', path: 'cursor', message: 'Cursor inválido' }]);
  }
  return Number(raw);
}
