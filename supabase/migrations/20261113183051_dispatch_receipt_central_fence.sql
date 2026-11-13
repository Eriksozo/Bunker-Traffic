-- Dispatch receipt fenced by the central revision (Bunker curadoria of 2026-11-13, P1).
-- Only the `cas` branch changes: with `centralRevision` (used only by the Edge Function malva-mcp for a `dispatch:`
-- receipt) the central row is locked at the revision the provider fence validated, and the receipt is inserted in the
-- same transaction. Without it, every operation is identical to 20261109231000_snapshot_retention.sql.
-- Grants unchanged: service_role only.
CREATE OR REPLACE FUNCTION public.bunker_store(operation text, input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare affected bigint:=0; rows jsonb:='[]'; entry jsonb; data jsonb; current_revision bigint;
begin
 if current_user not in ('service_role','postgres') then raise exception 'Forbidden'; end if;
 if operation in ('cas','commit') then
  -- Dispatch receipt fenced by the central (curadoria of 2026-11-13): the provider fence validated the order against
  -- the central at `centralRevision`. The central row is locked at that exact revision and the receipt inserted in
  -- this same transaction, so an owner change (pause, autonomy off, permission changed) committed after that read
  -- refuses the receipt (changes 0) and the provider is not called. A change committed after this point finds the
  -- order already in transit. No HTTP call happens inside this transaction.
  if operation='cas' and input ? 'centralRevision' then
   if input->>'key' not like 'dispatch:%' or (input->>'expected')::bigint<>0 then raise exception 'Dispatch fence requires a new dispatch receipt'; end if;
   perform 1 from public.bunker_records where key='central' and revision=(input->>'centralRevision')::bigint for update;
   if not found then return jsonb_build_object('changes',0,'conflict','central'); end if;
  end if;
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
   -- Superseded copies of the readings (owner decision of 2026-11-09: "keep 24h"). Each commit that changes the
   -- readings writes a new `snapshots:<digest>` record and the central points only to the newest; the old ones piled
   -- up at ~100 MB a day. Deleted here, in the commit transaction: only `snapshots:` records written more than 24 hours
   -- before this commit, never the one this central points to. The central is their only reader.
   delete from public.bunker_records
    where key like 'snapshots:%'
      and key is distinct from ((input->>'payload')::jsonb->'snapshotStorage'->>'key')
      and updated_at < to_char(((input->>'updated_at')::timestamptz - interval '24 hours') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
   for entry in select value from jsonb_array_elements(coalesce((input->>'payload')::jsonb->'reports','[]')) loop
    if jsonb_typeof(entry->'id')='string' and jsonb_typeof(entry->'project')='string' and jsonb_typeof(entry->'createdAt')='string' then
     insert into public.bunker_reports values(entry->>'id',entry->>'project',entry->>'createdAt',entry::text) on conflict do nothing;
    end if;
   end loop;
  end if;
  return jsonb_build_object('changes',affected);
 elsif operation='get' then
  if input->>'projection'='revision' then
   select coalesce(jsonb_agg(to_jsonb(r)),'[]') into rows from (
    select key,revision,updated_at from public.bunker_records where key = any(array(select jsonb_array_elements_text(input->'keys')))
   ) r;
  else
   select coalesce(jsonb_agg(to_jsonb(r)),'[]') into rows from public.bunker_records r where key = any(array(select jsonb_array_elements_text(input->'keys')));
  end if;
 elsif operation='daily' then
  select coalesce(jsonb_agg(to_jsonb(r)),'[]') into rows from (
   select * from public.bunker_records where key like 'daily:%'
   and payload::jsonb->>'interestUntil'>input->>'now' and payload::jsonb->>'nextDueAt'<=input->>'now'
   order by payload::jsonb->>'nextDueAt',key limit least((input->>'limit')::int,500)
  ) r;
 elsif operation in ('suggestions','collaborations') then
  -- The central record is large and compressed. Fence archive keys before
  -- decoding JSON, then reuse each decoded document throughout filtering.
  with archives as materialized (
   select key,payload,revision,updated_at,payload::jsonb doc
   from public.bunker_records
   where (key like 'collaboration:%' and payload::jsonb#>>'{round,project}'=input->>'project')
      or (operation='suggestions' and key like 'suggestions:%' and payload::jsonb->>'project'=input->>'project')
  ), matched as (
   select key,payload,revision,updated_at from archives where
    case when operation='collaborations' then doc#>>'{round,project}'=input->>'project'
    else (key like 'suggestions:%' and doc->>'type'='bunker-suggestions' and doc->>'version'='1' and doc->>'project'=input->>'project')
      or (key like 'collaboration:%' and doc->>'type'='bunker-collaboration' and doc->>'version'='1' and doc#>>'{round,project}'=input->>'project' and jsonb_array_length(coalesce(doc->'cardSuggestions','[]'))>0) end
    and case when operation='collaborations' then input->>'cursor' is null or updated_at||'|'||key<input->>'cursor'
      else input#>>'{cursor,at}' is null or (updated_at,key)<(input#>>'{cursor,at}',input#>>'{cursor,key}') end
   order by updated_at desc,key desc limit least((input->>'limit')::int,500)
  ) select coalesce(jsonb_agg(to_jsonb(r)),'[]') into rows from matched r;
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
  -- Decode each archive once, filter the wanted project/proposal before
  -- expanding executions. No request x proposal x execution Cartesian product.
  with wanted as materialized (
   select distinct value->>'project' project,value->>'proposalId' proposal_id
   from jsonb_array_elements(coalesce(input->'requests','[]'))
  ), archives as materialized (
   select key,payload::jsonb doc from public.bunker_records where key like 'collaboration:%'
  ), candidates as materialized (
   select key,doc from archives a where doc->>'type'='bunker-collaboration'
   and doc->>'version'='1' and exists(select 1 from wanted w where w.project=a.doc#>>'{round,project}')
  ), approved as materialized (
   select a.key,a.doc->'executions' executions,p.value proposal
   from candidates a cross join lateral jsonb_array_elements(coalesce(a.doc->'proposals','[]')) p
   join wanted w on p.value->>'project'=w.project and p.value->>'id'=w.proposal_id
   where p.value->>'status'='Aprovada'
  )
  select coalesce(jsonb_agg(to_jsonb(r)),'[]') into rows from (
   select p.key archive_key,p.proposal::text proposal,e.value::text execution
   from approved p cross join lateral jsonb_array_elements(coalesce(p.executions,'[]')) e
   where e.value->>'status'='Confirmada' and e.value->>'project'=p.proposal->>'project'
   and e.value->>'proposalId'=p.proposal->>'id'
   order by p.key,e.value->>'id' limit least((input->>'limit')::int,500)
  ) r;
 else raise exception 'Unsupported storage operation'; end if;
 return jsonb_build_object('rows',rows,'changes',0);
end $function$;
revoke all on function public.bunker_store(text,jsonb) from public,anon,authenticated;
grant execute on function public.bunker_store(text,jsonb) to service_role;
