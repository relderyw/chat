import { randomBytes } from "node:crypto";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const rawKey = process.env.FIREBASE_PRIVATE_KEY;
const privateKey = rawKey?.trim().replace(/^["']|["']$/g, "").replace(/\\n/g, "\n");
const username = process.argv[2]?.trim().toLowerCase();
const displayName = process.argv.slice(3).join(" ").trim() || username;

if (!projectId || !clientEmail || !privateKey || !username || !/^[a-z0-9][a-z0-9._-]{2,29}$/.test(username)) {
  console.error("Uso: npm run create-user -- <nome_de_usuario> [Nome para exibição]");
  process.exit(1);
}

const app = getApps()[0] ?? initializeApp({
  credential: cert({ projectId, clientEmail, privateKey }),
});
const auth = getAuth(app);
const db = getFirestore(app);
const usernameRef = db.collection("usernames").doc(username);
if ((await usernameRef.get()).exists) {
  console.error(`O usuário @${username} já existe.`);
  process.exit(1);
}

const email = `${username}@${projectId}.invalid`;
const temporaryPassword = randomBytes(18).toString("base64url");
let user;
try {
  user = await auth.createUser({
    email,
    password: temporaryPassword,
    displayName,
    emailVerified: true,
  });
  await db.runTransaction(async (transaction) => {
    const reservation = await transaction.get(usernameRef);
    if (reservation.exists) throw new Error("USERNAME_TAKEN");
    transaction.create(usernameRef, { uid: user.uid });
    transaction.create(db.collection("profiles").doc(user.uid), {
      username,
      email,
      display_name: displayName,
      role: "member",
      active: true,
      must_change_password: true,
      created_at: new Date(),
    });
  });
  console.log("\n=========================================");
  console.log(`Conta de membro criada com sucesso!`);
  console.log(`Usuário: ${username}`);
  console.log(`Nome: ${displayName}`);
  console.log(`Senha temporária: ${temporaryPassword}`);
  console.log("=========================================\n");
} catch (error) {
  if (user) {
    await usernameRef.delete().catch(() => {});
    await db.collection("profiles").doc(user.uid).delete().catch(() => {});
    await auth.deleteUser(user.uid).catch(() => {});
  }
  console.error("Erro ao criar conta:", error);
  process.exit(1);
}
