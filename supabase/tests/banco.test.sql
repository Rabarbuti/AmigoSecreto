-- =====================================================================
-- Testes do banco: permissões, RLS e funções. Tudo roda dentro de uma transação que é
-- DESFEITA no final (não sobra nenhum dado).
--
-- Uso:  npm run banco:iniciar   (liga o Supabase local, precisa do Docker)
--       npm run test:banco
-- =====================================================================

begin;

-- ---------------------------------------------------------------- ajudantes
create function public.t_igual(descricao text, obtido anyelement, esperado anyelement) returns void
language plpgsql as $$
begin
  if obtido is distinct from esperado then
    raise exception 'FALHOU - %: esperado [%], obtido [%]', descricao, esperado, obtido;
  end if;
  raise notice 'ok - %', descricao;
end $$;

-- Executa o comando e exige que ele dê erro com o trecho dado na mensagem.
create function public.t_falha(descricao text, comando text, trecho text) returns void
language plpgsql as $$
begin
  begin
    execute comando;
  exception when others then
    if position(lower(trecho) in lower(sqlerrm)) = 0 then
      raise exception 'FALHOU - %: o erro foi [%] (esperava algo com [%])', descricao, sqlerrm, trecho;
    end if;
    raise notice 'ok - %', descricao;
    return;
  end;
  raise exception 'FALHOU - %: deveria ter dado erro', descricao;
end $$;

-- Troca de papel como a API do Supabase faz: anon, authenticated (com o id do usuário) ou service_role.
-- `extra` acrescenta dados ao token (ex.: '{"is_anonymous": true}').
create function public.t_como(papel text, usuario uuid default null, extra jsonb default '{}'::jsonb) returns void
language plpgsql as $$
begin
  reset role;
  perform set_config(
    'request.jwt.claims',
    (case when usuario is null then jsonb_build_object('role', papel)
          else jsonb_build_object('sub', usuario, 'role', papel) end || extra)::text,
    true
  );
  execute format('set local role %I', papel);
end $$;

create function public.t_guardar(chave text, valor anyelement) returns void
language plpgsql as $$
begin
  perform set_config('t.' || chave, valor::text, true);
end $$;

create function public.t_ler(chave text) returns text
language sql as $$ select current_setting('t.' || chave) $$;

-- ---------------------------------------------------------------- preparo (como administrador)
insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'dono@exemplo.com'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'outro@exemplo.com');

-- ---------------------------------------------------------------- 1. permissões básicas
do $$
begin
  perform public.t_igual('RLS ligado em eventos',       (select relrowsecurity from pg_class where oid = 'public.eventos'::regclass), true);
  perform public.t_igual('RLS ligado em participantes', (select relrowsecurity from pg_class where oid = 'public.participantes'::regclass), true);
  perform public.t_igual('RLS ligado em private.sorteios', (select relrowsecurity from pg_class where oid = 'private.sorteios'::regclass), true);

  perform public.t_igual('anon não tem nenhum privilégio em eventos',
    has_any_column_privilege('anon', 'public.eventos', 'select,insert,update') or has_table_privilege('anon', 'public.eventos', 'delete,truncate,references,trigger'), false);
  perform public.t_igual('anon não tem nenhum privilégio em participantes',
    has_any_column_privilege('anon', 'public.participantes', 'select,insert,update') or has_table_privilege('anon', 'public.participantes', 'delete,truncate,references,trigger'), false);
  perform public.t_igual('authenticated não faz truncate/references/trigger',
    has_table_privilege('authenticated', 'public.eventos', 'truncate,references,trigger')
      or has_table_privilege('authenticated', 'public.participantes', 'truncate,references,trigger'), false);

  perform public.t_igual('anon não executa gravar_sorteio', has_function_privilege('anon', 'public.gravar_sorteio(uuid,jsonb)', 'execute'), false);
  perform public.t_igual('authenticated não executa gravar_sorteio', has_function_privilege('authenticated', 'public.gravar_sorteio(uuid,jsonb)', 'execute'), false);
  perform public.t_igual('anon não executa ler_sorteio', has_function_privilege('anon', 'public.ler_sorteio(uuid)', 'execute'), false);
  perform public.t_igual('authenticated não executa ler_sorteio', has_function_privilege('authenticated', 'public.ler_sorteio(uuid)', 'execute'), false);
  perform public.t_igual('service_role executa gravar_sorteio', has_function_privilege('service_role', 'public.gravar_sorteio(uuid,jsonb)', 'execute'), true);
  perform public.t_igual('anon não executa reabrir_sorteio', has_function_privilege('anon', 'public.reabrir_sorteio(uuid)', 'execute'), false);
  perform public.t_igual('authenticated executa reabrir_sorteio (a função confere o dono)', has_function_privilege('authenticated', 'public.reabrir_sorteio(uuid)', 'execute'), true);
  perform public.t_igual('anon executa evento_publico', has_function_privilege('anon', 'public.evento_publico(uuid)', 'execute'), true);
  perform public.t_igual('anon executa confirmar_email', has_function_privilege('anon', 'public.confirmar_email(uuid,uuid,text)', 'execute'), true);
  perform public.t_igual('anon não usa o schema private', has_schema_privilege('anon', 'private', 'usage'), false);
  perform public.t_igual('authenticated não usa o schema private', has_schema_privilege('authenticated', 'private', 'usage'), false);
  perform public.t_igual('anon não executa gatilhos do schema private', has_function_privilege('anon', 'private.normalizar_participante()', 'execute'), false);
