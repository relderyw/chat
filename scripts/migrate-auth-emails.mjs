import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const rawKey = process.env.FIREBASE_PRIVATE_KEY;
const privateKey = rawKey?.trim().replace(/^["']|["']$/g, "").replace(/\\n/g, "\n");
const applyChanges = process.argv.includes("--apply");
const usernamePattern = /^[a-z0-9][a-z0-9._-]{2,29}$/;

if (!projectId || !clientEmail || !privateKey) {
  throw new Error("Configure FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL e FIREBASE_PRIVATE_KEY em .env.local.");
}
if (process.argv.slice(2).some((argument) => argument !== "--apply")) {
  throw new Error("Uso: npm run migrate-auth-emails [-- --apply]");
}

const app = getApps()[0] ?? initializeApp({
  credential: cert({ projectId, clientEmail, privateKey }),
});
const auth = getAuth(app);
const db = getFirestore(app);
const oldSuffix = `@${projectId}.invalid`;
const newSuffix = `@${projectId}.example.com`;

const users = [];
let pageToken;
do {
  const page = await auth.listUsers(1000, pageToken);
  users.push(...page.users);
  pageToken = page.pageToken;
} while (pageToken);

const userByEmail = new Map(
  users
    .filter((user) => user.email)
    .map((user) => [user.email.toLowerCase(), user.uid]),
);
const updates = [];
const problems = [];

for (const user of users) {
  const currentEmail = user.email?.toLowerCase();
  if (!currentEmail?.endsWith(oldSuffix) && !currentEmail?.endsWith(newSuffix)) continue;

  const suffix = currentEmail.endsWith(oldSuffix) ? oldSuffix : newSuffix;
  const username = currentEmail.slice(0, -suffix.length);
  if (!usernamePattern.test(username)) {
    problems.push(`A conta ${user.uid} tem um nome técnico incompatível.`);
    continue;
  }

  const profileRef = db.collection("profiles").doc(user.uid);
  const profile = await profileRef.get();
  if (!profile.exists || profile.get("username") !== username) {
    problems.push(`A conta @${username} (${user.uid}) não tem um perfil correspondente.`);
    continue;
  }

  const email = `${username}${newSuffix}`;
  const conflictingUid = userByEmail.get(email);
  if (conflictingUid && conflictingUid !== user.uid) {
    problems.push(`O endereço técnico de @${username} já está associado a outra conta.`);
    continue;
  }

  if (currentEmail !== email || profile.get("email") !== email) {
    updates.push({ uid: user.uid, username, email, currentEmail, profileRef, profileEmail: profile.get("email") });
  }
}

if (problems.length) {
  throw new Error(`Migração cancelada sem alterações:\n${problems.map((problem) => `- ${problem}`).join("\n")}`);
}

console.log(`Projeto Firebase: ${projectId}`);
console.log(`Modo: ${applyChanges ? "aplicar alterações" : "simulação (nenhuma alteração será feita)"}`);
if (!updates.length) {
  console.log("Nenhuma conta precisa ser atualizada.");
}

for (const update of updates) {
  console.log(`@${update.username}: ${update.currentEmail === update.email ? "atualizar perfil Firestore" : "atualizar Firebase Authentication e perfil Firestore"}`);
  if (!applyChanges) continue;

  if (update.currentEmail !== update.email) {
    await auth.updateUser(update.uid, { email: update.email });
  }
  if (update.profileEmail !== update.email) {
    await update.profileRef.update({ email: update.email });
  }
}

if (applyChanges) {
  console.log(`Migração concluída: ${updates.length} conta(s) atualizada(s). Senhas e UIDs foram preservados.`);
} else if (updates.length) {
  console.log("Para aplicar após conferir o projeto e a lista, execute novamente com -- --apply.");
}
