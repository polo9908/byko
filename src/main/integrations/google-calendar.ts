import { shell } from "electron"
import { createServer } from "http"
import { randomBytes, createHash } from "crypto"
import { deleteSecret, getSecret, isEncryptionAvailable, setSecret, setSecrets } from "../secrets"
import type {
  GoogleCalendarConnectionStatus,
  CalendarEventSummary,
  GoogleCalendarCredentialsSource,
  GoogleCalendarCredentialsStatus,
  GoogleCalendarSetupPage,
} from "../../shared/googleCalendar"

/**
 * Intégration Google Agenda (tickets E4 / E4bis). BYKO étant open source,
 * aucun client OAuth n'est embarqué : chaque utilisateur crée son propre
 * client « Application de bureau » et le colle dans l'assistant (contrat :
 * `docs/ipc/google-calendar-credentials.md`). Les identifiants sont lus au
 * runtime depuis `secrets.ts` ; `.env` n'est qu'un repli de développement.
 * Le retour du navigateur est capté par un petit serveur HTTP local éphémère
 * (boucle locale, PKCE) — jamais de jeton à copier-coller.
 */

const SECRET_KEY = "google.calendar.tokens"
const CLIENT_SECRET_KEY = "google.calendar.client"
const SCOPE = "https://www.googleapis.com/auth/calendar.readonly"
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke"
const AUTHORIZATION_TIMEOUT_MS = 120_000
// Par requête (réponse + corps), pendant un flux de connexion : sans borne, un
// réseau captif garderait le verrou « connexion en cours » indéfiniment.
const FLOW_REQUEST_TIMEOUT_MS = 15_000

const SETUP_PAGE_URLS: Record<GoogleCalendarSetupPage, string> = {
  createProject: "https://console.cloud.google.com/projectcreate",
  enableApi: "https://console.cloud.google.com/apis/library/calendar-json.googleapis.com",
  consentScreen: "https://console.cloud.google.com/auth/overview",
  testUsers: "https://console.cloud.google.com/auth/audience",
  createClient: "https://console.cloud.google.com/auth/clients/create",
}

const NOT_CONFIGURED_MESSAGE = "Identifiants Google non configurés."
const ALREADY_PENDING_MESSAGE = "Une connexion Google est déjà en cours."
const CANCELLED_MESSAGE = "Connexion Google annulée."
const NETWORK_MESSAGE = "Impossible de joindre Google. Vérifiez votre connexion Internet puis réessayez."
const TIMEOUT_MESSAGE =
  "Google ne répond pas (délai de 15 s dépassé). Vérifiez votre connexion Internet ou votre proxy puis réessayez."
const UNREADABLE_RESPONSE_MESSAGE = "Réponse de Google illisible. Réessayez dans quelques instants."
const CLIENT_NOT_FOUND_MESSAGE =
  "Client ID introuvable chez Google. Vérifiez que vous avez copié l'ID client complet du client OAuth « Application de bureau »."
const WRONG_SECRET_MESSAGE =
  "Client Secret incorrect pour ce Client ID. Recopiez le code secret du client depuis Google Cloud Console."
const INVALID_CLIENT_MESSAGE = "Identifiants Google refusés (client OAuth invalide). Vérifiez le Client ID et le Client Secret."
const ACCESS_DENIED_MESSAGE =
  "Accès refusé par Google. Si l'application est en mode « Test », ajoutez votre adresse Google dans « Utilisateurs test » (écran de consentement) puis réessayez."

const CLIENT_ID_PATTERN = /^[A-Za-z0-9-]+\.apps\.googleusercontent\.com$/
const CLIENT_SECRET_MAX_LENGTH = 256

interface StoredTokens {
  refreshToken: string
  accessToken: string
  accessTokenExpiresAt: number
  email: string
}

interface ClientCredentials {
  clientId: string
  clientSecret: string
}

interface ResolvedCredentials {
  credentials: ClientCredentials
  source: GoogleCalendarCredentialsSource
}

interface TokenResponse {
  access_token: string
  expires_in: number
  refresh_token?: string
}

interface TokenErrorBody {
  error?: string
  error_description?: string
}

function base64url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

async function readTokens(): Promise<StoredTokens | undefined> {
  const raw = await getSecret(SECRET_KEY)
  return raw ? (JSON.parse(raw) as StoredTokens) : undefined
}

