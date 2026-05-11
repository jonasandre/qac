export type QacErrorCode =
  | 'NO_ACTIVE_CONTEXT'
  | 'CONTEXT_NOT_FOUND'
  | 'CONTEXT_INVALID'
  | 'CONFIG_NOT_FOUND'
  | 'CONFIG_PARSE_ERROR'
  | 'ENV_VAR_MISSING'
  | 'AUTH_FAILED'
  | 'APP_NOT_FOUND'
  | 'FIELD_NOT_FOUND'
  | 'QIX_TIMEOUT'
  | 'QIX_HANDSHAKE_FAILED'
  | 'QIX_INTERNAL'
  | 'EXPRESSION_INVALID'
  | 'REST_ERROR'
  | 'INVALID_INPUT'
  | 'INSECURE_TENANT_URL'
  | 'INVALID_SET_EXPRESSION'
  | 'UNKNOWN';

export class QacError extends Error {
  override readonly name = 'QacError';
  readonly code: QacErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: QacErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.details = details;
  }

  toJSON(): { code: QacErrorCode; message: string; details?: Record<string, unknown> } {
    return { code: this.code, message: this.message, ...(this.details && { details: this.details }) };
  }
}

export function wrapUnknown(err: unknown, fallback: QacErrorCode = 'UNKNOWN'): QacError {
  if (err instanceof QacError) return err;
  if (err instanceof Error) {
    return new QacError(fallback, err.message, { cause: err.name });
  }
  return new QacError(fallback, String(err));
}
