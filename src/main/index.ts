import { app, shell, BrowserWindow, ipcMain, systemPreferences } from "electron"
import { join } from "path"
import { electronApp, optimizer, is } from "@electron-toolkit/utils"
import { isEncryptionAvailable } from "./secrets"
import * as jira from "./integrations/jira"
import * as aiProvider from "./integrations/ai-provider"
import * as figma from "./integrations/figma"
import * as googleCalendar from "./integrations/google-calendar"
import { listConnectors } from "./connectors/registry"
import * as connectorSetup from "./connectors/setup-pages"
import { BrowserAutomationBridge } from "./browser-automation/bridge"
import { browserAutomationSocketPath } from "./browser-automation/socket-path"
import * as journal from "./journal"
import * as autonomy from "./autonomy"
import * as speech from "./speech"
import { AI_PROVIDERS } from "../shared/ai"
import type { AIProviderId } from "../shared/ai"
import { AUTONOMY_CATEGORY_IDS, AUTONOMY_MAX_LEVEL } from "../shared/autonomy"
import type { AutonomyCategoryId } from "../shared/autonomy"
import type { MeetingItemDraft, MeetingItemRemoval, MeetingItemType, MeetingExtraction } from "../shared/meeting"
import type { AssistantAnswer } from "../shared/assistant"
import type { JiraTicketSummary } from "../shared/jira"
import { GOOGLE_CALENDAR_SETUP_PAGES } from "../shared/googleCalendar"
import type { GoogleCalendarSetupPage } from "../shared/googleCalendar"
import { CONNECTOR_SETUP_PAGES } from "../shared/connectors"
import type { ConnectorSetupPage } from "../shared/connectors"

