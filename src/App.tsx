import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  AlertCircle, Check, ImagePlus, LockKeyhole, LogOut, MessageCircle, Send,
  ShieldCheck, UserPlus, Users, X,
} from "lucide-react";
import {
  onAuthStateChanged, signInWithEmailAndPassword, signOut, type User,
} from "firebase/auth";
import {
  addDoc, collection, doc, getDoc, limit, onSnapshot, orderBy, query,
  serverTimestamp, Timestamp,
} from "firebase/firestore";
import { auth, configError, db } from "./firebase";
import { normalizeUsername, USERNAME_PATTERN, usernameToAuthEmail } from "../shared/identity";

type Profile = {
  id: string;
  username: string;
  display_name: string;
  role: "admin" | "member";
  active?: boolean;
  must_change_password?: boolean;
};

type ChatMessage = {
  id: string;
  sender_id: string;
  sender_name: string;
  body: string;
  image_id: string | null;
  created_at: Date;
};

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_COMPRESSED_IMAGE_SIZE = 480 * 1024;

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0] ?? "").join("").toUpperCase() || "?";
}

function displayTime(value: Date) {
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(value);
}

function formatDay(value: Date) {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (value.toDateString() === today.toDateString()) return "Hoje";
  if (value.toDateString() === yesterday.toDateString()) return "Ontem";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "long", year: "numeric" }).format(value);
}

