// Regras da função "sorteio". Não conhece Deno nem supabase-js: recebe o banco e o
// correio de fora (injeção de dependências), por isso dá para testar tudo no Node.
//
// Pedidos aceitos (POST, JSON):
//   { acao: "sortear",      evento_id }                            // só se o evento ainda não tem sorteio
//   { acao: "reenviar",     evento_id, participante_id?: string }  // sem participante_id = todos os pendentes
//   { acao: "testar_email" }                                       // manda um e-mail de teste para o próprio organizador
//   { acao: "diagnostico" }                                        // diz se o envio de e-mail está configurado
// (Para sortear de novo o organizador antes cancela o sorteio: função reabrir_sorteio do banco.)
//
// Respostas: { ok: true, ... } ou { erro: "texto em português", codigo?: "..." }.
// A resposta NUNCA traz quem tirou quem.

import { montarEmailSorteio, montarEmailTeste } from "./email.ts";
import { sortearRoda } from "./sorteio.ts";
import type { Banco, Correio, Evento, Par, Participante, Usuario } from "./tipos.ts";

export class ErroHttp extends Error {
  status: number;
  extra: Record<string, unknown>;
  constructor(status: number, mensagem: string, extra: Record<string, unknown> = {}) {
    super(mensagem);
    this.status = status;
    this.extra = extra;
  }
}

export type Dependencias = {
  banco: Banco;
  /** null = os segredos do e-mail ainda não foram configurados (ou estão errados: veja problemaDoCorreio) */
  correio: Correio | null;
  /** o que está errado na configuração do e-mail, se der para dizer */
  problemaDoCorreio?: string | null;
  /** se definido, só estes e-mails (minúsculos) podem usar a função */
  organizadoresPermitidos?: string[] | null;
  /** só os testes trocam isto */
  sortear?: (ids: readonly string[]) => Par[];
  /** quantos e-mails saem ao mesmo tempo (padrão 3) */
  simultaneos?: number;
};

export type Resposta = { status: number; corpo: Record<string, unknown> };

type Pedido =
  | { acao: "diagnostico" }
  | { acao: "testar_email" }
  | { acao: "sortear"; evento_id: string }
  | { acao: "reenviar"; evento_id: string; participante_id: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const plural = (n: number, um: string, varios: string) => (n === 1 ? um : varios);

export async function executar(
  pedido: unknown,
  usuario: Usuario,
  dep: Dependencias,
): Promise<Resposta> {
  try {
    autorizar(usuario, dep);
    const p = validarPedido(pedido);
    if (p.acao === "diagnostico") return await diagnostico(usuario, dep);
    if (p.acao === "testar_email") return await testarEmail(usuario, dep);
    if (p.acao === "sortear") return await sortear(p, usuario, dep);
    return await reenviar(p, usuario, dep);
  } catch (e) {
    if (e instanceof ErroHttp) return { status: e.status, corpo: { erro: e.message, ...e.extra } };
    // Só o texto do erro vai para o log: nada de nomes, e-mails ou pares.
    console.error("sorteio: erro inesperado:", textoDoErro(e));
    return { status: 500, corpo: { erro: "Erro inesperado no servidor. Tente de novo em instantes." } };
  }
}

// ---------------------------------------------------------------- quem pode

function autorizar(usuario: Usuario, dep: Dependencias): void {
  if (usuario.anonimo) {
    throw new ErroHttp(403, "Contas anônimas não podem usar o sorteio.", { codigo: "sem_permissao" });
  }
  const permitidos = dep.organizadoresPermitidos;
  if (permitidos && permitidos.length > 0) {
    const email = usuario.email?.trim().toLowerCase();
    if (!email || !permitidos.includes(email)) {
      throw new ErroHttp(403, "Este usuário não tem permissão para usar o sorteio.", { codigo: "sem_permissao" });
    }
  }
}

// ---------------------------------------------------------------- pedidos

function validarPedido(bruto: unknown): Pedido {
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) {
    throw new ErroHttp(400, "Pedido inválido.");
  }
  const p = bruto as Record<string, unknown>;
  if (p.acao === "diagnostico") return { acao: "diagnostico" };
  if (p.acao === "testar_email") return { acao: "testar_email" };
  if (p.acao === "sortear") return { acao: "sortear", evento_id: uuid(p.evento_id, "evento_id") };
  if (p.acao === "reenviar") {
    return {
      acao: "reenviar",
      evento_id: uuid(p.evento_id, "evento_id"),
      participante_id: p.participante_id == null ? null : uuid(p.participante_id, "participante_id"),
    };
  }
  throw new ErroHttp(400, "Ação desconhecida.");
}

function uuid(valor: unknown, campo: string): string {
  if (typeof valor !== "string" || !UUID.test(valor)) throw new ErroHttp(400, `${campo} inválido.`);
  return valor.toLowerCase();
}

// ---------------------------------------------------------------- ações

