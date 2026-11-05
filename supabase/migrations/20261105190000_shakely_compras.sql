-- Shakely · Controle de compras por lote, preços e estoque.
-- Lotes com numeração automática (nunca reutilizada), itens de compra,
-- baixas de estoque e acesso restrito a e-mails autorizados.

-- Usuários autorizados ---------------------------------------------------
create table if not exists public.usuarios_autorizados (
  email text primary key check (email = lower(email)),
  nome text,
  criado_em timestamptz not null default now()
);

insert into public.usuarios_autorizados (email, nome)
values ('camposweb.personal@gmail.com', 'Ricardo')
on conflict (email) do nothing;

create or replace function public.autorizado()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.usuarios_autorizados u
    where u.email = lower(coalesce((select auth.jwt()) ->> 'email', ''))
  );
$$;

revoke all on function public.autorizado() from public, anon;
grant execute on function public.autorizado() to authenticated;

create or replace function public.email_atual()
returns text
language sql
stable
set search_path = ''
as $$ select lower(coalesce((select auth.jwt()) ->> 'email', '')) $$;

-- Cadastros ----------------------------------------------------------------
create table if not exists public.fornecedores (
  id bigint generated always as identity primary key,
  nome text not null check (length(trim(nome)) > 0),
  criado_em timestamptz not null default now()
);
create unique index if not exists fornecedores_nome_uq on public.fornecedores (lower(trim(nome)));

create table if not exists public.produtos (
  id bigint generated always as identity primary key,
  nome text not null check (length(trim(nome)) > 0),
  unidade text not null default 'un',
  estoque_minimo numeric(12,3) not null default 0 check (estoque_minimo >= 0),
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);
create unique index if not exists produtos_nome_uq on public.produtos (lower(trim(nome)));

