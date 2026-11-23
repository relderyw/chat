import type { ApiRequest, ApiResponse } from "../../server/types.js";
import { adminServices, authenticatedUser, methodNotAllowed } from "../../server/firebase.js";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "POST") return methodNotAllowed(res);

  try {
    const actor = await authenticatedUser(req, res);
    if (!actor) return;

    const body = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
    const password = typeof body.password === "string" ? body.password : "";
    if (password.length < 8 || password.length > 128) {
      return res.status(400).json({ error: "A senha deve ter entre 8 e 128 caracteres." });
    }

    const { auth, db } = adminServices();
    await auth.updateUser(actor.user.uid, { password });
    await db.collection("profiles").doc(actor.user.uid).update({
      must_change_password: false,
      password_changed_at: new Date(),
    });
    return res.status(200).json({ message: "Senha atualizada. Bem-vindo ao chat." });
  } catch (error) {
    console.error("Falha ao atualizar a senha:", error);
    return res.status(500).json({ error: "Não foi possível atualizar a senha." });
  }
}
