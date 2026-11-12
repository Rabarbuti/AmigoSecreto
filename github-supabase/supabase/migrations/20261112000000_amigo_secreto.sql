-- =====================================================================
-- Amigo Secreto — banco de dados (Supabase / Postgres)
--
-- Como aplicar no projeto de verdade (escolha UMA forma):
--   a) Painel do Supabase > SQL Editor > New query > cole este arquivo > Run.
--   b) Pelo terminal:  npx supabase link --project-ref <ref>  e depois  npx supabase db push
--
-- Modelo de segurança (resumo):
--   * Só o dono do evento (usuário logado) lê/edita o próprio evento e os participantes dele.
--   * Quem recebe o link (sem login) só consegue duas coisas, via funções abaixo:
--       - ver nome/data/valor do evento e a lista de NOMES (sem e-mails);
--       - informar o e-mail do próprio nome, uma única vez.
--   * Quem sorteou quem fica no schema "private", que a API do Supabase não expõe.
--     Só a função de sorteio (com a chave secreta do servidor) lê e grava ali.
--   * Depois do sorteio a lista fica TRAVADA (nomes e e-mails). Sem isso o organizador poderia
--     trocar o e-mail de alguém pelo dele e mandar "reenviar", recebendo o resultado dessa pessoa
--     sem ela perceber. Para mudar algo ele cancela o sorteio (reabrir_sorteio) e sorteia de novo.
-- =====================================================================

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------

create table public.eventos (
  id             uuid primary key default gen_random_uuid(),
  dono_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  nome           text not null,
  data_evento    date not null,
  valor          numeric(10, 2) not null,
  recado         text,
  -- Código do link que vai para os participantes. Não dá acesso a nada além do que
  -- as funções evento_publico() e confirmar_email() devolvem.
  token_publico  uuid not null unique default gen_random_uuid(),
  sorteado_em    timestamptz,
  -- Quantos sorteios o evento já teve (1 = o primeiro). Vai no assunto dos e-mails de um sorteio
  -- refeito para ninguém confundir o resultado novo com o antigo.
  sorteio_numero int not null default 0,
  criado_em      timestamptz not null default now(),
  constraint eventos_nome_ok   check (char_length(nome) between 1 and 80),
  constraint eventos_valor_ok  check (valor between 0 and 100000),
  constraint eventos_recado_ok check (recado is null or char_length(recado) <= 280)
);

create index eventos_dono_idx on public.eventos (dono_id, data_evento desc);

create table public.participantes (
  id               uuid primary key default gen_random_uuid(),
  evento_id        uuid not null references public.eventos (id) on delete cascade,
  nome             text not null,
  email            text,
  -- Preenchidos só pela função de sorteio (o dono do evento não consegue gravar aqui).
  email_enviado_em timestamptz,
  erro_envio       text,
  criado_em        timestamptz not null default now(),
  constraint participantes_nome_ok  check (char_length(nome) between 1 and 60),
  constraint participantes_email_ok check (
    email is null or (
      char_length(email) <= 254
      and email ~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$'
    )
  )
);

create unique index participantes_nome_unico on public.participantes (evento_id, lower(nome));
create index participantes_evento_idx on public.participantes (evento_id);

-- Quem tirou quem. Fica fora do schema "public" de propósito (a API não enxerga).
create table private.sorteios (
  evento_id       uuid not null references public.eventos (id) on delete cascade,
  participante_id uuid not null references public.participantes (id) on delete cascade,
  tirou_id        uuid not null references public.participantes (id) on delete cascade,
  primary key (participante_id),
  unique (tirou_id),
  check (participante_id <> tirou_id)
);

create index sorteios_evento_idx on private.sorteios (evento_id);

-- ---------------------------------------------------------------------
-- Gatilhos: padronizam os textos e protegem regras que não dependem da tela
-- ---------------------------------------------------------------------

