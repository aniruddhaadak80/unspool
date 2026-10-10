import { createOpenAI } from "@ai-sdk/openai";

/**
 * Model provider. The agent runs on any OpenAI-compatible endpoint — the
 * default is OpenRouter (which fronts frontier models), but a plain OpenAI key
 * or a local Ollama/vLLM server works by swapping the base URL.
 *
 * If no key is configured the app falls back to a deterministic, graph-driven
 * "replay" agent so the demo never hard-fails — but that path is clearly
 * labeled in the UI and in traces.
 */

export function getModel() {
  const apiKey =
    process.env.OPENROUTER_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.AGENT_API_KEY;

  const baseURL =
    process.env.AGENT_BASE_URL ||
    (process.env.OPENROUTER_API_KEY
      ? "https://openrouter.ai/api/v1"
      : undefined);

  const modelId =
    process.env.AGENT_MODEL ||
    (process.env.OPENROUTER_API_KEY
      ? "openai/gpt-4o-mini"
      : "gpt-4o-mini");

  if (!apiKey) return null;

  const provider = createOpenAI({
    apiKey,
    baseURL,
    headers: {
      // OpenRouter asks for these so apps can be identified / ranked.
      "HTTP-Referer": process.env.APP_URL || "https://unspool.vercel.app",
      "X-Title": "Unspool — incident command that shows its work",
    },
  });

  return provider.chat(modelId);
}

export function hasLiveModel(): boolean {
  return Boolean(
    process.env.OPENROUTER_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.AGENT_API_KEY,
  );
}

export function modelLabel(): string {
  if (!hasLiveModel()) return "replay (no key)";
  return (
    process.env.AGENT_MODEL ||
    (process.env.OPENROUTER_API_KEY ? "openai/gpt-4o-mini" : "gpt-4o-mini")
  );
}
