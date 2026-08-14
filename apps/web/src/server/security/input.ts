export class InputValidationError extends Error {
  constructor(message = 'Invalid input') {
    super(message);
    this.name = 'InputValidationError';
  }
}

const INVISIBLE_OR_CONTROL = /[\p{Cc}\p{Cf}]/u;

function normalizeText(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new InputValidationError(`${field} must be text`);
  }

  const normalized = value.normalize('NFKC').trim();
  if (!normalized || INVISIBLE_OR_CONTROL.test(normalized)) {
    throw new InputValidationError(`${field} is invalid`);
  }
  return normalized;
}

export function normalizeNickname(value: unknown): { display: string; key: string } {
  const display = normalizeText(value, 'nickname');
  if (Array.from(display).length > 24) {
    throw new InputValidationError('nickname exceeds 24 characters');
  }

  return {
    display,
    key: display.toLocaleLowerCase('en-US'),
  };
}

export function normalizeBoundedText(value: unknown, maxLength: number, field: string): string {
  const normalized = normalizeText(value, field);
  if (Array.from(normalized).length > maxLength) {
    throw new InputValidationError(`${field} exceeds ${maxLength} characters`);
  }
  return normalized;
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.startsWith('application/json')) {
    throw new InputValidationError('JSON content type required');
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new InputValidationError('Malformed JSON');
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new InputValidationError('JSON object required');
  }
  return body as Record<string, unknown>;
}

export function requireUuid(value: unknown, field: string): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw new InputValidationError(`${field} must be a UUID`);
  }
  return value.toLowerCase();
}
