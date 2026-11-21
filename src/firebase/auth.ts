import { onAuthStateChanged, signInAnonymously, type Auth, type User } from 'firebase/auth';
import { getLocalAnonymousUid } from '../engine/p2pBackend';
import { auth, isFirebaseConfigured, requireAuth } from './config';

let inFlightAnonymousAuth: Promise<User> | null = null;
const DEVICE_ID_STORAGE_KEY = 'bordrekke:deviceId';
let fallbackMemoryDeviceId: string | null = null;

function generateDeviceId(): string {
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Returnerer en stabil enhets-ID per nettleser/telefon slik at samme telefon
 * ikke registreres dobbelt dersom QR-koden skannes på nytt.
 */
export function getStableDeviceId(): string {
  if (typeof window !== 'undefined') {
    try {
      const existing = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY);
      if (existing && existing.trim().length > 0) {
        return existing.trim();
      }
      const created = generateDeviceId();
      window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, created);
      return created;
    } catch {
      // Privat modus / blokkert localStorage – prøv sessionStorage
    }
    try {
      const existing = window.sessionStorage.getItem(DEVICE_ID_STORAGE_KEY);
      if (existing && existing.trim().length > 0) {
        return existing.trim();
      }
      const created = generateDeviceId();
      window.sessionStorage.setItem(DEVICE_ID_STORAGE_KEY, created);
      return created;
    } catch {
      // Ignorer
    }
  }
  if (!fallbackMemoryDeviceId) {
    fallbackMemoryDeviceId = generateDeviceId();
  }
  return fallbackMemoryDeviceId;
}

function waitForInitialAuthState(authInstance: Auth, timeoutMs = 4000): Promise<User | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (user: User | null) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timer);
      unsubscribe();
      resolve(user);
    };

    const timer = globalThis.setTimeout(() => {
      finish(authInstance.currentUser ?? null);
    }, timeoutMs);

    const unsubscribe = onAuthStateChanged(
      authInstance,
      (user) => finish(user),
      () => finish(authInstance.currentUser ?? null),
    );
  });
}

async function signInAnonymouslyWithRetry(authInstance: Auth, maxAttempts = 3): Promise<User> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const credential = await signInAnonymously(authInstance);
      return credential.user;
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        await new Promise((r) => globalThis.setTimeout(r, attempt * 600));
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('Kunne ikke opprette anonym spilløkt. Sjekk nettverket og prøv igjen.');
}

/**
 * Sikrer at klienten har en aktiv anonym bruker.
 * Bruker Firebase Anonymous Auth når Firebase er konfigurert, ellers stabil lokal sesjons-ID for P2P-modus.
 */
export async function ensureAnonymousUser(): Promise<User> {
  if (!isFirebaseConfigured) {
    return { uid: getLocalAnonymousUid(), isAnonymous: true } as User;
  }

  const authInstance = requireAuth();

  if (authInstance.currentUser) {
    return authInstance.currentUser;
  }

  if (inFlightAnonymousAuth) {
    return inFlightAnonymousAuth;
  }

  inFlightAnonymousAuth = (async () => {
    const existingUser = await waitForInitialAuthState(authInstance);
    if (existingUser) {
      return existingUser;
    }

    return signInAnonymouslyWithRetry(authInstance);
  })();

  try {
    return await inFlightAnonymousAuth;
  } finally {
    inFlightAnonymousAuth = null;
  }
}

/**
 * Abonnerer på endringer i Firebase-autentiseringsstatus.
 * Hvis Firebase ikke er konfigurert, kalles callback med null og en tom avmeldingsfunksjon returneres.
 */
export function subscribeAuthState(callback: (user: User | null) => void): () => void {
  if (!auth) {
    callback(null);
    return () => {};
  }

  return onAuthStateChanged(auth, callback);
}
