import { useEffect, useLayoutEffect, useRef, useState } from "react"
import WelcomeStep from "./screens/onboarding/WelcomeStep"
import ConnectJiraStep from "./screens/onboarding/ConnectJiraStep"
import ChooseAiStep from "./screens/onboarding/ChooseAiStep"
import ConnectFigmaStep from "./screens/onboarding/ConnectFigmaStep"
import ConnectCalendarStep from "./screens/onboarding/ConnectCalendarStep"
import SummaryStep from "./screens/onboarding/SummaryStep"
import ReadyStep from "./screens/onboarding/ReadyStep"
import ProfileMenu from "./screens/profile/ProfileMenu"
import AccountsScreen from "./screens/onboarding/AccountsScreen"
import SettingsModal from "./screens/settings/SettingsModal"
import type { SettingsSectionId } from "./screens/settings/SettingsModal"
import JournalView from "./screens/journal/JournalView"
import MemoryView from "./screens/memory/MemoryView"
import FeedbackButton from "./screens/feedback/FeedbackButton"
import DayView from "./screens/dayview/DayView"
import { pickPointMeeting } from "./lib/pointMeeting"
import PointDEquipeView from "./screens/dayview/PointDEquipeView"
import SpeechModelPill from "./screens/dayview/SpeechModelPill"
import { playSetupSound, playSfx } from "./lib/sound"
import { enter } from "./lib/motion"
import { setAccountScope } from "./lib/accountScope"
import { loadAccessibilityPrefs } from "./lib/accessibility"
import { NOTIFICATION_BODY_MAX } from "@shared/notifications"
import type { CalendarEventSummary } from "@shared/googleCalendar"
import type { ProfileRole } from "@shared/profile"

type Stage = "loading" | "accounts" | "email" | "jira" | "ai" | "figma" | "calendar" | "summary" | "ready" | "day" | "journal" | "memory" | "pointdequipe"