-- Lotes de compra: o número é o próprio identificador, automático e sequencial.
create table if not exists public.lotes (
  numero bigint generated always as identity primary key,
  data_compra date not null default current_date,
  descricao text,
  status text not null default 'rascunho' check (status in ('rascunho', 'confirmado')),
  confirmado_em timestamptz,
  confirmado_por text,
  criado_por text not null default public.email_atual(),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table if not exists public.compras (
  id bigint generated always as identity primary key,
  lote_numero bigint not null references public.lotes (numero) on delete cascade,
  produto_id bigint not null references public.produtos (id),
  fornecedor_id bigint not null references public.fornecedores (id),
  data_compra date not null,
  quantidade numeric(12,3) not null check (quantidade > 0),
  valor_unitario numeric(14,4) not null check (valor_unitario >= 0),
  valor_total numeric(12,2) not null check (valor_total >= 0),
  observacao text,
  criado_por text not null default public.email_atual(),
  criado_em timestamptz not null default now()
);
create index if not exists compras_lote_idx on public.compras (lote_numero);
create index if not exists compras_produto_data_idx on public.compras (produto_id, data_compra desc, id desc);
create index if not exists compras_fornecedor_idx on public.compras (fornecedor_id);

create table if not exists public.saidas (
  id bigint generated always as identity primary key,
  produto_id bigint not null references public.produtos (id),
  quantidade numeric(12,3) not null check (quantidade > 0),
  data date not null default current_date,
  motivo text not null default 'uso' check (motivo in ('uso', 'venda', 'perda', 'ajuste')),
  observacao text,
  criado_por text not null default public.email_atual(),
  criado_em timestamptz not null default now()
);
create index if not exists saidas_produto_idx on public.saidas (produto_id);

-- Regras de integridade ----------------------------------------------------
-- Itens de lote confirmado ficam travados: para corrigir, reabra o lote.
create or replace function public.trava_compras_lote_confirmado()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  lote_alvo bigint := coalesce(new.lote_numero, old.lote_numero);
begin
  if exists (select 1 from public.lotes l where l.numero = lote_alvo and l.status = 'confirmado') then
    raise exception 'O lote % está confirmado. Reabra o lote para alterar os itens.', lote_alvo
      using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and new.lote_numero <> old.lote_numero
     and exists (select 1 from public.lotes l where l.numero = old.lote_numero and l.status = 'confirmado') then
    raise exception 'O lote % está confirmado.', old.lote_numero using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists compras_trava_lote on public.compras;
create trigger compras_trava_lote
  before insert or update or delete on public.compras
  for each row execute function public.trava_compras_lote_confirmado();

create or replace function public.lotes_antes_de_salvar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.atualizado_em := now();
  if new.status = 'confirmado' and (tg_op = 'INSERT' or old.status <> 'confirmado') then
    if not exists (select 1 from public.compras c where c.lote_numero = new.numero) then
      raise exception 'Adicione pelo menos um item antes de confirmar o lote.' using errcode = 'P0001';
    end if;
    new.confirmado_em := now();
    new.confirmado_por := public.email_atual();
  elsif new.status = 'rascunho' then
    new.confirmado_em := null;
    new.confirmado_por := null;
  end if;
  return new;
end;
$$;

drop trigger if exists lotes_antes_salvar on public.lotes;
create trigger lotes_antes_salvar
  before insert or update on public.lotes
  for each row execute function public.lotes_antes_de_salvar();


create or replace function public.lotes_antes_de_excluir()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'confirmado' then
    raise exception 'O lote % está confirmado. Reabra o lote antes de excluir.', old.numero using errcode = 'P0001';
  end if;
  return old;
end;
$$;

drop trigger if exists lotes_antes_excluir on public.lotes;
create trigger lotes_antes_excluir
  before delete on public.lotes
  for each row execute function public.lotes_antes_de_excluir();

-- Estoque nunca fica negativo por uma baixa nem pela reabertura de um lote.
create or replace function public.saldo_produto(p_produto bigint)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce((select sum(c.quantidade) from public.compras c
                   join public.lotes l on l.numero = c.lote_numero
                   where c.produto_id = p_produto and l.status = 'confirmado'), 0)
       - coalesce((select sum(s.quantidade) from public.saidas s where s.produto_id = p_produto), 0);
$$;

create or replace function public.confere_saldo_saida()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  saldo numeric;
begin
  saldo := public.saldo_produto(new.produto_id);
  if saldo < 0 then
    raise exception 'Estoque insuficiente: a baixa deixaria o saldo em %.', trim(to_char(saldo, 'FM999999990.###'))
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists saidas_confere_saldo on public.saidas;
create constraint trigger saidas_confere_saldo
  after insert or update on public.saidas
  for each row execute function public.confere_saldo_saida();

create or replace function public.confere_saldo_reabertura()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  p record;
begin
  if old.status = 'confirmado' and new.status = 'rascunho' then
    for p in select distinct c.produto_id, pr.nome from public.compras c
             join public.produtos pr on pr.id = c.produto_id
             where c.lote_numero = new.numero loop
      if public.saldo_produto(p.produto_id) < 0 then
        raise exception 'Não é possível reabrir: "%" já teve baixas que usam este lote.', p.nome
          using errcode = 'P0001';
      end if;
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists lotes_confere_reabertura on public.lotes;
create constraint trigger lotes_confere_reabertura
  after update on public.lotes
  for each row execute function public.confere_saldo_reabertura();

-- Visões (respeitam o RLS de quem consulta) -------------------------------
create or replace view public.v_compras
with (security_invoker = true) as
select c.id, c.lote_numero, l.status as lote_status, c.data_compra,
       c.produto_id, p.nome as produto, p.unidade,
       c.fornecedor_id, f.nome as fornecedor,
       c.quantidade, c.valor_unitario, c.valor_total, c.observacao, c.criado_em
from public.compras c
join public.lotes l on l.numero = c.lote_numero
join public.produtos p on p.id = c.produto_id
join public.fornecedores f on f.id = c.fornecedor_id;

create or replace view public.v_lotes
with (security_invoker = true) as
select l.*,
       coalesce(t.itens, 0) as itens,
       coalesce(t.total, 0) as total,
       t.fornecedores
from public.lotes l
left join lateral (
  select count(*) as itens, sum(c.valor_total) as total,
         string_agg(distinct f.nome, ', ') as fornecedores
  from public.compras c join public.fornecedores f on f.id = c.fornecedor_id
  where c.lote_numero = l.numero
) t on true;

create or replace view public.v_estoque
with (security_invoker = true) as
select p.id as produto_id, p.nome as produto, p.unidade, p.estoque_minimo, p.ativo,
       coalesce(e.comprado, 0) as comprado,
       coalesce(s.saido, 0) as saido,
       coalesce(e.comprado, 0) - coalesce(s.saido, 0) as saldo,
       case when coalesce(e.comprado, 0) > 0 then e.gasto / e.comprado end as custo_medio,
       u.valor_unitario as ultimo_preco,
       u.data_compra as ultima_compra,
       u.fornecedor as ultimo_fornecedor
from public.produtos p
left join lateral (
  select sum(c.quantidade) as comprado, sum(c.valor_total) as gasto
  from public.compras c join public.lotes l on l.numero = c.lote_numero
  where c.produto_id = p.id and l.status = 'confirmado'
) e on true
left join lateral (
  select sum(sa.quantidade) as saido from public.saidas sa where sa.produto_id = p.id
) s on true
left join lateral (
  select c.valor_unitario, c.data_compra, f.nome as fornecedor
  from public.compras c
  join public.lotes l on l.numero = c.lote_numero
  join public.fornecedores f on f.id = c.fornecedor_id
  where c.produto_id = p.id and l.status = 'confirmado'
  order by c.data_compra desc, c.id desc
  limit 1
) u on true;

-- Segurança (RLS): só e-mails autorizados leem e gravam ------------------
alter table public.usuarios_autorizados enable row level security;
alter table public.fornecedores enable row level security;
alter table public.produtos enable row level security;
alter table public.lotes enable row level security;
alter table public.compras enable row level security;
alter table public.saidas enable row level security;

do $$
declare t text;
begin
  foreach t in array array['fornecedores', 'produtos', 'lotes', 'compras', 'saidas'] loop
    execute format('drop policy if exists %I on public.%I', t || '_autorizados', t);
    execute format('create policy %I on public.%I for all to authenticated using ((select public.autorizado())) with check ((select public.autorizado()))', t || '_autorizados', t);
  end loop;
end $$;

drop policy if exists usuarios_ler on public.usuarios_autorizados;
create policy usuarios_ler on public.usuarios_autorizados for select to authenticated
  using ((select public.autorizado()) or email = (select public.email_atual()));
drop policy if exists usuarios_incluir on public.usuarios_autorizados;
create policy usuarios_incluir on public.usuarios_autorizados for insert to authenticated
  with check ((select public.autorizado()));
drop policy if exists usuarios_remover on public.usuarios_autorizados;
create policy usuarios_remover on public.usuarios_autorizados for delete to authenticated
  using ((select public.autorizado()) and email <> (select public.email_atual()));

revoke all on public.usuarios_autorizados, public.fornecedores, public.produtos, public.lotes, public.compras, public.saidas from anon;
revoke all on public.v_compras, public.v_lotes, public.v_estoque from anon;
grant select, insert, update, delete on public.fornecedores, public.produtos, public.lotes, public.compras, public.saidas to authenticated;
grant select, insert, delete on public.usuarios_autorizados to authenticated;
grant select on public.v_compras, public.v_lotes, public.v_estoque to authenticated;
