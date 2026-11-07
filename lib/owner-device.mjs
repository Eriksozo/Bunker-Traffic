/** Owner approvals signed on the owner's Mac.
 * The private key lives in the Mac's Secure Enclave and every signature needs
 * Touch ID (or the Mac password). The server keeps only the public key
 * (BUNKER_OWNER_DEVICE_KEY, base64 X9.63, 65 bytes), so nothing stored here can
 * sign. A valid signature proves the owner is present for exactly this request;
 * it does not widen what the owner may do: the same card/proposal rules apply.
 */
export const OWNER_DEVICE_AUDIENCE='bunker-traffic/owner-device';
export const ownerDeviceLimits=Object.freeze({bodyBytes:64000,skewMs:120000});
/** Only owner feedback and the review of an exact proposal. Nothing else. */
export const ownerDeviceOps=Object.freeze(['cardDecision','proposalReview']);

export class OwnerDeviceError extends Error{constructor(code){super(code);this.code=code;}}
const fail=code=>{throw new OwnerDeviceError(code);};
const fromBase64=value=>{
 if(typeof value!=='string'||!/^[A-Za-z0-9+/]+={0,2}$/.test(value)||value.length>200000)fail('OWNER_DEVICE_FORMAT');
 const raw=atob(value),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);return bytes;
};
const hex=bytes=>[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');

/** Short public identifier of the registered key: first 16 hex of SHA-256(X9.63). */
export async function ownerDeviceKeyId(publicKey){
 const bytes=typeof publicKey==='string'?fromBase64(publicKey):publicKey;
 return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).slice(0,16);
}

function publicKeyBytes(configured){
 if(typeof configured!=='string')fail('OWNER_DEVICE_UNCONFIGURED');
 let bytes;try{bytes=fromBase64(configured.trim());}catch{fail('OWNER_DEVICE_UNCONFIGURED');}
 if(bytes.length!==65||bytes[0]!==4)fail('OWNER_DEVICE_UNCONFIGURED');
 return bytes;
}

/** Validates the envelope {v:1,key,payload,sig} and returns the owner input.
 * payload = base64 of the exact signed JSON {aud,iat,input}; sig = base64 raw r||s (P-256, SHA-256). */
export async function verifyOwnerDeviceRequest(bodyText,configuredKey,now=Date.now()){
 const keyBytes=publicKeyBytes(configuredKey);
 if(typeof bodyText!=='string'||bodyText.length>ownerDeviceLimits.bodyBytes)fail('OWNER_DEVICE_LIMIT');
 let envelope;try{envelope=JSON.parse(bodyText);}catch{fail('OWNER_DEVICE_FORMAT');}
 if(!envelope||envelope.v!==1||typeof envelope.payload!=='string'||typeof envelope.sig!=='string')fail('OWNER_DEVICE_FORMAT');
 const keyId=await ownerDeviceKeyId(keyBytes);
 if(envelope.key!==keyId)fail('OWNER_DEVICE_UNKNOWN_KEY');
 const payload=fromBase64(envelope.payload),signature=fromBase64(envelope.sig);
 if(signature.length!==64)fail('OWNER_DEVICE_SIGNATURE');
 const key=await crypto.subtle.importKey('raw',keyBytes,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
 if(!await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,signature,payload))fail('OWNER_DEVICE_SIGNATURE');
 let signed;try{signed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(payload));}catch{fail('OWNER_DEVICE_FORMAT');}
 if(!signed||signed.aud!==OWNER_DEVICE_AUDIENCE||!Number.isSafeInteger(signed.iat))fail('OWNER_DEVICE_FORMAT');
 if(Math.abs(now-signed.iat)>ownerDeviceLimits.skewMs)fail('OWNER_DEVICE_EXPIRED');
 const input=signed.input;
 if(!input||typeof input!=='object'||Array.isArray(input)||!ownerDeviceOps.includes(input.op))fail('OWNER_DEVICE_OP');
 if(!Number.isSafeInteger(input.revision)||typeof input.clientId!=='string'||!/^[A-Za-z0-9:_-]{8,150}$/.test(input.clientId))fail('OWNER_DEVICE_FORMAT');
 return {input,keyId,ownerId:'mac-touchid:'+keyId};
}