async function readUserCredentials(): Promise<ClientCredentials | undefined> {
  const raw = await getSecret(CLIENT_SECRET_KEY)
  if (raw === undefined) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error("Identifiants Google enregistrés illisibles. Reconfigurez-les dans Réglages.")
  }
  const candidate = parsed as Partial<ClientCredentials> | null
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    typeof candidate.clientId !== "string" ||
    typeof candidate.clientSecret !== "string"
  ) {
    throw new Error("Identifiants Google enregistrés illisibles. Reconfigurez-les dans Réglages.")
  }
  return { clientId: candidate.clientId, clientSecret: candidate.clientSecret }
}

/**
 * Repli `.env` réservé au mode dev. Les références à `import.meta.env.MAIN_VITE_*`
 * restent dans un bloc gardé par `import.meta.env.DEV`, remplacé par `false` au
 * build de production : Rollup élimine alors le bloc, et le secret avec.
 */
function readDevEnvCredentials(): ClientCredentials | undefined {
  if (import.meta.env.DEV) {
    const clientId = import.meta.env.MAIN_VITE_GOOGLE_CLIENT_ID
    const clientSecret = import.meta.env.MAIN_VITE_GOOGLE_CLIENT_SECRET
    if (clientId && clientSecret) {
      return { clientId, clientSecret }
    }
  }
  return undefined
}

async function resolveCredentials(): Promise<ResolvedCredentials | undefined> {
  const user = await readUserCredentials()
  if (user) return { credentials: user, source: "user" }
  const dev = readDevEnvCredentials()
  if (dev) return { credentials: dev, source: "dev-env" }
  return undefined
}

async function requireCredentials(): Promise<ClientCredentials> {
  const resolved = await resolveCredentials()
  if (!resolved) throw new Error(NOT_CONFIGURED_MESSAGE)
  return resolved.credentials
}

/** Normalise et valide le format, sans rien envoyer à Google. */
function validateCredentials(rawClientId: string, rawClientSecret: string): ClientCredentials {
  const clientId = rawClientId.trim()
  const clientSecret = rawClientSecret.trim()
  if (!CLIENT_ID_PATTERN.test(clientId)) {
    throw new Error(
      "Client ID invalide : il doit se terminer par « .apps.googleusercontent.com » (lettres, chiffres et tirets avant).",
    )
  }
  if (clientSecret === "") {
    throw new Error("Client Secret manquant.")
  }
  if (/\s/.test(clientSecret)) {
    throw new Error("Client Secret invalide : il ne doit pas contenir d'espace.")
  }
  if (clientSecret.length > CLIENT_SECRET_MAX_LENGTH) {
    throw new Error(`Client Secret invalide : ${CLIENT_SECRET_MAX_LENGTH} caractères maximum.`)
  }
  return { clientId, clientSecret }
}

/** Réponse Google dont la lecture du corps traduit elle aussi annulation, délai et JSON invalide. */
interface GoogleResponse {
  ok: boolean
  status: number
  /** Rejette avec un message FR (annulation, délai, corps illisible). */
  json(): Promise<unknown>
  /** Comme `json`, mais un corps illisible donne `undefined` ; annulation et délai rejettent toujours. */
  jsonOrUndefined(): Promise<unknown>
}

/**
 * `fetch` vers Google : distingue annulation, délai dépassé et panne réseau, sans jamais recopier
 * l'erreur brute (URL, corps). Avec `signal` (flux de connexion), la requête et la lecture de son
 * corps sont bornées à `FLOW_REQUEST_TIMEOUT_MS`.
 */
async function googleFetch(input: string | URL, init: RequestInit, signal?: AbortSignal): Promise<GoogleResponse> {
  const timeout = signal ? AbortSignal.timeout(FLOW_REQUEST_TIMEOUT_MS) : undefined
  const requestSignal = signal && timeout ? AbortSignal.any([signal, timeout]) : undefined
  // L'annulation prime : un utilisateur qui annule ne doit pas lire « Google ne répond pas ».
  const abortMessage = (): string | undefined => {
    if (signal?.aborted) return CANCELLED_MESSAGE
    if (timeout?.aborted) return TIMEOUT_MESSAGE
    return undefined
  }

  let response: Response
  try {
    response = await fetch(input, { ...init, signal: requestSignal })
  } catch {
    throw new Error(abortMessage() ?? NETWORK_MESSAGE)
  }

  const readBody = async (onUnreadable: () => unknown): Promise<unknown> => {
    try {
      return (await response.json()) as unknown
    } catch {
      const message = abortMessage()
      if (message) throw new Error(message)
      return onUnreadable()
    }
  }

  return {
    ok: response.ok,
    status: response.status,
    json: () =>
      readBody(() => {
        throw new Error(UNREADABLE_RESPONSE_MESSAGE)
      }),
    jsonOrUndefined: () => readBody(() => undefined),
  }
}

