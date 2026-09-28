import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {migration,normalizeRow,validateRow,timeKey,validDate,makeReport,reportCSV,insertDown,handleDownCards} from '../lib/down-cards.js';

const row={event:'Main Event',table:'42',date:'2026-10-27',time:'12:00',dealerNumber:'007',dealerName:'Morgan Lee',confidence:'high',notes:'',approved:true};
test('normalization preserves dealer numbers and rejects impossible dates/times',()=>{
 assert.equal(normalizeRow({...row,dealerNumber:'7'}).dealerNumber,'007');
 assert.equal(normalizeRow({...row,dealerNumber:'7000'}).dealerNumber,'');
 assert.equal(timeKey('12:30 PM'),'12:30');assert.equal(timeKey('12:00 AM'),'00:00');assert.equal(timeKey('1:30 PM'),'13:30');
 assert.equal(timeKey('24:00'),'');assert.equal(timeKey('12:60'),'');assert.equal(validDate('2026-02-30'),false);
 assert.equal(validateRow(row,[{id:1,name:'Different Dealer',dealer_number:'007'}]).issues.length,1);
 assert.ok(validateRow({...row,dealerNumber:'000'},[{id:1,name:'Morgan Lee',dealer_number:null}]).issues.length);
});
test('spreadsheet includes zero dates and dealers, totals, and CSV formula protection',()=>{
 const records=[{memberId:1,date:'2026-10-27',dealerName:'=FORMULA()',dealerNumber:'007'},{memberId:1,date:'2026-10-27',dealerName:'=FORMULA()'}];
 const report=makeReport(records,[{id:1,name:'=FORMULA()',dealer_number:'007'},{id:2,name:'Unused',dealer_number:'008'}],'Main Event','2026-10-27','2026-10-29');
 assert.equal(report.total,2);assert.equal(report.rows[0].total,2);assert.equal(report.rows[1].total,0);assert.equal(report.totals['2026-10-28'],0);
 assert.match(reportCSV(report),/"'007"/);assert.match(reportCSV(report),/"'=FORMULA\(\)"/);assert.match(reportCSV(report),/"TOTAL","","2","0","0","2"/);
});

