import type { ApiRequest, ApiResponse } from "../server/types.ts";
import { authenticatedUser, methodNotAllowed, adminServices } from "../server/firebase.ts";

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method === "POST") {
    try {
      const actor = await authenticatedUser(req, res);
      if (!actor) return;
      if (actor.mustChangePassword) {
        return res.status(403).json({ error: "Defina sua senha antes de enviar imagens." });
      }

      const body = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
      const imageData = typeof body.imageData === "string" ? body.imageData : "";
      const messageBody = typeof body.body === "string" ? body.body.trim() : "";
      if (messageBody.length > 4000) {
        return res.status(400).json({ error: "A mensagem pode ter no máximo 4.000 caracteres." });
      }
      if (imageData.length > 900_000) {
        return res.status(400).json({ error: "A imagem comprimida excede o limite suportado pelo Firestore." });
      }

      const match = imageData.match(/^data:image\/(webp|jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/);
      if (!match) {
        return res.status(400).json({ error: "Imagem inválida. Envie JPEG, PNG ou WebP." });
      }

      const bytes = Buffer.from(match[2], "base64");
      if (bytes.byteLength === 0 || bytes.byteLength > 640 * 1024) {
        return res.status(400).json({ error: "A imagem comprimida excede o limite suportado pelo plano gratuito do Firestore." });
      }
      if (
        (match[1] === "jpeg" && !(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)) ||
        (match[1] === "png" && !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
        (match[1] === "webp" && (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP"))
      ) {
        return res.status(400).json({ error: "O conteúdo enviado não corresponde a um arquivo de imagem válido." });
      }
      const { db } = adminServices();
      const profile = await db.collection("profiles").doc(actor.user.uid).get();
      if (!profile.exists || profile.get("active") === false) {
        return res.status(403).json({ error: "Acesso ao chat não autorizado." });
      }

      const imageRef = db.collection("images").doc();
      const messageRef = db.collection("messages").doc();
      const batch = db.batch();
      batch.create(imageRef, {
        sender_id: actor.user.uid,
        content_type: `image/${match[1]}`,
        image_data: imageData,
        created_at: new Date(),
      });
      batch.create(messageRef, {
        sender_id: actor.user.uid,
        sender_name: profile.get("display_name") || profile.get("username"),
        body: messageBody,
        image_id: imageRef.id,
        created_at: new Date(),
      });
      await batch.commit();
      return res.status(200).json({ messageId: messageRef.id });
    } catch (error) {
      console.error("Falha ao salvar imagem no Firestore:", error);
      return res.status(500).json({ error: "Não foi possível enviar a imagem." });
    }
  }

  if (req.method !== "GET") return methodNotAllowed(res, "GET, POST");

  try {
    const actor = await authenticatedUser(req, res);
    if (!actor) return;
    if (actor.mustChangePassword) {
      return res.status(403).json({ error: "Defina sua senha antes de ver imagens." });
    }

    const imageId = typeof req.query.id === "string" ? req.query.id : "";
    if (!/^[A-Za-z0-9_-]{20,128}$/.test(imageId)) {
      return res.status(400).json({ error: "Identificador da imagem inválido." });
    }

    const isDownload = req.query.download === "1";
    if (isDownload && !actor.admin) {
      return res.status(403).json({ error: "Somente o administrador pode baixar imagens." });
    }

    const { db } = adminServices();
    const image = await db.collection("images").doc(imageId).get();
    if (!image.exists) return res.status(404).json({ error: "Imagem não encontrada." });

    const imageData = image.get("image_data");
    const contentType = image.get("content_type");
    const match = typeof imageData === "string"
      ? imageData.match(/^data:image\/(webp|jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/)
      : null;
    if (!match || contentType !== `image/${match[1]}`) {
      console.error("Registro de imagem inválido no Firestore:", imageId);
      return res.status(500).json({ error: "O arquivo de imagem está inválido." });
    }

    const bytes = Buffer.from(match[2], "base64");
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", bytes.byteLength);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", isDownload ? 'attachment; filename="imagem-da-equipe"' : "inline");
    return res.status(200).send(bytes);
  } catch (error) {
    console.error("Falha ao carregar imagem:", error);
    return res.status(500).json({ error: "Não foi possível carregar a imagem." });
  }
}
