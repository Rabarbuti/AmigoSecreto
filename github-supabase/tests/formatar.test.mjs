import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chaveDeEmail, dataCurta, dataHora, dataLonga, emailsParecidos, emailValido, linkDoConvite, linkWhatsapp, moeda,
  normalizarEmail, plural, separarNomes, textoDoConvite, tipoDeChave, valorDoTexto, valorParaCampo,
} from "../docs/js/formatar.js";
import { ErroApp, MSG_REDE, traduzirErro } from "../docs/js/erros.js";

test("moeda e valorParaCampo", () => {
  assert.equal(moeda(50), "R$ 50,00");
  assert.equal(moeda("1234.5"), "R$ 1.234,50");
  assert.equal(moeda(0), "R$ 0,00");
  assert.equal(moeda("abc"), "");
  assert.equal(valorParaCampo(50), "50,00");
  assert.equal(valorParaCampo("7.5"), "7,50");
  assert.equal(valorParaCampo(undefined), "");
});

test("valorDoTexto entende como a gente digita no Brasil", () => {
  const casos = {
    "50": 50, "50,00": 50, "50,5": 50.5, "R$ 50": 50, "R$ 1.234,50": 1234.5, "1.234": 1234,
    "1.234.567": 1234567, "7.5": 7.5, "0,99": 0.99, "  100  ": 100, "1.000,00": 1000, ".5": 0.5,
  };
  for (const [texto, esperado] of Object.entries(casos)) assert.equal(valorDoTexto(texto), esperado, `"${texto}"`);
  for (const ruim of ["", "   ", "abc", "1,2,3", "R$", "5 reais", "--3", "1e3", null, undefined]) {
    assert.ok(Number.isNaN(valorDoTexto(ruim)), `"${ruim}" deveria ser inválido`);
  }
});

test("datas: sem erro de fuso e em português", () => {
  assert.equal(dataLonga("2026-12-20"), "domingo, 20 de dezembro de 2026");
  assert.equal(dataLonga("2027-01-01"), "sexta-feira, 1 de janeiro de 2027");
  assert.equal(dataLonga(""), "");
  assert.equal(dataCurta("2026-12-20"), "20/12/2026");
  assert.equal(dataCurta("lixo"), "");
  assert.match(dataHora("2026-11-12T14:30:00Z"), /^\d{2}\/\d{2}\/2026 às \d{2}:\d{2}$/);
  assert.equal(dataHora("nada"), "");
});

test("separarNomes limpa, ignora vazios e repetidos e separa por linha, vírgula e ponto e vírgula", () => {
  const r = separarNomes("  Ana  Maria \n\nBruno, Carla;Davi\nana maria\nBRUNO\n");
  assert.deepEqual(r.nomes, ["Ana Maria", "Bruno", "Carla", "Davi"]);
  assert.deepEqual(r.repetidos, ["ana maria", "BRUNO"]);
  assert.deepEqual(r.longos, []);

  const com = separarNomes("Ana\nEduardo", ["ana", "Fulano"]);
  assert.deepEqual(com.nomes, ["Eduardo"]);
  assert.deepEqual(com.repetidos, ["Ana"]);

  const longo = separarNomes("x".repeat(61) + "\nOk");
  assert.deepEqual(longo.nomes, ["Ok"]);
  assert.equal(longo.longos.length, 1);
  assert.deepEqual(separarNomes("").nomes, []);
  assert.deepEqual(separarNomes(null).nomes, []);
});

test("e-mail: mesma regra do banco", () => {
  for (const bom of ["ana@exemplo.com", "  ANA@Exemplo.COM ", "a.b+c@sub.dominio.com.br", "o'brien@x.org", "a_b-c@d-e.co"]) {
    assert.ok(emailValido(bom), bom);
  }
  for (const ruim of ["", "ana", "ana@", "@x.com", "ana@x", "a b@x.com", "a@b.c>", "a@b..com", "a@-b.com", "a@b.com,c@d.com", "ana@exemplo", `${"a".repeat(250)}@x.com`]) {
    assert.ok(!emailValido(ruim), `"${ruim}" deveria ser inválido`);
  }
  assert.equal(normalizarEmail("  Ana@X.com "), "ana@x.com");
});

