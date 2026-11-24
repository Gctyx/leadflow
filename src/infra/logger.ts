import pino from 'pino';
import type { Config } from '../config';

export type Logger = pino.Logger;

/** Logs estruturados; segredos e PII (telefone/e-mail) são removidos por `redact`. */
export function createLogger(c: Pick<Config, 'LOG_LEVEL' | 'NODE_ENV'>): Logger {
  return pino({
    level: c.NODE_ENV === 'test' ? 'silent' : c.LOG_LEVEL,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers["x-api-key"]',
        'req.headers["x-leadflow-signature"]',
        'phone',
        'email',
        '*.phone',
        '*.email',
      ],
      censor: '[redacted]',
    },
  });
}
