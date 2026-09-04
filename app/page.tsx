"use client";

import {
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  applyOutbox, DRAFT_KEY, enqueueMutation, flushOutbox,
  OUTBOX_PREFIX, readOutbox, SyncError, type ThoughtMutation,
} from "@/lib/thought-outbox";

type ThoughtStatus = "active" | "done";

type Thought = {
  id: string;
  text: string;
  status: ThoughtStatus;
  createdAt: string;
  lastPresentedAt: string | null;
  completedAt: string | null;
};

type StoredThoughts = {
  version: 1;
  thoughts: Thought[];
};

type View = "review" | "all" | "done" | "stats";
type AuthState =
  | "checking"
  | "authenticated"
  | "anonymous"
  | "misconfigured"
  | "error";

type AddedFeedback = {
  id: string;
  text: string;
};

type QueueHistoryPoint = {
  date: Date;
  count: number;
};

const STORAGE_KEY = "and-1-more-thing:v1";
const MIGRATION_KEY = "and-1-more-thing:sqlite-migrated:v1";
const QUEUE_SIZE = 5;
const STATISTICS_DAYS = 30;
const EXAMPLE_ROTATION_MS = 4200;
const THOUGHT_EXAMPLES = [
  "np. Sprawdzić, czy OC jest opłacone",
  "np. Kupić chleb po pracy",
  "np. Umówić wizytę u dentysty",
  "np. Oddać książkę Ani",
  "np. Wybrać prezent na urodziny taty",
];

const relativeTimeFormatter = new Intl.RelativeTimeFormat("pl-PL", {
  numeric: "always",
});
const chartAxisDateFormatter = new Intl.DateTimeFormat("pl-PL", {
  day: "numeric",
  month: "short",
});
const chartTooltipDateFormatter = new Intl.DateTimeFormat("pl-PL", {
  day: "numeric",
  month: "long",
});

function isThought(value: unknown): value is Thought {
  if (!value || typeof value !== "object") return false;
  const thought = value as Partial<Thought>;

  return (
    typeof thought.id === "string" &&
    typeof thought.text === "string" &&
    (thought.status === "active" || thought.status === "done") &&
    typeof thought.createdAt === "string" &&
    (thought.lastPresentedAt === null ||
      typeof thought.lastPresentedAt === "string") &&
    (thought.completedAt === null || typeof thought.completedAt === "string")
  );
}

function readStoredThoughts(): Thought[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return [];

    const store = parsed as Partial<StoredThoughts>;
    if (store.version !== 1 || !Array.isArray(store.thoughts)) return [];

    return store.thoughts.filter(isThought);
  } catch {
    return [];
  }
}

