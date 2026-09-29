// Local verification only: ephemeral PostgreSQL and a deterministic AI response.
// Never used by api/app.js or the deployed application.
import {PGlite} from '@electric-sql/pglite';
import pg from 'pg';
import webpush from 'web-push';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),db=new PGlite();
await db.exec(await fs.readFile(path.join(root,'schema.sql'),'utf8'));
await db.exec('CREATE FUNCTION pg_advisory_xact_lock(bigint) RETURNS void LANGUAGE SQL AS $$ SELECT $$;');
const query=async(s,p=[])=>p.length?db.query(s,p):(await db.exec(s)).at(-1);
pg.Pool=class {query(s,p=[]){return query(s,p)} async connect(){return {query,release(){}}}};
process.env.DATABASE_URL='postgres://local-verification';process.env.OPENAI_API_KEY='local-verification';
const pair=webpush.generateVAPIDKeys();process.env.VAPID_PUBLIC_KEY=pair.publicKey;process.env.VAPID_PRIVATE_KEY=pair.privateKey;process.env.VAPID_SUBJECT='mailto:test@example.com';process.env.CRON_SECRET='fixture-only-scheduler-secret-00000000000000000000';
webpush.sendNotification=async()=>({statusCode:201});
const realFetch=globalThis.fetch;
globalThis.fetch=async(url,options)=>String(url).startsWith('https://api.openai.com/')?{ok:true,json:async()=>({output_text:JSON.stringify({rows:[
 {event:'Poker Executives Event',table:'42',date:'2026-10-27',time:'12:00',dealerNumber:'007',dealerName:'George',confidence:'high',notes:''},
 {event:'Poker Executives Event',table:'42',date:'2026-10-27',time:'12:30',dealerNumber:'118',dealerName:'Larry',confidence:'low',notes:'Confirm handwritten dealer number'},
 {event:'Poker Executives Event',table:'42',date:'2026-10-28',time:'13:00',dealerNumber:'007',dealerName:'George',confidence:'high',notes:''}
 ]})})}:realFetch(url,options);
const {default:handler}=await import('../api/app.js');
const seedRes={setHeader(){},status(){return this},json(v){if(v.error)throw Error(v.error);return this}};
await handler({method:'POST',body:{action:'ownerLogin',orgCode:'DEMO',pin:'5555'},query:{}},seedRes);
await db.query("UPDATE room_members SET dealer_number=CASE name WHEN 'George' THEN '007' WHEN 'Larry' THEN '118' WHEN 'Sarah' THEN '214' ELSE '425' END");
await db.query("UPDATE rooms SET event_start_date='2026-10-27',event_end_date='2026-10-29'");
let queue=Promise.resolve();
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(['/api/app','/api/notifications-cron'].includes(url.pathname)){
  let raw='';for await(const chunk of req)raw+=chunk;
  res.status=n=>{res.statusCode=n;return res};res.json=v=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(v));return res};
  req.query=Object.fromEntries(url.searchParams);if(url.pathname==='/api/notifications-cron')req.query.action='notificationWorker';req.body=raw?JSON.parse(raw):{};
  queue=queue.then(()=>handler(req,res));await queue;return;
 }
 const allowed={'/':'index.html','/index.html':'index.html','/down-cards.js':'down-cards.js','/down-cards.css':'down-cards.css','/sw.js':'sw.js','/drafts.js':'drafts.js','/chat.js':'chat.js','/chat.css':'chat.css','/pokerex.js':'pokerex.js','/pokerex.css':'pokerex.css','/poker-executives-logo.png':'poker-executives-logo.png','/pokerex-icon.svg':'pokerex-icon.svg','/manifest.webmanifest':'manifest.webmanifest'};
 if(!allowed[url.pathname]){res.statusCode=404;res.end();return;}
 const file=allowed[url.pathname];res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':file.endsWith('.svg')?'image/svg+xml':file.endsWith('.webmanifest')?'application/manifest+json':'text/html');res.end(await fs.readFile(path.join(root,file)));
});server.listen(4178,'127.0.0.1',()=>console.log('Verification server http://127.0.0.1:4178 (ephemeral test data, mocked AI only)'));
