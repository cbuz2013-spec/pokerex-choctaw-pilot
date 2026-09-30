import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import pg from 'pg';
import {PGlite} from '@electric-sql/pglite';
import {photoServiceError} from '../lib/ai-errors.js';
import '../csv.js';

test('CSV validates headers and preserves quoted values and leading-zero numbers',()=>{
 const parse=globalThis.PokerExCSV.parse;
 assert.throws(()=>parse('UnexpectedColumn\nQA-INVALID-HEADER'),/Dealer header/);
 assert.throws(()=>parse('Dealer,Dealer Number\nValid,007\nMissing'),/column count/);
 assert.throws(()=>parse('Dealer,Dealer Number\n,007'),/dealer name/);
 assert.throws(()=>parse('Dealer,Dealer Number\n"Unclosed,007'),/unclosed quote/);
 assert.throws(()=>parse('Dealer,Name,Dealer Number\na,b,007'),/duplicate column/);
 const rows=parse('\uFEFFDealer,Dealer Number,Shift\r\n"Smith, ""Jo""",007,"Day\nShift"');
 assert.equal(rows[0].dealer,'Smith, "Jo"');assert.equal(rows[0].dealerNumber,'007');assert.equal(rows[0].shift,'Day\nShift');
 assert.throws(()=>parse('Dealer,Dealer Number\nTest,007',true),/Date header/);
});

test('AI failures explain recovery without leaking provider response details',()=>{
 const quota=photoServiceError(429,{error:{code:'insufficient_quota',message:'private-account-details'}});
 assert.equal(quota.status,503);assert.match(quota.message,/credits/);assert.doesNotMatch(quota.message,/private-account/);
 assert.match(photoServiceError(401).message,/configuration/);
 assert.match(photoServiceError(429).message,/busy/);
});

test('browser scripts compile and production page has no published demo credentials',async()=>{
 const html=await fs.readFile(new URL('../index.html',import.meta.url),'utf8');
 for(const match of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);
 for(const file of ['qa-fixes.js','csv.js','drafts.js','down-cards.js'])new vm.Script(await fs.readFile(new URL('../'+file,import.meta.url),'utf8'));
 assert.doesNotMatch(html,/Demo owner PIN|Demo: George|value="5555"/);
 assert.match(html,/qa-fixes\.js/);assert.match(html,/End is next day/);
 const config=JSON.parse(await fs.readFile(new URL('../deployment/vercel-with-minute-cron.json',import.meta.url),'utf8'));
 assert.ok(config.crons.some(x=>x.path==='/api/notifications-cron'&&x.schedule==='* * * * *'));
});