end $$;

-- ---------------------------------------------------------------- 2. o dono cria evento e participantes
do $$
declare
  v_ev public.eventos;
  v_p  public.participantes;
begin
  perform public.t_como('authenticated', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

  insert into public.eventos (nome, data_evento, valor, recado)
    values ('  Natal   da  Família ', '2026-12-20', 50, '  Troca   às 20h ')
    returning * into v_ev;
  perform public.t_igual('evento: nome sem espaços sobrando', v_ev.nome, 'Natal da Família');
  perform public.t_igual('evento: recado sem espaços sobrando', v_ev.recado, 'Troca às 20h');
  perform public.t_igual('evento: o dono é quem criou', v_ev.dono_id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid);
  perform public.t_igual('evento: nasce sem sorteio', v_ev.sorteado_em is null, true);
  perform public.t_igual('evento: ganhou um token', v_ev.token_publico is not null, true);
  perform public.t_guardar('ev', v_ev.id);
  perform public.t_guardar('token', v_ev.token_publico);

  perform public.t_falha('evento: nome vazio é recusado',
    $q$insert into public.eventos (nome, data_evento, valor) values ('   ', '2026-12-20', 10)$q$, 'eventos_nome_ok');
  perform public.t_falha('evento: valor negativo é recusado',
    $q$insert into public.eventos (nome, data_evento, valor) values ('X', '2026-12-20', -1)$q$, 'eventos_valor_ok');
  perform public.t_falha('evento: não dá para escolher o dono na criação',
    $q$insert into public.eventos (dono_id, nome, data_evento, valor) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'X', '2026-12-20', 10)$q$, 'permission denied');

  insert into public.participantes (evento_id, nome) values (v_ev.id, '  Ana   Maria ') returning * into v_p;
  perform public.t_igual('participante: nome sem espaços sobrando', v_p.nome, 'Ana Maria');
  perform public.t_guardar('ana', v_p.id);
  insert into public.participantes (evento_id, nome) values (v_ev.id, 'Bruno') returning * into v_p;
  perform public.t_guardar('bruno', v_p.id);
  insert into public.participantes (evento_id, nome) values (v_ev.id, 'Carla') returning * into v_p;
  perform public.t_guardar('carla', v_p.id);
  insert into public.participantes (evento_id, nome, email) values (v_ev.id, 'Davi', '  DAVI@Exemplo.COM ') returning * into v_p;
  perform public.t_guardar('davi', v_p.id);
  perform public.t_igual('participante: e-mail digitado pelo dono vira minúsculo e sem espaços', v_p.email, 'davi@exemplo.com');

  perform public.t_falha('participante: nome repetido (até com outra caixa) é recusado',
    format('insert into public.participantes (evento_id, nome) values (%L, %L)', v_ev.id, 'ANA maria'), 'participantes_nome_unico');
  perform public.t_falha('participante: e-mail com espaço é recusado',
    format('update public.participantes set email = %L where id = %L', 'a b@c.com', public.t_ler('ana')::uuid), 'participantes_email_ok');
  perform public.t_falha('participante: e-mail sem ponto no domínio é recusado',
    format('update public.participantes set email = %L where id = %L', 'x@y', public.t_ler('ana')::uuid), 'participantes_email_ok');
  perform public.t_falha('participante: e-mail com sinal estranho é recusado',
    format('update public.participantes set email = %L where id = %L', 'a@b.c>', public.t_ler('ana')::uuid), 'participantes_email_ok');
  perform public.t_falha('participante: e-mail com vírgula é recusado',
    format('update public.participantes set email = %L where id = %L', 'a@b.com,c@d.com', public.t_ler('ana')::uuid), 'participantes_email_ok');

  -- limite de 50 por evento (já tem 4)
  for i in 1..46 loop
    insert into public.participantes (evento_id, nome) values (v_ev.id, 'Extra ' || i);
  end loop;
  perform public.t_falha('limite de 50 participantes por evento',
    format('insert into public.participantes (evento_id, nome) values (%L, %L)', v_ev.id, 'Extra 47'), 'Limite de 50');
  delete from public.participantes where evento_id = v_ev.id and nome like 'Extra %';
  perform public.t_igual('voltou a ter 4 participantes', (select count(*)::int from public.participantes where evento_id = v_ev.id), 4);
