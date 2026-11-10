import {execFileSync} from 'node:child_process';
import {readdir,readFile} from 'node:fs/promises';
const tracked=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
if(tracked.some(p=>(/\/(?:node_modules|\.data|\.next)\//.test('/'+p)||/(^|\/)\.env(?:\.|$)/.test(p)&&!p.endsWith('.example'))))throw Error('A secret/configuration or generated runtime file is tracked.');
const forbidden=['SESSION_SECRET','FIELD_ENCRYPTION_KEY','PAYPAL_CLIENT_SECRET'].map(k=>process.env[k]).filter(v=>v&&v.length>=16);
async function scan(dir){let entries;try{entries=await readdir(dir,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return;throw e;}for(const entry of entries){const p=dir+'/'+entry.name;if(entry.isDirectory())await scan(p);else if(/\.(js|json|html)$/.test(entry.name)){const bytes=await readFile(p,'utf8');if(forbidden.some(value=>bytes.includes(value)))throw Error('Server secret detected in a browser build artifact.');}}}
await scan('apps/web/.next/static');console.log('Tracked-file and configured-secret browser artifact checks passed. Synthetic demo credentials are intentionally public local fixtures.');
