import type { IncomingMessage } from 'node:http';
import type { Plugin } from 'vite';
import { getKey, type KeyName } from '../keystore.ts';
import {
  normalizeLlmProvider,
  llmProviderPreset,
  protocolForProvider,
  type LlmProvider,
} from '../../shared/llm-providers.ts';
import { resolveLlmProviderConfig } from '../llm-config.ts';
import { proxyMiddleware } from '../proxy.ts';

function keyReader(name: string): string {
  return getKey(name as KeyName);
}

export function llmProviderForRequest(req?: IncomingMessage): LlmProvider {
  const requested = req?.headers['x-yolocut-provider'];
  return normalizeLlmProvider(typeof requested === 'string' ? requested : getKey('LLM_PROVIDER'));
}

export function llmTarget(req?: IncomingMessage): string {
  return resolveLlmProviderConfig(llmProviderForRequest(req), keyReader).baseUrl;
}

export function llmHeaders(req?: IncomingMessage): Record<string, string> {
  const config = resolveLlmProviderConfig(llmProviderForRequest(req), keyReader);
  if (!config.apiKey) return {};
  const protocol = protocolForProvider(config.provider);
  if (protocol === 'anthropic') return { 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01' };
  if (protocol === 'google') return { 'x-goog-api-key': config.apiKey };
  return { authorization: `Bearer ${config.apiKey}` };
}

export function llmErrorMessage(status: number, req?: IncomingMessage): string {
  const provider = llmProviderForRequest(req);
  const label = llmProviderPreset(provider).label;
  if (provider === 'zcode') {
    if (status === 400) {
      return 'ZCode 拒绝了 OpenAI-compatible /v1/chat/completions 请求（HTTP 400）。请检查模型名称，或在“设置 → Agent 模型”中手动检查 URL、API Key 和模型。';
    }
    if (status === 401 || status === 403) {
      return 'ZCode 本地网关认证失败。请重新执行自动连接，或在“设置 → Agent 模型”中手动检查 URL、API Key 和模型。';
    }
    if (status === 404) {
      return 'ZCode 接口或模型不存在。请确认实时 /v1/models 中仍有 gemini-3.7-flash，并检查手动 URL、API Key 和模型。';
    }
    if (status === 402 || status === 429) {
      return 'ZCode 上游额度不足或请求过于频繁。YoloCut 不管理 Google OAuth/账号，请在 ZCode 中检查上游状态后重试。';
    }
    if (status >= 500) {
      return `ZCode 本地网关或其上游暂时不可用（HTTP ${status}）。请确认 ZCode 正在运行，或在“设置 → Agent 模型”中手动检查 URL、API Key 和模型。`;
    }
    return `ZCode 请求失败（HTTP ${status}）。请在“设置 → Agent 模型”中手动检查 URL、API Key 和模型。`;
  }
  if (status === 401 || status === 403) {
    return `${label} 认证失败。请在“设置 → Agent 模型”中检查 API Key。`;
  }
  if (status === 402 || status === 429) {
    return `${label} 额度不足或请求过于频繁。请检查账户额度，稍后重试。`;
  }
  if (status === 404) {
    return `${label} 的接口或模型不存在。请检查 Base URL 和模型名称。`;
  }
  if (status >= 500) {
    return `${label} 服务暂时不可用（HTTP ${status}）。请稍后重试或切换模型。`;
  }
  return `${label} 请求失败（HTTP ${status}）。请检查“设置 → Agent 模型”中的连接配置。`;
}

/** One dynamic proxy implementation shared by Vite dev and Electron production. */
export function llmProxyPlugin(): Plugin {
  return {
    name: 'yolocut-llm-proxy',
    configureServer(server) {
      server.middlewares.use('/llm', proxyMiddleware({
        target: llmTarget,
        headers: llmHeaders,
        forceJsonContentType: true,
        errorMessage: llmErrorMessage,
      }));
    },
  };
}
