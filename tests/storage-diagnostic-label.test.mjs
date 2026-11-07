import test from 'node:test';
import assert from 'node:assert/strict';
import {storageDiagnosticLabel} from '../lib/storage-diagnostic-label.mjs';
test('owner panel explains a storage timeout by operation, record class, duration and database code',()=>{
 assert.equal(storageDiagnosticLabel({op:'get',keyClasses:['central'],keyCount:1,ms:8881,status:500,pgCode:'57014',requestId:'a568d8f5c80c772a-GIG'}),'armazenamento: leitura (central) · 8,9 s · tempo-limite do banco');
 assert.equal(storageDiagnosticLabel({op:'get',keyClasses:['snapshots'],ms:9596,status:500,pgCode:'57014'}),'armazenamento: leitura (fontes) · 9,6 s · tempo-limite do banco');
});
test('transport failures and unknown codes stay readable without exposing identifiers',()=>{
 assert.equal(storageDiagnosticLabel({op:'commit',keyClasses:['central'],ms:30000,transport:'timeout'}),'armazenamento: gravação da central · 30,0 s · tempo esgotado na conexão');
 assert.equal(storageDiagnosticLabel({op:'get',keyClasses:['live','creative'],ms:120,status:200,transport:'decode'}),'armazenamento: leitura (dados atuais, criativos) · 0,1 s · resposta inválida');
 assert.equal(storageDiagnosticLabel({op:'get',ms:200,status:503}),'armazenamento: leitura · 0,2 s · HTTP 503');
 assert.equal(storageDiagnosticLabel({op:'get',pgCode:'XX000'}),'armazenamento: leitura · código do banco XX000');
 const label=storageDiagnosticLabel({op:'get',keyClasses:['snapshots:abc','central'],pgCode:'<script>',requestId:'a568d8f5c80c772a-GIG'});
 assert.equal(label,'armazenamento: leitura (central) · código do banco desconhecido');
 assert.doesNotMatch(label,/a568d8f5|script|abc/);
});
test('unknown or missing diagnostics render nothing',()=>{
 for(const value of [null,undefined,'x',{},{op:'drop'}])assert.equal(storageDiagnosticLabel(value),'');
});
