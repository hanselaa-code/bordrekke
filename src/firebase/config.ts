import { getApp, getApps, initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';

const REQUIRED_FIREBASE_ENV_KEYS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
] as const;

type RequiredFirebaseEnvKey = (typeof REQUIRED_FIREBASE_ENV_KEYS)[number];

const EMULATOR_DEMO_FALLBACK: Record<RequiredFirebaseEnvKey, string> = {
  VITE_FIREBASE_API_KEY: 'demo-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'demo-partyspill.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'demo-partyspill',
  VITE_FIREBASE_STORAGE_BUCKET: 'demo-partyspill.appspot.com',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '000000000000',
  VITE_FIREBASE_APP_ID: '1:000000000000:web:demo000000000000',
};

function readEnv(key: string): string {
  const value = import.meta.env[key];
  return typeof value === 'string' ? value.trim() : '';
}

const useFirebaseEmulator = readEnv('VITE_USE_FIREBASE_EMULATOR').toLowerCase() === 'true';

export const missingFirebaseEnvKeys: string[] = useFirebaseEmulator
  ? []
  : REQUIRED_FIREBASE_ENV_KEYS.filter((key) => readEnv(key).length === 0);

export const isFirebaseConfigured: boolean = useFirebaseEmulator || missingFirebaseEnvKeys.length === 0;

function resolveEnvValue(key: RequiredFirebaseEnvKey): string {
  const raw = readEnv(key);
  if (raw.length > 0) {
    return raw;
  }
  return useFirebaseEmulator ? EMULATOR_DEMO_FALLBACK[key] : '';
}

const EMULATOR_CONNECTED_FLAG = '__partyspillFirebaseEmulatorsConnected__';

interface GlobalWithEmulatorFlag {
  [EMULATOR_CONNECTED_FLAG]?: boolean;
}

function connectEmulatorsOnce(firestoreInstance: Firestore, authInstance: Auth): void {
  const globalStore = globalThis as unknown as GlobalWithEmulatorFlag;
  if (globalStore[EMULATOR_CONNECTED_FLAG]) {
    return;
  }

  const firestoreHost = readEnv('VITE_FIREBASE_FIRESTORE_EMULATOR_HOST') || '127.0.0.1';
  const parsedPort = Number.parseInt(readEnv('VITE_FIREBASE_FIRESTORE_EMULATOR_PORT') || '8080', 10);
  const firestorePort = Number.isFinite(parsedPort) ? parsedPort : 8080;
  const authUrl = readEnv('VITE_FIREBASE_AUTH_EMULATOR_URL') || 'http://127.0.0.1:9099';

  connectFirestoreEmulator(firestoreInstance, firestoreHost, firestorePort);
  connectAuthEmulator(authInstance, authUrl, { disableWarnings: true });
  globalStore[EMULATOR_CONNECTED_FLAG] = true;
}

let appInstance: FirebaseApp | null = null;
let dbInstance: Firestore | null = null;
let authInstance: Auth | null = null;

if (isFirebaseConfigured) {
  const firebaseOptions: FirebaseOptions = {
    apiKey: resolveEnvValue('VITE_FIREBASE_API_KEY'),
    authDomain: resolveEnvValue('VITE_FIREBASE_AUTH_DOMAIN'),
    projectId: resolveEnvValue('VITE_FIREBASE_PROJECT_ID'),
    storageBucket: resolveEnvValue('VITE_FIREBASE_STORAGE_BUCKET'),
    messagingSenderId: resolveEnvValue('VITE_FIREBASE_MESSAGING_SENDER_ID'),
    appId: resolveEnvValue('VITE_FIREBASE_APP_ID'),
  };

  appInstance = getApps().length > 0 ? getApp() : initializeApp(firebaseOptions);
  dbInstance = getFirestore(appInstance);
  authInstance = getAuth(appInstance);

  if (useFirebaseEmulator) {
    connectEmulatorsOnce(dbInstance, authInstance);
  }
}

export const app: FirebaseApp | null = appInstance;
export const db: Firestore | null = dbInstance;
export const auth: Auth | null = authInstance;

function formatMissingConfigMessage(): string {
  const missingList =
    missingFirebaseEnvKeys.length > 0
      ? ` Manglende nøkler: ${missingFirebaseEnvKeys.join(', ')}.`
      : '';
  return `Firebase er ikke konfigurert.${missingList} Opprett en .env-fil basert på .env.example eller aktiver lokal emulator med VITE_USE_FIREBASE_EMULATOR=true.`;
}

/**
 * Returnerer Firestore-instansen eller kaster en tydelig norsk feilmelding hvis Firebase ikke er konfigurert.
 */
export function requireFirestore(): Firestore {
  if (!db) {
    throw new Error(formatMissingConfigMessage());
  }
  return db;
}

/**
 * Returnerer Firebase Auth-instansen eller kaster en tydelig norsk feilmelding hvis Firebase ikke er konfigurert.
 */
export function requireAuth(): Auth {
  if (!auth) {
    throw new Error(formatMissingConfigMessage());
  }
  return auth;
}
