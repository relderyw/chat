# Chat privado da equipe — Firebase

Aplicação de mensagens em tempo real com React, Firebase Authentication, Cloud Firestore e funções da Vercel. Para evitar depender do Firebase Storage/Blaze, as imagens são redimensionadas e comprimidas no navegador e guardadas como documentos privados separados no Firestore. O projeto de agenda no Supabase não é usado nem alterado por este chat.

## Importante sobre privacidade

O Firebase é um serviço em nuvem do Google. Os dados ficam no projeto Firebase/Google Cloud que você criar e estão sujeitos à configuração, região, políticas e cobrança dessa conta. Isso não significa criptografia ponta a ponta: administradores com acesso ao projeto e ao banco podem ter acesso aos dados.

As regras impedem usuários sem perfil autorizado de ler mensagens e imagens diretamente pelo Firestore. O servidor só entrega imagens a membros autenticados e controla o download oficial para o administrador. Ainda assim, para visualizar uma imagem, o navegador recebe seus pixels; um membro pode copiar os dados da resposta. Portanto, **não é possível impedir de forma confiável cópias, capturas de tela ou fotos da tela**.

## 1. Criar e configurar um projeto Firebase

1. Abra o [Firebase Console](https://console.firebase.google.com/) e crie um projeto dedicado ao chat. Não reutilize nem altere o projeto Supabase da agenda. Confira a organização Google Cloud proprietária e as opções de região antes de criar: a região do Firestore não pode ser trocada depois.
2. No projeto, registre um aplicativo **Web** e copie as configurações exibidas. Elas serão usadas nas variáveis `VITE_FIREBASE_...`.
3. Em **Authentication → Sign-in method**, habilite **Email/Password**. Os membros entram com nome de usuário e senha, sem informar ou receber e-mail e sem usar login Google. Para compatibilidade interna com o Firebase Authentication, o servidor cria um endereço técnico no domínio reservado `.invalid`; ele não é uma caixa de e-mail e não recebe mensagens. O administrador ainda precisa de uma conta de serviço do Google Cloud para o servidor acessar Firebase com segurança. Não há cadastro público; uma conta só acessa o chat depois que o administrador a cria.
4. Em **Authentication → Settings → Authorized domains**, adicione o domínio de produção da aplicação na Vercel e `localhost` para testes locais.
5. Em **Firestore Database**, crie o banco em modo de produção, escolhendo a região adequada à equipe e às regras de residência de dados da empresa. A região não pode ser alterada depois.
6. Não crie bucket em **Storage**: este modo de baixo custo não usa Cloud Storage. As imagens ficam no Firestore e são pequenas para respeitar o limite de documento.
7. Crie uma conta de serviço para o servidor em **Project settings → Service accounts → Generate new private key**. Guarde o arquivo JSON com segurança. Copie os valores `project_id`, `client_email` e `private_key` para as variáveis do servidor indicadas abaixo. **Nunca publique o JSON nem a chave privada.**

## 2. Aplicar as regras de acesso

Instale e autentique a CLI do Firebase:

```powershell
npm install --global firebase-tools
firebase login
```

Na pasta do projeto, publique as regras diretamente no projeto `chat-lsl`:

```powershell
firebase deploy --only firestore:rules --project chat-lsl
```

As regras em `firestore.rules` permitem que somente membros ativos que já trocaram a senha temporária leiam mensagens e perfis. Os documentos de imagem e a coleção de nomes de usuário não podem ser consultados diretamente pelo SDK do navegador; as APIs autenticadas fazem essas operações.

Se a CLI retornar **403 / Caller does not have required permission to use project**, a conta autenticada em `firebase login` precisa ter acesso ao projeto. Peça ao proprietário do projeto para conceder `Service Usage Consumer` (`roles/serviceusage.serviceUsageConsumer`) à conta. Se o deploy informar outra permissão faltante, o proprietário deve conceder somente o papel indicado para publicar regras.

## 3. Criar o primeiro administrador

1. Copie `.env.example` para `.env.local` e configure as variáveis a seguir. As quatro `VITE_...` vêm da configuração do app Web; as três variáveis de servidor vêm de uma chave de conta de serviço guardada com segurança:

   ```dotenv
   VITE_FIREBASE_API_KEY=sua_api_key
   VITE_FIREBASE_AUTH_DOMAIN=seu-projeto.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=seu-projeto
   VITE_FIREBASE_APP_ID=seu_app_id

   FIREBASE_PROJECT_ID=seu-projeto
   FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@seu-projeto.iam.gserviceaccount.com
   FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nSUA_CHAVE_PRIVADA\n-----END PRIVATE KEY-----\n"
   ```

2. Na pasta do projeto, crie a primeira conta administradora com um nome de usuário:

   ```powershell
   npm run create-admin -- reldery_assuncao "Reldery Assuncao"
   ```

O comando exibe uma senha temporária uma única vez. Guarde-a e entre com o nome de usuário; no primeiro acesso será obrigatório definir uma senha pessoal. Não há envio nem recuperação por e-mail. Proteja `.env.local`; ele contém a chave privada administrativa.

## 4. Executar localmente

```powershell
cd "C:\Users\ASSUNÇÃO-III\Desktop\CHAT"
npm install
npm install --global vercel
vercel dev
```

O `.env.local` precisa conter as variáveis acima. Abra o endereço local da Vercel, normalmente `http://localhost:3000`. As funções `/api` não são executadas pelo Vite sozinho.

## 5. Publicar na Vercel

1. Importe este projeto na Vercel e configure estas variáveis em **Project Settings → Environment Variables**:
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_APP_ID`
   - `FIREBASE_PROJECT_ID`
   - `FIREBASE_CLIENT_EMAIL`
   - `FIREBASE_PRIVATE_KEY`
2. A chave `FIREBASE_PRIVATE_KEY` é somente do servidor. Não use prefixo `VITE_` nela. Na Vercel, cole a chave privada como valor da variável; o código converte os `\n` em quebras de linha.
3. O comando de build é `npm run build`, e a pasta de saída é `dist`.
4. Publique e confirme o domínio em **Authentication → Authorized domains**.
5. Teste login, mensagens, envio e visualização de imagens e convites antes de usar com dados confidenciais.

## Painel de administrador e contas da equipe

No chat, abra **Painel admin**, informe um nome de usuário e, opcionalmente, um nome para exibição. O servidor cria a conta e mostra uma senha temporária, exibida somente após a criação; copie-a e entregue à pessoa por um canal confiável. No primeiro login, o membro precisa escolher a própria senha antes de acessar o chat.

O painel lista contas, permite gerar uma nova senha temporária para membros que esqueceram a senha e desativar contas. A redefinição encerra o acesso com a senha anterior e exige definir uma nova senha no próximo login. Por segurança, o painel não gerencia contas administrativas nem permite desativar sua própria conta.

**Sem e-mail:** o login visível é somente usuário e senha. O Firebase mantém um identificador técnico interno terminado em `.invalid`; nenhum e-mail é solicitado ou enviado. Como não existe e-mail de recuperação, o administrador precisa redefinir a senha pelo painel. A senha temporária aparece uma vez; se você fechar o painel sem copiá-la, use **Redefinir senha**.

## Imagens no plano gratuito

O navegador converte as imagens para WebP, reduz a resolução para no máximo 1280 pixels e comprime cada imagem para até aproximadamente 480 KB. Transparência é substituída por fundo branco e GIFs animados não são aceitos. A API valida o formato e o tamanho novamente antes de gravar imagem e mensagem no Firestore.

Esse método evita um bucket do Firebase Storage, mas **não garante custo zero nem uso ilimitado**: o Firestore tem cotas gratuitas e cada imagem ocupa espaço e consome leituras quando é exibida. Acompanhe o uso no Console e verifique os limites atuais do plano Spark. Não ative o Blaze se o requisito for não cadastrar faturamento.

## Cobrança e operação

Firestore, autenticação e hospedagem têm cotas e limites próprios, que podem mudar. Verifique os limites atuais do plano Spark e da Vercel e acompanhe o uso. Não existe garantia de serviço ilimitado gratuito. Defina backups e um processo para remover o acesso de membros que saírem da equipe.

## Solução de problemas

- **A tela pede configuração Firebase:** confira as quatro variáveis públicas `VITE_FIREBASE_...` e reinicie o servidor; na Vercel, publique novamente após editar variáveis.
- **Erro 401/500 nas rotas `/api`:** confira as variáveis da conta de serviço, especialmente que `FIREBASE_PRIVATE_KEY` contenha a chave privada completa.
- **Usuário autenticado, mas sem acesso:** confira se o perfil dele existe em `profiles` e se as regras foram publicadas.
- **Nome de usuário ou senha não funciona:** confira maiúsculas/minúsculas e use o nome definido pelo administrador. Se a senha temporária foi perdida, redefina-a no Painel admin.
- **Imagem é rejeitada:** use JPEG, PNG ou WebP. Imagens grandes serão reduzidas e comprimidas; GIFs animados e imagens que ainda ultrapassem o limite depois da compressão não podem ser enviados.