function App(): React.JSX.Element {
  // « loading » : le temps de lire le profil local, pour ne pas afficher l'accueil une fraction de seconde avant la vue journée.
  const [stage, setStage] = useState<Stage>("loading")
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<ProfileRole | undefined>(undefined)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>("connectors")
  const stageRef = useRef<Stage>(stage)
  stageRef.current = stage
  const [memoryProposals, setMemoryProposals] = useState(0)
  const [calendarEvents, setCalendarEvents] = useState<CalendarEventSummary[] | null>(null)
  // Une réunion ne doit basculer vers l'écran d'enregistrement qu'une fois : sans ce suivi, revenir
  // manuellement à la vue journée (bouton Retour) pendant qu'elle est encore en cours y renverrait aussitôt.
  // Invitation visée par l'écran d'enregistrement (clic sur une carte de la frise) ; sinon on la déduit de l'agenda.
  const [pointTarget, setPointTarget] = useState<{ eventId?: string; autoStart: boolean }>({ autoStart: false })
  const autoOpenedMeetingIds = useRef<Set<string>>(new Set())
  const screenRef = useRef<HTMLDivElement>(null)

  // Chaque changement d'écran arrive en ressort ; le Journal monte d'un peu plus bas, comme une feuille.
  useLayoutEffect(() => {
    const el = screenRef.current?.firstElementChild
    if (el instanceof HTMLElement) enter(el, 0, stage === "journal" || stage === "memory" ? 30 : 14)
  }, [stage])

  // Sound design du prototype (voir `lib/sound.ts`). `step` sonne à chaque étape franchie de
  // l'assistant — avant ET arrière, comme le `go()` de `Setup.dc.html` — et sur rien d'autre.
  function goTo(next: Stage): void {
    playSetupSound("step")
    setStage(next)
  }

  // Côté application, le prototype sonne `listen` à l'ouverture du Journal et `tick` à celle des Réglages.
  function openJournal(): void {
    playSfx("listen")
    setStage("journal")
  }

  function openMemory(): void {
    playSfx("listen")
    setStage("memory")
  }

  function openSettings(): void {
    playSfx("tick")
    setSettingsOpen(true)
  }

  // Connexion auto : si la première configuration a déjà été faite, on ouvre directement la vue journée.
  // Les jetons (Jira, IA, Figma, Google) sont déjà conservés chiffrés ; l'e-mail revient pré-rempli.
  useEffect(() => {
    window.api.profile
      .get()
      .then((profile) => {
        // Avant tout affichage : mémos et comptes rendus sont lus avec la clé du compte actif.
        setAccountScope(profile.accountId, profile.ownsLegacyData)
        if (profile.email) setEmail(profile.email)
        setRole(profile.role)
        setStage((current) =>
          current === "loading" ? (!profile.signedIn ? "accounts" : profile.onboarded ? "day" : "email") : current,
        )
      })
      .catch(() => setStage((current) => (current === "loading" ? "email" : current)))
  }, [])

  // À chaque retour sur la vue journée : combien de décisions de réunion attendent d'être consignées (pastille « Mémoire »).
  useEffect(() => {
    if (stage !== "day") return
    window.api.memory
      .get()
      .then((memory) => setMemoryProposals(memory.proposals.length))
      .catch((err: unknown) => console.warn("Lecture de la mémoire d'équipe impossible :", err))
  }, [stage])

  // Clic sur une notification (voir docs/ipc/notifications.md) : on ouvre la page liée, sauf pendant l'assistant de démarrage.
  useEffect(() => {
    return window.api.notifications.onOpen((target) => {
      if (["loading", "accounts", "email", "jira", "ai", "figma", "calendar", "summary", "ready"].includes(stageRef.current)) return
      if (target === "journal" || target === "pointdequipe" || target === "day") {
        setPointTarget({ autoStart: false })
        setSettingsOpen(false)
        setStage(target)
        return
      }
      setStage("day")
      setSettingsSection(target === "settings-accessibility" ? "accessibility" : "connectors")
      setSettingsOpen(true)
    })
  }, [])

  // Liaison des tickets (docs/ipc/ticket-links.md) : ce que la synchronisation vient de faire est annoncé par une
  // notification quand BYKO n'est pas au premier plan ; un clic ouvre le Journal, où tout est listé et annulable.
  useEffect(() => {
    return window.api.links.onUpdated((events) => {
      if (events.length === 0 || !["day", "journal", "memory", "pointdequipe"].includes(stageRef.current)) return
      const prefs = loadAccessibilityPrefs()
      const more = events.length > 1 ? ` (+ ${events.length - 1})` : ""
      window.api.notifications
        .show({
          title: "Tickets de réunion mis à jour",
          body: `${events[0].text.slice(0, NOTIFICATION_BODY_MAX - 12)}${more}`,
          target: "journal",
          durationSeconds: prefs.notificationSeconds,
          highContrast: prefs.highContrast,
          reduceMotion: prefs.reduceMotion,
        })
        .catch((err: unknown) => console.warn("Notification impossible :", err))
    })
  }, [])

  useEffect(() => {
    function refreshCalendar(): void {
      // Pas de compte connecté (choix du compte, démarrage) : rien à interroger.
      if (stageRef.current === "loading" || stageRef.current === "accounts") return
      window.api.calendar
        .listTodayEvents()
        .then(setCalendarEvents)
        // Un échec passager (réseau, jeton) ne vide pas la frise : on garde les derniers événements connus.
        .catch((err: unknown) => console.warn("Lecture de l'agenda impossible :", err))
    }
    refreshCalendar()
    const timer = setInterval(refreshCalendar, 30_000)
    // Au retour dans BYKO (typiquement après avoir ajouté un événement dans Google Agenda), on relit tout de suite.
    window.addEventListener("focus", refreshCalendar)
    return () => {
      clearInterval(timer)
      window.removeEventListener("focus", refreshCalendar)
    }
  }, [])

  useEffect(() => {
    if (stage !== "day" || settingsOpen || !calendarEvents) return
    const now = new Date()
    const activeMeeting = calendarEvents.find(
      (event) => !event.allDay && new Date(event.start) <= now && now <= new Date(event.end),
    )
    if (activeMeeting && !autoOpenedMeetingIds.current.has(activeMeeting.id)) {
      autoOpenedMeetingIds.current.add(activeMeeting.id)
      setPointTarget({ eventId: activeMeeting.id, autoStart: false })
      setStage("pointdequipe")
    }
  }, [calendarEvents, stage, settingsOpen])

  let screen: React.JSX.Element
  if (stage === "loading") {
    screen = <></>
  } else if (stage === "accounts") {
    screen = <AccountsScreen />
  } else if (stage === "email") {
    screen = (
      <WelcomeStep
        initialEmail={email}
        initialRole={role}
        onContinue={(value, chosenRole) => {
          setEmail(value)
          setRole(chosenRole)
          // Mémorisé localement : plus à le ressaisir. Un échec n'empêche pas de continuer.
          // L'un après l'autre : deux écritures simultanées du magasin chiffré s'écraseraient.
          window.api.profile
            .saveEmail(value)
            .then(() => window.api.profile.saveRole(chosenRole))
            .catch((err: unknown) => console.warn("Profil non mémorisé :", err))
          goTo("jira")
        }}
      />
    )
  } else if (stage === "jira") {
    screen = <ConnectJiraStep email={email} onBack={() => goTo("email")} onContinue={() => goTo("ai")} />
  } else if (stage === "ai") {
    screen = <ChooseAiStep onBack={() => goTo("jira")} onContinue={() => goTo("figma")} />
  } else if (stage === "figma") {
    screen = (
      <ConnectFigmaStep
        onBack={() => goTo("ai")}
        onContinue={() => goTo("calendar")}
        onSkip={() => goTo("calendar")}
      />
    )
  } else if (stage === "calendar") {
    screen = (
      <ConnectCalendarStep
        onBack={() => goTo("figma")}
        onContinue={() => goTo("summary")}
        onSkip={() => goTo("summary")}
      />
    )
  } else if (stage === "summary") {
    screen = <SummaryStep onBack={() => goTo("calendar")} onFinish={() => goTo("ready")} />
  } else if (stage === "ready") {
    // Le prototype ne sonne plus rien sur « Commencer ma journée » : le `done` de l'écran de
    // lancement a déjà retenti (voir ReadyStep).
    screen = (
      <ReadyStep
        onStart={() => {
          window.api.profile.completeOnboarding().catch((err: unknown) => console.warn("Fin de configuration non mémorisée :", err))
          setStage("day")
        }}
      />
    )
  } else if (stage === "journal") {
    screen = <JournalView onBack={() => setStage("day")} />
  } else if (stage === "memory") {
    screen = <MemoryView onBack={() => setStage("day")} />
  } else if (stage === "pointdequipe") {
    screen = (
      <PointDEquipeView
        onBack={() => {
          setPointTarget({ autoStart: false })
          setStage("day")
        }}
        meeting={calendarEvents?.find((event) => event.id === pointTarget.eventId) ?? pickPointMeeting(calendarEvents)}
        autoStart={pointTarget.autoStart}
      />
    )
  } else {
    screen = (
      <>
        <DayView
          calendarEvents={calendarEvents}
          onOpenJournal={openJournal}
          onOpenMemory={openMemory}
          memoryProposals={memoryProposals}
          onOpenSettings={openSettings}
          onOpenPointDEquipe={(options) => {
            setPointTarget({ eventId: options?.eventId, autoStart: options?.autoStart ?? false })
            setStage("pointdequipe")
          }}
          blocked={settingsOpen}
        />
      </>
    )
  }

  // DayView a son propre bouton Journal, intégré dans son en-tête. Point d'équipe n'a pas
  // d'en-tête : ce bouton flottant lui sert de seul accès permanent au Journal.
  const showJournalButton = stage === "pointdequipe"
  const showProfile = stage === "pointdequipe" || stage === "journal" || stage === "memory"

  return (
    <>
      {/* `display: contents` : ce conteneur ne sert qu'à retrouver l'écran courant, il ne change pas la mise en page. */}
      <div ref={screenRef} style={{ display: "contents" }}>
        {screen}
      </div>
      {/* Réglages : accessibles depuis le menu de profil, donc depuis toutes les vues qui l'affichent. */}
      {settingsOpen && <SettingsModal initialSection={settingsSection} onClose={() => setSettingsOpen(false)} />}
      {(stage === "day" || stage === "pointdequipe") && <SpeechModelPill />}
      {/* Retour utilisateur : présent sur tous les écrans, assistant de démarrage compris. */}
      {stage !== "loading" && <FeedbackButton />}
      {showProfile && (
        <div className="global-topbar">
          {showJournalButton && (
            <button type="button" className="global-journal-button" onClick={openJournal}>
              Journal
            </button>
          )}
          <ProfileMenu onOpenSettings={openSettings} />
        </div>
      )}
    </>
  )
}

export default App
