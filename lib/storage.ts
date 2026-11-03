import {env} from 'cloudflare:workers';
import {SupabaseStorage} from './supabase-storage.mjs';
export function storage():D1Database{
 const config=env as Cloudflare.Env & {SUPABASE_URL?:string;SUPABASE_SERVICE_ROLE_KEY?:string;BUNKER_STORAGE_GATEWAY?:string;BUNKER_STORAGE_TOKEN?:string};
 if(config.BUNKER_STORAGE_GATEWAY)return new SupabaseStorage({gateway:config.BUNKER_STORAGE_GATEWAY,key:config.BUNKER_STORAGE_TOKEN}) as unknown as D1Database;
 if(config.SUPABASE_URL||config.SUPABASE_SERVICE_ROLE_KEY){
  return new SupabaseStorage({url:config.SUPABASE_URL,key:config.SUPABASE_SERVICE_ROLE_KEY}) as unknown as D1Database;
 }
 if(!env.DB)throw Error('Armazenamento do Bunker não configurado.');
 return env.DB;
}
