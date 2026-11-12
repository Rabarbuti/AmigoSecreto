// Tipos compartilhados da função "sorteio". Só tipos: nada aqui roda.

/** Uma flecha do sorteio: "de" tirou "para" (ids de participantes). */
export type Par = { de: string; para: string };

export type Evento = {
  id: string;
  dono_id: string;
  nome: string;
  data_evento: string; // AAAA-MM-DD
  valor: number;
  recado: string | null;
  sorteado_em: string | null;
  /** quantos sorteios o evento já teve (1 = o primeiro) */
  sorteio_numero: number;
};

export type Participante = {
  id: string;
  evento_id: string;
  nome: string;
  email: string | null;
  email_enviado_em: string | null;
  erro_envio: string | null;
};

export type Mensagem = { para: string; assunto: string; html: string; texto: string };

/** Quem sabe entregar um e-mail. Joga um Error (com texto legível) se não conseguir. */
export interface Correio {
  enviar(mensagem: Mensagem): Promise<void>;
  /** Quantos e-mails ainda dá para mandar hoje; null se não der para saber. */
  cota?(): Promise<number | null>;
}

/** Tudo que a função precisa do banco. A implementação real usa o supabase-js (index.ts). */
export interface Banco {
  buscarEvento(id: string): Promise<Evento | null>;
  listarParticipantes(eventoId: string): Promise<Participante[]>;
  /** Grava o sorteio (só se o evento ainda não tem um) e devolve o número dele (1, 2, 3...). */
  gravarSorteio(eventoId: string, pares: Par[]): Promise<number>;
  lerSorteio(eventoId: string): Promise<Par[]>;
  /** erro = null: e-mail entregue; erro = texto: falhou (guarda o motivo). */
  marcarEnvio(participanteId: string, erro: string | null): Promise<void>;
}

export type Usuario = { id: string; email: string | null; /** conta "anônima" do Supabase */ anonimo?: boolean };
