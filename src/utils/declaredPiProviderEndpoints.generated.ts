// 由锁定 Pi SDK 的公开目录自动生成；端点事实不得手工修改。https://github.com/ItsDalk-Lane/Vault-Agent/issues/2
export const DECLARED_PI_PROVIDER_ENDPOINTS: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {
  "ant-ling": { "openai-completions": "https://api.ant-ling.com/v1" },
  anthropic: { "anthropic-messages": "https://api.anthropic.com" },
  baseten: { "openai-completions": "https://inference.baseten.co/v1" },
  cerebras: { "openai-completions": "https://api.cerebras.ai/v1" },
  "cloudflare-ai-gateway": {
    "anthropic-messages":
      "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/anthropic",
    "openai-completions":
      "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/compat",
    "openai-responses":
      "https://gateway.ai.cloudflare.com/v1/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/openai",
  },
  "cloudflare-workers-ai": {
    "openai-completions":
      "https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/ai/v1",
  },
  deepseek: { "openai-completions": "https://api.deepseek.com" },
  fireworks: {
    "anthropic-messages": "https://api.fireworks.ai/inference",
    "openai-completions": "https://api.fireworks.ai/inference/v1",
  },
  "github-copilot": {
    "anthropic-messages": "https://api.individual.githubcopilot.com",
    "openai-completions": "https://api.individual.githubcopilot.com",
    "openai-responses": "https://api.individual.githubcopilot.com",
  },
  google: { "google-generative-ai": "https://generativelanguage.googleapis.com/v1beta" },
  groq: { "openai-completions": "https://api.groq.com/openai/v1" },
  huggingface: { "openai-completions": "https://router.huggingface.co/v1" },
  "kimi-coding": { "openai-completions": "https://api.kimi.com/coding/v1" },
  meta: { "openai-responses": "https://api.meta.ai/v1" },
  minimax: { "anthropic-messages": "https://api.minimax.io/anthropic" },
  "minimax-cn": { "anthropic-messages": "https://api.minimaxi.com/anthropic" },
  moonshotai: { "openai-completions": "https://api.moonshot.ai/v1" },
  "moonshotai-cn": { "openai-completions": "https://api.moonshot.cn/v1" },
  nvidia: { "openai-completions": "https://integrate.api.nvidia.com/v1" },
  openai: { "openai-responses": "https://api.openai.com/v1" },
  opencode: {
    "anthropic-messages": "https://opencode.ai/inference",
    "google-generative-ai": "https://opencode.ai/inference/v1",
    "openai-completions": "https://opencode.ai/inference/v1",
    "openai-responses": "https://opencode.ai/inference/v1",
  },
  "opencode-go": {
    "anthropic-messages": "https://opencode.ai/inference/go",
    "google-generative-ai": "https://opencode.ai/inference/go/v1",
    "openai-completions": "https://opencode.ai/inference/go/v1",
    "openai-responses": "https://opencode.ai/inference/go/v1",
  },
  openrouter: {
    "anthropic-messages": "https://openrouter.ai/api",
    "openai-completions": "https://openrouter.ai/api/v1",
  },
  "qwen-token-plan": {
    "openai-completions": "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
  },
  "qwen-token-plan-cn": {
    "openai-completions": "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
  },
  "qwen-token-plan-individual": {
    "openai-completions": "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
  },
  together: { "openai-completions": "https://api.together.ai/v1" },
  "vercel-ai-gateway": { "anthropic-messages": "https://ai-gateway.vercel.sh" },
  xai: { "openai-responses": "https://api.x.ai/v1" },
  xiaomi: { "openai-completions": "https://api.xiaomimimo.com/v1" },
  "xiaomi-token-plan-ams": { "openai-completions": "https://token-plan-ams.xiaomimimo.com/v1" },
  "xiaomi-token-plan-cn": { "openai-completions": "https://token-plan-cn.xiaomimimo.com/v1" },
  "xiaomi-token-plan-sgp": { "openai-completions": "https://token-plan-sgp.xiaomimimo.com/v1" },
  zai: { "openai-completions": "https://api.z.ai/api/coding/paas/v4" },
  "zai-coding-cn": { "openai-completions": "https://open.bigmodel.cn/api/coding/paas/v4" },
};
