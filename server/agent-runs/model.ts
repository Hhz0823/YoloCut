import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createMoonshotAI } from '@ai-sdk/moonshotai';
import { createAlibaba } from '@ai-sdk/alibaba';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createMistral } from '@ai-sdk/mistral';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { SharedV4ProviderOptions } from '@ai-sdk/provider';
import type { LanguageModel } from 'ai';
import { Agent } from 'undici';
import type { AgentCacheMode } from '../../src/agent/settings/agentSettings';
import {
  protocolForProvider,
  type LlmProvider,
  type OpenAiApiMode,
} from '../../shared/llm-providers';

const LOOPBACK_DISPATCHER = new Agent();

const loopbackFetch: typeof globalThis.fetch = (input, init) => globalThis.fetch(input, {
  ...init,
  dispatcher: LOOPBACK_DISPATCHER,
} as RequestInit & { dispatcher: Agent });

function proxyOptions(provider: LlmProvider, origin: string): {
  baseURL: string;
  apiKey: string;
  headers: Record<string, string>;
  fetch: typeof globalThis.fetch;
} {
  return {
    baseURL: `${origin}/llm`,
    apiKey: 'proxy-injects-the-real-key',
    // serverPlugins installs a global outbound ProxyAgent. This request is to
    // YoloCut's own loopback /llm route and must never leave the machine.
    fetch: loopbackFetch,
    headers: {
      'x-yolocut-provider': provider,
      origin,
      'sec-fetch-site': 'same-origin',
    },
  };
}

function providerFactory(
  provider: LlmProvider,
  origin: string,
): (modelId: string) => LanguageModel {
  const options = proxyOptions(provider, origin);
  switch (provider) {
    case 'anthropic': return createAnthropic(options);
    case 'gemini': return createGoogleGenerativeAI(options);
    case 'kimi': return createMoonshotAI(options);
    case 'qwen': return createAlibaba(options);
    case 'deepseek': return createDeepSeek(options);
    case 'mistral': return createMistral(options);
    default: return createOpenAICompatible({ name: provider, ...options });
  }
}

/** Use the same local proxy and provider-specific SDKs as the browser Agent. */
export function createServerLanguageModel(
  provider: LlmProvider,
  modelId: string,
  apiMode: OpenAiApiMode,
  origin: string,
): LanguageModel {
  if (protocolForProvider(provider) === 'openai') {
    const openai = createOpenAI(proxyOptions(provider, origin));
    return apiMode === 'chat' ? openai.chat(modelId) : openai.responses(modelId);
  }
  return providerFactory(provider, origin)(modelId);
}

export function serverProviderOptions(
  provider: LlmProvider,
  apiMode: OpenAiApiMode,
  cacheMode: AgentCacheMode,
): SharedV4ProviderOptions | undefined {
  if (provider === 'anthropic') {
    const cacheControl = cacheMode === 'long'
      ? { type: 'ephemeral' as const, ttl: '1h' as const }
      : { type: 'ephemeral' as const };
    return { anthropic: { cacheControl } };
  }
  if (provider === 'minimax') return { minimax: { reasoning_split: true } };
  if (protocolForProvider(provider) === 'openai' && apiMode === 'responses') {
    return { openai: { store: false } };
  }
  return undefined;
}