create function private.normalizar_evento() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.nome   := btrim(regexp_replace(new.nome, '\s+', ' ', 'g'));
  new.recado := nullif(btrim(regexp_replace(coalesce(new.recado, ''), '\s+', ' ', 'g')), '');
  return new;
end;
$$;

create trigger eventos_normalizar
  before insert or update on public.eventos
  for each row execute function private.normalizar_evento();

create function private.normalizar_participante() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.nome := btrim(regexp_replace(new.nome, '\s+', ' ', 'g'));
  if new.email is not null then
    new.email := nullif(lower(btrim(new.email)), '');
  end if;
  -- Se o e-mail mudou, o envio anterior (para o endereço antigo) não vale mais.
  if tg_op = 'UPDATE' and new.email is distinct from old.email then
    new.email_enviado_em := null;
    new.erro_envio := null;
  end if;
  return new;
end;
$$;

create trigger participantes_normalizar
  before insert or update on public.participantes
  for each row execute function private.normalizar_participante();

create function private.limitar_participantes() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.participantes where evento_id = new.evento_id) >= 50 then
    raise exception 'Limite de 50 participantes por evento.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger participantes_limite
  before insert on public.participantes
  for each row execute function private.limitar_participantes();

-- ---------------------------------------------------------------------
-- Permissões das tabelas. O Supabase costuma liberar tudo para anon/authenticated
-- por padrão; aqui tiramos tudo e devolvemos só o necessário, coluna por coluna.
-- ---------------------------------------------------------------------

revoke all on public.eventos, public.participantes from public, anon, authenticated;
revoke all on private.sorteios from public, anon, authenticated;

-- Funções de gatilho: o Postgres libera "executar" para todo mundo por padrão. Os gatilhos
-- continuam disparando normalmente; só ninguém consegue chamá-las diretamente.
revoke all on function private.normalizar_evento()       from public, anon, authenticated;
revoke all on function private.normalizar_participante() from public, anon, authenticated;
revoke all on function private.limitar_participantes()   from public, anon, authenticated;

grant select on public.eventos to authenticated;
grant insert (nome, data_evento, valor, recado) on public.eventos to authenticated;
grant update (nome, data_evento, valor, recado) on public.eventos to authenticated;
grant delete on public.eventos to authenticated;

grant select on public.participantes to authenticated;
grant insert (evento_id, nome, email) on public.participantes to authenticated;
grant update (nome, email) on public.participantes to authenticated;
grant delete on public.participantes to authenticated;

-- A função de sorteio roda com a chave secreta (papel service_role).
grant all on public.eventos, public.participantes to service_role;

-- ---------------------------------------------------------------------
-- Row Level Security: cada pessoa só enxerga o que é dela
-- ---------------------------------------------------------------------

alter table public.eventos       enable row level security;
alter table public.participantes enable row level security;
alter table private.sorteios     enable row level security;  -- sem políticas = ninguém, além do servidor

-- Contas "anônimas" do Supabase (se alguém um dia ligar essa opção) também são "authenticated":
-- elas não podem criar nem ver eventos.
create policy eventos_do_dono on public.eventos
  for all to authenticated
  using (
    dono_id = (select auth.uid())
    and not coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false)
  )
  with check (
    dono_id = (select auth.uid())
    and not coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false)
  );

create policy participantes_ler on public.participantes
  for select to authenticated
  using (exists (
    select 1 from public.eventos e
    where e.id = participantes.evento_id and e.dono_id = (select auth.uid())
  ));

-- DEPOIS DO SORTEIO A LISTA FICA TRAVADA: ninguém entra, sai nem troca de e-mail. Se o organizador
-- pudesse trocar o e-mail de alguém e mandar "reenviar", receberia o resultado dessa pessoa sem
-- que ela percebesse. Para mudar qualquer coisa ele cancela o sorteio (reabrir_sorteio): todo mundo
-- então recebe um e-mail novo avisando que o resultado anterior não vale mais.
create policy participantes_inserir on public.participantes
  for insert to authenticated
  with check (exists (
    select 1 from public.eventos e
    where e.id = participantes.evento_id and e.dono_id = (select auth.uid()) and e.sorteado_em is null
  ));

