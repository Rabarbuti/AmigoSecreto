// Cria (ou atualiza a senha d)o organizador no Supabase LOCAL, para você poder entrar no site
// rodando no seu computador. No Supabase de verdade o usuário é criado pelo painel (README).
//
// Uso: npm run usuario:local -- organizador@exemplo.com minha-senha-123

import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const [email, senha] = process.argv.slice(2);
if (!email || !senha || senha.length < 8) {
  console.error("Uso: npm run usuario:local -- <e-mail> <senha com 8+ caracteres>");
  process.exit(2);
}

const raiz = fileURLToPath(new URL("..", import.meta.url));
const saida = execSync("npx supabase status -o json", { cwd: raiz, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const st = JSON.parse(saida.slice(saida.indexOf("{")));
const admin = st.SERVICE_ROLE_KEY;

const cabecalhos = { apikey: admin, Authorization: `Bearer ${admin}`, "Content-Type": "application/json" };
let r = await fetch(`${st.API_URL}/auth/v1/admin/users`, {
  method: "POST",
  headers: cabecalhos,
  body: JSON.stringify({ email, password: senha, email_confirm: true }),
});

if (r.status === 422) {
  // já existe: procura o usuário e troca a senha
  const lista = await (await fetch(`${st.API_URL}/auth/v1/admin/users?per_page=1000`, { headers: cabecalhos })).json();
  const existente = lista.users?.find((u) => u.email === email.toLowerCase());
  if (!existente) {
    console.error("Não consegui criar nem achar esse usuário.");
    process.exit(1);
  }
  r = await fetch(`${st.API_URL}/auth/v1/admin/users/${existente.id}`, {
    method: "PUT",
    headers: cabecalhos,
    body: JSON.stringify({ password: senha, email_confirm: true }),
  });
}

if (!r.ok) {
  console.error(`Falhou (${r.status}): ${await r.text()}`);
  process.exit(1);
}
console.log(`Pronto: ${email} já pode entrar no site local.`);