async function diagnostico(usuario: Usuario, dep: Dependencias): Promise<Resposta> {
  const cota = dep.correio ? await consultarCota(dep.correio) : null;
  return ok({
    correio: dep.correio !== null,
    usuario: usuario.email,
    cota,
    problema: dep.problemaDoCorreio ?? null,
  });
}

async function sortear(
  p: Extract<Pedido, { acao: "sortear" }>,
  usuario: Usuario,
  dep: Dependencias,
): Promise<Resposta> {
  const evento = await eventoDoDono(p.evento_id, usuario, dep.banco);
  if (evento.sorteado_em) {
    throw new ErroHttp(
      409,
      'O sorteio já foi feito. Para sortear de novo, use "Refazer o sorteio": ele cancela este e libera a lista para você corrigir o que precisar.',
      { codigo: "sorteio_ja_realizado" },
    );
  }
  // Confere o e-mail ANTES de sortear: não adianta gravar um sorteio que não dá para entregar.
  if (!dep.correio) throw semCorreio(dep);

  const participantes = await dep.banco.listarParticipantes(evento.id);
  if (participantes.length < 3) {
    throw new ErroHttp(400, "Cadastre pelo menos 3 participantes para sortear.", {
      codigo: "participantes_insuficientes",
    });
  }
  const faltando = participantes.filter((x) => !x.email).map((x) => x.nome);
  if (faltando.length > 0) {
    throw new ErroHttp(400, `Ainda sem e-mail: ${faltando.join(", ")}.`, {
      codigo: "email_faltando",
      faltando,
    });
  }

  // Sorteio que o Gmail não consegue entregar inteiro deixaria gente com o resultado antigo:
  // se a cota do dia não cobre todo mundo, nem começa.
  const precisa = participantes.length;
  const cota = await consultarCota(dep.correio);
  if (cota !== null && cota < precisa) {
    throw new ErroHttp(
      409,
      `O Gmail só deixa enviar mais ${cota} ${plural(cota, "e-mail", "e-mails")} hoje, e este sorteio precisa de ${precisa}. ` +
        "Tente amanhã: a cota renova em 24 horas.",
      { codigo: "cota_insuficiente", cota, precisa },
    );
  }

  const pares = (dep.sortear ?? sortearRoda)(participantes.map((x) => x.id));
  let numero: number;
  try {
    numero = await dep.banco.gravarSorteio(evento.id, pares);
  } catch (e) {
    throw traduzirErroBanco(e);
  }

  const resultado = await enviarLote(dep, { ...evento, sorteio_numero: numero }, participantes, pares, participantes);
  return ok({ total: precisa, numero, ...resultado });
}

async function reenviar(
  p: Extract<Pedido, { acao: "reenviar" }>,
  usuario: Usuario,
  dep: Dependencias,
): Promise<Resposta> {
  const evento = await eventoDoDono(p.evento_id, usuario, dep.banco);
  if (!evento.sorteado_em) {
    throw new ErroHttp(409, "O sorteio ainda não foi feito.", { codigo: "sem_sorteio" });
  }
  if (!dep.correio) throw semCorreio(dep);

  const participantes = await dep.banco.listarParticipantes(evento.id);
  const alvos = p.participante_id
    ? participantes.filter((x) => x.id === p.participante_id)
    : participantes.filter((x) => !x.email_enviado_em);
  if (p.participante_id && alvos.length === 0) {
    throw new ErroHttp(404, "Participante não encontrado neste evento.");
  }

  const pares = alvos.length > 0 ? await dep.banco.lerSorteio(evento.id) : [];
  const resultado = await enviarLote(dep, evento, participantes, pares, alvos);
  return ok({ total: alvos.length, numero: evento.sorteio_numero, ...resultado });
}

async function testarEmail(usuario: Usuario, dep: Dependencias): Promise<Resposta> {
  if (!dep.correio) throw semCorreio(dep);
  if (!usuario.email) throw new ErroHttp(400, "O seu usuário não tem e-mail cadastrado.");
  try {
    await dep.correio.enviar({ para: usuario.email, ...montarEmailTeste() });
  } catch (e) {
    throw new ErroHttp(502, textoDoErro(e), { codigo: "falha_no_envio" });
  }
  return ok({ enviado_para: usuario.email });
}

// ---------------------------------------------------------------- envio

type Falha = { participante_id: string; nome: string; erro: string };

/**
 * Envia o e-mail de cada alvo, no máximo `simultaneos` por vez. Uma falha não derruba as outras.
 * `evento.sorteio_numero` é o número do sorteio que está sendo entregue.
 */
