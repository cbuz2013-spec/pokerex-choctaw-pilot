import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import webpush from 'web-push';
const args=process.argv.slice(2),i=args.indexOf('--subject'),subject=i>=0?args[i+1]:'';
let valid=/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/.test(subject||'');
try{const u=new URL(subject);valid=valid||(u.protocol==='https:'&&!u.username&&!u.password);}catch{}
if(!valid){
 console.error('Usage: npm run setup-push -- --subject mailto:YOUR_CONTACT_EMAIL (or your HTTPS site URL)');process.exit(1);
}
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),dir=path.join(root,'.secrets'),file=path.join(dir,'pokerex-vercel.env');
if(fs.existsSync(file)){console.log('Existing keys preserved. Open '+file+' locally to copy the values into Vercel.');process.exit(0);}
const pair=webpush.generateVAPIDKeys();fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(file,`VAPID_PUBLIC_KEY=${pair.publicKey}\nVAPID_PRIVATE_KEY=${pair.privateKey}\nVAPID_SUBJECT=${subject}\nCRON_SECRET=${crypto.randomBytes(32).toString('hex')}\n`,{mode:0o600,flag:'wx'});
console.log('Created private Vercel setup file: '+file);
console.log('Copy its four variables into Vercel Production. Keep this file private; do not upload it to GitHub or include it in the release ZIP.');
