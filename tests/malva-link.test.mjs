import test from 'node:test';
import assert from 'node:assert/strict';
import {malvaCampaignsUrl} from '../lib/malva-link.mjs';
test('Malva link opens the project campaign list in the owner view and rejects anything that is not a project id',()=>{
 assert.equal(malvaCampaignsUrl('72b71a6b-f55a-4563-a456-1b441dec9851'),'https://malvadash.com/tracking/72b71a6b-f55a-4563-a456-1b441dec9851/campanhas?sales=traffic&preset=today&level=campaign&status=all');
 assert.equal(malvaCampaignsUrl('72B71A6B-F55A-4563-A456-1B441DEC9851',{preset:'evil'}),'https://malvadash.com/tracking/72b71a6b-f55a-4563-a456-1b441dec9851/campanhas?sales=traffic&preset=today&level=campaign&status=all');
 for(const bad of [null,'','all','../x','72b71a6b-f55a-4563-a456-1b441dec9851/../../x','javascript:alert(1)'])assert.equal(malvaCampaignsUrl(bad),null);
});
