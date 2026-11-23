import type { ApiRequest, ApiResponse } from "../../server/types";
import { authenticatedUser, methodNotAllowed, adminServices } from "../../server/firebase";
import { normalizeUsername, USERNAME_PATTERN, usernameToAuthEmail } from "../../shared/identity";
import { randomBytes } from "node:crypto";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "POST") return methodNotAllowed(res);

  try {
    const actor = await authenticatedUser(req, res);
    if (!actor) return;
    if (actor.mustChangePassword) {
      return res.status(403).json({ error: "Defina sua senha antes de usar o painel." });
    }
    if (!actor.admin) return res.status(403).json({ error: "Apenas o administrador pode convidar membros." });

    const body = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
    const username = typeof body.username === "string" ? normalizeUsername(body.username) : "";
    const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
    if (!USERNAME_PATTERN.test(username)) {
      return res.status(400).json({ error: "O usuário deve ter de 3 a 30 caracteres: letras minúsculas, números, ponto, hífen ou sublinhado." });
    }
    if (displayName.length > 80) {
      return res.status(400).json({ error: "O nome pode ter no máximo 80 caracteres." });
    }

    const { auth, db } = adminServices();
    const projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID;
    if (!projectId) throw new Error("FIREBASE_PROJECT_ID precisa estar configurada.");
    const email = usernameToAuthEmail(username, projectId);
    const usernameRef = db.collection("usernames").doc(username);
    if ((await usernameRef.get()).exists) {
      return res.status(409).json({ error: "Esse nome de usuário já está em uso." });
    }

    const temporaryPassword = randomBytes(18).toString("base64url");
    const name = displayName || username;
    const user = await auth.createUser({
      email,
      password: temporaryPassword,
      displayName: name,
      emailVerified: true,
    });
    try {
      await db.runTransaction(async (transaction) => {
        const existingUsername = await transaction.get(usernameRef);
        if (existingUsername.exists) {
          throw new Error("USERNAME_TAKEN");
        }
        transaction.create(usernameRef, { uid: user.uid });
        transaction.create(db.collection("profiles").doc(user.uid), {
          username,
          email,
          display_name: name,
          role: "member",
          active: true,
          must_change_password: true,
          created_at: new Date(),
        });
      });
      return res.status(200).json({
        message: `Conta criada para ${username}. Copie a senha temporária e entregue ao membro.`,
        username,
        temporaryPassword,
      });
    } catch (error) {
      const usernameReservation = await usernameRef.get().catch((cleanupError) => {
        console.error("Falha ao verificar a reserva do nome de usuário:", cleanupError);
        return null;
      });
      if (usernameReservation?.get("uid") === user.uid) {
        await usernameRef.delete().catch((cleanupError) => {
          console.error("Falha ao remover o nome de usuário após erro na criação:", cleanupError);
        });
      }
      await db.collection("profiles").doc(user.uid).delete().catch((cleanupError) => {
        console.error("Falha ao remover o perfil após erro na criação:", cleanupError);
      });
      await auth.deleteUser(user.uid).catch((cleanupError) => {
        console.error("Falha ao remover usuário após erro na criação:", cleanupError);
      });
      throw error;
    }
  } catch (error) {
    if (error instanceof Error && error.message === "USERNAME_TAKEN") {
      return res.status(409).json({ error: "Esse nome de usuário já está em uso." });
    }
    if (typeof error === "object" && error !== null && "code" in error && error.code === "auth/email-already-exists") {
      return res.status(409).json({ error: "Esse nome de usuário já está em uso." });
    }
    console.error("Falha ao convidar membro:", error);
    return res.status(500).json({ error: "Não foi possível criar a conta." });
  }
}
