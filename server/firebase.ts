import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth, type DecodedIdToken } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import type { ApiRequest, ApiResponse } from "./types.ts";

function cleanPrivateKey(key?: string): string | undefined {
  if (!key) return undefined;
  let cleaned = key.trim();
  if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  return cleaned.replace(/\\n/g, "\n");
}

function firebaseAdminApp() {
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = cleanPrivateKey(process.env.FIREBASE_PRIVATE_KEY);
  if (!projectId || !clientEmail || !privateKey) {
    const missing: string[] = [];
    if (!projectId) missing.push("FIREBASE_PROJECT_ID (ou VITE_FIREBASE_PROJECT_ID)");
    if (!clientEmail) missing.push("FIREBASE_CLIENT_EMAIL");
    if (!privateKey) missing.push("FIREBASE_PRIVATE_KEY");
    throw new Error(`As credenciais administrativas do Firebase precisam estar configuradas. Faltando: ${missing.join(", ")}`);
  }
  return getApps()[0] ?? initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
  });
}

export function adminServices() {
  const app = firebaseAdminApp();
  return {
    auth: getAuth(app),
    db: getFirestore(app),
  };
}

export async function authenticatedUser(req: ApiRequest, res: ApiResponse) {
  const authorization = req.headers.authorization;
  const token = typeof authorization === "string" ? authorization.match(/^Bearer (.+)$/i)?.[1] : undefined;
  if (!token) {
    res.status(401).json({ error: "Autenticação necessária." });
    return null;
  }

  const { auth, db } = adminServices();
  let user: DecodedIdToken;
  try {
    user = await auth.verifyIdToken(token);
  } catch (error) {
    console.warn("Token de acesso Firebase inválido:", error instanceof Error ? error.message : "erro desconhecido");
    res.status(401).json({ error: "Sessão inválida ou expirada." });
    return null;
  }

  const profile = await db.collection("profiles").doc(user.uid).get();
  if (!profile.exists || profile.get("active") === false) {
    res.status(403).json({ error: "Usuário não autorizado para este chat." });
    return null;
  }
  return {
    user,
    admin: profile.get("role") === "admin",
    mustChangePassword: profile.get("must_change_password") === true,
  };
}

export function methodNotAllowed(res: ApiResponse, allowed = "POST"): void {
  res.setHeader("Allow", allowed);
  res.status(405).json({ error: "Método não permitido." });
}
