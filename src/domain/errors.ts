export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    public readonly headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export interface FieldIssue {
  in: 'body' | 'query' | 'params';
  path: string;
  message: string;
}

export class ValidationError extends AppError {
  constructor(message = 'Dados inválidos', details?: FieldIssue[]) {
    super(422, 'VALIDATION_ERROR', message, details);
  }
}
export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(404, 'NOT_FOUND', `${resource} não encontrado`);
  }
}
export class UnauthorizedError extends AppError {
  constructor() {
    super(401, 'UNAUTHORIZED', 'Credenciais ausentes ou inválidas', undefined, { 'WWW-Authenticate': 'ApiKey' });
  }
}
export class ConflictError extends AppError {
  constructor(code: string, message: string, details?: unknown) {
    super(409, code, message, details);
  }
}
export class DuplicateLeadError extends ConflictError {
  constructor(public readonly existingLeadId: string) {
    super('LEAD_ALREADY_EXISTS', 'Já existe um lead com este telefone', { lead_id: existingLeadId });
  }
}
export class RateLimitedError extends AppError {
  constructor(retryAfterSeconds: number) {
    super(429, 'RATE_LIMITED', 'Muitas requisições', undefined, { 'Retry-After': String(retryAfterSeconds) });
  }
}