create policy participantes_editar on public.participantes
  for update to authenticated
  using (exists (
    select 1 from public.eventos e
    where e.id = participantes.evento_id and e.dono_id = (select auth.uid()) and e.sorteado_em is null
  ))
  with check (exists (
    select 1 from public.eventos e
    where e.id = participantes.evento_id and e.dono_id = (select auth.uid()) and e.sorteado_em is null
  ));

create policy participantes_apagar on public.participantes
  for delete to authenticated
  using (exists (
    select 1 from public.eventos e
    where e.id = participantes.evento_id and e.dono_id = (select auth.uid()) and e.sorteado_em is null
  ));

-- ---------------------------------------------------------------------
-- Funções abertas a quem tem o link (sem login)
-- ---------------------------------------------------------------------

-- O que a página do participante mostra. Nunca devolve e-mails.
create function public.evento_publico(p_token uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'nome',        e.nome,
    'data_evento', e.data_evento,
    'valor',       e.valor,
    'recado',      e.recado,
    'sorteado',    e.sorteado_em is not null,
    'participantes', coalesce((
      select jsonb_agg(
               jsonb_build_object('id', p.id, 'nome', p.nome, 'confirmado', p.email is not null)
               order by lower(p.nome)
             )
      from public.participantes p
      where p.evento_id = e.id
    ), '[]'::jsonb)
  )
  from public.eventos e
  where e.token_publico = p_token;
$$;