function makeId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `thought-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatRelativeTime(value: string, currentTime: number) {
  const elapsedSeconds = Math.max(
    0,
    Math.floor((currentTime - new Date(value).getTime()) / 1000),
  );

  if (elapsedSeconds < 60) return "przed chwilą";

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) {
    return relativeTimeFormatter.format(-elapsedMinutes, "minute");
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) {
    return relativeTimeFormatter.format(-elapsedHours, "hour");
  }

  const elapsedDays = Math.floor(elapsedHours / 24);
  return relativeTimeFormatter.format(-elapsedDays, "day");
}

function thoughtSortValue(thought: Thought) {
  return new Date(thought.lastPresentedAt ?? thought.createdAt).getTime();
}

function buildQueueHistory(
  thoughts: Thought[],
  currentTime: number,
): QueueHistoryPoint[] {
  const today = new Date(currentTime);
  today.setHours(0, 0, 0, 0);

  return Array.from({ length: STATISTICS_DAYS }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (STATISTICS_DAYS - index - 1));

    const nextDate = new Date(date);
    nextDate.setDate(date.getDate() + 1);
    const dayEnd = nextDate.getTime();

    const count = thoughts.filter((thought) => {
      const createdAt = new Date(thought.createdAt).getTime();
      const completedAt = thought.completedAt
        ? new Date(thought.completedAt).getTime()
        : null;

      return (
        Number.isFinite(createdAt) &&
        createdAt < dayEnd &&
        (completedAt === null || completedAt >= dayEnd)
      );
    }).length;

    return { date, count };
  });
}

async function readJson<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T;
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }
  return body;
}

export default function Home() {
  const [thoughts, setThoughts] = useState<Thought[]>([]);
  const [view, setView] = useState<View>("review");
  const [draft, setDraft] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [offline, setOffline] = useState(false);
  const [undoThought, setUndoThought] = useState<Thought | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Thought | null>(null);
  const [addedFeedback, setAddedFeedback] = useState<AddedFeedback | null>(null);
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const [exampleIndex, setExampleIndex] = useState(0);
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [migrationNotice, setMigrationNotice] = useState<number | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const addedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const synchronization = useRef<Promise<void> | null>(null);
  const authenticated = useRef(false);
  const revision = useRef(0);
  const refreshSequence = useRef(0);

  const refreshThoughts = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    const startingRevision = revision.current;
    const response = await fetch("/api/thoughts", {
      cache: "no-store", signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 401) {
      authenticated.current = false;
      setAuthState("anonymous");
      throw new Error("Unauthorized");
    }

    const body = await readJson<{ thoughts: unknown[] }>(response);
    if (!authenticated.current || sequence !== refreshSequence.current || startingRevision !== revision.current) return;
    const pending = readOutbox(window.localStorage);
    setThoughts(applyOutbox(body.thoughts.filter(isThought), pending));
    setPendingCount(pending.length);
    setCurrentTime(Date.now());
  }, []);

  const synchronizePending = useCallback(() => {
    if (synchronization.current) return synchronization.current;
    if (!authenticated.current) return Promise.resolve();
    const run = async () => {
      setSyncing(true);
      try {
        const drain = async () => {
          do {
            await flushOutbox(window.localStorage, fetch, () => {
              revision.current++;
              setPendingCount(readOutbox(window.localStorage).length);
            }, () => authenticated.current);
            if (authenticated.current) await refreshThoughts();
          } while (authenticated.current && readOutbox(window.localStorage).length > 0);
        };
        // Only one tab sends this device's queue at a time.
        if (navigator.locks) await navigator.locks.request("and1-sync", drain);
        else await drain();
        setSaveError(false);
      } catch (error) {
        setSaveError(true);
        if (error instanceof SyncError && error.status === 401) {
          authenticated.current = false;
          setAuthState("anonymous");
        }
      } finally {
        setSyncing(false);
        synchronization.current = null;
      }
    };
    synchronization.current = run();
    return synchronization.current;
  }, [refreshThoughts]);

  const loadSynchronizedThoughts = useCallback(async () => {
    const migrationDone = window.localStorage.getItem(MIGRATION_KEY) === "1";
    const storedThoughts = migrationDone ? [] : readStoredThoughts();

    if (storedThoughts.length > 0) {
      const response = await fetch("/api/thoughts/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thoughts: storedThoughts }),
      });
      const body = await readJson<{ imported: number }>(response);
      setMigrationNotice(body.imported);
    }

    window.localStorage.setItem(MIGRATION_KEY, "1");
    await refreshThoughts();
    setHydrated(true);
    void synchronizePending();
  }, [refreshThoughts, synchronizePending]);

  useEffect(() => {
    let active = true;

    async function initialize() {
      try {
        setDraft(window.localStorage.getItem(DRAFT_KEY) ?? "");
        setPendingCount(readOutbox(window.localStorage).length);
      } catch {
        setStorageError(true);
      }
      try {
        const response = await fetch("/api/auth/session", {
          cache: "no-store",
        });
        const session = await readJson<{
          authenticated: boolean;
          configured: boolean;
        }>(response);
        if (!active) return;

        if (!session.configured) {
          setAuthState("misconfigured");
          return;
        }
        if (!session.authenticated) {
          setAuthState("anonymous");
          return;
        }

        authenticated.current = true;
        setAuthState("authenticated");
        await loadSynchronizedThoughts();
      } catch {
        if (active) setAuthState("error");
      }
    }

    void initialize();
    return () => {
      active = false;
    };
  }, [loadSynchronizedThoughts]);

  useEffect(() => {
    if (authState !== "authenticated" || !hydrated) return;

    const updateConnection = () => {
      setOffline(!navigator.onLine);
      if (navigator.onLine) void synchronizePending();
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        updateConnection();
      }
    };
    const updateFromOtherTab = (event: StorageEvent) => {
      if (event.key?.startsWith(OUTBOX_PREFIX)) {
        try {
          const pending = readOutbox(window.localStorage);
          revision.current++;
          setPendingCount(pending.length);
          setThoughts((current) => applyOutbox(current, pending));
          void synchronizePending();
        } catch { setStorageError(true); }
      }
    };

    updateConnection();
    const retryTimer = window.setInterval(refreshWhenVisible, 15_000);
    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);
    window.addEventListener("storage", updateFromOtherTab);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(retryTimer);
      window.removeEventListener("online", updateConnection);
      window.removeEventListener("offline", updateConnection);
      window.removeEventListener("storage", updateFromOtherTab);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [authState, hydrated, synchronizePending]);

  useEffect(() => {
    const quickCapture = (event: KeyboardEvent) => {
      if (authState !== "authenticated" || deleteTarget) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setMobileMenuOpen(false);
        inputRef.current?.focus();
        inputRef.current?.scrollIntoView({ block: "center", behavior: "instant" });
      }
    };
    window.addEventListener("keydown", quickCapture);
    return () => window.removeEventListener("keydown", quickCapture);
  }, [authState, deleteTarget]);

  useEffect(() => {
    return () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
      if (addedTimer.current) clearTimeout(addedTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!mobileMenuOpen) return;

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !mobileMenuRef.current?.contains(event.target)
      ) {
        setMobileMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMobileMenuOpen(false);
      mobileMenuButtonRef.current?.focus();
    };

    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [mobileMenuOpen]);

  useEffect(() => {
    const relativeTimeInterval = window.setInterval(
      () => setCurrentTime(Date.now()),
      60_000,
    );

    return () => window.clearInterval(relativeTimeInterval);
  }, []);

  useEffect(() => {
    if (draft.length > 0) return;

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    );
    if (reducedMotion.matches) return;

    const exampleTimer = window.setInterval(() => {
      setExampleIndex((current) => (current + 1) % THOUGHT_EXAMPLES.length);
    }, EXAMPLE_ROTATION_MS);

    return () => window.clearInterval(exampleTimer);
  }, [draft]);

  const activeThoughts = useMemo(
    () => thoughts.filter((thought) => thought.status === "active"),
    [thoughts],
  );

  const queue = useMemo(
    () =>
      [...activeThoughts]
        .sort((a, b) => thoughtSortValue(a) - thoughtSortValue(b))
        .slice(0, QUEUE_SIZE),
    [activeThoughts],
  );

  const allActive = useMemo(
    () =>
      [...activeThoughts].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [activeThoughts],
  );

  const completedThoughts = useMemo(
    () =>
      thoughts
        .filter((thought) => thought.status === "done")
        .sort(
          (a, b) =>
            new Date(b.completedAt ?? 0).getTime() -
            new Date(a.completedAt ?? 0).getTime(),
        ),
    [thoughts],
  );

  function saveMutation(mutation: Omit<ThoughtMutation, "id" | "order">) {
    try {
      const entry = enqueueMutation(window.localStorage, mutation);
      revision.current++;
      setThoughts((current) => applyOutbox(current, [entry]));
      setPendingCount(readOutbox(window.localStorage).length);
      setStorageError(false);
      void synchronizePending();
      return true;
    } catch {
      setStorageError(true);
      return false;
    }
  }

  function updateDraft(text: string) {
    setDraft(text);
    try {
      if (text) window.localStorage.setItem(DRAFT_KEY, text);
      else window.localStorage.removeItem(DRAFT_KEY);
      setStorageError(false);
    } catch { setStorageError(true); }
  }

  async function submitLogin(event: FormEvent) {
    event.preventDefault();
    if (!loginPassword) return;

    setLoginBusy(true);
    setLoginError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: loginPassword }),
      });

      if (response.status === 429) {
        setLoginError("Za dużo prób. Spróbuj ponownie za kilkanaście minut.");
        return;
      }
      if (!response.ok) {
        setLoginError("To nie jest właściwe hasło.");
        return;
      }

      setLoginPassword("");
      setHydrated(false);
      authenticated.current = true;
      setAuthState("authenticated");
      await loadSynchronizedThoughts();
    } catch {
      setAuthState("error");
      setLoginError("Nie udało się połączyć z aplikacją.");
    } finally {
      setLoginBusy(false);
    }
  }

  async function logout() {
    authenticated.current = false;
    refreshSequence.current++;
    setMobileMenuOpen(false);
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    setThoughts([]);
    setHydrated(false);
    setAuthState("anonymous");
  }

  function submitThought(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text) {
      inputRef.current?.focus();
      return;
    }

    const now = new Date().toISOString();
    const thought: Thought = {
      id: makeId(),
      text,
      status: "active",
      createdAt: now,
      lastPresentedAt: null,
      completedAt: null,
    };

    if (!saveMutation({ method: "POST", thought })) return;
    updateDraft("");
    setCurrentTime(new Date(now).getTime());
    setAddedFeedback({ id: thought.id, text: thought.text });
    if (addedTimer.current) clearTimeout(addedTimer.current);
    addedTimer.current = setTimeout(() => setAddedFeedback(null), 2800);
    inputRef.current?.focus();
  }

  function completeThought(id: string) {
    const thought = thoughts.find((item) => item.id === id);
    if (!thought) return;

    const completedAt = new Date().toISOString();
    if (!saveMutation({ method: "PATCH", thought, changes: { status: "done", completedAt } })) return;

    setUndoThought(thought);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndoThought(null), 6000);
  }

  function deferThought(id: string) {
    const thought = thoughts.find((item) => item.id === id);
    if (!thought) return;
    const deferredAt = new Date().toISOString();
    saveMutation({ method: "PATCH", thought, changes: { lastPresentedAt: deferredAt } });
  }

  function restoreThought(id: string) {
    const thought = thoughts.find((item) => item.id === id);
    if (!thought) return false;
    return saveMutation({ method: "PATCH", thought, changes: {
      status: "active", completedAt: null, lastPresentedAt: null,
    } });
  }

  function undoCompletion() {
    if (!undoThought) return;
    if (!restoreThought(undoThought.id)) return;
    setUndoThought(null);
    if (undoTimer.current) clearTimeout(undoTimer.current);
  }

  function beginEditing(thought: Thought) {
    setEditingId(thought.id);
    setEditingText(thought.text);
  }

  function cancelEditing() {
    setEditingId(null);
    setEditingText("");
  }

  function saveEdit(event: FormEvent, id: string) {
    event.preventDefault();
    const text = editingText.trim();
    if (!text) return;

    const existingThought = thoughts.find((thought) => thought.id === id);
    if (existingThought?.text === text) {
      cancelEditing();
      return;
    }

    if (!existingThought || !saveMutation({ method: "PATCH", thought: existingThought, changes: { text } })) return;
    cancelEditing();
  }

  function renderThoughtEditor(thought: Thought) {
    return (
      <form
        className="edit-form"
        onSubmit={(event) => saveEdit(event, thought.id)}
      >
        <label htmlFor={`edit-${thought.id}`}>Edytuj treść zadania</label>
        <input
          id={`edit-${thought.id}`}
          value={editingText}
          onChange={(event) => setEditingText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") cancelEditing();
          }}
          maxLength={280}
          autoFocus
        />
        <div className="edit-actions">
          <button
            type="submit"
            className="small-primary"
            disabled={!editingText.trim()}
          >
            Zapisz
          </button>
          <button type="button" className="text-button" onClick={cancelEditing}>
            Anuluj
          </button>
        </div>
      </form>
    );
  }

  function deleteThought() {
    if (!deleteTarget) return;
    if (!saveMutation({ method: "DELETE", thought: deleteTarget })) return;
    setDeleteTarget(null);
  }

  if (authState === "checking") {
    return <AccessScreen mode="loading" />;
  }

  if (authState === "misconfigured") {
    return <AccessScreen mode="misconfigured" />;
  }

  if (authState === "error") {
    return <AccessScreen mode="error" />;
  }

  if (authState === "anonymous") {
    return (
      <LoginScreen
        password={loginPassword}
        error={loginError}
        busy={loginBusy}
        onPasswordChange={setLoginPassword}
        onSubmit={submitLogin}
      />
    );
  }

  return (
    <div className="app-shell">
      <header className="sidebar">
        <button
          className="brand"
          type="button"
          onClick={() => {
            setView("review");
            setMobileMenuOpen(false);
          }}
          aria-label="1 more thing — strona główna"
        >
          <span className="brand-mark" aria-hidden="true">
            +1
          </span>
          <span className="brand-copy">1 more thing</span>
        </button>

        <nav className="desktop-nav" aria-label="Główna nawigacja">
          <NavButton
            active={view === "review"}
            label="Kolejka"
            symbol="○"
            onClick={() => setView("review")}
          />
          <NavButton
            active={view === "all"}
            label="Wszystkie"
            symbol="≡"
            onClick={() => setView("all")}
          />
          <NavButton
            active={view === "done"}
            label="Załatwione"
            symbol="✓"
            onClick={() => setView("done")}
          />
          <NavButton
            active={view === "stats"}
            label="Statystyki"
            symbol="↗"
            onClick={() => setView("stats")}
          />
        </nav>
        <button
          className="quick-add-button"
          type="button"
          aria-label="Dodaj myśl"
          aria-keyshortcuts="Meta+k Control+k"
          title="Dodaj myśl (⌘K / Ctrl+K)"
          onClick={() => {
            setMobileMenuOpen(false);
            inputRef.current?.focus();
            inputRef.current?.scrollIntoView({ block: "center", behavior: "instant" });
          }}
        >
          +
        </button>
        <button className="logout-button" type="button" onClick={logout}>
          Wyloguj
        </button>

        <div className="mobile-menu" ref={mobileMenuRef}>
          <button
            ref={mobileMenuButtonRef}
            className={`menu-toggle${mobileMenuOpen ? " open" : ""}`}
            type="button"
            aria-label={mobileMenuOpen ? "Zamknij menu" : "Otwórz menu"}
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-menu-panel"
            onClick={() => setMobileMenuOpen((open) => !open)}
          >
            <span aria-hidden="true" />
            <span aria-hidden="true" />
            <span aria-hidden="true" />
          </button>

          {mobileMenuOpen && (
            <div className="mobile-menu-panel" id="mobile-menu-panel">
              <nav aria-label="Główna nawigacja mobilna">
                <NavButton
                  active={view === "review"}
                  label="Przejrzyj"
                  symbol="○"
                  onClick={() => {
                    setView("review");
                    setMobileMenuOpen(false);
                  }}
                />
                <NavButton
                  active={view === "all"}
                  label="Wszystkie"
                  symbol="≡"
                  onClick={() => {
                    setView("all");
                    setMobileMenuOpen(false);
                  }}
                />
                <NavButton
                  active={view === "done"}
                  label="Załatwione"
                  symbol="✓"
                  onClick={() => {
                    setView("done");
                    setMobileMenuOpen(false);
                  }}
                />
                <NavButton
                  active={view === "stats"}
                  label="Statystyki"
                  symbol="↗"
                  onClick={() => {
                    setView("stats");
                    setMobileMenuOpen(false);
                  }}
                />
              </nav>
              <button
                className="mobile-logout-button"
                type="button"
                onClick={logout}
              >
                Wyloguj
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="main-content">
        {storageError && (
          <div className="save-alert" role="alert">
            Nie udało się zapisać danych na tym urządzeniu. Zachowaj wpisaną treść
            i sprawdź dostępne miejsce oraz ustawienia pamięci przeglądarki.
          </div>
        )}

        {migrationNotice !== null && (
          <div className="migration-alert" role="status">
            {migrationNotice > 0
              ? `Przeniesiono ${migrationNotice} zapisanych wcześniej myśli.`
              : "Twoje wcześniejsze myśli są już zsynchronizowane."}
            <button type="button" onClick={() => setMigrationNotice(null)}>
              OK
            </button>
          </div>
        )}

        <div className={view === "review" ? "capture-section" : "capture-section compact"}>
          {view === "review" ? (
            <header className="page-heading home-heading">
              <h1>Co jeszcze chodzi Ci po głowie?</h1>
            </header>
          ) : <label className="capture-label" htmlFor="thought-input">Co jeszcze chodzi Ci po głowie?</label>}

            <form className="capture-form" onSubmit={submitThought}>
              <div className="capture-row">
                <div className="input-shell">
                  <input
                    ref={inputRef}
                    id="thought-input"
                    value={draft}
                    onChange={(event) => updateDraft(event.target.value)}
                    maxLength={280}
                    autoComplete="off"
                    autoCapitalize="sentences"
                    aria-label="Myśl do zapisania"
                  />
                  {draft.length === 0 && (
                    <span
                      className="rotating-placeholder"
                      key={exampleIndex}
                      aria-hidden="true"
                    >
                      {THOUGHT_EXAMPLES[exampleIndex]}
                    </span>
                  )}
                </div>
                <button type="submit" aria-label="Zapisz myśl" disabled={!draft.trim() || !hydrated}>
                  <span aria-hidden="true">{addedFeedback ? "✓" : "+"}</span>
                  {addedFeedback ? "Dodane" : "Zostaw tutaj"}
                </button>
              </div>
            </form>

            <div className="sync-status" role="status" aria-live="polite">
              <span>{pendingCount > 0
                ? `Zapisane na tym urządzeniu. ${syncing && !offline ? "Synchronizuję" : "Czeka na synchronizację"}: ${pendingCount}.`
                : offline ? "Brak połączenia. Nowe myśli zapiszą się na tym urządzeniu."
                : saveError ? "Nie udało się odświeżyć listy. Spróbuję ponownie."
                : syncing ? "Synchronizuję…" : hydrated ? "Zsynchronizowano" : "Wczytuję…"}
              </span>
              {(pendingCount > 0 || saveError) && (
                <button type="button" className="text-button" disabled={syncing} onClick={() => void synchronizePending()}>
                  Spróbuj teraz
                </button>
              )}
            </div>

            {addedFeedback && (
              <div
                className="add-confirmation"
                key={addedFeedback.id}
                role="status"
                aria-live="polite"
              >
                <span className="add-confirmation-mark" aria-hidden="true">
                  ✓
                </span>
                <span>
                  <strong>Dodane do poczekalni</strong>
                  {addedFeedback.text}
                </span>
              </div>
            )}
        </div>

        {view === "review" && (
          <>
            <section className="review-section" aria-labelledby="review-title">
              <div className="section-heading">
                <div>
                  <h2 id="review-title">Do przejrzenia</h2>
                </div>
                {activeThoughts.length > 0 && (
                  <span className="soft-count">
                    {Math.min(queue.length, QUEUE_SIZE)} z {activeThoughts.length}
                  </span>
                )}
              </div>

              {!hydrated ? (
                <div className="loading-card" aria-live="polite">
                  Otwieram Twoją spokojną listę…
                </div>
              ) : queue.length > 0 ? (
                <div className="thought-queue">
                  {queue.map((thought, index) => (
                    <article className="thought-card" key={thought.id}>
                      <span className="thought-index" aria-hidden="true">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <div className="thought-body">
                        {editingId === thought.id ? (
                          renderThoughtEditor(thought)
                        ) : (
                          <>
                            <button
                              type="button"
                              className="editable-thought-text"
                              onClick={() => beginEditing(thought)}
                              aria-label={`Edytuj zadanie: ${thought.text}`}
                              title="Kliknij, aby edytować"
                            >
                              {thought.text}
                            </button>
                            <span>
                              Zapisano{" "}
                              {formatRelativeTime(
                                thought.createdAt,
                                currentTime,
                              )}
                            </span>
                          </>
                        )}
                      </div>
                      <div className="thought-actions">
                        <button
                          className="button-secondary"
                          type="button"
                          onClick={() => deferThought(thought.id)}
                        >
                          Nie teraz
                          <span aria-hidden="true">→</span>
                        </button>
                        <button
                          className="button-primary"
                          type="button"
                          onClick={() => completeThought(thought.id)}
                        >
                          <span aria-hidden="true">✓</span>
                          Załatwione
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <span className="empty-mark" aria-hidden="true">
                    ☺
                  </span>
                  <h3>Głowa może odpocząć.</h3>
                  <p>
                    Nie ma tu jeszcze żadnych myśli do przejrzenia. Możesz
                    zostawić pierwszą powyżej.
                  </p>
                </div>
              )}
            </section>
          </>
        )}

        {view === "all" && (
          <section className="list-page" aria-labelledby="all-title">
            <header className="page-heading">
              <h1 id="all-title">Wszystkie myśli</h1>
            </header>

            {allActive.length > 0 ? (
              <div className="full-list">
                {allActive.map((thought) => (
                  <article className="list-row" key={thought.id}>
                    {editingId === thought.id ? (
                      renderThoughtEditor(thought)
                    ) : (
                      <>
                        <div className="list-row-copy">
                          <button
                            type="button"
                            className="editable-thought-text"
                            onClick={() => beginEditing(thought)}
                            aria-label={`Edytuj zadanie: ${thought.text}`}
                            title="Kliknij, aby edytować"
                          >
                            {thought.text}
                          </button>
                          <span>
                            Zapisano{" "}
                            {formatRelativeTime(thought.createdAt, currentTime)}
                          </span>
                        </div>
                        <div className="row-actions">
                          <button
                            type="button"
                            className="small-primary"
                            onClick={() => completeThought(thought.id)}
                          >
                            ✓ Załatwione
                          </button>
                          <button
                            type="button"
                            className="text-button"
                            onClick={() => beginEditing(thought)}
                          >
                            Edytuj
                          </button>
                          <button
                            type="button"
                            className="delete-button"
                            onClick={() => setDeleteTarget(thought)}
                          >
                            Usuń
                          </button>
                        </div>
                      </>
                    )}
                  </article>
                ))}
              </div>
            ) : (
              <SimpleEmpty
                title="Poczekalnia jest pusta."
                copy="Każda nowa myśl pojawi się tutaj."
                action="Zapisz pierwszą myśl"
                onAction={() => {
                  setView("review");
                  setTimeout(() => inputRef.current?.focus(), 0);
                }}
              />
            )}
          </section>
        )}

        {view === "done" && (
          <section className="list-page" aria-labelledby="done-title">
            <header className="page-heading">
              <h1 id="done-title">Załatwione</h1>
            </header>

            {completedThoughts.length > 0 ? (
              <div className="completed-list">
                {completedThoughts.map((thought) => (
                  <article className="completed-row" key={thought.id}>
                    <span className="completed-check" aria-hidden="true">
                      ✓
                    </span>
                    <div>
                      {editingId === thought.id ? (
                        renderThoughtEditor(thought)
                      ) : (
                        <>
                          <button
                            type="button"
                            className="editable-thought-text completed"
                            onClick={() => beginEditing(thought)}
                            aria-label={`Edytuj zadanie: ${thought.text}`}
                            title="Kliknij, aby edytować"
                          >
                            {thought.text}
                          </button>
                          <span>
                            Załatwiono{" "}
                            {formatRelativeTime(
                              thought.completedAt ?? thought.createdAt,
                              currentTime,
                            )}
                          </span>
                        </>
                      )}
                    </div>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => restoreThought(thought.id)}
                    >
                      Przywróć
                    </button>
                  </article>
                ))}
              </div>
            ) : (
              <SimpleEmpty
                title="Historia dopiero się zacznie."
                copy="Załatwione myśli będą bezpiecznie czekać tutaj."
                action="Wróć do kolejki"
                onAction={() => setView("review")}
              />
            )}
          </section>
        )}

        {view === "stats" && (
          <section
            className="statistics-page"
            aria-labelledby="statistics-title"
          >
            <header className="statistics-heading">
              <p className="eyebrow">Ostatnie 30 dni</p>
              <h1 id="statistics-title">Zadania w kolejce</h1>
            </header>
            <QueueHistoryChart
              thoughts={thoughts}
              currentTime={currentTime}
            />
          </section>
        )}
      </main>

      {undoThought && (
        <div className="toast" role="status" aria-live="polite">
          <span>Przeniesiono do załatwionych.</span>
          <button type="button" onClick={undoCompletion}>
            Cofnij
          </button>
        </div>
      )}

      {deleteTarget && (
        <div className="modal-backdrop" role="presentation">
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-title"
          >
            <p className="eyebrow">Usuwanie myśli</p>
            <h2 id="delete-title">Pozbyć się jej na dobre?</h2>
            <p className="modal-thought">„{deleteTarget.text}”</p>
            <p>Nie będzie jej później w historii.</p>
            <div className="modal-actions">
              <button
                type="button"
                className="button-secondary"
                onClick={() => setDeleteTarget(null)}
              >
                Zostaw ją
              </button>
              <button
                type="button"
                className="danger-button"
                onClick={deleteThought}
              >
                Usuń na dobre
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const CHART_WIDTH = 800;
const CHART_HEIGHT = 440;
const CHART_PADDING = { top: 34, right: 24, bottom: 58, left: 56 };

function QueueHistoryChart({
  thoughts,
  currentTime,
}: {
  thoughts: Thought[];
  currentTime: number;
}) {
  const data = useMemo(
    () => buildQueueHistory(thoughts, currentTime),
    [thoughts, currentTime],
  );
  const [selectedIndex, setSelectedIndex] = useState(data.length - 1);
  const plotWidth = CHART_WIDTH - CHART_PADDING.left - CHART_PADDING.right;
  const plotHeight = CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom;
  const chartBottom = CHART_PADDING.top + plotHeight;
  const maxCount = Math.max(1, ...data.map((point) => point.count));
  const ceiling = Math.max(4, Math.ceil(maxCount / 4) * 4);
  const points = data.map((point, index) => ({
    ...point,
    x:
      CHART_PADDING.left +
      (index / Math.max(1, data.length - 1)) * plotWidth,
    y: CHART_PADDING.top + (1 - point.count / ceiling) * plotHeight,
  }));
  const activePoint = points[selectedIndex] ?? points[points.length - 1];
  const linePath = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${chartBottom} L ${points[0].x} ${chartBottom} Z`;
  const yTicks = Array.from({ length: 5 }, (_, index) =>
    Math.round((ceiling / 4) * index),
  );
  const dateLabelIndices = new Set(
    Array.from({ length: 5 }, (_, index) =>
      Math.round(((data.length - 1) / 4) * index),
    ),
  );
  const tooltipWidth = 170;
  const tooltipHeight = 64;
  const tooltipX = Math.min(
    CHART_WIDTH - CHART_PADDING.right - tooltipWidth,
    Math.max(CHART_PADDING.left, activePoint.x - tooltipWidth / 2),
  );
  const tooltipY =
    activePoint.y - tooltipHeight - 16 > 8
      ? activePoint.y - tooltipHeight - 16
      : activePoint.y + 16;

  function selectClosestPoint(event: ReactPointerEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const pointerX =
      ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * CHART_WIDTH;
    const ratio = (pointerX - CHART_PADDING.left) / plotWidth;
    const nextIndex = Math.round(ratio * (data.length - 1));
    setSelectedIndex(Math.max(0, Math.min(data.length - 1, nextIndex)));
  }

  function moveSelection(event: ReactKeyboardEvent<SVGSVGElement>) {
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((index) => Math.max(0, index - 1));
    }
    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((index) => Math.min(data.length - 1, index + 1));
    }
    if (event.key === "Home") {
      event.preventDefault();
      setSelectedIndex(0);
    }
    if (event.key === "End") {
      event.preventDefault();
      setSelectedIndex(data.length - 1);
    }
  }

  return (
    <div className="queue-chart-shell">
      <svg
        className="queue-chart"
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        role="img"
        tabIndex={0}
        aria-label={`Liczba zadań w kolejce, ${chartTooltipDateFormatter.format(activePoint.date)}: ${activePoint.count}. Użyj strzałek, aby zmienić dzień.`}
        onPointerMove={selectClosestPoint}
        onPointerDown={selectClosestPoint}
        onKeyDown={moveSelection}
      >
        <defs>
          <linearGradient id="queue-chart-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.34" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {yTicks.map((tick) => {
          const y = CHART_PADDING.top + (1 - tick / ceiling) * plotHeight;
          return (
            <g key={tick}>
              <line
                className="chart-grid-line"
                x1={CHART_PADDING.left}
                x2={CHART_WIDTH - CHART_PADDING.right}
                y1={y}
                y2={y}
              />
              <text
                className="chart-axis-label"
                x={CHART_PADDING.left - 13}
                y={y + 5}
                textAnchor="end"
              >
                {tick}
              </text>
            </g>
          );
        })}

        {points.map((point, index) =>
          dateLabelIndices.has(index) ? (
            <text
              className="chart-axis-label"
              key={point.date.toISOString()}
              x={point.x}
              y={CHART_HEIGHT - 19}
              textAnchor={
                index === 0
                  ? "start"
                  : index === points.length - 1
                    ? "end"
                    : "middle"
              }
            >
              {chartAxisDateFormatter.format(point.date)}
            </text>
          ) : null,
        )}

        <path className="chart-area" d={areaPath} />
        <path className="chart-line" d={linePath} />
        <rect
          className="chart-interaction-layer"
          x={CHART_PADDING.left}
          y={CHART_PADDING.top}
          width={plotWidth}
          height={plotHeight}
        />
        <line
          className="chart-crosshair"
          x1={activePoint.x}
          x2={activePoint.x}
          y1={CHART_PADDING.top}
          y2={chartBottom}
        />
        <circle
          className="chart-active-point-halo"
          cx={activePoint.x}
          cy={activePoint.y}
          r="10"
        />
        <circle
          className="chart-active-point"
          cx={activePoint.x}
          cy={activePoint.y}
          r="5"
        />

        <g className="chart-tooltip" pointerEvents="none">
          <rect
            x={tooltipX}
            y={tooltipY}
            width={tooltipWidth}
            height={tooltipHeight}
            rx="12"
          />
          <text x={tooltipX + 14} y={tooltipY + 25}>
            {chartTooltipDateFormatter.format(activePoint.date)}
          </text>
          <text className="chart-tooltip-value" x={tooltipX + 14} y={tooltipY + 49}>
            {activePoint.count} w kolejce
          </text>
        </g>
      </svg>
    </div>
  );
}

