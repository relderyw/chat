import { randomBytes } from "node:crypto";
import type { ApiRequest, ApiResponse } from "../../server/types.js";
import { adminServices, authenticatedUser } from "../../server/firebase.js";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== "GET" && req.method !== "DELETE" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "Método não permitido." });
  }

  try {
    const actor = await authenticatedUser(req, res);
    if (!actor) return;
    if (actor.mustChangePassword) {
      return res.status(403).json({ error: "Defina sua senha antes de gerenciar contas." });
    }
    if (!actor.admin) return res.status(403).json({ error: "Apenas o administrador pode gerenciar contas." });

    const { auth, db } = adminServices();
    if (req.method === "GET") {
      const snapshot = await db.collection("profiles").orderBy("display_name").limit(200).get();
      return res.status(200).json({
        users: snapshot.docs.map((item) => ({
          id: item.id,
          username: item.get("username") ?? "",
          display_name: item.get("display_name") ?? "",
          role: item.get("role") ?? "member",
          active: item.get("active") !== false,
          must_change_password: item.get("must_change_password") === true,
        })),
      });
    }

    const body = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
    const userId = typeof body.userId === "string" ? body.userId : "";
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(userId)) {
      return res.status(400).json({ error: "Conta inválida." });
    }
    if (userId === actor.user.uid) {
      return res.status(400).json({ error: "Você não pode desativar sua própria conta." });
    }

    const profileRef = db.collection("profiles").doc(userId);
    const profile = await profileRef.get();
    if (!profile.exists) return res.status(404).json({ error: "Conta não encontrada." });
    if (profile.get("role") === "admin") {
      return res.status(400).json({ error: "Contas administradoras não podem ser gerenciadas por este painel." });
    }

    if (req.method === "POST") {
      if (profile.get("active") === false) {
        return res.status(400).json({ error: "Reative a conta antes de redefinir a senha." });
      }
      const username = profile.get("username") as string;
      const previousMustChangePassword = profile.get("must_change_password") === true;
      const temporaryPassword = randomBytes(18).toString("base64url");
      await profileRef.update({ must_change_password: true, password_reset_at: new Date() });
      try {
        await auth.updateUser(userId, { password: temporaryPassword });
      } catch (error) {
        await profileRef.update({ must_change_password: previousMustChangePassword }).catch((rollbackError) => {
          console.error("Falha ao restaurar perfil após erro na redefinição:", rollbackError);
        });
        throw error;
      }
      await auth.revokeRefreshTokens(userId).catch((error) => {
        console.error("Senha redefinida, mas não foi possível revogar tokens antigos:", error);
      });
      return res.status(200).json({
        message: `Senha temporária redefinida para @${username}. Compartilhe-a em particular.`,
        username,
        temporaryPassword,
      });
    }

    if (profile.get("active") === false) {
      return res.status(200).json({ message: "Esta conta já está desativada." });
    }

    await auth.updateUser(userId, { disabled: true });
    try {
      await profileRef.update({ active: false, disabled_at: new Date() });
    } catch (error) {
      await auth.updateUser(userId, { disabled: false }).catch((rollbackError) => {
        console.error("Falha ao reativar conta após erro ao desativar:", rollbackError);
      });
      throw error;
    }
    await auth.revokeRefreshTokens(userId).catch((error) => {
      console.error("Conta desativada, mas não foi possível revogar tokens antigos:", error);
    });
    return res.status(200).json({ message: "A conta foi desativada e o acesso ao chat foi removido." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível concluir a operação com a conta.";
    console.error("Falha ao gerenciar contas da equipe:", error);
    return res.status(500).json({ error: `Erro no servidor: ${message}` });
  }
}