/** Validation stricte des payloads reçus par IPC avant de les transmettre aux intégrations. */
function assertNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Paramètre "${name}" invalide.`)
  }
  return value
}

/** Type seul : le format fin (trim, motif) est validé par l'intégration, avec un message métier. */
function assertString(value: unknown, name: string, maxLength = 1024): string {
  if (typeof value !== "string" || value.length > maxLength) {
    throw new Error(`Paramètre "${name}" invalide.`)
  }
  return value
}

function assertCalendarSetupPage(value: unknown): GoogleCalendarSetupPage {
  if (typeof value === "string" && GOOGLE_CALENDAR_SETUP_PAGES.includes(value as GoogleCalendarSetupPage)) {
    return value as GoogleCalendarSetupPage
  }
  throw new Error(`Paramètre "page" invalide.`)
}

function assertConnectorSetupPage(value: unknown): ConnectorSetupPage {
  if (typeof value === "string" && CONNECTOR_SETUP_PAGES.includes(value as ConnectorSetupPage)) {
    return value as ConnectorSetupPage
  }
  throw new Error(`Paramètre "page" invalide.`)
}

function assertProviderId(value: unknown): AIProviderId {
  if (typeof value === "string" && AI_PROVIDERS.some((provider) => provider.id === value)) {
    return value as AIProviderId
  }
  throw new Error(`Paramètre "provider" invalide.`)
}

function assertAutonomyCategoryId(value: unknown): AutonomyCategoryId {
  if (typeof value === "string" && AUTONOMY_CATEGORY_IDS.includes(value as AutonomyCategoryId)) {
    return value as AutonomyCategoryId
  }
  throw new Error(`Paramètre "id" invalide.`)
}

function assertLevel(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= AUTONOMY_MAX_LEVEL) {
    return value
  }
  throw new Error(`Paramètre "level" invalide.`)
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.on("ready-to-show", () => {
    mainWindow.show()
  })

  mainWindow.webContents.on("preload-error", (_event, preloadPath, error) => {
    console.error("[preload-error]", preloadPath, error)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: "deny" }
  })

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"])
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId("com.byko.app")

  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.handle("app:getVersion", () => app.getVersion())
  ipcMain.handle("secrets:isEncryptionAvailable", () => isEncryptionAvailable())

  ipcMain.handle("jira:openTokenPage", () => jira.openTokenPage())
  ipcMain.handle("jira:getStatus", () => jira.getStatus())
  ipcMain.handle("jira:disconnect", () => jira.disconnect())
  ipcMain.handle("jira:connect", (_event, domain: unknown, email: unknown, apiToken: unknown) =>
    jira.connect(
      assertNonEmptyString(domain, "domain"),
      assertNonEmptyString(email, "email"),
      assertNonEmptyString(apiToken, "apiToken"),
    ),
  )
  ipcMain.handle("jira:listProjects", () => jira.listProjects())
  ipcMain.handle("jira:countOpenIssues", () => jira.countOpenIssues())
  ipcMain.handle("jira:searchOpenIssues", () => jira.searchOpenIssues())
  ipcMain.handle("jira:setDefaultProject", (_event, projectKey: unknown) =>
    jira.setDefaultProject(assertNonEmptyString(projectKey, "projectKey")),
  )
  ipcMain.handle("jira:createIssue", (_event, summary: unknown) =>
    jira.createIssue(assertNonEmptyString(summary, "summary")),
  )
  ipcMain.handle("jira:updateIssueSummary", (_event, issueKey: unknown, summary: unknown) =>
    jira.updateIssueSummary(assertNonEmptyString(issueKey, "issueKey"), assertNonEmptyString(summary, "summary")),
  )
  ipcMain.handle("jira:deleteIssue", (_event, issueKey: unknown) =>
    jira.deleteIssue(assertNonEmptyString(issueKey, "issueKey")),
  )
  ipcMain.handle("jira:getTicket", (_event, issueKey: unknown) =>
    jira.getTicket(assertNonEmptyString(issueKey, "issueKey")),
  )
  ipcMain.handle("jira:postComment", (_event, issueKey: unknown, body: unknown) =>
    jira.postComment(assertNonEmptyString(issueKey, "issueKey"), assertNonEmptyString(body, "body")),
  )
  ipcMain.handle("jira:deleteComment", (_event, issueKey: unknown, commentId: unknown) =>
    jira.deleteComment(assertNonEmptyString(issueKey, "issueKey"), assertNonEmptyString(commentId, "commentId")),
  )

  ipcMain.handle("ai:getStatus", () => aiProvider.getStatus())
  ipcMain.handle("ai:openKeyPage", (_event, provider: unknown) => aiProvider.openKeyPage(assertProviderId(provider)))
  ipcMain.handle("ai:useDetectedKey", (_event, provider: unknown) =>
    aiProvider.useDetectedKey(assertProviderId(provider)),
  )
  ipcMain.handle("ai:setCustomKey", (_event, provider: unknown, key: unknown) =>
    aiProvider.setCustomKey(assertProviderId(provider), assertNonEmptyString(key, "key")),
  )
  ipcMain.handle("ai:disconnect", (_event, provider: unknown) => aiProvider.disconnect(assertProviderId(provider)))

  ipcMain.handle("figma:openTokenPage", () => figma.openTokenPage())
  ipcMain.handle("figma:getStatus", () => figma.getStatus())
  ipcMain.handle("figma:disconnect", () => figma.disconnect())
  ipcMain.handle("figma:connect", (_event, token: unknown) => figma.connect(assertNonEmptyString(token, "token")))

  ipcMain.handle("calendar:connect", () => googleCalendar.connect())
  ipcMain.handle("calendar:getStatus", () => googleCalendar.getStatus())
  ipcMain.handle("calendar:disconnect", () => googleCalendar.disconnect())
  ipcMain.handle("calendar:listTodayEvents", () => googleCalendar.listTodayEvents())
  ipcMain.handle("calendar:getCredentialsStatus", () => googleCalendar.getCredentialsStatus())
  ipcMain.handle("calendar:openSetupPage", (_event, page: unknown) =>
    googleCalendar.openSetupPage(assertCalendarSetupPage(page)),
  )
  ipcMain.handle("calendar:connectWithCredentials", (_event, clientId: unknown, clientSecret: unknown) =>
    googleCalendar.connectWithCredentials(assertString(clientId, "clientId"), assertString(clientSecret, "clientSecret")),
  )
  ipcMain.handle("calendar:cancelConnect", () => googleCalendar.cancelConnect())

  ipcMain.handle("settings:listConnectors", () => listConnectors())
  ipcMain.handle("connectors:openSetupPage", (_event, page: unknown) =>
    connectorSetup.openSetupPage(assertConnectorSetupPage(page)),
  )

  ipcMain.handle("journal:listToday", () => journal.listToday())
  ipcMain.handle("journal:cancel", async (_event, id: unknown) => {
    const entryId = assertNonEmptyString(id, "id")
    const entry = await journal.getEntry(entryId)
    if (!entry) {
      throw new Error("Entrée de journal introuvable.")
    }
    if (!entry.undo) {
      throw new Error("Cette action n'est plus annulable.")
    }
    if (entry.undo.type === "jira-comment") {
      await jira.deleteComment(entry.undo.issueKey, entry.undo.commentId)
    }
    await journal.removeEntry(entryId)
  })

  ipcMain.handle("autonomy:list", () => autonomy.list())
  ipcMain.handle("autonomy:setLevel", (_event, id: unknown, level: unknown) =>
    autonomy.setLevel(assertAutonomyCategoryId(id), assertLevel(level)),
  )

  ipcMain.handle("meeting:requestMicAccess", async () => {
    if (process.platform !== "darwin") return true
    if (systemPreferences.getMediaAccessStatus("microphone") === "granted") return true
    return systemPreferences.askForMediaAccess("microphone")
  })

  ipcMain.handle("speech:prepare", () => speech.prepare())
  ipcMain.handle("speech:transcribe", (_event, audio: unknown) => {
    if (!(audio instanceof Float32Array) || audio.length === 0) {
      throw new Error(`Paramètre "audio" invalide.`)
    }
    if (audio.length > speech.SAMPLE_RATE * speech.MAX_AUDIO_SECONDS) {
      throw new Error(`Enregistrement trop long (${speech.MAX_AUDIO_SECONDS} s maximum).`)
    }
    return speech.transcribe(audio)
  })

  ipcMain.handle("meeting:summarize", async (_event, transcript: unknown) => {
    const text = assertNonEmptyString(transcript, "transcript")
    const prompt = [
      "Voici la transcription d'un point d'équipe (réunion courte).",
      "Rédige un compte rendu court en français, 3 à 5 puces maximum,",
      "des sujets et décisions abordés. Pas d'introduction, juste les puces.",
      "",
      "Transcription :",
      text,
    ].join("\n")
    return aiProvider.complete(prompt)
  })

  ipcMain.handle("meeting:sendReport", async () => {
    await journal.addEntry("Compte rendu du point d'équipe envoyé à l'équipe", "auto")
  })

  ipcMain.handle(
    "meeting:extractItems",
    async (
      _event,
      transcript: unknown,
      existingDecisions: unknown,
      existingTasks: unknown,
      rejectedTexts: unknown,
    ): Promise<MeetingExtraction> => {
      const text = assertNonEmptyString(transcript, "transcript")
      const decisions = Array.isArray(existingDecisions)
        ? existingDecisions.filter((item): item is string => typeof item === "string")
        : []
      const tasks = Array.isArray(existingTasks)
        ? existingTasks.filter((item): item is string => typeof item === "string")
        : []
      const rejected = Array.isArray(rejectedTexts)
        ? rejectedTexts.filter((item): item is string => typeof item === "string")
        : []
      const numbered = (items: string[], prefix: string): string =>
        items.length ? items.map((item, index) => `${prefix}${index + 1}. ${item}`).join("\n") : "aucune"

      const prompt = [
        "Voici la transcription d'un point d'équipe, telle qu'entendue jusqu'à présent :",
        '"""',
        text,
        '"""',
        "",
        "Décisions déjà notées :",
        numbered(decisions, "D"),
        "",
        "Tâches déjà notées :",
        numbered(tasks, "T"),
        "",
        rejected.length
          ? `Éléments déjà explicitement annulés plus tôt — ne les repropose JAMAIS, même reformulés : ${rejected.join(" / ")}`
          : "",
        "",
        "Distingue bien les deux catégories :",
        "- decision : un choix ou un accord acté par l'équipe, sans action concrète à réaliser par",
        "  quelqu'un (ex. « on garde le format actuel », « on reporte la mise en prod à vendredi »,",
        "  « on annule cette fonctionnalité »).",
        "- task : une action concrète à réaliser, même sans nom de personne ni échéance précisés",
        "  (ex. « il faut corriger X », « rendre le champ Y obligatoire », « ajouter un bouton Z »,",
        "  « quelqu'un doit mettre à jour… »). Toute phrase qui décrit CE QU'IL FAUT FAIRE est une task,",
        "  pas une decision — même formulée à l'impératif ou sans sujet explicite.",
        "",
        "Identifie deux choses, en te basant STRICTEMENT sur ce qui est exprimé dans la transcription,",
        "sans jamais rien inventer :",
        "1. Les décisions ou tâches nouvelles et clairement exprimées, absentes des listes ci-dessus ET",
        "   absentes des éléments déjà annulés.",
        "2. Parmi les décisions/tâches déjà notées ci-dessus (pas les éléments déjà annulés), celles que",
        "   la suite de la transcription annule, contredit ou invalide explicitement (ex. « en fait non »,",
        "   « on revient sur… », « on annule… »). Réfère-toi à elles par leur numéro exact (D1, T2…).",
        "",
        "Réponds STRICTEMENT en JSON, sans texte autour, exactement sous cette forme :",
        '{"additions": [{"type": "decision", "text": "..."}], "removals": [{"type": "decision", "index": 1}]}',
        "Les deux tableaux peuvent être vides.",
      ].join("\n")
      const raw = await aiProvider.complete(prompt)
      const match = raw.match(/\{[\s\S]*\}/)
      if (!match) return { additions: [], removals: [] }
      let parsed: unknown
      try {
        parsed = JSON.parse(match[0])
      } catch {
        return { additions: [], removals: [] }
      }
      if (typeof parsed !== "object" || parsed === null) return { additions: [], removals: [] }
      const body = parsed as Record<string, unknown>

      const additions = (Array.isArray(body.additions) ? body.additions : []).filter(
        (item): item is MeetingItemDraft => {
          if (typeof item !== "object" || item === null) return false
          const candidate = item as Record<string, unknown>
          return (
            (candidate.type === "decision" || candidate.type === "task") &&
            typeof candidate.text === "string" &&
            candidate.text.trim() !== ""
          )
        },
      )

      const removals: MeetingItemRemoval[] = (Array.isArray(body.removals) ? body.removals : [])
        .filter((item): item is { type: MeetingItemType; index: number } => {
          if (typeof item !== "object" || item === null) return false
          const candidate = item as Record<string, unknown>
          if (candidate.type !== "decision" && candidate.type !== "task") return false
          if (typeof candidate.index !== "number") return false
          const list = candidate.type === "decision" ? decisions : tasks
          return candidate.index >= 1 && candidate.index <= list.length
        })
        // L'IA référence D1/T1 (1-based) ; `MeetingItemRemoval.index` est documenté 0-based pour matcher directement les tableaux côté renderer.
        .map((item) => ({ type: item.type, index: item.index - 1 }))

      return { additions, removals }
    },
  )

  ipcMain.handle("assistant:ask", async (_event, question: unknown): Promise<AssistantAnswer> => {
    const text = assertNonEmptyString(question, "question")

    let tickets: JiraTicketSummary[] = []
    let ticketsBlock = "Aucun ticket Jira disponible (Jira non connecté ou requête impossible)."
    try {
      tickets = await jira.searchOpenIssues()
      ticketsBlock =
        tickets.length > 0
          ? tickets.map((ticket) => `- ${ticket.key} [${ticket.status}] ${ticket.summary}`).join("\n")
          : "Aucun ticket ouvert actuellement dans les projets connectés."
    } catch (err) {
      // Jira non connecté ou requête échouée : BCC répond sans ce contexte plutôt que de bloquer.
      console.error("[assistant:ask] searchOpenIssues a échoué :", err)
    }

    const prompt = [
      "Tu es BCC, un assistant qui aide un développeur à gérer ses tickets Jira,",
      "ses intégrations et sa journée de travail. Réponds brièvement et",
      "clairement en français à la question ou demande suivante. Base-toi",
      "uniquement sur les tickets listés ci-dessous, ne les invente jamais ;",
      "si la liste est vide ou absente, dis-le clairement plutôt que d'improviser.",
      "Quand ta réponse fait référence à un ticket précis de cette liste, insère sa",
      "clé entre crochets juste à cet endroit — mais SANS JAMAIS écrire la clé en",
      "clair dans ta phrase, seulement entre crochets : par exemple « il faut",
      "prioriser ce ticket [SCRUM-3] avant vendredi », jamais « le ticket SCRUM-3",
      "[SCRUM-3] ». La clé sera affichée séparément sous forme de carte, ne la",
      "répète donc jamais toi-même dans le texte. N'insère jamais de crochets",
      "pour un ticket qui n'est pas dans la liste.",
      "N'énumère et ne détaille JAMAIS le contenu des tickets référencés dans ton",
      "texte (pas de titre, pas de statut, pas de liste à puces) : chaque ticket",
      "cité [CLE] apparaîtra déjà sous forme de carte avec tout son détail.",
      "Si la question demande simplement de lister/afficher des tickets, réponds",
      "par une phrase d'accompagnement très courte (« Voici vos tickets ouverts",
      "[CLE1] [CLE2]… ») sans rien ajouter d'autre : les cartes suffisent.",
      "",
      "Tickets Jira actuels de l'utilisateur :",
      ticketsBlock,
      "",
      "Question :",
      text,
    ].join("\n")
    const rawAnswer = await aiProvider.complete(prompt)

    const citedKeys = new Set<string>()
    for (const match of rawAnswer.matchAll(/\[([A-Z][A-Z0-9]*-\d+)\]/g)) citedKeys.add(match[1])
    const relevantTickets = tickets.filter((ticket) => citedKeys.has(ticket.key))
    let cleanText = rawAnswer.replace(/\s*\[[A-Z][A-Z0-9]*-\d+\]/g, "")
    // Filet de sécurité si le modèle a quand même épelé la clé en clair malgré la consigne (elle serait sinon en double avec sa carte).
    for (const key of citedKeys) cleanText = cleanText.replace(new RegExp(`\\b${key}\\b\\s*`, "g"), "")
    cleanText = cleanText.replace(/[ \t]{2,}/g, " ").trim()

    return { text: cleanText, tickets: relevantTickets }
  })

  // Phase ② du chantier d'automatisation navigateur : le pont seul, sans
  // recette. Il ne sert qu'à savoir si l'extension est joignable et à mesurer
  // un aller-retour (docs/ipc/browser-automation.md §9).
  const browserAutomation = new BrowserAutomationBridge(browserAutomationSocketPath(), {
    info: (message) => console.log(`[browser-automation] ${message}`),
    warn: (message) => console.warn(`[browser-automation] ${message}`),
  })
  browserAutomation.start()
  app.on("before-quit", () => browserAutomation.stop())

  createWindow()

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit()
  }
})
