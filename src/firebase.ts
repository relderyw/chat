import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore, initializeFirestore } from "firebase/firestore";

function cleanConfigValue(val: unknown): string | undefined {
  if (typeof val !== "string") return undefined;
  const trimmed = val.trim();
  return trimmed.replace(/^\\n/, "").replace(/\\n$/, "").trim();
}

const config = {
  apiKey: cleanConfigValue(import.meta.env.VITE_FIREBASE_API_KEY),
  authDomain: cleanConfigValue(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN),
  projectId: cleanConfigValue(import.meta.env.VITE_FIREBASE_PROJECT_ID),
  appId: cleanConfigValue(import.meta.env.VITE_FIREBASE_APP_ID),
};

export const configError = Object.values(config).some((value) => !value);
const app = getApps().length ? getApp() : initializeApp({
  apiKey: config.apiKey || "placeholder",
  authDomain: config.authDomain || "placeholder.firebaseapp.com",
  projectId: config.projectId || "placeholder",
  appId: config.appId || "placeholder",
});

export const auth = getAuth(app);

let firestoreInstance;
try {
  firestoreInstance = initializeFirestore(app, {
    experimentalAutoDetectLongPolling: true,
  });
} catch {
  firestoreInstance = getFirestore(app);
}

export const db = firestoreInstance;
