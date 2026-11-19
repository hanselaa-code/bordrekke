# Bordrekke — Sanntids Partyspill (Rammeverk)

Teknisk grunnmur og sanntids spillmotor for et mobilbasert partyspill i **React + TypeScript + Vite**, drevet av **Firebase (Firestore + Anonymous Authentication)** og klargjort for publisering på **GitHub Pages**.

> **Merk:** Denne fasen inneholder kun teknisk arkitektur, sanntidssynkronisering, brukergrensesnitt og rene plassholder-kort («Kort A», «Kort B», «Kort C» osv. med mock-fasit). Ekte oppgavesett og bilder kan enkelt legges inn senere i `src/data/mockRounds.ts`.

---

## Arkitektur og funksjonalitet

- **Ingen innlogging eller navnevalg:** Alle deltakere får automatisk en anonym Firebase-sesjon (`signInAnonymously`) når de skanner QR-koden.
- **Dynamisk antall spillere (2+):** Ingen øvre grense; dersom flere spillere deltar enn antall forhåndsdefinerte plassholder-kort, genereres ekstra unike kort automatisk.
- **Sanntid med Firestore `onSnapshot`:** Alle endringer i romstatus, utdelte kort, innlåste plasseringer og fasit synkroniseres øyeblikkelig mellom Host-skjerm og alle mobiler.
- **Konfliktfri rekkefølgeregistrering:** Når spillerne trykker **«Lås min plass / Trykk i rekkefølge»**, lagrer Firestore `serverTimestamp()`. Plassnummer (`Plass 1`, `Plass 2`, …) beregnes deterministisk fra server-tidsstemplene, slik at angring/nullstilling automatisk oppdaterer rekkefølgen uten race conditions.
- **Fasit-avsløring:** Når verten trykker **«Vis fasit»**, lyser hver mobilskjerm umiddelbart opp i **grønt** (riktig plassering) eller **rødt** (feil plassering) sammen med kortets fasit-verdi.
- **Mobiloptimalisering:** Globale CSS-regler (`touch-action: manipulation`, `user-select: none`, `-webkit-user-select: none`) og anti-zoom viewport hindrer utilsiktet zooming og tekstmarkering når mobiler flyttes rundt på bordet.
- **Skjerm holdes våken:** Screen Wake Lock API (`navigator.wakeLock.request('screen')`) aktiveres automatisk på både Host- og Mobil-visning og re-aktiveres dersom nettleserfanen kommer tilbake i fokus.
- **GitHub Pages-klar:** Bruker `HashRouter` og relativ `base: './'` i Vite, samt ferdig GitHub Actions-workflow i `.github/workflows/deploy.yml`.

---

## Prosjektstruktur

```text
partyspill/
├── .github/workflows/deploy.yml   # Automatisk bygg og utrulling til GitHub Pages
├── .env.example                   # Mal for Firebase-miljøvariabler
├── firebase.json                  # Firebase Firestore- og emulator-oppsett
├── firestore.rules                # Sikkerhetsregler for rom og spillere
├── firestore.indexes.json         # Firestore-indekser
├── vite.config.ts                 # Vite-oppsett for GitHub Pages (base: './')
└── src/
    ├── firebase/
    │   ├── config.ts              # Firebase-initialisering + frivillig emulator
    │   └── auth.ts                # Anonym autentisering
    ├── types/game.ts              # Delte TypeScript-typer for rom, spillere og kort
    ├── data/mockRounds.ts         # Plassholder-runder og dynamisk kortgenerator
    ├── engine/
    │   ├── ranking.ts             # Stokking, romkode, rangering og fasit-evaluering
    │   ├── ranking.test.ts        # Vitest enhetstester for spillmotoren
    │   └── roomService.ts         # Firestore writeBatch / serverTimestamp-operasjoner
    ├── hooks/
    │   ├── useRoom.ts             # Sanntidsabonnement med Firestore onSnapshot
    │   └── useWakeLock.ts         # Screen Wake Lock API hook
    ├── styles/
    │   ├── tokens.css             # Fargepalett, typografi og design-tokens
    │   └── global.css             # Mobiloptimalisering (anti-zoom/markering) og layout
    ├── components/
    │   ├── WakeLockBadge.tsx      # Statusindikator for våken skjerm
    │   └── FirebaseSetupNotice.tsx# Veiledning hvis .env mangler
    └── views/
        ├── HomeView.tsx           # Startside (Host / Bli med via kode)
        ├── HostView.tsx           # Spillmester-visning med QR-kode og fasitoversikt
        └── PlayerView.tsx         # Mobil-visning for deltakere
```

