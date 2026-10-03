# 1 more thing

Spokojna, responsywna aplikacja do odkładania myśli na później. Natywny serwer
**Rust / Axum** udostępnia API oraz statyczny frontend **Preact / Vite**.
Produkcja uruchamia jeden proces `and1`; Node jest potrzebny wyłącznie do
zbudowania frontendu i uruchamiania testów.

## Korzystanie

- Dodawanie z każdego widoku, przyciskiem **+** lub skrótem **⌘K / Ctrl+K**.
- Edycja, odkładanie, załatwianie, cofanie, przywracanie i usuwanie myśli.
- Widoki kolejki, wszystkich myśli, załatwionych i statystyk ostatnich 30 dni.
- Automatyczny ciemny motyw, układ mobilny oraz ograniczenie animacji zgodne
  z ustawieniami systemu.
- Szkic i kolejka zmian zapisują się w `localStorage`. Zmiany są usuwane
  z kolejki dopiero po potwierdzeniu serwera. Synchronizacja wraca po odzyskaniu
  sieci, powrocie do karty, co 15 sekund lub przez **Spróbuj teraz**.
- Ikona chmury z zegarem oznacza zmiany oczekujące na synchronizację. Jest
  widoczna przy statusie aplikacji oraz przy zmienionych myślach, także na liście
  załatwionych. Znika po potwierdzeniu zapisu. Przekreślona chmura oznacza brak sieci.

Po pierwszym zalogowaniu online i zapisaniu plików aplikacji przez service worker
można ją otwierać i odświeżać bez internetu. Dostępna jest ostatnia lokalna kopia
listy wraz z niewysłanymi zmianami; dodawanie, edycja i pozostałe operacje działają
offline. Powrót połączenia uruchamia synchronizację. Przy niedostępnym serwerze
aplikacja również korzysta z zapisanej kopii i pokazuje stan oczekiwania.

Wylogowanie blokuje dostęp do lokalnej listy, również offline i w innych otwartych
kartach. Niewysłane zmiany i szkic pozostają do kolejnego logowania online.
Jeżeli serwer zgłosi wygaśnięcie sesji, ponowne logowanie jest wymagane przed
dalszą synchronizacją. Lokalna kopia nie jest szyfrowana; korzystaj z własnego
profilu przeglądarki. Usunięcie danych witryny usuwa również kopię offline,
niewysłane zmiany i szkic.

## Instalacja jako PWA

Aplikacja ma manifest, ikony PNG (192 i 512 px), osobną ikonę maskowalną
Androida i ikonę ekranu początkowego Apple. Uruchamia się w trybie `standalone`.
Instalacja wymaga **HTTPS**; lokalnie można sprawdzać ją na `localhost`.

- **Chrome / Edge:** użyj przycisku **Zainstaluj** w nagłówku (na telefonie
  w menu) lub opcji instalacji przeglądarki. Przycisk pojawia się po otrzymaniu
  `beforeinstallprompt`; przeglądarka decyduje, kiedy instalacja jest dostępna.
- **Firefox na Androidzie:** wybierz **⋮ → Zainstaluj** w menu przeglądarki
  i potwierdź dodanie do ekranu głównego. Przycisk **Zainstaluj aplikację**
  w naszym menu pokazuje instrukcję, ponieważ Firefox nie udostępnia
  `beforeinstallprompt`.
- **iPhone / iPad:** w Safari wybierz **Udostępnij → Do ekranu początkowego**,
  pozostaw włączone otwieranie jako aplikacji www, jeśli ta opcja jest widoczna,
  i wybierz **Dodaj**. Przycisk w aplikacji pokazuje te wskazówki.
- **Safari na Macu (macOS Sonoma lub nowszy):** **Plik → Dodaj do Docka**.
- W oknie zainstalowanej aplikacji przycisk instalacji jest ukryty.

