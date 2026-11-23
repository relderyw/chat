import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};

export const configError = Object.values(config).some((value) => !value);
const app = getApps().length ? getApp() : initializeApp({
  apiKey: config.apiKey || "placeholder",
  authDomain: config.authDomain || "placeholder.firebaseapp.com",
  projectId: config.projectId || "placeholder",
  appId: config.appId || "placeholder",
});

export const auth = getAuth(app);
export const db = getFirestore(app);
