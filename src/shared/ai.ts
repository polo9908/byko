/**
 * Types et registre des fournisseurs IA (ticket E2). Le registre est la
 * seule liste à étendre pour ajouter un fournisseur : le reste (backend,
 * IPC, écran A3) boucle dessus plutôt que de coder chaque fournisseur en dur.
 * Fournisseurs et couleurs relevés sur le prototype `BCC Medium.html`.
 */

export type AIProviderId = "anthropic" | "openai" | "gemini" | "deepseek" | "kimi" | "grok"

export interface AIProviderMeta {
  id: AIProviderId
  label: string
  /** Lettre affichée dans le badge coloré du sélecteur de fournisseur. */
  letter: string
  /** Couleur de fond du badge, relevée sur le prototype. */
  color: string
  /** Page où l'utilisateur crée sa clé API, ouverte via shell.openExternal (jamais dans l'app). */
  keyPageUrl: string
  keyPlaceholder: string
  /** Variable d'environnement utilisée pour détecter une clé déjà présente sur l'appareil. */
  envVar: string
}

export const AI_PROVIDERS: AIProviderMeta[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    letter: "A",
    color: "#C15F3C",
    keyPageUrl: "https://console.anthropic.com/settings/keys",
    keyPlaceholder: "sk-ant-…",
    envVar: "ANTHROPIC_API_KEY",
  },
  {
    id: "openai",
    label: "OpenAI",
    letter: "O",
    color: "#1D1D1F",
    keyPageUrl: "https://platform.openai.com/api-keys",
    keyPlaceholder: "sk-…",
    envVar: "OPENAI_API_KEY",
  },
  {
    id: "gemini",
    label: "Gemini",
    letter: "G",
    color: "#1A73E8",
    keyPageUrl: "https://aistudio.google.com/apikey",
    keyPlaceholder: "AIza…",
    envVar: "GEMINI_API_KEY",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    letter: "D",
    color: "#4D6BFE",
    keyPageUrl: "https://platform.deepseek.com/api_keys",
    keyPlaceholder: "sk-…",
    envVar: "DEEPSEEK_API_KEY",
  },
  {
    id: "kimi",
    label: "Kimi",
    letter: "K",
    color: "#16191E",
    keyPageUrl: "https://platform.moonshot.ai/console/api-keys",
    keyPlaceholder: "sk-…",
    envVar: "MOONSHOT_API_KEY",
  },
  {
    id: "grok",
    label: "Grok",
    letter: "X",
    color: "#000000",
    keyPageUrl: "https://console.x.ai",
    keyPlaceholder: "xai-…",
    envVar: "XAI_API_KEY",
  },
]

export function getProviderMeta(id: AIProviderId): AIProviderMeta {
  const meta = AI_PROVIDERS.find((provider) => provider.id === id)
  if (!meta) throw new Error(`Fournisseur IA inconnu : "${id}".`)
  return meta
}

export interface AIConnectionStatus {
  connected: boolean
  provider?: AIProviderId
  /** Forme affichable façon `sk-ant-…4kQv`, jamais la clé en clair. */
  maskedKey?: string
  /** true si une clé a été détectée sur l'appareil pour ce fournisseur, mais pas encore confirmée/stockée par l'utilisateur. */
  detectedOnDevice?: boolean
}
