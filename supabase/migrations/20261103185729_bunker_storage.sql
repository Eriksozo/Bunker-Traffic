-- Private application state. Only the trusted Worker backend uses this API.
create table public.bunker_records (
 key text primary key, payload text not null check (jsonb_typeof(payload::jsonb)='object'),
 revision bigint not null check(revision>0), updated_at text not null
);
create table public.bunker_reports (
 id text primary key, project text not null, created_at text not null, payload text not null
);
create index bunker_reports_project_created_idx on public.bunker_reports(project,created_at desc,id desc);
create index bunker_records_updated_idx on public.bunker_records(updated_at desc,key desc);
alter table public.bunker_records enable row level security;
alter table public.bunker_reports enable row level security;
revoke all on public.bunker_records,public.bunker_reports from public,anon,authenticated;
grant select,insert,update on public.bunker_records,public.bunker_reports to service_role;
create function public.bunker_store(operation text,input jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare affected bigint:=0; rows jsonb:='[]'; entry jsonb; data jsonb; current_revision bigint;
begin
 if current_user not in ('service_role','postgres') then raise exception 'Forbidden'; end if;
 if operation in ('cas','commit') then
  if (input->>'expected')::bigint=0 then
   insert into public.bunker_records(key,payload,revision,updated_at)
   values(input->>'key',input->>'payload',1,input->>'updated_at') on conflict do nothing;
  else
   update public.bunker_records set payload=input->>'payload',revision=revision+1,updated_at=input->>'updated_at'
   where key=input->>'key' and revision=(input->>'expected')::bigint;
  end if;
  get diagnostics affected=row_count;
  if operation='commit' and affected=1 then
   if input->>'key'<>'central' then raise exception 'Central transaction required'; end if;
   for entry in select value from jsonb_array_elements(coalesce(input->'archives','[]')) loop
    if coalesce((entry->>'immutable')::boolean,false) then
     insert into public.bunker_records values(entry->>'key',entry->>'payload',1,entry->>'updated_at');
    else
     insert into public.bunker_records values(entry->>'key',entry->>'payload',1,entry->>'updated_at') on conflict do nothing;
    end if;
   end loop;
   for entry in select value from jsonb_array_elements(coalesce((input->>'payload')::jsonb->'reports','[]')) loop
    if jsonb_typeof(entry->'id')='string' and jsonb_typeof(entry->'project')='string' and jsonb_typeof(entry->'createdAt')='string' then
     insert into public.bunker_reports values(entry->>'id',entry->>'project',entry->>'createdAt',entry::text) on conflict do nothing;
    end if;
   end loop;
  end if;
  return jsonb_build_object('changes',affected);
 elsif operation='get' then
  select coalesce(jsonb_agg(to_jsonb(r)),'[]') into rows from public.bunker_records r where key in (select jsonb_array_elements_text(input->'keys'));
 elsif operation='daily' then
  select coalesce(jsonb_agg(to_jsonb(r)),'[]') into rows from (
   select * from public.bunker_records where key like 'daily:%'
   and payload::jsonb->>'interestUntil'>input->>'now' and payload::jsonb->>'nextDueAt'<=input->>'now'
   order by payload::jsonb->>'nextDueAt',key limit least((input->>'limit')::int,500)
  ) r;
 elsif operation in ('suggestions','collaborations') then
  select coalesce(jsonb_agg(to_jsonb(r)),'[]') into rows from (
   select * from public.bunker_records where
    case when operation='collaborations' then key like 'collaboration:%' and payload::jsonb#>>'{round,project}'=input->>'project'
    else (key like 'suggestions:%' and payload::jsonb->>'type'='bunker-suggestions' and payload::jsonb->>'version'='1' and payload::jsonb->>'project'=input->>'project')
      or (key like 'collaboration:%' and payload::jsonb->>'type'='bunker-collaboration' and payload::jsonb->>'version'='1' and payload::jsonb#>>'{round,project}'=input->>'project' and jsonb_array_length(coalesce(payload::jsonb->'cardSuggestions','[]'))>0) end
    and case when operation='collaborations' then input->>'cursor' is null or updated_at||'|'||key<input->>'cursor'
      else input#>>'{cursor,at}' is null or (updated_at,key)<(input#>>'{cursor,at}',input#>>'{cursor,key}') end
   order by updated_at desc,key desc limit least((input->>'limit')::int,500)
  ) r;
 elsif operation='reports' then
  select coalesce(jsonb_agg(to_jsonb(r)),'[]') into rows from (
   with legacy as (
    select e->>'id' id,e->>'project' project,e->>'createdAt' created_at,e::text payload from public.bunker_records c,
    jsonb_array_elements(coalesce(c.payload::jsonb->'reports','[]')) e where c.key='central'
   ), combined as (
    select * from public.bunker_reports union all select * from legacy l where not exists(select 1 from public.bunker_reports a where a.id=l.id)
   ) select id,created_at,payload from combined where (input->>'project'='all' or project in (input->>'project','all'))
   and (input#>>'{cursor,at}' is null or (created_at,id)<(input#>>'{cursor,at}',input#>>'{cursor,id}'))
   order by created_at desc,id desc limit least((input->>'limit')::int,51)
  ) r;
 elsif operation='resolutions' then
  select coalesce(jsonb_agg(to_jsonb(r)),'[]') into rows from (
   select a.key archive_key,p::text proposal,e::text execution
   from public.bunker_records a,jsonb_array_elements(coalesce(a.payload::jsonb->'proposals','[]')) p,
    jsonb_array_elements(coalesce(a.payload::jsonb->'executions','[]')) e,
    jsonb_array_elements(input->'requests') wanted
   where a.key like 'collaboration:%' and a.payload::jsonb->>'type'='bunker-collaboration'
   and a.payload::jsonb->>'version'='1' and p->>'status'='Aprovada' and e->>'status'='Confirmada'
   and p->>'project'=wanted->>'project' and p->>'id'=wanted->>'proposalId'
   and e->>'project'=wanted->>'project' and e->>'proposalId'=wanted->>'proposalId'
   order by a.key,e->>'id' limit least((input->>'limit')::int,500)
  ) r;
 else raise exception 'Unsupported storage operation'; end if;
 return jsonb_build_object('rows',rows,'changes',0);
end $$;
revoke all on function public.bunker_store(text,jsonb) from public,anon,authenticated;
grant execute on function public.bunker_store(text,jsonb) to service_role;
