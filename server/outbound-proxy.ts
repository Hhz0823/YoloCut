// Unified outbound proxy for every API the server talks to (LLM providers,
// image/video/music/voice generation, model-pack downloads, R2).
//
// Priority: keystore PROXY_URL (user-configured in Settings → Agent models)
// first, then the standard HTTPS_PROXY/HTTP_PROXY environment variables
// (Clash etc.). Node's fetch/undici and node:https do NOT read proxy env
// vars by themselves, so every call site must attach the dispatcher/agent
// from this module explicitly.
//
// Lazily cached: the agent instance is rebuilt only when the resolved URL
// changes, so a settings edit takes effect on the next request.
import { createRequire } from 'node:module';
import type { Agent as HttpAgent } from 'node:http';
import type { Dispatcher } from 'undici';
import { getKey } from './keystore.ts';

const require = createRequire(import.meta.url);

/** Resolved proxy URL: keystore PROXY_URL first, then standard proxy environment variables. */
export function environmentProxyUrl(): string {
  return process.env.HTTPS_PROXY
    ?? process.env.https_proxy
    ?? process.env.HTTP_PROXY
    ?? process.env.http_proxy
    ?? '';
}

export function outboundProxyUrl(): string {
  const fromKey = getKey('PROXY_URL').trim();
  return fromKey || environmentProxyUrl();
}

let cachedDispatcherUrl = '';
let cachedHttpAgentUrl = '';
let cachedDispatcher: Dispatcher | null = null;
let cachedHttpAgent: HttpAgent | null = null;

/**
 * undici dispatcher for `fetch(url, { dispatcher })`. `undefined` = no proxy
 * (undici falls back to the default global dispatcher).
 */
export function proxyDispatcher(): Dispatcher | undefined {
  const url = outboundProxyUrl();
  if (url !== cachedDispatcherUrl) {
    cachedDispatcherUrl = url;
    try {
      const { ProxyAgent } = require('undici') as typeof import('undici');
      cachedDispatcher = url ? new ProxyAgent(url) : null;
    } catch {
      cachedDispatcher = null;
    }
  }
  return cachedDispatcher ?? undefined;
}

/**
 * node:http(s) agent (CONNECT tunnel) for http.request/https.request call
 * sites. `undefined` = no proxy.
 */
export function outboundHttpAgent(): HttpAgent | undefined {
  const url = outboundProxyUrl();
  if (url !== cachedHttpAgentUrl) {
    cachedHttpAgentUrl = url;
    try {
      const { HttpsProxyAgent } = require('https-proxy-agent') as typeof import('https-proxy-agent');
      cachedHttpAgent = url ? new HttpsProxyAgent(url) : null;
    } catch {
      cachedHttpAgent = null;
    }
  }
  return cachedHttpAgent ?? undefined;
}

/** curl CLI args for a configured proxy (empty array = direct). */
export function proxyCurlArgs(): string[] {
  const url = outboundProxyUrl();
  return url ? ['-x', url] : [];
}