test('PostgreSQL migration and transactional workflow',async t=>{
 const db=new PGlite();await db.exec(await fs.readFile(new URL('../schema.sql',import.meta.url),'utf8'));await db.exec(migration);await db.exec(migration);
 // Embedded PostgreSQL runs one connection. Replace the advisory-lock primitive for this engine only.
 await db.exec('CREATE FUNCTION pg_advisory_xact_lock(bigint) RETURNS void LANGUAGE SQL AS $$ SELECT $$;');
 const q=(s,p=[])=>db.query(s,p);
 const tx=fn=>db.transaction(client=>fn({query:(s,p=[])=>client.query(s,p)}));
 const {rows:[org]}=await q("INSERT INTO organizations(code,name,owner_name,owner_pin_hash,owner_pin_salt) VALUES('TEST','Test','Owner','hash','salt') RETURNING id");
 const {rows:[room]}=await q("INSERT INTO rooms(organization_id,code,room_name,event_name,event_start_date,event_end_date) VALUES($1,'1000','Test Room','Main Event','2026-10-27','2026-10-29') RETURNING *",[org.id]);
 const {rows:[m]}=await q("INSERT INTO room_members(room_id,name,dealer_number,pin_hash,pin_salt) VALUES($1,'Morgan Lee','007','hash','salt') RETURNING *",[room.id]);
 const {rows:[m2]}=await q("INSERT INTO room_members(room_id,name,dealer_number,pin_hash,pin_salt) VALUES($1,'Chris Jones','118','hash','salt') RETURNING *",[room.id]);
 async function upload(id,roomId=room.id){await q("INSERT INTO down_card_uploads(id,room_id,filename,image_data,extracted,uploaded_by) VALUES($1,$2,'card.jpg','data:image/jpeg;base64,YQ==','[]','Manager')",[id,roomId]);}
 async function action(name,b={},role='manager'){
  const res={code:200,status(n){this.code=n;return this;},json(v){this.body=v;return this;}};
  await handleDownCards({action:name,b,room,ss:{manager:true,role,name:'Manager'},q,tx,res});return res;
 }
 await t.test('dealer role is denied on every management endpoint even for a manager account',async()=>{
  for(const a of ['analyzeDownCard','importDownCards','downReport','downCardImage'])assert.equal((await action(a,{},'dealer')).code,403);
 });
 await t.test('one table card imports multiple dealer downs',async()=>{
  await upload('card1');const result=await action('importDownCards',{cards:[{uploadId:'card1',rows:[row,{...row,time:'12:30',dealerNumber:'118',dealerName:'Chris Jones'}]}]});
  assert.equal(result.code,200);assert.equal(result.body.imported,2);
 });
 await t.test('retry and re-upload do not double count',async()=>{
  assert.equal((await action('importDownCards',{cards:[{uploadId:'card1',rows:[row]}]})).body.alreadyImported,1);
  await upload('card2');const r=await action('importDownCards',{cards:[{uploadId:'card2',rows:[{...row,table:'Table 042',time:'12:00 PM',event:' main   event '}]}]});
  assert.equal(r.body.duplicates,1);assert.equal(r.body.imported,0);
  assert.equal(await tx(c=>insertDown(c,room.id,{...row},m)),false);
 });
 await t.test('invalid row rolls back the entire batch and leaves cards retryable',async()=>{
  await upload('card3');const r=await action('importDownCards',{cards:[{uploadId:'card3',rows:[{...row,time:'13:00'},{...row,time:'13:30',dealerNumber:'999'}]}]});
  assert.equal(r.code,400);assert.equal((await q('SELECT * FROM down_entries')).rows.length,2);assert.equal((await q("SELECT imported_at FROM down_card_uploads WHERE id='card3'")).rows[0].imported_at,null);
 });
 await t.test('unapproved rows and foreign room cards are rejected',async()=>{
  assert.equal((await action('importDownCards',{cards:[{uploadId:'card3',rows:[{...row,approved:false}]}]})).code,400);
  const {rows:[foreign]}=await q("INSERT INTO rooms(organization_id,code,room_name) VALUES($1,'2000','Other Room') RETURNING id",[org.id]);await upload('foreign',foreign.id);
  assert.equal((await action('importDownCards',{cards:[{uploadId:'foreign',rows:[row]}]})).code,400);
  assert.equal((await action('downCardImage',{uploadId:'foreign'})).code,404);
 });
 await t.test('report combines manual and imported downs, excludes breaks, and provides source audit',async()=>{
  await tx(c=>insertDown(c,room.id,{...row,time:'14:00'},m));
  await tx(c=>insertDown(c,room.id,{...row,time:'14:30',table:'Break'},m,null,{kind:'break'}));
  const r=await action('downReport',{},'owner');assert.equal(r.code,200);assert.equal(r.body.total,3);assert.equal(r.body.rows.find(x=>x.dealerNumber==='007').total,2);assert.equal(r.body.dates.length,3);
  assert.equal(r.body.records.filter(x=>x.uploadId).length,2);assert.match(r.body.csv,/Total Downs/);
  assert.equal((await action('downCardImage',{uploadId:'card1'})).body.uploadedBy,'Manager');
 });
 await t.test('AI response is staged without importing, and unreadable rows survive for review',async()=>{
  const oldFetch=globalThis.fetch,oldKey=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='test';
  globalThis.fetch=async()=>({ok:true,json:async()=>({output:[{content:[{type:'output_text',text:JSON.stringify({rows:[row,{...row,dealerNumber:'',time:'',confidence:'low'}]})}]}]})});
  try{const r=await action('analyzeDownCard',{imageData:'data:image/jpeg;base64,YQ==',filename:'new.jpg'});assert.equal(r.code,200);assert.equal(r.body.rows.length,2);assert.ok(r.body.rows[1].issues.length);assert.equal((await q('SELECT * FROM down_entries')).rows.length,4);}
  finally{globalThis.fetch=oldFetch;if(oldKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=oldKey;}
 });
 await db.close();
});