-- Um participante liga o próprio nome a um e-mail. Quem chega primeiro leva: depois
-- disso só o organizador consegue trocar (assim ninguém sobrescreve o e-mail de outro).
create function public.confirmar_email(p_token uuid, p_participante_id uuid, p_email text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_evento public.eventos;
  v_email  text := lower(btrim(coalesce(p_email, '')));
  v_nome   text;
begin
  select * into v_evento from public.eventos where token_publico = p_token;
  if not found then
    return jsonb_build_object('ok', false, 'erro', 'evento_nao_encontrado');
  end if;
  if v_evento.sorteado_em is not null then
    return jsonb_build_object('ok', false, 'erro', 'sorteio_ja_realizado');
  end if;
  if char_length(v_email) > 254
     or v_email !~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$'
  then
    return jsonb_build_object('ok', false, 'erro', 'email_invalido');
  end if;

  update public.participantes
     set email = v_email
   where id = p_participante_id
     and evento_id = v_evento.id
     and email is null
  returning nome into v_nome;

  if not found then
    if exists (select 1 from public.participantes where id = p_participante_id and evento_id = v_evento.id) then
      return jsonb_build_object('ok', false, 'erro', 'ja_confirmado');
    end if;
    return jsonb_build_object('ok', false, 'erro', 'participante_nao_encontrado');
  end if;

  return jsonb_build_object('ok', true, 'nome', v_nome);
end;
$$;

-- Usada pela página de diagnóstico para saber se este SQL já foi aplicado.
create function public.versao_do_esquema() returns int
language sql
immutable
set search_path = ''
as $$ select 1 $$;

-- ---------------------------------------------------------------------
-- Funções só do servidor (papel service_role): gravar e ler o sorteio
-- ---------------------------------------------------------------------

-- Grava os pares de uma vez só (tudo ou nada) e devolve o número do sorteio (1, 2, 3...).
-- p_pares = [{"de": "<id>", "para": "<id>"}, ...]. Só grava se o evento ainda não tem sorteio:
-- para sortear de novo é preciso antes cancelar o atual (reabrir_sorteio).
create function public.gravar_sorteio(p_evento_id uuid, p_pares jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sorteado_em timestamptz;
  v_numero      int;
  v_total       int;
begin
  select sorteado_em, sorteio_numero into v_sorteado_em, v_numero
    from public.eventos where id = p_evento_id for update;
  if not found then
    raise exception 'evento_nao_encontrado';
  end if;
  if v_sorteado_em is not null then
    raise exception 'sorteio_ja_realizado';
  end if;

  select count(*) into v_total from public.participantes where evento_id = p_evento_id;
  if v_total < 3 then
    raise exception 'participantes_insuficientes';
  end if;
  if exists (select 1 from public.participantes where evento_id = p_evento_id and email is null) then
    raise exception 'email_faltando';
  end if;

  -- Cada participante aparece uma vez como "de" e uma vez como "para", ninguém tira a si mesmo.
  if jsonb_typeof(p_pares) <> 'array'
     or jsonb_array_length(p_pares) <> v_total
     or exists (select 1 from jsonb_array_elements(p_pares) x where x->>'de' = x->>'para')
     or (select count(distinct (x->>'de')::uuid) from jsonb_array_elements(p_pares) x
          where (x->>'de')::uuid in (select id from public.participantes where evento_id = p_evento_id)) <> v_total
     or (select count(distinct (x->>'para')::uuid) from jsonb_array_elements(p_pares) x
          where (x->>'para')::uuid in (select id from public.participantes where evento_id = p_evento_id)) <> v_total
  then
    raise exception 'pares_invalidos';
  end if;

  delete from private.sorteios where evento_id = p_evento_id;
  insert into private.sorteios (evento_id, participante_id, tirou_id)
    select p_evento_id, (x->>'de')::uuid, (x->>'para')::uuid
    from jsonb_array_elements(p_pares) x;

  update public.participantes set email_enviado_em = null, erro_envio = null where evento_id = p_evento_id;
  update public.eventos
     set sorteado_em = now(), sorteio_numero = v_numero + 1
   where id = p_evento_id
  returning sorteio_numero into v_numero;
  return v_numero;
end;
$$;

create function public.ler_sorteio(p_evento_id uuid)
returns table (participante_id uuid, tirou_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select s.participante_id, s.tirou_id
  from private.sorteios s
  where s.evento_id = p_evento_id;
$$;

-- ---------------------------------------------------------------------
-- Cancelar o sorteio (só o dono do evento)
-- ---------------------------------------------------------------------

-- Apaga os pares e libera a lista para o organizador corrigir nomes e e-mails. Não mostra nada:
-- só destrói. Depois é preciso sortear de novo, e aí todo mundo recebe um e-mail novo avisando
-- que o resultado anterior não vale mais (o número do sorteio continua subindo).
create function public.reabrir_sorteio(p_evento_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.eventos
   where id = p_evento_id
     and dono_id = (select auth.uid())
     and not coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false)
  for update;
  if not found then
    raise exception 'evento_nao_encontrado';
  end if;

  delete from private.sorteios where evento_id = p_evento_id;
  update public.participantes set email_enviado_em = null, erro_envio = null where evento_id = p_evento_id;
  update public.eventos set sorteado_em = null where id = p_evento_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Quem pode chamar cada função
-- ---------------------------------------------------------------------

revoke all on function public.evento_publico(uuid)              from public, anon, authenticated;
revoke all on function public.confirmar_email(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.versao_do_esquema()               from public, anon, authenticated;
revoke all on function public.gravar_sorteio(uuid, jsonb)       from public, anon, authenticated;
revoke all on function public.ler_sorteio(uuid)                 from public, anon, authenticated;
revoke all on function public.reabrir_sorteio(uuid)             from public, anon, authenticated;

grant execute on function public.evento_publico(uuid)              to anon, authenticated;
grant execute on function public.confirmar_email(uuid, uuid, text) to anon, authenticated;
grant execute on function public.versao_do_esquema()               to anon, authenticated;
grant execute on function public.reabrir_sorteio(uuid)             to authenticated;

grant execute on function public.gravar_sorteio(uuid, jsonb) to service_role;
grant execute on function public.ler_sorteio(uuid)           to service_role;

-- Pede para a API recarregar o catálogo e enxergar as funções novas.
notify pgrst, 'reload schema';