test("chaveDeEmail e emailsParecidos: acham e-mails repetidos e aliases do Gmail", () => {
  assert.equal(chaveDeEmail("Ana.Silva+natal@Gmail.com"), "anasilva@gmail.com");
  assert.equal(chaveDeEmail("ana.silva@googlemail.com"), "anasilva@gmail.com");
  assert.equal(chaveDeEmail("a.b+x@exemplo.com"), "a.b@exemplo.com");
  assert.equal(chaveDeEmail("sem-arroba"), "sem-arroba");

  const lista = [
    { id: "1", nome: "Ana", email: "davi@gmail.com" },
    { id: "2", nome: "Bruno", email: "da.vi+bruno@gmail.com" },
    { id: "3", nome: "Carla", email: "carla@exemplo.com" },
    { id: "4", nome: "Davi", email: "davi@gmail.com" },
    { id: "5", nome: "Elisa", email: null },
    { id: "6", nome: "Fabio", email: "f.a@exemplo.com" },
    { id: "7", nome: "Gabi", email: "fa@exemplo.com" }, // fora do Gmail os pontos contam: não é parecido
  ];
  const parecidos = emailsParecidos(lista);
  assert.deepEqual([...parecidos.keys()].sort(), ["1", "2", "4"]);
  assert.deepEqual(parecidos.get("1").sort(), ["Bruno", "Davi"]);
  assert.deepEqual(parecidos.get("2").sort(), ["Ana", "Davi"]);
  assert.equal(emailsParecidos([]).size, 0);
});

test("convite: link, texto do WhatsApp e plural", () => {
  assert.equal(linkDoConvite("https://fulano.github.io/amigo-secreto/", "abc"), "https://fulano.github.io/amigo-secreto/#/e/abc");
  const texto = textoDoConvite({ nome: "Natal", data_evento: "2026-12-20", valor: 50 }, "https://x/#/e/abc");
  assert.ok(texto.includes("Natal") && texto.includes("domingo, 20 de dezembro de 2026") && texto.includes("R$ 50,00") && texto.includes("https://x/#/e/abc"));
  assert.ok(!textoDoConvite({ nome: "N", data_evento: "2026-12-20", valor: 0 }, "l").includes("R$"));
  const url = linkWhatsapp("oi & tchau?");
  assert.equal(url, "https://wa.me/?text=oi%20%26%20tchau%3F");
  assert.equal(plural(1, "pessoa", "pessoas"), "pessoa");
  assert.equal(plural(2, "pessoa", "pessoas"), "pessoas");
});

test("tipoDeChave: reconhece chave secreta colada por engano", () => {
  const jwt = (role) =>
    `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.assinatura`;
  assert.equal(tipoDeChave("sb_publishable_abc123"), "publica");
  assert.equal(tipoDeChave("sb_secret_abc123"), "secreta");
  assert.equal(tipoDeChave(jwt("anon")), "publica");
  assert.equal(tipoDeChave(jwt("service_role")), "secreta");
  assert.equal(tipoDeChave(jwt("authenticated")), "desconhecida");
  assert.equal(tipoDeChave("qualquer coisa"), "desconhecida");
  assert.equal(tipoDeChave(""), "desconhecida");
  assert.equal(tipoDeChave(null), "desconhecida");
});

test("traduzirErro: mensagens que ajudam em vez de códigos", () => {
  assert.match(traduzirErro({ code: "invalid_credentials", message: "Invalid login credentials" }).message, /incorretos/);
  assert.match(traduzirErro({ code: "23505", message: "duplicate key" }).message, /mesmo nome|esse nome/i);
  assert.match(traduzirErro({ code: "23514", message: "Limite de 50 participantes por evento." }).message, /50/);
  assert.match(traduzirErro({ code: "42501", message: "new row violates row-level security policy" }).message, /Sem permissão/);
  assert.match(traduzirErro({ code: "PGRST202", message: "Could not find the function public.evento_publico" }).message, /migrations/);
  assert.match(traduzirErro({ code: "PGRST205", message: "Could not find the table 'public.eventos'" }).message, /migrations/);
  assert.equal(traduzirErro(new TypeError("Failed to fetch")).message, MSG_REDE);
  assert.equal(traduzirErro({ name: "AuthRetryableFetchError", message: "x" }).message, MSG_REDE);
  assert.match(traduzirErro({ code: "PGRST301", message: "JWT expired" }).message, /sessão expirou/);
  assert.equal(traduzirErro({ code: "P0001", message: "evento_nao_encontrado" }).codigo, "nao_encontrado");
  assert.equal(traduzirErro({ message: "algo novo" }).message, "algo novo");
  assert.equal(traduzirErro(null).message, "Algo deu errado. Tente de novo.");
  const ja = new ErroApp("já é nosso", { codigo: "x" });
  assert.equal(traduzirErro(ja), ja);
});
