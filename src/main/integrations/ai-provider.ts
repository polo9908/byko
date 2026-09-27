import { shell } from "electron"
import { deleteSecret, getSecret, setSecret } from "../secrets"
import { AI_PROVIDERS, getProviderMeta } from "../../shared/ai"
import type { AIConnectionStatus, AIProviderId } from "../../shared/ai"

/**
 * Intégration fournisseur IA (ticket E2), multi-fournisseurs. Comme pour
 * Jira (E1), aucune clé ne transite vers le renderer une fois saisie ou
 * détectée : seule une forme masquée (`maskedKey`) est renvoyée via IPC.
 */

function secretKey(provider: AIProviderId): string {
  return `ai.${provider}.apiKey`
}

function maskKey(key: string): string {
  if (key.length <= 11) return "••••"
  return `${key.slice(0, 7)}…${key.slice(-4)}`
}

async function verifyKey(provider: AIProviderId, key: string): Promise<boolean> {
  switch (provider) {
    case "anthropic": {
      const response = await fetch("https://api.anthropic.com/v1/models", {
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
      })
      return response.ok
    }
    case "openai": {
      const response = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${key}` },
      })
      return response.ok
    }
    case "gemini": {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
      )
      return response.ok
    }
    case "deepseek": {
      const response = await fetch("https://api.deepseek.com/v1/models", {
        headers: { Authorization: `Bearer ${key}` },
      })
      return response.ok
    }
    case "kimi": {
      const response = await fetch("https://api.moonshot.ai/v1/models", {
        headers: { Authorization: `Bearer ${key}` },
      })
      return response.ok
    }
    case "grok": {
      const response = await fetch("https://api.x.ai/v1/models", {
        headers: { Authorization: `Bearer ${key}` },
      })
      return response.ok
    }
  }
}

/** Ouvre la page de création de clé du fournisseur dans le navigateur système, jamais dans une fenêtre interne. */
export async function openKeyPage(provider: AIProviderId): Promise<void> {
  await shell.openExternal(getProviderMeta(provider).keyPageUrl)
}

export async function getStatus(): Promise<AIConnectionStatus> {
  for (const meta of AI_PROVIDERS) {
    const stored = await getSecret(secretKey(meta.id))
    if (stored) {
      return { connected: true, provider: meta.id, maskedKey: maskKey(stored) }
    }
  }
  for (const meta of AI_PROVIDERS) {
    const detected = process.env[meta.envVar]
    if (detected) {
      return { connected: false, provider: meta.id, maskedKey: maskKey(detected), detectedOnDevice: true }
    }
  }
  return { connected: false }
}

export async function useDetectedKey(provider: AIProviderId): Promise<AIConnectionStatus> {
  const detected = process.env[getProviderMeta(provider).envVar]
  if (!detected) {
    throw new Error(`Aucune clé ${getProviderMeta(provider).label} détectée sur cet appareil.`)
  }
  if (!(await verifyKey(provider, detected))) {
    throw new Error(`La clé ${getProviderMeta(provider).label} détectée sur cet appareil n'est plus valide.`)
  }
  await setSecret(secretKey(provider), detected)
  return { connected: true, provider, maskedKey: maskKey(detected) }
}

export async function setCustomKey(provider: AIProviderId, key: string): Promise<AIConnectionStatus> {
  if (!(await verifyKey(provider, key))) {
    throw new Error(`Clé ${getProviderMeta(provider).label} invalide. Vérifiez qu'elle est correcte et active.`)
  }
  await setSecret(secretKey(provider), key)
  return { connected: true, provider, maskedKey: maskKey(key) }
}

export async function disconnect(provider: AIProviderId): Promise<void> {
  await deleteSecret(secretKey(provider))
}

const OPENAI_COMPATIBLE_BASE_URL: Record<Exclude<AIProviderId, "anthropic" | "gemini">, string> = {
  openai: "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com/v1",
  kimi: "https://api.moonshot.ai/v1",
  grok: "https://api.x.ai/v1",
}

async function completeAnthropic(key: string, prompt: string): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-3-5-haiku-latest",
      max_tokens: 600,
      messages: [{ role: "user", content: prompt }],
    }),
  })
  if (!response.ok) {
    throw new Error(`Appel Anthropic refusé (${response.status}).`)
  }
  const body = (await response.json()) as { content: Array<{ text?: string }> }
  return body.content.map((block) => block.text ?? "").join("")
}

async function completeGemini(key: string, prompt: string): Promise<string> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    },
  )
  if (!response.ok) {
    throw new Error(`Appel Gemini refusé (${response.status}).`)
  }
  const body = (await response.json()) as { candidates: Array<{ content: { parts: Array<{ text?: string }> } }> }
  return body.candidates[0]?.content.parts.map((part) => part.text ?? "").join("") ?? ""
}

async function completeOpenAiCompatible(
  provider: Exclude<AIProviderId, "anthropic" | "gemini">,
  key: string,
  prompt: string,
): Promise<string> {
  const model =
    provider === "openai"
      ? "gpt-4o-mini"
      : provider === "deepseek"
        ? "deepseek-chat"
        : provider === "kimi"
          ? "moonshot-v1-8k"
          : "grok-2-latest"
  const response = await fetch(`${OPENAI_COMPATIBLE_BASE_URL[provider]}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }] }),
  })
  if (!response.ok) {
    throw new Error(`Appel ${getProviderMeta(provider).label} refusé (${response.status}).`)
  }
  const body = (await response.json()) as { choices: Array<{ message: { content?: string } }> }
  return body.choices[0]?.message.content ?? ""
}

/** Génère du texte avec le fournisseur actuellement connecté (utilisé par B3 pour le compte rendu de réunion). */
export async function complete(prompt: string): Promise<string> {
  const status = await getStatus()
  if (!status.connected || !status.provider) {
    throw new Error("Aucun fournisseur IA connecté.")
  }
  const key = await getSecret(secretKey(status.provider))
  if (!key) {
    throw new Error("Clé introuvable pour le fournisseur connecté.")
  }
  if (status.provider === "anthropic") return completeAnthropic(key, prompt)
  if (status.provider === "gemini") return completeGemini(key, prompt)
  return completeOpenAiCompatible(status.provider, key, prompt)
}
