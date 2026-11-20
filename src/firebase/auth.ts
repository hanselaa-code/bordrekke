import { onAuthStateChanged, signInAnonymously, type Auth, type User } from 'firebase/auth';
import { getLocalAnonymousUid } from '../engine/p2pBackend';
import { auth, isFirebaseConfigured, requireAuth } from './config';

let inFlightAnonymousAuth: Promise<User> | null = null;

function waitForInitialAuthState(authInstance: Auth): Promise<User | null> {
  return new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(
      authInstance,
      (user) => {
        unsubscribe();
        resolve(user);
      },
      (error) => {
        unsubscribe();
        reject(error);
      },
    );
  });
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

    const credential = await signInAnonymously(authInstance);
    return credential.user;
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
