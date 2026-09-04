/**
 * ARCHI-2b — Table des liens providers, moitié FRONT.
 *
 * Table `provider → { label, tokenUrl }` pour les 6 providers de la liste fermée. Sert
 * UNIQUEMENT à générer le lien dynamique « Créer jeton [Nom] » sous le champ jeton du bloc
 * Modèle IA (règle produit ligne 13 et FRONT-2 ligne 223 de
 * `docs/tickets/phase-1-configuration.md` : libellé ET URL dynamiques selon le provider
 * sélectionné).
 *
 * ISOLATION vis-à-vis du back — critère d'acceptation ligne 73 : « Modifier
 * `providers-links.ts` (ex. changer le texte d'un lien) ne touche à aucun fichier utilisé
 * par le test de connexion. » Ce fichier n'importe donc QUE le type `ProviderId`. Il
 * n'importe pas `lib/providers-api.ts` (table de dispatch du back, BACK-3) et ne doit
 * jamais le faire : ce sont deux tables volontairement disjointes, pas une seule table
 * découpée en deux. Rien ici n'est consommé par `app/api/`.
 *
 * Aucune valeur d'exécution importée, aucune dépendance npm (contrainte ARCHI-1 ligne 30),
 * aucune directive `"use client"` : ce module est une donnée statique sérialisable, donc
 * lisible aussi bien depuis un composant serveur que depuis un composant client.
 */

import type { ProviderId } from "@/lib/types/settings";

/**
 * `label` : le nom affiché dans « Créer jeton [Nom] ». Repris mot pour mot de
 * l'énumération de la règle produit ligne 12 (« Anthropic, OpenAI, DeepSeek, Kimi, Grok,
 * Gemini ») — c'est la liste fermée qui fait foi pour l'UI, pas la raison sociale de
 * l'éditeur (d'où « Kimi » et non « Moonshot AI », « Grok » et non « xAI »).
 *
 * `tokenUrl` : page de création/gestion de clé API du provider. Valeurs VÉRIFIÉES par
 * requête réelle et/ou relevées dans la documentation publique de l'éditeur le
 * 31/08/2026 — voir le relevé par provider ci-dessous. Aucune n'est écrite de mémoire.
 */
export interface ProviderLink {
  label: string;
  tokenUrl: string;
}

/**
 * `Record<ProviderId, ProviderLink>` — clé exhaustive imposée par le critère d'acceptation
 * ligne 74 : ajouter un 7ᵉ provider à `ProviderId` (`lib/types/settings.ts`) sans l'ajouter
 * ici fait échouer la compilation (TS2741, propriété manquante). Vérifié par sonde le
 * 31/08/2026. Ne pas remplacer par un `Partial`, un index signature ou un `as` : chacun
 * de ces trois désactiverait précisément le contrôle que ce ticket demande.
 *
 * ------------------------------------------------------------------------------------
 * RELEVÉ DE VÉRIFICATION DES URL — 31/08/2026
 *
 * Méthode : `curl -s -o /dev/null -w "%{http_code}" -L --max-time 15 <url>` (avec
 * User-Agent navigateur), DOUBLÉ d'une requête de contrôle sur un chemin volontairement
 * inexistant du même hôte. Le contrôle n'est pas une précaution de style : sur 4 des 6
 * hôtes, le code HTTP de l'URL réelle est IDENTIQUE à celui du chemin bidon (403 ou 202 de
 * pare-feu anti-bot, ou 200 de redirection vers une page de connexion). Sur ces hôtes, un
 * « 200 » ou un « 403 » ne prouve donc RIEN quant à l'existence du chemin, et l'URL est
 * établie à la place par la documentation publique de l'éditeur, qui la publie elle-même.
 *
 *  provider   | HTTP | contrôle chemin bidon | ce qui établit l'URL
 *  -----------|------|-----------------------|-----------------------------------------
 *  anthropic  | 200  | 404 → hôte discriminant | la requête elle-même
 *  openai     | 403  | 403 → non discriminant  | README officiel openai/openai-python
 *  deepseek   | 202  | 202 → non discriminant  | api-docs.deepseek.com (HTTP 200)
 *  kimi       | 200  | 404 → hôte discriminant | la requête + docs officielles
 *  grok       | 403  | 403 → non discriminant  | docs.x.ai/docs/tutorial (HTTP 200)
 *  gemini     | 200  | 200 → non discriminant  | ai.google.dev/gemini-api/docs/api-key
 *
 * Aucune URL n'a renvoyé 404 ni 410. Détail et pièges par provider dans les commentaires
 * de chaque entrée. À revérifier si un lien « Créer jeton » remonte comme cassé : ces
 * consoles changent d'adresse (deux des six ci-dessous ont déjà migré de domaine).
 * ------------------------------------------------------------------------------------
 */
