import { initializeApp } from 'firebase/app';
import { getAnalytics } from 'firebase/analytics';

// Prefer environment variables when available (Vite: VITE_*)
// Fall back to the legacy global if a static config script is present
const legacyConfig = typeof window !== 'undefined' ? window.__FIREBASE_CONFIG__ : undefined;

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || legacyConfig?.apiKey,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || legacyConfig?.authDomain,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || legacyConfig?.projectId,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || legacyConfig?.storageBucket,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || legacyConfig?.messagingSenderId,
  appId: import.meta.env.VITE_FIREBASE_APP_ID || legacyConfig?.appId,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || legacyConfig?.measurementId
};

export const firebaseApp = initializeApp(firebaseConfig);
export const firebaseAnalytics = typeof window !== 'undefined' && firebaseConfig?.measurementId ? getAnalytics(firebaseApp) : undefined;