async function postToken(params: Record<string, string>, signal?: AbortSignal): Promise<GoogleResponse> {
  return googleFetch(
    TOKEN_ENDPOINT,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params).toString(),
    },
    signal,
  )
}

async function readTokenError(response: GoogleResponse): Promise<TokenErrorBody> {
  const body = await response.jsonOrUndefined()
  if (typeof body !== "object" || body === null) return {}
  const record = body as Record<string, unknown>
  return {
    error: typeof record.error === "string" ? record.error : undefined,
    error_description: typeof record.error_description === "string" ? record.error_description : undefined,
  }
}

/** Codes d'erreur OAuth (RFC 6749) : jetons ASCII courts, sans donnée utilisateur. */
function safeErrorCode(code: string | undefined): string | undefined {
  return code && /^[a-z_]{1,64}$/.test(code) ? code : undefined
}

/**
 * Google distingue les deux cas uniquement par `error_description` (vérifié le
 * 26/09/2026 : « The OAuth client was not found. » / « The provided client
 * secret is invalid. »). Si le libellé change, on retombe sur le message générique.
 */
function invalidClientMessage(description: string | undefined): string {
  const text = (description ?? "").toLowerCase()
  if (text.includes("client was not found")) return CLIENT_NOT_FOUND_MESSAGE
  if (text.includes("client secret is invalid")) return WRONG_SECRET_MESSAGE
  return INVALID_CLIENT_MESSAGE
}

async function tokenRequest(
  params: Record<string, string>,
  context: "exchange" | "refresh",
  signal?: AbortSignal,
): Promise<TokenResponse> {
  const response = await postToken(params, signal)
  if (!response.ok) {
    const { error, error_description } = await readTokenError(response)
    if (error === "invalid_client") {
      throw new Error(
        context === "refresh"
          ? "Identifiants Google refusés (client supprimé ou secret modifié). Reconfigurez-les dans Réglages."
          : invalidClientMessage(error_description),
      )
    }
    if (error === "invalid_grant" && context === "refresh") {
      throw new Error("Accès Google Agenda expiré ou révoqué. Reconnectez Google Agenda dans Réglages.")
    }
    const code = safeErrorCode(error)
    throw new Error(`Requête de jeton Google refusée (${response.status}${code ? `, ${code}` : ""}).`)
  }
  return (await response.json()) as TokenResponse
}

/**
 * Vérifie les identifiants sans navigateur : un code factice est forcément
 * refusé, mais Google contrôle d'abord le client. `invalid_grant` signifie
 * donc « client et secret valides ».
 */
async function precheckCredentials(credentials: ClientCredentials, signal: AbortSignal): Promise<void> {
  const response = await postToken(
    {
      code: "byko-precheck-invalid-code",
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      redirect_uri: "http://127.0.0.1:1/callback",
      grant_type: "authorization_code",
      code_verifier: "a".repeat(43),
    },
    signal,
  )
  if (response.ok) return
  const { error, error_description } = await readTokenError(response)
  if (error === "invalid_grant") return
  if (error === "invalid_client") throw new Error(invalidClientMessage(error_description))
  const code = safeErrorCode(error)
  throw new Error(`Vérification des identifiants Google impossible (${response.status}${code ? `, ${code}` : ""}).`)
}

/**
 * Ouvre le consentement Google dans le navigateur système et attend le
 * retour sur `http://127.0.0.1:<port aléatoire>/callback`, capté par un
 * serveur HTTP local créé pour l'occasion et fermé dès la réponse reçue,
 * au délai dépassé ou à l'annulation.
 */