export const PROVIDER_LINKS: Record<ProviderId, ProviderLink> = {
  /**
   * HTTP 200 (chemin bidon du même hôte : 404 → l'hôte distingue réellement ses routes,
   * le 200 vaut donc preuve d'existence).
   *
   * L'adresse historique `https://console.anthropic.com/settings/keys` répond elle aussi
   * 200, mais par REDIRECTION vers l'URL ci-dessous : c'est la cible de la redirection
   * qui est retenue, pour ne pas dépendre d'un domaine en cours de retrait.
   */
  anthropic: {
    label: "Anthropic",
    tokenUrl: "https://platform.claude.com/settings/keys",
  },

  /**
   * HTTP 403 sur l'URL comme sur un chemin inexistant : l'hôte bloque tout client non
   * navigateur, le code ne dit rien de l'existence du chemin. URL relevée dans le README
   * du SDK officiel `openai/openai-python` (raw.githubusercontent.com, HTTP 200), au
   * texte exact « [Get an API key here](…/settings/organization/api-keys) ».
   *
   * PIÈGE : l'adresse courte `https://platform.openai.com/api-keys`, très répandue, n'est
   * PAS celle que la documentation de l'éditeur publie aujourd'hui. Ne pas la « corriger »
   * en la raccourcissant sans nouvelle vérification.
   */
  openai: {
    label: "OpenAI",
    tokenUrl: "https://platform.openai.com/settings/organization/api-keys",
  },

  /**
   * HTTP 202 sur l'URL comme sur un chemin inexistant (réponse de challenge anti-bot) :
   * non discriminant. URL relevée dans la documentation officielle `api-docs.deepseek.com`
   * (HTTP 200), lien porté par le texte « apply for an API key ».
   */
  deepseek: {
    label: "DeepSeek",
    tokenUrl: "https://platform.deepseek.com/api_keys",
  },

  /**
   * HTTP 200 (chemin bidon : 404 → hôte discriminant), ET lien présent 5 fois dans la
   * documentation officielle (`platform.moonshot.ai/docs`, HTTP 200).
   *
   * PIÈGE, tranché le 31/08/2026 : DEUX hôtes répondent 200 avec un 404 discriminant sur
   * la même route. `platform.kimi.com` est la plateforme chinoise (`<html lang="zh-CN">`,
   * 444 caractères chinois dans la page) ; `platform.kimi.ai` est la plateforme
   * internationale (`<html lang="en-US">`, aucun caractère chinois) et c'est celle vers
   * laquelle pointent les docs. C'est donc `.ai` qui est retenu. Les anciennes adresses
   * `platform.moonshot.ai` et `platform.moonshot.cn` redirigent respectivement vers ces
   * deux hôtes ; ne pas les confondre, `.cn` mène à la plateforme chinoise.
   */
  kimi: {
    label: "Kimi",
    tokenUrl: "https://platform.kimi.ai/console/api-keys",
  },

  /**
   * HTTP 403 sur l'URL, sur un chemin inexistant ET sur la racine de l'hôte : tout
   * `console.x.ai` est fermé aux clients non navigateurs, le code est non discriminant.
   * URL relevée dans le tutoriel officiel `docs.x.ai/docs/tutorial` (HTTP 200), sous le
   * titre « Step 2: Generate an API key » (« Create an API key via the … »).
   *
   * Les paramètres `utm_*` que la documentation accole à ce lien sont du suivi de
   * campagne propre aux docs et sont volontairement omis.
   */
  grok: {
    label: "Grok",
    tokenUrl: "https://console.x.ai/team/default/api-keys",
  },

  /**
   * HTTP 200, mais un chemin inexistant du même hôte répond 200 lui aussi : toute URL
   * d'AI Studio redirige vers la page de connexion Google avant que le chemin ne soit
   * évalué. Code non discriminant. URL relevée dans la documentation officielle
   * `ai.google.dev/gemini-api/docs/api-key` (HTTP 200), où elle porte le bouton principal
   * « Create or view a Gemini API Key » et le bouton d'en-tête « Get API key ».
   *
   * PIÈGE : la même page cite aussi `https://aistudio.google.com/api-keys` (avec tiret),
   * mais pour CONSULTER et migrer des clés existantes. Le lien du wizard étant « Créer
   * jeton », c'est la forme sans tiret, portée par le bouton de création, qui est retenue.
   * La variante `/app/apikey` n'apparaît nulle part dans la documentation actuelle.
   */
  gemini: {
    label: "Gemini",
    tokenUrl: "https://aistudio.google.com/apikey",
  },
};

/**
 * Accès unitaire pour le rendu du lien (FRONT-2 ligne 223). `ProviderId` étant une union
 * fermée et la table un `Record` exhaustif, le retour n'est jamais `undefined` : pas de
 * cas « provider inconnu » à traiter côté composant.
 */
export function getProviderLink(provider: ProviderId): ProviderLink {
  return PROVIDER_LINKS[provider];
}

/**
 * Libellé complet du lien, pour que le gabarit « Créer jeton [Nom] » (règle produit
 * ligne 13) soit écrit à un seul endroit et ne diverge pas entre le wizard (FRONT-2) et
 * l'écran Paramètres (FRONT-6), qui réutilise les mêmes blocs.
 */
export function getCreateTokenLabel(provider: ProviderId): string {
  return `Créer jeton ${PROVIDER_LINKS[provider].label}`;
}