Service worker zapisuje kompletny zestaw publicznych plików jednej wersji:
HTML, JS, CSS, manifest i ikony. API i odpowiedzi logowania nie trafiają do jego
cache; lokalna kopia listy i kolejka zmian są przechowywane osobno w `localStorage`.
Nowa wersja pobiera się w tle podczas otwarcia online. Aby ją uruchomić, zamknij
wszystkie karty i okna aplikacji, a następnie otwórz ją ponownie. Aktualizacja nie
podmienia działającej wersji w trakcie wpisywania. `/sw.js` wymaga rewalidacji,
a pliki JS/CSS mają hashe w nazwach.
Zainstalowana aplikacja może wymagać ponownego logowania. Lokalny szkic
i niewysłane zmiany nie muszą być współdzielone z kartą przeglądarki.
Pełny start offline działa w buildzie produkcyjnym (`npm run build` i `npm start`)
na HTTPS lub localhost; serwer developerski Vite nie rejestruje service workera.

Ikony bazują na `public/favicon.svg`. Aby je odtworzyć po zmianie SVG,
uruchom `node scripts/generate-pwa-icons.mjs` (wymagany Chromium Playwrighta).

## Architektura i wydajność

- Axum/Tokio obsługuje HTTP; SQLite pracuje w osobnym wątku z ograniczoną
  kolejką zleceń. Dysk i scrypt nie blokują pętli HTTP.
- SQLite: WAL, pełna trwałość `synchronous=FULL`, cache przygotowanych zapytań,
  indeks `created_at`. Operacja i jej potwierdzenie zapisują się w jednej transakcji.
- Preact zachowuje dotychczasowy markup i CSS, bez runtime Next/React/RSC.
  Listy niewidocznych widoków nie są sortowane, a statystyki parsują daty raz.
- Build generuje Brotli i gzip. Pliki z hashem mają roczny cache `immutable`;
  HTML wymaga rewalidacji, odpowiedzi API mają `no-store`.

## Uruchomienie lokalne

Wymagania: Rust **1.95**, kompilator C (SQLite jest wbudowany w plik wykonywalny),
Node.js **>=22.13.0** i npm.

```bash
npm ci
cp .env.example .env.local
npm run --silent auth:hash -- 'wpisz-tu-dlugie-haslo'
openssl rand -hex 32
```

Wpisz otrzymany hash do `AUTH_PASSWORD_HASH`, a losowy sekret do
`SESSION_SECRET`. Zachowaj istniejące wartości przy aktualizacji produkcji.

```bash
npm run dev
```

Frontend z HMR: `http://localhost:5173`; Rust API: `http://127.0.0.1:3000`.
Vite przekazuje `/api` i `/health` do Rusta. Rust czyta `.env.local`, następnie
`.env`; zmienne środowiskowe mają pierwszeństwo.

```bash
npm run build
npm start
```

Wersja produkcyjna działa na `http://localhost:3000`. Wyniki buildu:
`target/release/and1` i `dist/client`. Sam serwer można zbudować przez
`cargo build --release --locked`.

| Zmienna | Domyślnie | Znaczenie |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | Adres nasłuchiwania |
| `PORT` | `3000` | Port HTTP |
| `DATABASE_PATH` | `data/and1.db` | Dotychczasowa baza SQLite |
| `STATIC_DIR` | `dist/client` | Zbudowany frontend |
| `AUTH_PASSWORD_HASH` | — | Dotychczasowy hash `scrypt.salt.hash` |
| `SESSION_SECRET` | — | Dotychczasowy sekret sesji, min. 32 znaki |

Migracje SQL są wbudowane w binarkę. `MIGRATIONS_PATH` nie jest już potrzebne.
`and1 healthcheck` sprawdza HTTP i połączenie z bazą. `and1 hash-password`
przyjmuje hasło z argumentu albo ze standardowego wejścia.

## Zgodność z dotychczasową produkcją

Aktualizacja otwiera istniejący plik SQLite bez eksportu ani konwersji danych.
Zachowane są:

- tabele `thoughts`, `mutation_receipts` i `__drizzle_migrations`, identyfikatory,
  statusy oraz daty w milisekundach;
- historia i hashe migracji Drizzle — także baza sprzed wprowadzenia kolejki offline;
- hasła Node scrypt (`N=16384, r=8, p=1`, klucz 64 bajty);
- cookie `and1_session`, format HMAC-SHA256 i 30-dniowy czas ważności;
- adresy API, format JSON i stare odciski `Idempotency-Key`, również porządek
  pól JSON oraz kodowanie ścieżek;
- klucze `localStorage`, szkice, lokalna kolejka i jednorazowy import starego magazynu.