test('QA fixes against a disposable database',async t=>{
 const db=new PGlite();await db.exec(await fs.readFile(new URL('../schema.sql',import.meta.url),'utf8'));await db.exec('CREATE FUNCTION pg_advisory_xact_lock(bigint) RETURNS void LANGUAGE SQL AS $$ SELECT $$;');
 const query=(s,p=[])=>p.length?db.query(s,p):db.exec(s).then(r=>r.at(-1));pg.Pool=class{query(s,p=[]){return query(s,p)}async connect(){return {query,release(){}}}};
 process.env.DATABASE_URL='postgres://disposable-qa-patch';process.env.POKEREX_ENABLE_DEMO='true';
 const {default:handler}=await import('../api/app.js');
 const call=async body=>{let output,status=200;const res={setHeader(){},status(n){status=n;return this},json(v){output=v;return this}};await handler({method:'POST',body:{room:'4271',...body},query:{}},res);return {status,...output}};
 const owner=await call({action:'ownerLogin',orgCode:'DEMO',pin:'5555'});assert.equal(owner.status,200);
 const login=(name,pin,role='dealer')=>call({action:'roomLogin',name,pin,role});
 const manager=await login('George','2468','manager'),larry=await login('Larry','2222'),sarah=await login('Sarah','3333');
 const act=(s,action,b={})=>call({action,token:s.token,...b});
 await t.test('event requires dates, names and a real ordered calendar range',async()=>{
  assert.equal((await act(manager,'setEvent',{eventName:'QA'})).status,400);
  assert.equal((await act(manager,'setEvent',{eventName:'QA',eventStart:'2026-02-30',eventEnd:'2026-03-01'})).status,400);
  const r=await act(manager,'setEvent',{eventName:'QA',eventStart:'2026-10-26',eventEnd:'2026-10-30'});assert.equal(r.status,200);
  assert.equal((await act(manager,'state')).room.settings.eventStart,'2026-10-26');
 });
 await t.test('duplicate and overlapping assigned shifts rejected; adjacent shifts allowed',async()=>{
  const shift={dealer:'Larry',date:'2026-10-28',start:'09:00',end:'10:00'};
  assert.equal((await act(manager,'addShift',shift)).status,200);
  assert.equal((await act(manager,'addShift',shift)).status,409);
  assert.equal((await act(manager,'addShift',{...shift,start:'09:30',end:'10:30'})).status,409);
  assert.equal((await act(manager,'addShift',{...shift,start:'10:00',end:'11:00'})).status,200);
  assert.equal((await act(manager,'state')).room.schedule.filter(x=>x.dealer==='Larry').length,2);
 });
 await t.test('overnight shift overlaps are checked across dates',async()=>{
  assert.equal((await act(manager,'addShift',{dealer:'Sarah',date:'2026-10-28',start:'23:00',end:'02:00'})).status,200);
  assert.equal((await act(manager,'addShift',{dealer:'Sarah',date:'2026-10-29',start:'01:00',end:'03:00'})).status,409);
 });
 await t.test('imports and pickups reject conflicts while multiple open positions remain possible',async()=>{
  assert.equal((await act(manager,'importSchedule',{rows:[{dealer:'Larry',dealerNumber:'002',date:'2026-10-28',start:'09:15',end:'10:15'}]})).status,409);
  const slot={dealer:'OPEN',date:'2026-10-28',start:'09:15',end:'10:15'};
  assert.equal((await act(manager,'addShift',slot)).status,200);
  const added=await act(manager,'addShift',slot);assert.equal(added.status,200);
  const sh=added.room.schedule.find(x=>x.status==='open'&&x.start==='09:15');
  assert.equal((await act(larry,'claimShift',{shiftId:sh.id})).status,409);
 });
 await t.test('request withdrawal respects ownership and leaves assignment unchanged',async()=>{
  let r=await act(manager,'state');const shift=r.room.schedule.find(x=>x.dealer==='Larry'&&x.start==='09:00');
  r=await act(larry,'offerSwap',{shiftId:shift.id});const req=r.room.swapRequests.find(x=>x.shiftId===shift.id);
  assert.equal((await act(sarah,'withdrawRequest',{requestId:req.id})).status,403);
  r=await act(larry,'withdrawRequest',{requestId:req.id});assert.equal(r.status,200);assert.equal(r.room.schedule.find(x=>x.id===shift.id).dealer,'Larry');
  assert.equal(r.room.swapRequests.find(x=>x.id===req.id).status,'denied');
  assert.equal((await act(larry,'withdrawRequest',{requestId:req.id})).status,409);
  assert.equal((await act(sarah,'acceptSwap',{requestId:req.id})).status,409);
 });
 await t.test('manager can close an open swap without cancelling the shift',async()=>{
  let r=await act(manager,'state');const sh=r.room.schedule.find(x=>x.dealer==='Larry'&&x.start==='10:00');
  r=await act(larry,'offerSwap',{shiftId:sh.id});const req=r.room.swapRequests.find(x=>x.shiftId===sh.id);
  assert.equal((await act(manager,'denyRequest',{requestId:req.id})).status,200);
  assert.equal((await act(manager,'state')).room.schedule.find(x=>x.id===sh.id).status,'assigned');
 });
 await t.test('down end must follow start; overnight must be explicit and persists',async()=>{
  const row={date:'2026-09-29',table:'Setup',start:'18:00',end:'17:30'};
  assert.equal((await act(larry,'addDown',row)).status,400);
  assert.equal((await act(larry,'addDown',{...row,end:'18:00'})).status,400);
  assert.equal((await act(larry,'addDown',{...row,end:'25:00'})).status,400);
  assert.equal((await act(larry,'addDown',{...row,start:'23:30',end:'00:00'})).status,400);
  const night={...row,start:'23:30',end:'00:00',endNextDay:true};
  assert.equal((await act(larry,'addDown',night)).status,200);
  assert.equal((await act(larry,'addDown',night)).status,409);
  assert.equal((await act(larry,'state')).room.myDowns[0].endNextDay,true);
 });
 await t.test('last active owner cannot be disabled',async()=>{
  assert.equal((await call({action:'setOwnerActive',orgCode:'DEMO',token:owner.token,ownerId:owner.owners[0].id,active:false})).status,400);
  assert.equal((await call({action:'ownerBootstrap',orgCode:'DEMO',token:owner.token})).status,200);
 });
 await t.test('published owner PIN and its existing sessions fail closed outside explicit test mode',async()=>{
  await call({action:'createOwner',orgCode:'DEMO',token:owner.token,name:'Private QA Owner',pin:'846291'});
  process.env.POKEREX_ENABLE_DEMO='false';
  assert.equal((await call({action:'ownerLogin',orgCode:'DEMO',pin:'5555'})).status,403);
  assert.equal((await call({action:'ownerBootstrap',orgCode:'DEMO',token:owner.token})).status,401);
  assert.equal((await act(owner,'state')).status,401);
  const privateOwner=await call({action:'ownerLogin',orgCode:'DEMO',pin:'846291'});assert.equal(privateOwner.status,200);
  assert.equal((await call({action:'ownerBootstrap',orgCode:'DEMO',token:privateOwner.token})).status,200);
 });
 await db.close();
});
