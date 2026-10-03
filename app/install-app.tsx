import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

type InstallChoice = { outcome: "accepted" | "dismissed" };
type InstallPrompt = Event & {
  prompt: () => Promise<InstallChoice>;
  userChoice: Promise<InstallChoice>;
};
type InstallHelp = "ios" | "mac" | "firefox-android" | "browser";

function manualInstallHelp(): InstallHelp | null {
  const agent = navigator.userAgent;
  if (/Android/.test(agent) && /Firefox\//.test(agent)) {
    return "firefox-android";
  }
  if (/iPad|iPhone|iPod/.test(agent) || (/Macintosh/.test(agent) && navigator.maxTouchPoints > 1)) {
    return "ios";
  }
  if (/Macintosh/.test(agent) && /Version\/.*Safari\//.test(agent) && !/Chrome|Chromium|Edg|OPR/.test(agent)) {
    return "mac";
  }
  return null;
}

export function useAppInstallation() {
  const deferredPrompt = useRef<InstallPrompt | null>(null);
  const [canPrompt, setCanPrompt] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [help, setHelp] = useState<InstallHelp | null>(null);
  const [manualHelp] = useState(manualInstallHelp);

  // Subscribe before paint so an early browser prompt is kept during login.
  useLayoutEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)");
    const updateDisplayMode = () => setInstalled(standalone.matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true);
    const beforeInstall = (event: Event) => {
      event.preventDefault();
      deferredPrompt.current = event as InstallPrompt;
      setCanPrompt(true);
    };
    const appInstalled = () => {
      deferredPrompt.current = null;
      setCanPrompt(false);
      setInstalled(true);
      setHelp(null);
    };
    updateDisplayMode();
    window.addEventListener("beforeinstallprompt", beforeInstall);
    window.addEventListener("appinstalled", appInstalled);
    standalone.addEventListener("change", updateDisplayMode);
    return () => {
      window.removeEventListener("beforeinstallprompt", beforeInstall);
      window.removeEventListener("appinstalled", appInstalled);
      standalone.removeEventListener("change", updateDisplayMode);
    };
  }, []);

  async function install() {
    const event = deferredPrompt.current;
    if (!event) {
      setHelp(manualHelp ?? "browser");
      return;
    }
    // A browser installation prompt can only be used once, even if dismissed.
    deferredPrompt.current = null;
    setCanPrompt(false);
    try {
      await event.prompt();
      const choice = await event.userChoice;
      if (choice.outcome === "accepted") setInstalled(true);
    } catch {
      setHelp("browser");
    }
  }

  return {
    available: window.isSecureContext && !installed && (canPrompt || manualHelp !== null),
    help, install, closeHelp: () => setHelp(null),
  };
}

export function InstallationHelp({ mode, onClose }: { mode: InstallHelp; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);

  return (
    <dialog ref={dialog} className="install-dialog" aria-labelledby="install-title" onClose={onClose}>
      <img src="/icons/apple-touch-icon.png" width="56" height="56" alt="" />
      <h2 id="install-title">1 more thing pod ręką</h2>
      {mode === "ios" ? (
        <ol>
          <li>Otwórz tę stronę w Safari i wybierz <strong>Udostępnij</strong>.</li>
          <li>Wybierz <strong>Do ekranu początkowego</strong>.</li>
          <li>Pozostaw włączone otwieranie jako aplikacji www, jeśli ta opcja jest widoczna, i stuknij <strong>Dodaj</strong>.</li>
        </ol>
      ) : mode === "mac" ? (
        <ol>
          <li>W Safari wybierz <strong>Plik → Dodaj do Docka</strong>.</li>
          <li>Potwierdź nazwę i kliknij <strong>Dodaj</strong>.</li>
          <li>Otwieraj aplikację z jej ikony w Docku.</li>
        </ol>
      ) : mode === "firefox-android" ? (
        <ol>
          <li>Otwórz menu Firefoxa <strong>⋮</strong> przy pasku adresu.</li>
          <li>Wybierz <strong>Zainstaluj</strong>.</li>
          <li>Potwierdź dodanie ikony do ekranu głównego. Potem otwieraj aplikację z tej ikony.</li>
        </ol>
      ) : (
        <p>Nie udało się otworzyć okna instalacji. Otwórz menu przeglądarki i wybierz opcję instalowania aplikacji, jeśli jest dostępna.</p>
      )}
      <form method="dialog">
        <button className="button-primary" autoFocus>Rozumiem</button>
      </form>
    </dialog>
  );
}
