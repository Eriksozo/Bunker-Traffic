create function public.bunker_import_rows(input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r jsonb; prior record; inserted_count int:=0; matched_count int:=0;
begin
 if current_user not in ('service_role','postgres') then raise exception 'Forbidden'; end if;
 if jsonb_array_length(input->'rows')>50 then raise exception 'Batch limit'; end if;
 for r in select value from jsonb_array_elements(input->'rows') loop
  if input->>'table'='records' then
   select * into prior from public.bunker_records where key=r->>'key';
   if found then
    if prior.payload<>r->>'payload' or prior.revision<>(r->>'revision')::bigint or prior.updated_at<>r->>'updated_at' then raise exception 'Migration conflict'; end if;
    matched_count:=matched_count+1;
   else
    insert into public.bunker_records values(r->>'key',r->>'payload',(r->>'revision')::bigint,r->>'updated_at');inserted_count:=inserted_count+1;
   end if;
  elsif input->>'table'='reports' then
   select * into prior from public.bunker_reports where id=r->>'id';
   if found then
    if prior.payload<>r->>'payload' or prior.project<>r->>'project' or prior.created_at<>r->>'created_at' then raise exception 'Migration conflict'; end if;
    matched_count:=matched_count+1;
   else
    insert into public.bunker_reports values(r->>'id',r->>'project',r->>'created_at',r->>'payload');inserted_count:=inserted_count+1;
   end if;
  else raise exception 'Unsupported table'; end if;
 end loop;
 return jsonb_build_object('inserted',inserted_count,'matched',matched_count);
end $$;
revoke all on function public.bunker_import_rows(jsonb) from public,anon,authenticated;
grant execute on function public.bunker_import_rows(jsonb) to service_role;
