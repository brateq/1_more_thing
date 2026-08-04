"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

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

type AddedFeedback = {
  id: string;
  text: string;
};

const STORAGE_KEY = "and-1-more-thing:v1";
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
  const inputRef = useRef<HTMLInputElement>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const addedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const hydrationTimer = window.setTimeout(() => {
      setThoughts(readStoredThoughts());
      setHydrated(true);
    }, 0);

    return () => window.clearTimeout(hydrationTimer);
  }, []);

  useEffect(() => {
    if (!hydrated) return;

    try {
      const store: StoredThoughts = { version: 1, thoughts };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
      queueMicrotask(() => setSaveError(false));
    } catch {
      queueMicrotask(() => setSaveError(true));
    }
  }, [thoughts, hydrated]);

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
    setCurrentTime(Date.now());
    setAddedFeedback({ id: thought.id, text: thought.text });
    if (addedTimer.current) clearTimeout(addedTimer.current);
    addedTimer.current = setTimeout(() => setAddedFeedback(null), 2800);
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
  }

  function deleteThought() {
    if (!deleteTarget) return;
    setThoughts((current) =>
      current.filter((thought) => thought.id !== deleteTarget.id),
    );
    setDeleteTarget(null);
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
      </header>

      <main className="main-content">
        {saveError && (
          <div className="save-alert" role="alert">
            Nie udało się zapisać zmiany w tej przeglądarce. Zostanie widoczna
            tylko do zamknięcia strony.
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
