import crypto from 'node:crypto';

export const notificationMigration = `
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/Chicago';
CREATE TABLE IF NOT EXISTS manager_messages (
 id TEXT PRIMARY KEY,room_id BIGINT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
 request_id TEXT NOT NULL,request_hash TEXT NOT NULL,sender TEXT NOT NULL,
 subject TEXT NOT NULL,body TEXT NOT NULL,audience TEXT NOT NULL,
 recipients JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),UNIQUE(room_id,request_id)
);
CREATE TABLE IF NOT EXISTS push_deliveries (
 id BIGSERIAL PRIMARY KEY,notification_id BIGINT NOT NULL REFERENCES notification_events(id) ON DELETE CASCADE,
 subscription_id BIGINT NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
 room_id BIGINT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed','cancelled')),
 attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 last_error TEXT,sent_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(notification_id,subscription_id)
);
CREATE INDEX IF NOT EXISTS push_deliveries_due_idx ON push_deliveries(status,next_attempt_at);
CREATE TABLE IF NOT EXISTS notification_worker_status (
 id INTEGER PRIMARY KEY CHECK(id=1),last_started_at TIMESTAMPTZ,last_completed_at TIMESTAMPTZ
);
`;
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const plain=(v,max)=>String(v??'').replace(/[<>]/g,'').trim().slice(0,max);
export function validateSubscription(sub) {
 let u;try{u=new URL(sub?.endpoint)}catch{throw fail('Invalid push subscription');}
 const h=u.hostname.toLowerCase();
 const allowed=h==='fcm.googleapis.com'||h==='android.googleapis.com'||h==='updates.push.services.mozilla.com'||h.endsWith('.push.services.mozilla.com')||h==='web.push.apple.com'||h.endsWith('.push.apple.com')||h.endsWith('.notify.windows.com');
 if(u.protocol!=='https:'||u.username||u.password||u.port||!allowed||String(sub.endpoint).length>2048)throw fail('Unsupported push service');
 const key=sub.keys||{};
 if(!/^[\w-]{80,100}={0,2}$/.test(key.p256dh||'')||!/^[\w-]{20,30}={0,2}$/.test(key.auth||''))throw fail('Invalid subscription keys');
 return {endpoint:u.href,keys:{p256dh:key.p256dh,auth:key.auth},expirationTime:sub.expirationTime||null};
}
export function cronAuthorized(header,secret) {
 if(!secret||secret.length<32)return false;
 const a=Buffer.from(String(header||'')),b=Buffer.from('Bearer '+secret);
 return a.length===b.length&&crypto.timingSafeEqual(a,b);
}
export function createNotifications({q,tx,webpush,env=process.env}) {
 let configuration={configured:false,reason:'VAPID keys and contact are not configured.'};
 if(env.VAPID_PUBLIC_KEY&&env.VAPID_PRIVATE_KEY&&env.VAPID_SUBJECT){
  try{
   const pair=crypto.createECDH('prime256v1');pair.setPrivateKey(Buffer.from(env.VAPID_PRIVATE_KEY,'base64url'));
   if(!pair.getPublicKey().equals(Buffer.from(env.VAPID_PUBLIC_KEY,'base64url')))throw Error('VAPID key mismatch');
   webpush.setVapidDetails(env.VAPID_SUBJECT,env.VAPID_PUBLIC_KEY,env.VAPID_PRIVATE_KEY);configuration={configured:true,reason:''};
  }
  catch{configuration.reason='VAPID configuration is invalid. Check the matching key pair and contact.';}
 }
 const configured=()=>configuration.configured;
 async function enqueue(db,roomId,memberId,key,title,body) {
  const {rows:[note]}=await db.query(`INSERT INTO notification_events(room_id,member_id,event_key,title,body) VALUES($1,$2,$3,$4,$5) ON CONFLICT(room_id,member_id,event_key) DO NOTHING RETURNING id`,[roomId,memberId,key,title,body]);
  if(note&&configured())await db.query(`INSERT INTO push_deliveries(notification_id,subscription_id,room_id) SELECT $1,id,$2 FROM push_subscriptions WHERE room_id=$2 AND member_id=$3 AND active=true ON CONFLICT DO NOTHING`,[note.id,roomId,memberId]);
  return !!note;
 }
 async function notifyMember(roomId,name,key,title,body) {
  return tx(async db=>{
   const {rows:[m]}=await db.query(`SELECT m.id FROM room_members m JOIN rooms r ON r.id=m.room_id WHERE m.room_id=$1 AND lower(m.name)=lower($2) AND m.active=true AND r.archived_at IS NULL AND r.notifications_enabled=true`,[roomId,name]);
   return m?enqueue(db,roomId,m.id,key,plain(title,160),plain(body,1600)):false;
  });
 }
 async function drain(roomId=null,limit=100) {
  if(!configured())return {sent:0,failed:0,pending:0};
  // Lease jobs atomically. Abandoned work becomes eligible again after two minutes.
  const {rows:jobs}=await q(`UPDATE push_deliveries SET status='sending',attempts=attempts+1,next_attempt_at=now()+interval '2 minutes'
   WHERE id IN (SELECT id FROM push_deliveries WHERE status IN ('pending','sending') AND next_attempt_at<=now() AND ($1::bigint IS NULL OR room_id=$1) ORDER BY id FOR UPDATE SKIP LOCKED LIMIT $2) RETURNING *`,[roomId,Math.min(limit,100)]);
  const result={sent:0,failed:0,pending:0};
  for(let offset=0;offset<jobs.length;offset+=10)await Promise.all(jobs.slice(offset,offset+10).map(async job=>{
   const {rows:[s]}=await q(`SELECT p.subscription,p.active,m.active AS member_active,r.notifications_enabled,r.archived_at,r.code,n.title,n.body FROM push_subscriptions p JOIN notification_events n ON n.id=$1 JOIN rooms r ON r.id=p.room_id JOIN room_members m ON m.id=p.member_id WHERE p.id=$2 AND p.room_id=$3 AND n.member_id=p.member_id`,[job.notification_id,job.subscription_id,job.room_id]);
   if(!s||!s.active||!s.member_active||!s.notifications_enabled||s.archived_at){await q(`UPDATE push_deliveries SET status='cancelled',last_error='Subscription or room is inactive' WHERE id=$1`,[job.id]);return;}
   try {
    validateSubscription(s.subscription);
    await webpush.sendNotification(s.subscription,JSON.stringify({title:s.title,body:s.body,tag:'pokerex-'+job.notification_id,url:'/?room='+encodeURIComponent(s.code)+'&tab=time'}),{TTL:3600,timeout:8000,urgency:'high'});
    await q(`UPDATE push_deliveries SET status='sent',sent_at=now(),last_error=NULL WHERE id=$1`,[job.id]);result.sent++;
   }catch(e){
    const code=Number(e.statusCode)||0,expired=[404,410].includes(code);
    const permanent=expired||e.status===400||([400,401,403,413].includes(code))||job.attempts>=5;
    if(expired)await q('UPDATE push_subscriptions SET active=false,updated_at=now() WHERE id=$1',[job.subscription_id]);
    const seconds=Math.min(3600,30*2**job.attempts);
    await q(`UPDATE push_deliveries SET status=$1,last_error=$2,next_attempt_at=now()+($3::int*interval '1 second') WHERE id=$4`,[permanent?'failed':'pending',code?'Push service HTTP '+code:'Push attempt failed',seconds,job.id]);
    result[permanent?'failed':'pending']++;
   }
  }));return result;
 }
 async function drainSafely(roomId,limit=100){try{return await drain(roomId,limit)}catch(e){console.warn('Push queue remains available for retry:',e.code||'database error');return {pending:true};}}
 async function reminders(roomId=null) {
  // Time zone belongs to the room; a client clock or server-local zone is never used.
  const {rows}=await q(`SELECT s.id,s.room_id,s.dealer_name,s.start_time,s.shift_date::text AS date,r.timezone,
   ((s.shift_date::text||' '||s.start_time)::timestamp AT TIME ZONE r.timezone) AS starts_at
   FROM shifts s JOIN rooms r ON r.id=s.room_id WHERE s.status='assigned' AND r.archived_at IS NULL AND r.notifications_enabled=true
   AND ($1::bigint IS NULL OR r.id=$1) AND s.start_time ~ '^([01]?[0-9]|2[0-3]):[0-5][0-9]$'
   AND s.shift_date BETWEEN CURRENT_DATE-1 AND CURRENT_DATE+2
   AND ((s.shift_date::text||' '||s.start_time)::timestamp AT TIME ZONE r.timezone)>now()
   AND ((s.shift_date::text||' '||s.start_time)::timestamp AT TIME ZONE r.timezone)<=now()+interval '15 minutes'`,[roomId]);
  let created=0;for(const sh of rows)if(await notifyMember(sh.room_id,sh.dealer_name,`shift15:${sh.id}:${sh.date}:${sh.start_time}:${sh.dealer_name.toLowerCase()}`,'Upcoming shift',`Your shift starts at ${sh.start_time} (${sh.timezone}), in about ${Math.max(1,Math.round((new Date(sh.starts_at)-Date.now())/60000))} minutes.`))created++;
  return created;
 }
 async function worker(){
  await q(`INSERT INTO notification_worker_status(id,last_started_at) VALUES(1,now()) ON CONFLICT(id) DO UPDATE SET last_started_at=now()`);
  const created=await reminders(),delivery=await drain();
  await q('UPDATE notification_worker_status SET last_completed_at=now() WHERE id=1');return {created,...delivery};
 }
 async function handle({action,b,room,ss,res}) {
  const actions=['pushConfig','subscribePush','unsubscribePush','testPush','sendManagerMessage','managerMessageHistory','notificationAdmin','setNotificationTimezone'];
  if(!actions.includes(action))return false;
  try {
   if(['sendManagerMessage','managerMessageHistory','notificationAdmin','setNotificationTimezone'].includes(action)&&(!ss.manager||!['manager','owner'].includes(ss.role)))throw fail('Manager or owner required',403);
   if(action==='pushConfig')res.json({...configuration,publicKey:configured()?env.VAPID_PUBLIC_KEY:'',canSubscribe:!!ss.member_id});
   else if(action==='subscribePush') {
    if(!ss.member_id)throw fail('Use a manager or dealer login to enable push on this device.');
    if(!configured())throw fail(configuration.reason,503);
    const sub=validateSubscription(b.subscription);
    await tx(async db=>{
     // One device endpoint belongs only to the current login, including across rooms.
     await db.query(`SELECT pg_advisory_xact_lock(hashtext($1)::bigint)`,[sub.endpoint]);
     await db.query('UPDATE push_subscriptions SET active=false,updated_at=now() WHERE endpoint=$1',[sub.endpoint]);
     await db.query(`INSERT INTO push_subscriptions(room_id,member_id,endpoint,subscription,active,updated_at) VALUES($1,$2,$3,$4,true,now()) ON CONFLICT(room_id,endpoint) DO UPDATE SET member_id=excluded.member_id,subscription=excluded.subscription,active=true,updated_at=now()`,[room.id,ss.member_id,sub.endpoint,sub]);
    });res.json({ok:true});
   }else if(action==='unsubscribePush'){
    await q('UPDATE push_subscriptions SET active=false,updated_at=now() WHERE room_id=$1 AND member_id=$2 AND endpoint=$3',[room.id,ss.member_id,String(b.endpoint||'')]);res.json({ok:true});
   }else if(action==='testPush'){
    if(!ss.member_id)throw fail('Use a manager or dealer login to test push.');
    if(!configured())throw fail(configuration.reason,503);
    if(!room.notifications_enabled)throw fail('Enable room notifications in Room settings first.');
    const {rows:[sub]}=await q('SELECT id FROM push_subscriptions WHERE room_id=$1 AND member_id=$2 AND active=true LIMIT 1',[room.id,ss.member_id]);if(!sub)throw fail('Enable notifications on this device first.');
    await notifyMember(room.id,ss.name,'push-test:'+Math.floor(Date.now()/30000),'PokerEx notification test','Your PokerEx notification connection is working.');res.json({ok:true,...await drainSafely(room.id)});
   }else if(action==='sendManagerMessage'){
    const subject=plain(b.subject,100),body=plain(b.message,1200),requestId=String(b.requestId||'');
    if(!subject||!body)throw fail('Enter a subject and message.');
    if(Buffer.byteLength(JSON.stringify({title:ss.name+': '+subject,body}),'utf8')>3400)throw fail('This message is too large for a push notification. Shorten it and retry.');
    if(!/^[\w-]{16,80}$/.test(requestId))throw fail('Missing message request ID. Reload and retry.');
    if(!['all','selected'].includes(b.audience))throw fail('Choose all dealers or selected dealers.');
    if(!room.notifications_enabled)throw fail('Room notifications are disabled. Enable them in Room settings first.');
    const names=[...new Set((Array.isArray(b.recipients)?b.recipients:[]).map(n=>plain(n,80)))].sort();
    if(b.audience==='selected'&&(!names.length||names.length>500))throw fail('Select between 1 and 500 dealers.');
    const hash=crypto.createHash('sha256').update(JSON.stringify([ss.name,subject,body,b.audience,names])).digest('hex');
    const saved=await tx(async db=>{
     await db.query('SELECT pg_advisory_xact_lock($1::bigint)',[room.id]);
     const {rows:[old]}=await db.query('SELECT * FROM manager_messages WHERE room_id=$1 AND request_id=$2',[room.id,requestId]);
     if(old){if(old.request_hash!==hash)throw fail('This send attempt has already been used for a different message.',409);return {id:old.id,count:old.recipients.length,replayed:true};}
     const {rows:[rate]}=await db.query("SELECT count(*)::int AS count FROM manager_messages WHERE room_id=$1 AND created_at>now()-interval '1 minute'",[room.id]);if(rate.count>=10)throw fail('Please wait a minute before sending more messages.',429);
     const {rows:roster}=await db.query('SELECT id,name,dealer_number FROM room_members WHERE room_id=$1 AND active=true ORDER BY name',[room.id]);
     const recipients=b.audience==='all'?roster:roster.filter(m=>names.includes(m.name));
     if(!recipients.length||(b.audience==='selected'&&recipients.length!==names.length))throw fail('One or more selected dealers are no longer active in this room. Refresh the roster.');
     const messageId=crypto.randomUUID();
     await db.query(`INSERT INTO manager_messages(id,room_id,request_id,request_hash,sender,subject,body,audience,recipients) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[messageId,room.id,requestId,hash,ss.name,subject,body,b.audience,JSON.stringify(recipients)]);
     for(const m of recipients)await enqueue(db,room.id,m.id,'message:'+messageId,plain(ss.name+': '+subject,160),body);
     await db.query('INSERT INTO audit_logs(id,room_id,actor,event_text) VALUES($1,$2,$3,$4)',[crypto.randomUUID(),room.id,ss.name,`Manager message sent to ${recipients.length} dealers: ${subject}`]);
     return {id:messageId,count:recipients.length,replayed:false};
    });res.json({...saved,delivery:await drainSafely(room.id)});
   }else if(action==='managerMessageHistory'){
    const {rows}=await q(`SELECT id,sender,subject,body,audience,recipients,created_at AS "createdAt" FROM manager_messages WHERE room_id=$1 ORDER BY created_at DESC LIMIT 100`,[room.id]);res.json({messages:rows});
   }else if(action==='setNotificationTimezone'){
    const zone=String(b.timezone||'');try{new Intl.DateTimeFormat('en-US',{timeZone:zone}).format()}catch{throw fail('Choose a valid IANA time zone.');}
    const {rows}=await q('SELECT name FROM pg_timezone_names WHERE name=$1',[zone]);if(!rows.length)throw fail('Unsupported time zone.');await q('UPDATE rooms SET timezone=$1 WHERE id=$2',[zone,room.id]);res.json({ok:true,timezone:zone});
   }else{
    const {rows:dealers}=await q(`SELECT m.name,m.dealer_number AS "dealerNumber",count(p.id)::int AS devices FROM room_members m LEFT JOIN push_subscriptions p ON p.member_id=m.id AND p.room_id=m.room_id AND p.active=true WHERE m.room_id=$1 AND m.active=true GROUP BY m.id ORDER BY m.name`,[room.id]);
    const {rows:counts}=await q('SELECT status,count(*)::int AS count FROM push_deliveries WHERE room_id=$1 GROUP BY status',[room.id]);
    const {rows:[workerState]}=await q('SELECT last_completed_at AS "lastCompletedAt" FROM notification_worker_status WHERE id=1');
    res.json({...configuration,timezone:room.timezone,notificationsEnabled:room.notifications_enabled,dealers,delivery:Object.fromEntries(counts.map(c=>[c.status,c.count])),schedulerSecretConfigured:!!env.CRON_SECRET&&env.CRON_SECRET.length>=32,lastSchedulerRun:workerState?.lastCompletedAt||null});
   }
  }catch(e){console.error('Notifications:',e.status?e.message:e.code||'internal error');res.status(e.status||500).json({error:e.status?e.message:'Unable to complete the notification request. Retry with the same message to avoid duplicate delivery.'});}
  return true;
 }
 return {configured,notifyMember,drain,drainSafely,reminders,worker,handle};
}
