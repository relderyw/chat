import { randomBytes } from "node:crypto";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
const username = process.argv[2]?.trim().toLowerCase();
const displayName = process.argv.slice(3).join(" ").trim() || username;

if (!projectId || !clientEmail || !privateKey || !username || !/^[a-z0-9][a-z0-9._-]{2,29}$/.test(username)) {
  console.error("Uso: npm run create-admin -- usuario_inicial [Nome para exibição]");
  process.exit(1);
}

const app = getApps()[0] ?? initializeApp({
  credential: cert({ projectId, clientEmail, privateKey }),
});
const auth = getAuth(app);
const db = getFirestore(app);
const usernameRef = db.collection("usernames").doc(username);
if ((await usernameRef.get()).exists) {
  console.error("Esse nome de usuário já está em uso.");
  process.exit(1);
}

const email = `${username}@${projectId}.example.com`;
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
      role: "admin",
      active: true,
      must_change_password: true,
      created_at: new Date(),
    });
  });
} catch (error) {
  if (user) {
    const reservation = await usernameRef.get().catch((cleanupError) => {
      console.error("Falha ao verificar a reserva do nome de usuário:", cleanupError);
      return null;
    });
    if (reservation?.get("uid") === user.uid) {
      await usernameRef.delete().catch((cleanupError) => {
        console.error("Falha ao remover a reserva do nome de usuário:", cleanupError);
      });
    }
    await db.collection("profiles").doc(user.uid).delete().catch((cleanupError) => {
      console.error("Falha ao remover o perfil do administrador:", cleanupError);
    });
    await auth.deleteUser(user.uid).catch((cleanupError) => {
      console.error("Falha ao remover a conta do administrador:", cleanupError);
    });
  }
  if (error instanceof Error && error.message === "USERNAME_TAKEN") {
    console.error("Esse nome de usuário já está em uso.");
    process.exit(1);
  }
  throw error;
}

console.log(`Conta administradora criada.\nUsuário: ${username}\nSenha temporária (copie agora): ${temporaryPassword}\nTroque a senha no primeiro acesso.`);
