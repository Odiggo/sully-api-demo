export const SULLY_API_HOSTNAMES = ['api.sully.ai', 'api-testing.sully.ai'] as const;

export function isLoopbackHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

export function isApprovedSullyOrigin(url: URL): boolean {
  const loopbackOrigin =
    (url.protocol === 'https:' || url.protocol === 'http:') && isLoopbackHostname(url.hostname);
  const documentedSullyOrigin =
    url.protocol === 'https:' &&
    url.port === '' &&
    SULLY_API_HOSTNAMES.some((hostname) => hostname === url.hostname);
  return loopbackOrigin || documentedSullyOrigin;
}

export function parseApprovedSullyOrigin(value: string | URL): URL | undefined {
  try {
    const url = new URL(String(value));
    const isOriginOnly =
      url.pathname === '/' &&
      url.search === '' &&
      url.hash === '' &&
      url.username === '' &&
      url.password === '';
    if (!isOriginOnly || !isApprovedSullyOrigin(url)) return undefined;
    return new URL(url.origin);
  } catch {
    return undefined;
  }
}
