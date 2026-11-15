import { initializeApp } from 'firebase/app'
import { browserLocalPersistence, connectAuthEmulator, getAuth, setPersistence } from 'firebase/auth'
import { initializeFirestore } from './localstore'

const env = import.meta.env
/** No keys configured → run against the local emulators so the app works out of the box. */
export const usingEmulators = env.VITE_USE_EMULATORS === 'true' || !env.VITE_FIREBASE_API_KEY

const app = initializeApp(
  usingEmulators
    ? { apiKey: 'demo-key', authDomain: window.location.host, projectId: 'demo-tripzy', appId: 'demo-app' }
    : {
        apiKey: env.VITE_FIREBASE_API_KEY,
        authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
        projectId: env.VITE_FIREBASE_PROJECT_ID,
        appId: env.VITE_FIREBASE_APP_ID,
      },
)

export const auth = getAuth(app)
void setPersistence(auth, browserLocalPersistence)

/** Tripzy keeps data in this browser (see localstore.ts); no cloud database needed. */
export const db = initializeFirestore()

if (usingEmulators) {
  const host = window.location.hostname === 'localhost' ? '127.0.0.1' : window.location.hostname
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true })
}
