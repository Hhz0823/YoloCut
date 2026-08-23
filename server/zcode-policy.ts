export const ZCODE_PORT_START = 18_080;
export const ZCODE_PORT_END = 18_180;
export const ZCODE_REQUIRED_MODEL = 'gemini-3.7-flash';

const BASE_URL_ERROR = `ZCode Base URL 必须是 http://127.0.0.1:${ZCODE_PORT_START}..${ZCODE_PORT_END}/v1`;

export function isZCodePort(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= ZCODE_PORT_START
    && value <= ZCODE_PORT_END;
}

export function zcodeBaseUrl(port: number): string {
  if (!isZCodePort(port)) throw new Error(BASE_URL_ERROR);
  return `http://127.0.0.1:${port}/v1`;
}

/**
 * ZCode owns a fixed loopback gateway range. Keeping its provider URL inside
 * that range prevents a copied local key from being sent to a remote relay.
 * The manual recovery form may omit `/v1`; it is normalized here.
 */
export function normalizeZCodeBaseUrl(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(BASE_URL_ERROR);
  }
  const port = Number(url.port);
  const pathname = url.pathname.replace(/\/+$/, '');
  if (
    url.protocol !== 'http:'
    || url.hostname !== '127.0.0.1'
    || !isZCodePort(port)
    || (pathname !== '' && pathname !== '/v1')
    || url.username !== ''
    || url.password !== ''
    || url.search !== ''
    || url.hash !== ''
  ) {
    throw new Error(BASE_URL_ERROR);
  }
  return zcodeBaseUrl(port);
}
