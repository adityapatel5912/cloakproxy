/**
 * Optional, clearly-labeled free-cloud fallback for demo/recording when the
 * Firebase AI Logic cloud stage is unavailable (e.g. no Blaze billing).
 * Order: Google AI Studio (Gemini Developer API, free tier) → OpenRouter free model.
 * The HUD shows exactly which provider answered; nothing here pretends to be
 * a Firebase AI Logic call. Keys come from gitignored .env.local only.
 */

export interface FreeCloudResult {
  readonly text: string;
  readonly provider: "ai-studio" | "openrouter";
  readonly model: string;
}

function env(name: string): string | undefined {
  const v = (import.meta.env as Record<string, string | undefined>)[name];
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

async function aiStudio(prompt: string): Promise<FreeCloudResult> {
  const key = env("AISTUDIO_API_KEY");
  if (!key) throw new Error("AISTUDIO_API_KEY not set");
  const model = env("VITE_FREE_CLOUD_MODEL") ?? "gemini-3.5-flash";
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2 },
      }),
    },
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`AI Studio ${res.status}: ${(json?.error?.message ?? res.statusText).slice(0, 140)}`);
  const text = (json.candidates?.[0]?.content?.parts ?? [])
    .map((p: { text?: string }) => p.text ?? "")
    .join("");
  if (!text) throw new Error("AI Studio returned no text");
  return { text, provider: "ai-studio", model };
}

async function openRouter(prompt: string): Promise<FreeCloudResult> {
  const key = env("OPENROUTER_Key");
  if (!key) throw new Error("OPENROUTER_Key not set");
  const candidates = [
    env("VITE_OPENROUTER_MODEL") ?? "openrouter/free",
    "google/gemini-2.0-flash-exp:free",
    "meta-llama/llama-3.1-8b-instruct:free",
  ];
  let lastError = "no OpenRouter model responded";
  for (const model of candidates) {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok) {
      const text = json.choices?.[0]?.message?.content;
      if (typeof text === "string" && text.length > 0) {
        return { text, provider: "openrouter", model };
      }
      lastError = "empty completion";
    } else {
      lastError = `${res.status}: ${(json?.error?.message ?? res.statusText).slice(0, 120)}`;
    }
  }
  throw new Error(`OpenRouter ${lastError}`);
}

export async function generateFreeCloud(prompt: string): Promise<FreeCloudResult> {
  try {
    return await aiStudio(prompt);
  } catch {
    return openRouter(prompt);
  }
}