end $$;

-- ---------------------------------------------------------------- 3. o dono não mexe no que é do servidor
do $$
declare
  v_ev  uuid := public.t_ler('ev')::uuid;
  v_ana uuid := public.t_ler('ana')::uuid;
begin
  perform public.t_como('authenticated', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  perform public.t_falha('dono não grava sorteado_em', format('update public.eventos set sorteado_em = now() where id = %L', v_ev), 'permission denied');
  perform public.t_falha('dono não troca o token', format('update public.eventos set token_publico = gen_random_uuid() where id = %L', v_ev), 'permission denied');
  perform public.t_falha('dono não troca o dono', format('update public.eventos set dono_id = %L where id = %L', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', v_ev), 'permission denied');
  perform public.t_falha('dono não grava email_enviado_em', format('update public.participantes set email_enviado_em = now() where id = %L', v_ana), 'permission denied');
  perform public.t_falha('dono não grava erro_envio', format('update public.participantes set erro_envio = %L where id = %L', 'x', v_ana), 'permission denied');
  perform public.t_falha('dono não muda o participante de evento', format('update public.participantes set evento_id = gen_random_uuid() where id = %L', v_ana), 'permission denied');
  perform public.t_falha('dono não lê o schema private', 'select * from private.sorteios', 'permission denied');
  perform public.t_falha('dono não chama ler_sorteio', format('select * from public.ler_sorteio(%L)', v_ev), 'permission denied');
  perform public.t_falha('dono não chama gravar_sorteio', format($q$select public.gravar_sorteio(%L, '[]'::jsonb)$q$, v_ev), 'permission denied');
end $$;

-- ---------------------------------------------------------------- 4. outro organizador não enxerga nem mexe
do $$
declare
  v_ev uuid := public.t_ler('ev')::uuid;
  n int;
begin
  perform public.t_como('authenticated', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  perform public.t_igual('outro usuário não vê meus eventos', (select count(*)::int from public.eventos), 0);
  perform public.t_igual('outro usuário não vê meus participantes', (select count(*)::int from public.participantes), 0);
  perform public.t_falha('outro usuário não insere participante no meu evento',
    format('insert into public.participantes (evento_id, nome) values (%L, %L)', v_ev, 'Intruso'), 'row-level security');

  update public.eventos set nome = 'Hackeado' where id = v_ev;
  get diagnostics n = row_count;
  perform public.t_igual('outro usuário não consegue editar meu evento', n, 0);
  delete from public.eventos where id = v_ev;
  get diagnostics n = row_count;
  perform public.t_igual('outro usuário não consegue apagar meu evento', n, 0);
  update public.participantes set nome = 'Hackeado' where evento_id = v_ev;
  get diagnostics n = row_count;
  perform public.t_igual('outro usuário não consegue editar meus participantes', n, 0);
  delete from public.participantes where evento_id = v_ev;
  get diagnostics n = row_count;
  perform public.t_igual('outro usuário não consegue apagar meus participantes', n, 0);

  -- e ele tem o próprio evento, com um participante (usado no teste do link público)
  declare
    v_meu public.eventos;
    v_p public.participantes;
  begin
    insert into public.eventos (nome, data_evento, valor) values ('Evento do outro', '2026-12-24', 30) returning * into v_meu;
    insert into public.participantes (evento_id, nome) values (v_meu.id, 'Fulano') returning * into v_p;
    perform public.t_guardar('participante_alheio', v_p.id);
  end;
end $$;

-- ---------------------------------------------------------------- 4b. conta "anônima" do Supabase (login sem cadastro)
do $$
begin
  perform public.t_como('authenticated', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '{"is_anonymous": true}');
  perform public.t_igual('conta anônima não enxerga eventos (nem os "dela")', (select count(*)::int from public.eventos), 0);
  perform public.t_igual('conta anônima não enxerga participantes', (select count(*)::int from public.participantes), 0);
  perform public.t_falha('conta anônima não cria evento',
    $q$insert into public.eventos (nome, data_evento, valor) values ('X', '2026-12-20', 10)$q$, 'row-level security');
end $$;

-- ---------------------------------------------------------------- 5. quem só tem o link (anon)
do $$
declare
  v_ev    uuid := public.t_ler('ev')::uuid;
  v_token uuid := public.t_ler('token')::uuid;
  v       jsonb;
begin
  perform public.t_como('anon');
  perform public.t_falha('anon não lê eventos', 'select * from public.eventos', 'permission denied');
  perform public.t_falha('anon não lê participantes', 'select * from public.participantes', 'permission denied');
  perform public.t_falha('anon não insere em participantes', format('insert into public.participantes (evento_id, nome) values (%L, %L)', v_ev, 'X'), 'permission denied');
  perform public.t_falha('anon não lê o schema private', 'select * from private.sorteios', 'permission denied');
  perform public.t_falha('anon não chama gravar_sorteio', format($q$select public.gravar_sorteio(%L, '[]'::jsonb)$q$, v_ev), 'permission denied');
  perform public.t_falha('anon não chama ler_sorteio', format('select * from public.ler_sorteio(%L)', v_ev), 'permission denied');
  perform public.t_igual('versao_do_esquema responde para anon', public.versao_do_esquema(), 1);

  v := public.evento_publico(v_token);
  perform public.t_igual('evento_publico: nome', v->>'nome', 'Natal da Família');
  perform public.t_igual('evento_publico: data', v->>'data_evento', '2026-12-20');
  perform public.t_igual('evento_publico: valor', (v->>'valor')::numeric, 50::numeric);
  perform public.t_igual('evento_publico: recado', v->>'recado', 'Troca às 20h');
  perform public.t_igual('evento_publico: ainda não sorteado', (v->>'sorteado')::boolean, false);
  perform public.t_igual('evento_publico: 4 participantes', jsonb_array_length(v->'participantes'), 4);
  perform public.t_igual('evento_publico: nunca traz e-mail nem token', v::text ~ '@|token|dono', false);
  perform public.t_igual('evento_publico: só o Davi aparece confirmado',
    (select jsonb_agg(p->>'nome' order by p->>'nome') from jsonb_array_elements(v->'participantes') p where (p->>'confirmado')::boolean), '["Davi"]'::jsonb);
  perform public.t_igual('evento_publico: token desconhecido devolve nulo', public.evento_publico('00000000-0000-4000-8000-000000000000') is null, true);

  -- confirmar e-mail
  perform public.t_igual('confirmar: ok', public.confirmar_email(v_token, public.t_ler('ana')::uuid, '  ANA@Exemplo.com '), '{"ok": true, "nome": "Ana Maria"}'::jsonb);
  perform public.t_igual('confirmar: segunda vez no mesmo nome é recusada (quem chega primeiro leva)',
    public.confirmar_email(v_token, public.t_ler('ana')::uuid, 'outra@exemplo.com')->>'erro', 'ja_confirmado');
  perform public.t_igual('confirmar: nome que o dono já preencheu também é recusado',
    public.confirmar_email(v_token, public.t_ler('davi')::uuid, 'outro@exemplo.com')->>'erro', 'ja_confirmado');
  perform public.t_igual('confirmar: e-mail inválido', public.confirmar_email(v_token, public.t_ler('bruno')::uuid, 'isto-nao-e-email')->>'erro', 'email_invalido');
  perform public.t_igual('confirmar: e-mail vazio', public.confirmar_email(v_token, public.t_ler('bruno')::uuid, '   ')->>'erro', 'email_invalido');
  perform public.t_igual('confirmar: e-mail com lixo', public.confirmar_email(v_token, public.t_ler('bruno')::uuid, 'a@b.com, c@d.com')->>'erro', 'email_invalido');
  perform public.t_igual('confirmar: token errado', public.confirmar_email('00000000-0000-4000-8000-000000000000', public.t_ler('bruno')::uuid, 'b@exemplo.com')->>'erro', 'evento_nao_encontrado');
  perform public.t_igual('confirmar: participante de outro evento', public.confirmar_email(v_token, public.t_ler('participante_alheio')::uuid, 'b@exemplo.com')->>'erro', 'participante_nao_encontrado');
  perform public.t_igual('confirmar: participante inexistente', public.confirmar_email(v_token, gen_random_uuid(), 'b@exemplo.com')->>'erro', 'participante_nao_encontrado');
  perform public.t_igual('confirmar: Bruno ok', public.confirmar_email(v_token, public.t_ler('bruno')::uuid, 'bruno@exemplo.com')->>'ok', 'true');
  perform public.t_igual('confirmar: Carla ok', public.confirmar_email(v_token, public.t_ler('carla')::uuid, 'carla@exemplo.com')->>'ok', 'true');

  v := public.evento_publico(v_token);
  perform public.t_igual('evento_publico: agora os 4 estão confirmados',
    (select count(*)::int from jsonb_array_elements(v->'participantes') p where (p->>'confirmado')::boolean), 4);
  perform public.t_igual('evento_publico: continua sem e-mails', v::text ~ '@', false);
end $$;

-- o e-mail digitado pelo participante chegou normalizado e só o dono o enxerga
do $$
begin
  perform public.t_como('authenticated', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  perform public.t_igual('e-mail da Ana guardado em minúsculo e sem espaços',
    (select email from public.participantes where id = public.t_ler('ana')::uuid), 'ana@exemplo.com');
end $$;

-- ---------------------------------------------------------------- 6. o sorteio (só o servidor)
do $$
declare
  v_ev   uuid := public.t_ler('ev')::uuid;
  ana    uuid := public.t_ler('ana')::uuid;
  bruno  uuid := public.t_ler('bruno')::uuid;
  carla  uuid := public.t_ler('carla')::uuid;
  davi   uuid := public.t_ler('davi')::uuid;
  alheio uuid := public.t_ler('participante_alheio')::uuid;
  roda1  jsonb;
  roda2  jsonb;
begin
  perform public.t_como('service_role');
  roda1 := jsonb_build_array(
    jsonb_build_object('de', ana, 'para', bruno), jsonb_build_object('de', bruno, 'para', carla),
    jsonb_build_object('de', carla, 'para', davi), jsonb_build_object('de', davi, 'para', ana));
  roda2 := jsonb_build_array(
    jsonb_build_object('de', ana, 'para', carla), jsonb_build_object('de', carla, 'para', bruno),
    jsonb_build_object('de', bruno, 'para', davi), jsonb_build_object('de', davi, 'para', ana));

  perform public.t_falha('sorteio: alguém tirando a si mesmo é recusado',
    format('select public.gravar_sorteio(%L, %L::jsonb)', v_ev,
      jsonb_build_array(jsonb_build_object('de', ana, 'para', ana), jsonb_build_object('de', bruno, 'para', carla),
                        jsonb_build_object('de', carla, 'para', davi), jsonb_build_object('de', davi, 'para', bruno))), 'pares_invalidos');
  perform public.t_falha('sorteio: faltando gente é recusado',
    format('select public.gravar_sorteio(%L, %L::jsonb)', v_ev,
      jsonb_build_array(jsonb_build_object('de', ana, 'para', bruno), jsonb_build_object('de', bruno, 'para', ana))), 'pares_invalidos');
  perform public.t_falha('sorteio: duas pessoas tirando a mesma é recusado',
    format('select public.gravar_sorteio(%L, %L::jsonb)', v_ev,
      jsonb_build_array(jsonb_build_object('de', ana, 'para', bruno), jsonb_build_object('de', bruno, 'para', carla),
                        jsonb_build_object('de', carla, 'para', bruno), jsonb_build_object('de', davi, 'para', ana))), 'pares_invalidos');
  perform public.t_falha('sorteio: alguém de outro evento é recusado',
    format('select public.gravar_sorteio(%L, %L::jsonb)', v_ev,
      jsonb_build_array(jsonb_build_object('de', ana, 'para', bruno), jsonb_build_object('de', bruno, 'para', carla),
                        jsonb_build_object('de', carla, 'para', alheio), jsonb_build_object('de', alheio, 'para', ana))), 'pares_invalidos');
  perform public.t_falha('sorteio: evento inexistente', format($q$select public.gravar_sorteio(%L, '[]'::jsonb)$q$, gen_random_uuid()), 'evento_nao_encontrado');
  perform public.t_igual('sorteio recusado não deixa rastro', (select count(*)::int from public.ler_sorteio(v_ev)), 0);
  perform public.t_igual('sorteio recusado não marca o evento', (select sorteado_em is null from public.eventos where id = v_ev), true);

  perform public.t_igual('sorteio gravado devolve o número 1', public.gravar_sorteio(v_ev, roda1), 1);
  perform public.t_igual('sorteio gravado: 4 pares', (select count(*)::int from public.ler_sorteio(v_ev)), 4);
  perform public.t_igual('sorteio gravado: Ana tirou o Bruno', (select tirou_id from public.ler_sorteio(v_ev) where participante_id = ana), bruno);
  perform public.t_igual('sorteio gravado: evento marcado', (select sorteado_em is not null from public.eventos where id = v_ev), true);
  perform public.t_igual('sorteio gravado: o evento está no sorteio nº 1', (select sorteio_numero from public.eventos where id = v_ev), 1);

  perform public.t_falha('sortear de novo sem cancelar o atual é recusado', format('select public.gravar_sorteio(%L, %L::jsonb)', v_ev, roda2), 'sorteio_ja_realizado');
  perform public.t_igual('sorteio intacto após a tentativa', (select tirou_id from public.ler_sorteio(v_ev) where participante_id = ana), bruno);
  perform public.t_igual('número do sorteio intacto após a tentativa', (select sorteio_numero from public.eventos where id = v_ev), 1);

  -- o servidor registra o resultado do envio
  update public.participantes set email_enviado_em = now(), erro_envio = null where evento_id = v_ev;
  perform public.t_igual('servidor registra envios', (select count(*)::int from public.participantes where evento_id = v_ev and email_enviado_em is not null), 4);
end $$;

-- ---------------------------------------------------------------- 7. depois do sorteio
do $$
declare
  v_ev    uuid := public.t_ler('ev')::uuid;
  v_token uuid := public.t_ler('token')::uuid;
  ana     uuid := public.t_ler('ana')::uuid;
  n       int;
begin
  perform public.t_como('service_role');
  update public.participantes set email_enviado_em = now() where id = ana;

  -- A LISTA FICA TRAVADA: ninguém entra, sai ou troca de e-mail. Se o dono pudesse trocar o e-mail
  -- de alguém e mandar "reenviar", receberia o resultado dessa pessoa sem ela perceber.
  perform public.t_como('authenticated', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  perform public.t_falha('dono não adiciona gente depois do sorteio',
    format('insert into public.participantes (evento_id, nome) values (%L, %L)', v_ev, 'Atrasado'), 'row-level security');
  delete from public.participantes where id = ana;
  get diagnostics n = row_count;
  perform public.t_igual('dono não remove gente depois do sorteio', n, 0);

  update public.participantes set email = 'desvio@exemplo.com' where id = ana;
  get diagnostics n = row_count;
  perform public.t_igual('dono NÃO consegue trocar o e-mail de ninguém depois do sorteio (desviaria o resultado)', n, 0);
  update public.participantes set email = null where id = ana;
  get diagnostics n = row_count;
  perform public.t_igual('dono não consegue nem apagar o e-mail depois do sorteio', n, 0);
  update public.participantes set nome = 'Outro nome' where id = ana;
  get diagnostics n = row_count;
  perform public.t_igual('dono não consegue trocar nomes depois do sorteio', n, 0);
  perform public.t_igual('o e-mail da Ana continua o de antes', (select email from public.participantes where id = ana), 'ana@exemplo.com');
  perform public.t_igual('o status de envio da Ana continua', (select email_enviado_em is not null from public.participantes where id = ana), true);

  -- dados do evento (nome, data...) ainda podem ser corrigidos
  update public.eventos set recado = 'Novo recado' where id = v_ev;
  get diagnostics n = row_count;
  perform public.t_igual('dono ainda pode editar o recado do evento', n, 1);

  perform public.t_como('anon');
  perform public.t_igual('link público: sorteio já feito', public.confirmar_email(v_token, public.t_ler('davi')::uuid, 'x@exemplo.com')->>'erro', 'sorteio_ja_realizado');
  perform public.t_igual('link público mostra "sorteado"', (public.evento_publico(v_token)->>'sorteado')::boolean, true);
end $$;

-- ---------------------------------------------------------------- 7b. cancelar o sorteio (reabrir_sorteio)
do $$
declare
  v_ev    uuid := public.t_ler('ev')::uuid;
  v_token uuid := public.t_ler('token')::uuid;
  ana     uuid := public.t_ler('ana')::uuid;
  bruno   uuid := public.t_ler('bruno')::uuid;
  carla   uuid := public.t_ler('carla')::uuid;
  davi    uuid := public.t_ler('davi')::uuid;
  novo    uuid;
  n       int;
begin
  perform public.t_como('anon');
  perform public.t_falha('anon não cancela sorteio', format('select public.reabrir_sorteio(%L)', v_ev), 'permission denied');

  perform public.t_como('authenticated', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  perform public.t_falha('outro organizador não cancela o meu sorteio', format('select public.reabrir_sorteio(%L)', v_ev), 'evento_nao_encontrado');
  perform public.t_como('authenticated', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '{"is_anonymous": true}');
  perform public.t_falha('conta anônima não cancela sorteio', format('select public.reabrir_sorteio(%L)', v_ev), 'evento_nao_encontrado');
  perform public.t_como('service_role');
  perform public.t_igual('o sorteio continua depois das tentativas indevidas', (select count(*)::int from public.ler_sorteio(v_ev)), 4);

  -- o dono cancela
  perform public.t_como('authenticated', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  perform public.reabrir_sorteio(v_ev);
  perform public.t_como('service_role');
  perform public.t_igual('cancelar apaga os pares', (select count(*)::int from public.ler_sorteio(v_ev)), 0);
  perform public.t_igual('cancelar libera o evento', (select sorteado_em is null from public.eventos where id = v_ev), true);
  perform public.t_igual('cancelar mantém a contagem de sorteios (o próximo será o nº 2)', (select sorteio_numero from public.eventos where id = v_ev), 1);
  perform public.t_igual('cancelar zera o status de envio', (select count(*)::int from public.participantes where evento_id = v_ev and (email_enviado_em is not null or erro_envio is not null)), 0);

  -- com a lista liberada o dono corrige e-mail e adiciona gente
  perform public.t_como('authenticated', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  update public.participantes set email = 'ana.nova@exemplo.com' where id = ana;
  perform public.t_igual('depois de cancelar o dono pode corrigir o e-mail', (select email from public.participantes where id = ana), 'ana.nova@exemplo.com');
  insert into public.participantes (evento_id, nome, email) values (v_ev, 'Atrasado', 'atrasado@exemplo.com') returning id into novo;
  delete from public.participantes where id = novo;
  get diagnostics n = row_count;
  perform public.t_igual('depois de cancelar o dono pode adicionar e remover gente', n, 1);

  -- o link público volta a funcionar
  perform public.t_como('anon');
  perform public.t_igual('link público volta a aceitar cadastros (não diz mais "sorteio já feito")',
    public.confirmar_email(v_token, davi, 'x@exemplo.com')->>'erro', 'ja_confirmado');
  perform public.t_igual('link público volta a mostrar "não sorteado"', (public.evento_publico(v_token)->>'sorteado')::boolean, false);

  -- e o próximo sorteio é o nº 2
  perform public.t_como('service_role');
  perform public.t_igual('o novo sorteio devolve o número 2',
    public.gravar_sorteio(v_ev, jsonb_build_array(
      jsonb_build_object('de', ana, 'para', carla), jsonb_build_object('de', carla, 'para', bruno),
      jsonb_build_object('de', bruno, 'para', davi), jsonb_build_object('de', davi, 'para', ana))), 2);
  perform public.t_igual('o novo sorteio gravou 4 pares', (select count(*)::int from public.ler_sorteio(v_ev)), 4);
  perform public.t_igual('o novo sorteio é de verdade novo: Ana agora tirou a Carla', (select tirou_id from public.ler_sorteio(v_ev) where participante_id = ana), carla);
end $$;

-- ---------------------------------------------------------------- 8. regras do sorteio (sem e-mail / poucos participantes)
do $$
declare
  v_ev public.eventos;
  a uuid; b uuid; c uuid;
begin
  perform public.t_como('authenticated', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  insert into public.eventos (nome, data_evento, valor) values ('Pequeno', '2026-12-31', 0) returning * into v_ev;
  insert into public.participantes (evento_id, nome, email) values (v_ev.id, 'A', 'a@exemplo.com') returning id into a;
  insert into public.participantes (evento_id, nome, email) values (v_ev.id, 'B', 'b@exemplo.com') returning id into b;

  perform public.t_como('service_role');
  perform public.t_falha('sorteio com 2 participantes é recusado',
    format('select public.gravar_sorteio(%L, %L::jsonb)', v_ev.id,
      jsonb_build_array(jsonb_build_object('de', a, 'para', b), jsonb_build_object('de', b, 'para', a))), 'participantes_insuficientes');

  perform public.t_como('authenticated', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  insert into public.participantes (evento_id, nome) values (v_ev.id, 'C') returning id into c;

  perform public.t_como('service_role');
  perform public.t_falha('sorteio com alguém sem e-mail é recusado',
    format('select public.gravar_sorteio(%L, %L::jsonb)', v_ev.id,
      jsonb_build_array(jsonb_build_object('de', a, 'para', b), jsonb_build_object('de', b, 'para', c), jsonb_build_object('de', c, 'para', a))), 'email_faltando');
end $$;

-- ---------------------------------------------------------------- 9. apagar o evento leva tudo junto
do $$
declare
  v_ev uuid := public.t_ler('ev')::uuid;
begin
  perform public.t_como('authenticated', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  delete from public.eventos where id = v_ev;

  perform public.t_como('service_role');
  perform public.t_igual('apagar o evento apaga os participantes', (select count(*)::int from public.participantes where evento_id = v_ev), 0);
  perform public.t_igual('apagar o evento apaga o sorteio', (select count(*)::int from public.ler_sorteio(v_ev)), 0);
end $$;

reset role;
rollback;

do $$ begin raise notice 'TODOS OS TESTES DO BANCO PASSARAM'; end $$;
