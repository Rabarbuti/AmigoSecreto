// Roda supabase/tests/banco.test.sql dentro do banco do Supabase local (container do Docker).
// Uso: npm run test:banco   (antes: npm run banco:iniciar)

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const projeto = readFileSync(new URL("../supabase/config.toml", import.meta.url), "utf8")
  .match(/^project_id\s*=\s*"([^"]+)"/m)?.[1];
if (!projeto) {
  console.error("Não achei project_id no supabase/config.toml");
  process.exit(2);
}

const container = `supabase_db_${projeto}`;
const sql = readFileSync(new URL("../supabase/tests/banco.test.sql", import.meta.url), "utf8");

const r = spawnSync(
  "docker",
  ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q"],
  { input: sql, encoding: "utf8" },
);

if (r.error) {
  console.error(`Não consegui falar com o Docker: ${r.error.message}`);
  process.exit(2);
}

// os testes avisam com "NOTICE" (vai para o stderr do psql)
const linhas = `${r.stderr}${r.stdout}`.split(/\r?\n/);
let passaram = 0;
for (const linha of linhas) {
  const m = linha.match(/(?:NOTICE|AVISO):\s+(.*)$/);
  if (m) {
    console.log(m[1]);
    if (m[1].startsWith("ok - ")) passaram++;
  } else if (linha.trim() && !/^psql:.*CONTEXT|^CONTEXT|^PL\/pgSQL|^SQL statement/.test(linha)) {
    console.error(linha);
  }
}

if (r.status !== 0) {
  console.error(`\nOs testes do banco FALHARAM (depois de ${passaram} verificações ok).`);
  process.exit(1);
}
console.log(`\n${passaram} verificações do banco passaram.`);
