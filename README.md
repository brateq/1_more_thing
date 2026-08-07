# And 1 more thing

Spokojna, responsywna aplikacja webowa do odkładania na później myśli, które
niepotrzebnie zajmują głowę. Dane są przechowywane w centralnej bazie SQLite i
synchronizują się po zalogowaniu na każdym urządzeniu.

## Wymagania lokalne

- Node.js `>=22.13.0`
- npm

## Uruchomienie deweloperskie

```bash
npm ci
npm run --silent auth:hash -- "wpisz-tu-dlugie-haslo"
openssl rand -hex 32
```

Skopiuj `.env.example` jako `.env.local`, wpisz wygenerowany
`AUTH_PASSWORD_HASH` oraz wynik drugiego polecenia jako `SESSION_SECRET`.
Następnie:

```bash
npm run dev
```

## Sprawdzenie wersji produkcyjnej

```bash
npm test
```

Build w trybie `standalone` powstaje w `dist/standalone` i można go uruchomić
poleceniem `npm start`.

## Docker Compose lokalnie

Utwórz plik `.env`:

```dotenv
AUTH_PASSWORD_HASH=scrypt....
SESSION_SECRET=losowy-sekret-majacy-przynajmniej-32-znaki
```

Hash hasła wygenerujesz przez `npm run --silent auth:hash -- "Twoje hasło"`.
Po skonfigurowaniu sekretów uruchom:

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up --build -d
```

Aplikacja będzie dostępna pod `http://localhost:3000`. Zatrzymanie:

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml down
```

## Wdrożenie w Dokploy

1. Utwórz usługę typu **Docker Compose** i podłącz repozytorium.
2. Ustaw ścieżkę Compose na `./docker-compose.yml`.
3. W zakładce **Environment** ustaw `AUTH_PASSWORD_HASH` i `SESSION_SECRET`.
4. Wdróż usługę bez dodawania mapowania portu hosta.
5. W zakładce **Domains** dodaj domenę do usługi `app` i ustaw port kontenera
   `3000`.
6. Włącz HTTPS i ponownie wdróż Compose po każdej zmianie domeny.
7. Skonfiguruj codzienny backup nazwanego wolumenu `sqlite_data` do S3 i zaznacz
   zatrzymanie kontenera na czas wykonywania kopii.

Dokploy doda routing Traefika automatycznie. Plik Compose korzysta z `expose`,
więc port aplikacji nie jest publicznie otwierany na serwerze. Endpoint
`/health` służy do monitorowania stanu kontenera.

## Dane użytkownika

SQLite zapisuje dane w `/app/data/and1.db`, umieszczonym w nazwanym wolumenie
`sqlite_data`. Wolumen przetrwa ponowne wdrożenia kontenera. Aplikacja powinna
działać jako jedna replika.

Po pierwszym zalogowaniu aplikacja jednorazowo importuje istniejące myśli ze
starego `localStorage`. Lokalna kopia nie jest od razu usuwana, więc migracja
jest bezpieczna i nie nadpisuje rekordów istniejących już w SQLite.

## Przydatne polecenia

- `npm run dev` — lokalny serwer deweloperski
- `npm run build` — produkcyjny build standalone
- `npm start` — uruchomienie gotowego buildu
- `npm test` — build i testy odpowiedzi HTTP
- `npm run lint` — kontrola jakości kodu
- `npm run db:generate` — wygenerowanie migracji po zmianie schematu
- `npm run auth:hash -- "hasło"` — wygenerowanie bezpiecznego hasha logowania
