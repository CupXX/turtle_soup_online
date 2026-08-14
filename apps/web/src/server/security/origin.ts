import { getServerEnv } from '@/server/env';

export class SameOriginError extends Error {
  constructor() {
    super('Origin mismatch');
    this.name = 'SameOriginError';
  }
}

export function assertSameOrigin(request: Request, configuredOrigin = getServerEnv().siteOrigin): void {
  const actualOrigin = request.headers.get('origin');
  if (!actualOrigin) {
    throw new SameOriginError();
  }

  try {
    if (new URL(actualOrigin).origin !== new URL(configuredOrigin).origin) {
      throw new SameOriginError();
    }
  } catch (error) {
    if (error instanceof SameOriginError) {
      throw error;
    }
    throw new SameOriginError();
  }
}
