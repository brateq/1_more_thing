"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

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

type View = "review" | "all" | "done";
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

const STORAGE_KEY = "and-1-more-thing:v1";
const MIGRATION_KEY = "and-1-more-thing:sqlite-migrated:v1";
const QUEUE_SIZE = 5;
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
  const inputRef = useRef<HTMLInputElement>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const addedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mutationQueue = useRef<Promise<void>>(Promise.resolve());

  const refreshThoughts = useCallback(async () => {
    const response = await fetch("/api/thoughts", { cache: "no-store" });
    if (response.status === 401) {
      setAuthState("anonymous");
      throw new Error("Unauthorized");
    }

    const body = await readJson<{ thoughts: unknown[] }>(response);
    setThoughts(body.thoughts.filter(isThought));
    setCurrentTime(Date.now());
    setSaveError(false);
  }, []);

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
  }, [refreshThoughts]);

  useEffect(() => {
    let active = true;

    async function initialize() {
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
    if (authState !== "authenticated") return;

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        void refreshThoughts().catch(() => setSaveError(true));
      }
    };

    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [authState, refreshThoughts]);

  useEffect(() => {
    return () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
      if (addedTimer.current) clearTimeout(addedTimer.current);
    };
  }, []);

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

  function synchronize(url: string, init: RequestInit) {
    mutationQueue.current = mutationQueue.current
      .then(async () => {
        const response = await fetch(url, init);
        if (response.status === 401) {
          setAuthState("anonymous");
          throw new Error("Unauthorized");
        }
        if (!response.ok) throw new Error("Synchronization failed");
        setSaveError(false);
      })
      .catch(async () => {
        setSaveError(true);
        await refreshThoughts().catch(() => undefined);
      });
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

    setThoughts((current) => [thought, ...current]);
    setDraft("");
    setCurrentTime(new Date(now).getTime());
    setAddedFeedback({ id: thought.id, text: thought.text });
    if (addedTimer.current) clearTimeout(addedTimer.current);
    addedTimer.current = setTimeout(() => setAddedFeedback(null), 2800);
    void synchronize("/api/thoughts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ thought }),
    });
  }

  function completeThought(id: string) {
    const thought = thoughts.find((item) => item.id === id);
    if (!thought) return;

    const completedAt = new Date().toISOString();
    setThoughts((current) =>
      current.map((item) =>
        item.id === id ? { ...item, status: "done", completedAt } : item,
      ),
    );

    setUndoThought(thought);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndoThought(null), 6000);
    void synchronize(`/api/thoughts/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "done", completedAt }),
    });
  }

  function deferThought(id: string) {
    const deferredAt = new Date().toISOString();
    setThoughts((current) =>
      current.map((thought) =>
        thought.id === id
          ? { ...thought, lastPresentedAt: deferredAt }
          : thought,
      ),
    );
    void synchronize(`/api/thoughts/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lastPresentedAt: deferredAt }),
    });
  }

  function restoreThought(id: string) {
    setThoughts((current) =>
      current.map((thought) =>
        thought.id === id
          ? {
              ...thought,
              status: "active",
              completedAt: null,
              lastPresentedAt: null,
            }
          : thought,
      ),
    );
    void synchronize(`/api/thoughts/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "active",
        completedAt: null,
        lastPresentedAt: null,
      }),
    });
  }

  function undoCompletion() {
    if (!undoThought) return;
    restoreThought(undoThought.id);
    setUndoThought(null);
    if (undoTimer.current) clearTimeout(undoTimer.current);
  }

  function beginEditing(thought: Thought) {
    setEditingId(thought.id);
    setEditingText(thought.text);
  }

  function saveEdit(event: FormEvent, id: string) {
    event.preventDefault();
    const text = editingText.trim();
    if (!text) return;

    setThoughts((current) =>
      current.map((thought) =>
        thought.id === id ? { ...thought, text } : thought,
      ),
    );
    setEditingId(null);
    setEditingText("");
    void synchronize(`/api/thoughts/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  }

  function deleteThought() {
    if (!deleteTarget) return;
    setThoughts((current) =>
      current.filter((thought) => thought.id !== deleteTarget.id),
    );
    void synchronize(
      `/api/thoughts/${encodeURIComponent(deleteTarget.id)}`,
      { method: "DELETE" },
    );
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
          onClick={() => setView("review")}
          aria-label="And 1 more thing — strona główna"
        >
          <span className="brand-mark" aria-hidden="true">
            +1
          </span>
          <span className="brand-copy">And 1 more thing</span>
        </button>

        <nav className="desktop-nav" aria-label="Główna nawigacja">
          <NavButton
            active={view === "review"}
            label="Kolejka"
            count={activeThoughts.length}
            symbol="○"
            onClick={() => setView("review")}
          />
          <NavButton
            active={view === "all"}
            label="Wszystkie"
            count={activeThoughts.length}
            symbol="≡"
            onClick={() => setView("all")}
          />
          <NavButton
            active={view === "done"}
            label="Załatwione"
            count={completedThoughts.length}
            symbol="✓"
            onClick={() => setView("done")}
          />
        </nav>
        <button className="logout-button" type="button" onClick={logout}>
          Wyloguj
        </button>
      </header>

      <main className="main-content">
        {saveError && (
          <div className="save-alert" role="alert">
            Nie udało się zsynchronizować ostatniej zmiany. Przywrócono dane
            zapisane na serwerze.
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

        {view === "review" && (
          <>
            <header className="page-heading home-heading">
              <h1>Co jeszcze chodzi Ci po głowie?</h1>
            </header>

            <form className="capture-form" onSubmit={submitThought}>
              <div className="capture-row">
                <div className="input-shell">
                  <input
                    ref={inputRef}
                    id="thought-input"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    maxLength={280}
                    autoComplete="off"
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
                <button type="submit" aria-label="Zapisz myśl">
                  <span aria-hidden="true">{addedFeedback ? "✓" : "+"}</span>
                  {addedFeedback ? "Dodane" : "Zostaw tutaj"}
                </button>
              </div>
            </form>

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
                        <p>{thought.text}</p>
                        <span>
                          Zapisano{" "}
                          {formatRelativeTime(thought.createdAt, currentTime)}
                        </span>
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
                      <form
                        className="edit-form"
                        onSubmit={(event) => saveEdit(event, thought.id)}
                      >
                        <label htmlFor={`edit-${thought.id}`}>
                          Popraw treść myśli
                        </label>
                        <input
                          id={`edit-${thought.id}`}
                          value={editingText}
                          onChange={(event) =>
                            setEditingText(event.target.value)
                          }
                          maxLength={280}
                          autoFocus
                        />
                        <div className="edit-actions">
                          <button type="submit" className="small-primary">
                            Zapisz
                          </button>
                          <button
                            type="button"
                            className="text-button"
                            onClick={() => setEditingId(null)}
                          >
                            Anuluj
                          </button>
                        </div>
                      </form>
                    ) : (
                      <>
                        <div className="list-row-copy">
                          <p>{thought.text}</p>
                          <span>
                            Zapisano{" "}
                            {formatRelativeTime(thought.createdAt, currentTime)}
                          </span>
                        </div>
                        <div className="row-actions">
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
                      <p>{thought.text}</p>
                      <span>
                        Załatwiono{" "}
                        {formatRelativeTime(
                          thought.completedAt ?? thought.createdAt,
                          currentTime,
                        )}
                      </span>
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
      </main>

      <nav className="mobile-nav" aria-label="Główna nawigacja">
        <NavButton
          active={view === "review"}
          label="Przejrzyj"
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
      </nav>

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
          <span>And 1 more thing</span>
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
  count,
  symbol,
  onClick,
}: {
  active: boolean;
  label: string;
  count?: number;
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
      {typeof count === "number" && <span className="nav-count">{count}</span>}
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
