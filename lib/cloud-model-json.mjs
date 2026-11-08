import {modelOutputFailure,modelContentSize} from './cloud-model-diagnostics.mjs';
/**
 * Decodes the final assistant content as exactly one JSON value.
 * Content that already parses is used as is. Otherwise only lossless wrappers are removed: edge whitespace/BOM,
 * one opening and/or closing code fence at the edges (what the previous decoder already accepted), and the gpt-oss
 * (Harmony) final-channel header (once, after complete messages of other channels only) or end tokens when they leak
 * into content. Text of other channels is discarded, never read. Never repairs: no comma fixing, no completion of a
 * cut answer, no extraction from prose, no choice between two values. A refusal carries only a fixed shape label and a size bucket, never the content.
 */
const FINAL='<|channel|>final<|message|>';
const openFence=/^```[ \t]*(?:json)?\s*/i,closeFence=/\s*```$/;
// Before the final header only complete reasoning messages may appear (channel exactly 'analysis', each closed by
// <|end|>): never prose, JSON, a commentary preamble, a look-alike 'final' channel or a second answer.
const harmonyPrefix=/^(?:(?:<\|start\|>assistant)?<\|channel\|>analysis<\|message\|>(?:(?!<\|end\|>)[\s\S])*<\|end\|>)*(?:<\|start\|>assistant)?$/;
const endTokens=['<|return|>','<|end|>'];
/** Drops end-of-message tokens at the very end, in linear time. */
function stripEndTokens(text){
 let t=text.trimEnd(),changed=true;
 while(changed){changed=false;for(const token of endTokens)if(t.endsWith(token)){t=t.slice(0,-token.length).trimEnd();changed=true;}}
 return t;
}

export function unwrapModelJson(content){
 let text=String(content??'').trim();
 const at=text.indexOf(FINAL);
 // Exactly one final header, preceded only by other channels' complete messages: anything else stays as is
 // and is refused later (two answers, prose or JSON before it, a header quoted inside the reasoning).
 if(at>=0&&at===text.lastIndexOf(FINAL)&&harmonyPrefix.test(text.slice(0,at)))text=text.slice(at+FINAL.length);
 text=stripEndTokens(text).trim();
 if(text.startsWith('```')||text.endsWith('```'))text=text.replace(openFence,'').replace(closeFence,'').trim();
 return text;
}

/** End index (exclusive) of the balanced object/array starting at 0, or -1 when it never closes. */
function balancedEnd(text){
 let depth=0,inString=false,escaped=false;
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(inString){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')inString=false;continue;}
  if(c==='"')inString=true;else if(c==='{'||c==='[')depth++;else if(c==='}'||c===']'){depth--;if(depth===0)return i+1;}
 }
 return -1;
}

/** Fixed label for content that did not parse. Exported for tests. */
export function modelJsonShape(content){
 const raw=typeof content==='string'?content:'';
 if(!raw.trim())return 'empty';
 const text=unwrapModelJson(raw);
 if(!text)return 'empty';
 if(text.includes('```'))return 'fenced';
 if(text[0]!=='{'&&text[0]!=='[')return text.includes('<|')?'harmony_marker':'leading_text';
 const end=balancedEnd(text);
 if(end<0)return 'unterminated';
 const rest=text.slice(end).trim();
 if(rest)return rest.startsWith('<|')?'harmony_marker':rest[0]==='{'||rest[0]==='['?'multiple_values':'trailing_text';
 return 'invalid_syntax';
}

export function decodeModelJson(content,response){
 const raw=String(content??'');
 try{return JSON.parse(raw.trim());}catch{/* try the lossless unwrap */}
 const text=unwrapModelJson(raw);
 if(text)try{return JSON.parse(text);}catch{/* classified below */}
 throw modelOutputFailure(response,'json','invalid_final_json',{shape:modelJsonShape(raw),contentSize:modelContentSize(raw)});
}