function waitForAuthorizationCode(
  googleClientId: string,
  codeChallenge: string,
  state: string,
  signal: AbortSignal,
): Promise<{ code: string; redirectUri: string }> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error(CANCELLED_MESSAGE))
      return
    }

    let redirectUri = ""
    let settled = false

    const finish = (run: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timeoutHandle)
      signal.removeEventListener("abort", onAbort)
      server.close()
      server.closeIdleConnections()
      run()
    }

    const onAbort = (): void => finish(() => reject(new Error(CANCELLED_MESSAGE)))

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1")
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      res.end("<!doctype html><html><body><p>Vous pouvez fermer cet onglet et revenir à BYKO.</p></body></html>")
      if (url.pathname !== "/callback") return
      const error = url.searchParams.get("error")
      const code = url.searchParams.get("code")
      const returnedState = url.searchParams.get("state")
      if (error) {
        const message =
          error === "access_denied"
            ? ACCESS_DENIED_MESSAGE
            : `Autorisation Google refusée (${safeErrorCode(error) ?? "erreur inconnue"}).`
        finish(() => reject(new Error(message)))
      } else if (!code || returnedState !== state) {
        finish(() => reject(new Error("Réponse Google invalide (état ou code manquant).")))
      } else {
        finish(() => resolve({ code, redirectUri }))
      }
    })

    server.on("error", (err) => finish(() => reject(err)))
    server.listen(0, "127.0.0.1", () => {
      if (settled) return
      const address = server.address()
      const port = typeof address === "object" && address ? address.port : 0
      redirectUri = `http://127.0.0.1:${port}/callback`
      const authUrl = new URL(AUTH_ENDPOINT)
      authUrl.searchParams.set("client_id", googleClientId)
      authUrl.searchParams.set("redirect_uri", redirectUri)
      authUrl.searchParams.set("response_type", "code")
      authUrl.searchParams.set("scope", SCOPE)
      authUrl.searchParams.set("access_type", "offline")
      authUrl.searchParams.set("prompt", "consent")
      authUrl.searchParams.set("code_challenge", codeChallenge)
      authUrl.searchParams.set("code_challenge_method", "S256")
      authUrl.searchParams.set("state", state)
      void shell.openExternal(authUrl.toString())
    })

    signal.addEventListener("abort", onAbort, { once: true })

    const timeoutHandle = setTimeout(() => {
      finish(() => reject(new Error("Délai dépassé en attendant l'autorisation Google (2 min).")))
    }, AUTHORIZATION_TIMEOUT_MS)
  })
}

/** Flux boucle locale + PKCE commun à `connect` et `connectWithCredentials`. N'écrit rien sur disque. */
async function runAuthorizationFlow(credentials: ClientCredentials, signal: AbortSignal): Promise<StoredTokens> {
  const codeVerifier = base64url(randomBytes(32))
  const codeChallenge = base64url(createHash("sha256").update(codeVerifier).digest())
  const state = base64url(randomBytes(16))

  const { code, redirectUri } = await waitForAuthorizationCode(credentials.clientId, codeChallenge, state, signal)

  const tokenBody = await tokenRequest(
    {
      code,
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code_verifier: codeVerifier,
    },
    "exchange",
    signal,
  )
  if (!tokenBody.refresh_token) {
    throw new Error(
      "Google n'a pas renvoyé de jeton de renouvellement. Révoquez l'accès BYKO existant depuis myaccount.google.com/permissions puis reconnectez.",
    )
  }

  const calendarResponse = await googleFetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary",
    { headers: { Authorization: `Bearer ${tokenBody.access_token}` } },
    signal,
  )
  if (!calendarResponse.ok) {
    throw new Error(`Impossible de lire l'agenda principal (${calendarResponse.status}).`)
  }
  const calendar = (await calendarResponse.json()) as { id: string }

  // Dernier point d'annulation : au-delà, l'appelant persiste.
  if (signal.aborted) throw new Error(CANCELLED_MESSAGE)

  return {
    refreshToken: tokenBody.refresh_token,
    accessToken: tokenBody.access_token,
    accessTokenExpiresAt: Date.now() + tokenBody.expires_in * 1000,
    email: calendar.id,
  }
}

let pendingConnection: AbortController | null = null

