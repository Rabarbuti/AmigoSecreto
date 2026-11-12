# 🎁 Amigo Secreto

Site para organizar amigos secretos **de graça**: você cria o evento (nome, data e valor do presente), cadastra os
participantes, manda **um link** no grupo, cada pessoa escolhe o próprio nome e deixa o e-mail, e quando você aperta
**Sortear** cada um recebe por e-mail quem tirou.

- **Site:** páginas estáticas (pasta `docs/`) hospedadas no **GitHub Pages**.
- **Banco e login:** **Supabase** (plano Free).
- **Sorteio e envio dos e-mails:** uma função do Supabase (`supabase/functions/sorteio`) que manda os e-mails pelo
  **Gmail**, através de uma "ponte" de 60 linhas em Google Apps Script (`apps-script/Code.gs`).

```
 participantes (celular) ─┐
                          ├──►  GitHub Pages  (site em docs/)
 você, organizador ───────┘            │  login + banco
                                       ▼
                              Supabase (plano Free)
                          ├─ Postgres: eventos e participantes
                          └─ função "sorteio" ── sorteia e manda os e-mails
                                       │  HTTPS
                                       ▼
                          ponte Google Apps Script ──► Gmail ──► caixa de cada um
```

> Antes de configurar o Supabase, o site abre em **modo demonstração** (dados de mentirinha, nada é salvo e nenhum
> e-mail sai). Dá para clicar em tudo e ver como funciona: abra `docs/index.html` por qualquer servidor estático
> (`npm run site` e depois <http://127.0.0.1:5500>).

---

## É tudo grátis mesmo?

| Peça | Plano | O que você precisa saber |
|---|---|---|
| **GitHub Pages** | Grátis em repositório **público** | Não precisa de cartão. Repositório privado + Pages exige plano pago: por isso o repositório tem de ser público. |
| **Supabase** | Free (US$ 0) | 500 MB de banco, 50 mil usuários ativos/mês, 500 mil execuções de função/mês. **Projeto sem uso por 1 semana é pausado** (os dados ficam guardados; você reativa com um clique). Máximo de 2 projetos ativos. Não pede cartão. |
| **Gmail** (pela ponte) | Conta Google comum | Conta comum envia para **100 destinatários por dia**. Dá para um evento grande por dia. O site confere a cota **antes** de sortear e nem começa se ela não cobrir todo mundo (assim ninguém fica com resultado velho). |

O projeto não define nenhum workflow de GitHub Actions e não usa Codespaces, Copilot nem armazenamento extra: quem
publica o site é o próprio Pages, que é grátis em repositório público. Se um dia o Supabase sugerir upgrade, é só
**não aceitar**: o plano Free não vira pago sozinho.

### Sobre a cobrança que você teve no GitHub

Eu não consigo ver a sua conta, então não sei o que gerou a cobrança. As causas mais comuns são: assinatura do
**Copilot**, minutos de **GitHub Actions** em repositório **privado** (passou da cota grátis), **Codespaces** e
armazenamento de pacotes/LFS. Para descobrir e evitar de novo:

1. No GitHub, abra **Settings → Billing and licensing** (a página de uso/cobrança) e veja qual item gerou o valor.
2. Na mesma área, procure os **orçamentos / limites de gastos** (*budgets*) e deixe em **US$ 0**, com a opção de
   bloquear o uso quando chegar no limite.
3. Mantenha este repositório **público** e sem workflows: assim nada dele é cobrado.

---

## Passo a passo (uns 30 minutos)

Você precisa de: **Node 22+**, **Git**, uma conta no **GitHub**, uma no **Supabase** e uma **conta Google**
(recomendo criar uma só para o site, por exemplo `amigosecreto.suafamilia@gmail.com`: os e-mails saem dela e ficam na
pasta "Enviados" dela, longe da sua caixa pessoal).

### 1. Criar o projeto no Supabase

1. Entre em <https://supabase.com> e crie uma conta (pode ser com o GitHub).
2. **New project**: dê um nome (ex.: `amigo-secreto`), escolha a região mais perto (ex.: *South America (São Paulo)*),
   plano **Free**, e defina a senha do banco (anote, mas o site não usa).
3. Espere uns 2 minutos até o projeto ficar pronto.

Guarde dois dados que vão ser usados nos próximos passos (botão **Connect**, ou **Project Settings → API Keys**):

- **Project URL**: algo como `https://abcdefghijklmnopqrst.supabase.co`. As 20 letras do começo são o *project ref*.
- **Publishable key**: começa com `sb_publishable_`. (É a chave pública, pode ficar no site. A *secret key*
  `sb_secret_…` **nunca** vai para o site nem para o GitHub.)

### 2. Criar as tabelas

No painel do Supabase abra **SQL Editor → New query**, cole **todo** o conteúdo de
[`supabase/migrations/20261112000000_amigo_secreto.sql`](supabase/migrations/20261112000000_amigo_secreto.sql) e
clique em **Run**. Deve aparecer *Success*. (Em **Table Editor** passam a existir `eventos` e `participantes`.)

> Quem prefere o terminal pode usar `npx supabase link SEU_REF` e `npx supabase db push` no lugar do SQL Editor.

### 3. Criar o seu login de organizador

Ninguém se cadastra sozinho: **você** cria o usuário no painel. Isso é importante, porque os e-mails saem do *seu*
Gmail e um cadastro aberto deixaria qualquer um usar o seu envio.

1. **Authentication → Sign In / Providers** (o nome pode variar um pouco): **desligue** *Allow new users to sign up*.
2. **Authentication → Users → Add user → Create new user**: informe e-mail e senha e marque **Auto Confirm User**.

Para dar acesso a outra pessoa organizar eventos, crie o usuário dela do mesmo jeito. Cada um só vê os próprios eventos.

> **Não pule o item 1.** O padrão do Supabase costuma deixar o cadastro ligado, e então qualquer pessoa conseguiria
> criar conta (a chave pública do site é pública) e usar o envio de e-mail do seu Gmail. A página **Testar a conexão**
> avisa se o cadastro estiver ligado. Se por algum motivo você precisar deixá-lo ligado, defina também o segredo
> opcional `ORGANIZADORES_PERMITIDOS` (passo 5) com os e-mails que podem sortear.

### 4. E-mail pelo Gmail (a "ponte")

As funções do Supabase não conseguem abrir conexões de e-mail comuns (as portas 25 e 587 são bloqueadas), por isso
o e-mail sai por um pequeno app do Google que só faz uma coisa: receber o e-mail pronto e enviar.

1. Entre com a **conta Google que vai enviar** em <https://script.google.com> e clique em **Novo projeto**.
2. Apague o código que vier e cole **todo** o conteúdo de [`apps-script/Code.gs`](apps-script/Code.gs).
3. Na linha `const SEGREDO = '…'` troque o texto por um **segredo longo e aleatório** (30+ caracteres, letras e
   números; os segredos de exemplo do projeto são recusados). Anote: você vai usar o **mesmo** texto no passo 5.
   Salve com **Ctrl+S**. Troque o segredo **só nessa cópia, dentro do editor do Google**: nunca edite o
   `apps-script/Code.gs` deste repositório com o segredo dentro e faça `git push` (o repositório é público, e quem
   tiver o endereço da ponte mais o segredo manda e-mails de qualquer assunto, para qualquer pessoa, pelo seu Gmail).
4. No menu de funções (em cima), escolha **testar** e clique em **Executar**. O Google vai pedir autorização: clique
   em **Revisar permissões**, escolha a conta e, se aparecer *"O Google não verificou este app"*, clique em
   **Avançado → Acessar … (não seguro)**. É o seu próprio script, e ele só pede permissão para **enviar e-mails**.
   Chega um e-mail de teste na sua caixa: a ponte funciona.
5. **Implantar → Nova implantação →** engrenagem **→ App da Web**. Preencha:
   - **Executar como:** Eu
   - **Quem pode acessar:** **Qualquer pessoa** (o segredo do passo 3 é o que protege)
6. Clique em **Implantar** e copie o **URL do app da Web** (termina em `/exec`).
   Se abrir esse endereço no navegador, deve aparecer *"Ponte de e-mail do Amigo Secreto: no ar."*

> Mexeu no `Code.gs` depois? **Implantar → Gerenciar implantações →** lápis **→ Versão: Nova versão → Implantar**.
> Assim o endereço continua o mesmo.

### 5. Publicar a função de sorteio

No terminal, dentro desta pasta:

```bash
npm install
npx supabase login
npx supabase link SEU_REF
npx supabase secrets set APPS_SCRIPT_URL="https://script.google.com/macros/s/.../exec" APPS_SCRIPT_SEGREDO="o-mesmo-segredo-do-passo-4"
npx supabase functions deploy sorteio --use-api --no-verify-jwt
```

- `SEU_REF` são as 20 letras do endereço do projeto (`https://SEU_REF.supabase.co`).
- O `login` abre o navegador para você autorizar. Se o terminal pedir um *verification code*, copie-o da página do
  navegador e cole no terminal. Se o `link` pedir a senha do banco, pode deixar em branco. Se o terminal pedir
  confirmação (`y/N`) antes de mexer no projeto, responda `y`.
- `--use-api` publica sem precisar de Docker.
- `--no-verify-jwt` desliga a checagem de login do *gateway* do Supabase, que só entende as chaves antigas e pode
  recusar o seu login em projetos novos. Não abre nenhuma porta: a própria função confere o login e só obedece a um
  organizador logado (o `supabase/config.toml` já diz o mesmo; o flag só deixa explícito).
- Os segredos ficam guardados no Supabase (também aparecem em **Edge Functions → Secrets**), **nunca** no GitHub.
- Opcional: `NOME_REMETENTE="Amigo Secreto da Família"` muda o nome que aparece como remetente.
- Opcional: `ORGANIZADORES_PERMITIDOS="voce@gmail.com,amigo@gmail.com"` limita quem pode usar a função a esses e-mails.
  Só faz diferença se você deixar o cadastro aberto no passo 3 (não recomendado).

### 6. Ligar o site ao Supabase

Abra [`docs/config.js`](docs/config.js) e troque os dois valores pelos do passo 1:

```js
window.AMIGO_SECRETO_CONFIG = {
  supabaseUrl: "https://abcdefghijklmnopqrst.supabase.co",
  supabaseKey: "sb_publishable_...",
};
```

Esses dois valores são públicos por natureza (o banco é protegido por regras, não por segredo). Se você colar
por engano a chave **secreta**, o site se recusa a abrir e explica o que fazer.

### 7. Colocar no GitHub Pages

1. Crie um repositório **público** no GitHub (ex.: `amigo-secreto`), **sem** README nem `.gitignore` iniciais.
2. Neste terminal:

   ```bash
   git init -b main
   git add .
   git commit -m "Amigo secreto"
   git remote add origin https://github.com/SEU-USUARIO/amigo-secreto.git
   git push -u origin main
   ```

3. No repositório: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, **Branch: `main`**,
   pasta **`/docs`**, **Save**.
4. Em 1–2 minutos o site fica em `https://SEU-USUARIO.github.io/amigo-secreto/`.

### 8. Testar antes do primeiro evento de verdade

1. Abra o site e entre com o usuário do passo 3.
2. Clique em **Testar a conexão** (rodapé da lista de eventos): tudo precisa estar com ✅, inclusive
   *"Cadastro de novos usuários: desligado"* (se aparecer ❌ ou ⚠️, volte ao passo 3). Use
   **Enviar e-mail de teste para mim** e confira se chegou.
3. Crie um evento de teste com 3 nomes e e-mails seus (ou de amigos que toparem), sorteie e apague o evento.

---

## Como usar

**Você (organizador)**

1. **+ Novo evento**: nome, data, valor do presente e, se quiser, um recado (aparece na página do link e no e-mail).
2. Adicione os participantes (um nome por linha). Pode colar a lista inteira.
3. **Copiar** o link (ou **Enviar pelo WhatsApp**) e mande no grupo.
4. Acompanhe quem já deixou o e-mail. Quem errou ou clicou no nome errado: **Apagar e-mail** e a pessoa digita de novo.
   Você também pode digitar o e-mail de alguém em **Definir e-mail**. Confira os e-mails: o site marca com ⚠ os que
   são iguais ou parecidos (ex.: `davi+ana@gmail.com`).
5. Com todos com e-mail (mínimo 3 pessoas), **Sortear e enviar e-mails**.
6. Se algum e-mail não sair, o motivo aparece ao lado do nome e **Reenviar** (ou **Reenviar os pendentes**) tenta de
   novo **para o mesmo endereço** guardado.
7. **Depois do sorteio a lista fica travada** (nomes e e-mails). Descobriu um e-mail errado ou esqueceu alguém? Em
   **Opções avançadas → Cancelar este sorteio e refazer**: a lista é liberada, você corrige e sorteia de novo. Todo
   mundo recebe um e-mail novo, com o aviso *"sorteio nº 2: ignore o anterior"*.

**Participantes**: abrem o link, tocam no próprio nome, digitam o e-mail duas vezes e pronto. Depois do sorteio recebem
por e-mail só o nome de quem tiraram.

### Sigilo do sorteio: o que o sistema garante

- O sorteio é uma **roda única**: ninguém tira a si mesmo e não existe troca direta (A tira B e B tira A).
- O sorteio roda no **servidor**. A resposta que volta para o site nunca traz quem tirou quem, e o banco não deixa
  nem o organizador ler os pares pela API.
- **Depois do sorteio a lista fica travada**, também para o organizador: ninguém entra, sai ou troca nome/e-mail. Sem
  isso, o organizador poderia trocar o e-mail de alguém pelo dele e apertar **Reenviar**, recebendo o resultado dessa
  pessoa sem ela perceber. **Reenviar** sempre usa o e-mail que já estava guardado. Para mudar algo, **Cancelar este
  sorteio e refazer** (todo mundo recebe um e-mail novo avisando que o anterior não vale mais).
- Para poder **reenviar**, os pares ficam guardados na tabela `private.sorteios` do Supabase, fora da API.
  **Quem é dono do projeto consegue lê-la pelo SQL Editor**, então, se você participa do amigo secreto, simplesmente
  não abra essa tabela. O mesmo vale para a pasta "Enviados" da conta Gmail que manda os e-mails (por isso a dica de
  usar uma conta só para o site).
- **O organizador é de confiança.** Ele digita e vê os e-mails: se, *antes* do sorteio, colocar o próprio e-mail no
  lugar do de alguém, recebe o resultado dessa pessoa (que, por não receber o e-mail, percebe). O site ajuda marcando
  e-mails iguais ou parecidos, mas o sistema não consegue provar que cada e-mail é de quem diz ser.
- Quem tem o link só enxerga os **nomes**, nunca os e-mails, e só consegue preencher o e-mail de um nome que ainda
  está livre. **Quem chega primeiro leva**: alguém mal-intencionado com o link poderia ocupar o nome de outra pessoa
  com um e-mail dele. Por isso vale conferir os e-mails (e os ⚠) antes de sortear. Não há como trocar o link de um
  evento: se ele vazar para quem não devia, crie outro evento.
- Com **só 3 pessoas** o segredo é pequeno: quem sabe quem tirou consegue deduzir o sorteio inteiro. O site avisa.

### Limites e cuidados

- **Projeto pausado:** se ninguém usar por uma semana, o Supabase pausa o projeto (ele avisa por e-mail antes). O site
  mostra um aviso; entre em <https://supabase.com/dashboard> e clique em **Restore project**. Abrir o painel ou usar
  o site conta como atividade.
- **100 e-mails por dia** na conta Gmail comum. O site pergunta à ponte quanto falta da cota antes de sortear e não
  começa se ela não cobrir todo mundo; um novo sorteio gasta mais um e-mail por participante.
- Até **50 participantes** por evento.
- Peça para a galera olhar a pasta de **spam** se o e-mail não chegar.
- Os e-mails dos participantes ficam no seu banco. Para apagá-los, apague o evento (botão no fim da página dele).
- **Páginas do mesmo usuário no `github.io` dividem o armazenamento do navegador.** Se você publica outros sites no
  mesmo `SEU-USUARIO.github.io`, só coloque aqui quem você confia (a sessão de login fica guardada ali).
- Opcional, para endurecer: em `docs/index.html`, troque `https://*.supabase.co` na linha da política de segurança
  pelo endereço exato do seu projeto (`https://SEU_REF.supabase.co`).

---

## Desenvolvimento e testes

```bash
npm test               # testes da lógica (sorteio, e-mails, ponte, formatação): rápido, sem Docker
npm run site           # serve docs/ em http://127.0.0.1:5500 (sem config.js ele abre em modo demonstração)
```

Para testar tudo junto, com um Supabase **de mentirinha no seu computador** (precisa do Docker):

```bash
cp supabase/functions/.env.example supabase/functions/.env   # só na primeira vez
npm run banco:iniciar        # liga o Supabase local e aplica a migração
npm run test:banco           # 120+ verificações de permissões, RLS e funções do banco
npm run funcao:servir        # (outro terminal) serve a função "sorteio"
npm run test:e2e             # ponta a ponta: login, regras, função e uma ponte de e-mail falsa no lugar do Gmail
npm run banco:parar          # desliga e apaga o banco local
```

Para abrir o site contra o Supabase local: `npm run usuario:local -- voce@exemplo.com uma-senha-123`, rode
`npm run ponte-falsa` (e-mails "enviados" aparecem em <http://127.0.0.1:8787/caixa>) e crie `docs/config.local.js`
(ignorado pelo git) com `export default { supabaseUrl: "http://127.0.0.1:54321", supabaseKey: "<chave publishable que o banco:iniciar mostra>" }`.

```
docs/                    o site (é o que o GitHub Pages publica)
  config.js              URL e chave pública do Supabase
  js/                    telas, API real (api.js) e API de demonstração (api-demo.js)
  vendor/supabase.js     supabase-js 2.119.0 embutido (sem depender de CDN)
supabase/
  migrations/            tabelas, regras de acesso (RLS) e funções do banco
  functions/sorteio/     a função: sorteio, e-mails e regras (nucleo.ts)
  tests/banco.test.sql   testes do banco
apps-script/Code.gs      a ponte de e-mail
scripts/                 ponte falsa, teste de ponta a ponta, usuário local
tests/                   testes automáticos (npm test)
```

---

## Problemas comuns

| O que aparece | O que fazer |
|---|---|
| Faixa amarela **"Modo demonstração"** | O `docs/config.js` ainda está com os valores de exemplo (passo 6) ou o GitHub Pages ainda não publicou a versão nova. |
| Mudei um arquivo, fiz `git push` e o site continua igual | O Pages leva 1–2 minutos para publicar e o navegador pode guardar a versão antiga por uns 10 minutos: aperte **Ctrl+F5** (ou abra numa aba anônima). |
| *"O banco ainda não tem as tabelas e funções…"* | Faltou rodar o SQL (passo 2). |
| *"A função "sorteio" não está no seu projeto…"* | Faltou publicar a função (passo 5). |
| *"O envio de e-mail ainda não foi configurado…"* | Faltou `npx supabase secrets set …` (passo 5). |
| *"Sua sessão expirou. Entre de novo."* mesmo depois de entrar de novo | A função foi publicada com a checagem de login do gateway ligada. Publique de novo com `npx supabase functions deploy sorteio --use-api --no-verify-jwt` (passo 5). |
| *"Segredo incorreto"* | O `APPS_SCRIPT_SEGREDO` do Supabase tem de ser idêntico ao `SEGREDO` do `Code.gs`. Depois de trocar um deles, publique a nova versão da ponte. |
| *"A ponte de e-mail respondeu algo inesperado"* | A implantação do Apps Script precisa estar com acesso **Qualquer pessoa**; confira o endereço `/exec`. |
| *"O Gmail só deixa enviar mais N e-mails hoje…"* | A cota diária (100) não cobre todo mundo: nada foi sorteado. Tente amanhã. |
| *"Service invoked too many times for one day: email"* | Passou dos 100 e-mails do dia no meio de um envio. Aguarde 24 h e use **Reenviar os pendentes**. |
| *"Sem permissão… a lista não pode mais mudar"* | Depois do sorteio a lista fica travada. Use **Opções avançadas → Cancelar este sorteio e refazer**. |
| *"Não consegui falar com o servidor…"* | Internet ou **projeto pausado** (veja "Limites e cuidados"). |
| *"E-mail ou senha incorretos"* | Use o usuário criado no passo 3. Senha esquecida: no painel, **Authentication → Users**, edite o usuário. |
| O participante diz que o nome dele já está cadastrado | Alguém clicou no nome errado. No evento, **Apagar e-mail** daquela pessoa e peça para tentar de novo. |
