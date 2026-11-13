import type { AppEnv } from "../../config/env.js";
import { err, ok, type Result } from "../../lib/result.js";

export type LlmMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type LlmClient = {
  complete(messages: LlmMessage[], maxTokens: number): Promise<Result<string, string>>;
  tokensUsed: number;
};

export type LlmClientFactory = (env: AppEnv) => LlmClient;

export function createLlmClient(env: AppEnv): LlmClient {
  if (env.LLM_PROVIDER === "mock") {
    return new MockLlmClient();
  }
  return new OpenAiCompatibleClient(env);
}

class MockLlmClient implements LlmClient {
  tokensUsed = 0;

  async complete(messages: LlmMessage[], maxTokens: number): Promise<Result<string, string>> {
    const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    this.tokensUsed += Math.min(maxTokens, Math.ceil(lastUser.length / 4) + 64);

    if (lastUser.includes("orchestrator")) {
      return ok(
        JSON.stringify({
          plan: ["normalizer", "analyst", "verifier", "reporter"],
          notes: "mock-orchestrator-plan",
        }),
      );
    }

    if (lastUser.includes("comparison filter")) {
      return ok(
        JSON.stringify({
          vehicle_class: "Compact Cars",
          year_min: 2008,
          year_max: 2012,
          min_displacement_l: 1.8,
          max_displacement_l: 3.5,
        }),
      );
    }

    return ok(
      "EPA-backed summary: figures below were computed from the local SQLite ingest; verify scope before shop use.",
    );
  }
}

class OpenAiCompatibleClient implements LlmClient {
  tokensUsed = 0;

  constructor(private readonly env: AppEnv) {}

  async complete(messages: LlmMessage[], maxTokens: number): Promise<Result<string, string>> {
    if (!this.env.LLM_API_KEY) {
      return err("LLM_API_KEY is required when LLM_PROVIDER=openai");
    }

    const response = await fetch(`${this.env.LLM_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.env.LLM_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.env.LLM_MODEL,
        messages,
        max_tokens: maxTokens,
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      return err(`LLM HTTP ${response.status}`);
    }

    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { total_tokens?: number };
    };

    const content = json.choices?.[0]?.message?.content;
    if (!content) return err("LLM returned empty content");

    this.tokensUsed += json.usage?.total_tokens ?? maxTokens;
    return ok(content);
  }
}