/** Verrou « une seule connexion en attente » ; la prise du verrou est synchrone pour éviter toute course. */
async function withPendingConnection<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  if (pendingConnection) throw new Error(ALREADY_PENDING_MESSAGE)
  const controller = new AbortController()
  pendingConnection = controller
  try {
    return await run(controller.signal)
  } finally {
    if (pendingConnection === controller) pendingConnection = null
  }
}

export function connect(): Promise<GoogleCalendarConnectionStatus> {
  return withPendingConnection(async (signal) => {
    const credentials = await requireCredentials()
    const tokens = await runAuthorizationFlow(credentials, signal)
    await setSecret(SECRET_KEY, JSON.stringify(tokens))
    return { connected: true, email: tokens.email }
  })
}

export async function connectWithCredentials(
  rawClientId: string,
  rawClientSecret: string,
): Promise<GoogleCalendarConnectionStatus> {
  // Avant le verrou : un appel mal formé reçoit son vrai message, même si une connexion est en cours.
  const credentials = validateCredentials(rawClientId, rawClientSecret)
  return withPendingConnection(async (signal) => {
    if (!isEncryptionAvailable()) {
      throw new Error("Chiffrement indisponible sur cet appareil : impossible d'enregistrer les identifiants Google.")
    }
    await precheckCredentials(credentials, signal)
    const tokens = await runAuthorizationFlow(credentials, signal)
    // Une seule écriture : identifiants et jetons liés au même client, ou rien.
    await setSecrets({
      [CLIENT_SECRET_KEY]: JSON.stringify(credentials),
      [SECRET_KEY]: JSON.stringify(tokens),
    })
    return { connected: true, email: tokens.email }
  })
}

export function cancelConnect(): void {
  pendingConnection?.abort()
}

export async function getCredentialsStatus(): Promise<GoogleCalendarCredentialsStatus> {
  const resolved = await resolveCredentials()
  return resolved ? { configured: true, source: resolved.source } : { configured: false, source: null }
}

export async function openSetupPage(page: GoogleCalendarSetupPage): Promise<void> {
  await shell.openExternal(SETUP_PAGE_URLS[page])
}

export async function getStatus(): Promise<GoogleCalendarConnectionStatus> {
  const tokens = await readTokens()
  return tokens ? { connected: true, email: tokens.email } : { connected: false }
}

export async function disconnect(): Promise<void> {
  const tokens = await readTokens()
  if (tokens) {
    await fetch(`${REVOKE_ENDPOINT}?token=${encodeURIComponent(tokens.refreshToken)}`, { method: "POST" }).catch(
      () => undefined,
    )
  }
  await deleteSecret(SECRET_KEY)
}

async function getValidAccessToken(): Promise<string> {
  const tokens = await readTokens()
  if (!tokens) {
    throw new Error("Google Agenda n'est pas connecté.")
  }
  if (Date.now() < tokens.accessTokenExpiresAt - 60_000) {
    return tokens.accessToken
  }
  const credentials = await requireCredentials()
  const body = await tokenRequest(
    {
      refresh_token: tokens.refreshToken,
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      grant_type: "refresh_token",
    },
    "refresh",
  )
  const updated: StoredTokens = {
    ...tokens,
    accessToken: body.access_token,
    accessTokenExpiresAt: Date.now() + body.expires_in * 1000,
  }
  await setSecret(SECRET_KEY, JSON.stringify(updated))
  return updated.accessToken
}

export async function listTodayEvents(): Promise<CalendarEventSummary[]> {
  const accessToken = await getValidAccessToken()
  const now = new Date()
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000)

  const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events")
  url.searchParams.set("timeMin", startOfDay.toISOString())
  url.searchParams.set("timeMax", endOfDay.toISOString())
  url.searchParams.set("singleEvents", "true")
  url.searchParams.set("orderBy", "startTime")

  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!response.ok) {
    throw new Error(`Impossible de lire les événements du jour (${response.status}).`)
  }
  const body = (await response.json()) as {
    items: Array<{
      id: string
      summary?: string
      start: { date?: string; dateTime?: string }
      end: { date?: string; dateTime?: string }
    }>
  }
  return body.items.map((event) => ({
    id: event.id,
    title: event.summary ?? "(Sans titre)",
    start: event.start.dateTime ?? event.start.date ?? "",
    end: event.end.dateTime ?? event.end.date ?? "",
    allDay: !event.start.dateTime,
  }))
}
