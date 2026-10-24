// 名称、价格和地址由锁定 Pi SDK 的公开目录生成，能力事实由同一步骤生成。https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
import type { CatalogProvider } from "@/modelManagement/types/catalog";
export const BUILTIN_CATALOG: readonly CatalogProvider[] = [
  {
    id: "ant-ling",
    displayName: "Ant Ling",
    providerType: "openai-compatible",
    defaultBaseUrl: "https://api.ant-ling.com/v1",
    models: {
      "Ling-2.6-1T": {
        id: "Ling-2.6-1T",
        displayName: "Ling 2.6 1T",
        cost: { input: 0.06, output: 0.25, cacheRead: 0, cacheWrite: 0 },
      },
      "Ling-2.6-flash": {
        id: "Ling-2.6-flash",
        displayName: "Ling 2.6 Flash",
        cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0 },
      },
      "Ring-2.6-1T": {
        id: "Ring-2.6-1T",
        displayName: "Ring 2.6 1T",
        cost: { input: 0.06, output: 0.25, cacheRead: 0, cacheWrite: 0 },
      },
    },
  },
  {
    id: "anthropic",
    displayName: "Anthropic",
    providerType: "anthropic",
    defaultBaseUrl: "https://api.anthropic.com",
    models: {
      "claude-fable-5": {
        id: "claude-fable-5",
        displayName: "Claude Fable 5",
        cost: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
      },
      "claude-fable-5-1": {
        id: "claude-fable-5-1",
        displayName: "Claude Fable 5.1",
        cost: { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
      },
      "claude-haiku-4-5": {
        id: "claude-haiku-4-5",
        displayName: "Claude Haiku 4.5 (latest)",
        cost: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
      },
      "claude-haiku-4-5-20251001": {
        id: "claude-haiku-4-5-20251001",
        displayName: "Claude Haiku 4.5",
        cost: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
      },
      "claude-haiku-5-5": {
        id: "claude-haiku-5-5",
        displayName: "Claude Haiku 5.5",
        cost: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
      },
      "claude-opus-4-5": {
        id: "claude-opus-4-5",
        displayName: "Claude Opus 4.5 (latest)",
        cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
      },
      "claude-opus-4-5-20251101": {
        id: "claude-opus-4-5-20251101",
        displayName: "Claude Opus 4.5",
        cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
      },
      "claude-opus-4-6": {
        id: "claude-opus-4-6",
        displayName: "Claude Opus 4.6",
        cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
      },
      "claude-opus-4-7": {
        id: "claude-opus-4-7",
        displayName: "Claude Opus 4.7",
        cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
      },
      "claude-opus-4-8": {
        id: "claude-opus-4-8",
        displayName: "Claude Opus 4.8",
        cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
      },
      "claude-opus-5": {
        id: "claude-opus-5",
        displayName: "Claude Opus 5",
        cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
      },
      "claude-opus-5-5": {
        id: "claude-opus-5-5",
        displayName: "Claude Opus 5.5",
        cost: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
      },
      "claude-sonnet-4-5": {
        id: "claude-sonnet-4-5",
        displayName: "Claude Sonnet 4.5 (latest)",
        cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
      },
      "claude-sonnet-4-5-20250929": {
        id: "claude-sonnet-4-5-20250929",
        displayName: "Claude Sonnet 4.5",
        cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
      },
      "claude-sonnet-4-6": {
        id: "claude-sonnet-4-6",
        displayName: "Claude Sonnet 4.6",
        cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
      },
      "claude-sonnet-5": {
        id: "claude-sonnet-5",
        displayName: "Claude Sonnet 5",
        cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
      },
      "claude-sonnet-5-5": {
        id: "claude-sonnet-5-5",
        displayName: "Claude Sonnet 5.5",
        cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
      },
    },
  },
  {
    id: "baseten",
    displayName: "Baseten",
    providerType: "openai-compatible",
    defaultBaseUrl: "https://inference.baseten.co/v1",
    models: {
      "deepseek-ai/DeepSeek-V4-Flash-0731": {
        id: "deepseek-ai/DeepSeek-V4-Flash-0731",
        displayName: "DeepSeek V4 Flash 0731",
        cost: { input: 0.13, output: 0.26, cacheRead: 0.028, cacheWrite: 0 },
      },
      "deepseek-ai/DeepSeek-V4-Pro": {
        id: "deepseek-ai/DeepSeek-V4-Pro",
        displayName: "DeepSeek V4 Pro",
        cost: { input: 1.74, output: 3.48, cacheRead: 0.145, cacheWrite: 0 },
      },
      "deepseek-ai/DeepSeek-V4-Pro-0813": {
        id: "deepseek-ai/DeepSeek-V4-Pro-0813",
        displayName: "DeepSeek V4 Pro 0813",
        cost: { input: 1.32, output: 3.96, cacheRead: 0, cacheWrite: 0 },
      },
      "deepseek-ai/DeepSeek-V4.1-Flash": {
        id: "deepseek-ai/DeepSeek-V4.1-Flash",
        displayName: "DeepSeek V4.1 Flash",
        cost: { input: 0.3, output: 1.2, cacheRead: 0.03, cacheWrite: 0 },
      },
      "deepseek-ai/DeepSeek-V4.1-Flash-Fast": {
        id: "deepseek-ai/DeepSeek-V4.1-Flash-Fast",
        displayName: "DeepSeek V4.1 Flash Fast",
        cost: { input: 0.6, output: 2.4, cacheRead: 0, cacheWrite: 0 },
      },
      "moonshotai/Kimi-K2.5": {
        id: "moonshotai/Kimi-K2.5",
        displayName: "Kimi K2.5",
        cost: { input: 0.6, output: 3, cacheRead: 0.12, cacheWrite: 0 },
      },
      "moonshotai/Kimi-K2.6": {
        id: "moonshotai/Kimi-K2.6",
        displayName: "Kimi K2.6",
        cost: { input: 0.95, output: 4, cacheRead: 0.16, cacheWrite: 0 },
      },
      "moonshotai/Kimi-K2.7-Code": {
        id: "moonshotai/Kimi-K2.7-Code",
        displayName: "Kimi K2.7 Code",
        cost: { input: 0.95, output: 4, cacheRead: 0.16, cacheWrite: 0 },
      },
      "moonshotai/Kimi-K3": {
        id: "moonshotai/Kimi-K3",
        displayName: "Kimi K3",
        cost: { input: 3, output: 15, cacheRead: 0, cacheWrite: 0 },
      },
      "nvidia/Nemotron-120B-A12B": {
        id: "nvidia/Nemotron-120B-A12B",
        displayName: "Nemotron Super",
        cost: { input: 0.3, output: 0.75, cacheRead: 0.06, cacheWrite: 0 },
      },
      "nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B": {
        id: "nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B",
        displayName: "Nemotron Ultra",
        cost: { input: 0.6, output: 2.4, cacheRead: 0.12, cacheWrite: 0 },
      },
      "openai/gpt-oss-120b": {
        id: "openai/gpt-oss-120b",
        displayName: "OpenAI GPT 120B",
        cost: { input: 0.1, output: 0.5, cacheRead: 0, cacheWrite: 0 },
      },
      "thinkingmachines/inkling": {
        id: "thinkingmachines/inkling",
        displayName: "Inkling",
        cost: { input: 1, output: 4.05, cacheRead: 0, cacheWrite: 0 },
      },
      "thinkingmachines/inkling-small": {
        id: "thinkingmachines/inkling-small",
        displayName: "Inkling Small",
        cost: { input: 0.5, output: 1.2, cacheRead: 0.1, cacheWrite: 0 },
      },
      "zai-org/GLM-4.7": {
        id: "zai-org/GLM-4.7",
        displayName: "GLM 4.7",
        cost: { input: 0.6, output: 2.2, cacheRead: 0.12, cacheWrite: 0 },
      },
      "zai-org/GLM-5": {
        id: "zai-org/GLM-5",
        displayName: "GLM 5",
        cost: { input: 0.95, output: 3.15, cacheRead: 0.2, cacheWrite: 0 },
      },
      "zai-org/GLM-5.1": {
        id: "zai-org/GLM-5.1",
        displayName: "GLM 5.1",
        cost: { input: 1.3, output: 4.3, cacheRead: 0.26, cacheWrite: 0 },
      },
      "zai-org/GLM-5.2": {
        id: "zai-org/GLM-5.2",
        displayName: "GLM 5.2",
        cost: { input: 1.4, output: 4.4, cacheRead: 0.3, cacheWrite: 0 },
      },
      "zai-org/GLM-5.2-Fast": {
        id: "zai-org/GLM-5.2-Fast",
        displayName: "GLM 5.2 Fast",
        cost: { input: 2.1, output: 6.6, cacheRead: 0.21, cacheWrite: 0 },
      },
      "zai-org/GLM-5.3": {
        id: "zai-org/GLM-5.3",
        displayName: "GLM 5.3",
        cost: { input: 1.4, output: 4.4, cacheRead: 0.14, cacheWrite: 0 },
      },
      "zai-org/GLM-5.3-Fast": {
        id: "zai-org/GLM-5.3-Fast",
        displayName: "GLM 5.3 Fast",
        cost: { input: 2.1, output: 6.6, cacheRead: 0, cacheWrite: 0 },
      },
      "zai-org/GLM-5.3-Flash": {
        id: "zai-org/GLM-5.3-Flash",
        displayName: "GLM 5.3 Flash",
        cost: { input: 0.15, output: 0.5, cacheRead: 0, cacheWrite: 0 },
      },
    },
  },
  {
    id: "cerebras",
    displayName: "Cerebras",
    providerType: "openai-compatible",
    defaultBaseUrl: "https://api.cerebras.ai/v1",
    models: {
      "gpt-oss-120b": {
        id: "gpt-oss-120b",
        displayName: "GPT OSS 120B",
        cost: { input: 0.35, output: 0.75, cacheRead: 0, cacheWrite: 0 },
      },
      "qwen-3.8-27b": {
        id: "qwen-3.8-27b",
        displayName: "Qwen3.8 27B",
        cost: { input: 0.99, output: 1.49, cacheRead: 0.99, cacheWrite: 0 },
      },
    },
  },
  {
    id: "deepseek",
    displayName: "DeepSeek",
    providerType: "openai-compatible",
    defaultBaseUrl: "https://api.deepseek.com",
    models: {
      "deepseek-flash": {
        id: "deepseek-flash",
        displayName: "DeepSeek V4.1 Flash",
        cost: { input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0 },
      },
      "deepseek-v4-pro": {
        id: "deepseek-v4-pro",
        displayName: "DeepSeek V4 Pro",
        cost: { input: 1.32, output: 3.96, cacheRead: 0.044, cacheWrite: 0 },
      },
    },
  },
  {
    id: "fireworks",
    displayName: "Fireworks",
    providerType: "openai-compatible",
    defaultBaseUrl: "https://api.fireworks.ai/inference/v1",
    models: {
      "accounts/fireworks/models/deepseek-v4p1-flash": {
        id: "accounts/fireworks/models/deepseek-v4p1-flash",
        displayName: "DeepSeek V4.1 Flash",
        cost: { input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0 },
      },
      "accounts/fireworks/models/ember-1": {
        id: "accounts/fireworks/models/ember-1",
        displayName: "Ember-1",
        cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 0 },
      },
      "accounts/fireworks/models/gpt-oss-120b": {
        id: "accounts/fireworks/models/gpt-oss-120b",
        displayName: "GPT OSS 120B",
        cost: { input: 0.15, output: 0.6, cacheRead: 0.015, cacheWrite: 0 },
      },
      "accounts/fireworks/models/inkling": {
        id: "accounts/fireworks/models/inkling",
        displayName: "Inkling",
        cost: { input: 1, output: 4.05, cacheRead: 0.17, cacheWrite: 0 },
      },
      "accounts/fireworks/models/minimax-m3": {
        id: "accounts/fireworks/models/minimax-m3",
        displayName: "MiniMax-M3",
        cost: { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0 },
      },
      "accounts/fireworks/models/nemotron-3-ultra-nvfp4": {
        id: "accounts/fireworks/models/nemotron-3-ultra-nvfp4",
        displayName: "Nemotron 3 Ultra 550B A55B",
        cost: { input: 0.6, output: 2.4, cacheRead: 0.12, cacheWrite: 0 },
      },
      "accounts/fireworks/models/nemotron-lightning-3p5-30b-a3b": {
        id: "accounts/fireworks/models/nemotron-lightning-3p5-30b-a3b",
        displayName: "Nemotron 3.5 Lightning 30B A3B",
        cost: { input: 0.05, output: 0.2, cacheRead: 0.01, cacheWrite: 0 },
      },
      "accounts/fireworks/models/qwen3p8-2p4t-a95b": {
        id: "accounts/fireworks/models/qwen3p8-2p4t-a95b",
        displayName: "Qwen3.8 2.4T A95B",
        cost: { input: 2, output: 6, cacheRead: 0.25, cacheWrite: 0 },
      },
      "accounts/fireworks/models/qwen3p8-max": {
        id: "accounts/fireworks/models/qwen3p8-max",
        displayName: "Qwen3.8 Max",
        cost: { input: 2, output: 6, cacheRead: 0.25, cacheWrite: 0 },
      },
      "accounts/fireworks/routers/deepseek-flash-latest": {
        id: "accounts/fireworks/routers/deepseek-flash-latest",
        displayName: "DeepSeek Flash Latest",
        cost: { input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0 },
      },
      "accounts/fireworks/routers/kimi-fast-latest": {
        id: "accounts/fireworks/routers/kimi-fast-latest",
        displayName: "Kimi Fast Latest",
        cost: { input: 4.5, output: 22.5, cacheRead: 0.45, cacheWrite: 0 },
      },
      "accounts/fireworks/routers/kimi-latest": {
        id: "accounts/fireworks/routers/kimi-latest",
        displayName: "Kimi Latest",
        cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 0 },
      },
      "accounts/fireworks/routers/minimax-latest": {
        id: "accounts/fireworks/routers/minimax-latest",
        displayName: "MiniMax Latest",
        cost: { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0 },
      },
      "accounts/fireworks/routers/qwen-max-latest": {
        id: "accounts/fireworks/routers/qwen-max-latest",
        displayName: "Qwen Max Latest (Qwen3.8 Max)",
        cost: { input: 2, output: 6, cacheRead: 0.25, cacheWrite: 0 },
      },
      "accounts/fireworks/models/glm-5p3": {
        id: "accounts/fireworks/models/glm-5p3",
        displayName: "GLM 5.3",
        cost: { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 },
      },
      "accounts/fireworks/models/glm-5p3-flash": {
        id: "accounts/fireworks/models/glm-5p3-flash",
        displayName: "GLM 5.3 Flash",
        cost: { input: 0.15, output: 0.5, cacheRead: 0.03, cacheWrite: 0 },
      },
      "accounts/fireworks/models/kimi-k3": {
        id: "accounts/fireworks/models/kimi-k3",
        displayName: "Kimi K3",
        cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 0 },
      },
      "accounts/fireworks/routers/glm-5p3-fast": {
        id: "accounts/fireworks/routers/glm-5p3-fast",
        displayName: "GLM 5.3 Fast",
        cost: { input: 2.1, output: 6.6, cacheRead: 0.39, cacheWrite: 0 },
      },
      "accounts/fireworks/routers/glm-fast-latest": {
        id: "accounts/fireworks/routers/glm-fast-latest",
        displayName: "GLM 5.3 Fast (Latest)",
        cost: { input: 2.1, output: 6.6, cacheRead: 0.39, cacheWrite: 0 },
      },
      "accounts/fireworks/routers/glm-flash-latest": {
        id: "accounts/fireworks/routers/glm-flash-latest",
        displayName: "GLM Flash Latest (GLM 5.3 Flash)",
        cost: { input: 0.15, output: 0.5, cacheRead: 0.03, cacheWrite: 0 },
      },
      "accounts/fireworks/routers/glm-latest": {
        id: "accounts/fireworks/routers/glm-latest",
        displayName: "GLM Latest",
        cost: { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 },
      },
      "accounts/fireworks/routers/kimi-k3-fast": {
        id: "accounts/fireworks/routers/kimi-k3-fast",
        displayName: "Kimi K3 Fast",
        cost: { input: 4.5, output: 22.5, cacheRead: 0.45, cacheWrite: 0 },
      },
    },
  },
  {
    id: "google",
    displayName: "Google",
    providerType: "google",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    models: {
      "deep-research-max-preview-04-2026": {
        id: "deep-research-max-preview-04-2026",
        displayName: "Deep Research Max Preview (Apr-21-2026)",
        cost: { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 0 },
      },
      "deep-research-preview-04-2026": {
        id: "deep-research-preview-04-2026",
        displayName: "Deep Research Preview (Apr-21-2026)",
        cost: { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 0 },
      },
      "gemini-2.5-computer-use-preview-10-2025": {
        id: "gemini-2.5-computer-use-preview-10-2025",
        displayName: "Gemini 2.5 Computer Use Preview 10-2025",
        cost: { input: 1.25, output: 10, cacheRead: 0, cacheWrite: 0 },
      },
      "gemini-2.5-flash": {
        id: "gemini-2.5-flash",
        displayName: "Gemini 2.5 Flash",
        cost: { input: 0.3, output: 2.5, cacheRead: 0.03, cacheWrite: 0 },
      },
      "gemini-2.5-flash-lite": {
        id: "gemini-2.5-flash-lite",
        displayName: "Gemini 2.5 Flash-Lite",
        cost: { input: 0.1, output: 0.4, cacheRead: 0.01, cacheWrite: 0 },
      },
      "gemini-2.5-pro": {
        id: "gemini-2.5-pro",
        displayName: "Gemini 2.5 Pro",
        cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
      },
      "gemini-3-flash-preview": {
        id: "gemini-3-flash-preview",
        displayName: "Gemini 3 Flash Preview",
        cost: { input: 0.5, output: 3, cacheRead: 0.05, cacheWrite: 0 },
      },
      "gemini-3.1-flash-lite": {
        id: "gemini-3.1-flash-lite",
        displayName: "Gemini 3.1 Flash Lite",
        cost: { input: 0.25, output: 1.5, cacheRead: 0.025, cacheWrite: 0 },
      },
      "gemini-3.1-flash-lite-image": {
        id: "gemini-3.1-flash-lite-image",
        displayName: "Nano Banana 2 Lite",
        cost: { input: 0.25, output: 30, cacheRead: 0, cacheWrite: 0 },
      },
      "gemini-3.1-flash-lite-preview": {
        id: "gemini-3.1-flash-lite-preview",
        displayName: "Gemini 3.1 Flash Lite Preview",
        cost: { input: 0.25, output: 1.5, cacheRead: 0.025, cacheWrite: 0 },
      },
      "gemini-3.1-flash-live-preview": {
        id: "gemini-3.1-flash-live-preview",
        displayName: "Gemini 3.1 Flash Live Preview",
        cost: { input: 0.75, output: 4.5, cacheRead: 0, cacheWrite: 0 },
      },
      "gemini-3.1-pro-preview": {
        id: "gemini-3.1-pro-preview",
        displayName: "Gemini 3.1 Pro Preview",
        cost: { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 0 },
      },
      "gemini-3.1-pro-preview-customtools": {
        id: "gemini-3.1-pro-preview-customtools",
        displayName: "Gemini 3.1 Pro Preview Custom Tools",
        cost: { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 0 },
      },
      "gemini-3.5-flash": {
        id: "gemini-3.5-flash",
        displayName: "Gemini 3.5 Flash",
        cost: { input: 1.5, output: 9, cacheRead: 0.15, cacheWrite: 0 },
      },
      "gemini-3.5-flash-lite": {
        id: "gemini-3.5-flash-lite",
        displayName: "Gemini 3.5 Flash Lite",
        cost: { input: 0.3, output: 2.5, cacheRead: 0.03, cacheWrite: 0 },
      },
      "gemini-3.6-flash": {
        id: "gemini-3.6-flash",
        displayName: "Gemini 3.6 Flash",
        cost: { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0 },
      },
      "gemini-3.7-flash": {
        id: "gemini-3.7-flash",
        displayName: "Gemini 3.7 Flash",
        cost: { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0 },
      },
      "gemini-3.8-flash": {
        id: "gemini-3.8-flash",
        displayName: "Gemini 3.8 Flash",
        cost: { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0 },
      },
      "gemini-4-argon": {
        id: "gemini-4-argon",
        displayName: "Gemini 4 Argon",
        cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 0 },
      },
      "gemini-flash-latest": {
        id: "gemini-flash-latest",
        displayName: "Gemini Flash Latest",
        cost: { input: 1.5, output: 9, cacheRead: 0.15, cacheWrite: 0 },
      },
      "gemini-flash-lite-latest": {
        id: "gemini-flash-lite-latest",
        displayName: "Gemini Flash-Lite Latest",
        cost: { input: 0.25, output: 1.5, cacheRead: 0.025, cacheWrite: 0 },
      },
      "gemma-4-26b-a4b-it": {
        id: "gemma-4-26b-a4b-it",
        displayName: "Gemma 4 26B A4B IT",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "gemma-4-31b-it": {
        id: "gemma-4-31b-it",
        displayName: "Gemma 4 31B IT",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
    },
  },
  {
    id: "groq",
    displayName: "Groq",
    providerType: "openai-compatible",
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    models: {
      "llama-3.1-8b-instant": {
        id: "llama-3.1-8b-instant",
        displayName: "Llama 3.1 8B",
        cost: { input: 0.05, output: 0.08, cacheRead: 0, cacheWrite: 0 },
      },
      "llama-3.3-70b-versatile": {
        id: "llama-3.3-70b-versatile",
        displayName: "Llama 3.3 70B",
        cost: { input: 0.59, output: 0.79, cacheRead: 0, cacheWrite: 0 },
      },
      "openai/gpt-oss-120b": {
        id: "openai/gpt-oss-120b",
        displayName: "GPT OSS 120B",
        cost: { input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite: 0 },
      },
      "openai/gpt-oss-20b": {
        id: "openai/gpt-oss-20b",
        displayName: "GPT OSS 20B",
        cost: { input: 0.075, output: 0.3, cacheRead: 0.0375, cacheWrite: 0 },
      },
      "openai/gpt-oss-safeguard-20b": {
        id: "openai/gpt-oss-safeguard-20b",
        displayName: "Safety GPT OSS 20B",
        cost: { input: 0.075, output: 0.3, cacheRead: 0, cacheWrite: 0 },
      },
      "qwen/qwen3.6-27b": {
        id: "qwen/qwen3.6-27b",
        displayName: "Qwen3.6 27B",
        cost: { input: 0.6, output: 3, cacheRead: 0.3, cacheWrite: 0 },
      },
      "qwen/qwen3.8-27b": {
        id: "qwen/qwen3.8-27b",
        displayName: "Qwen3.8 27B",
        cost: { input: 0.8, output: 4, cacheRead: 0, cacheWrite: 0 },
      },
    },
  },
  {
    id: "huggingface",
    displayName: "Hugging Face",
    providerType: "openai-compatible",
    defaultBaseUrl: "https://router.huggingface.co/v1",
    models: {
      "deepseek-ai/DeepSeek-R1": {
        id: "deepseek-ai/DeepSeek-R1",
        displayName: "DeepSeek-R1",
        cost: { input: 0.7, output: 2.5, cacheRead: 0, cacheWrite: 0 },
      },
      "deepseek-ai/DeepSeek-R1-0528": {
        id: "deepseek-ai/DeepSeek-R1-0528",
        displayName: "DeepSeek-R1-0528",
        cost: { input: 3, output: 5, cacheRead: 0, cacheWrite: 0 },
      },
      "deepseek-ai/DeepSeek-V3": {
        id: "deepseek-ai/DeepSeek-V3",
        displayName: "DeepSeek-V3",
        cost: { input: 0.4, output: 1.3, cacheRead: 0, cacheWrite: 0 },
      },
      "deepseek-ai/DeepSeek-V3-0324": {
        id: "deepseek-ai/DeepSeek-V3-0324",
        displayName: "DeepSeek V3 0324",
        cost: { input: 0.27, output: 1.12, cacheRead: 0, cacheWrite: 0 },
      },
      "deepseek-ai/DeepSeek-V3.1": {
        id: "deepseek-ai/DeepSeek-V3.1",
        displayName: "DeepSeek-V3.1",
        cost: { input: 0.27, output: 1, cacheRead: 0, cacheWrite: 0 },
      },
      "deepseek-ai/DeepSeek-V3.2": {
        id: "deepseek-ai/DeepSeek-V3.2",
        displayName: "DeepSeek-V3.2",
        cost: { input: 0.28, output: 0.4, cacheRead: 0, cacheWrite: 0 },
      },
      "deepseek-ai/DeepSeek-V4-Flash": {
        id: "deepseek-ai/DeepSeek-V4-Flash",
        displayName: "DeepSeek V4 Flash",
        cost: { input: 0.14, output: 0.28, cacheRead: 0, cacheWrite: 0 },
      },
      "deepseek-ai/DeepSeek-V4-Flash-0731": {
        id: "deepseek-ai/DeepSeek-V4-Flash-0731",
        displayName: "DeepSeek V4 Flash 0731",
        cost: { input: 0.14, output: 0.28, cacheRead: 0, cacheWrite: 0 },
      },
      "deepseek-ai/DeepSeek-V4-Flash-Vision-Exp": {
        id: "deepseek-ai/DeepSeek-V4-Flash-Vision-Exp",
        displayName: "DeepSeek V4 Flash Vision Exp",
        cost: { input: 0.44, output: 1.32, cacheRead: 0, cacheWrite: 0 },
      },
      "deepseek-ai/DeepSeek-V4-Pro": {
        id: "deepseek-ai/DeepSeek-V4-Pro",
        displayName: "DeepSeek V4 Pro",
        cost: { input: 0.435, output: 0.87, cacheRead: 0.003625, cacheWrite: 0 },
      },
      "deepseek-ai/DeepSeek-V4-Pro-0813": {
        id: "deepseek-ai/DeepSeek-V4-Pro-0813",
        displayName: "DeepSeek V4 Pro 0813",
        cost: { input: 1.32, output: 3.96, cacheRead: 0, cacheWrite: 0 },
      },
      "deepseek-ai/DeepSeek-V4.1-Flash": {
        id: "deepseek-ai/DeepSeek-V4.1-Flash",
        displayName: "DeepSeek V4.1 Flash",
        cost: { input: 0.3, output: 1.2, cacheRead: 0, cacheWrite: 0 },
      },
      "google/gemma-3-12b-it": {
        id: "google/gemma-3-12b-it",
        displayName: "Gemma 3 12B IT",
        cost: { input: 0.05, output: 0.15, cacheRead: 0, cacheWrite: 0 },
      },
      "google/gemma-3-27b-it": {
        id: "google/gemma-3-27b-it",
        displayName: "Gemma 3 27B IT",
        cost: { input: 0.08, output: 0.16, cacheRead: 0, cacheWrite: 0 },
      },
      "google/gemma-3-4b-it": {
        id: "google/gemma-3-4b-it",
        displayName: "Gemma 3 4B IT",
        cost: { input: 0.05, output: 0.1, cacheRead: 0, cacheWrite: 0 },
      },
      "google/gemma-4-26B-A4B-it": {
        id: "google/gemma-4-26B-A4B-it",
        displayName: "Gemma 4 26B A4B IT",
        cost: { input: 0.13, output: 0.4, cacheRead: 0, cacheWrite: 0 },
      },
      "google/gemma-4-31B-it": {
        id: "google/gemma-4-31B-it",
        displayName: "Gemma 4 31B IT",
        cost: { input: 0.14, output: 0.4, cacheRead: 0, cacheWrite: 0 },
      },
      "meta-llama/Llama-3.1-8B-Instruct": {
        id: "meta-llama/Llama-3.1-8B-Instruct",
        displayName: "Llama-3.1-8B-Instruct",
        cost: { input: 0.06, output: 0.06, cacheRead: 0, cacheWrite: 0 },
      },
      "meta-llama/Llama-3.3-70B-Instruct": {
        id: "meta-llama/Llama-3.3-70B-Instruct",
        displayName: "Llama-3.3-70B-Instruct",
        cost: { input: 0.59, output: 0.79, cacheRead: 0, cacheWrite: 0 },
      },
      "MiniMaxAI/MiniMax-M1-80k": {
        id: "MiniMaxAI/MiniMax-M1-80k",
        displayName: "MiniMax M1 80K",
        cost: { input: 0.55, output: 2.2, cacheRead: 0, cacheWrite: 0 },
      },
      "MiniMaxAI/MiniMax-M2": {
        id: "MiniMaxAI/MiniMax-M2",
        displayName: "MiniMax-M2",
        cost: { input: 0.3, output: 1.2, cacheRead: 0, cacheWrite: 0 },
      },
      "MiniMaxAI/MiniMax-M2.1": {
        id: "MiniMaxAI/MiniMax-M2.1",
        displayName: "MiniMax-M2.1",
        cost: { input: 0.3, output: 1.2, cacheRead: 0, cacheWrite: 0 },
      },
      "MiniMaxAI/MiniMax-M2.5": {
        id: "MiniMaxAI/MiniMax-M2.5",
        displayName: "MiniMax-M2.5",
        cost: { input: 0.3, output: 1.2, cacheRead: 0.03, cacheWrite: 0 },
      },
      "MiniMaxAI/MiniMax-M2.7": {
        id: "MiniMaxAI/MiniMax-M2.7",
        displayName: "MiniMax-M2.7",
        cost: { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0 },
      },
      "MiniMaxAI/MiniMax-M3": {
        id: "MiniMaxAI/MiniMax-M3",
        displayName: "MiniMax-M3",
        cost: { input: 0.3, output: 1.2, cacheRead: 0, cacheWrite: 0 },
      },
      "moonshotai/Kimi-K2-Instruct": {
        id: "moonshotai/Kimi-K2-Instruct",
        displayName: "Kimi-K2-Instruct",
        cost: { input: 1, output: 3, cacheRead: 0, cacheWrite: 0 },
      },
      "moonshotai/Kimi-K2-Instruct-0905": {
        id: "moonshotai/Kimi-K2-Instruct-0905",
        displayName: "Kimi-K2-Instruct-0905",
        cost: { input: 1, output: 3, cacheRead: 0, cacheWrite: 0 },
      },
      "moonshotai/Kimi-K2-Thinking": {
        id: "moonshotai/Kimi-K2-Thinking",
        displayName: "Kimi-K2-Thinking",
        cost: { input: 0.6, output: 2.5, cacheRead: 0.15, cacheWrite: 0 },
      },
      "moonshotai/Kimi-K2.5": {
        id: "moonshotai/Kimi-K2.5",
        displayName: "Kimi-K2.5",
        cost: { input: 0.6, output: 3, cacheRead: 0.1, cacheWrite: 0 },
      },
      "moonshotai/Kimi-K2.6": {
        id: "moonshotai/Kimi-K2.6",
        displayName: "Kimi-K2.6",
        cost: { input: 0.95, output: 4, cacheRead: 0.16, cacheWrite: 0 },
      },
      "moonshotai/Kimi-K2.7-Code": {
        id: "moonshotai/Kimi-K2.7-Code",
        displayName: "Kimi K2.7 Code",
        cost: { input: 0.95, output: 4, cacheRead: 0, cacheWrite: 0 },
      },
      "moonshotai/Kimi-K3": {
        id: "moonshotai/Kimi-K3",
        displayName: "Kimi K3",
        cost: { input: 3, output: 15, cacheRead: 0, cacheWrite: 0 },
      },
      "openai/gpt-oss-120b": {
        id: "openai/gpt-oss-120b",
        displayName: "GPT OSS 120B",
        cost: { input: 0.25, output: 0.69, cacheRead: 0, cacheWrite: 0 },
      },
      "openai/gpt-oss-20b": {
        id: "openai/gpt-oss-20b",
        displayName: "GPT OSS 20B",
        cost: { input: 0.1, output: 0.5, cacheRead: 0, cacheWrite: 0 },
      },
      "Qwen/Qwen2.5-Coder-32B-Instruct": {
        id: "Qwen/Qwen2.5-Coder-32B-Instruct",
        displayName: "Qwen2.5-Coder-32B-Instruct",
        cost: { input: 0.06, output: 0.2, cacheRead: 0, cacheWrite: 0 },
      },
      "Qwen/Qwen3-235B-A22B": {
        id: "Qwen/Qwen3-235B-A22B",
        displayName: "Qwen3 235B-A22B",
        cost: { input: 0.2, output: 0.8, cacheRead: 0, cacheWrite: 0 },
      },
      "Qwen/Qwen3-235B-A22B-Instruct-2507": {
        id: "Qwen/Qwen3-235B-A22B-Instruct-2507",
        displayName: "Qwen3 235B-A22B Instruct 2507",
        cost: { input: 0.855, output: 2.565, cacheRead: 0, cacheWrite: 0 },
      },
      "Qwen/Qwen3-235B-A22B-Thinking-2507": {
        id: "Qwen/Qwen3-235B-A22B-Thinking-2507",
        displayName: "Qwen3-235B-A22B-Thinking-2507",
        cost: { input: 0.3, output: 3, cacheRead: 0, cacheWrite: 0 },
      },
      "Qwen/Qwen3-30B-A3B": {
        id: "Qwen/Qwen3-30B-A3B",
        displayName: "Qwen3 30B A3B",
        cost: { input: 0.12, output: 0.5, cacheRead: 0, cacheWrite: 0 },
      },
      "Qwen/Qwen3-32B": {
        id: "Qwen/Qwen3-32B",
        displayName: "Qwen3 32B",
        cost: { input: 0.29, output: 0.59, cacheRead: 0, cacheWrite: 0 },
      },
      "Qwen/Qwen3-Coder-30B-A3B-Instruct": {
        id: "Qwen/Qwen3-Coder-30B-A3B-Instruct",
        displayName: "Qwen3-Coder 30B-A3B Instruct",
        cost: { input: 0.07, output: 0.26, cacheRead: 0, cacheWrite: 0 },
      },
      "Qwen/Qwen3-Coder-480B-A35B-Instruct": {
        id: "Qwen/Qwen3-Coder-480B-A35B-Instruct",
        displayName: "Qwen3-Coder-480B-A35B-Instruct",
        cost: { input: 2, output: 2, cacheRead: 0, cacheWrite: 0 },
      },
      "Qwen/Qwen3-Coder-Next": {
        id: "Qwen/Qwen3-Coder-Next",
        displayName: "Qwen3-Coder-Next",
        cost: { input: 0.2, output: 1.5, cacheRead: 0, cacheWrite: 0 },
      },
      "Qwen/Qwen3-Next-80B-A3B-Instruct": {
        id: "Qwen/Qwen3-Next-80B-A3B-Instruct",
        displayName: "Qwen3-Next-80B-A3B-Instruct",
        cost: { input: 0.25, output: 1, cacheRead: 0, cacheWrite: 0 },
      },
      "Qwen/Qwen3-Next-80B-A3B-Thinking": {
        id: "Qwen/Qwen3-Next-80B-A3B-Thinking",
        displayName: "Qwen3-Next-80B-A3B-Thinking",
        cost: { input: 0.3, output: 2, cacheRead: 0, cacheWrite: 0 },
      },
      "Qwen/Qwen3-VL-235B-A22B-Instruct": {
        id: "Qwen/Qwen3-VL-235B-A22B-Instruct",
        displayName: "Qwen3 VL 235B A22B Instruct",
        cost: { input: 0.3, output: 1.5, cacheRead: 0, cacheWrite: 0 },
      },
      "Qwen/Qwen3-VL-235B-A22B-Thinking": {
        id: "Qwen/Qwen3-VL-235B-A22B-Thinking",
        displayName: "Qwen3 VL 235B A22B Thinking",
        cost: { input: 0.98, output: 3.95, cacheRead: 0, cacheWrite: 0 },
      },
      "Qwen/Qwen3-VL-30B-A3B-Instruct": {
        id: "Qwen/Qwen3-VL-30B-A3B-Instruct",
        displayName: "Qwen3 VL 30B A3B Instruct",
        cost: { input: 0.2, output: 0.7, cacheRead: 0, cacheWrite: 0 },
      },
      "Qwen/Qwen3.5-122B-A10B": {
        id: "Qwen/Qwen3.5-122B-A10B",
        displayName: "Qwen3.5 122B-A10B",
        cost: { input: 0.4, output: 3.2, cacheRead: 0, cacheWrite: 0 },
      },
      "Qwen/Qwen3.5-27B": {
        id: "Qwen/Qwen3.5-27B",
        displayName: "Qwen3.5 27B",
        cost: { input: 0.3, output: 2.4, cacheRead: 0, cacheWrite: 0 },
      },
      "Qwen/Qwen3.5-35B-A3B": {
        id: "Qwen/Qwen3.5-35B-A3B",
        displayName: "Qwen3.5 35B-A3B",
        cost: { input: 0.25, output: 2, cacheRead: 0, cacheWrite: 0 },
      },
      "Qwen/Qwen3.5-397B-A17B": {
        id: "Qwen/Qwen3.5-397B-A17B",
        displayName: "Qwen3.5-397B-A17B",
        cost: { input: 0.6, output: 3.6, cacheRead: 0, cacheWrite: 0 },
      },
      "Qwen/Qwen3.5-9B": {
        id: "Qwen/Qwen3.5-9B",
        displayName: "Qwen3.5 9B",
        cost: { input: 0.17, output: 0.25, cacheRead: 0, cacheWrite: 0 },
      },
      "Qwen/Qwen3.6-27B": {
        id: "Qwen/Qwen3.6-27B",
        displayName: "Qwen3.6 27B",
        cost: { input: 0.47, output: 3.19, cacheRead: 0, cacheWrite: 0 },
      },
      "Qwen/Qwen3.6-35B-A3B": {
        id: "Qwen/Qwen3.6-35B-A3B",
        displayName: "Qwen3.6 35B-A3B",
        cost: { input: 0.15, output: 0.95, cacheRead: 0, cacheWrite: 0 },
      },
      "Qwen/Qwen3.8-2.4T-A95B": {
        id: "Qwen/Qwen3.8-2.4T-A95B",
        displayName: "Qwen3.8 2.4T A95B",
        cost: { input: 2.5, output: 6.25, cacheRead: 0, cacheWrite: 0 },
      },
      "Qwen/Qwen3.8-27B": {
        id: "Qwen/Qwen3.8-27B",
        displayName: "Qwen3.8 27B",
        cost: { input: 0.4, output: 3, cacheRead: 0, cacheWrite: 0 },
      },
      "stepfun-ai/Step-3.5-Flash": {
        id: "stepfun-ai/Step-3.5-Flash",
        displayName: "Step 3.5 Flash",
        cost: { input: 0.1, output: 0.3, cacheRead: 0, cacheWrite: 0 },
      },
      "stepfun-ai/Step-3.7-Flash": {
        id: "stepfun-ai/Step-3.7-Flash",
        displayName: "Step 3.7 Flash",
        cost: { input: 0.2, output: 1.15, cacheRead: 0, cacheWrite: 0 },
      },
      "tencent/Hy3": {
        id: "tencent/Hy3",
        displayName: "Hy3",
        cost: { input: 0.14, output: 0.58, cacheRead: 0, cacheWrite: 0 },
      },
      "tencent/Hy4-preview": {
        id: "tencent/Hy4-preview",
        displayName: "Hy4 preview",
        cost: { input: 0.834, output: 2.501, cacheRead: 0, cacheWrite: 0 },
      },
      "thinkingmachines/Inkling": {
        id: "thinkingmachines/Inkling",
        displayName: "Inkling",
        cost: { input: 1, output: 4.05, cacheRead: 0, cacheWrite: 0 },
      },
      "thinkingmachines/Inkling-Small": {
        id: "thinkingmachines/Inkling-Small",
        displayName: "Inkling Small",
        cost: { input: 0.5, output: 1.2, cacheRead: 0, cacheWrite: 0 },
      },
      "XiaomiMiMo/MiMo-V2-Flash": {
        id: "XiaomiMiMo/MiMo-V2-Flash",
        displayName: "MiMo-V2-Flash",
        cost: { input: 0.1, output: 0.3, cacheRead: 0, cacheWrite: 0 },
      },
      "XiaomiMiMo/MiMo-V2.5": {
        id: "XiaomiMiMo/MiMo-V2.5",
        displayName: "MiMo-V2.5",
        cost: { input: 0.4, output: 2, cacheRead: 0, cacheWrite: 0 },
      },
      "XiaomiMiMo/MiMo-V2.5-Pro": {
        id: "XiaomiMiMo/MiMo-V2.5-Pro",
        displayName: "MiMo-V2.5-Pro",
        cost: { input: 1, output: 3, cacheRead: 0, cacheWrite: 0 },
      },
      "zai-org/GLM-4.5": {
        id: "zai-org/GLM-4.5",
        displayName: "GLM-4.5",
        cost: { input: 0.6, output: 2.2, cacheRead: 0, cacheWrite: 0 },
      },
      "zai-org/GLM-4.5-Air": {
        id: "zai-org/GLM-4.5-Air",
        displayName: "GLM-4.5-Air",
        cost: { input: 0.13, output: 0.85, cacheRead: 0, cacheWrite: 0 },
      },
      "zai-org/GLM-4.5V": {
        id: "zai-org/GLM-4.5V",
        displayName: "GLM-4.5V",
        cost: { input: 0.6, output: 1.8, cacheRead: 0, cacheWrite: 0 },
      },
      "zai-org/GLM-4.6": {
        id: "zai-org/GLM-4.6",
        displayName: "GLM-4.6",
        cost: { input: 0.55, output: 2.2, cacheRead: 0, cacheWrite: 0 },
      },
      "zai-org/GLM-4.6V-Flash": {
        id: "zai-org/GLM-4.6V-Flash",
        displayName: "GLM-4.6V-Flash",
        cost: { input: 0.3, output: 0.9, cacheRead: 0, cacheWrite: 0 },
      },
      "zai-org/GLM-4.7": {
        id: "zai-org/GLM-4.7",
        displayName: "GLM-4.7",
        cost: { input: 0.6, output: 2.2, cacheRead: 0.11, cacheWrite: 0 },
      },
      "zai-org/GLM-4.7-Flash": {
        id: "zai-org/GLM-4.7-Flash",
        displayName: "GLM-4.7-Flash",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "zai-org/GLM-5": {
        id: "zai-org/GLM-5",
        displayName: "GLM-5",
        cost: { input: 1, output: 3.2, cacheRead: 0.2, cacheWrite: 0 },
      },
      "zai-org/GLM-5.1": {
        id: "zai-org/GLM-5.1",
        displayName: "GLM-5.1",
        cost: { input: 1, output: 3.2, cacheRead: 0.2, cacheWrite: 0 },
      },
      "zai-org/GLM-5.2": {
        id: "zai-org/GLM-5.2",
        displayName: "GLM-5.2",
        cost: { input: 1.4, output: 4.4, cacheRead: 0, cacheWrite: 0 },
      },
      "zai-org/GLM-5.3": {
        id: "zai-org/GLM-5.3",
        displayName: "GLM-5.3",
        cost: { input: 1.4, output: 4.4, cacheRead: 0, cacheWrite: 0 },
      },
      "zai-org/GLM-5.3-Flash": {
        id: "zai-org/GLM-5.3-Flash",
        displayName: "GLM-5.3-Flash",
        cost: { input: 0.15, output: 0.5, cacheRead: 0, cacheWrite: 0 },
      },
    },
  },
  {
    id: "kimi-coding",
    displayName: "Kimi For Coding",
    providerType: "openai-compatible",
    defaultBaseUrl: "https://api.kimi.com/coding/v1",
    models: {
      k3: {
        id: "k3",
        displayName: "Kimi K3",
        cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 0 },
      },
      "k3-256k": {
        id: "k3-256k",
        displayName: "Kimi K3-256K",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "kimi-for-coding": {
        id: "kimi-for-coding",
        displayName: "kimi-for-coding",
        cost: { input: 0.95, output: 4, cacheRead: 0.19, cacheWrite: 0 },
      },
      "kimi-for-coding-highspeed": {
        id: "kimi-for-coding-highspeed",
        displayName: "Kimi For Coding HighSpeed",
        cost: { input: 1.9, output: 8, cacheRead: 0.38, cacheWrite: 0 },
      },
    },
  },
  {
    id: "meta",
    displayName: "Meta",
    providerType: "openai-compatible",
    defaultBaseUrl: "https://api.meta.ai/v1",
    useResponsesApi: true,
    models: {
      "muse-spark-1.1": {
        id: "muse-spark-1.1",
        displayName: "Muse Spark 1.1",
        cost: { input: 1.25, output: 4.25, cacheRead: 0.15, cacheWrite: 0 },
      },
      "muse-spark-1.2": {
        id: "muse-spark-1.2",
        displayName: "Muse Spark 1.2",
        cost: { input: 1.25, output: 4.25, cacheRead: 0.15, cacheWrite: 0 },
      },
      "muse-spark-1.2-contributor": {
        id: "muse-spark-1.2-contributor",
        displayName: "Muse Spark 1.2 Contributor",
        cost: { input: 0.1, output: 0.2, cacheRead: 0.002, cacheWrite: 0 },
      },
      "muse-spark-1.3": {
        id: "muse-spark-1.3",
        displayName: "Muse Spark 1.3",
        cost: { input: 1.25, output: 4.25, cacheRead: 0.15, cacheWrite: 0 },
      },
      "muse-spark-1.3-contributor": {
        id: "muse-spark-1.3-contributor",
        displayName: "Muse Spark 1.3 Contributor",
        cost: { input: 0.1, output: 0.2, cacheRead: 0.002, cacheWrite: 0 },
      },
      "muse-wonder-1.0": {
        id: "muse-wonder-1.0",
        displayName: "Muse Wonder",
        cost: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 0 },
      },
    },
  },
  {
    id: "minimax",
    displayName: "MiniMax",
    providerType: "anthropic",
    defaultBaseUrl: "https://api.minimax.io/anthropic",
    models: {
      "MiniMax-M2.7": {
        id: "MiniMax-M2.7",
        displayName: "MiniMax-M2.7",
        cost: { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0.375 },
      },
      "MiniMax-M2.7-highspeed": {
        id: "MiniMax-M2.7-highspeed",
        displayName: "MiniMax-M2.7-highspeed",
        cost: { input: 0.6, output: 2.4, cacheRead: 0.06, cacheWrite: 0.375 },
      },
      "MiniMax-M3": {
        id: "MiniMax-M3",
        displayName: "MiniMax-M3",
        cost: { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0 },
      },
    },
  },
  {
    id: "minimax-cn",
    displayName: "MiniMax CN",
    providerType: "anthropic",
    defaultBaseUrl: "https://api.minimaxi.com/anthropic",
    models: {
      "MiniMax-M2.7": {
        id: "MiniMax-M2.7",
        displayName: "MiniMax-M2.7",
        cost: { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0.375 },
      },
      "MiniMax-M2.7-highspeed": {
        id: "MiniMax-M2.7-highspeed",
        displayName: "MiniMax-M2.7-highspeed",
        cost: { input: 0.6, output: 2.4, cacheRead: 0.06, cacheWrite: 0.375 },
      },
      "MiniMax-M3": {
        id: "MiniMax-M3",
        displayName: "MiniMax-M3",
        cost: { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0 },
      },
    },
  },
  {
    id: "moonshotai",
    displayName: "Moonshot AI",
    providerType: "openai-compatible",
    defaultBaseUrl: "https://api.moonshot.ai/v1",
    models: {
      "kimi-k2.6": {
        id: "kimi-k2.6",
        displayName: "Kimi K2.6",
        cost: { input: 0.95, output: 4, cacheRead: 0.16, cacheWrite: 0 },
      },
      "kimi-k2.7-code": {
        id: "kimi-k2.7-code",
        displayName: "Kimi K2.7 Code",
        cost: { input: 0.95, output: 4, cacheRead: 0.19, cacheWrite: 0 },
      },
      "kimi-k2.7-code-highspeed": {
        id: "kimi-k2.7-code-highspeed",
        displayName: "Kimi K2.7 Code HighSpeed",
        cost: { input: 1.9, output: 8, cacheRead: 0.38, cacheWrite: 0 },
      },
      "kimi-k3": {
        id: "kimi-k3",
        displayName: "Kimi K3",
        cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 0 },
      },
    },
  },
  {
    id: "moonshotai-cn",
    displayName: "Moonshot AI CN",
    providerType: "openai-compatible",
    defaultBaseUrl: "https://api.moonshot.cn/v1",
    models: {
      "kimi-k2.6": {
        id: "kimi-k2.6",
        displayName: "Kimi K2.6",
        cost: { input: 0.95, output: 4, cacheRead: 0.16, cacheWrite: 0 },
      },
      "kimi-k2.7-code": {
        id: "kimi-k2.7-code",
        displayName: "Kimi K2.7 Code",
        cost: { input: 0.95, output: 4, cacheRead: 0.19, cacheWrite: 0 },
      },
      "kimi-k2.7-code-highspeed": {
        id: "kimi-k2.7-code-highspeed",
        displayName: "Kimi K2.7 Code HighSpeed",
        cost: { input: 1.9, output: 8, cacheRead: 0.38, cacheWrite: 0 },
      },
      "kimi-k3": {
        id: "kimi-k3",
        displayName: "Kimi K3",
        cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 0 },
      },
    },
  },
  {
    id: "nvidia",
    displayName: "NVIDIA",
    providerType: "openai-compatible",
    defaultBaseUrl: "https://integrate.api.nvidia.com/v1",
    models: {
      "deepseek-ai/deepseek-v4.1-flash": {
        id: "deepseek-ai/deepseek-v4.1-flash",
        displayName: "DeepSeek V4.1 Flash",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "google/diffusiongemma-26b-a4b-it": {
        id: "google/diffusiongemma-26b-a4b-it",
        displayName: "DiffusionGemma 26B A4B IT",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "google/gemma-3-12b-it": {
        id: "google/gemma-3-12b-it",
        displayName: "Gemma 3 12B IT",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "google/gemma-3-4b-it": {
        id: "google/gemma-3-4b-it",
        displayName: "Gemma 3 4B IT",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "meta/llama-3.2-11b-vision-instruct": {
        id: "meta/llama-3.2-11b-vision-instruct",
        displayName: "Llama 3.2 11b Vision Instruct",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "meta/llama-3.2-90b-vision-instruct": {
        id: "meta/llama-3.2-90b-vision-instruct",
        displayName: "Llama-3.2-90B-Vision-Instruct",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "meta/muse-glimmer-30b": {
        id: "meta/muse-glimmer-30b",
        displayName: "Muse Glimmer 30B",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "mistralai/mistral-7b-instruct-v0.3": {
        id: "mistralai/mistral-7b-instruct-v0.3",
        displayName: "Mistral-7B-Instruct-v0.3",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "moonshotai/kimi-k2.6": {
        id: "moonshotai/kimi-k2.6",
        displayName: "Kimi K2.6",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "nvidia/cosmos-reason2-8b": {
        id: "nvidia/cosmos-reason2-8b",
        displayName: "Cosmos Reason2 8B",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "nvidia/llama-3.1-nemotron-70b-instruct": {
        id: "nvidia/llama-3.1-nemotron-70b-instruct",
        displayName: "Llama 3.1 Nemotron 70B Instruct",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "nvidia/llama-3.1-nemotron-ultra-253b-v1": {
        id: "nvidia/llama-3.1-nemotron-ultra-253b-v1",
        displayName: "Llama 3.1 Nemotron Ultra 253B",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning": {
        id: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
        displayName: "Nemotron 3 Nano Omni",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "nvidia/nemotron-3-ultra-550b-a55b": {
        id: "nvidia/nemotron-3-ultra-550b-a55b",
        displayName: "Nemotron 3 Ultra 550B A55B",
        cost: { input: 0.5, output: 2.5, cacheRead: 0.15, cacheWrite: 0 },
      },
      "nvidia/nemotron-3.5-lightning-30b-a3b": {
        id: "nvidia/nemotron-3.5-lightning-30b-a3b",
        displayName: "Nemotron 3.5 Lightning 30B A3B",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "nvidia/nemotron-3.5-super-vl-120b-a12b": {
        id: "nvidia/nemotron-3.5-super-vl-120b-a12b",
        displayName: "Nemotron 3.5 Super VL 120B A12B",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "openai/gpt-oss-20b": {
        id: "openai/gpt-oss-20b",
        displayName: "GPT OSS 20B",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "poolside/laguna-xs-2.1": {
        id: "poolside/laguna-xs-2.1",
        displayName: "Laguna XS 2.1",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "z-ai/glm-5.3": {
        id: "z-ai/glm-5.3",
        displayName: "GLM-5.3",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "z-ai/glm-5.3-flash": {
        id: "z-ai/glm-5.3-flash",
        displayName: "GLM-5.3-Flash",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
    },
  },
  {
    id: "openai",
    displayName: "OpenAI",
    providerType: "openai-compatible",
    defaultBaseUrl: "https://api.openai.com/v1",
    useResponsesApi: true,
    models: {
      "gpt-4": {
        id: "gpt-4",
        displayName: "GPT-4",
        cost: { input: 30, output: 60, cacheRead: 0, cacheWrite: 0 },
      },
      "gpt-4-turbo": {
        id: "gpt-4-turbo",
        displayName: "GPT-4 Turbo",
        cost: { input: 10, output: 30, cacheRead: 0, cacheWrite: 0 },
      },
      "gpt-4.1": {
        id: "gpt-4.1",
        displayName: "GPT-4.1",
        cost: { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 0 },
      },
      "gpt-4.1-mini": {
        id: "gpt-4.1-mini",
        displayName: "GPT-4.1 mini",
        cost: { input: 0.4, output: 1.6, cacheRead: 0.1, cacheWrite: 0 },
      },
      "gpt-4.1-nano": {
        id: "gpt-4.1-nano",
        displayName: "GPT-4.1 nano",
        cost: { input: 0.1, output: 0.4, cacheRead: 0.025, cacheWrite: 0 },
      },
      "gpt-4o": {
        id: "gpt-4o",
        displayName: "GPT-4o",
        cost: { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 0 },
      },
      "gpt-4o-2024-05-13": {
        id: "gpt-4o-2024-05-13",
        displayName: "GPT-4o (2024-05-13)",
        cost: { input: 5, output: 15, cacheRead: 0, cacheWrite: 0 },
      },
      "gpt-4o-2024-08-06": {
        id: "gpt-4o-2024-08-06",
        displayName: "GPT-4o (2024-08-06)",
        cost: { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 0 },
      },
      "gpt-4o-2024-11-20": {
        id: "gpt-4o-2024-11-20",
        displayName: "GPT-4o (2024-11-20)",
        cost: { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 0 },
      },
      "gpt-4o-mini": {
        id: "gpt-4o-mini",
        displayName: "GPT-4o mini",
        cost: { input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite: 0 },
      },
      "gpt-5": {
        id: "gpt-5",
        displayName: "GPT-5",
        cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
      },
      "gpt-5-chat-latest": {
        id: "gpt-5-chat-latest",
        displayName: "GPT-5 Chat Latest",
        cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
      },
      "gpt-5-mini": {
        id: "gpt-5-mini",
        displayName: "GPT-5 Mini",
        cost: { input: 0.25, output: 2, cacheRead: 0.025, cacheWrite: 0 },
      },
      "gpt-5-nano": {
        id: "gpt-5-nano",
        displayName: "GPT-5 Nano",
        cost: { input: 0.05, output: 0.4, cacheRead: 0.005, cacheWrite: 0 },
      },
      "gpt-5-pro": {
        id: "gpt-5-pro",
        displayName: "GPT-5 Pro",
        cost: { input: 15, output: 120, cacheRead: 0, cacheWrite: 0 },
      },
      "gpt-5.1": {
        id: "gpt-5.1",
        displayName: "GPT-5.1",
        cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
      },
      "gpt-5.2": {
        id: "gpt-5.2",
        displayName: "GPT-5.2",
        cost: { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 },
      },
      "gpt-5.2-chat-latest": {
        id: "gpt-5.2-chat-latest",
        displayName: "GPT-5.2 Chat",
        cost: { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 },
      },
      "gpt-5.2-pro": {
        id: "gpt-5.2-pro",
        displayName: "GPT-5.2 Pro",
        cost: { input: 21, output: 168, cacheRead: 0, cacheWrite: 0 },
      },
      "gpt-5.3-chat-latest": {
        id: "gpt-5.3-chat-latest",
        displayName: "GPT-5.3 Chat (latest)",
        cost: { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 },
      },
      "gpt-5.3-codex": {
        id: "gpt-5.3-codex",
        displayName: "GPT-5.3 Codex",
        cost: { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 },
      },
      "gpt-5.3-codex-spark": {
        id: "gpt-5.3-codex-spark",
        displayName: "GPT-5.3 Codex Spark",
        cost: { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 },
      },
      "gpt-5.4": {
        id: "gpt-5.4",
        displayName: "GPT-5.4",
        cost: { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 0 },
      },
      "gpt-5.4-mini": {
        id: "gpt-5.4-mini",
        displayName: "GPT-5.4 mini",
        cost: { input: 0.75, output: 4.5, cacheRead: 0.075, cacheWrite: 0 },
      },
      "gpt-5.4-nano": {
        id: "gpt-5.4-nano",
        displayName: "GPT-5.4 nano",
        cost: { input: 0.2, output: 1.25, cacheRead: 0.02, cacheWrite: 0 },
      },
      "gpt-5.4-pro": {
        id: "gpt-5.4-pro",
        displayName: "GPT-5.4 Pro",
        cost: { input: 30, output: 180, cacheRead: 0, cacheWrite: 0 },
      },
      "gpt-5.5": {
        id: "gpt-5.5",
        displayName: "GPT-5.5",
        cost: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 },
      },
      "gpt-5.5-pro": {
        id: "gpt-5.5-pro",
        displayName: "GPT-5.5 Pro",
        cost: { input: 30, output: 180, cacheRead: 0, cacheWrite: 0 },
      },
      "gpt-5.6-luna": {
        id: "gpt-5.6-luna",
        displayName: "GPT-5.6 Luna",
        cost: { input: 0.2, output: 1.2, cacheRead: 0.02, cacheWrite: 0.25 },
      },
      "gpt-5.6-sol": {
        id: "gpt-5.6-sol",
        displayName: "GPT-5.6 Sol",
        cost: { input: 4, output: 20, cacheRead: 0.4, cacheWrite: 5 },
      },
      "gpt-5.6-terra": {
        id: "gpt-5.6-terra",
        displayName: "GPT-5.6 Terra",
        cost: { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 2.5 },
      },
      "gpt-6-astra": {
        id: "gpt-6-astra",
        displayName: "GPT-6 Astra",
        cost: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
      },
      "gpt-6-luna": {
        id: "gpt-6-luna",
        displayName: "GPT-6 Luna",
        cost: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
      },
      "gpt-6-sol": {
        id: "gpt-6-sol",
        displayName: "GPT-6 Sol",
        cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
      },
      "gpt-6.1-sol": {
        id: "gpt-6.1-sol",
        displayName: "GPT-6.1 Sol",
        cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
      },
      "gpt-daybreak-blue-latest": {
        id: "gpt-daybreak-blue-latest",
        displayName: "Daybreak Blue",
        cost: { input: 4, output: 20, cacheRead: 0.4, cacheWrite: 5 },
      },
      "gpt-daybreak-red-latest": {
        id: "gpt-daybreak-red-latest",
        displayName: "Daybreak Red",
        cost: { input: 12.5, output: 75, cacheRead: 1.25, cacheWrite: 15.625 },
      },
      "gpt-realtime-2.1": {
        id: "gpt-realtime-2.1",
        displayName: "GPT-Realtime-2.1",
        cost: { input: 4, output: 24, cacheRead: 0.4, cacheWrite: 0 },
      },
      o1: {
        id: "o1",
        displayName: "o1",
        cost: { input: 15, output: 60, cacheRead: 7.5, cacheWrite: 0 },
      },
      "o1-pro": {
        id: "o1-pro",
        displayName: "o1-pro",
        cost: { input: 150, output: 600, cacheRead: 0, cacheWrite: 0 },
      },
      o3: {
        id: "o3",
        displayName: "o3",
        cost: { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 0 },
      },
      "o3-mini": {
        id: "o3-mini",
        displayName: "o3-mini",
        cost: { input: 1.1, output: 4.4, cacheRead: 0.55, cacheWrite: 0 },
      },
      "o3-pro": {
        id: "o3-pro",
        displayName: "o3-pro",
        cost: { input: 20, output: 80, cacheRead: 0, cacheWrite: 0 },
      },
      "o4-mini": {
        id: "o4-mini",
        displayName: "o4-mini",
        cost: { input: 1.1, output: 4.4, cacheRead: 0.275, cacheWrite: 0 },
      },
    },
  },
  {
    id: "opencode-go",
    displayName: "OpenCode Go",
    providerType: "openai-compatible",
    defaultBaseUrl: "https://opencode.ai/inference/go/v1",
    models: {
      "claude-haiku-5-5": {
        id: "claude-haiku-5-5",
        displayName: "Claude Haiku 5.5",
        cost: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
      },
      "minimax-m3": {
        id: "minimax-m3",
        displayName: "MiniMax-M3",
        cost: { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0 },
      },
      "qwen3.7-plus": {
        id: "qwen3.7-plus",
        displayName: "Qwen3.7 Plus",
        cost: { input: 0.4, output: 1.6, cacheRead: 0.04, cacheWrite: 0.5 },
      },
      "qwen3.8-flash": {
        id: "qwen3.8-flash",
        displayName: "Qwen3.8 Flash",
        cost: { input: 0.15, output: 0.47, cacheRead: 0.016, cacheWrite: 0.2 },
      },
      "qwen3.8-max": {
        id: "qwen3.8-max",
        displayName: "Qwen3.8 Max",
        cost: { input: 2, output: 6, cacheRead: 0.25, cacheWrite: 2.5 },
      },
      "gemini-4-argon-contributor": {
        id: "gemini-4-argon-contributor",
        displayName: "Gemini 4 Argon Contributor",
        cost: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 0 },
      },
      "cat-jam-free": {
        id: "cat-jam-free",
        displayName: "Cat Jam Free",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "deepseek-v4-pro": {
        id: "deepseek-v4-pro",
        displayName: "DeepSeek V4 Pro (New)",
        cost: { input: 0.66, output: 1.98, cacheRead: 0.022, cacheWrite: 0 },
      },
      "deepseek-v4.1-flash": {
        id: "deepseek-v4.1-flash",
        displayName: "DeepSeek V4.1 Flash",
        cost: { input: 0.15, output: 0.6, cacheRead: 0.003, cacheWrite: 0 },
      },
      "glm-5.2": {
        id: "glm-5.2",
        displayName: "GLM-5.2",
        cost: { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 },
      },
      "glm-5.3": {
        id: "glm-5.3",
        displayName: "GLM-5.3",
        cost: { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 },
      },
      "glm-5.3-flash": {
        id: "glm-5.3-flash",
        displayName: "GLM-5.3-Flash",
        cost: { input: 0.15, output: 0.5, cacheRead: 0.03, cacheWrite: 0 },
      },
      hy3: {
        id: "hy3",
        displayName: "Hy3",
        cost: { input: 0.14, output: 0.58, cacheRead: 0.035, cacheWrite: 0 },
      },
      "hy4-preview": {
        id: "hy4-preview",
        displayName: "Hy4 preview",
        cost: { input: 0.834, output: 2.501, cacheRead: 0.042, cacheWrite: 0 },
      },
      "kimi-k2.7-code": {
        id: "kimi-k2.7-code",
        displayName: "Kimi K2.7 Code",
        cost: { input: 0.95, output: 4, cacheRead: 0.19, cacheWrite: 0 },
      },
      "kimi-k3": {
        id: "kimi-k3",
        displayName: "Kimi K3",
        cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 0 },
      },
      "longcat-2.0": {
        id: "longcat-2.0",
        displayName: "LongCat-2.0",
        cost: { input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0 },
      },
      "longcat-2.5-preview-free": {
        id: "longcat-2.5-preview-free",
        displayName: "LongCat 2.5 Preview Free",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "mimo-v2.5": {
        id: "mimo-v2.5",
        displayName: "MiMo V2.5",
        cost: { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0 },
      },
      "mimo-v2.5-pro": {
        id: "mimo-v2.5-pro",
        displayName: "MiMo V2.5 Pro",
        cost: { input: 0.435, output: 0.87, cacheRead: 0.003625, cacheWrite: 0 },
      },
      "mimo-v2.6-flash": {
        id: "mimo-v2.6-flash",
        displayName: "MiMo-V2.6-Flash",
        cost: { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0 },
      },
      "mimo-v2.6-pro": {
        id: "mimo-v2.6-pro",
        displayName: "MiMo-V2.6-Pro",
        cost: { input: 0.435, output: 0.87, cacheRead: 0.003625, cacheWrite: 0 },
      },
      "space-bunny": {
        id: "space-bunny",
        displayName: "Space Bunny",
        cost: { input: 0.15, output: 0.6, cacheRead: 0.03, cacheWrite: 0 },
      },
      "step-5-preview-free": {
        id: "step-5-preview-free",
        displayName: "Step 5 Preview Free",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "gpt-5.6-luna": {
        id: "gpt-5.6-luna",
        displayName: "GPT-5.6 Luna",
        cost: { input: 0.2, output: 1.2, cacheRead: 0.02, cacheWrite: 0.25 },
      },
      "gpt-6-luna": {
        id: "gpt-6-luna",
        displayName: "GPT-6 Luna",
        cost: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
      },
      "grok-4.7": {
        id: "grok-4.7",
        displayName: "Grok 4.7",
        cost: { input: 2, output: 6, cacheRead: 0.5, cacheWrite: 0 },
      },
      "muse-spark-1.2-contributor": {
        id: "muse-spark-1.2-contributor",
        displayName: "Muse Spark 1.2 Contributor",
        cost: { input: 0.1, output: 0.2, cacheRead: 0.002, cacheWrite: 0 },
      },
      "muse-spark-1.3-contributor": {
        id: "muse-spark-1.3-contributor",
        displayName: "Muse Spark 1.3 Contributor",
        cost: { input: 0.1, output: 0.2, cacheRead: 0.002, cacheWrite: 0 },
      },
    },
  },
  {
    id: "opencode",
    displayName: "OpenCode Zen",
    providerType: "openai-compatible",
    defaultBaseUrl: "https://opencode.ai/inference/v1",
    models: {
      "claude-fable-5": {
        id: "claude-fable-5",
        displayName: "Claude Fable 5",
        cost: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
      },
      "claude-fable-5-1": {
        id: "claude-fable-5-1",
        displayName: "Claude Fable 5.1",
        cost: { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
      },
      "claude-haiku-4-5": {
        id: "claude-haiku-4-5",
        displayName: "Claude Haiku 4.5",
        cost: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
      },
      "claude-haiku-5-5": {
        id: "claude-haiku-5-5",
        displayName: "Claude Haiku 5.5",
        cost: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
      },
      "claude-opus-4-5": {
        id: "claude-opus-4-5",
        displayName: "Claude Opus 4.5",
        cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
      },
      "claude-opus-4-6": {
        id: "claude-opus-4-6",
        displayName: "Claude Opus 4.6",
        cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
      },
      "claude-opus-4-7": {
        id: "claude-opus-4-7",
        displayName: "Claude Opus 4.7",
        cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
      },
      "claude-opus-4-8": {
        id: "claude-opus-4-8",
        displayName: "Claude Opus 4.8",
        cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
      },
      "claude-opus-5": {
        id: "claude-opus-5",
        displayName: "Claude Opus 5",
        cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
      },
      "claude-opus-5-5": {
        id: "claude-opus-5-5",
        displayName: "Claude Opus 5.5",
        cost: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
      },
      "claude-sonnet-4": {
        id: "claude-sonnet-4",
        displayName: "Claude Sonnet 4",
        cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
      },
      "claude-sonnet-4-5": {
        id: "claude-sonnet-4-5",
        displayName: "Claude Sonnet 4.5",
        cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
      },
      "claude-sonnet-4-6": {
        id: "claude-sonnet-4-6",
        displayName: "Claude Sonnet 4.6",
        cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
      },
      "claude-sonnet-5": {
        id: "claude-sonnet-5",
        displayName: "Claude Sonnet 5",
        cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
      },
      "claude-sonnet-5-5": {
        id: "claude-sonnet-5-5",
        displayName: "Claude Sonnet 5.5",
        cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
      },
      "qwen3.5-plus": {
        id: "qwen3.5-plus",
        displayName: "Qwen3.5 Plus",
        cost: { input: 0.2, output: 1.2, cacheRead: 0.02, cacheWrite: 0.25 },
      },
      "qwen3.6-plus": {
        id: "qwen3.6-plus",
        displayName: "Qwen3.6 Plus",
        cost: { input: 0.5, output: 3, cacheRead: 0.05, cacheWrite: 0.625 },
      },
      "qwen3.8-flash": {
        id: "qwen3.8-flash",
        displayName: "Qwen3.8 Flash",
        cost: { input: 0.15, output: 0.47, cacheRead: 0.016, cacheWrite: 0.2 },
      },
      "gemini-3-flash": {
        id: "gemini-3-flash",
        displayName: "Gemini 3 Flash",
        cost: { input: 0.5, output: 3, cacheRead: 0.05, cacheWrite: 0 },
      },
      "gemini-3.1-pro": {
        id: "gemini-3.1-pro",
        displayName: "Gemini 3.1 Pro Preview",
        cost: { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 0 },
      },
      "gemini-3.5-flash": {
        id: "gemini-3.5-flash",
        displayName: "Gemini 3.5 Flash",
        cost: { input: 1.5, output: 9, cacheRead: 0.15, cacheWrite: 0 },
      },
      "gemini-3.5-flash-lite": {
        id: "gemini-3.5-flash-lite",
        displayName: "Gemini 3.5 Flash Lite",
        cost: { input: 0.3, output: 2.5, cacheRead: 0.03, cacheWrite: 0 },
      },
      "gemini-3.6-flash": {
        id: "gemini-3.6-flash",
        displayName: "Gemini 3.6 Flash",
        cost: { input: 1.5, output: 7.5, cacheRead: 0.15, cacheWrite: 0 },
      },
      "gemini-3.7-flash": {
        id: "gemini-3.7-flash",
        displayName: "Gemini 3.7 Flash",
        cost: { input: 1.5, output: 7.5, cacheRead: 0.15, cacheWrite: 0 },
      },
      "gemini-3.8-flash": {
        id: "gemini-3.8-flash",
        displayName: "Gemini 3.8 Flash",
        cost: { input: 1.5, output: 7.5, cacheRead: 0.15, cacheWrite: 0 },
      },
      "gemini-4-argon": {
        id: "gemini-4-argon",
        displayName: "Gemini 4 Argon",
        cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 0 },
      },
      "big-pickle": {
        id: "big-pickle",
        displayName: "Big Pickle",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "cat-jam-free": {
        id: "cat-jam-free",
        displayName: "Cat Jam Free",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "deepseek-v4-flash": {
        id: "deepseek-v4-flash",
        displayName: "DeepSeek V4 Flash",
        cost: { input: 0.14, output: 0.28, cacheRead: 0.028, cacheWrite: 0 },
      },
      "deepseek-v4-flash-vision-exp": {
        id: "deepseek-v4-flash-vision-exp",
        displayName: "DeepSeek V4 Flash Vision Exp",
        cost: { input: 0.14, output: 0.28, cacheRead: 0.028, cacheWrite: 0 },
      },
      "deepseek-v4-pro": {
        id: "deepseek-v4-pro",
        displayName: "DeepSeek V4 Pro",
        cost: { input: 1.74, output: 3.84, cacheRead: 0.145, cacheWrite: 0 },
      },
      "deepseek-v4.1-flash": {
        id: "deepseek-v4.1-flash",
        displayName: "DeepSeek V4.1 Flash",
        cost: { input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0 },
      },
      "deepseek-v4.1-flash-free": {
        id: "deepseek-v4.1-flash-free",
        displayName: "DeepSeek V4.1 Flash Free",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "glm-5": {
        id: "glm-5",
        displayName: "GLM-5",
        cost: { input: 1, output: 3.2, cacheRead: 0.2, cacheWrite: 0 },
      },
      "glm-5.1": {
        id: "glm-5.1",
        displayName: "GLM-5.1",
        cost: { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 },
      },
      "glm-5.2": {
        id: "glm-5.2",
        displayName: "GLM-5.2",
        cost: { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 },
      },
      "glm-5.3": {
        id: "glm-5.3",
        displayName: "GLM-5.3",
        cost: { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 },
      },
      "glm-5.3-flash": {
        id: "glm-5.3-flash",
        displayName: "GLM-5.3-Flash",
        cost: { input: 0.15, output: 0.5, cacheRead: 0.03, cacheWrite: 0 },
      },
      "kimi-k2.5": {
        id: "kimi-k2.5",
        displayName: "Kimi K2.5",
        cost: { input: 0.6, output: 3, cacheRead: 0.08, cacheWrite: 0 },
      },
      "kimi-k2.6": {
        id: "kimi-k2.6",
        displayName: "Kimi K2.6",
        cost: { input: 0.95, output: 4, cacheRead: 0.16, cacheWrite: 0 },
      },
      "kimi-k2.7-code": {
        id: "kimi-k2.7-code",
        displayName: "Kimi K2.7 Code",
        cost: { input: 0.95, output: 4, cacheRead: 0.19, cacheWrite: 0 },
      },
      "kimi-k3": {
        id: "kimi-k3",
        displayName: "Kimi K3",
        cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 0 },
      },
      "longcat-2.5-preview-free": {
        id: "longcat-2.5-preview-free",
        displayName: "LongCat 2.5 Preview Free",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "mimo-v2.6-flash-free": {
        id: "mimo-v2.6-flash-free",
        displayName: "MiMo-V2.6-Flash Free",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "minimax-m2.5": {
        id: "minimax-m2.5",
        displayName: "MiniMax-M2.5",
        cost: { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0 },
      },
      "minimax-m2.7": {
        id: "minimax-m2.7",
        displayName: "MiniMax-M2.7",
        cost: { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0 },
      },
      "minimax-m3": {
        id: "minimax-m3",
        displayName: "MiniMax-M3",
        cost: { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0 },
      },
      "mistral-large-4": {
        id: "mistral-large-4",
        displayName: "Mistral Large 4",
        cost: { input: 0.68, output: 2.09, cacheRead: 0.07, cacheWrite: 0 },
      },
      "nemotron-3-ultra-free": {
        id: "nemotron-3-ultra-free",
        displayName: "Nemotron 3 Ultra Free",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "nemotron-3.5-lightning-free": {
        id: "nemotron-3.5-lightning-free",
        displayName: "Nemotron 3.5 Lightning Free",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "nemotron-3.5-super-vl-free": {
        id: "nemotron-3.5-super-vl-free",
        displayName: "Nemotron 3.5 Super VL Free",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "qwen3.8-max": {
        id: "qwen3.8-max",
        displayName: "Qwen3.8 Max",
        cost: { input: 2, output: 6, cacheRead: 0.25, cacheWrite: 2.5 },
      },
      "space-bunny-free": {
        id: "space-bunny-free",
        displayName: "Space Bunny Free",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "step-5-preview-free": {
        id: "step-5-preview-free",
        displayName: "Step 5 Preview Free",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "gpt-5": {
        id: "gpt-5",
        displayName: "GPT-5",
        cost: { input: 1.07, output: 8.5, cacheRead: 0.107, cacheWrite: 0 },
      },
      "gpt-5-codex": {
        id: "gpt-5-codex",
        displayName: "GPT-5 Codex",
        cost: { input: 1.07, output: 8.5, cacheRead: 0.107, cacheWrite: 0 },
      },
      "gpt-5-nano": {
        id: "gpt-5-nano",
        displayName: "GPT-5 Nano",
        cost: { input: 0.05, output: 0.4, cacheRead: 0.005, cacheWrite: 0 },
      },
      "gpt-5.1": {
        id: "gpt-5.1",
        displayName: "GPT-5.1",
        cost: { input: 1.07, output: 8.5, cacheRead: 0.107, cacheWrite: 0 },
      },
      "gpt-5.1-codex": {
        id: "gpt-5.1-codex",
        displayName: "GPT-5.1 Codex",
        cost: { input: 1.07, output: 8.5, cacheRead: 0.107, cacheWrite: 0 },
      },
      "gpt-5.1-codex-max": {
        id: "gpt-5.1-codex-max",
        displayName: "GPT-5.1 Codex Max",
        cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
      },
      "gpt-5.1-codex-mini": {
        id: "gpt-5.1-codex-mini",
        displayName: "GPT-5.1 Codex Mini",
        cost: { input: 0.25, output: 2, cacheRead: 0.025, cacheWrite: 0 },
      },
      "gpt-5.2": {
        id: "gpt-5.2",
        displayName: "GPT-5.2",
        cost: { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 },
      },
      "gpt-5.2-codex": {
        id: "gpt-5.2-codex",
        displayName: "GPT-5.2 Codex",
        cost: { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 },
      },
      "gpt-5.3-codex": {
        id: "gpt-5.3-codex",
        displayName: "GPT-5.3 Codex",
        cost: { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 },
      },
      "gpt-5.4": {
        id: "gpt-5.4",
        displayName: "GPT-5.4",
        cost: { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 0 },
      },
      "gpt-5.4-mini": {
        id: "gpt-5.4-mini",
        displayName: "GPT-5.4 Mini",
        cost: { input: 0.75, output: 4.5, cacheRead: 0.075, cacheWrite: 0 },
      },
      "gpt-5.4-nano": {
        id: "gpt-5.4-nano",
        displayName: "GPT-5.4 Nano",
        cost: { input: 0.2, output: 1.25, cacheRead: 0.02, cacheWrite: 0 },
      },
      "gpt-5.4-pro": {
        id: "gpt-5.4-pro",
        displayName: "GPT-5.4 Pro",
        cost: { input: 30, output: 180, cacheRead: 30, cacheWrite: 0 },
      },
      "gpt-5.5": {
        id: "gpt-5.5",
        displayName: "GPT-5.5",
        cost: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 },
      },
      "gpt-5.5-pro": {
        id: "gpt-5.5-pro",
        displayName: "GPT-5.5 Pro",
        cost: { input: 30, output: 180, cacheRead: 30, cacheWrite: 0 },
      },
      "gpt-5.6-luna": {
        id: "gpt-5.6-luna",
        displayName: "GPT-5.6 Luna",
        cost: { input: 0.2, output: 1.2, cacheRead: 0.02, cacheWrite: 0.25 },
      },
      "gpt-5.6-sol": {
        id: "gpt-5.6-sol",
        displayName: "GPT-5.6 Sol",
        cost: { input: 4, output: 20, cacheRead: 0.4, cacheWrite: 5 },
      },
      "gpt-5.6-terra": {
        id: "gpt-5.6-terra",
        displayName: "GPT-5.6 Terra",
        cost: { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 3.125 },
      },
      "gpt-6-astra": {
        id: "gpt-6-astra",
        displayName: "GPT-6 Astra",
        cost: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
      },
      "gpt-6-luna": {
        id: "gpt-6-luna",
        displayName: "GPT-6 Luna",
        cost: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
      },
      "gpt-6-sol": {
        id: "gpt-6-sol",
        displayName: "GPT-6 Sol",
        cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
      },
      "gpt-6.1-sol": {
        id: "gpt-6.1-sol",
        displayName: "GPT-6.1 Sol",
        cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
      },
      "grok-4.5": {
        id: "grok-4.5",
        displayName: "Grok 4.5",
        cost: { input: 2, output: 6, cacheRead: 0.3, cacheWrite: 0 },
      },
      "grok-4.6": {
        id: "grok-4.6",
        displayName: "Grok 4.6",
        cost: { input: 2, output: 6, cacheRead: 0.5, cacheWrite: 0 },
      },
      "grok-4.7": {
        id: "grok-4.7",
        displayName: "Grok 4.7",
        cost: { input: 2, output: 6, cacheRead: 0.5, cacheWrite: 0 },
      },
      "grok-build-0.1": {
        id: "grok-build-0.1",
        displayName: "Grok Build 0.1",
        cost: { input: 1, output: 2, cacheRead: 0.2, cacheWrite: 0 },
      },
      "muse-spark-1.2": {
        id: "muse-spark-1.2",
        displayName: "Muse Spark 1.2",
        cost: { input: 1.25, output: 4.25, cacheRead: 0.15, cacheWrite: 0 },
      },
      "muse-spark-1.3": {
        id: "muse-spark-1.3",
        displayName: "Muse Spark 1.3",
        cost: { input: 1.25, output: 4.25, cacheRead: 0.15, cacheWrite: 0 },
      },
      "muse-spark-1.3-contributor-free": {
        id: "muse-spark-1.3-contributor-free",
        displayName: "Muse Spark 1.3 Free",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
    },
  },
  {
    id: "openrouter",
    displayName: "OpenRouter",
    providerType: "openai-compatible",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    models: {
      "anthropic/claude-fable-5": {
        id: "anthropic/claude-fable-5",
        displayName: "Anthropic: Claude Fable 5",
        cost: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
      },
      "anthropic/claude-fable-5.1": {
        id: "anthropic/claude-fable-5.1",
        displayName: "Anthropic: Claude Fable 5.1",
        cost: { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
      },
      "anthropic/claude-haiku-4.5": {
        id: "anthropic/claude-haiku-4.5",
        displayName: "Anthropic: Claude Haiku 4.5",
        cost: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
      },
      "anthropic/claude-haiku-5.5": {
        id: "anthropic/claude-haiku-5.5",
        displayName: "Anthropic: Claude Haiku 5.5",
        cost: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
      },
      "anthropic/claude-opus-4.1": {
        id: "anthropic/claude-opus-4.1",
        displayName: "Anthropic: Claude Opus 4.1",
        cost: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
      },
      "anthropic/claude-opus-4.5": {
        id: "anthropic/claude-opus-4.5",
        displayName: "Anthropic: Claude Opus 4.5",
        cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
      },
      "anthropic/claude-opus-4.6": {
        id: "anthropic/claude-opus-4.6",
        displayName: "Anthropic: Claude Opus 4.6",
        cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
      },
      "anthropic/claude-opus-4.7": {
        id: "anthropic/claude-opus-4.7",
        displayName: "Anthropic: Claude Opus 4.7",
        cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
      },
      "anthropic/claude-opus-4.8": {
        id: "anthropic/claude-opus-4.8",
        displayName: "Anthropic: Claude Opus 4.8",
        cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
      },
      "anthropic/claude-opus-5": {
        id: "anthropic/claude-opus-5",
        displayName: "Anthropic: Claude Opus 5",
        cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
      },
      "anthropic/claude-opus-5.5": {
        id: "anthropic/claude-opus-5.5",
        displayName: "Anthropic: Claude Opus 5.5",
        cost: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
      },
      "anthropic/claude-sonnet-4.5": {
        id: "anthropic/claude-sonnet-4.5",
        displayName: "Anthropic: Claude Sonnet 4.5",
        cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
      },
      "anthropic/claude-sonnet-4.6": {
        id: "anthropic/claude-sonnet-4.6",
        displayName: "Anthropic: Claude Sonnet 4.6",
        cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
      },
      "anthropic/claude-sonnet-5": {
        id: "anthropic/claude-sonnet-5",
        displayName: "Anthropic: Claude Sonnet 5",
        cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
      },
      "anthropic/claude-sonnet-5.5": {
        id: "anthropic/claude-sonnet-5.5",
        displayName: "Anthropic: Claude Sonnet 5.5",
        cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
      },
      "~anthropic/claude-fable-latest": {
        id: "~anthropic/claude-fable-latest",
        displayName: "Anthropic: Claude Fable Latest",
        cost: { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
      },
      "~anthropic/claude-haiku-latest": {
        id: "~anthropic/claude-haiku-latest",
        displayName: "Anthropic: Claude Haiku Latest",
        cost: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
      },
      "~anthropic/claude-opus-latest": {
        id: "~anthropic/claude-opus-latest",
        displayName: "Anthropic: Claude Opus Latest",
        cost: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
      },
      "~anthropic/claude-sonnet-latest": {
        id: "~anthropic/claude-sonnet-latest",
        displayName: "Anthropic: Claude Sonnet Latest",
        cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
      },
      "~deepseek/deepseek-flash-latest": {
        id: "~deepseek/deepseek-flash-latest",
        displayName: "DeepSeek: DeepSeek Flash Latest",
        cost: { input: 0.00576, output: 0.72, cacheRead: 0.0054, cacheWrite: 0 },
      },
      "~deepseek/deepseek-pro-latest": {
        id: "~deepseek/deepseek-pro-latest",
        displayName: "DeepSeek: DeepSeek Pro Latest",
        cost: { input: 0.1307, output: 8, cacheRead: 0.13, cacheWrite: 0 },
      },
      "~deepseek/deepseek-v4-flash-latest": {
        id: "~deepseek/deepseek-v4-flash-latest",
        displayName: "DeepSeek: DeepSeek V4 Flash Latest",
        cost: { input: 0.0144, output: 0.576, cacheRead: 0.0108, cacheWrite: 0 },
      },
      "~google/gemini-flash-latest": {
        id: "~google/gemini-flash-latest",
        displayName: "Google: Gemini Flash Latest",
        cost: { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0.041667 },
      },
      "~google/gemini-pro-latest": {
        id: "~google/gemini-pro-latest",
        displayName: "Google: Gemini Pro Latest",
        cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 0.1875 },
      },
      "~moonshotai/kimi-latest": {
        id: "~moonshotai/kimi-latest",
        displayName: "MoonshotAI: Kimi Latest",
        cost: { input: 0.4, output: 14, cacheRead: 0.3, cacheWrite: 0 },
      },
      "~openai/gpt-astra-latest": {
        id: "~openai/gpt-astra-latest",
        displayName: "OpenAI: GPT Astra Latest",
        cost: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
      },
      "~openai/gpt-luna-latest": {
        id: "~openai/gpt-luna-latest",
        displayName: "OpenAI: GPT Luna Latest",
        cost: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
      },
      "~openai/gpt-mini-latest": {
        id: "~openai/gpt-mini-latest",
        displayName: "OpenAI: GPT Mini Latest",
        cost: { input: 0.75, output: 4.5, cacheRead: 0.075, cacheWrite: 0 },
      },
      "~openai/gpt-sol-latest": {
        id: "~openai/gpt-sol-latest",
        displayName: "OpenAI: GPT Sol Latest",
        cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
      },
      "~openai/gpt-terra-latest": {
        id: "~openai/gpt-terra-latest",
        displayName: "OpenAI: GPT Terra Latest",
        cost: { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 2.5 },
      },
      "~unbiased/pareto-latest": {
        id: "~unbiased/pareto-latest",
        displayName: "Pareto Latest",
        cost: { input: 2.5, output: 7.5, cacheRead: 0.25, cacheWrite: 0 },
      },
      "~x-ai/grok-latest": {
        id: "~x-ai/grok-latest",
        displayName: "xAI: Grok Latest",
        cost: { input: 2, output: 6, cacheRead: 0.5, cacheWrite: 0 },
      },
      "~z-ai/glm-flash-latest": {
        id: "~z-ai/glm-flash-latest",
        displayName: "Z.ai: GLM Flash Latest",
        cost: { input: 0.036, output: 0.9, cacheRead: 0.01125, cacheWrite: 0 },
      },
      "~z-ai/glm-latest": {
        id: "~z-ai/glm-latest",
        displayName: "Z.ai: GLM Latest",
        cost: { input: 0.0608, output: 4.4, cacheRead: 0.0565, cacheWrite: 0 },
      },
      "aion-labs/aion-2.0": {
        id: "aion-labs/aion-2.0",
        displayName: "AionLabs: Aion-2.0",
        cost: { input: 0.8, output: 1.6, cacheRead: 0.2, cacheWrite: 0 },
      },
      "aion-labs/aion-3.0": {
        id: "aion-labs/aion-3.0",
        displayName: "AionLabs: Aion-3.0",
        cost: { input: 3, output: 6, cacheRead: 0.75, cacheWrite: 0 },
      },
      "aion-labs/aion-3.0-mini": {
        id: "aion-labs/aion-3.0-mini",
        displayName: "AionLabs: Aion-3.0-Mini",
        cost: { input: 0.7, output: 1.4, cacheRead: 0.18, cacheWrite: 0 },
      },
      "aion-labs/aion-3.5": {
        id: "aion-labs/aion-3.5",
        displayName: "AionLabs: Aion 3.5",
        cost: { input: 3, output: 6, cacheRead: 0.75, cacheWrite: 0 },
      },
      "aion-labs/aion-3.5-mini": {
        id: "aion-labs/aion-3.5-mini",
        displayName: "AionLabs: Aion 3.5 Mini",
        cost: { input: 0.7, output: 1.4, cacheRead: 0.18, cacheWrite: 0 },
      },
      "amazon/nova-2-lite-v1": {
        id: "amazon/nova-2-lite-v1",
        displayName: "Amazon: Nova 2 Lite",
        cost: { input: 0.3, output: 2.5, cacheRead: 0, cacheWrite: 0 },
      },
      "amazon/nova-lite-v1": {
        id: "amazon/nova-lite-v1",
        displayName: "Amazon: Nova Lite 1.0",
        cost: { input: 0.06, output: 0.24, cacheRead: 0, cacheWrite: 0 },
      },
      "amazon/nova-micro-v1": {
        id: "amazon/nova-micro-v1",
        displayName: "Amazon: Nova Micro 1.0",
        cost: { input: 0.035, output: 0.14, cacheRead: 0, cacheWrite: 0 },
      },
      "amazon/nova-premier-v1": {
        id: "amazon/nova-premier-v1",
        displayName: "Amazon: Nova Premier 1.0",
        cost: { input: 2.5, output: 12.5, cacheRead: 0.625, cacheWrite: 0 },
      },
      "amazon/nova-pro-v1": {
        id: "amazon/nova-pro-v1",
        displayName: "Amazon: Nova Pro 1.0",
        cost: { input: 0.8, output: 3.2, cacheRead: 0, cacheWrite: 0 },
      },
      "anthropic/claude-fable-5:batch": {
        id: "anthropic/claude-fable-5:batch",
        displayName: "Anthropic: Claude Fable 5 (batch)",
        cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
      },
      "anthropic/claude-fable-5.1:batch": {
        id: "anthropic/claude-fable-5.1:batch",
        displayName: "Anthropic: Claude Fable 5.1 (batch)",
        cost: { input: 5, output: 25, cacheRead: 0.125, cacheWrite: 6.25 },
      },
      "anthropic/claude-haiku-4.5:batch": {
        id: "anthropic/claude-haiku-4.5:batch",
        displayName: "Anthropic: Claude Haiku 4.5 (batch)",
        cost: { input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite: 0.625 },
      },
      "anthropic/claude-haiku-5.5:batch": {
        id: "anthropic/claude-haiku-5.5:batch",
        displayName: "Anthropic: Claude Haiku 5.5 (batch)",
        cost: { input: 0.05, output: 0.25, cacheRead: 0.005, cacheWrite: 0.0625 },
      },
      "anthropic/claude-opus-4.1:batch": {
        id: "anthropic/claude-opus-4.1:batch",
        displayName: "Anthropic: Claude Opus 4.1 (batch)",
        cost: { input: 7.5, output: 37.5, cacheRead: 0.75, cacheWrite: 9.375 },
      },
      "anthropic/claude-opus-4.5:batch": {
        id: "anthropic/claude-opus-4.5:batch",
        displayName: "Anthropic: Claude Opus 4.5 (batch)",
        cost: { input: 2.5, output: 12.5, cacheRead: 0.25, cacheWrite: 3.125 },
      },
      "anthropic/claude-opus-4.6:batch": {
        id: "anthropic/claude-opus-4.6:batch",
        displayName: "Anthropic: Claude Opus 4.6 (batch)",
        cost: { input: 2.5, output: 12.5, cacheRead: 0.25, cacheWrite: 3.125 },
      },
      "anthropic/claude-opus-4.7:batch": {
        id: "anthropic/claude-opus-4.7:batch",
        displayName: "Anthropic: Claude Opus 4.7 (batch)",
        cost: { input: 2.5, output: 12.5, cacheRead: 0.25, cacheWrite: 3.125 },
      },
      "anthropic/claude-opus-4.8:batch": {
        id: "anthropic/claude-opus-4.8:batch",
        displayName: "Anthropic: Claude Opus 4.8 (batch)",
        cost: { input: 2.5, output: 12.5, cacheRead: 0.25, cacheWrite: 3.125 },
      },
      "anthropic/claude-opus-5:batch": {
        id: "anthropic/claude-opus-5:batch",
        displayName: "Anthropic: Claude Opus 5 (batch)",
        cost: { input: 2.5, output: 12.5, cacheRead: 0.25, cacheWrite: 3.125 },
      },
      "anthropic/claude-opus-5.5:batch": {
        id: "anthropic/claude-opus-5.5:batch",
        displayName: "Anthropic: Claude Opus 5.5 (batch)",
        cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
      },
      "anthropic/claude-sonnet-4.5:batch": {
        id: "anthropic/claude-sonnet-4.5:batch",
        displayName: "Anthropic: Claude Sonnet 4.5 (batch)",
        cost: { input: 1.5, output: 7.5, cacheRead: 0.15, cacheWrite: 1.875 },
      },
      "anthropic/claude-sonnet-4.6:batch": {
        id: "anthropic/claude-sonnet-4.6:batch",
        displayName: "Anthropic: Claude Sonnet 4.6 (batch)",
        cost: { input: 1.5, output: 7.5, cacheRead: 0.15, cacheWrite: 1.875 },
      },
      "anthropic/claude-sonnet-5:batch": {
        id: "anthropic/claude-sonnet-5:batch",
        displayName: "Anthropic: Claude Sonnet 5 (batch)",
        cost: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
      },
      "anthropic/claude-sonnet-5.5:batch": {
        id: "anthropic/claude-sonnet-5.5:batch",
        displayName: "Anthropic: Claude Sonnet 5.5 (batch)",
        cost: { input: 1, output: 5, cacheRead: 0.05, cacheWrite: 1.25 },
      },
      "arcee-ai/trinity-large-thinking": {
        id: "arcee-ai/trinity-large-thinking",
        displayName: "Arcee AI: Trinity Large Thinking",
        cost: { input: 0.25, output: 0.8, cacheRead: 0.06, cacheWrite: 0 },
      },
      auto: {
        id: "auto",
        displayName: "Auto",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "bytedance-seed/seed-1.6": {
        id: "bytedance-seed/seed-1.6",
        displayName: "ByteDance Seed: Seed 1.6",
        cost: { input: 0.25, output: 2, cacheRead: 0, cacheWrite: 0 },
      },
      "bytedance-seed/seed-1.6-flash": {
        id: "bytedance-seed/seed-1.6-flash",
        displayName: "ByteDance Seed: Seed 1.6 Flash",
        cost: { input: 0.075, output: 0.3, cacheRead: 0, cacheWrite: 0 },
      },
      "bytedance-seed/seed-2-1-turbo": {
        id: "bytedance-seed/seed-2-1-turbo",
        displayName: "ByteDance Seed: Seed 2.1 Turbo",
        cost: { input: 0.5, output: 2.5, cacheRead: 0, cacheWrite: 0 },
      },
      "bytedance-seed/seed-2.0-code": {
        id: "bytedance-seed/seed-2.0-code",
        displayName: "ByteDance Seed: Seed-2.0-Code",
        cost: { input: 0.5, output: 3, cacheRead: 0, cacheWrite: 0 },
      },
      "bytedance-seed/seed-2.0-lite": {
        id: "bytedance-seed/seed-2.0-lite",
        displayName: "ByteDance Seed: Seed-2.0-Lite",
        cost: { input: 0.25, output: 2, cacheRead: 0, cacheWrite: 0 },
      },
      "bytedance-seed/seed-2.0-mini": {
        id: "bytedance-seed/seed-2.0-mini",
        displayName: "ByteDance Seed: Seed-2.0-Mini",
        cost: { input: 0.1, output: 0.4, cacheRead: 0, cacheWrite: 0 },
      },
      "cohere/command-a-plus": {
        id: "cohere/command-a-plus",
        displayName: "Cohere: Command A+",
        cost: { input: 0.3, output: 1.5, cacheRead: 0.15, cacheWrite: 0 },
      },
      "cohere/command-r-08-2024": {
        id: "cohere/command-r-08-2024",
        displayName: "Cohere: Command R (08-2024)",
        cost: { input: 0.15, output: 0.6, cacheRead: 0, cacheWrite: 0 },
      },
      "cohere/command-r-plus-08-2024": {
        id: "cohere/command-r-plus-08-2024",
        displayName: "Cohere: Command R+ (08-2024)",
        cost: { input: 2.5, output: 10, cacheRead: 0, cacheWrite: 0 },
      },
      "cohere/north-mini-code:free": {
        id: "cohere/north-mini-code:free",
        displayName: "Cohere: North Mini Code (free)",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "deepseek/deepseek-chat": {
        id: "deepseek/deepseek-chat",
        displayName: "DeepSeek: DeepSeek V3",
        cost: { input: 0.32, output: 0.89, cacheRead: 0, cacheWrite: 0 },
      },
      "deepseek/deepseek-chat-v3-0324": {
        id: "deepseek/deepseek-chat-v3-0324",
        displayName: "DeepSeek: DeepSeek V3 0324",
        cost: { input: 0.29, output: 1.14, cacheRead: 0.11, cacheWrite: 0 },
      },
      "deepseek/deepseek-chat-v3.1": {
        id: "deepseek/deepseek-chat-v3.1",
        displayName: "DeepSeek: DeepSeek V3.1",
        cost: { input: 0.25, output: 0.95, cacheRead: 0.13, cacheWrite: 0 },
      },
      "deepseek/deepseek-r1": {
        id: "deepseek/deepseek-r1",
        displayName: "DeepSeek: R1",
        cost: { input: 0.7, output: 2.5, cacheRead: 0, cacheWrite: 0 },
      },
      "deepseek/deepseek-r1-0528": {
        id: "deepseek/deepseek-r1-0528",
        displayName: "DeepSeek: R1 0528",
        cost: { input: 0.5, output: 2.15, cacheRead: 0.35, cacheWrite: 0 },
      },
      "deepseek/deepseek-v3.1-terminus": {
        id: "deepseek/deepseek-v3.1-terminus",
        displayName: "DeepSeek: DeepSeek V3.1 Terminus",
        cost: { input: 0.27, output: 1, cacheRead: 0, cacheWrite: 0 },
      },
      "deepseek/deepseek-v3.2": {
        id: "deepseek/deepseek-v3.2",
        displayName: "DeepSeek: DeepSeek V3.2",
        cost: { input: 0.259, output: 0.8, cacheRead: 0.14, cacheWrite: 0 },
      },
      "deepseek/deepseek-v3.2-exp": {
        id: "deepseek/deepseek-v3.2-exp",
        displayName: "DeepSeek: DeepSeek V3.2 Exp",
        cost: { input: 0.27, output: 0.41, cacheRead: 0, cacheWrite: 0 },
      },
      "deepseek/deepseek-v4-flash": {
        id: "deepseek/deepseek-v4-flash",
        displayName: "DeepSeek: DeepSeek V4 Flash 0423",
        cost: { input: 0.091, output: 0.182, cacheRead: 0.0182, cacheWrite: 0 },
      },
      "deepseek/deepseek-v4-flash-0731": {
        id: "deepseek/deepseek-v4-flash-0731",
        displayName: "DeepSeek: DeepSeek V4 Flash 0731",
        cost: { input: 0.016, output: 0.64, cacheRead: 0.016, cacheWrite: 0 },
      },
      "deepseek/deepseek-v4-flash-vision-exp": {
        id: "deepseek/deepseek-v4-flash-vision-exp",
        displayName: "DeepSeek: DeepSeek V4 Flash Vision Exp",
        cost: { input: 0.2156, output: 0.6468, cacheRead: 0.00686, cacheWrite: 0 },
      },
      "deepseek/deepseek-v4-pro": {
        id: "deepseek/deepseek-v4-pro",
        displayName: "DeepSeek: DeepSeek V4 Pro 0423",
        cost: { input: 0.392022, output: 0.784044, cacheRead: 0.032668, cacheWrite: 0 },
      },
      "deepseek/deepseek-v4-pro-0813": {
        id: "deepseek/deepseek-v4-pro-0813",
        displayName: "DeepSeek: DeepSeek V4 Pro 0813",
        cost: { input: 0.66, output: 1.98, cacheRead: 0.022, cacheWrite: 0 },
      },
      "deepseek/deepseek-v4.1-flash": {
        id: "deepseek/deepseek-v4.1-flash",
        displayName: "DeepSeek: DeepSeek V4.1 Flash",
        cost: { input: 0.00576, output: 0.72, cacheRead: 0.0054, cacheWrite: 0 },
      },
      "deepseek/deepseek-v4.1-flash:batch": {
        id: "deepseek/deepseek-v4.1-flash:batch",
        displayName: "DeepSeek: DeepSeek V4.1 Flash (batch)",
        cost: { input: 0.112, output: 0.336, cacheRead: 0.00336, cacheWrite: 0 },
      },
      "dots-studio/dots-3-note-preview:free": {
        id: "dots-studio/dots-3-note-preview:free",
        displayName: "Dots Studio: Dots3-Note Preview (free)",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "fireworks/ember-1": {
        id: "fireworks/ember-1",
        displayName: "Fireworks: Ember-1",
        cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 0 },
      },
      "google/gemini-2.5-flash": {
        id: "google/gemini-2.5-flash",
        displayName: "Google: Gemini 2.5 Flash",
        cost: { input: 0.3, output: 2.5, cacheRead: 0.03, cacheWrite: 0.083333 },
      },
      "google/gemini-2.5-flash-lite": {
        id: "google/gemini-2.5-flash-lite",
        displayName: "Google: Gemini 2.5 Flash Lite",
        cost: { input: 0.1, output: 0.4, cacheRead: 0.01, cacheWrite: 0.083333 },
      },
      "google/gemini-2.5-flash-lite:batch": {
        id: "google/gemini-2.5-flash-lite:batch",
        displayName: "Google: Gemini 2.5 Flash Lite (batch)",
        cost: { input: 0.05, output: 0.2, cacheRead: 0.01, cacheWrite: 0 },
      },
      "google/gemini-2.5-flash:batch": {
        id: "google/gemini-2.5-flash:batch",
        displayName: "Google: Gemini 2.5 Flash (batch)",
        cost: { input: 0.15, output: 1.25, cacheRead: 0.03, cacheWrite: 0 },
      },
      "google/gemini-2.5-pro": {
        id: "google/gemini-2.5-pro",
        displayName: "Google: Gemini 2.5 Pro",
        cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0.375 },
      },
      "google/gemini-2.5-pro-preview": {
        id: "google/gemini-2.5-pro-preview",
        displayName: "Google: Gemini 2.5 Pro Preview 06-05",
        cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0.375 },
      },
      "google/gemini-2.5-pro:batch": {
        id: "google/gemini-2.5-pro:batch",
        displayName: "Google: Gemini 2.5 Pro (batch)",
        cost: { input: 0.625, output: 5, cacheRead: 0.125, cacheWrite: 0 },
      },
      "google/gemini-3-flash-preview": {
        id: "google/gemini-3-flash-preview",
        displayName: "Google: Gemini 3 Flash Preview",
        cost: { input: 0.5, output: 3, cacheRead: 0.05, cacheWrite: 0.083333 },
      },
      "google/gemini-3-flash-preview:batch": {
        id: "google/gemini-3-flash-preview:batch",
        displayName: "Google: Gemini 3 Flash Preview (batch)",
        cost: { input: 0.25, output: 1.5, cacheRead: 0, cacheWrite: 0 },
      },
      "google/gemini-3-pro-image": {
        id: "google/gemini-3-pro-image",
        displayName: "Google: Nano Banana Pro (Gemini 3 Pro Image)",
        cost: { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 0.375 },
      },
      "google/gemini-3.1-flash-lite": {
        id: "google/gemini-3.1-flash-lite",
        displayName: "Google: Gemini 3.1 Flash Lite",
        cost: { input: 0.25, output: 1.5, cacheRead: 0.025, cacheWrite: 0.083333 },
      },
      "google/gemini-3.1-flash-lite-preview": {
        id: "google/gemini-3.1-flash-lite-preview",
        displayName: "Google: Gemini 3.1 Flash Lite Preview",
        cost: { input: 0.25, output: 1.5, cacheRead: 0.025, cacheWrite: 0.083333 },
      },
      "google/gemini-3.1-flash-lite:batch": {
        id: "google/gemini-3.1-flash-lite:batch",
        displayName: "Google: Gemini 3.1 Flash Lite (batch)",
        cost: { input: 0.125, output: 0.75, cacheRead: 0.0125, cacheWrite: 0 },
      },
      "google/gemini-3.1-pro-preview": {
        id: "google/gemini-3.1-pro-preview",
        displayName: "Google: Gemini 3.1 Pro Preview",
        cost: { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 0.375 },
      },
      "google/gemini-3.1-pro-preview-customtools": {
        id: "google/gemini-3.1-pro-preview-customtools",
        displayName: "Google: Gemini 3.1 Pro Preview Custom Tools",
        cost: { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 0.375 },
      },
      "google/gemini-3.1-pro-preview:batch": {
        id: "google/gemini-3.1-pro-preview:batch",
        displayName: "Google: Gemini 3.1 Pro Preview (batch)",
        cost: { input: 1, output: 6, cacheRead: 0, cacheWrite: 0 },
      },
      "google/gemini-3.5-flash": {
        id: "google/gemini-3.5-flash",
        displayName: "Google: Gemini 3.5 Flash",
        cost: { input: 1.5, output: 9, cacheRead: 0.15, cacheWrite: 0.083333 },
      },
      "google/gemini-3.5-flash-lite": {
        id: "google/gemini-3.5-flash-lite",
        displayName: "Google: Gemini 3.5 Flash Lite",
        cost: { input: 0.3, output: 2.5, cacheRead: 0.03, cacheWrite: 0.083333 },
      },
      "google/gemini-3.5-flash-lite:batch": {
        id: "google/gemini-3.5-flash-lite:batch",
        displayName: "Google: Gemini 3.5 Flash Lite (batch)",
        cost: { input: 0.15, output: 1.25, cacheRead: 0.015, cacheWrite: 0 },
      },
      "google/gemini-3.5-flash:batch": {
        id: "google/gemini-3.5-flash:batch",
        displayName: "Google: Gemini 3.5 Flash (batch)",
        cost: { input: 0.75, output: 4.5, cacheRead: 0.075, cacheWrite: 0 },
      },
      "google/gemini-3.6-flash": {
        id: "google/gemini-3.6-flash",
        displayName: "Google: Gemini 3.6 Flash",
        cost: { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0.041667 },
      },
      "google/gemini-3.6-flash:batch": {
        id: "google/gemini-3.6-flash:batch",
        displayName: "Google: Gemini 3.6 Flash (batch)",
        cost: { input: 0.375, output: 1.875, cacheRead: 0.0375, cacheWrite: 0.041667 },
      },
      "google/gemini-3.7-flash": {
        id: "google/gemini-3.7-flash",
        displayName: "Google: Gemini 3.7 Flash",
        cost: { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0.041667 },
      },
      "google/gemini-3.7-flash:batch": {
        id: "google/gemini-3.7-flash:batch",
        displayName: "Google: Gemini 3.7 Flash (batch)",
        cost: { input: 0.375, output: 1.875, cacheRead: 0.0375, cacheWrite: 0.041667 },
      },
      "google/gemini-3.8-flash": {
        id: "google/gemini-3.8-flash",
        displayName: "Google: Gemini 3.8 Flash",
        cost: { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0.041667 },
      },
      "google/gemini-3.8-flash:batch": {
        id: "google/gemini-3.8-flash:batch",
        displayName: "Google: Gemini 3.8 Flash (batch)",
        cost: { input: 0.375, output: 1.875, cacheRead: 0.0375, cacheWrite: 0.041667 },
      },
      "google/gemini-4-argon": {
        id: "google/gemini-4-argon",
        displayName: "Google: Gemini 4 Argon",
        cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 0.1875 },
      },
      "google/gemini-4-argon:batch": {
        id: "google/gemini-4-argon:batch",
        displayName: "Google: Gemini 4 Argon (batch)",
        cost: { input: 1, output: 5, cacheRead: 0.05, cacheWrite: 0.1875 },
      },
      "google/gemini-nano-banana-2.1": {
        id: "google/gemini-nano-banana-2.1",
        displayName: "Google: Nano Banana 2.1",
        cost: { input: 1.5, output: 7.5, cacheRead: 0, cacheWrite: 0 },
      },
      "google/gemma-3-12b-it": {
        id: "google/gemma-3-12b-it",
        displayName: "Google: Gemma 3 12B",
        cost: { input: 0.05, output: 0.15, cacheRead: 0, cacheWrite: 0 },
      },
      "google/gemma-3-27b-it": {
        id: "google/gemma-3-27b-it",
        displayName: "Google: Gemma 3 27B",
        cost: { input: 0.08, output: 0.45, cacheRead: 0.04, cacheWrite: 0 },
      },
      "google/gemma-4-26b-a4b-it": {
        id: "google/gemma-4-26b-a4b-it",
        displayName: "Google: Gemma 4 26B A4B ",
        cost: { input: 0.09, output: 0.3, cacheRead: 0.05, cacheWrite: 0 },
      },
      "google/gemma-4-26b-a4b-it:free": {
        id: "google/gemma-4-26b-a4b-it:free",
        displayName: "Google: Gemma 4 26B A4B  (free)",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "google/gemma-4-31b-it": {
        id: "google/gemma-4-31b-it",
        displayName: "Google: Gemma 4 31B",
        cost: { input: 0.2, output: 0.4, cacheRead: 0, cacheWrite: 0 },
      },
      "google/gemma-4-31b-it:free": {
        id: "google/gemma-4-31b-it:free",
        displayName: "Google: Gemma 4 31B (free)",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "ibm-granite/granite-4.2-8b": {
        id: "ibm-granite/granite-4.2-8b",
        displayName: "IBM: Granite 4.2 8B",
        cost: { input: 0.06, output: 0.25, cacheRead: 0.015, cacheWrite: 0 },
      },
      "inception/mercury-2": {
        id: "inception/mercury-2",
        displayName: "Inception: Mercury 2",
        cost: { input: 0.25, output: 0.75, cacheRead: 0.025, cacheWrite: 0 },
      },
      "inception/mercury-2.5": {
        id: "inception/mercury-2.5",
        displayName: "Inception: Mercury 2.5",
        cost: { input: 0.04, output: 0.15, cacheRead: 0.004, cacheWrite: 0 },
      },
      "inclusionai/ling-3.0-flash": {
        id: "inclusionai/ling-3.0-flash",
        displayName: "inclusionAI: Ling 3.0 Flash",
        cost: { input: 0.021, output: 0.063, cacheRead: 0.0042, cacheWrite: 0 },
      },
      "inclusionai/ling-3.0-flash-vl": {
        id: "inclusionai/ling-3.0-flash-vl",
        displayName: "inclusionAI: Ling 3.0 Flash VL",
        cost: { input: 0.06, output: 0.18, cacheRead: 0.012, cacheWrite: 0 },
      },
      "inclusionai/ling-3.1-flash": {
        id: "inclusionai/ling-3.1-flash",
        displayName: "inclusionAI: Ling 3.1 Flash",
        cost: { input: 0.075, output: 0.225, cacheRead: 0.015, cacheWrite: 0 },
      },
      "liquid/lfm-2.5-2.6b:free": {
        id: "liquid/lfm-2.5-2.6b:free",
        displayName: "LiquidAI: LFM2.5-2.6B (free)",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "liquid/lfm-2.5-24b-a2b": {
        id: "liquid/lfm-2.5-24b-a2b",
        displayName: "LiquidAI: LFM2.5-24B-A2B",
        cost: { input: 0.05, output: 0.7, cacheRead: 0.025, cacheWrite: 0 },
      },
      "meituan/longcat-2.0": {
        id: "meituan/longcat-2.0",
        displayName: "Meituan: LongCat 2.0",
        cost: { input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0 },
      },
      "meta-llama/llama-3.1-70b-instruct": {
        id: "meta-llama/llama-3.1-70b-instruct",
        displayName: "Meta: Llama 3.1 70B Instruct",
        cost: { input: 0.4, output: 0.4, cacheRead: 0, cacheWrite: 0 },
      },
      "meta-llama/llama-3.1-8b-instruct": {
        id: "meta-llama/llama-3.1-8b-instruct",
        displayName: "Meta: Llama 3.1 8B Instruct",
        cost: { input: 0.05, output: 0.08, cacheRead: 0.025, cacheWrite: 0 },
      },
      "meta-llama/llama-3.3-70b-instruct": {
        id: "meta-llama/llama-3.3-70b-instruct",
        displayName: "Meta: Llama 3.3 70B Instruct",
        cost: { input: 0.59, output: 0.79, cacheRead: 0.295, cacheWrite: 0 },
      },
      "meta-llama/llama-4-maverick": {
        id: "meta-llama/llama-4-maverick",
        displayName: "Meta: Llama 4 Maverick",
        cost: { input: 0.1875, output: 0.6525, cacheRead: 0.05, cacheWrite: 0 },
      },
      "meta-llama/llama-4-scout": {
        id: "meta-llama/llama-4-scout",
        displayName: "Meta: Llama 4 Scout",
        cost: { input: 0.18, output: 0.59, cacheRead: 0, cacheWrite: 0 },
      },
      "meta/muse-glimmer-30b": {
        id: "meta/muse-glimmer-30b",
        displayName: "Meta: Muse Glimmer 30B",
        cost: { input: 0.3, output: 1.2, cacheRead: 0.04, cacheWrite: 0 },
      },
      "meta/muse-spark-1.1": {
        id: "meta/muse-spark-1.1",
        displayName: "Meta: Muse Spark 1.1",
        cost: { input: 1.25, output: 4.25, cacheRead: 0.15, cacheWrite: 0 },
      },
      "meta/muse-spark-1.2": {
        id: "meta/muse-spark-1.2",
        displayName: "Meta: Muse Spark 1.2",
        cost: { input: 1.25, output: 4.25, cacheRead: 0.15, cacheWrite: 0 },
      },
      "meta/muse-spark-1.2-contributor": {
        id: "meta/muse-spark-1.2-contributor",
        displayName: "Meta: Muse Spark 1.2 Contributor",
        cost: { input: 0.1, output: 0.2, cacheRead: 0.002, cacheWrite: 0 },
      },
      "meta/muse-spark-1.3": {
        id: "meta/muse-spark-1.3",
        displayName: "Meta: Muse Spark 1.3",
        cost: { input: 1.25, output: 4.25, cacheRead: 0.15, cacheWrite: 0 },
      },
      "meta/muse-spark-1.3-contributor": {
        id: "meta/muse-spark-1.3-contributor",
        displayName: "Meta: Muse Spark 1.3 Contributor",
        cost: { input: 0.1, output: 0.2, cacheRead: 0.002, cacheWrite: 0 },
      },
      "meta/muse-spark-open": {
        id: "meta/muse-spark-open",
        displayName: "Meta: Muse Spark Open",
        cost: { input: 1.25, output: 4.25, cacheRead: 0.15, cacheWrite: 0 },
      },
      "meta/muse-wonder": {
        id: "meta/muse-wonder",
        displayName: "Meta: Muse Wonder",
        cost: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 0 },
      },
      "minimax/minimax-m1": {
        id: "minimax/minimax-m1",
        displayName: "MiniMax: MiniMax M1",
        cost: { input: 0.55, output: 2.2, cacheRead: 0, cacheWrite: 0 },
      },
      "minimax/minimax-m2": {
        id: "minimax/minimax-m2",
        displayName: "MiniMax: MiniMax M2",
        cost: { input: 0.255, output: 1.02, cacheRead: 0, cacheWrite: 0 },
      },
      "minimax/minimax-m2.1": {
        id: "minimax/minimax-m2.1",
        displayName: "MiniMax: MiniMax M2.1",
        cost: { input: 0.3, output: 1.2, cacheRead: 0.03, cacheWrite: 0 },
      },
      "minimax/minimax-m2.5": {
        id: "minimax/minimax-m2.5",
        displayName: "MiniMax: MiniMax M2.5",
        cost: { input: 0.27, output: 0.95, cacheRead: 0.03, cacheWrite: 0 },
      },
      "minimax/minimax-m2.7": {
        id: "minimax/minimax-m2.7",
        displayName: "MiniMax: MiniMax M2.7",
        cost: { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0 },
      },
      "minimax/minimax-m3": {
        id: "minimax/minimax-m3",
        displayName: "MiniMax: MiniMax M3",
        cost: { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0 },
      },
      "mistralai/codestral-2508": {
        id: "mistralai/codestral-2508",
        displayName: "Mistral: Codestral 2508",
        cost: { input: 0.3, output: 0.9, cacheRead: 0.03, cacheWrite: 0 },
      },
      "mistralai/codestral-2508:batch": {
        id: "mistralai/codestral-2508:batch",
        displayName: "Mistral: Codestral 2508 (batch)",
        cost: { input: 0.15, output: 0.45, cacheRead: 0.015, cacheWrite: 0 },
      },
      "mistralai/devstral-2512": {
        id: "mistralai/devstral-2512",
        displayName: "Mistral: Devstral 2 2512",
        cost: { input: 0.4, output: 2, cacheRead: 0.04, cacheWrite: 0 },
      },
      "mistralai/ministral-14b-2512": {
        id: "mistralai/ministral-14b-2512",
        displayName: "Mistral: Ministral 3 14B 2512",
        cost: { input: 0.2, output: 0.2, cacheRead: 0.02, cacheWrite: 0 },
      },
      "mistralai/ministral-3b-2512": {
        id: "mistralai/ministral-3b-2512",
        displayName: "Mistral: Ministral 3 3B 2512",
        cost: { input: 0.1, output: 0.1, cacheRead: 0.01, cacheWrite: 0 },
      },
      "mistralai/ministral-8b-2512": {
        id: "mistralai/ministral-8b-2512",
        displayName: "Mistral: Ministral 3 8B 2512",
        cost: { input: 0.15, output: 0.15, cacheRead: 0.015, cacheWrite: 0 },
      },
      "mistralai/ministral-8b-2512:batch": {
        id: "mistralai/ministral-8b-2512:batch",
        displayName: "Mistral: Ministral 3 8B 2512 (batch)",
        cost: { input: 0.075, output: 0.075, cacheRead: 0.0075, cacheWrite: 0 },
      },
      "mistralai/mistral-large": {
        id: "mistralai/mistral-large",
        displayName: "Mistral Large",
        cost: { input: 2, output: 6, cacheRead: 0.2, cacheWrite: 0 },
      },
      "mistralai/mistral-large-2407": {
        id: "mistralai/mistral-large-2407",
        displayName: "Mistral Large 2407",
        cost: { input: 2, output: 6, cacheRead: 0.2, cacheWrite: 0 },
      },
      "mistralai/mistral-large-2512": {
        id: "mistralai/mistral-large-2512",
        displayName: "Mistral: Mistral Large 3 2512",
        cost: { input: 0.5, output: 1.5, cacheRead: 0.05, cacheWrite: 0 },
      },
      "mistralai/mistral-large-2512:batch": {
        id: "mistralai/mistral-large-2512:batch",
        displayName: "Mistral: Mistral Large 3 2512 (batch)",
        cost: { input: 0.25, output: 0.75, cacheRead: 0.025, cacheWrite: 0 },
      },
      "mistralai/mistral-large-4-0": {
        id: "mistralai/mistral-large-4-0",
        displayName: "Mistral: Mistral Large 4",
        cost: { input: 0.68, output: 2.09, cacheRead: 0.07, cacheWrite: 0 },
      },
      "mistralai/mistral-medium-3": {
        id: "mistralai/mistral-medium-3",
        displayName: "Mistral: Mistral Medium 3",
        cost: { input: 0.4, output: 2, cacheRead: 0.04, cacheWrite: 0 },
      },
      "mistralai/mistral-medium-3-5": {
        id: "mistralai/mistral-medium-3-5",
        displayName: "Mistral: Mistral Medium 3.5",
        cost: { input: 1.5, output: 7.5, cacheRead: 0, cacheWrite: 0 },
      },
      "mistralai/mistral-medium-3-5:batch": {
        id: "mistralai/mistral-medium-3-5:batch",
        displayName: "Mistral: Mistral Medium 3.5 (batch)",
        cost: { input: 0.75, output: 3.75, cacheRead: 0, cacheWrite: 0 },
      },
      "mistralai/mistral-medium-3.1": {
        id: "mistralai/mistral-medium-3.1",
        displayName: "Mistral: Mistral Medium 3.1",
        cost: { input: 0.4, output: 2, cacheRead: 0.04, cacheWrite: 0 },
      },
      "mistralai/mistral-medium-3.1:batch": {
        id: "mistralai/mistral-medium-3.1:batch",
        displayName: "Mistral: Mistral Medium 3.1 (batch)",
        cost: { input: 0.2, output: 1, cacheRead: 0.02, cacheWrite: 0 },
      },
      "mistralai/mistral-nemo": {
        id: "mistralai/mistral-nemo",
        displayName: "Mistral: Mistral Nemo",
        cost: { input: 0.029, output: 0.03, cacheRead: 0, cacheWrite: 0 },
      },
      "mistralai/mistral-saba": {
        id: "mistralai/mistral-saba",
        displayName: "Mistral: Saba",
        cost: { input: 0.2, output: 0.6, cacheRead: 0.02, cacheWrite: 0 },
      },
      "mistralai/mistral-small-2603": {
        id: "mistralai/mistral-small-2603",
        displayName: "Mistral: Mistral Small 4",
        cost: { input: 0.15, output: 0.6, cacheRead: 0.015, cacheWrite: 0 },
      },
      "mistralai/mistral-small-2603:batch": {
        id: "mistralai/mistral-small-2603:batch",
        displayName: "Mistral: Mistral Small 4 (batch)",
        cost: { input: 0.075, output: 0.3, cacheRead: 0.0075, cacheWrite: 0 },
      },
      "mistralai/mistral-small-3.1-24b-instruct": {
        id: "mistralai/mistral-small-3.1-24b-instruct",
        displayName: "Mistral: Mistral Small 3.1 24B",
        cost: { input: 0.351, output: 0.555, cacheRead: 0, cacheWrite: 0 },
      },
      "mistralai/mistral-small-3.2-24b-instruct": {
        id: "mistralai/mistral-small-3.2-24b-instruct",
        displayName: "Mistral: Mistral Small 3.2 24B",
        cost: { input: 0.09375, output: 0.25, cacheRead: 0, cacheWrite: 0 },
      },
      "mistralai/mixtral-8x22b-instruct": {
        id: "mistralai/mixtral-8x22b-instruct",
        displayName: "Mistral: Mixtral 8x22B Instruct",
        cost: { input: 2, output: 6, cacheRead: 0.2, cacheWrite: 0 },
      },
      "mistralai/voxtral-small-24b-2507": {
        id: "mistralai/voxtral-small-24b-2507",
        displayName: "Mistral: Voxtral Small 24B 2507",
        cost: { input: 0.1, output: 0.3, cacheRead: 0.01, cacheWrite: 0 },
      },
      "moonshotai/kimi-k2": {
        id: "moonshotai/kimi-k2",
        displayName: "MoonshotAI: Kimi K2 0711",
        cost: { input: 0.57, output: 2.3, cacheRead: 0, cacheWrite: 0 },
      },
      "moonshotai/kimi-k2-0905": {
        id: "moonshotai/kimi-k2-0905",
        displayName: "MoonshotAI: Kimi K2 0905",
        cost: { input: 0.6, output: 2.5, cacheRead: 0, cacheWrite: 0 },
      },
      "moonshotai/kimi-k2-thinking": {
        id: "moonshotai/kimi-k2-thinking",
        displayName: "MoonshotAI: Kimi K2 Thinking",
        cost: { input: 0.6, output: 2.5, cacheRead: 0.15, cacheWrite: 0 },
      },
      "moonshotai/kimi-k2.5": {
        id: "moonshotai/kimi-k2.5",
        displayName: "MoonshotAI: Kimi K2.5",
        cost: { input: 0.41, output: 2.06, cacheRead: 0.07, cacheWrite: 0 },
      },
      "moonshotai/kimi-k2.6": {
        id: "moonshotai/kimi-k2.6",
        displayName: "MoonshotAI: Kimi K2.6",
        cost: { input: 0.65, output: 3.41, cacheRead: 0.15, cacheWrite: 0 },
      },
      "moonshotai/kimi-k2.7-code": {
        id: "moonshotai/kimi-k2.7-code",
        displayName: "MoonshotAI: Kimi K2.7 Code",
        cost: { input: 0.6712, output: 3.35, cacheRead: 0.18, cacheWrite: 0 },
      },
      "moonshotai/kimi-k3": {
        id: "moonshotai/kimi-k3",
        displayName: "MoonshotAI: Kimi K3",
        cost: { input: 0.405, output: 15, cacheRead: 0.28, cacheWrite: 0 },
      },
      "moonshotai/kimi-k3:batch": {
        id: "moonshotai/kimi-k3:batch",
        displayName: "MoonshotAI: Kimi K3 (batch)",
        cost: { input: 2.28, output: 11.4, cacheRead: 0.228, cacheWrite: 0 },
      },
      "nex-agi/nex-n2.5-pro": {
        id: "nex-agi/nex-n2.5-pro",
        displayName: "Nex AGI: Nex-N2.5-Pro",
        cost: { input: 0.075, output: 0.25, cacheRead: 0.015, cacheWrite: 0 },
      },
      "nvidia/nemotron-3-nano-30b-a3b": {
        id: "nvidia/nemotron-3-nano-30b-a3b",
        displayName: "NVIDIA: Nemotron 3 Nano 30B A3B",
        cost: { input: 0.06, output: 0.24, cacheRead: 0, cacheWrite: 0 },
      },
      "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free": {
        id: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
        displayName: "NVIDIA: Nemotron 3 Nano Omni (free)",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "nvidia/nemotron-3-super-120b-a12b": {
        id: "nvidia/nemotron-3-super-120b-a12b",
        displayName: "NVIDIA: Nemotron 3 Super",
        cost: { input: 0.08, output: 0.45, cacheRead: 0, cacheWrite: 0 },
      },
      "nvidia/nemotron-3-super-120b-a12b:free": {
        id: "nvidia/nemotron-3-super-120b-a12b:free",
        displayName: "NVIDIA: Nemotron 3 Super (free)",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "nvidia/nemotron-3-ultra-550b-a55b": {
        id: "nvidia/nemotron-3-ultra-550b-a55b",
        displayName: "NVIDIA: Nemotron 3 Ultra",
        cost: { input: 0.6, output: 2.4, cacheRead: 0.12, cacheWrite: 0 },
      },
      "nvidia/nemotron-3-ultra-550b-a55b:free": {
        id: "nvidia/nemotron-3-ultra-550b-a55b:free",
        displayName: "NVIDIA: Nemotron 3 Ultra (free)",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "nvidia/nemotron-3.5-lightning": {
        id: "nvidia/nemotron-3.5-lightning",
        displayName: "NVIDIA: Nemotron 3.5 Lightning",
        cost: { input: 0.07, output: 0.2, cacheRead: 0.04, cacheWrite: 0 },
      },
      "nvidia/nemotron-3.5-lightning:free": {
        id: "nvidia/nemotron-3.5-lightning:free",
        displayName: "NVIDIA: Nemotron 3.5 Lightning (free)",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "nvidia/nemotron-3.5-super-vl": {
        id: "nvidia/nemotron-3.5-super-vl",
        displayName: "NVIDIA: Nemotron 3.5 Super VL",
        cost: { input: 0.15, output: 0.5, cacheRead: 0.02, cacheWrite: 0 },
      },
      "nvidia/nemotron-3.5-super-vl:free": {
        id: "nvidia/nemotron-3.5-super-vl:free",
        displayName: "NVIDIA: Nemotron 3.5 Super VL (free)",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "openai/gpt-3.5-turbo": {
        id: "openai/gpt-3.5-turbo",
        displayName: "OpenAI: GPT-3.5 Turbo",
        cost: { input: 0.5, output: 1.5, cacheRead: 0, cacheWrite: 0 },
      },
      "openai/gpt-3.5-turbo-0613": {
        id: "openai/gpt-3.5-turbo-0613",
        displayName: "OpenAI: GPT-3.5 Turbo (older v0613)",
        cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
      },
      "openai/gpt-3.5-turbo-16k": {
        id: "openai/gpt-3.5-turbo-16k",
        displayName: "OpenAI: GPT-3.5 Turbo 16k",
        cost: { input: 3, output: 4, cacheRead: 0, cacheWrite: 0 },
      },
      "openai/gpt-3.5-turbo:batch": {
        id: "openai/gpt-3.5-turbo:batch",
        displayName: "OpenAI: GPT-3.5 Turbo (batch)",
        cost: { input: 0.25, output: 0.75, cacheRead: 0, cacheWrite: 0 },
      },
      "openai/gpt-4": {
        id: "openai/gpt-4",
        displayName: "OpenAI: GPT-4",
        cost: { input: 30, output: 60, cacheRead: 0, cacheWrite: 0 },
      },
      "openai/gpt-4-turbo": {
        id: "openai/gpt-4-turbo",
        displayName: "OpenAI: GPT-4 Turbo",
        cost: { input: 10, output: 30, cacheRead: 0, cacheWrite: 0 },
      },
      "openai/gpt-4-turbo:batch": {
        id: "openai/gpt-4-turbo:batch",
        displayName: "OpenAI: GPT-4 Turbo (batch)",
        cost: { input: 5, output: 15, cacheRead: 0, cacheWrite: 0 },
      },
      "openai/gpt-4.1": {
        id: "openai/gpt-4.1",
        displayName: "OpenAI: GPT-4.1",
        cost: { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 0 },
      },
      "openai/gpt-4.1-mini": {
        id: "openai/gpt-4.1-mini",
        displayName: "OpenAI: GPT-4.1 Mini",
        cost: { input: 0.4, output: 1.6, cacheRead: 0.1, cacheWrite: 0 },
      },
      "openai/gpt-4.1-mini:batch": {
        id: "openai/gpt-4.1-mini:batch",
        displayName: "OpenAI: GPT-4.1 Mini (batch)",
        cost: { input: 0.2, output: 0.8, cacheRead: 0.05, cacheWrite: 0 },
      },
      "openai/gpt-4.1-nano": {
        id: "openai/gpt-4.1-nano",
        displayName: "OpenAI: GPT-4.1 Nano",
        cost: { input: 0.1, output: 0.4, cacheRead: 0.025, cacheWrite: 0 },
      },
      "openai/gpt-4.1-nano:batch": {
        id: "openai/gpt-4.1-nano:batch",
        displayName: "OpenAI: GPT-4.1 Nano (batch)",
        cost: { input: 0.05, output: 0.2, cacheRead: 0.0125, cacheWrite: 0 },
      },
      "openai/gpt-4.1:batch": {
        id: "openai/gpt-4.1:batch",
        displayName: "OpenAI: GPT-4.1 (batch)",
        cost: { input: 1, output: 4, cacheRead: 0.25, cacheWrite: 0 },
      },
      "openai/gpt-4o": {
        id: "openai/gpt-4o",
        displayName: "OpenAI: GPT-4o",
        cost: { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 0 },
      },
      "openai/gpt-4o-2024-05-13": {
        id: "openai/gpt-4o-2024-05-13",
        displayName: "OpenAI: GPT-4o (2024-05-13)",
        cost: { input: 5, output: 15, cacheRead: 0, cacheWrite: 0 },
      },
      "openai/gpt-4o-2024-08-06": {
        id: "openai/gpt-4o-2024-08-06",
        displayName: "OpenAI: GPT-4o (2024-08-06)",
        cost: { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 0 },
      },
      "openai/gpt-4o-2024-11-20": {
        id: "openai/gpt-4o-2024-11-20",
        displayName: "OpenAI: GPT-4o (2024-11-20)",
        cost: { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 0 },
      },
      "openai/gpt-4o-mini": {
        id: "openai/gpt-4o-mini",
        displayName: "OpenAI: GPT-4o-mini",
        cost: { input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite: 0 },
      },
      "openai/gpt-4o-mini-2024-07-18": {
        id: "openai/gpt-4o-mini-2024-07-18",
        displayName: "OpenAI: GPT-4o-mini (2024-07-18)",
        cost: { input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite: 0 },
      },
      "openai/gpt-4o-mini:batch": {
        id: "openai/gpt-4o-mini:batch",
        displayName: "OpenAI: GPT-4o-mini (batch)",
        cost: { input: 0.075, output: 0.3, cacheRead: 0.0375, cacheWrite: 0 },
      },
      "openai/gpt-4o:batch": {
        id: "openai/gpt-4o:batch",
        displayName: "OpenAI: GPT-4o (batch)",
        cost: { input: 1.25, output: 5, cacheRead: 0.625, cacheWrite: 0 },
      },
      "openai/gpt-5": {
        id: "openai/gpt-5",
        displayName: "OpenAI: GPT-5",
        cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
      },
      "openai/gpt-5-mini": {
        id: "openai/gpt-5-mini",
        displayName: "OpenAI: GPT-5 Mini",
        cost: { input: 0.25, output: 2, cacheRead: 0.025, cacheWrite: 0 },
      },
      "openai/gpt-5-mini:batch": {
        id: "openai/gpt-5-mini:batch",
        displayName: "OpenAI: GPT-5 Mini (batch)",
        cost: { input: 0.125, output: 1, cacheRead: 0.0125, cacheWrite: 0 },
      },
      "openai/gpt-5-nano": {
        id: "openai/gpt-5-nano",
        displayName: "OpenAI: GPT-5 Nano",
        cost: { input: 0.05, output: 0.4, cacheRead: 0.005, cacheWrite: 0 },
      },
      "openai/gpt-5-nano:batch": {
        id: "openai/gpt-5-nano:batch",
        displayName: "OpenAI: GPT-5 Nano (batch)",
        cost: { input: 0.025, output: 0.2, cacheRead: 0.0025, cacheWrite: 0 },
      },
      "openai/gpt-5-pro": {
        id: "openai/gpt-5-pro",
        displayName: "OpenAI: GPT-5 Pro",
        cost: { input: 15, output: 120, cacheRead: 0, cacheWrite: 0 },
      },
      "openai/gpt-5-pro:batch": {
        id: "openai/gpt-5-pro:batch",
        displayName: "OpenAI: GPT-5 Pro (batch)",
        cost: { input: 7.5, output: 60, cacheRead: 0, cacheWrite: 0 },
      },
      "openai/gpt-5:batch": {
        id: "openai/gpt-5:batch",
        displayName: "OpenAI: GPT-5 (batch)",
        cost: { input: 0.625, output: 5, cacheRead: 0.0625, cacheWrite: 0 },
      },
      "openai/gpt-5.1": {
        id: "openai/gpt-5.1",
        displayName: "OpenAI: GPT-5.1",
        cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
      },
      "openai/gpt-5.1-codex": {
        id: "openai/gpt-5.1-codex",
        displayName: "OpenAI: GPT-5.1-Codex",
        cost: { input: 1.25, output: 10, cacheRead: 0.13, cacheWrite: 0 },
      },
      "openai/gpt-5.1-codex-max": {
        id: "openai/gpt-5.1-codex-max",
        displayName: "OpenAI: GPT-5.1-Codex-Max",
        cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
      },
      "openai/gpt-5.1-codex-mini": {
        id: "openai/gpt-5.1-codex-mini",
        displayName: "OpenAI: GPT-5.1-Codex-Mini",
        cost: { input: 0.25, output: 2, cacheRead: 0.03, cacheWrite: 0 },
      },
      "openai/gpt-5.1:batch": {
        id: "openai/gpt-5.1:batch",
        displayName: "OpenAI: GPT-5.1 (batch)",
        cost: { input: 0.625, output: 5, cacheRead: 0.0625, cacheWrite: 0 },
      },
      "openai/gpt-5.2": {
        id: "openai/gpt-5.2",
        displayName: "OpenAI: GPT-5.2",
        cost: { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 },
      },
      "openai/gpt-5.2-chat": {
        id: "openai/gpt-5.2-chat",
        displayName: "OpenAI: GPT-5.2 Chat",
        cost: { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 },
      },
      "openai/gpt-5.2-codex": {
        id: "openai/gpt-5.2-codex",
        displayName: "OpenAI: GPT-5.2-Codex",
        cost: { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 },
      },
      "openai/gpt-5.2-pro": {
        id: "openai/gpt-5.2-pro",
        displayName: "OpenAI: GPT-5.2 Pro",
        cost: { input: 21, output: 168, cacheRead: 0, cacheWrite: 0 },
      },
      "openai/gpt-5.2-pro:batch": {
        id: "openai/gpt-5.2-pro:batch",
        displayName: "OpenAI: GPT-5.2 Pro (batch)",
        cost: { input: 10.5, output: 84, cacheRead: 0, cacheWrite: 0 },
      },
      "openai/gpt-5.2:batch": {
        id: "openai/gpt-5.2:batch",
        displayName: "OpenAI: GPT-5.2 (batch)",
        cost: { input: 0.875, output: 7, cacheRead: 0.0875, cacheWrite: 0 },
      },
      "openai/gpt-5.3-codex": {
        id: "openai/gpt-5.3-codex",
        displayName: "OpenAI: GPT-5.3-Codex",
        cost: { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 },
      },
      "openai/gpt-5.4": {
        id: "openai/gpt-5.4",
        displayName: "OpenAI: GPT-5.4",
        cost: { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 0 },
      },
      "openai/gpt-5.4-mini": {
        id: "openai/gpt-5.4-mini",
        displayName: "OpenAI: GPT-5.4 Mini",
        cost: { input: 0.75, output: 4.5, cacheRead: 0.075, cacheWrite: 0 },
      },
      "openai/gpt-5.4-mini:batch": {
        id: "openai/gpt-5.4-mini:batch",
        displayName: "OpenAI: GPT-5.4 Mini (batch)",
        cost: { input: 0.375, output: 2.25, cacheRead: 0.0375, cacheWrite: 0 },
      },
      "openai/gpt-5.4-nano": {
        id: "openai/gpt-5.4-nano",
        displayName: "OpenAI: GPT-5.4 Nano",
        cost: { input: 0.2, output: 1.25, cacheRead: 0.02, cacheWrite: 0 },
      },
      "openai/gpt-5.4-nano:batch": {
        id: "openai/gpt-5.4-nano:batch",
        displayName: "OpenAI: GPT-5.4 Nano (batch)",
        cost: { input: 0.1, output: 0.625, cacheRead: 0.01, cacheWrite: 0 },
      },
      "openai/gpt-5.4-pro": {
        id: "openai/gpt-5.4-pro",
        displayName: "OpenAI: GPT-5.4 Pro",
        cost: { input: 30, output: 180, cacheRead: 0, cacheWrite: 0 },
      },
      "openai/gpt-5.4-pro:batch": {
        id: "openai/gpt-5.4-pro:batch",
        displayName: "OpenAI: GPT-5.4 Pro (batch)",
        cost: { input: 15, output: 90, cacheRead: 0, cacheWrite: 0 },
      },
      "openai/gpt-5.4:batch": {
        id: "openai/gpt-5.4:batch",
        displayName: "OpenAI: GPT-5.4 (batch)",
        cost: { input: 1.25, output: 7.5, cacheRead: 0.125, cacheWrite: 0 },
      },
      "openai/gpt-5.5": {
        id: "openai/gpt-5.5",
        displayName: "OpenAI: GPT-5.5",
        cost: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 },
      },
      "openai/gpt-5.5-pro": {
        id: "openai/gpt-5.5-pro",
        displayName: "OpenAI: GPT-5.5 Pro",
        cost: { input: 30, output: 180, cacheRead: 0, cacheWrite: 0 },
      },
      "openai/gpt-5.5-pro:batch": {
        id: "openai/gpt-5.5-pro:batch",
        displayName: "OpenAI: GPT-5.5 Pro (batch)",
        cost: { input: 15, output: 90, cacheRead: 0, cacheWrite: 0 },
      },
      "openai/gpt-5.5:batch": {
        id: "openai/gpt-5.5:batch",
        displayName: "OpenAI: GPT-5.5 (batch)",
        cost: { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 0 },
      },
      "openai/gpt-5.6-luna": {
        id: "openai/gpt-5.6-luna",
        displayName: "OpenAI: GPT-5.6 Luna",
        cost: { input: 0.2, output: 1.2, cacheRead: 0.02, cacheWrite: 0.25 },
      },
      "openai/gpt-5.6-luna-pro": {
        id: "openai/gpt-5.6-luna-pro",
        displayName: "OpenAI: GPT-5.6 Luna Pro",
        cost: { input: 0.2, output: 1.2, cacheRead: 0.02, cacheWrite: 0.25 },
      },
      "openai/gpt-5.6-luna-pro:batch": {
        id: "openai/gpt-5.6-luna-pro:batch",
        displayName: "OpenAI: GPT-5.6 Luna Pro (batch)",
        cost: { input: 0.1, output: 0.6, cacheRead: 0.01, cacheWrite: 0 },
      },
      "openai/gpt-5.6-luna:batch": {
        id: "openai/gpt-5.6-luna:batch",
        displayName: "OpenAI: GPT-5.6 Luna (batch)",
        cost: { input: 0.1, output: 0.6, cacheRead: 0.01, cacheWrite: 0 },
      },
      "openai/gpt-5.6-sol": {
        id: "openai/gpt-5.6-sol",
        displayName: "OpenAI: GPT-5.6 Sol",
        cost: { input: 4, output: 20, cacheRead: 0.4, cacheWrite: 5 },
      },
      "openai/gpt-5.6-sol-pro": {
        id: "openai/gpt-5.6-sol-pro",
        displayName: "OpenAI: GPT-5.6 Sol Pro",
        cost: { input: 4, output: 20, cacheRead: 0.4, cacheWrite: 5 },
      },
      "openai/gpt-5.6-sol-pro:batch": {
        id: "openai/gpt-5.6-sol-pro:batch",
        displayName: "OpenAI: GPT-5.6 Sol Pro (batch)",
        cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
      },
      "openai/gpt-5.6-sol:batch": {
        id: "openai/gpt-5.6-sol:batch",
        displayName: "OpenAI: GPT-5.6 Sol (batch)",
        cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
      },
      "openai/gpt-5.6-terra": {
        id: "openai/gpt-5.6-terra",
        displayName: "OpenAI: GPT-5.6 Terra",
        cost: { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 2.5 },
      },
      "openai/gpt-5.6-terra-pro": {
        id: "openai/gpt-5.6-terra-pro",
        displayName: "OpenAI: GPT-5.6 Terra Pro",
        cost: { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 2.5 },
      },
      "openai/gpt-5.6-terra-pro:batch": {
        id: "openai/gpt-5.6-terra-pro:batch",
        displayName: "OpenAI: GPT-5.6 Terra Pro (batch)",
        cost: { input: 1, output: 6, cacheRead: 0.1, cacheWrite: 0 },
      },
      "openai/gpt-5.6-terra:batch": {
        id: "openai/gpt-5.6-terra:batch",
        displayName: "OpenAI: GPT-5.6 Terra (batch)",
        cost: { input: 1, output: 6, cacheRead: 0.1, cacheWrite: 0 },
      },
      "openai/gpt-6-astra": {
        id: "openai/gpt-6-astra",
        displayName: "OpenAI: GPT-6 Astra",
        cost: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
      },
      "openai/gpt-6-astra-pro": {
        id: "openai/gpt-6-astra-pro",
        displayName: "OpenAI: GPT-6 Astra Pro",
        cost: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
      },
      "openai/gpt-6-astra-pro:batch": {
        id: "openai/gpt-6-astra-pro:batch",
        displayName: "OpenAI: GPT-6 Astra Pro (batch)",
        cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
      },
      "openai/gpt-6-astra:batch": {
        id: "openai/gpt-6-astra:batch",
        displayName: "OpenAI: GPT-6 Astra (batch)",
        cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
      },
      "openai/gpt-6-luna": {
        id: "openai/gpt-6-luna",
        displayName: "OpenAI: GPT-6 Luna",
        cost: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
      },
      "openai/gpt-6-luna-pro": {
        id: "openai/gpt-6-luna-pro",
        displayName: "OpenAI: GPT-6 Luna Pro",
        cost: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
      },
      "openai/gpt-6-luna-pro:batch": {
        id: "openai/gpt-6-luna-pro:batch",
        displayName: "OpenAI: GPT-6 Luna Pro (batch)",
        cost: { input: 0.05, output: 0.25, cacheRead: 0.005, cacheWrite: 0.0625 },
      },
      "openai/gpt-6-luna:batch": {
        id: "openai/gpt-6-luna:batch",
        displayName: "OpenAI: GPT-6 Luna (batch)",
        cost: { input: 0.05, output: 0.25, cacheRead: 0.005, cacheWrite: 0.0625 },
      },
      "openai/gpt-6-sol": {
        id: "openai/gpt-6-sol",
        displayName: "OpenAI: GPT-6 Sol",
        cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
      },
      "openai/gpt-6-sol-pro": {
        id: "openai/gpt-6-sol-pro",
        displayName: "OpenAI: GPT-6 Sol Pro",
        cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
      },
      "openai/gpt-6-sol-pro:batch": {
        id: "openai/gpt-6-sol-pro:batch",
        displayName: "OpenAI: GPT-6 Sol Pro (batch)",
        cost: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
      },
      "openai/gpt-6-sol:batch": {
        id: "openai/gpt-6-sol:batch",
        displayName: "OpenAI: GPT-6 Sol (batch)",
        cost: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
      },
      "openai/gpt-6.1-sol": {
        id: "openai/gpt-6.1-sol",
        displayName: "OpenAI: GPT-6.1 Sol",
        cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
      },
      "openai/gpt-6.1-sol-pro": {
        id: "openai/gpt-6.1-sol-pro",
        displayName: "OpenAI: GPT-6.1 Sol Pro",
        cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
      },
      "openai/gpt-6.1-sol-pro:batch": {
        id: "openai/gpt-6.1-sol-pro:batch",
        displayName: "OpenAI: GPT-6.1 Sol Pro (batch)",
        cost: { input: 1, output: 5, cacheRead: 0.05, cacheWrite: 1.25 },
      },
      "openai/gpt-6.1-sol:batch": {
        id: "openai/gpt-6.1-sol:batch",
        displayName: "OpenAI: GPT-6.1 Sol (batch)",
        cost: { input: 1, output: 5, cacheRead: 0.05, cacheWrite: 1.25 },
      },
      "openai/gpt-audio": {
        id: "openai/gpt-audio",
        displayName: "OpenAI: GPT Audio",
        cost: { input: 2.5, output: 10, cacheRead: 0, cacheWrite: 0 },
      },
      "openai/gpt-audio-mini": {
        id: "openai/gpt-audio-mini",
        displayName: "OpenAI: GPT Audio Mini",
        cost: { input: 0.6, output: 2.4, cacheRead: 0, cacheWrite: 0 },
      },
      "openai/gpt-chat-latest": {
        id: "openai/gpt-chat-latest",
        displayName: "OpenAI: GPT Chat Latest",
        cost: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 },
      },
      "openai/gpt-oss-120b": {
        id: "openai/gpt-oss-120b",
        displayName: "OpenAI: gpt-oss-120b",
        cost: { input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite: 0 },
      },
      "openai/gpt-oss-120b:batch": {
        id: "openai/gpt-oss-120b:batch",
        displayName: "OpenAI: gpt-oss-120b (batch)",
        cost: { input: 0.0296, output: 0.136, cacheRead: 0, cacheWrite: 0 },
      },
      "openai/gpt-oss-20b": {
        id: "openai/gpt-oss-20b",
        displayName: "OpenAI: gpt-oss-20b",
        cost: { input: 0.018, output: 0.09, cacheRead: 0.009, cacheWrite: 0 },
      },
      "openai/gpt-oss-20b:batch": {
        id: "openai/gpt-oss-20b:batch",
        displayName: "OpenAI: gpt-oss-20b (batch)",
        cost: { input: 0.024, output: 0.112, cacheRead: 0, cacheWrite: 0 },
      },
      "openai/gpt-oss-safeguard-20b": {
        id: "openai/gpt-oss-safeguard-20b",
        displayName: "OpenAI: gpt-oss-safeguard-20b",
        cost: { input: 0.075, output: 0.3, cacheRead: 0.0375, cacheWrite: 0 },
      },
      "openai/o1": {
        id: "openai/o1",
        displayName: "OpenAI: o1",
        cost: { input: 15, output: 60, cacheRead: 7.5, cacheWrite: 0 },
      },
      "openai/o3": {
        id: "openai/o3",
        displayName: "OpenAI: o3",
        cost: { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 0 },
      },
      "openai/o3-mini": {
        id: "openai/o3-mini",
        displayName: "OpenAI: o3 Mini",
        cost: { input: 1.1, output: 4.4, cacheRead: 0.55, cacheWrite: 0 },
      },
      "openai/o3-mini-high": {
        id: "openai/o3-mini-high",
        displayName: "OpenAI: o3 Mini High",
        cost: { input: 1.1, output: 4.4, cacheRead: 0.55, cacheWrite: 0 },
      },
      "openai/o3-mini:batch": {
        id: "openai/o3-mini:batch",
        displayName: "OpenAI: o3 Mini (batch)",
        cost: { input: 0.55, output: 2.2, cacheRead: 0.275, cacheWrite: 0 },
      },
      "openai/o3-pro": {
        id: "openai/o3-pro",
        displayName: "OpenAI: o3 Pro",
        cost: { input: 20, output: 80, cacheRead: 0, cacheWrite: 0 },
      },
      "openai/o3:batch": {
        id: "openai/o3:batch",
        displayName: "OpenAI: o3 (batch)",
        cost: { input: 1, output: 4, cacheRead: 0.25, cacheWrite: 0 },
      },
      "openai/o4-mini": {
        id: "openai/o4-mini",
        displayName: "OpenAI: o4 Mini",
        cost: { input: 1.1, output: 4.4, cacheRead: 0.275, cacheWrite: 0 },
      },
      "openai/o4-mini-high": {
        id: "openai/o4-mini-high",
        displayName: "OpenAI: o4 Mini High",
        cost: { input: 1.1, output: 4.4, cacheRead: 0.275, cacheWrite: 0 },
      },
      "openai/o4-mini:batch": {
        id: "openai/o4-mini:batch",
        displayName: "OpenAI: o4 Mini (batch)",
        cost: { input: 0.55, output: 2.2, cacheRead: 0.1375, cacheWrite: 0 },
      },
      "openrouter/auto": {
        id: "openrouter/auto",
        displayName: "Auto Router",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "openrouter/auto-beta": {
        id: "openrouter/auto-beta",
        displayName: "Auto Router (Beta)",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "openrouter/free": {
        id: "openrouter/free",
        displayName: "Free Models Router",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "openrouter/fusion": {
        id: "openrouter/fusion",
        displayName: "OpenRouter: Fusion",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "openrouter/pareto-code": {
        id: "openrouter/pareto-code",
        displayName: "Pareto Code Router",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "perceptron/perceptron-mk1.5": {
        id: "perceptron/perceptron-mk1.5",
        displayName: "Perceptron: Perceptron Mk1.5",
        cost: { input: 0.15, output: 1.5, cacheRead: 0, cacheWrite: 0 },
      },
      "poolside/laguna-s-2.1": {
        id: "poolside/laguna-s-2.1",
        displayName: "Poolside: Laguna S 2.1",
        cost: { input: 0.09, output: 0.18, cacheRead: 0.009, cacheWrite: 0 },
      },
      "poolside/laguna-s-2.1:free": {
        id: "poolside/laguna-s-2.1:free",
        displayName: "Poolside: Laguna S 2.1 (free)",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "poolside/laguna-xs-2.1": {
        id: "poolside/laguna-xs-2.1",
        displayName: "Poolside: Laguna XS 2.1",
        cost: { input: 0.06, output: 0.12, cacheRead: 0.03, cacheWrite: 0 },
      },
      "poolside/laguna-xs-2.1:free": {
        id: "poolside/laguna-xs-2.1:free",
        displayName: "Poolside: Laguna XS 2.1 (free)",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "prism-ml/ternary-bonsai-2-27b": {
        id: "prism-ml/ternary-bonsai-2-27b",
        displayName: "PrismML: Ternary Bonsai 2 27B",
        cost: { input: 0.075, output: 0.5, cacheRead: 0.0375, cacheWrite: 0 },
      },
      "qwen/qwen-2.5-72b-instruct": {
        id: "qwen/qwen-2.5-72b-instruct",
        displayName: "Qwen2.5 72B Instruct",
        cost: { input: 0.36, output: 0.4, cacheRead: 0, cacheWrite: 0 },
      },
      "qwen/qwen-2.5-7b-instruct": {
        id: "qwen/qwen-2.5-7b-instruct",
        displayName: "Qwen: Qwen2.5 7B Instruct",
        cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0 },
      },
      "qwen/qwen-plus": {
        id: "qwen/qwen-plus",
        displayName: "Qwen: Qwen-Plus",
        cost: { input: 0.26, output: 0.78, cacheRead: 0.052, cacheWrite: 0.325 },
      },
      "qwen/qwen3-14b": {
        id: "qwen/qwen3-14b",
        displayName: "Qwen: Qwen3 14B",
        cost: { input: 0.12, output: 0.24, cacheRead: 0, cacheWrite: 0 },
      },
      "qwen/qwen3-235b-a22b-2507": {
        id: "qwen/qwen3-235b-a22b-2507",
        displayName: "Qwen: Qwen3 235B A22B Instruct 2507",
        cost: { input: 0.09, output: 0.55, cacheRead: 0, cacheWrite: 0 },
      },
      "qwen/qwen3-235b-a22b-thinking-2507": {
        id: "qwen/qwen3-235b-a22b-thinking-2507",
        displayName: "Qwen: Qwen3 235B A22B Thinking 2507",
        cost: { input: 0.45, output: 3.5, cacheRead: 0, cacheWrite: 0 },
      },
      "qwen/qwen3-30b-a3b": {
        id: "qwen/qwen3-30b-a3b",
        displayName: "Qwen: Qwen3 30B A3B",
        cost: { input: 0.12, output: 0.5, cacheRead: 0, cacheWrite: 0 },
      },
      "qwen/qwen3-30b-a3b-instruct-2507": {
        id: "qwen/qwen3-30b-a3b-instruct-2507",
        displayName: "Qwen: Qwen3 30B A3B Instruct 2507",
        cost: { input: 0.1, output: 0.3, cacheRead: 0, cacheWrite: 0 },
      },
      "qwen/qwen3-32b": {
        id: "qwen/qwen3-32b",
        displayName: "Qwen: Qwen3 32B",
        cost: { input: 0.08, output: 0.28, cacheRead: 0, cacheWrite: 0 },
      },
      "qwen/qwen3-coder": {
        id: "qwen/qwen3-coder",
        displayName: "Qwen: Qwen3 Coder 480B A35B",
        cost: { input: 0.3, output: 1, cacheRead: 0.1, cacheWrite: 0 },
      },
      "qwen/qwen3-coder-30b-a3b-instruct": {
        id: "qwen/qwen3-coder-30b-a3b-instruct",
        displayName: "Qwen: Qwen3 Coder 30B A3B Instruct",
        cost: { input: 0.07, output: 0.28, cacheRead: 0, cacheWrite: 0 },
      },
      "qwen/qwen3-coder-flash": {
        id: "qwen/qwen3-coder-flash",
        displayName: "Qwen: Qwen3 Coder Flash",
        cost: { input: 0.195, output: 0.975, cacheRead: 0.039, cacheWrite: 0.24375 },
      },
      "qwen/qwen3-coder-next": {
        id: "qwen/qwen3-coder-next",
        displayName: "Qwen: Qwen3 Coder Next",
        cost: { input: 0.12, output: 0.8, cacheRead: 0.07, cacheWrite: 0 },
      },
      "qwen/qwen3-next-80b-a3b-instruct": {
        id: "qwen/qwen3-next-80b-a3b-instruct",
        displayName: "Qwen: Qwen3 Next 80B A3B Instruct",
        cost: { input: 0.1, output: 1.1, cacheRead: 0.07, cacheWrite: 0 },
      },
      "qwen/qwen3-next-80b-a3b-thinking": {
        id: "qwen/qwen3-next-80b-a3b-thinking",
        displayName: "Qwen: Qwen3 Next 80B A3B Thinking",
        cost: { input: 0.15, output: 1.2, cacheRead: 0, cacheWrite: 0 },
      },
      "qwen/qwen3-vl-235b-a22b-instruct": {
        id: "qwen/qwen3-vl-235b-a22b-instruct",
        displayName: "Qwen: Qwen3 VL 235B A22B Instruct",
        cost: { input: 0.21, output: 1.9, cacheRead: 0.1, cacheWrite: 0 },
      },
      "qwen/qwen3-vl-30b-a3b-instruct": {
        id: "qwen/qwen3-vl-30b-a3b-instruct",
        displayName: "Qwen: Qwen3 VL 30B A3B Instruct",
        cost: { input: 0.15, output: 0.6, cacheRead: 0, cacheWrite: 0 },
      },
      "qwen/qwen3-vl-30b-a3b-thinking": {
        id: "qwen/qwen3-vl-30b-a3b-thinking",
        displayName: "Qwen: Qwen3 VL 30B A3B Thinking",
        cost: { input: 0.29, output: 1, cacheRead: 0, cacheWrite: 0 },
      },
      "qwen/qwen3-vl-8b-instruct": {
        id: "qwen/qwen3-vl-8b-instruct",
        displayName: "Qwen: Qwen3 VL 8B Instruct",
        cost: { input: 0.25, output: 0.75, cacheRead: 0.12, cacheWrite: 0 },
      },
      "qwen/qwen3.5-122b-a10b": {
        id: "qwen/qwen3.5-122b-a10b",
        displayName: "Qwen: Qwen3.5-122B-A10B",
        cost: { input: 0.26, output: 2.08, cacheRead: 0, cacheWrite: 0 },
      },
      "qwen/qwen3.5-27b": {
        id: "qwen/qwen3.5-27b",
        displayName: "Qwen: Qwen3.5-27B",
        cost: { input: 0.26, output: 2.6, cacheRead: 0, cacheWrite: 0 },
      },
      "qwen/qwen3.5-35b-a3b": {
        id: "qwen/qwen3.5-35b-a3b",
        displayName: "Qwen: Qwen3.5-35B-A3B",
        cost: { input: 0.15, output: 1, cacheRead: 0.05, cacheWrite: 0 },
      },
      "qwen/qwen3.5-397b-a17b": {
        id: "qwen/qwen3.5-397b-a17b",
        displayName: "Qwen: Qwen3.5 397B A17B",
        cost: { input: 0.5, output: 3.6, cacheRead: 0.3, cacheWrite: 0 },
      },
      "qwen/qwen3.5-9b": {
        id: "qwen/qwen3.5-9b",
        displayName: "Qwen: Qwen3.5-9B",
        cost: { input: 0.1, output: 0.15, cacheRead: 0, cacheWrite: 0 },
      },
      "qwen/qwen3.5-flash-02-23": {
        id: "qwen/qwen3.5-flash-02-23",
        displayName: "Qwen: Qwen3.5-Flash",
        cost: { input: 0.065, output: 0.26, cacheRead: 0, cacheWrite: 0 },
      },
      "qwen/qwen3.5-plus-02-15": {
        id: "qwen/qwen3.5-plus-02-15",
        displayName: "Qwen: Qwen3.5 Plus 2026-02-15",
        cost: { input: 0.26, output: 1.56, cacheRead: 0, cacheWrite: 0 },
      },
      "qwen/qwen3.5-plus-20260420": {
        id: "qwen/qwen3.5-plus-20260420",
        displayName: "Qwen: Qwen3.5 Plus 2026-04-20",
        cost: { input: 0.3, output: 1.8, cacheRead: 0, cacheWrite: 0.375 },
      },
      "qwen/qwen3.6-27b": {
        id: "qwen/qwen3.6-27b",
        displayName: "Qwen: Qwen3.6 27B",
        cost: { input: 0.25, output: 2, cacheRead: 0.025, cacheWrite: 0 },
      },
      "qwen/qwen3.6-35b-a3b": {
        id: "qwen/qwen3.6-35b-a3b",
        displayName: "Qwen: Qwen3.6 35B A3B",
        cost: { input: 0.15, output: 1, cacheRead: 0.05, cacheWrite: 0 },
      },
      "qwen/qwen3.6-flash": {
        id: "qwen/qwen3.6-flash",
        displayName: "Qwen: Qwen3.6 Flash",
        cost: { input: 0.1875, output: 1.125, cacheRead: 0, cacheWrite: 0.234375 },
      },
      "qwen/qwen3.6-plus": {
        id: "qwen/qwen3.6-plus",
        displayName: "Qwen: Qwen3.6 Plus",
        cost: { input: 0.325, output: 1.95, cacheRead: 0, cacheWrite: 0.40625 },
      },
      "qwen/qwen3.7-flash": {
        id: "qwen/qwen3.7-flash",
        displayName: "Qwen: Qwen3.7 Flash",
        cost: { input: 0.03, output: 0.13, cacheRead: 0.006, cacheWrite: 0.038 },
      },
      "qwen/qwen3.7-max": {
        id: "qwen/qwen3.7-max",
        displayName: "Qwen: Qwen3.7 Max",
        cost: { input: 1.475, output: 4.425, cacheRead: 0.295, cacheWrite: 1.84375 },
      },
      "qwen/qwen3.7-plus": {
        id: "qwen/qwen3.7-plus",
        displayName: "Qwen: Qwen3.7 Plus",
        cost: { input: 0.32, output: 1.28, cacheRead: 0.064, cacheWrite: 0.4 },
      },
      "qwen/qwen3.8-2.4t-a95b": {
        id: "qwen/qwen3.8-2.4t-a95b",
        displayName: "Qwen: Qwen3.8 2.4T A95B",
        cost: { input: 2, output: 6, cacheRead: 0.25, cacheWrite: 0 },
      },
      "qwen/qwen3.8-27b": {
        id: "qwen/qwen3.8-27b",
        displayName: "Qwen: Qwen3.8 27B",
        cost: { input: 0.24, output: 2.2, cacheRead: 0.05, cacheWrite: 0 },
      },
      "qwen/qwen3.8-flash": {
        id: "qwen/qwen3.8-flash",
        displayName: "Qwen: Qwen3.8 Flash",
        cost: { input: 0.15, output: 0.47, cacheRead: 0.016, cacheWrite: 0 },
      },
      "qwen/qwen3.8-max-0902": {
        id: "qwen/qwen3.8-max-0902",
        displayName: "Qwen: Qwen3.8 Max (0902)",
        cost: { input: 2, output: 6, cacheRead: 0.25, cacheWrite: 0 },
      },
      "qwen/qwen3.8-max-prime": {
        id: "qwen/qwen3.8-max-prime",
        displayName: "Qwen: Qwen3.8 Max Prime",
        cost: { input: 4, output: 12, cacheRead: 0.5, cacheWrite: 0 },
      },
      "qwen/qwen3.8-omni-flash": {
        id: "qwen/qwen3.8-omni-flash",
        displayName: "Qwen: Qwen3.8 Omni Flash",
        cost: { input: 0.15, output: 0.47, cacheRead: 0.016, cacheWrite: 0 },
      },
      "rekaai/reka-edge": {
        id: "rekaai/reka-edge",
        displayName: "Reka Edge",
        cost: { input: 0.1, output: 0.1, cacheRead: 0, cacheWrite: 0 },
      },
      "relace/relace-search": {
        id: "relace/relace-search",
        displayName: "Relace: Relace Search",
        cost: { input: 1, output: 3, cacheRead: 0, cacheWrite: 0 },
      },
      "sakana/fugu-max": {
        id: "sakana/fugu-max",
        displayName: "Sakana: Fugu Max",
        cost: { input: 2, output: 6, cacheRead: 0.25, cacheWrite: 0 },
      },
      "sakana/fugu-ultra": {
        id: "sakana/fugu-ultra",
        displayName: "Sakana: Fugu Ultra",
        cost: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 },
      },
      "sakana/fugu-ultra-v2": {
        id: "sakana/fugu-ultra-v2",
        displayName: "Sakana: Fugu Ultra v2",
        cost: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 },
      },
      "sakana/sakana-namazu": {
        id: "sakana/sakana-namazu",
        displayName: "Sakana: Sakana Namazu",
        cost: { input: 0.95, output: 4, cacheRead: 0.15, cacheWrite: 0 },
      },
      "stepfun/step-3.5-flash": {
        id: "stepfun/step-3.5-flash",
        displayName: "StepFun: Step 3.5 Flash",
        cost: { input: 0.1, output: 0.3, cacheRead: 0, cacheWrite: 0 },
      },
      "stepfun/step-3.7-flash": {
        id: "stepfun/step-3.7-flash",
        displayName: "StepFun: Step 3.7 Flash",
        cost: { input: 0.2, output: 1.15, cacheRead: 0.04, cacheWrite: 0 },
      },
      "stepfun/step-5-preview": {
        id: "stepfun/step-5-preview",
        displayName: "StepFun: Step 5 Preview",
        cost: { input: 1, output: 2.7, cacheRead: 0.05, cacheWrite: 0 },
      },
      "tencent/hy3": {
        id: "tencent/hy3",
        displayName: "Tencent: Hy3",
        cost: { input: 0.0825, output: 0.33, cacheRead: 0.020625, cacheWrite: 0 },
      },
      "tencent/hy3-preview": {
        id: "tencent/hy3-preview",
        displayName: "Tencent: Hy3 preview",
        cost: { input: 0.18, output: 0.6, cacheRead: 0.06, cacheWrite: 0 },
      },
      "tencent/hy4-preview": {
        id: "tencent/hy4-preview",
        displayName: "Tencent: Hy4 preview",
        cost: { input: 0.7506, output: 2.2509, cacheRead: 0.0378, cacheWrite: 0 },
      },
      "thinkingmachines/inkling": {
        id: "thinkingmachines/inkling",
        displayName: "Thinking Machines: Inkling",
        cost: { input: 1, output: 4.05, cacheRead: 0.17, cacheWrite: 0 },
      },
      "thinkingmachines/inkling-small": {
        id: "thinkingmachines/inkling-small",
        displayName: "Thinking Machines: Inkling Small",
        cost: { input: 0.45, output: 1.2, cacheRead: 0.1, cacheWrite: 0 },
      },
      "thinkingmachines/inkling-small:free": {
        id: "thinkingmachines/inkling-small:free",
        displayName: "Thinking Machines: Inkling Small (free)",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "thinkingmachines/inkling:free": {
        id: "thinkingmachines/inkling:free",
        displayName: "Thinking Machines: Inkling (free)",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "typesafe/jev-router": {
        id: "typesafe/jev-router",
        displayName: "TypeSafe: Jev Router",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "unbiased/pareto-26.9": {
        id: "unbiased/pareto-26.9",
        displayName: "Pareto 26.9",
        cost: { input: 2.5, output: 7.5, cacheRead: 0.25, cacheWrite: 0 },
      },
      "upstage/solar-mini4": {
        id: "upstage/solar-mini4",
        displayName: "Upstage: Solar Mini 4",
        cost: { input: 0.05, output: 0.2, cacheRead: 0.005, cacheWrite: 0 },
      },
      "upstage/solar-pro-3": {
        id: "upstage/solar-pro-3",
        displayName: "Upstage: Solar Pro 3",
        cost: { input: 0.15, output: 0.6, cacheRead: 0.015, cacheWrite: 0 },
      },
      "upstage/solar-pro4": {
        id: "upstage/solar-pro4",
        displayName: "Upstage: Solar Pro 4",
        cost: { input: 0.09, output: 0.36, cacheRead: 0.018, cacheWrite: 0 },
      },
      "x-ai/grok-4.20": {
        id: "x-ai/grok-4.20",
        displayName: "SpaceXAI: Grok 4.20",
        cost: { input: 1.25, output: 2.5, cacheRead: 0.2, cacheWrite: 0 },
      },
      "x-ai/grok-4.3": {
        id: "x-ai/grok-4.3",
        displayName: "SpaceXAI: Grok 4.3",
        cost: { input: 1.25, output: 2.5, cacheRead: 0.2, cacheWrite: 0 },
      },
      "x-ai/grok-4.3:batch": {
        id: "x-ai/grok-4.3:batch",
        displayName: "SpaceXAI: Grok 4.3 (batch)",
        cost: { input: 1, output: 2, cacheRead: 0.16, cacheWrite: 0 },
      },
      "x-ai/grok-4.5": {
        id: "x-ai/grok-4.5",
        displayName: "SpaceXAI: Grok 4.5",
        cost: { input: 2, output: 6, cacheRead: 0.3, cacheWrite: 0 },
      },
      "x-ai/grok-4.6": {
        id: "x-ai/grok-4.6",
        displayName: "SpaceXAI: Grok 4.6",
        cost: { input: 2, output: 6, cacheRead: 0.5, cacheWrite: 0 },
      },
      "x-ai/grok-4.7": {
        id: "x-ai/grok-4.7",
        displayName: "SpaceXAI: Grok 4.7",
        cost: { input: 2, output: 6, cacheRead: 0.5, cacheWrite: 0 },
      },
      "x-ai/grok-build-0.1": {
        id: "x-ai/grok-build-0.1",
        displayName: "SpaceXAI: Grok Build 0.1",
        cost: { input: 1, output: 2, cacheRead: 0.2, cacheWrite: 0 },
      },
      "xiaomi/mimo-v2.5": {
        id: "xiaomi/mimo-v2.5",
        displayName: "Xiaomi: MiMo-V2.5",
        cost: { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0 },
      },
      "xiaomi/mimo-v2.5-pro": {
        id: "xiaomi/mimo-v2.5-pro",
        displayName: "Xiaomi: MiMo-V2.5-Pro",
        cost: { input: 0.435, output: 0.87, cacheRead: 0.0036, cacheWrite: 0 },
      },
      "xiaomi/mimo-v2.6-flash": {
        id: "xiaomi/mimo-v2.6-flash",
        displayName: "Xiaomi: MiMo-V2.6-Flash",
        cost: { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0 },
      },
      "xiaomi/mimo-v2.6-pro": {
        id: "xiaomi/mimo-v2.6-pro",
        displayName: "Xiaomi: MiMo-V2.6-Pro",
        cost: { input: 0.435, output: 0.87, cacheRead: 0.0036, cacheWrite: 0 },
      },
      "xiaomi/mimo-v2.6-pro-ultraspeed": {
        id: "xiaomi/mimo-v2.6-pro-ultraspeed",
        displayName: "Xiaomi: MiMo-V2.6-Pro-UltraSpeed",
        cost: { input: 4.35, output: 8.7, cacheRead: 0.036, cacheWrite: 0 },
      },
      "z-ai/glm-4.5": {
        id: "z-ai/glm-4.5",
        displayName: "Z.ai: GLM 4.5",
        cost: { input: 0.6, output: 2.2, cacheRead: 0.11, cacheWrite: 0 },
      },
      "z-ai/glm-4.5-air": {
        id: "z-ai/glm-4.5-air",
        displayName: "Z.ai: GLM 4.5 Air",
        cost: { input: 0.13, output: 0.85, cacheRead: 0.025, cacheWrite: 0 },
      },
      "z-ai/glm-4.5v": {
        id: "z-ai/glm-4.5v",
        displayName: "Z.ai: GLM 4.5V",
        cost: { input: 0.6, output: 1.8, cacheRead: 0.11, cacheWrite: 0 },
      },
      "z-ai/glm-4.6": {
        id: "z-ai/glm-4.6",
        displayName: "Z.ai: GLM 4.6",
        cost: { input: 0.5, output: 2, cacheRead: 0.1, cacheWrite: 0 },
      },
      "z-ai/glm-4.6v": {
        id: "z-ai/glm-4.6v",
        displayName: "Z.ai: GLM 4.6V",
        cost: { input: 0.3, output: 0.9, cacheRead: 0.055, cacheWrite: 0 },
      },
      "z-ai/glm-4.7": {
        id: "z-ai/glm-4.7",
        displayName: "Z.ai: GLM 4.7",
        cost: { input: 0.6, output: 2.2, cacheRead: 0.11, cacheWrite: 0 },
      },
      "z-ai/glm-4.7-flash": {
        id: "z-ai/glm-4.7-flash",
        displayName: "Z.ai: GLM 4.7 Flash",
        cost: { input: 0.0605, output: 0.4, cacheRead: 0, cacheWrite: 0 },
      },
      "z-ai/glm-5": {
        id: "z-ai/glm-5",
        displayName: "Z.ai: GLM 5",
        cost: { input: 0.6, output: 1.9, cacheRead: 0.119, cacheWrite: 0 },
      },
      "z-ai/glm-5-turbo": {
        id: "z-ai/glm-5-turbo",
        displayName: "Z.ai: GLM 5 Turbo",
        cost: { input: 1.2, output: 4, cacheRead: 0.24, cacheWrite: 0 },
      },
      "z-ai/glm-5.1": {
        id: "z-ai/glm-5.1",
        displayName: "Z.ai: GLM 5.1",
        cost: { input: 0.966, output: 3.036, cacheRead: 0.1794, cacheWrite: 0 },
      },
      "z-ai/glm-5.2": {
        id: "z-ai/glm-5.2",
        displayName: "Z.ai: GLM 5.2",
        cost: { input: 0.65, output: 10, cacheRead: 0.649, cacheWrite: 0 },
      },
      "z-ai/glm-5.3": {
        id: "z-ai/glm-5.3",
        displayName: "Z.ai: GLM 5.3",
        cost: { input: 0.11, output: 6, cacheRead: 0.109, cacheWrite: 0 },
      },
      "z-ai/glm-5.3-flash": {
        id: "z-ai/glm-5.3-flash",
        displayName: "Z.ai: GLM 5.3 Flash",
        cost: { input: 0.15, output: 0.5, cacheRead: 0.03, cacheWrite: 0 },
      },
      "z-ai/glm-5.3-flash:batch": {
        id: "z-ai/glm-5.3-flash:batch",
        displayName: "Z.ai: GLM 5.3 Flash (batch)",
        cost: { input: 0.06, output: 0.2, cacheRead: 0.012, cacheWrite: 0 },
      },
      "z-ai/glm-5.3-flashx": {
        id: "z-ai/glm-5.3-flashx",
        displayName: "Z.ai: GLM 5.3 FlashX",
        cost: { input: 0.37, output: 1.25, cacheRead: 0.09, cacheWrite: 0 },
      },
      "z-ai/glm-5.3-prime": {
        id: "z-ai/glm-5.3-prime",
        displayName: "Z.ai: GLM 5.3 Prime",
        cost: { input: 2.8, output: 8.8, cacheRead: 0.56, cacheWrite: 0 },
      },
      "z-ai/glm-5.3:batch": {
        id: "z-ai/glm-5.3:batch",
        displayName: "Z.ai: GLM 5.3 (batch)",
        cost: { input: 0.45, output: 2, cacheRead: 0.1, cacheWrite: 0 },
      },
      "z-ai/glm-5v-turbo": {
        id: "z-ai/glm-5v-turbo",
        displayName: "Z.ai: GLM 5V Turbo",
        cost: { input: 1.2, output: 4, cacheRead: 0.24, cacheWrite: 0 },
      },
    },
  },
  {
    id: "qwen-token-plan",
    displayName: "Qwen Token Plan",
    providerType: "openai-compatible",
    defaultBaseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
    models: {
      "deepseek-v3.2": {
        id: "deepseek-v3.2",
        displayName: "DeepSeek V3.2",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "deepseek-v4-flash": {
        id: "deepseek-v4-flash",
        displayName: "DeepSeek V4 Flash",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "deepseek-v4-flash-0731": {
        id: "deepseek-v4-flash-0731",
        displayName: "DeepSeek V4 Flash 0731",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "deepseek-v4-pro": {
        id: "deepseek-v4-pro",
        displayName: "DeepSeek V4 Pro",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "deepseek-v4-pro-0813": {
        id: "deepseek-v4-pro-0813",
        displayName: "DeepSeek V4 Pro 0813",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "deepseek-v4.1-flash": {
        id: "deepseek-v4.1-flash",
        displayName: "DeepSeek V4.1 Flash",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "glm-5": {
        id: "glm-5",
        displayName: "GLM-5",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "glm-5.1": {
        id: "glm-5.1",
        displayName: "GLM-5.1",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "glm-5.2": {
        id: "glm-5.2",
        displayName: "GLM-5.2",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "glm-5.3": {
        id: "glm-5.3",
        displayName: "GLM-5.3",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "kimi-k2.5": {
        id: "kimi-k2.5",
        displayName: "Kimi K2.5",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "kimi-k2.6": {
        id: "kimi-k2.6",
        displayName: "Kimi K2.6",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "kimi-k2.7-code": {
        id: "kimi-k2.7-code",
        displayName: "Kimi K2.7 Code",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "MiniMax-M2.5": {
        id: "MiniMax-M2.5",
        displayName: "MiniMax-M2.5",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "qwen3.6-flash": {
        id: "qwen3.6-flash",
        displayName: "Qwen3.6 Flash",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "qwen3.6-plus": {
        id: "qwen3.6-plus",
        displayName: "Qwen3.6 Plus",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "qwen3.7-max": {
        id: "qwen3.7-max",
        displayName: "Qwen3.7 Max",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "qwen3.7-plus": {
        id: "qwen3.7-plus",
        displayName: "Qwen3.7 Plus",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "qwen3.8-flash": {
        id: "qwen3.8-flash",
        displayName: "Qwen3.8 Flash",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "qwen3.8-max": {
        id: "qwen3.8-max",
        displayName: "Qwen3.8 Max",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
    },
  },
  {
    id: "qwen-token-plan-cn",
    displayName: "Qwen Token Plan CN",
    providerType: "openai-compatible",
    defaultBaseUrl: "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
    models: {
      "deepseek-v3.2": {
        id: "deepseek-v3.2",
        displayName: "DeepSeek V3.2",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "deepseek-v4-flash": {
        id: "deepseek-v4-flash",
        displayName: "DeepSeek V4 Flash",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "deepseek-v4-flash-0731": {
        id: "deepseek-v4-flash-0731",
        displayName: "DeepSeek V4 Flash 0731",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "deepseek-v4-pro": {
        id: "deepseek-v4-pro",
        displayName: "DeepSeek V4 Pro",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "deepseek-v4-pro-0813": {
        id: "deepseek-v4-pro-0813",
        displayName: "DeepSeek V4 Pro 0813",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "deepseek-v4.1-flash": {
        id: "deepseek-v4.1-flash",
        displayName: "DeepSeek V4.1 Flash",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "glm-5": {
        id: "glm-5",
        displayName: "GLM-5",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "glm-5.1": {
        id: "glm-5.1",
        displayName: "GLM-5.1",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "glm-5.2": {
        id: "glm-5.2",
        displayName: "GLM-5.2",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "glm-5.3": {
        id: "glm-5.3",
        displayName: "GLM-5.3",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "kimi-k2.5": {
        id: "kimi-k2.5",
        displayName: "Kimi K2.5",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "kimi-k2.6": {
        id: "kimi-k2.6",
        displayName: "Kimi K2.6",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "kimi-k2.7-code": {
        id: "kimi-k2.7-code",
        displayName: "Kimi K2.7 Code",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "MiniMax-M2.5": {
        id: "MiniMax-M2.5",
        displayName: "MiniMax-M2.5",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "qwen3.6-flash": {
        id: "qwen3.6-flash",
        displayName: "Qwen3.6 Flash",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "qwen3.6-plus": {
        id: "qwen3.6-plus",
        displayName: "Qwen3.6 Plus",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "qwen3.7-max": {
        id: "qwen3.7-max",
        displayName: "Qwen3.7 Max",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "qwen3.7-plus": {
        id: "qwen3.7-plus",
        displayName: "Qwen3.7 Plus",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "qwen3.8-flash": {
        id: "qwen3.8-flash",
        displayName: "Qwen3.8 Flash",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "qwen3.8-max": {
        id: "qwen3.8-max",
        displayName: "Qwen3.8 Max",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
    },
  },
  {
    id: "qwen-token-plan-individual",
    displayName: "Qwen Token Plan Individual",
    providerType: "openai-compatible",
    defaultBaseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
    models: {
      "deepseek-v4-flash-0731": {
        id: "deepseek-v4-flash-0731",
        displayName: "DeepSeek V4 Flash 0731",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "deepseek-v4-pro": {
        id: "deepseek-v4-pro",
        displayName: "DeepSeek V4 Pro",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "deepseek-v4-pro-0813": {
        id: "deepseek-v4-pro-0813",
        displayName: "DeepSeek V4 Pro 0813",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "glm-5.2": {
        id: "glm-5.2",
        displayName: "GLM-5.2",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "qwen3.6-flash": {
        id: "qwen3.6-flash",
        displayName: "Qwen3.6 Flash",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "qwen3.7-max": {
        id: "qwen3.7-max",
        displayName: "Qwen3.7 Max",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "qwen3.7-plus": {
        id: "qwen3.7-plus",
        displayName: "Qwen3.7 Plus",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "qwen3.8-flash": {
        id: "qwen3.8-flash",
        displayName: "Qwen3.8 Flash",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "qwen3.8-max": {
        id: "qwen3.8-max",
        displayName: "Qwen3.8 Max",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
    },
  },
  {
    id: "together",
    displayName: "Together",
    providerType: "openai-compatible",
    defaultBaseUrl: "https://api.together.ai/v1",
    models: {
      "deepseek-ai/DeepSeek-V4-Flash-0731": {
        id: "deepseek-ai/DeepSeek-V4-Flash-0731",
        displayName: "DeepSeek V4 Flash 0731",
        cost: { input: 0.14, output: 0.28, cacheRead: 0.03, cacheWrite: 0 },
      },
      "deepseek-ai/DeepSeek-V4-Pro-0813": {
        id: "deepseek-ai/DeepSeek-V4-Pro-0813",
        displayName: "DeepSeek V4 Pro 0813",
        cost: { input: 1.32, output: 3.96, cacheRead: 0.13, cacheWrite: 0 },
      },
      "deepseek-ai/DeepSeek-V4.1-Flash": {
        id: "deepseek-ai/DeepSeek-V4.1-Flash",
        displayName: "DeepSeek V4.1 Flash",
        cost: { input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0 },
      },
      "meta-llama/Llama-3.3-70B-Instruct-Turbo": {
        id: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
        displayName: "Llama 3.3 70B",
        cost: { input: 1.04, output: 1.04, cacheRead: 0, cacheWrite: 0 },
      },
      "MiniMaxAI/MiniMax-M2.7": {
        id: "MiniMaxAI/MiniMax-M2.7",
        displayName: "MiniMax-M2.7",
        cost: { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0 },
      },
      "MiniMaxAI/MiniMax-M3": {
        id: "MiniMaxAI/MiniMax-M3",
        displayName: "MiniMax-M3",
        cost: { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0 },
      },
      "moonshotai/Kimi-K3": {
        id: "moonshotai/Kimi-K3",
        displayName: "Kimi K3",
        cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 0 },
      },
      "nvidia/nemotron-3-ultra-550b-a55b": {
        id: "nvidia/nemotron-3-ultra-550b-a55b",
        displayName: "Nemotron 3 Ultra 550B A55B",
        cost: { input: 0.6, output: 3.6, cacheRead: 0.2, cacheWrite: 0 },
      },
      "openai/gpt-oss-120b": {
        id: "openai/gpt-oss-120b",
        displayName: "GPT OSS 120B",
        cost: { input: 0.15, output: 0.6, cacheRead: 0, cacheWrite: 0 },
      },
      "Qwen/Qwen2.5-7B-Instruct-Turbo": {
        id: "Qwen/Qwen2.5-7B-Instruct-Turbo",
        displayName: "Qwen 2.5 7B Instruct Turbo",
        cost: { input: 0.3, output: 0.3, cacheRead: 0, cacheWrite: 0 },
      },
      "Qwen/Qwen3.5-9B": {
        id: "Qwen/Qwen3.5-9B",
        displayName: "Qwen3.5 9B",
        cost: { input: 0.17, output: 0.25, cacheRead: 0, cacheWrite: 0 },
      },
      "Qwen/Qwen3.6-Plus": {
        id: "Qwen/Qwen3.6-Plus",
        displayName: "Qwen3.6 Plus",
        cost: { input: 0.5, output: 3, cacheRead: 0, cacheWrite: 0 },
      },
      "Qwen/Qwen3.7-Max": {
        id: "Qwen/Qwen3.7-Max",
        displayName: "Qwen3.7 Max",
        cost: { input: 1.25, output: 3.75, cacheRead: 0.125, cacheWrite: 0 },
      },
      "thinkingmachines/Inkling": {
        id: "thinkingmachines/Inkling",
        displayName: "Inkling",
        cost: { input: 1, output: 4.05, cacheRead: 0.17, cacheWrite: 0 },
      },
      "zai-org/GLM-5.2": {
        id: "zai-org/GLM-5.2",
        displayName: "GLM-5.2",
        cost: { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 },
      },
      "zai-org/GLM-5.3": {
        id: "zai-org/GLM-5.3",
        displayName: "GLM-5.3",
        cost: { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 },
      },
      "zai-org/GLM-5.3-Flash": {
        id: "zai-org/GLM-5.3-Flash",
        displayName: "GLM-5.3-Flash",
        cost: { input: 0.15, output: 0.5, cacheRead: 0.03, cacheWrite: 0 },
      },
    },
  },
  {
    id: "vercel-ai-gateway",
    displayName: "Vercel AI Gateway",
    providerType: "anthropic",
    defaultBaseUrl: "https://ai-gateway.vercel.sh",
    models: {
      "alibaba/qwen-3-14b": {
        id: "alibaba/qwen-3-14b",
        displayName: "Qwen3-14B",
        cost: { input: 0.12, output: 0.24, cacheRead: 0, cacheWrite: 0 },
      },
      "alibaba/qwen-3-235b": {
        id: "alibaba/qwen-3-235b",
        displayName: "Qwen3 235B A22B",
        cost: { input: 0.22, output: 0.88, cacheRead: 0, cacheWrite: 0 },
      },
      "alibaba/qwen-3-30b": {
        id: "alibaba/qwen-3-30b",
        displayName: "Qwen3-30B-A3B",
        cost: { input: 0.12, output: 0.5, cacheRead: 0, cacheWrite: 0 },
      },
      "alibaba/qwen-3-32b": {
        id: "alibaba/qwen-3-32b",
        displayName: "Qwen 3 32B",
        cost: { input: 0.15, output: 0.6, cacheRead: 0, cacheWrite: 0 },
      },
      "alibaba/qwen3-coder": {
        id: "alibaba/qwen3-coder",
        displayName: "Qwen3 Coder 480B A35B Instruct",
        cost: { input: 0.22, output: 1.8, cacheRead: 0.022, cacheWrite: 0 },
      },
      "alibaba/qwen3-coder-30b-a3b": {
        id: "alibaba/qwen3-coder-30b-a3b",
        displayName: "Qwen 3 Coder 30B A3B Instruct",
        cost: { input: 0.15, output: 0.6, cacheRead: 0, cacheWrite: 0 },
      },
      "alibaba/qwen3-coder-next": {
        id: "alibaba/qwen3-coder-next",
        displayName: "Qwen3 Coder Next",
        cost: { input: 0.5, output: 1.2, cacheRead: 0, cacheWrite: 0 },
      },
      "alibaba/qwen3-max-thinking": {
        id: "alibaba/qwen3-max-thinking",
        displayName: "Qwen 3 Max Thinking",
        cost: { input: 1.2, output: 6, cacheRead: 0.24, cacheWrite: 0 },
      },
      "alibaba/qwen3-next-80b-a3b-instruct": {
        id: "alibaba/qwen3-next-80b-a3b-instruct",
        displayName: "Qwen3 Next 80B A3B Instruct",
        cost: { input: 0.15, output: 1.2, cacheRead: 0, cacheWrite: 0 },
      },
      "alibaba/qwen3-next-80b-a3b-thinking": {
        id: "alibaba/qwen3-next-80b-a3b-thinking",
        displayName: "Qwen3 Next 80B A3B Thinking",
        cost: { input: 0.15, output: 1.2, cacheRead: 0, cacheWrite: 0 },
      },
      "alibaba/qwen3-vl-instruct": {
        id: "alibaba/qwen3-vl-instruct",
        displayName: "Qwen3 VL 235B A22B Instruct",
        cost: { input: 0.2, output: 0.88, cacheRead: 0.11, cacheWrite: 0 },
      },
      "alibaba/qwen3.5-flash": {
        id: "alibaba/qwen3.5-flash",
        displayName: "Qwen 3.5 Flash",
        cost: { input: 0.1, output: 0.4, cacheRead: 0.01, cacheWrite: 0.125 },
      },
      "alibaba/qwen3.5-plus": {
        id: "alibaba/qwen3.5-plus",
        displayName: "Qwen 3.5 Plus",
        cost: { input: 0.4, output: 2.4, cacheRead: 0.04, cacheWrite: 0.5 },
      },
      "alibaba/qwen3.6-27b": {
        id: "alibaba/qwen3.6-27b",
        displayName: "Qwen 3.6 27B",
        cost: { input: 0.6, output: 3.6, cacheRead: 0, cacheWrite: 0 },
      },
      "alibaba/qwen3.6-plus": {
        id: "alibaba/qwen3.6-plus",
        displayName: "Qwen 3.6 Plus",
        cost: { input: 0.5, output: 3, cacheRead: 0.05, cacheWrite: 0.625 },
      },
      "alibaba/qwen3.7-flash": {
        id: "alibaba/qwen3.7-flash",
        displayName: "Qwen 3.7 Flash",
        cost: { input: 0.03, output: 0.13, cacheRead: 0.006, cacheWrite: 0.038 },
      },
      "alibaba/qwen3.7-max": {
        id: "alibaba/qwen3.7-max",
        displayName: "Qwen 3.7 Max",
        cost: { input: 2.5, output: 7.5, cacheRead: 0.5, cacheWrite: 3.125 },
      },
      "alibaba/qwen3.7-plus": {
        id: "alibaba/qwen3.7-plus",
        displayName: "Qwen 3.7 Plus",
        cost: { input: 0.4, output: 1.6, cacheRead: 0.08, cacheWrite: 0.5 },
      },
      "alibaba/qwen3.8-2.4t-a95b": {
        id: "alibaba/qwen3.8-2.4t-a95b",
        displayName: "Qwen3.8 2.4T A95B",
        cost: { input: 2, output: 6, cacheRead: 0.25, cacheWrite: 0 },
      },
      "alibaba/qwen3.8-27b": {
        id: "alibaba/qwen3.8-27b",
        displayName: "Qwen3.8 27B",
        cost: { input: 0.5, output: 3, cacheRead: 0.1, cacheWrite: 0.625 },
      },
      "alibaba/qwen3.8-flash": {
        id: "alibaba/qwen3.8-flash",
        displayName: "Qwen 3.8 Flash",
        cost: { input: 0.15, output: 0.47, cacheRead: 0.016, cacheWrite: 0.2 },
      },
      "alibaba/qwen3.8-max": {
        id: "alibaba/qwen3.8-max",
        displayName: "Qwen 3.8 Max",
        cost: { input: 2, output: 6, cacheRead: 0.25, cacheWrite: 0 },
      },
      "alibaba/qwen3.8-max-0902": {
        id: "alibaba/qwen3.8-max-0902",
        displayName: "Qwen3.8 Max 0902",
        cost: { input: 2, output: 6, cacheRead: 0.25, cacheWrite: 2.5 },
      },
      "alibaba/qwen3.8-max-prime": {
        id: "alibaba/qwen3.8-max-prime",
        displayName: "Qwen 3.8 Max Prime",
        cost: { input: 4, output: 12, cacheRead: 0.5, cacheWrite: 5 },
      },
      "alibaba/qwen3.8-omni-flash": {
        id: "alibaba/qwen3.8-omni-flash",
        displayName: "Qwen 3.8 Omni Flash",
        cost: { input: 0.15, output: 0.47, cacheRead: 0.016, cacheWrite: 0 },
      },
      "amazon/nova-2-lite": {
        id: "amazon/nova-2-lite",
        displayName: "Nova 2 Lite",
        cost: { input: 0.3, output: 2.5, cacheRead: 0.075, cacheWrite: 0 },
      },
      "amazon/nova-lite": {
        id: "amazon/nova-lite",
        displayName: "Nova Lite",
        cost: { input: 0.06, output: 0.24, cacheRead: 0, cacheWrite: 0 },
      },
      "amazon/nova-micro": {
        id: "amazon/nova-micro",
        displayName: "Nova Micro",
        cost: { input: 0.035, output: 0.14, cacheRead: 0, cacheWrite: 0 },
      },
      "amazon/nova-pro": {
        id: "amazon/nova-pro",
        displayName: "Nova Pro",
        cost: { input: 0.8, output: 3.2, cacheRead: 0, cacheWrite: 0 },
      },
      "anthropic/claude-fable-5": {
        id: "anthropic/claude-fable-5",
        displayName: "Claude Fable 5",
        cost: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
      },
      "anthropic/claude-fable-5-batch": {
        id: "anthropic/claude-fable-5-batch",
        displayName: "Claude Fable 5 (Batch)",
        cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
      },
      "anthropic/claude-fable-5.1": {
        id: "anthropic/claude-fable-5.1",
        displayName: "Claude Fable 5.1",
        cost: { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
      },
      "anthropic/claude-fable-5.1-batch": {
        id: "anthropic/claude-fable-5.1-batch",
        displayName: "Claude Fable 5.1 (Batch)",
        cost: { input: 5, output: 25, cacheRead: 0.125, cacheWrite: 6.25 },
      },
      "anthropic/claude-haiku-4.5": {
        id: "anthropic/claude-haiku-4.5",
        displayName: "Claude Haiku 4.5",
        cost: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
      },
      "anthropic/claude-haiku-4.5-batch": {
        id: "anthropic/claude-haiku-4.5-batch",
        displayName: "Claude Haiku 4.5 (Batch)",
        cost: { input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite: 0.625 },
      },
      "anthropic/claude-haiku-5.5": {
        id: "anthropic/claude-haiku-5.5",
        displayName: "Claude Haiku 5.5",
        cost: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
      },
      "anthropic/claude-haiku-5.5-batch": {
        id: "anthropic/claude-haiku-5.5-batch",
        displayName: "Claude Haiku 5.5 (Batch)",
        cost: { input: 0.05, output: 0.25, cacheRead: 0.005, cacheWrite: 0.0625 },
      },
      "anthropic/claude-opus-4.5": {
        id: "anthropic/claude-opus-4.5",
        displayName: "Claude Opus 4.5",
        cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
      },
      "anthropic/claude-opus-4.5-batch": {
        id: "anthropic/claude-opus-4.5-batch",
        displayName: "Claude Opus 4.5 (Batch)",
        cost: { input: 2.5, output: 12.5, cacheRead: 0.25, cacheWrite: 3.125 },
      },
      "anthropic/claude-opus-4.6": {
        id: "anthropic/claude-opus-4.6",
        displayName: "Claude Opus 4.6",
        cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
      },
      "anthropic/claude-opus-4.6-batch": {
        id: "anthropic/claude-opus-4.6-batch",
        displayName: "Claude Opus 4.6 (Batch)",
        cost: { input: 2.5, output: 12.5, cacheRead: 0.25, cacheWrite: 3.125 },
      },
      "anthropic/claude-opus-4.7": {
        id: "anthropic/claude-opus-4.7",
        displayName: "Claude Opus 4.7",
        cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
      },
      "anthropic/claude-opus-4.7-batch": {
        id: "anthropic/claude-opus-4.7-batch",
        displayName: "Claude Opus 4.7 (Batch)",
        cost: { input: 2.5, output: 12.5, cacheRead: 0.25, cacheWrite: 3.125 },
      },
      "anthropic/claude-opus-4.8": {
        id: "anthropic/claude-opus-4.8",
        displayName: "Claude Opus 4.8",
        cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
      },
      "anthropic/claude-opus-4.8-batch": {
        id: "anthropic/claude-opus-4.8-batch",
        displayName: "Claude Opus 4.8 (Batch)",
        cost: { input: 2.5, output: 12.5, cacheRead: 0.25, cacheWrite: 3.125 },
      },
      "anthropic/claude-opus-4.8-fast": {
        id: "anthropic/claude-opus-4.8-fast",
        displayName: "Claude Opus 4.8 (Fast)",
        cost: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
      },
      "anthropic/claude-opus-5": {
        id: "anthropic/claude-opus-5",
        displayName: "Claude Opus 5",
        cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
      },
      "anthropic/claude-opus-5-batch": {
        id: "anthropic/claude-opus-5-batch",
        displayName: "Claude Opus 5 (Batch)",
        cost: { input: 2.5, output: 12.5, cacheRead: 0.25, cacheWrite: 3.125 },
      },
      "anthropic/claude-opus-5-fast": {
        id: "anthropic/claude-opus-5-fast",
        displayName: "Claude Opus 5 (Fast)",
        cost: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
      },
      "anthropic/claude-opus-5.5": {
        id: "anthropic/claude-opus-5.5",
        displayName: "Claude Opus 5.5",
        cost: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
      },
      "anthropic/claude-opus-5.5-batch": {
        id: "anthropic/claude-opus-5.5-batch",
        displayName: "Claude Opus 5.5 (Batch)",
        cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
      },
      "anthropic/claude-opus-5.5-fast": {
        id: "anthropic/claude-opus-5.5-fast",
        displayName: "Claude Opus 5.5 (Fast)",
        cost: { input: 8, output: 40, cacheRead: 0.4, cacheWrite: 10 },
      },
      "anthropic/claude-sonnet-4": {
        id: "anthropic/claude-sonnet-4",
        displayName: "Claude Sonnet 4",
        cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
      },
      "anthropic/claude-sonnet-4.5": {
        id: "anthropic/claude-sonnet-4.5",
        displayName: "Claude Sonnet 4.5",
        cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
      },
      "anthropic/claude-sonnet-4.5-batch": {
        id: "anthropic/claude-sonnet-4.5-batch",
        displayName: "Claude Sonnet 4.5 (Batch)",
        cost: { input: 1.5, output: 7.5, cacheRead: 0.15, cacheWrite: 1.875 },
      },
      "anthropic/claude-sonnet-4.6": {
        id: "anthropic/claude-sonnet-4.6",
        displayName: "Claude Sonnet 4.6",
        cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
      },
      "anthropic/claude-sonnet-4.6-batch": {
        id: "anthropic/claude-sonnet-4.6-batch",
        displayName: "Claude Sonnet 4.6 (Batch)",
        cost: { input: 1.5, output: 7.5, cacheRead: 0.15, cacheWrite: 1.875 },
      },
      "anthropic/claude-sonnet-5": {
        id: "anthropic/claude-sonnet-5",
        displayName: "Claude Sonnet 5",
        cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
      },
      "anthropic/claude-sonnet-5-batch": {
        id: "anthropic/claude-sonnet-5-batch",
        displayName: "Claude Sonnet 5 (Batch)",
        cost: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
      },
      "anthropic/claude-sonnet-5.5": {
        id: "anthropic/claude-sonnet-5.5",
        displayName: "Claude Sonnet 5.5",
        cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
      },
      "anthropic/claude-sonnet-5.5-batch": {
        id: "anthropic/claude-sonnet-5.5-batch",
        displayName: "Claude Sonnet 5.5 (Batch)",
        cost: { input: 1, output: 5, cacheRead: 0.05, cacheWrite: 1.25 },
      },
      "arcee-ai/trinity-large-thinking": {
        id: "arcee-ai/trinity-large-thinking",
        displayName: "Trinity Large Thinking",
        cost: { input: 0.25, output: 0.8, cacheRead: 0, cacheWrite: 0 },
      },
      "bytedance/seed-1.6": {
        id: "bytedance/seed-1.6",
        displayName: "Seed 1.6",
        cost: { input: 0.25, output: 2, cacheRead: 0.05, cacheWrite: 0 },
      },
      "bytedance/seed-1.8": {
        id: "bytedance/seed-1.8",
        displayName: "Bytedance Seed 1.8",
        cost: { input: 0.25, output: 2, cacheRead: 0.05, cacheWrite: 0 },
      },
      "bytedance/seed-2.1-turbo": {
        id: "bytedance/seed-2.1-turbo",
        displayName: "Seed 2.1 Turbo",
        cost: { input: 0.5, output: 2.5, cacheRead: 0.1, cacheWrite: 0 },
      },
      "callstack/apex": {
        id: "callstack/apex",
        displayName: "Apex",
        cost: { input: 0.5, output: 3, cacheRead: 0.2, cacheWrite: 0 },
      },
      "cohere/command-a": {
        id: "cohere/command-a",
        displayName: "Command A",
        cost: { input: 2.5, output: 10, cacheRead: 0, cacheWrite: 0 },
      },
      "deepseek/deepseek-r1": {
        id: "deepseek/deepseek-r1",
        displayName: "DeepSeek-R1",
        cost: { input: 1.35, output: 5.4, cacheRead: 0, cacheWrite: 0 },
      },
      "deepseek/deepseek-v3.1": {
        id: "deepseek/deepseek-v3.1",
        displayName: "DeepSeek V3.1",
        cost: { input: 0.25, output: 0.95, cacheRead: 0.13, cacheWrite: 0 },
      },
      "deepseek/deepseek-v3.2": {
        id: "deepseek/deepseek-v3.2",
        displayName: "DeepSeek V3.2",
        cost: { input: 0.62, output: 1.85, cacheRead: 0, cacheWrite: 0 },
      },
      "deepseek/deepseek-v3.2-thinking": {
        id: "deepseek/deepseek-v3.2-thinking",
        displayName: "DeepSeek V3.2 Thinking",
        cost: { input: 0.62, output: 1.85, cacheRead: 0, cacheWrite: 0 },
      },
      "deepseek/deepseek-v4-flash": {
        id: "deepseek/deepseek-v4-flash",
        displayName: "DeepSeek V4 Flash",
        cost: { input: 0.13, output: 0.26, cacheRead: 0.028, cacheWrite: 0 },
      },
      "deepseek/deepseek-v4-flash-0731": {
        id: "deepseek/deepseek-v4-flash-0731",
        displayName: "DeepSeek V4 Flash 0731",
        cost: { input: 0.076, output: 0.153, cacheRead: 0.014, cacheWrite: 0 },
      },
      "deepseek/deepseek-v4-flash-vision-exp": {
        id: "deepseek/deepseek-v4-flash-vision-exp",
        displayName: "DeepSeek V4 Flash Vision Exp",
        cost: { input: 0.2156, output: 0.6468, cacheRead: 0.0068, cacheWrite: 0 },
      },
      "deepseek/deepseek-v4-pro": {
        id: "deepseek/deepseek-v4-pro",
        displayName: "DeepSeek V4 Pro",
        cost: { input: 0.66, output: 1.98, cacheRead: 0.022, cacheWrite: 0 },
      },
      "deepseek/deepseek-v4-pro-0813": {
        id: "deepseek/deepseek-v4-pro-0813",
        displayName: "DeepSeek V4 Pro 0813",
        cost: { input: 0.66, output: 1.98, cacheRead: 0.066, cacheWrite: 0 },
      },
      "deepseek/deepseek-v4.1-flash": {
        id: "deepseek/deepseek-v4.1-flash",
        displayName: "DeepSeek V4.1 Flash",
        cost: { input: 0.3, output: 1.2, cacheRead: 0.007, cacheWrite: 0 },
      },
      "deepseek/deepseek-v4.1-flash-fast": {
        id: "deepseek/deepseek-v4.1-flash-fast",
        displayName: "DeepSeek V4.1 Flash Fast",
        cost: { input: 0.6, output: 2.4, cacheRead: 0.014, cacheWrite: 0 },
      },
      "fireworks/ember-1": {
        id: "fireworks/ember-1",
        displayName: "Ember-1",
        cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 0 },
      },
      "google/gemini-2.5-flash": {
        id: "google/gemini-2.5-flash",
        displayName: "Gemini 2.5 Flash",
        cost: { input: 0.3, output: 2.5, cacheRead: 0.03, cacheWrite: 0 },
      },
      "google/gemini-2.5-flash-batch": {
        id: "google/gemini-2.5-flash-batch",
        displayName: "Gemini 2.5 Flash (Batch)",
        cost: { input: 0.15, output: 1.25, cacheRead: 0.03, cacheWrite: 0 },
      },
      "google/gemini-2.5-flash-lite": {
        id: "google/gemini-2.5-flash-lite",
        displayName: "Gemini 2.5 Flash Lite",
        cost: { input: 0.1, output: 0.4, cacheRead: 0.01, cacheWrite: 0 },
      },
      "google/gemini-2.5-flash-lite-batch": {
        id: "google/gemini-2.5-flash-lite-batch",
        displayName: "Gemini 2.5 Flash Lite (Batch)",
        cost: { input: 0.05, output: 0.2, cacheRead: 0.01, cacheWrite: 0 },
      },
      "google/gemini-2.5-pro": {
        id: "google/gemini-2.5-pro",
        displayName: "Gemini 2.5 Pro",
        cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
      },
      "google/gemini-2.5-pro-batch": {
        id: "google/gemini-2.5-pro-batch",
        displayName: "Gemini 2.5 Pro (Batch)",
        cost: { input: 0.625, output: 5, cacheRead: 0.125, cacheWrite: 0 },
      },
      "google/gemini-3-flash": {
        id: "google/gemini-3-flash",
        displayName: "Gemini 3 Flash",
        cost: { input: 0.5, output: 3, cacheRead: 0.05, cacheWrite: 0 },
      },
      "google/gemini-3-flash-batch": {
        id: "google/gemini-3-flash-batch",
        displayName: "Gemini 3 Flash (Batch)",
        cost: { input: 0.25, output: 1.5, cacheRead: 0.05, cacheWrite: 0 },
      },
      "google/gemini-3.1-flash-lite": {
        id: "google/gemini-3.1-flash-lite",
        displayName: "Gemini 3.1 Flash Lite",
        cost: { input: 0.25, output: 1.5, cacheRead: 0.03, cacheWrite: 0 },
      },
      "google/gemini-3.1-flash-lite-batch": {
        id: "google/gemini-3.1-flash-lite-batch",
        displayName: "Gemini 3.1 Flash Lite (Batch)",
        cost: { input: 0.125, output: 0.75, cacheRead: 0.015, cacheWrite: 0 },
      },
      "google/gemini-3.1-pro-preview": {
        id: "google/gemini-3.1-pro-preview",
        displayName: "Gemini 3.1 Pro Preview",
        cost: { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 0 },
      },
      "google/gemini-3.1-pro-preview-batch": {
        id: "google/gemini-3.1-pro-preview-batch",
        displayName: "Gemini 3.1 Pro Preview (Batch)",
        cost: { input: 1, output: 6, cacheRead: 0.2, cacheWrite: 0 },
      },
      "google/gemini-3.5-flash": {
        id: "google/gemini-3.5-flash",
        displayName: "Gemini 3.5 Flash",
        cost: { input: 1.5, output: 9, cacheRead: 0.15, cacheWrite: 0 },
      },
      "google/gemini-3.5-flash-batch": {
        id: "google/gemini-3.5-flash-batch",
        displayName: "Gemini 3.5 Flash (Batch)",
        cost: { input: 0.75, output: 4.5, cacheRead: 0.075, cacheWrite: 0 },
      },
      "google/gemini-3.5-flash-lite": {
        id: "google/gemini-3.5-flash-lite",
        displayName: "Gemini 3.5 Flash Lite",
        cost: { input: 0.3, output: 2.5, cacheRead: 0.03, cacheWrite: 0 },
      },
      "google/gemini-3.5-flash-lite-batch": {
        id: "google/gemini-3.5-flash-lite-batch",
        displayName: "Gemini 3.5 Flash Lite (Batch)",
        cost: { input: 0.15, output: 1.25, cacheRead: 0.015, cacheWrite: 0 },
      },
      "google/gemini-3.6-flash": {
        id: "google/gemini-3.6-flash",
        displayName: "Gemini 3.6 Flash",
        cost: { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0 },
      },
      "google/gemini-3.6-flash-batch": {
        id: "google/gemini-3.6-flash-batch",
        displayName: "Gemini 3.6 Flash (Batch)",
        cost: { input: 0.375, output: 1.875, cacheRead: 0.0375, cacheWrite: 0 },
      },
      "google/gemini-3.7-flash": {
        id: "google/gemini-3.7-flash",
        displayName: "Gemini 3.7 Flash",
        cost: { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0 },
      },
      "google/gemini-3.7-flash-batch": {
        id: "google/gemini-3.7-flash-batch",
        displayName: "Gemini 3.7 Flash (Batch)",
        cost: { input: 0.375, output: 1.875, cacheRead: 0.0375, cacheWrite: 0 },
      },
      "google/gemini-3.8-flash": {
        id: "google/gemini-3.8-flash",
        displayName: "Gemini 3.8 Flash",
        cost: { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0 },
      },
      "google/gemini-4-argon": {
        id: "google/gemini-4-argon",
        displayName: "Gemini 4 Argon",
        cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 0 },
      },
      "google/gemma-4-26b-a4b-it": {
        id: "google/gemma-4-26b-a4b-it",
        displayName: "Google Gemma 4 26B A4B",
        cost: { input: 0.15, output: 0.6, cacheRead: 0.015, cacheWrite: 0 },
      },
      "google/gemma-4-31b-it": {
        id: "google/gemma-4-31b-it",
        displayName: "Gemma 4 31B IT",
        cost: { input: 0.14, output: 0.4, cacheRead: 0, cacheWrite: 0 },
      },
      "inception/mercury-2": {
        id: "inception/mercury-2",
        displayName: "Mercury 2",
        cost: { input: 0.25, output: 0.75, cacheRead: 0.025, cacheWrite: 0 },
      },
      "inception/mercury-2.5": {
        id: "inception/mercury-2.5",
        displayName: "Mercury 2.5",
        cost: { input: 0.04, output: 0.15, cacheRead: 0.004, cacheWrite: 0 },
      },
      "inception/mercury-coder-small": {
        id: "inception/mercury-coder-small",
        displayName: "Mercury Coder Small Beta",
        cost: { input: 0.25, output: 1, cacheRead: 0, cacheWrite: 0 },
      },
      "inclusionai/ling-3.0-flash": {
        id: "inclusionai/ling-3.0-flash",
        displayName: "Ling 3.0 Flash",
        cost: { input: 0.021, output: 0.063, cacheRead: 0.0042, cacheWrite: 0 },
      },
      "inclusionai/ling-3.0-flash-fin": {
        id: "inclusionai/ling-3.0-flash-fin",
        displayName: "Ling 3.0 Flash Fin",
        cost: { input: 0.075, output: 0.22, cacheRead: 0.015, cacheWrite: 0 },
      },
      "inclusionai/ling-3.0-flash-sante": {
        id: "inclusionai/ling-3.0-flash-sante",
        displayName: "Ling 3.0 Flash Sante",
        cost: { input: 0.075, output: 0.22, cacheRead: 0.015, cacheWrite: 0 },
      },
      "inclusionai/ling-3.0-flash-vl": {
        id: "inclusionai/ling-3.0-flash-vl",
        displayName: "Ling 3.0 Flash VL",
        cost: { input: 0.075, output: 0.22, cacheRead: 0.015, cacheWrite: 0 },
      },
      "inclusionai/ling-3.1-flash": {
        id: "inclusionai/ling-3.1-flash",
        displayName: "Ling 3.1 Flash",
        cost: { input: 0.3, output: 0.9, cacheRead: 0.06, cacheWrite: 0 },
      },
      "interfaze/interfaze-beta": {
        id: "interfaze/interfaze-beta",
        displayName: "Interfaze Beta",
        cost: { input: 1.5, output: 3.5, cacheRead: 0, cacheWrite: 0 },
      },
      "liquid/lfm2.5-24b-a2b": {
        id: "liquid/lfm2.5-24b-a2b",
        displayName: "LFM2.5-24B-A2B",
        cost: { input: 0.05, output: 0.7, cacheRead: 0.025, cacheWrite: 0 },
      },
      "meituan/longcat-2.5-preview": {
        id: "meituan/longcat-2.5-preview",
        displayName: "LongCat 2.5 Preview",
        cost: { input: 0.3, output: 1.2, cacheRead: 0.006, cacheWrite: 0 },
      },
      "meta/llama-3.1-70b": {
        id: "meta/llama-3.1-70b",
        displayName: "Llama 3.1 70B Instruct",
        cost: { input: 0.72, output: 0.72, cacheRead: 0, cacheWrite: 0 },
      },
      "meta/llama-3.1-8b": {
        id: "meta/llama-3.1-8b",
        displayName: "Llama 3.1 8B Instruct",
        cost: { input: 0.22, output: 0.22, cacheRead: 0, cacheWrite: 0 },
      },
      "meta/llama-3.3-70b": {
        id: "meta/llama-3.3-70b",
        displayName: "Llama 3.3 70B Instruct",
        cost: { input: 0.72, output: 0.72, cacheRead: 0, cacheWrite: 0 },
      },
      "meta/llama-4-maverick": {
        id: "meta/llama-4-maverick",
        displayName: "Llama 4 Maverick 17B Instruct",
        cost: { input: 0.24, output: 0.97, cacheRead: 0, cacheWrite: 0 },
      },
      "meta/llama-4-scout": {
        id: "meta/llama-4-scout",
        displayName: "Llama 4 Scout 17B Instruct",
        cost: { input: 0.17, output: 0.66, cacheRead: 0, cacheWrite: 0 },
      },
      "meta/muse-glimmer-30b": {
        id: "meta/muse-glimmer-30b",
        displayName: "Muse Glimmer 30B",
        cost: { input: 0.35, output: 1.5, cacheRead: 0.04, cacheWrite: 0 },
      },
      "meta/muse-spark-1.1": {
        id: "meta/muse-spark-1.1",
        displayName: "Muse Spark 1.1",
        cost: { input: 1.25, output: 4.25, cacheRead: 0.15, cacheWrite: 0 },
      },
      "meta/muse-spark-1.2": {
        id: "meta/muse-spark-1.2",
        displayName: "Muse Spark 1.2",
        cost: { input: 1.25, output: 4.25, cacheRead: 0.15, cacheWrite: 0 },
      },
      "meta/muse-spark-1.2-contributor": {
        id: "meta/muse-spark-1.2-contributor",
        displayName: "Muse Spark 1.2 Contributor",
        cost: { input: 0.1, output: 0.2, cacheRead: 0.002, cacheWrite: 0 },
      },
      "meta/muse-spark-1.3": {
        id: "meta/muse-spark-1.3",
        displayName: "Muse Spark 1.3",
        cost: { input: 1.25, output: 4.25, cacheRead: 0.15, cacheWrite: 0 },
      },
      "meta/muse-spark-1.3-contributor": {
        id: "meta/muse-spark-1.3-contributor",
        displayName: "Muse Spark 1.3 Contributor",
        cost: { input: 0.1, output: 0.2, cacheRead: 0.002, cacheWrite: 0 },
      },
      "meta/muse-spark-open": {
        id: "meta/muse-spark-open",
        displayName: "Muse Spark Open",
        cost: { input: 1.25, output: 4.25, cacheRead: 0.15, cacheWrite: 0 },
      },
      "meta/muse-wonder-1.0": {
        id: "meta/muse-wonder-1.0",
        displayName: "Muse Wonder",
        cost: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 0 },
      },
      "minimax/minimax-m2": {
        id: "minimax/minimax-m2",
        displayName: "MiniMax M2",
        cost: { input: 0.3, output: 1.2, cacheRead: 0.03, cacheWrite: 0.375 },
      },
      "minimax/minimax-m2.1": {
        id: "minimax/minimax-m2.1",
        displayName: "MiniMax M2.1",
        cost: { input: 0.3, output: 1.2, cacheRead: 0.03, cacheWrite: 0.375 },
      },
      "minimax/minimax-m2.1-lightning": {
        id: "minimax/minimax-m2.1-lightning",
        displayName: "MiniMax M2.1 Lightning",
        cost: { input: 0.3, output: 2.4, cacheRead: 0.03, cacheWrite: 0.375 },
      },
      "minimax/minimax-m2.5": {
        id: "minimax/minimax-m2.5",
        displayName: "MiniMax M2.5",
        cost: { input: 0.3, output: 1.2, cacheRead: 0.03, cacheWrite: 0.375 },
      },
      "minimax/minimax-m2.5-highspeed": {
        id: "minimax/minimax-m2.5-highspeed",
        displayName: "MiniMax M2.5 High Speed",
        cost: { input: 0.6, output: 2.4, cacheRead: 0.03, cacheWrite: 0.375 },
      },
      "minimax/minimax-m2.7": {
        id: "minimax/minimax-m2.7",
        displayName: "MiniMax M2.7",
        cost: { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0.375 },
      },
      "minimax/minimax-m2.7-highspeed": {
        id: "minimax/minimax-m2.7-highspeed",
        displayName: "MiniMax M2.7 High Speed",
        cost: { input: 0.6, output: 2.4, cacheRead: 0.06, cacheWrite: 0.375 },
      },
      "minimax/minimax-m3": {
        id: "minimax/minimax-m3",
        displayName: "MiniMax M3",
        cost: { input: 0.3, output: 1.2, cacheRead: 0.06, cacheWrite: 0 },
      },
      "mistral/codestral": {
        id: "mistral/codestral",
        displayName: "Mistral Codestral",
        cost: { input: 0.3, output: 0.9, cacheRead: 0.03, cacheWrite: 0 },
      },
      "mistral/ministral-14b": {
        id: "mistral/ministral-14b",
        displayName: "Ministral 14B",
        cost: { input: 0.2, output: 0.2, cacheRead: 0.02, cacheWrite: 0 },
      },
      "mistral/ministral-3b": {
        id: "mistral/ministral-3b",
        displayName: "Ministral 3B",
        cost: { input: 0.1, output: 0.1, cacheRead: 0.01, cacheWrite: 0 },
      },
      "mistral/ministral-8b": {
        id: "mistral/ministral-8b",
        displayName: "Ministral 8B",
        cost: { input: 0.15, output: 0.15, cacheRead: 0.015, cacheWrite: 0 },
      },
      "mistral/mistral-large-3": {
        id: "mistral/mistral-large-3",
        displayName: "Mistral Large 3",
        cost: { input: 0.5, output: 1.5, cacheRead: 0.05, cacheWrite: 0 },
      },
      "mistral/mistral-large-4": {
        id: "mistral/mistral-large-4",
        displayName: "Mistral Large 4",
        cost: { input: 0.68, output: 2.09, cacheRead: 0.07, cacheWrite: 0 },
      },
      "mistral/mistral-medium-3.5": {
        id: "mistral/mistral-medium-3.5",
        displayName: "Mistral Medium Latest",
        cost: { input: 1.5, output: 7.5, cacheRead: 0.15, cacheWrite: 0 },
      },
      "mistral/mistral-nemo": {
        id: "mistral/mistral-nemo",
        displayName: "Mistral Nemo 12B",
        cost: { input: 0.029, output: 0.03, cacheRead: 0, cacheWrite: 0 },
      },
      "mistral/mistral-small": {
        id: "mistral/mistral-small",
        displayName: "Mistral Small",
        cost: { input: 0.15, output: 0.6, cacheRead: 0.015, cacheWrite: 0 },
      },
      "mixedbread/toast-1": {
        id: "mixedbread/toast-1",
        displayName: "Toast 1",
        cost: { input: 0.3, output: 0.72, cacheRead: 0.036, cacheWrite: 0 },
      },
      "moonshotai/kimi-k2": {
        id: "moonshotai/kimi-k2",
        displayName: "Kimi K2 Instruct",
        cost: { input: 0.57, output: 2.3, cacheRead: 0, cacheWrite: 0 },
      },
      "moonshotai/kimi-k2.5": {
        id: "moonshotai/kimi-k2.5",
        displayName: "Kimi K2.5",
        cost: { input: 0.6, output: 3, cacheRead: 0, cacheWrite: 0 },
      },
      "moonshotai/kimi-k2.6": {
        id: "moonshotai/kimi-k2.6",
        displayName: "Kimi K2.6",
        cost: { input: 0.95, output: 4, cacheRead: 0.16, cacheWrite: 0 },
      },
      "moonshotai/kimi-k2.7-code": {
        id: "moonshotai/kimi-k2.7-code",
        displayName: "Kimi K2.7 Code",
        cost: { input: 0.95, output: 4, cacheRead: 0.19, cacheWrite: 0 },
      },
      "moonshotai/kimi-k2.7-code-highspeed": {
        id: "moonshotai/kimi-k2.7-code-highspeed",
        displayName: "Kimi K2.7 Code High Speed",
        cost: { input: 1.9, output: 8, cacheRead: 0.38, cacheWrite: 0 },
      },
      "moonshotai/kimi-k3": {
        id: "moonshotai/kimi-k3",
        displayName: "Kimi K3",
        cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 0 },
      },
      "moonshotai/kimi-k3-fast": {
        id: "moonshotai/kimi-k3-fast",
        displayName: "Kimi K3 Fast",
        cost: { input: 4.5, output: 22.5, cacheRead: 0.45, cacheWrite: 0 },
      },
      "nvidia/nemotron-3-nano-30b-a3b": {
        id: "nvidia/nemotron-3-nano-30b-a3b",
        displayName: "Nemotron 3 Nano 30B A3B",
        cost: { input: 0.05, output: 0.2, cacheRead: 0.025, cacheWrite: 0 },
      },
      "nvidia/nemotron-3-super-120b-a12b": {
        id: "nvidia/nemotron-3-super-120b-a12b",
        displayName: "NVIDIA Nemotron 3 Super 120B A12B",
        cost: { input: 0.15, output: 0.65, cacheRead: 0, cacheWrite: 0 },
      },
      "nvidia/nemotron-3-ultra-550b-a55b": {
        id: "nvidia/nemotron-3-ultra-550b-a55b",
        displayName: "Nemotron 3 Ultra",
        cost: { input: 0.6, output: 2.4, cacheRead: 0.12, cacheWrite: 0 },
      },
      "nvidia/nemotron-3.5-lightning": {
        id: "nvidia/nemotron-3.5-lightning",
        displayName: "Nemotron 3.5 Lightning 30B",
        cost: { input: 0.05, output: 0.2, cacheRead: 0.01, cacheWrite: 0 },
      },
      "nvidia/nemotron-3.5-lightning-free": {
        id: "nvidia/nemotron-3.5-lightning-free",
        displayName: "Nemotron 3.5 Lightning Free",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "nvidia/nemotron-3.5-super-vl": {
        id: "nvidia/nemotron-3.5-super-vl",
        displayName: "NVIDIA Nemotron 3.5 Super VL",
        cost: { input: 0.2, output: 0.5, cacheRead: 0.04, cacheWrite: 0 },
      },
      "nvidia/nemotron-nano-12b-v2-vl": {
        id: "nvidia/nemotron-nano-12b-v2-vl",
        displayName: "Nvidia Nemotron Nano 12B V2 VL",
        cost: { input: 0.2, output: 0.6, cacheRead: 0, cacheWrite: 0 },
      },
      "nvidia/nemotron-nano-9b-v2": {
        id: "nvidia/nemotron-nano-9b-v2",
        displayName: "Nvidia Nemotron Nano 9B V2",
        cost: { input: 0.06, output: 0.23, cacheRead: 0, cacheWrite: 0 },
      },
      "openai/gpt-3.5-turbo": {
        id: "openai/gpt-3.5-turbo",
        displayName: "GPT-3.5 Turbo",
        cost: { input: 0.5, output: 1.5, cacheRead: 0, cacheWrite: 0 },
      },
      "openai/gpt-4-turbo": {
        id: "openai/gpt-4-turbo",
        displayName: "GPT-4 Turbo",
        cost: { input: 10, output: 30, cacheRead: 0, cacheWrite: 0 },
      },
      "openai/gpt-4.1": {
        id: "openai/gpt-4.1",
        displayName: "GPT-4.1",
        cost: { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 0 },
      },
      "openai/gpt-4.1-batch": {
        id: "openai/gpt-4.1-batch",
        displayName: "GPT-4.1 (Batch)",
        cost: { input: 1, output: 4, cacheRead: 0.25, cacheWrite: 0 },
      },
      "openai/gpt-4.1-fast": {
        id: "openai/gpt-4.1-fast",
        displayName: "GPT-4.1 (Fast)",
        cost: { input: 3.5, output: 14, cacheRead: 0.875, cacheWrite: 0 },
      },
      "openai/gpt-4.1-mini": {
        id: "openai/gpt-4.1-mini",
        displayName: "GPT-4.1 mini",
        cost: { input: 0.4, output: 1.6, cacheRead: 0.1, cacheWrite: 0 },
      },
      "openai/gpt-4.1-mini-batch": {
        id: "openai/gpt-4.1-mini-batch",
        displayName: "GPT-4.1 mini (Batch)",
        cost: { input: 0.2, output: 0.8, cacheRead: 0.05, cacheWrite: 0 },
      },
      "openai/gpt-4.1-mini-fast": {
        id: "openai/gpt-4.1-mini-fast",
        displayName: "GPT-4.1 mini (Fast)",
        cost: { input: 0.7, output: 2.8, cacheRead: 0.175, cacheWrite: 0 },
      },
      "openai/gpt-4.1-nano": {
        id: "openai/gpt-4.1-nano",
        displayName: "GPT-4.1 nano",
        cost: { input: 0.1, output: 0.4, cacheRead: 0.025, cacheWrite: 0 },
      },
      "openai/gpt-4.1-nano-batch": {
        id: "openai/gpt-4.1-nano-batch",
        displayName: "GPT-4.1 nano (Batch)",
        cost: { input: 0.05, output: 0.2, cacheRead: 0.0125, cacheWrite: 0 },
      },
      "openai/gpt-4.1-nano-fast": {
        id: "openai/gpt-4.1-nano-fast",
        displayName: "GPT-4.1 nano (Fast)",
        cost: { input: 0.2, output: 0.8, cacheRead: 0.05, cacheWrite: 0 },
      },
      "openai/gpt-4o": {
        id: "openai/gpt-4o",
        displayName: "GPT-4o",
        cost: { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 0 },
      },
      "openai/gpt-4o-batch": {
        id: "openai/gpt-4o-batch",
        displayName: "GPT-4o (Batch)",
        cost: { input: 1.25, output: 5, cacheRead: 0.625, cacheWrite: 0 },
      },
      "openai/gpt-4o-fast": {
        id: "openai/gpt-4o-fast",
        displayName: "GPT-4o (Fast)",
        cost: { input: 4.25, output: 17, cacheRead: 2.125, cacheWrite: 0 },
      },
      "openai/gpt-4o-mini": {
        id: "openai/gpt-4o-mini",
        displayName: "GPT-4o mini",
        cost: { input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite: 0 },
      },
      "openai/gpt-4o-mini-batch": {
        id: "openai/gpt-4o-mini-batch",
        displayName: "GPT-4o mini (Batch)",
        cost: { input: 0.075, output: 0.3, cacheRead: 0.0375, cacheWrite: 0 },
      },
      "openai/gpt-4o-mini-fast": {
        id: "openai/gpt-4o-mini-fast",
        displayName: "GPT-4o mini (Fast)",
        cost: { input: 0.25, output: 1, cacheRead: 0.125, cacheWrite: 0 },
      },
      "openai/gpt-5": {
        id: "openai/gpt-5",
        displayName: "GPT-5",
        cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
      },
      "openai/gpt-5-batch": {
        id: "openai/gpt-5-batch",
        displayName: "GPT-5 (Batch)",
        cost: { input: 0.625, output: 5, cacheRead: 0.0625, cacheWrite: 0 },
      },
      "openai/gpt-5-codex": {
        id: "openai/gpt-5-codex",
        displayName: "GPT-5-Codex",
        cost: { input: 1.25, output: 10, cacheRead: 0.13, cacheWrite: 0 },
      },
      "openai/gpt-5-fast": {
        id: "openai/gpt-5-fast",
        displayName: "GPT-5 (Fast)",
        cost: { input: 2.5, output: 20, cacheRead: 0.25, cacheWrite: 0 },
      },
      "openai/gpt-5-mini": {
        id: "openai/gpt-5-mini",
        displayName: "GPT-5 mini",
        cost: { input: 0.25, output: 2, cacheRead: 0.025, cacheWrite: 0 },
      },
      "openai/gpt-5-mini-batch": {
        id: "openai/gpt-5-mini-batch",
        displayName: "GPT-5 mini (Batch)",
        cost: { input: 0.125, output: 1, cacheRead: 0.0125, cacheWrite: 0 },
      },
      "openai/gpt-5-mini-fast": {
        id: "openai/gpt-5-mini-fast",
        displayName: "GPT-5 mini (Fast)",
        cost: { input: 0.45, output: 3.6, cacheRead: 0.045, cacheWrite: 0 },
      },
      "openai/gpt-5-nano": {
        id: "openai/gpt-5-nano",
        displayName: "GPT-5 nano",
        cost: { input: 0.05, output: 0.4, cacheRead: 0.005, cacheWrite: 0 },
      },
      "openai/gpt-5-nano-batch": {
        id: "openai/gpt-5-nano-batch",
        displayName: "GPT-5 nano (Batch)",
        cost: { input: 0.025, output: 0.2, cacheRead: 0.0025, cacheWrite: 0 },
      },
      "openai/gpt-5-pro": {
        id: "openai/gpt-5-pro",
        displayName: "GPT-5 pro",
        cost: { input: 15, output: 120, cacheRead: 0, cacheWrite: 0 },
      },
      "openai/gpt-5-pro-batch": {
        id: "openai/gpt-5-pro-batch",
        displayName: "GPT-5 pro (Batch)",
        cost: { input: 7.5, output: 60, cacheRead: 0, cacheWrite: 0 },
      },
      "openai/gpt-5.1-codex": {
        id: "openai/gpt-5.1-codex",
        displayName: "GPT-5.1-Codex",
        cost: { input: 1.25, output: 10, cacheRead: 0.13, cacheWrite: 0 },
      },
      "openai/gpt-5.1-codex-max": {
        id: "openai/gpt-5.1-codex-max",
        displayName: "GPT 5.1 Codex Max",
        cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
      },
      "openai/gpt-5.1-codex-mini": {
        id: "openai/gpt-5.1-codex-mini",
        displayName: "GPT 5.1 Codex Mini",
        cost: { input: 0.25, output: 2, cacheRead: 0.03, cacheWrite: 0 },
      },
      "openai/gpt-5.1-thinking": {
        id: "openai/gpt-5.1-thinking",
        displayName: "GPT 5.1 Thinking",
        cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
      },
      "openai/gpt-5.1-thinking-fast": {
        id: "openai/gpt-5.1-thinking-fast",
        displayName: "GPT 5.1 Thinking (Fast)",
        cost: { input: 2.5, output: 20, cacheRead: 0.25, cacheWrite: 0 },
      },
      "openai/gpt-5.2": {
        id: "openai/gpt-5.2",
        displayName: "GPT 5.2",
        cost: { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 },
      },
      "openai/gpt-5.2-batch": {
        id: "openai/gpt-5.2-batch",
        displayName: "GPT 5.2 (Batch)",
        cost: { input: 0.875, output: 7, cacheRead: 0.0875, cacheWrite: 0 },
      },
      "openai/gpt-5.2-codex": {
        id: "openai/gpt-5.2-codex",
        displayName: "GPT 5.2 Codex",
        cost: { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 },
      },
      "openai/gpt-5.2-fast": {
        id: "openai/gpt-5.2-fast",
        displayName: "GPT 5.2 (Fast)",
        cost: { input: 3.5, output: 28, cacheRead: 0.35, cacheWrite: 0 },
      },
      "openai/gpt-5.2-pro": {
        id: "openai/gpt-5.2-pro",
        displayName: "GPT 5.2 ",
        cost: { input: 21, output: 168, cacheRead: 0, cacheWrite: 0 },
      },
      "openai/gpt-5.3-codex": {
        id: "openai/gpt-5.3-codex",
        displayName: "GPT 5.3 Codex",
        cost: { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 },
      },
      "openai/gpt-5.3-codex-fast": {
        id: "openai/gpt-5.3-codex-fast",
        displayName: "GPT 5.3 Codex (Fast)",
        cost: { input: 3.5, output: 28, cacheRead: 0.35, cacheWrite: 0 },
      },
      "openai/gpt-5.4": {
        id: "openai/gpt-5.4",
        displayName: "GPT 5.4",
        cost: { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 0 },
      },
      "openai/gpt-5.4-batch": {
        id: "openai/gpt-5.4-batch",
        displayName: "GPT 5.4 (Batch)",
        cost: { input: 1.25, output: 7.5, cacheRead: 0.125, cacheWrite: 0 },
      },
      "openai/gpt-5.4-fast": {
        id: "openai/gpt-5.4-fast",
        displayName: "GPT 5.4 (Fast)",
        cost: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 },
      },
      "openai/gpt-5.4-mini": {
        id: "openai/gpt-5.4-mini",
        displayName: "GPT 5.4 Mini",
        cost: { input: 0.75, output: 4.5, cacheRead: 0.075, cacheWrite: 0 },
      },
      "openai/gpt-5.4-mini-batch": {
        id: "openai/gpt-5.4-mini-batch",
        displayName: "GPT 5.4 Mini (Batch)",
        cost: { input: 0.375, output: 2.25, cacheRead: 0.0375, cacheWrite: 0 },
      },
      "openai/gpt-5.4-mini-fast": {
        id: "openai/gpt-5.4-mini-fast",
        displayName: "GPT 5.4 Mini (Fast)",
        cost: { input: 1.5, output: 9, cacheRead: 0.15, cacheWrite: 0 },
      },
      "openai/gpt-5.4-nano": {
        id: "openai/gpt-5.4-nano",
        displayName: "GPT 5.4 Nano",
        cost: { input: 0.2, output: 1.25, cacheRead: 0.02, cacheWrite: 0 },
      },
      "openai/gpt-5.4-nano-batch": {
        id: "openai/gpt-5.4-nano-batch",
        displayName: "GPT 5.4 Nano (Batch)",
        cost: { input: 0.1, output: 0.625, cacheRead: 0.01, cacheWrite: 0 },
      },
      "openai/gpt-5.4-pro": {
        id: "openai/gpt-5.4-pro",
        displayName: "GPT 5.4 Pro",
        cost: { input: 30, output: 180, cacheRead: 0, cacheWrite: 0 },
      },
      "openai/gpt-5.5": {
        id: "openai/gpt-5.5",
        displayName: "GPT 5.5",
        cost: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 },
      },
      "openai/gpt-5.5-batch": {
        id: "openai/gpt-5.5-batch",
        displayName: "GPT 5.5 (Batch)",
        cost: { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 0 },
      },
      "openai/gpt-5.5-fast": {
        id: "openai/gpt-5.5-fast",
        displayName: "GPT 5.5 (Fast)",
        cost: { input: 12.5, output: 75, cacheRead: 1.25, cacheWrite: 0 },
      },
      "openai/gpt-5.5-pro": {
        id: "openai/gpt-5.5-pro",
        displayName: "GPT 5.5 Pro",
        cost: { input: 30, output: 180, cacheRead: 0, cacheWrite: 0 },
      },
      "openai/gpt-5.5-pro-batch": {
        id: "openai/gpt-5.5-pro-batch",
        displayName: "GPT 5.5 Pro (Batch)",
        cost: { input: 15, output: 90, cacheRead: 0, cacheWrite: 0 },
      },
      "openai/gpt-5.6-luna": {
        id: "openai/gpt-5.6-luna",
        displayName: "GPT 5.6 Luna",
        cost: { input: 0.2, output: 1.2, cacheRead: 0.02, cacheWrite: 0.25 },
      },
      "openai/gpt-5.6-luna-batch": {
        id: "openai/gpt-5.6-luna-batch",
        displayName: "GPT 5.6 Luna (Batch)",
        cost: { input: 0.1, output: 0.6, cacheRead: 0.01, cacheWrite: 0.125 },
      },
      "openai/gpt-5.6-luna-fast": {
        id: "openai/gpt-5.6-luna-fast",
        displayName: "GPT 5.6 Luna (Fast)",
        cost: { input: 0.4, output: 2.4, cacheRead: 0.04, cacheWrite: 0.5 },
      },
      "openai/gpt-5.6-sol": {
        id: "openai/gpt-5.6-sol",
        displayName: "GPT 5.6 Sol",
        cost: { input: 4, output: 20, cacheRead: 0.4, cacheWrite: 5 },
      },
      "openai/gpt-5.6-sol-batch": {
        id: "openai/gpt-5.6-sol-batch",
        displayName: "GPT 5.6 Sol (Batch)",
        cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
      },
      "openai/gpt-5.6-sol-fast": {
        id: "openai/gpt-5.6-sol-fast",
        displayName: "GPT 5.6 Sol (Fast)",
        cost: { input: 8, output: 40, cacheRead: 0.8, cacheWrite: 10 },
      },
      "openai/gpt-5.6-terra": {
        id: "openai/gpt-5.6-terra",
        displayName: "GPT 5.6 Terra",
        cost: { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 2.5 },
      },
      "openai/gpt-5.6-terra-batch": {
        id: "openai/gpt-5.6-terra-batch",
        displayName: "GPT 5.6 Terra (Batch)",
        cost: { input: 1, output: 6, cacheRead: 0.1, cacheWrite: 1.25 },
      },
      "openai/gpt-5.6-terra-fast": {
        id: "openai/gpt-5.6-terra-fast",
        displayName: "GPT 5.6 Terra (Fast)",
        cost: { input: 4, output: 24, cacheRead: 0.4, cacheWrite: 5 },
      },
      "openai/gpt-6-astra": {
        id: "openai/gpt-6-astra",
        displayName: "GPT-6 Astra",
        cost: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
      },
      "openai/gpt-6-astra-batch": {
        id: "openai/gpt-6-astra-batch",
        displayName: "GPT-6 Astra (Batch)",
        cost: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
      },
      "openai/gpt-6-astra-fast": {
        id: "openai/gpt-6-astra-fast",
        displayName: "GPT-6 Astra (Fast)",
        cost: { input: 20, output: 100, cacheRead: 2, cacheWrite: 25 },
      },
      "openai/gpt-6-luna": {
        id: "openai/gpt-6-luna",
        displayName: "GPT-6 Luna",
        cost: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
      },
      "openai/gpt-6-luna-batch": {
        id: "openai/gpt-6-luna-batch",
        displayName: "GPT-6 Luna (Batch)",
        cost: { input: 0.05, output: 0.25, cacheRead: 0.005, cacheWrite: 0.0625 },
      },
      "openai/gpt-6-luna-fast": {
        id: "openai/gpt-6-luna-fast",
        displayName: "GPT-6 Luna (Fast)",
        cost: { input: 0.2, output: 1, cacheRead: 0.02, cacheWrite: 0.25 },
      },
      "openai/gpt-6-sol": {
        id: "openai/gpt-6-sol",
        displayName: "GPT-6 Sol",
        cost: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
      },
      "openai/gpt-6-sol-batch": {
        id: "openai/gpt-6-sol-batch",
        displayName: "GPT-6 Sol (Batch)",
        cost: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
      },
      "openai/gpt-6-sol-fast": {
        id: "openai/gpt-6-sol-fast",
        displayName: "GPT-6 Sol (Fast)",
        cost: { input: 4, output: 20, cacheRead: 0.4, cacheWrite: 5 },
      },
      "openai/gpt-6.1-sol": {
        id: "openai/gpt-6.1-sol",
        displayName: "GPT-6.1 Sol",
        cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
      },
      "openai/gpt-6.1-sol-batch": {
        id: "openai/gpt-6.1-sol-batch",
        displayName: "GPT-6.1 Sol (Batch)",
        cost: { input: 1, output: 5, cacheRead: 0.05, cacheWrite: 1.25 },
      },
      "openai/gpt-6.1-sol-fast": {
        id: "openai/gpt-6.1-sol-fast",
        displayName: "GPT-6.1 Sol (Fast)",
        cost: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
      },
      "openai/gpt-oss-120b": {
        id: "openai/gpt-oss-120b",
        displayName: "GPT OSS 120B",
        cost: { input: 0.1, output: 0.5, cacheRead: 0.1, cacheWrite: 0 },
      },
      "openai/gpt-oss-20b": {
        id: "openai/gpt-oss-20b",
        displayName: "GPT OSS 20B",
        cost: { input: 0.03, output: 0.14, cacheRead: 0, cacheWrite: 0 },
      },
      "openai/gpt-oss-safeguard-120b": {
        id: "openai/gpt-oss-safeguard-120b",
        displayName: "GPT OSS Safeguard 120B",
        cost: { input: 0.15, output: 0.6, cacheRead: 0, cacheWrite: 0 },
      },
      "openai/gpt-oss-safeguard-20b": {
        id: "openai/gpt-oss-safeguard-20b",
        displayName: "GPT OSS Safeguard 20B",
        cost: { input: 0.07, output: 0.2, cacheRead: 0, cacheWrite: 0 },
      },
      "openai/o1": {
        id: "openai/o1",
        displayName: "o1",
        cost: { input: 15, output: 60, cacheRead: 7.5, cacheWrite: 0 },
      },
      "openai/o3": {
        id: "openai/o3",
        displayName: "o3",
        cost: { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 0 },
      },
      "openai/o3-fast": {
        id: "openai/o3-fast",
        displayName: "o3 (Fast)",
        cost: { input: 3.5, output: 14, cacheRead: 0.875, cacheWrite: 0 },
      },
      "openai/o3-mini": {
        id: "openai/o3-mini",
        displayName: "o3-mini",
        cost: { input: 1.1, output: 4.4, cacheRead: 0.55, cacheWrite: 0 },
      },
      "openai/o3-pro": {
        id: "openai/o3-pro",
        displayName: "o3 Pro",
        cost: { input: 20, output: 80, cacheRead: 0, cacheWrite: 0 },
      },
      "openai/o4-mini": {
        id: "openai/o4-mini",
        displayName: "o4-mini",
        cost: { input: 1.1, output: 4.4, cacheRead: 0.275, cacheWrite: 0 },
      },
      "openai/o4-mini-fast": {
        id: "openai/o4-mini-fast",
        displayName: "o4-mini (Fast)",
        cost: { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 0 },
      },
      "poolside/laguna-s-2.1": {
        id: "poolside/laguna-s-2.1",
        displayName: "Laguna S 2.1",
        cost: { input: 0.09, output: 0.18, cacheRead: 0.009, cacheWrite: 0 },
      },
      "poolside/laguna-s-2.1-free": {
        id: "poolside/laguna-s-2.1-free",
        displayName: "Laguna S 2.1 Free",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "quiverai/arrow-2": {
        id: "quiverai/arrow-2",
        displayName: "Arrow 2",
        cost: { input: 4, output: 20, cacheRead: 0.4, cacheWrite: 5 },
      },
      "quiverai/arrow-2-telos": {
        id: "quiverai/arrow-2-telos",
        displayName: "Arrow 2 Telos",
        cost: { input: 6, output: 30, cacheRead: 0.6, cacheWrite: 7.5 },
      },
      "sakana/fugu-max": {
        id: "sakana/fugu-max",
        displayName: "Fugu Max",
        cost: { input: 2, output: 6, cacheRead: 0.25, cacheWrite: 0 },
      },
      "sakana/fugu-ultra": {
        id: "sakana/fugu-ultra",
        displayName: "Fugu Ultra",
        cost: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 },
      },
      "sakana/fugu-ultra-v2": {
        id: "sakana/fugu-ultra-v2",
        displayName: "Fugu Ultra v2",
        cost: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 0 },
      },
      "sakana/namazu": {
        id: "sakana/namazu",
        displayName: "Sakana Namazu",
        cost: { input: 0.95, output: 4, cacheRead: 0.15, cacheWrite: 0 },
      },
      "spacexai/grok-4.1-fast-non-reasoning": {
        id: "spacexai/grok-4.1-fast-non-reasoning",
        displayName: "Grok 4.1 Fast Non-Reasoning",
        cost: { input: 0.2, output: 0.5, cacheRead: 0.05, cacheWrite: 0 },
      },
      "spacexai/grok-4.1-fast-reasoning": {
        id: "spacexai/grok-4.1-fast-reasoning",
        displayName: "Grok 4.1 Fast Reasoning",
        cost: { input: 0.2, output: 0.5, cacheRead: 0.05, cacheWrite: 0 },
      },
      "spacexai/grok-4.20-multi-agent": {
        id: "spacexai/grok-4.20-multi-agent",
        displayName: "Grok 4.20 Multi-Agent",
        cost: { input: 1.25, output: 2.5, cacheRead: 0.2, cacheWrite: 0 },
      },
      "spacexai/grok-4.20-multi-agent-batch": {
        id: "spacexai/grok-4.20-multi-agent-batch",
        displayName: "Grok 4.20 Multi-Agent (Batch)",
        cost: { input: 1, output: 2, cacheRead: 0.16, cacheWrite: 0 },
      },
      "spacexai/grok-4.20-multi-agent-beta": {
        id: "spacexai/grok-4.20-multi-agent-beta",
        displayName: "Grok 4.20 Multi Agent Beta",
        cost: { input: 1.25, output: 2.5, cacheRead: 0.2, cacheWrite: 0 },
      },
      "spacexai/grok-4.20-non-reasoning": {
        id: "spacexai/grok-4.20-non-reasoning",
        displayName: "Grok 4.20 Non-Reasoning",
        cost: { input: 1.25, output: 2.5, cacheRead: 0.2, cacheWrite: 0 },
      },
      "spacexai/grok-4.20-non-reasoning-batch": {
        id: "spacexai/grok-4.20-non-reasoning-batch",
        displayName: "Grok 4.20 Non-Reasoning (Batch)",
        cost: { input: 1, output: 2, cacheRead: 0.16, cacheWrite: 0 },
      },
      "spacexai/grok-4.20-non-reasoning-beta": {
        id: "spacexai/grok-4.20-non-reasoning-beta",
        displayName: "Grok 4.20 Beta Non-Reasoning",
        cost: { input: 1.25, output: 2.5, cacheRead: 0.2, cacheWrite: 0 },
      },
      "spacexai/grok-4.20-reasoning": {
        id: "spacexai/grok-4.20-reasoning",
        displayName: "Grok 4.20 Reasoning",
        cost: { input: 1.25, output: 2.5, cacheRead: 0.2, cacheWrite: 0 },
      },
      "spacexai/grok-4.20-reasoning-batch": {
        id: "spacexai/grok-4.20-reasoning-batch",
        displayName: "Grok 4.20 Reasoning (Batch)",
        cost: { input: 1, output: 2, cacheRead: 0.16, cacheWrite: 0 },
      },
      "spacexai/grok-4.20-reasoning-beta": {
        id: "spacexai/grok-4.20-reasoning-beta",
        displayName: "Grok 4.20 Beta Reasoning",
        cost: { input: 1.25, output: 2.5, cacheRead: 0.2, cacheWrite: 0 },
      },
      "spacexai/grok-4.3": {
        id: "spacexai/grok-4.3",
        displayName: "Grok 4.3",
        cost: { input: 1.25, output: 2.5, cacheRead: 0.2, cacheWrite: 0 },
      },
      "spacexai/grok-4.3-batch": {
        id: "spacexai/grok-4.3-batch",
        displayName: "Grok 4.3 (Batch)",
        cost: { input: 1, output: 2, cacheRead: 0.16, cacheWrite: 0 },
      },
      "spacexai/grok-4.5": {
        id: "spacexai/grok-4.5",
        displayName: "Grok 4.5",
        cost: { input: 2, output: 6, cacheRead: 0.3, cacheWrite: 0 },
      },
      "spacexai/grok-4.6": {
        id: "spacexai/grok-4.6",
        displayName: "Grok 4.6",
        cost: { input: 2, output: 6, cacheRead: 0.5, cacheWrite: 0 },
      },
      "spacexai/grok-4.7": {
        id: "spacexai/grok-4.7",
        displayName: "Grok 4.7",
        cost: { input: 2, output: 6, cacheRead: 0.5, cacheWrite: 0 },
      },
      "spacexai/grok-build-0.1": {
        id: "spacexai/grok-build-0.1",
        displayName: "Grok Build 0.1",
        cost: { input: 1, output: 2, cacheRead: 0.2, cacheWrite: 0 },
      },
      "stealth/cat-jam": {
        id: "stealth/cat-jam",
        displayName: "Cat Jam",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "stealth/glyph-cluster": {
        id: "stealth/glyph-cluster",
        displayName: "Glyph Cluster",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "stepfun/step-3.7-flash": {
        id: "stepfun/step-3.7-flash",
        displayName: "Step 3.7 Flash",
        cost: { input: 0.2, output: 1.15, cacheRead: 0.04, cacheWrite: 0 },
      },
      "stepfun/step-5-preview": {
        id: "stepfun/step-5-preview",
        displayName: "Step 5 Preview",
        cost: { input: 1, output: 2.7, cacheRead: 0.05, cacheWrite: 0 },
      },
      "tencent/hy3": {
        id: "tencent/hy3",
        displayName: "Hy3",
        cost: { input: 0.14, output: 0.58, cacheRead: 0.035, cacheWrite: 0 },
      },
      "tencent/hy4-preview": {
        id: "tencent/hy4-preview",
        displayName: "Tencent Hy4 Preview",
        cost: { input: 0.834, output: 2.501, cacheRead: 0.042, cacheWrite: 0 },
      },
      "thinkingmachines/inkling": {
        id: "thinkingmachines/inkling",
        displayName: "Inkling",
        cost: { input: 1, output: 4.05, cacheRead: 0.17, cacheWrite: 0 },
      },
      "thinkingmachines/inkling-small": {
        id: "thinkingmachines/inkling-small",
        displayName: "Inkling Small",
        cost: { input: 0.45, output: 1.2, cacheRead: 0.1, cacheWrite: 0 },
      },
      "xiaomi/mimo-v2.5": {
        id: "xiaomi/mimo-v2.5",
        displayName: "MiMo M2.5",
        cost: { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0 },
      },
      "xiaomi/mimo-v2.5-pro": {
        id: "xiaomi/mimo-v2.5-pro",
        displayName: "MiMo V2.5 Pro",
        cost: { input: 0.3045, output: 0.609, cacheRead: 0.0028, cacheWrite: 0 },
      },
      "xiaomi/mimo-v2.6-flash": {
        id: "xiaomi/mimo-v2.6-flash",
        displayName: "MiMo V2.6 Flash",
        cost: { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0 },
      },
      "xiaomi/mimo-v2.6-pro": {
        id: "xiaomi/mimo-v2.6-pro",
        displayName: "MiMo V2.6 Pro",
        cost: { input: 0.435, output: 0.87, cacheRead: 0.0036, cacheWrite: 0 },
      },
      "xiaomi/mimo-v2.6-pro-ultraspeed": {
        id: "xiaomi/mimo-v2.6-pro-ultraspeed",
        displayName: "MiMo V2.6 Pro UltraSpeed",
        cost: { input: 4.35, output: 8.7, cacheRead: 0.036, cacheWrite: 0 },
      },
      "zai/glm-4.5": {
        id: "zai/glm-4.5",
        displayName: "GLM 4.5",
        cost: { input: 0.6, output: 2.2, cacheRead: 0.11, cacheWrite: 0 },
      },
      "zai/glm-4.5-air": {
        id: "zai/glm-4.5-air",
        displayName: "GLM 4.5 Air",
        cost: { input: 0.2, output: 1.1, cacheRead: 0.03, cacheWrite: 0 },
      },
      "zai/glm-4.5v": {
        id: "zai/glm-4.5v",
        displayName: "GLM 4.5V",
        cost: { input: 0.6, output: 1.8, cacheRead: 0.11, cacheWrite: 0 },
      },
      "zai/glm-4.6": {
        id: "zai/glm-4.6",
        displayName: "GLM 4.6",
        cost: { input: 0.6, output: 2.2, cacheRead: 0.11, cacheWrite: 0 },
      },
      "zai/glm-4.7": {
        id: "zai/glm-4.7",
        displayName: "GLM 4.7",
        cost: { input: 0.6, output: 2.2, cacheRead: 0, cacheWrite: 0 },
      },
      "zai/glm-4.7-flash": {
        id: "zai/glm-4.7-flash",
        displayName: "GLM 4.7 Flash",
        cost: { input: 0.07, output: 0.4, cacheRead: 0, cacheWrite: 0 },
      },
      "zai/glm-4.7-flashx": {
        id: "zai/glm-4.7-flashx",
        displayName: "GLM 4.7 FlashX",
        cost: { input: 0.06, output: 0.4, cacheRead: 0.01, cacheWrite: 0 },
      },
      "zai/glm-5": {
        id: "zai/glm-5",
        displayName: "GLM 5",
        cost: { input: 1, output: 3.2, cacheRead: 0, cacheWrite: 0 },
      },
      "zai/glm-5-turbo": {
        id: "zai/glm-5-turbo",
        displayName: "GLM 5 Turbo",
        cost: { input: 1.2, output: 4, cacheRead: 0.24, cacheWrite: 0 },
      },
      "zai/glm-5.1": {
        id: "zai/glm-5.1",
        displayName: "GLM 5.1",
        cost: { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 },
      },
      "zai/glm-5.2": {
        id: "zai/glm-5.2",
        displayName: "GLM 5.2",
        cost: { input: 0.8, output: 2.55, cacheRead: 0.16, cacheWrite: 0 },
      },
      "zai/glm-5.2-fast": {
        id: "zai/glm-5.2-fast",
        displayName: "GLM 5.2 Fast",
        cost: { input: 2.8, output: 8.8, cacheRead: 0.56, cacheWrite: 0 },
      },
      "zai/glm-5.3": {
        id: "zai/glm-5.3",
        displayName: "GLM 5.3",
        cost: { input: 1.4, output: 4.4, cacheRead: 0.14, cacheWrite: 0 },
      },
      "zai/glm-5.3-fast": {
        id: "zai/glm-5.3-fast",
        displayName: "GLM 5.3 Fast",
        cost: { input: 2.1, output: 6.6, cacheRead: 0.21, cacheWrite: 0 },
      },
      "zai/glm-5.3-flash": {
        id: "zai/glm-5.3-flash",
        displayName: "GLM 5.3 Flash",
        cost: { input: 0.15, output: 0.5, cacheRead: 0.03, cacheWrite: 0 },
      },
      "zai/glm-5.3-flashx": {
        id: "zai/glm-5.3-flashx",
        displayName: "GLM 5.3 FlashX",
        cost: { input: 0.37, output: 1.25, cacheRead: 0.075, cacheWrite: 0 },
      },
      "zai/glm-5v-turbo": {
        id: "zai/glm-5v-turbo",
        displayName: "GLM 5V Turbo",
        cost: { input: 1.2, output: 4, cacheRead: 0.24, cacheWrite: 0 },
      },
    },
  },
  {
    id: "xai",
    displayName: "xAI",
    providerType: "openai-compatible",
    defaultBaseUrl: "https://api.x.ai/v1",
    useResponsesApi: true,
    models: {
      "grok-4.3": {
        id: "grok-4.3",
        displayName: "Grok 4.3",
        cost: { input: 1.25, output: 2.5, cacheRead: 0.2, cacheWrite: 0 },
      },
      "grok-4.5": {
        id: "grok-4.5",
        displayName: "Grok 4.5",
        cost: { input: 2, output: 6, cacheRead: 0.3, cacheWrite: 0 },
      },
      "grok-4.6": {
        id: "grok-4.6",
        displayName: "Grok 4.6",
        cost: { input: 2, output: 6, cacheRead: 0.5, cacheWrite: 0 },
      },
      "grok-4.7": {
        id: "grok-4.7",
        displayName: "Grok 4.7",
        cost: { input: 2, output: 6, cacheRead: 0.5, cacheWrite: 0 },
      },
    },
  },
  {
    id: "xiaomi",
    displayName: "Xiaomi",
    providerType: "openai-compatible",
    defaultBaseUrl: "https://api.xiaomimimo.com/v1",
    models: {
      "mimo-v2.5": {
        id: "mimo-v2.5",
        displayName: "MiMo-V2.5",
        cost: { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0 },
      },
      "mimo-v2.5-pro": {
        id: "mimo-v2.5-pro",
        displayName: "MiMo-V2.5-Pro",
        cost: { input: 0.435, output: 0.87, cacheRead: 0.0036, cacheWrite: 0 },
      },
      "mimo-v2.5-pro-ultraspeed": {
        id: "mimo-v2.5-pro-ultraspeed",
        displayName: "MiMo-V2.5-Pro-UltraSpeed",
        cost: { input: 1.305, output: 2.61, cacheRead: 0.0108, cacheWrite: 0 },
      },
      "mimo-v2.6-flash": {
        id: "mimo-v2.6-flash",
        displayName: "MiMo-V2.6-Flash",
        cost: { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0 },
      },
      "mimo-v2.6-pro": {
        id: "mimo-v2.6-pro",
        displayName: "MiMo-V2.6-Pro",
        cost: { input: 0.435, output: 0.87, cacheRead: 0.0036, cacheWrite: 0 },
      },
      "mimo-v2.6-pro-ultraspeed": {
        id: "mimo-v2.6-pro-ultraspeed",
        displayName: "MiMo-V2.6-Pro-UltraSpeed",
        cost: { input: 4.35, output: 8.7, cacheRead: 0.036, cacheWrite: 0 },
      },
    },
  },
  {
    id: "xiaomi-token-plan-ams",
    displayName: "Xiaomi Token Plan AMS",
    providerType: "openai-compatible",
    defaultBaseUrl: "https://token-plan-ams.xiaomimimo.com/v1",
    models: {
      "mimo-v2.5": {
        id: "mimo-v2.5",
        displayName: "MiMo-V2.5",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "mimo-v2.5-pro": {
        id: "mimo-v2.5-pro",
        displayName: "MiMo-V2.5-Pro",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "mimo-v2.6-flash": {
        id: "mimo-v2.6-flash",
        displayName: "MiMo-V2.6-Flash",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "mimo-v2.6-pro": {
        id: "mimo-v2.6-pro",
        displayName: "MiMo-V2.6-Pro",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
    },
  },
  {
    id: "xiaomi-token-plan-cn",
    displayName: "Xiaomi Token Plan CN",
    providerType: "openai-compatible",
    defaultBaseUrl: "https://token-plan-cn.xiaomimimo.com/v1",
    models: {
      "mimo-v2.5": {
        id: "mimo-v2.5",
        displayName: "MiMo-V2.5",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "mimo-v2.5-pro": {
        id: "mimo-v2.5-pro",
        displayName: "MiMo-V2.5-Pro",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "mimo-v2.6-flash": {
        id: "mimo-v2.6-flash",
        displayName: "MiMo-V2.6-Flash",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "mimo-v2.6-pro": {
        id: "mimo-v2.6-pro",
        displayName: "MiMo-V2.6-Pro",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
    },
  },
  {
    id: "xiaomi-token-plan-sgp",
    displayName: "Xiaomi Token Plan SGP",
    providerType: "openai-compatible",
    defaultBaseUrl: "https://token-plan-sgp.xiaomimimo.com/v1",
    models: {
      "mimo-v2.5": {
        id: "mimo-v2.5",
        displayName: "MiMo-V2.5",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "mimo-v2.5-pro": {
        id: "mimo-v2.5-pro",
        displayName: "MiMo-V2.5-Pro",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "mimo-v2.6-flash": {
        id: "mimo-v2.6-flash",
        displayName: "MiMo-V2.6-Flash",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "mimo-v2.6-pro": {
        id: "mimo-v2.6-pro",
        displayName: "MiMo-V2.6-Pro",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
    },
  },
  {
    id: "zai",
    displayName: "Z.AI",
    providerType: "openai-compatible",
    defaultBaseUrl: "https://api.z.ai/api/coding/paas/v4",
    models: {
      "glm-4.7": {
        id: "glm-4.7",
        displayName: "GLM-4.7",
        cost: { input: 0.6, output: 2.2, cacheRead: 0.11, cacheWrite: 0 },
      },
      "glm-5-turbo": {
        id: "glm-5-turbo",
        displayName: "GLM-5-Turbo",
        cost: { input: 1.2, output: 4, cacheRead: 0.24, cacheWrite: 0 },
      },
      "glm-5.2": {
        id: "glm-5.2",
        displayName: "GLM-5.2",
        cost: { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 },
      },
      "glm-5.2-highspeed": {
        id: "glm-5.2-highspeed",
        displayName: "GLM-5.2 Highspeed",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      "glm-5.3": {
        id: "glm-5.3",
        displayName: "GLM-5.3",
        cost: { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 },
      },
      "glm-5.3-flash": {
        id: "glm-5.3-flash",
        displayName: "GLM-5.3-Flash",
        cost: { input: 0.15, output: 0.5, cacheRead: 0.03, cacheWrite: 0 },
      },
      "glm-5.3-highspeed": {
        id: "glm-5.3-highspeed",
        displayName: "GLM-5.3 Highspeed",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
    },
  },
  {
    id: "zai-coding-cn",
    displayName: "Z.AI Coding CN",
    providerType: "openai-compatible",
    defaultBaseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
    models: {
      "glm-4.6v": {
        id: "glm-4.6v",
        displayName: "GLM-4.6V",
        cost: { input: 0.3, output: 0.9, cacheRead: 0, cacheWrite: 0 },
      },
      "glm-5.3": {
        id: "glm-5.3",
        displayName: "GLM-5.3",
        cost: { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 },
      },
      "glm-5.3-flash": {
        id: "glm-5.3-flash",
        displayName: "GLM-5.3-Flash",
        cost: { input: 0.15, output: 0.5, cacheRead: 0.03, cacheWrite: 0 },
      },
      "glm-5.3-highspeed": {
        id: "glm-5.3-highspeed",
        displayName: "GLM-5.3 Highspeed",
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
    },
  },
];