function LoginScreen({
  password,
  error,
  busy,
  onPasswordChange,
  onSubmit,
}: {
  password: string;
  error: string;
  busy: boolean;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <main className="access-page">
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-brand" aria-hidden="true">
          <span className="brand-mark">+1</span>
          <span>1 more thing</span>
        </div>
        <p className="eyebrow">Prywatna przestrzeń</p>
        <h1 id="login-title">Dobrze Cię widzieć.</h1>
        <form className="login-form" onSubmit={onSubmit}>
          <label htmlFor="login-password">Hasło</label>
          <input
            id="login-password"
            type="password"
            value={password}
            onChange={(event) => onPasswordChange(event.target.value)}
            autoComplete="current-password"
            autoFocus
            required
          />
          {error && <p className="login-error">{error}</p>}
          <button type="submit" disabled={busy}>
            {busy ? "Otwieram…" : "Wejdź"}
          </button>
        </form>
      </section>
    </main>
  );
}

function AccessScreen({
  mode,
}: {
  mode: "loading" | "misconfigured" | "error";
}) {
  const content = {
    loading: {
      title: "Chwila…",
      copy: "Łączę się z Twoją listą.",
    },
    misconfigured: {
      title: "Brakuje konfiguracji dostępu.",
      copy: "Ustaw AUTH_PASSWORD_HASH i SESSION_SECRET w środowisku aplikacji.",
    },
    error: {
      title: "Nie udało się otworzyć aplikacji.",
      copy: "Sprawdź połączenie i spróbuj odświeżyć stronę.",
    },
  }[mode];

  return (
    <main className="access-page">
      <section className="access-message" aria-live="polite">
        <span className="brand-mark" aria-hidden="true">
          +1
        </span>
        <h1>{content.title}</h1>
        <p>{content.copy}</p>
      </section>
    </main>
  );
}

function NavButton({
  active,
  label,
  symbol,
  onClick,
}: {
  active: boolean;
  label: string;
  symbol: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`nav-button${active ? " active" : ""}`}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
    >
      <span className="nav-symbol" aria-hidden="true">
        {symbol}
      </span>
      <span>{label}</span>
    </button>
  );
}

function SimpleEmpty({
  title,
  copy,
  action,
  onAction,
}: {
  title: string;
  copy: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <div className="simple-empty">
      <span aria-hidden="true">○</span>
      <h2>{title}</h2>
      <p>{copy}</p>
      <button type="button" onClick={onAction}>
        {action} <span aria-hidden="true">→</span>
      </button>
    </div>
  );
}
