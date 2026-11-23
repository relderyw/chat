import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { randomBytes } from "node:crypto";

const projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const rawKey = process.env.FIREBASE_PRIVATE_KEY;
const privateKey = rawKey?.trim().replace(/^["']|["']$/g, "").replace(/\\n/g, "\n");

const username = process.argv[2]?.trim().toLowerCase();
const desiredPassword = process.argv[3]?.trim();

if (!projectId || !clientEmail || !privateKey || !username) {
  console.error("Uso: npm run reset-password -- <nome_de_usuario> [nova_senha_opcional]");
  process.exit(1);
}

const app = getApps()[0] ?? initializeApp({
  credential: cert({ projectId, clientEmail, privateKey }),
});
const auth = getAuth(app);
const db = getFirestore(app);

const usernameDoc = await db.collection("usernames").doc(username).get();
if (!usernameDoc.exists) {
  console.error(`Usuário @${username} não encontrado.`);
  process.exit(1);
}

const uid = usernameDoc.get("uid");
const profileRef = db.collection("profiles").doc(uid);
const profileDoc = await profileRef.get();

if (!profileDoc.exists) {
  console.error(`Perfil do usuário @${username} não encontrado.`);
  process.exit(1);
}

const newPassword = desiredPassword && desiredPassword.length >= 8 
  ? desiredPassword 
  : randomBytes(18).toString("base64url");

const mustChange = !desiredPassword || desiredPassword.length < 8;

await auth.updateUser(uid, {
  password: newPassword,
  disabled: false,
});

await profileRef.update({
  must_change_password: mustChange,
  password_reset_at: new Date(),
});

await auth.revokeRefreshTokens(uid).catch(() => {});

console.log("\n=========================================");
console.log(`Senha redefinida com sucesso para: @${username}`);
console.log(`Nova senha: ${newPassword}`);
if (mustChange) {
  console.log("Status: Senha temporária gerada (o sistema pedirá troca no login).");
} else {
  console.log("Status: Senha definitiva aplicada (login direto liberado).");
}
console.log("=========================================\n");