---

## 1. Sett opp Firebase

1. Gå til [Firebase Console](https://console.firebase.google.com/) og opprett et nytt prosjekt.
2. **Aktiver Anonymous Authentication:**
   - Gå til **Build → Authentication → Sign-in method**.
   - Aktiver **Anonymous** og lagre.
3. **Opprett Firestore Database:**
   - Gå til **Build → Firestore Database → Create database**.
   - Velg region (f.eks. `europe-west1` / `eur3`) og start i produksjonsmodus.
4. **Legg inn sikkerhetsregler:**
   - Kopier innholdet i `firestore.rules` inn under **Firestore Database → Rules** og trykk **Publish** (eller rull ut med Firebase CLI: `firebase deploy --only firestore:rules`).
5. **Registrer en webapp og hent konfigurasjon:**
   - Gå til **Project Settings → General → Your apps → Add app (Web)**.
   - Kopier konfigurasjonsverdiene inn i en lokal `.env`-fil:

```bash
cp .env.example .env
```

Fyll inn `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID` og `VITE_FIREBASE_APP_ID`.

---

## 2. Lokal testing

### Installere avhengigheter og kjøre enhetstester

```bash
npm install
npm test
```

### Starte utviklingsserver

```bash
npm run dev
```

### Teste med ekte mobiler på samme Wi-Fi

Start Vite med `--host` slik at mobiler på samme nettverk kan skanne QR-koden fra PC-skjermen:

```bash
npm run dev -- --host
```

Åpne nettverksadressen (f.eks. `http://192.168.1.42:5173`) i nettleseren på PC-en som Host, opprett et rom, og skann QR-koden med to eller flere mobiler.

> **Tips:** Du kan også teste enkelt på én PC ved å åpne Host-visningen i én fane, og åpne lenken til rommet i 2–3 inkognitovinduer eller ulike nettleserprofiler (slik at hver spiller får sin egen anonyme Firebase-UID).

### (Valgfritt) Lokal testing med Firebase Emulator Suite

Hvis du vil teste lokalt uten å bruke en live Firebase-database:

1. Sett `VITE_USE_FIREBASE_EMULATOR=true` i `.env`.
2. Start emulatorene med Firebase CLI:
   ```bash
   npx firebase-tools emulators:start
   ```
3. Kjør `npm run dev` i en annen terminal.

---

## 3. Utrulling til GitHub Pages

Prosjektet er klargjort for automatisk publisering via GitHub Actions (`.github/workflows/deploy.yml`).

1. Push koden til et GitHub-repository (branch `main`).
2. Gå til **Settings → Pages** i GitHub-repoet og sett **Source** til **GitHub Actions**.
3. Gå til **Settings → Secrets and variables → Actions** og legg til følgende **Repository secrets**:
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_STORAGE_BUCKET`
   - `VITE_FIREBASE_MESSAGING_SENDER_ID`
   - `VITE_FIREBASE_APP_ID`
4. Push til `main` (eller kjør workflowen manuelt under **Actions → Deploy til GitHub Pages**).
5. Når bygget er ferdig er spillet live på `https://<brukernavn>.github.io/<repo-navn>/`.

> **Husk i Firebase Console:** Legg til `<brukernavn>.github.io` under **Authentication → Settings → Authorized domains** hvis det ikke allerede ligger der.

---

## 4. Legge til ekte innhold senere

Når arkitekturen og spillflyten er ferdig testet, bytter du enkelt ut plassholderne i `src/data/mockRounds.ts` med ekte oppgavesett, kategorier og eventuelle bilde-URL-er ved å utvide `AssignedCard`-typen i `src/types/game.ts`.