Jedyna dodatkowa zmiana schematu to indeks `thoughts_created_at_idx`.
Dotychczasowy serwer Node może czytać bazę zapisaną przez Rust; potwierdzenia
nowych operacji mają ten sam format. Zachowanie sekretu sesji i domeny pozwala
utrzymać zalogowanie i dostęp do lokalnej kolejki.

## Docker Compose / Dokploy

Utwórz `.env` lub ustaw zmienne w Dokploy:

```dotenv
AUTH_PASSWORD_HASH=scrypt....
SESSION_SECRET=dotychczasowy-sekret-sesji
```

Lokalnie:

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build -d
```

W Dokploy pozostaw usługę **Docker Compose**, plik `./docker-compose.yml`,
usługę `app`, port kontenera `3000`, domenę i HTTPS. Nowy Dockerfile buduje
frontend i Rust osobno, a finalny obraz zawiera tylko binarkę i statyczne pliki.
Użytkownik ma UID/GID `1000`, zgodnie z poprzednim obrazem Node.

Przy pierwszym wdrożeniu tej wersji:

1. Wykonaj spójną kopię wolumenu przy zatrzymanej aplikacji (SQLite używa WAL).
2. Zachowaj **ten sam projekt Compose i wolumen `sqlite_data`**, zamontowany
   w `/app/data`; baza pozostaje w `/app/data/and1.db`.
3. Zachowaj `AUTH_PASSWORD_HASH`, `SESSION_SECRET`, domenę i jedną replikę.
4. Wdróż nowy obraz i sprawdź `/health`, logowanie oraz istniejące wpisy.

Nie używaj `docker compose down -v` — usuwa wolumen. Powrót do poprzedniego
obrazu może korzystać z tego samego wolumenu. Kopia bezpieczeństwa pozostaje
potrzebna niezależnie od kompatybilnego schematu. Codzienny backup wolumenu
można nadal wykonywać z Dokploy do S3, zatrzymując kontener na czas kopii.

## Weryfikacja

```bash
npm test                       # build + HTTP, zgodność danych, kolejka offline
npm run check                  # TypeScript, rustfmt, Clippy
npx playwright install chromium
npm run test:browser            # interakcje i porównania obrazów
npm run test:docker             # kontener, stary wolumen, zapis i restart
npm run benchmark              # lokalny pomiar na osobnej bazie z 1000 wpisów
```

Testy nie używają bazy produkcyjnej. Test zgodności tworzy bazę według
oryginalnych migracji i potwierdzenia operacji według starego algorytmu Node.
Obrazy referencyjne testów przeglądarkowych pochodzą z poprzedniej wersji
aplikacji; obejmują logowanie i cztery widoki, jasny/ciemny motyw oraz mobile/desktop.
Są zależne od systemu i wersji Chromium — na innym systemie wymagają ponownego
porównania z oryginałem, a nie automatycznego zaakceptowania zmian wyglądu.

Benchmark raportuje lokalną przepustowość i p50/p95, bez gwarancji takich samych
wyników na serwerze produkcyjnym. `BENCH_REQUESTS` i `BENCH_CONCURRENCY`
zmieniają rozmiar próby. `BENCH_URL` i `BENCH_COOKIE` pozwalają wskazać inną
**lokalną instancję testową**; w tym trybie benchmark wykonuje wyłącznie odczyty.

Pomiar porównawczy z 3 października 2026: macOS ARM64, obie wersje produkcyjne,
1000 identycznych wpisów, 16 równoległych połączeń HTTP keep-alive,
200 żądań rozgrzewki i 2000 mierzonych żądań na endpoint, bez kompresji API.

| Endpoint | Node: żądania/s | Rust: żądania/s | Node: p95 | Rust: p95 |
| --- | ---: | ---: | ---: | ---: |
| `/` | 209 | 7847 | 154,36 ms | 4,06 ms |
| `/api/auth/session` | 2260 | 14838 | 14,03 ms | 2,41 ms |
| `/api/thoughts` | 175 | 1436 | 170,45 ms | 16,66 ms |

Łączny JavaScript frontendu spadł z około 298 kB do 39 kB przed kompresją,
a po gzip z 92 kB do 14 kB. To rozmiary zbudowanych plików, nie pomiar czasu
interakcji na każdym urządzeniu. Strona główna jest teraz statyczna; stary wynik
uwzględniał renderowanie HTML przy każdym żądaniu.
