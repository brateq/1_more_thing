# And 1 more thing

Spokojna, responsywna aplikacja webowa do odkładania na później myśli, które
niepotrzebnie zajmują głowę. Dane pozostają lokalnie w przeglądarce.

## Wymagania lokalne

- Node.js `>=22.13.0`
- npm

## Uruchomienie deweloperskie

```bash
npm ci
npm run dev
```

## Sprawdzenie wersji produkcyjnej

```bash
npm test
```

Build w trybie `standalone` powstaje w `dist/standalone` i można go uruchomić
poleceniem `npm start`.

## Docker Compose lokalnie

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
3. Wdróż usługę bez dodawania mapowania portu hosta.
4. W zakładce **Domains** dodaj domenę do usługi `app` i ustaw port kontenera
   `3000`.
5. Włącz HTTPS i ponownie wdróż Compose po każdej zmianie domeny.

Dokploy doda routing Traefika automatycznie. Plik Compose korzysta z `expose`,
więc port aplikacji nie jest publicznie otwierany na serwerze. Endpoint
`/health` służy do monitorowania stanu kontenera.

## Dane użytkownika

Myśli są przechowywane w `localStorage` przeglądarki. Nie wymagają wolumenu i
nie znikają przy ponownym wdrożeniu kontenera, ale nie synchronizują się między
urządzeniami ani różnymi przeglądarkami.

## Przydatne polecenia

- `npm run dev` — lokalny serwer deweloperski
- `npm run build` — produkcyjny build standalone
- `npm start` — uruchomienie gotowego buildu
- `npm test` — build i testy odpowiedzi HTTP
- `npm run lint` — kontrola jakości kodu
