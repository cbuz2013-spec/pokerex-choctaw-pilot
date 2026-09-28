import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {createNotifications,notificationMigration,validateSubscription,cronAuthorized} from '../lib/notifications.js';
const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/test-device',keys:{p256dh:'A'.repeat(87),auth:'B'.repeat(22)}};
test('push endpoint validation prevents arbitrary server requests',()=>{
 assert.equal(validateSubscription(subscription).endpoint,subscription.endpoint);
 for(const endpoint of ['http://fcm.googleapis.com/x','https://127.0.0.1/x','https://example.com/x','https://fcm.googleapis.com.evil.test/x','https://user:pass@fcm.googleapis.com/x'])assert.throws(()=>validateSubscription({...subscription,endpoint}));
 assert.throws(()=>validateSubscription({...subscription,keys:{}}));
});
test('scheduler fails closed without a sufficiently strong matching secret',()=>{
 assert.equal(cronAuthorized('Bearer '+ 'a'.repeat(32),'a'.repeat(32)),true);
 assert.equal(cronAuthorized('Bearer '+ 'b'.repeat(32),'a'.repeat(32)),false);
 assert.equal(cronAuthorized('Bearer undefined',undefined),false);assert.equal(cronAuthorized('Bearer short','short'),false);
});
test('notification delivery, messaging and scheduler integration',async t=>{
 const db=new PGlite();await db.exec(await fs.readFile(new URL('../schema.sql',import.meta.url),'utf8'));await db.exec(notificationMigration);await db.exec(notificationMigration);
 await db.exec('CREATE FUNCTION pg_advisory_xact_lock(bigint) RETURNS void LANGUAGE SQL AS $$ SELECT $$;');
 const q=(s,p=[])=>db.query(s,p),tx=fn=>db.transaction(c=>fn({query:(s,p=[])=>c.query(s,p)}));
 const {rows:[org]}=await q("INSERT INTO organizations(code,name,owner_name,owner_pin_hash,owner_pin_salt) VALUES('TEST','PokerEx','Owner','hash','salt') RETURNING id");
 const {rows:[room]}=await q("INSERT INTO rooms(organization_id,code,room_name,event_name) VALUES($1,'1000','Choctaw','Choctaw Pilot') RETURNING *",[org.id]);
 const {rows:[other]}=await q("INSERT INTO rooms(organization_id,code,room_name) VALUES($1,'2000','Other Room') RETURNING *",[org.id]);
 async function member(name,number,roomId=room.id,active=true){return (await q('INSERT INTO room_members(room_id,name,dealer_number,pin_hash,pin_salt,active) VALUES($1,$2,$3,\'hash\',\'salt\',$4) RETURNING *',[roomId,name,number,active])).rows[0];}
 const george=await member('George','007'),larry=await member('Larry','118');await member('Inactive','119',room.id,false);await member('Foreign','001',other.id);
 let outcome='success',calls=[];
 const webpush={setVapidDetails(){},async sendNotification(sub,payload){calls.push(JSON.parse(payload));if(outcome==='retry')throw Object.assign(Error('temporary'),{statusCode:503});if(outcome==='expired')throw Object.assign(Error('gone'),{statusCode:410});}};
 const pair=crypto.createECDH('prime256v1');pair.generateKeys();
 const env={VAPID_PUBLIC_KEY:pair.getPublicKey().toString('base64url'),VAPID_PRIVATE_KEY:pair.getPrivateKey().toString('base64url'),VAPID_SUBJECT:'mailto:test@example.com',CRON_SECRET:'x'.repeat(64)};
 const service=createNotifications({q,tx,webpush,env});
 async function act(action,b={},opts={}){const res={code:200,status(n){this.code=n;return this},json(body){this.body=body;return this}};
  await service.handle({action,b,room:opts.room||room,ss:{name:'George',manager:true,role:'manager',member_id:george.id,...opts.ss},res});return res;
 }
 const msg=(id,extra={})=>({requestId:id.repeat(18),subject:'Shift briefing',message:'Meet at the podium.',audience:'selected',recipients:['Larry'],...extra});
 await t.test('manager-only endpoints reject dealer sessions',async()=>{
  for(const action of ['sendManagerMessage','managerMessageHistory','notificationAdmin','setNotificationTimezone'])assert.equal((await act(action,{}, {ss:{role:'dealer'}})).code,403);
 });
 await t.test('subscriptions attach only to the authenticated member and room',async()=>{
  assert.equal((await act('subscribePush',{subscription},{ss:{member_id:larry.id,name:'Larry'}})).code,200);
  const rows=(await q('SELECT * FROM push_subscriptions')).rows;assert.equal(rows[0].member_id,larry.id);
 });
 await t.test('targeted messages create one inbox entry and one push, with safe retries',async()=>{
  const r=await act('sendManagerMessage',msg('a'));assert.equal(r.code,200);assert.equal(r.body.count,1);assert.equal(calls.length,1);assert.equal((await q('SELECT * FROM notification_events')).rows[0].member_id,larry.id);
  const again=await act('sendManagerMessage',msg('a'));assert.equal(again.body.replayed,true);assert.equal(calls.length,1);
  assert.equal((await act('sendManagerMessage',msg('a',{message:'Changed'}))).code,409);
 });
 await t.test('all-dealer broadcasts exclude inactive dealers and other rooms',async()=>{
  const r=await act('sendManagerMessage',msg('b',{audience:'all',recipients:[]}));assert.equal(r.body.count,2);
  const row=(await q('SELECT * FROM manager_messages WHERE id=$1',[r.body.id])).rows[0];assert.deepEqual(row.recipients.map(x=>x.name),['George','Larry']);
 });
 await t.test('foreign, inactive and empty selections are rejected atomically',async()=>{
  for(const recipients of [['Foreign'],['Inactive'],[]])assert.equal((await act('sendManagerMessage',msg('c',{recipients}))).code,400);
  assert.equal((await q('SELECT * FROM manager_messages')).rows.length,2);
 });
 await t.test('owners can send and history retains sender and frozen recipients',async()=>{
  assert.equal((await act('sendManagerMessage',msg('d'),{ss:{role:'owner',name:'Owner',member_id:null}})).code,200);
  const r=await act('managerMessageHistory');assert.equal(r.body.messages[0].sender,'Owner');assert.equal(r.body.messages[0].recipients[0].name,'Larry');
 });
 await t.test('temporary errors retry, event creation is idempotent, and successful retries stop',async()=>{
  outcome='retry';await service.notifyMember(room.id,'Larry','retry-test','Test','Body');await service.drain(room.id);const count=calls.length;
  await service.notifyMember(room.id,'Larry','retry-test','Test','Body');await service.drain(room.id);assert.equal(calls.length,count);
  assert.equal((await q("SELECT count(*)::int AS n FROM push_deliveries WHERE status='pending'")).rows[0].n,1);
  outcome='success';await q("UPDATE push_deliveries SET next_attempt_at=now() WHERE status='pending'");await service.drain(room.id);assert.equal(calls.length,count+1);await service.drain(room.id);assert.equal(calls.length,count+1);
 });
 await t.test('expired push endpoints deactivate while inbox messages remain',async()=>{
  outcome='expired';await service.notifyMember(room.id,'Larry','expire-test','Test','Body');await service.drain(room.id);
  assert.equal((await q('SELECT active FROM push_subscriptions WHERE member_id=$1',[larry.id])).rows[0].active,false);
  assert.equal((await q("SELECT * FROM notification_events WHERE event_key='expire-test'")).rows.length,1);outcome='success';
 });
 await t.test('endpoint reassignment does not expose a previous account notification',async()=>{
  await act('subscribePush',{subscription},{ss:{member_id:larry.id,name:'Larry'}});await service.notifyMember(room.id,'Larry','old-account','Private','Body');
  await act('subscribePush',{subscription});const before=calls.length;await service.drain(room.id);assert.equal(calls.length,before);
  assert.equal((await q("SELECT d.status FROM push_deliveries d JOIN notification_events n ON n.id=d.notification_id WHERE n.event_key='old-account'")).rows[0].status,'cancelled');
 });
 await t.test('shift reminders use room time zones and send once without a logged-in client',async()=>{
  await q(`INSERT INTO shifts(id,room_id,shift_date,start_time,end_time,dealer_name,status) SELECT 'near',$1,((now()+interval '14 minutes') AT TIME ZONE 'America/Chicago')::date,to_char((now()+interval '14 minutes') AT TIME ZONE 'America/Chicago','HH24:MI'),'','George','assigned'`,[room.id]);
  assert.equal(await service.reminders(),1);assert.equal(await service.reminders(),0);
  const r=await service.worker();assert.equal(r.created,0);assert.ok((await act('notificationAdmin')).body.lastSchedulerRun);
 });
 await t.test('admin status exposes no private key and invalid time zones are rejected',async()=>{
  const r=await act('notificationAdmin');assert.equal(r.body.configured,true);assert.equal(JSON.stringify(r.body).includes('private'),false);
  const second=crypto.createECDH('prime256v1');second.generateKeys();assert.equal(createNotifications({q,tx,webpush,env:{...env,VAPID_PUBLIC_KEY:second.getPublicKey().toString('base64url')}}).configured(),false);
  assert.equal((await act('setNotificationTimezone',{timezone:'Not/AZone'})).code,400);
  assert.equal((await act('setNotificationTimezone',{timezone:'America/New_York'})).code,200);
 });
 await t.test('no VAPID keys still permits in-app manager messages with explicit setup status',async()=>{
  const offline=createNotifications({q,tx,webpush,env:{}});assert.equal(offline.configured(),false);
  assert.equal(await offline.notifyMember(room.id,'Larry','inapp-only','Title','Body'),true);
  assert.equal((await q("SELECT * FROM notification_events WHERE event_key='inapp-only'")).rows.length,1);
 });
 await db.close();
});