async function compressImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const maxDimension = 1280;
  let scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));

  try {
    while (scale >= 0.25) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Seu navegador não conseguiu preparar a imagem.");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

      for (const quality of [0.78, 0.68, 0.58, 0.48]) {
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", quality));
        if (blob?.type === "image/webp" && blob.size <= MAX_COMPRESSED_IMAGE_SIZE) {
          return await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Não foi possível ler a imagem comprimida."));
            reader.onerror = () => reject(new Error("Não foi possível preparar a imagem."));
            reader.readAsDataURL(blob);
          });
        }
      }

      scale *= 0.8;
    }
  } finally {
    bitmap.close();
  }

  throw new Error("A imagem ficou grande demais mesmo após a compressão. Escolha uma imagem menor.");
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [members, setMembers] = useState<Profile[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [authUsername, setAuthUsername] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [inviteUsername, setInviteUsername] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [temporaryCredentials, setTemporaryCredentials] = useState<{ username: string; password: string } | null>(null);
  const [adminUsers, setAdminUsers] = useState<Profile[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => onAuthStateChanged(auth, async (currentUser) => {
    setUser(currentUser);
    if (!currentUser) {
      setProfile(null);
      setMembers([]);
      setMessages([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const profileSnapshot = await getDoc(doc(db, "profiles", currentUser.uid));
      if (!profileSnapshot.exists() || profileSnapshot.data().active === false) {
        await signOut(auth);
        setError("Esta conta ainda não foi convidada para o chat.");
        return;
      }
      setProfile({ id: currentUser.uid, ...profileSnapshot.data() } as Profile);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar o perfil.");
    } finally {
      setLoading(false);
    }
  }), []);

  useEffect(() => {
    if (!user || !profile) return;
    const unsubscribeMessages = onSnapshot(
      query(collection(db, "messages"), orderBy("created_at", "desc"), limit(300)),
      (snapshot) => {
        setMessages(snapshot.docs.map((item) => {
          const data = item.data();
          return {
            id: item.id,
            sender_id: data.sender_id as string,
            sender_name: data.sender_name as string,
            body: data.body as string,
            image_id: (data.image_id as string | null) ?? null,
            created_at: (data.created_at as Timestamp | undefined)?.toDate() ?? new Date(),
          };
        }).reverse());
      },
      (snapshotError) => setError(snapshotError.message),
    );
    const unsubscribeMembers = onSnapshot(
      query(collection(db, "profiles"), orderBy("display_name")),
      (snapshot) => setMembers(snapshot.docs
        .map((item) => ({ id: item.id, ...item.data() } as Profile))
        .filter((member) => member.active !== false)),
      (snapshotError) => setError(snapshotError.message),
    );
    return () => {
      unsubscribeMessages();
      unsubscribeMembers();
    };
  }, [user, profile]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function handleLogin(event: FormEvent) {
    event.preventDefault();
    const username = normalizeUsername(authUsername);
    if (!USERNAME_PATTERN.test(username)) {
      setError("Informe um usuário de 3 a 30 caracteres: letras, números, ponto, hífen ou sublinhado.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID as string;
      await signInWithEmailAndPassword(auth, usernameToAuthEmail(username, projectId), authPassword);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Não foi possível entrar.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSetPassword(event: FormEvent) {
    event.preventDefault();
    if (authPassword.length < 8) {
      setError("A senha deve ter pelo menos 8 caracteres.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (!user) throw new Error("Sua sessão expirou. Entre novamente com a senha temporária.");
      const response = await fetch("/api/account/password", {
        method: "POST",
        headers: { Authorization: `Bearer ${await user.getIdToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ password: authPassword }),
      });
      const responseBody = await response.text();
      let result: { error?: string; message?: string } = {};
      if (responseBody) {
        try {
          const parsed: unknown = JSON.parse(responseBody);
          if (typeof parsed === "object" && parsed !== null) {
            result = {
              error: "error" in parsed && typeof parsed.error === "string" ? parsed.error : undefined,
              message: "message" in parsed && typeof parsed.message === "string" ? parsed.message : undefined,
            };
          }
        } catch {
          if (!response.ok) {
            throw new Error(`O servidor não conseguiu salvar a senha (HTTP ${response.status}). Confira as variáveis Firebase no servidor e os logs da função /api/account/password na Vercel.`);
          }
          throw new Error(`A rota de troca de senha não retornou JSON válido (HTTP ${response.status}). Confira se api/account/password.ts foi implantado como função na Vercel e consulte os logs dessa função.`);
        }
      }
      if (!response.ok) {
        throw new Error(result.error || `Não foi possível salvar a senha (HTTP ${response.status}). Confira os logs da função /api/account/password na Vercel.`);
      }
      if (!result.message) throw new Error("O servidor não confirmou a alteração da senha. Tente novamente.");
      setProfile((current) => current ? { ...current, must_change_password: false } : current);
      setAuthPassword("");
      setNotice(result.message);
    } catch (resetError) {
      const message = resetError instanceof Error ? resetError.message : "";
      setError(resetError instanceof TypeError && /fetch/i.test(message)
        ? "Não foi possível conectar à API. Para testar localmente, inicie `vercel dev` e mantenha o terminal aberto; `npm run dev` sozinho não executa as rotas /api. No site publicado, confirme se as funções da Vercel foram implantadas."
        : message || "Não foi possível definir a senha.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSend(event: FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || !profile || busy) return;
    setBusy(true);
    setError("");
    try {
      await addDoc(collection(db, "messages"), {
        sender_id: profile.id,
        sender_name: profile.display_name || profile.username,
        body,
        image_id: null,
        created_at: serverTimestamp(),
      });
      setDraft("");
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Não foi possível enviar a mensagem.");
    } finally {
      setBusy(false);
    }
  }

  async function handleImage(file?: File) {
    if (!file || !profile || !user) return;
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setError("Formato não aceito. Envie JPEG, PNG ou WebP. GIFs animados não são suportados.");
      return;
    }
    if (file.size > MAX_IMAGE_SIZE) {
      setError("A imagem deve ter no máximo 5 MB.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const imageData = await compressImage(file);
      const response = await fetch("/api/image", {
        method: "POST",
        headers: { Authorization: `Bearer ${await user.getIdToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ imageData, body: draft.trim() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Não foi possível enviar a imagem.");
      setDraft("");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Não foi possível enviar a imagem.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleInvite(event: FormEvent) {
    event.preventDefault();
    if (!user) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/invite", {
        method: "POST",
        headers: { Authorization: `Bearer ${await user.getIdToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ username: inviteUsername, displayName: inviteName }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Não foi possível convidar esse membro.");
      setNotice(result.message);
      setTemporaryCredentials({ username: result.username, password: result.temporaryPassword });
      setInviteUsername("");
      setInviteName("");
      await loadAdminUsers();
    } catch (inviteError) {
      setError(inviteError instanceof Error ? inviteError.message : "Não foi possível criar o convite.");
    } finally {
      setBusy(false);
    }

  }

  async function loadAdminUsers() {
    if (!user) return;
    const response = await fetch("/api/admin/users", {
      headers: { Authorization: `Bearer ${await user.getIdToken()}` },
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Não foi possível carregar as contas.");
    setAdminUsers(result.users as Profile[]);
  }

  async function handleDeactivate(userId: string) {
    if (!user || !window.confirm("Desativar esta conta e remover o acesso ao chat?")) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/users", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${await user.getIdToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Não foi possível desativar a conta.");
      setNotice(result.message);
      await loadAdminUsers();
    } catch (deactivateError) {
      setError(deactivateError instanceof Error ? deactivateError.message : "Não foi possível desativar a conta.");
    } finally {
      setBusy(false);
    }
  }

  async function handleResetPassword(managedUser: Profile) {
    if (!user || !window.confirm(`Gerar uma nova senha temporária para @${managedUser.username}?`)) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { Authorization: `Bearer ${await user.getIdToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ userId: managedUser.id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Não foi possível redefinir a senha.");
      setTemporaryCredentials({ username: result.username, password: result.temporaryPassword });
      setNotice(result.message);
      await loadAdminUsers();
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "Não foi possível redefinir a senha.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDownload(imageId: string) {
    if (!user) return;
    setError("");
    try {
      const response = await fetch(`/api/image?id=${encodeURIComponent(imageId)}&download=1`, {
        headers: { Authorization: `Bearer ${await user.getIdToken()}` },
      });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || "Não foi possível baixar a imagem.");
      }
      const objectUrl = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `${imageId}.webp`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "Não foi possível baixar a imagem.");
    }
  }

  async function handleSignOut() {
    try {
      await signOut(auth);
    } catch (signOutError) {
      setError(signOutError instanceof Error ? signOutError.message : "Não foi possível sair.");
    }
  }

  if (configError) {
    return (
      <main className="setup-screen">
        <div className="setup-card">
          <div className="brand-mark"><MessageCircle size={25} /></div>
          <p className="eyebrow">CONFIGURAÇÃO INICIAL</p>
          <h1>Conecte seu projeto Firebase</h1>
          <p>Crie um arquivo <code>.env.local</code> a partir do <code>.env.example</code>, preencha as configurações públicas do Firebase e reinicie o servidor.</p>
          <div className="setup-note"><LockKeyhole size={18} /> As credenciais administrativas ficam somente no servidor.</div>
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="auth-screen">
        <section className="auth-card">
          <div className="brand-mark"><MessageCircle size={25} /></div>
          <p className="eyebrow">ESPAÇO PRIVADO DA EQUIPE</p>
          <h1>Entre na conversa.</h1>
          <p className="auth-description">Entre com o nome de usuário e a senha criados pelo administrador. Não é necessário usar ou informar e-mail.</p>
          <form onSubmit={handleLogin} className="auth-form">
            <label>Nome de usuário
              <input autoComplete="username" value={authUsername} onChange={(event) => setAuthUsername(event.target.value)} placeholder="reldery_assuncao" maxLength={30} required />
            </label>
            <label>Senha
              <input type="password" autoComplete="current-password" value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} placeholder="Sua senha" required />
            </label>
            {error && <p className="form-error"><AlertCircle size={16} />{error}</p>}
            <button className="primary-button auth-submit" disabled={busy}>{busy ? "Aguarde..." : "Entrar"} <Send size={16} /></button>
          </form>
          <p className="auth-footnote"><LockKeyhole size={14} /> As contas são criadas pelo administrador do chat.</p>
        </section>
      </main>
    );
  }

  if (loading || !profile) {
    return <main className="loading-screen"><div className="spinner" /><p>Carregando o espaço da equipe...</p></main>;
  }

  if (profile.must_change_password) {
    return (
      <main className="auth-screen">
        <section className="auth-card">
          <div className="brand-mark"><LockKeyhole size={24} /></div>
          <p className="eyebrow">PRIMEIRO ACESSO</p>
          <h1>Crie sua senha pessoal.</h1>
          <p className="auth-description">Você entrou como <strong>{profile.username}</strong>. Troque a senha temporária por uma senha pessoal para continuar.</p>
          <form onSubmit={handleSetPassword} className="auth-form">
            <label>Nova senha
              <input type="password" autoComplete="new-password" value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} placeholder="Mínimo de 8 caracteres" minLength={8} maxLength={128} required />
            </label>
            {error && <p className="form-error"><AlertCircle size={16} />{error}</p>}
            <button className="primary-button auth-submit" disabled={busy}>{busy ? "Atualizando..." : "Salvar senha e continuar"} <Check size={16} /></button>
          </form>
          <button className="password-logout" onClick={handleSignOut}>Sair</button>
        </section>
      </main>
    );
  }

  let previousDay = "";

  return (
    <main className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className="sidebar-brand">
          <div className="brand-mark small"><MessageCircle size={20} /></div>
          <span>equipe<span className="brand-dot">.</span></span>
          <button className="icon-button mobile-close" onClick={() => setSidebarOpen(false)} aria-label="Fechar menu"><X size={18} /></button>
        </div>
        <div className="workspace-label">ESPAÇO DE TRABALHO</div>
        <button className="channel-item active" onClick={() => setSidebarOpen(false)}>
          <span className="channel-hash">#</span><span>geral</span><span className="online-dot" />
        </button>
        <div className="sidebar-section-heading"><span>SEU TIME</span><span>{members.length}</span></div>
        <div className="member-list">
          {members.map((member) => (
            <div className="member-item" key={member.id}>
              <span className={`avatar ${member.id === profile.id ? "avatar-self" : ""}`}>{initials(member.display_name || member.username)}</span>
              <span className="member-name">{member.display_name || member.username}</span>
              {member.role === "admin" && <ShieldCheck className="admin-shield" size={14} aria-label="Administrador" />}
              <span className="presence-dot" />
            </div>
          ))}
        </div>
        <div className="sidebar-bottom">
          <div className="profile-card">
            <span className="avatar avatar-self">{initials(profile.display_name || profile.username)}</span>
            <span className="profile-label"><strong>{profile.display_name || profile.username}</strong><small>@{profile.username} · {profile.role === "admin" ? "Administrador" : "Membro da equipe"}</small></span>
            <button className="icon-button logout-button" onClick={handleSignOut} title="Sair" aria-label="Sair"><LogOut size={17} /></button>
          </div>
        </div>
      </aside>

      {sidebarOpen && <button className="sidebar-scrim" onClick={() => setSidebarOpen(false)} aria-label="Fechar menu" />}

      <section className="chat-panel">
        <header className="chat-header">
          <button className="icon-button mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="Abrir menu"><Users size={19} /></button>
          <span className="header-hash">#</span>
          <div className="channel-heading"><h1>geral</h1><p>O espaço de conversa da sua equipe</p></div>
          <div className="header-actions">
            <div className="header-member-count"><Users size={16} /><span>{members.length}</span></div>
            {profile.role === "admin" && <button className="invite-button" onClick={() => {
              setShowAdminPanel(true);
              setTemporaryCredentials(null);
              setError("");
              setNotice("");
              loadAdminUsers().catch((loadError: Error) => setError(loadError.message));
            }}><Users size={16} /><span>Painel admin</span></button>}
          </div>
        </header>

        <div className="message-list" ref={listRef}>
          <div className="welcome-block">
            <div className="welcome-icon"><MessageCircle size={26} /></div>
            <h2>Bem-vindo ao canal geral</h2>
            <p>Esse é o começo da conversa do seu time. Compartilhe atualizações, ideias e imagens do projeto.</p>
          </div>
          {messages.map((message) => {
            const day = message.created_at.toDateString();
            const showDate = day !== previousDay;
            previousDay = day;
            return (
              <div key={message.id}>
                {showDate && <div className="date-divider"><span>{formatDay(message.created_at)}</span></div>}
                <article className="message-row">
                  <div className="avatar message-avatar">{initials(message.sender_name)}</div>
                  <div className="message-content">
                    <div className="message-meta"><strong>{message.sender_name}</strong><time>{displayTime(message.created_at)}</time></div>
                    {message.body && <p className="message-text">{message.body}</p>}
                    {message.image_id && <ImageMessage imageId={message.image_id} user={user} isAdmin={profile.role === "admin"} onDownload={handleDownload} />}
                  </div>
                </article>
              </div>
            );
          })}
          {messages.length === 0 && <div className="empty-state"><span className="empty-icon"><MessageCircle size={21} /></span><strong>A conversa começa com você</strong><span>Envie uma mensagem para o time.</span></div>}
        </div>

        <div className="composer-wrap">
          {error && <div className="inline-alert error-alert"><AlertCircle size={16} />{error}<button onClick={() => setError("")} aria-label="Fechar"><X size={15} /></button></div>}
          {notice && <div className="inline-alert success-alert"><Check size={16} />{notice}<button onClick={() => setNotice("")} aria-label="Fechar"><X size={15} /></button></div>}
          <form className="composer" onSubmit={handleSend}>
            <input ref={fileRef} type="file" accept={ACCEPTED_IMAGE_TYPES.join(",")} hidden onChange={(event) => handleImage(event.target.files?.[0])} />
            <button className="composer-tool" type="button" onClick={() => fileRef.current?.click()} disabled={busy} title="Enviar imagem" aria-label="Enviar imagem"><ImagePlus size={20} /></button>
            <input className="composer-input" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Mensagem para #geral" maxLength={4000} aria-label="Escreva sua mensagem" />
            <button className={`send-button ${draft.trim() ? "send-ready" : ""}`} type="submit" disabled={!draft.trim() || busy} title="Enviar mensagem" aria-label="Enviar mensagem"><Send size={18} /></button>
          </form>
          <div className="composer-hint">Compartilhe com cuidado — este é um espaço privado da equipe.</div>
        </div>
      </section>

      {showAdminPanel && profile.role === "admin" && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowAdminPanel(false); }}>
          <section className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="admin-title">
            <button className="icon-button modal-close" onClick={() => setShowAdminPanel(false)} aria-label="Fechar"><X size={19} /></button>
            <div className="modal-icon"><ShieldCheck size={21} /></div>
            <p className="eyebrow">ACESSO RESTRITO</p>
            <h2 id="admin-title">Painel do administrador</h2>
            <p>Crie contas com um nome de usuário, sem pedir e-mail. Cada pessoa receberá uma senha temporária e criará a própria senha no primeiro acesso.</p>

            <form onSubmit={handleInvite} className="invite-form admin-create-form">
              <label htmlFor="invite-username">Nome de usuário</label>
              <input id="invite-username" autoComplete="off" minLength={3} maxLength={30} pattern="[A-Za-z0-9._-]+" placeholder="ex.: reldery_assuncao" value={inviteUsername} onChange={(event) => setInviteUsername(event.target.value)} required />
              <small className="field-hint">3–30 caracteres: letras, números, ponto, hífen ou sublinhado.</small>
              <label htmlFor="invite-name">Nome para exibição <span>(opcional)</span></label>
              <input id="invite-name" autoComplete="name" maxLength={80} placeholder="Como aparecerá nas mensagens" value={inviteName} onChange={(event) => setInviteName(event.target.value)} />
              <button className="primary-button" disabled={busy}>{busy ? "Criando conta..." : "Criar conta"} <UserPlus size={16} /></button>
            </form>

            {temporaryCredentials && <div className="admin-invite-result">
              <strong>Senha temporária de @{temporaryCredentials.username}. Ela será exibida somente agora; compartilhe-a em particular.</strong>
              <label htmlFor="temporary-password">Senha temporária</label>
              <input id="temporary-password" aria-label="Senha temporária" value={temporaryCredentials.password} readOnly onFocus={(event) => event.currentTarget.select()} />
              <button className="secondary-button" onClick={() => navigator.clipboard.writeText(`Usuário: ${temporaryCredentials.username}\nSenha temporária: ${temporaryCredentials.password}`).then(() => setNotice("Credenciais copiadas."), () => setError("Não foi possível copiar as credenciais."))}><Check size={15} /> Copiar credenciais</button>
            </div>}

            <div className="admin-users-heading"><strong>Contas cadastradas</strong><span>{adminUsers.length}</span></div>
            <div className="admin-users-list">
              {adminUsers.map((managedUser) => (
                <div className="admin-user-row" key={managedUser.id}>
                  <span className="avatar">{initials(managedUser.display_name || managedUser.username)}</span>
                  <span className="admin-user-details"><strong>{managedUser.display_name || managedUser.username}</strong><small>@{managedUser.username}</small></span>
                  <span className={`role-pill ${managedUser.active === false ? "role-disabled" : ""}`}>{managedUser.active === false ? "Desativado" : managedUser.must_change_password ? "Aguardando senha" : managedUser.role === "admin" ? "Admin" : "Ativo"}</span>
                  {managedUser.role !== "admin" && managedUser.active !== false && <>
                    <button className="reset-password-button" disabled={busy} onClick={() => handleResetPassword(managedUser)}>Redefinir senha</button>
                    <button className="deactivate-button" disabled={busy} onClick={() => handleDeactivate(managedUser.id)}>Desativar</button>
                  </>}
                </div>
              ))}
              {adminUsers.length === 0 && <div className="admin-users-empty">Carregando contas ou nenhum membro cadastrado.</div>}
            </div>
            {error && <p className="form-error"><AlertCircle size={15} />{error}</p>}
            {notice && <p className="admin-notice"><Check size={15} />{notice}</p>}
            <div className="invite-security"><LockKeyhole size={14} /> A conta é criada no Firebase pelo servidor; a chave administrativa nunca vai para o navegador.</div>
          </section>
        </div>
      )}
    </main>
  );
}

function ImageMessage({ imageId, user, isAdmin, onDownload }: {
  imageId: string;
  user: User;
  isAdmin: boolean;
  onDownload: (path: string) => void;
}) {
  const [imageUrl, setImageUrl] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let objectUrl = "";
    let active = true;
    user.getIdToken()
      .then((token) => fetch(`/api/image?id=${encodeURIComponent(imageId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      }))
      .then(async (response) => {
        if (!response.ok) throw new Error("Não foi possível carregar esta imagem.");
        objectUrl = URL.createObjectURL(await response.blob());
        if (active) setImageUrl(objectUrl);
      })
      .catch((loadError: Error) => {
        if (active) setError(loadError.message);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [imageId, user]);

  if (error) return <div className="image-error"><AlertCircle size={16} />{error}</div>;
  if (!imageUrl) return <div className="image-placeholder"><div className="spinner small-spinner" />Carregando imagem...</div>;

  return (
    <div className="image-attachment">
      <img src={imageUrl} alt="Imagem compartilhada no chat" draggable={false} onContextMenu={(event) => event.preventDefault()} />
      <div className="image-watermark" aria-hidden="true">USO INTERNO · CONFIDENCIAL</div>
      {isAdmin && <button className="download-button" onClick={() => onDownload(imageId)}><ImagePlus size={14} /> Baixar imagem</button>}
    </div>
  );
}

export default App;