async function enviarLote(
  dep: Dependencias,
  evento: Evento,
  todos: Participante[],
  pares: Par[],
  alvos: Participante[],
): Promise<{ enviados: number; falhas: Falha[]; interrompido?: true }> {
  const correio = dep.correio as Correio;
  const nomePorId = new Map(todos.map((x) => [x.id, x.nome]));
  const tiradoPorId = new Map(pares.map((x) => [x.de, x.para]));
  const falhas: Falha[] = [];
  let enviados = 0;
  let interrompido = false;

  await executarComLimite(alvos, dep.simultaneos ?? 3, async (alvo) => {
    if (interrompido) return;
    try {
      // Se o sorteio foi cancelado ou refeito enquanto os e-mails saíam, os pares que esta
      // chamada tem na memória já são antigos: para por aqui, sem mandar nem registrar mais nada.
      const atual = await dep.banco.buscarEvento(evento.id);
      if (!atual || atual.sorteado_em === null || atual.sorteio_numero !== evento.sorteio_numero) {
        interrompido = true;
        return;
      }

      const tirado = nomePorId.get(tiradoPorId.get(alvo.id) ?? "");
      if (!tirado) throw new Error("Não achei quem esta pessoa tirou.");
      if (!alvo.email) throw new Error("Sem e-mail cadastrado.");
      const mensagem = montarEmailSorteio({
        nomeDestinatario: alvo.nome,
        nomeTirado: tirado,
        evento,
        numero: evento.sorteio_numero,
      });
      await correio.enviar({ para: alvo.email, ...mensagem });
      await dep.banco.marcarEnvio(alvo.id, null);
      enviados++;
    } catch (e) {
      const erro = textoDoErro(e);
      falhas.push({ participante_id: alvo.id, nome: alvo.nome, erro });
      try {
        await dep.banco.marcarEnvio(alvo.id, erro);
      } catch {
        // se nem o aviso de falha grava, a resposta ainda leva a falha para a tela
      }
    }
  });

  return interrompido ? { enviados, falhas, interrompido: true } : { enviados, falhas };
}

/** Roda `fn` para cada item, com no máximo `limite` ao mesmo tempo. */
export async function executarComLimite<T>(
  itens: readonly T[],
  limite: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let proximo = 0;
  const trabalhadores = Array.from({ length: Math.max(1, Math.min(limite, itens.length)) }, async () => {
    while (proximo < itens.length) {
      const atual = itens[proximo++];
      await fn(atual);
    }
  });
  await Promise.all(trabalhadores);
}

// ---------------------------------------------------------------- apoio

async function eventoDoDono(eventoId: string, usuario: Usuario, banco: Banco): Promise<Evento> {
  const evento = await banco.buscarEvento(eventoId);
  // Mesma resposta para "não existe" e "é de outra pessoa": não revela que o id existe.
  if (!evento || evento.dono_id !== usuario.id) throw new ErroHttp(404, "Evento não encontrado.");
  return evento;
}

/** Quantos e-mails o Gmail ainda deixa mandar hoje; null se a ponte não souber (ou falhar): nesse caso não bloqueia. */
async function consultarCota(correio: Correio): Promise<number | null> {
  if (!correio.cota) return null;
  try {
    const cota = await correio.cota();
    return typeof cota === "number" && Number.isFinite(cota) ? cota : null;
  } catch {
    return null;
  }
}

function semCorreio(dep: Dependencias): ErroHttp {
  const mensagem = dep.problemaDoCorreio
    ? `O envio de e-mail está mal configurado: ${dep.problemaDoCorreio}`
    : "O envio de e-mail ainda não foi configurado na função (APPS_SCRIPT_URL e APPS_SCRIPT_SEGREDO). Veja o README.";
  return new ErroHttp(503, mensagem, { codigo: "correio_nao_configurado" });
}

function traduzirErroBanco(e: unknown): ErroHttp {
  const msg = textoDoErro(e);
  if (msg.includes("sorteio_ja_realizado")) {
    return new ErroHttp(409, "O sorteio já foi feito.", { codigo: "sorteio_ja_realizado" });
  }
  if (msg.includes("participantes_insuficientes")) {
    return new ErroHttp(400, "Cadastre pelo menos 3 participantes para sortear.", {
      codigo: "participantes_insuficientes",
    });
  }
  if (msg.includes("email_faltando")) {
    return new ErroHttp(400, "Ainda há participantes sem e-mail.", { codigo: "email_faltando" });
  }
  if (msg.includes("evento_nao_encontrado")) return new ErroHttp(404, "Evento não encontrado.");
  console.error("sorteio: erro do banco:", msg);
  return new ErroHttp(500, "Não consegui gravar o sorteio. Nada foi enviado.");
}

function ok(corpo: Record<string, unknown>): Resposta {
  return { status: 200, corpo: { ok: true, ...corpo } };
}

/** Erros do supabase-js são objetos simples ({ message, code }), não instâncias de Error. */
export function textoDoErro(e: unknown): string {
  let texto: string;
  if (e instanceof Error) texto = e.message;
  else if (e && typeof e === "object" && "message" in e) texto = String((e as { message: unknown }).message);
  else texto = String(e);
  return texto.replace(/\s+/g, " ").trim().slice(0, 300);
}
