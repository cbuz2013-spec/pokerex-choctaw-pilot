import {chatMigration,handleChat} from '../lib/chat.js';
import {operationsMigration,handleOperations,dateOnly,roomDay,roomDayBounds} from '../lib/operations.js';
import { notificationMigration, createNotifications, cronAuthorized } from '../lib/notifications.js';
import { migration, handleDownCards, insertDown, timeKey, validDate } from '../lib/down-cards.js';
import {photoServiceError} from '../lib/ai-errors.js';
import crypto from 'crypto';
import pg from 'pg';
import webpush from 'web-push';
const {Pool}=pg;
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false},max:5});
const now=()=>Date.now();
const clean=(v,n=80)=>String(v??'').replace(/[<>]/g,'').trim().slice(0,n);
const digits=v=>String(v??'').replace(/\D/g,'').slice(0,12);
const id=p=>`${p}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
const token=()=>crypto.randomBytes(32).toString('hex');
const tokenHash=t=>crypto.createHash('sha256').update(String(t)).digest('hex');
function hashPin(pin,salt=crypto.randomBytes(16).toString('hex')){return {salt,hash:crypto.scryptSync(String(pin),salt,32).toString('hex')}}
function verifyPin(pin,salt,hash){if(!salt||!hash)return false;const a=Buffer.from(hashPin(pin,salt).hash,'hex'),b=Buffer.from(hash,'hex');return a.length===b.length&&crypto.timingSafeEqual(a,b)}
async function q(text,params=[]){return pool.query(text,params)}
async function tx(fn){const c=await pool.connect();try{await c.query('BEGIN');const out=await fn(c);await c.query('COMMIT');return out}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}}
const ms=v=>v?new Date(v).getTime():null;

let schemaReady;
async function ensureChoctawSchema(){if(!schemaReady)schemaReady=applyChoctawSchema().catch(e=>{schemaReady=null;throw e});return schemaReady;}
async function applyChoctawSchema(){
  await q(migration);
  await q(`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ`);
  await q(`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS event_name TEXT`);
  await q(`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS event_start_date DATE`);
  await q(`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS event_end_date DATE`);
  await q(`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS eo_method TEXT NOT NULL DEFAULT 'shift_start'`);
  await q(`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS eo_tiebreaker TEXT NOT NULL DEFAULT 'signup'`);
  await q(`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS eo_min_hours NUMERIC(5,2) NOT NULL DEFAULT 0`);
  await q(`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS eo_min_downs INTEGER NOT NULL DEFAULT 0`);
  await q(`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS geofence_enabled BOOLEAN NOT NULL DEFAULT FALSE`);
  await q(`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS geofence_lat DOUBLE PRECISION`);
  await q(`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS geofence_lng DOUBLE PRECISION`);
  await q(`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS geofence_radius_m INTEGER NOT NULL DEFAULT 250`);
  await q(`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS resource_config JSONB NOT NULL DEFAULT '{"tables":[],"breaks":["Break"],"brushes":["Brush"],"setup":["Setup"]}'::jsonb`);
  await q(`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE`);
  await q(`ALTER TABLE room_members ADD COLUMN IF NOT EXISTS dealer_number TEXT`);
  await q(`ALTER TABLE room_members ADD COLUMN IF NOT EXISTS must_change_pin BOOLEAN NOT NULL DEFAULT FALSE`);
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS room_dealer_number_unique ON room_members(room_id,dealer_number) WHERE dealer_number IS NOT NULL`);
  await q(`ALTER TABLE shifts ADD COLUMN IF NOT EXISTS shift_label TEXT`);
  await q(`CREATE INDEX IF NOT EXISTS rooms_org_archived_idx ON rooms(organization_id, archived_at)`);
  await q(`CREATE TABLE IF NOT EXISTS organization_owners (
    id BIGSERIAL PRIMARY KEY,
    organization_id BIGINT REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    pin_hash TEXT NOT NULL,
    pin_salt TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS organization_owners_org_lower_name_uq ON organization_owners(organization_id, lower(name))`);
  await q(`INSERT INTO organization_owners(organization_id,name,pin_hash,pin_salt,active)
           SELECT id,owner_name,owner_pin_hash,owner_pin_salt,true FROM organizations
           ON CONFLICT DO NOTHING`);
  await q(`CREATE TABLE IF NOT EXISTS push_subscriptions (
    id BIGSERIAL PRIMARY KEY,room_id BIGINT REFERENCES rooms(id) ON DELETE CASCADE,
    member_id BIGINT REFERENCES room_members(id) ON DELETE CASCADE,endpoint TEXT NOT NULL,
    subscription JSONB NOT NULL,active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(room_id,endpoint))`);
  await q(`CREATE TABLE IF NOT EXISTS notification_events (
    id BIGSERIAL PRIMARY KEY,room_id BIGINT REFERENCES rooms(id) ON DELETE CASCADE,
    member_id BIGINT REFERENCES room_members(id) ON DELETE CASCADE,event_key TEXT NOT NULL,
    title TEXT NOT NULL,body TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),read_at TIMESTAMPTZ,
    UNIQUE(room_id,member_id,event_key))`);
  // Upgrade the down-entry kind constraint for Brush support only when needed.
  try{await q(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='down_entries_entry_kind_check' AND pg_get_constraintdef(oid) NOT ILIKE '%brush%') THEN ALTER TABLE down_entries DROP CONSTRAINT down_entries_entry_kind_check; ALTER TABLE down_entries ADD CONSTRAINT down_entries_entry_kind_check CHECK (entry_kind IN ('table','break','setup','brush')); END IF; END $$;`)}catch(e){console.warn('Down kind constraint upgrade skipped',e.message)}
  await q(notificationMigration);
  await q(operationsMigration);
  await q(chatMigration);
}
async function ownersForOrg(orgId){
  const {rows}=await q(`SELECT id,name,active,created_at AS "createdAt",updated_at AS "updatedAt" FROM organization_owners WHERE organization_id=$1 ORDER BY lower(name)`,[orgId]);
  return rows.map(x=>({...x,createdAt:ms(x.createdAt),updatedAt:ms(x.updatedAt)}));
}

const demoEnabled=()=>process.env.POKEREX_ENABLE_DEMO==='true'&&process.env.VERCEL_ENV!=='production'&&process.env.NODE_ENV!=='production';
const unsafeOwner=o=>!demoEnabled()&&o&&verifyPin('5555',o.owner_pin_salt||o.pin_salt,o.owner_pin_hash||o.pin_hash);
async function ensureDemo(){
  if(!demoEnabled())throw Object.assign(new Error('Demo provisioning is disabled.'),{status:403});
  let {rows:[org]}=await q('SELECT * FROM organizations WHERE code=$1',['DEMO']);
  if(!org){const hp=hashPin('5555');({rows:[org]}=await q(`INSERT INTO organizations(code,name,plan,owner_name,owner_pin_hash,owner_pin_salt) VALUES($1,$2,'trial','Owner',$3,$4) RETURNING *`,['DEMO','Poker Executives Demo Organization',hp.hash,hp.salt]));}
  let {rows:[room]}=await q('SELECT *,event_start_date::text AS event_start_date,event_end_date::text AS event_end_date FROM rooms WHERE code=$1',['4271']);
  if(!room){({rows:[room]}=await q(`INSERT INTO rooms(organization_id,code,room_name,shift_name,eo_method,event_name) VALUES($1,'4271','Poker Executives Poker Room','WSOP Circuit','choctaw_prior_hours','Poker Executives Event') RETURNING *`,[org.id]));}
  const defaults=[['George','1111',true,'2468'],['Larry','2222',false,null],['Sarah','3333',false,null],['Mike','4444',false,null]];
  for(const [name,pin,isMgr,mgrPin] of defaults){let {rows}=await q('SELECT id FROM room_members WHERE room_id=$1 AND lower(name)=lower($2)',[room.id,name]);if(!rows.length){const hp=hashPin(pin),mh=mgrPin?hashPin(mgrPin):null;await q(`INSERT INTO room_members(room_id,name,pin_hash,pin_salt,manager_pin_hash,manager_pin_salt,active,is_manager) VALUES($1,$2,$3,$4,$5,$6,true,$7)`,[room.id,name,hp.hash,hp.salt,mh?.hash||null,mh?.salt||null,isMgr]);}}
  return {org,room};
}
async function getRoomByCode(code){const {rows:[r]}=await q('SELECT *,event_start_date::text AS event_start_date,event_end_date::text AS event_end_date FROM rooms WHERE code=$1 AND archived_at IS NULL',[code]);return r}
async function member(roomId,name){const {rows:[m]}=await q('SELECT * FROM room_members WHERE room_id=$1 AND lower(name)=lower($2) AND active=true',[roomId,name]);return m}
async function saveManager(db,roomId,name,pin){
  const managerName=clean(name,80),managerPin=digits(pin);
  if(!managerName)throw Object.assign(new Error('Manager name is required'),{status:400});
  if(managerPin.length<4)throw Object.assign(new Error('Manager PIN must be at least 4 digits'),{status:400});
  const {rows:[existing]}=await db.query(`SELECT id FROM room_members WHERE room_id=$1 AND lower(name)=lower($2) LIMIT 1`,[roomId,managerName]);
  // A manager reset is intentionally one credential. Keep dealer + manager PIN fields
  // synchronized so the same PIN works regardless of which staff login path is used.
  const hp=hashPin(managerPin);
  let saved;
  if(existing){
    const {rows:[row]}=await db.query(`UPDATE room_members SET name=$1,active=true,is_manager=true,pin_hash=$2,pin_salt=$3,manager_pin_hash=$2,manager_pin_salt=$3,updated_at=now() WHERE id=$4 RETURNING id,pin_hash,pin_salt,manager_pin_hash,manager_pin_salt`,[managerName,hp.hash,hp.salt,existing.id]);
    saved={...row,created:false};
  }else{
    const {rows:[row]}=await db.query(`INSERT INTO room_members(room_id,name,pin_hash,pin_salt,manager_pin_hash,manager_pin_salt,active,is_manager) VALUES($1,$2,$3,$4,$3,$4,true,true) RETURNING id,pin_hash,pin_salt,manager_pin_hash,manager_pin_salt`,[roomId,managerName,hp.hash,hp.salt]);
    saved={...row,created:true};
  }
  if(!verifyPin(managerPin,saved.manager_pin_salt,saved.manager_pin_hash)||!verifyPin(managerPin,saved.pin_salt,saved.pin_hash)){
    throw Object.assign(new Error('Manager PIN verification failed after save'),{status:500});
  }
  return {id:saved.id,created:saved.created};
}
async function roomSession(roomId,t){if(!t)return null;const h=tokenHash(t);const {rows:[m]}=await q(`SELECT s.*,m.name,m.is_manager,m.active FROM sessions s JOIN room_members m ON m.id=s.member_id WHERE s.room_id=$1 AND s.token_hash=$2 AND s.expires_at>now() AND m.active=true`,[roomId,h]);if(m&&m.role==='manager'&&!m.is_manager)return null;if(m)return {...m,manager:m.role==='manager'&&!!m.is_manager};const {rows:[o]}=await q(`SELECT s.*,o.name,o.pin_hash AS owner_pin_hash,o.pin_salt AS owner_pin_salt FROM sessions s JOIN organization_owners o ON o.id=s.owner_id AND o.organization_id=s.organization_id AND o.active=true JOIN rooms r ON r.organization_id=s.organization_id WHERE r.id=$1 AND s.role='owner' AND s.token_hash=$2 AND s.expires_at>now()`,[roomId,h]);return o&&!unsafeOwner(o)?{...o,manager:true,owner:true}:null}
async function ownerSession(orgId,t){if(!t)return null;const {rows:[s]}=await q(`SELECT s.*,o.pin_hash AS owner_pin_hash,o.pin_salt AS owner_pin_salt FROM sessions s JOIN organization_owners o ON o.id=s.owner_id AND o.organization_id=s.organization_id AND o.active=true WHERE s.organization_id=$1 AND s.role='owner' AND s.token_hash=$2 AND s.expires_at>now()`,[orgId,tokenHash(t)]);return unsafeOwner(s)?null:s}
async function log(roomId,text,actor='System'){await q(`INSERT INTO audit_logs(id,room_id,actor,event_text) VALUES($1,$2,$3,$4)`,[id('log'),roomId,actor,text])}
function requireManager(ss,res){if(!ss?.manager||!['manager','owner'].includes(ss.role)){res.status(403).json({error:'Manager required'});return false}return true}
function roomResources(room){let r=room.resource_config||{};if(typeof r==='string'){try{r=JSON.parse(r)}catch{r={}}}return {tables:Array.isArray(r.tables)?r.tables:[],breaks:Array.isArray(r.breaks)&&r.breaks.length?r.breaks:['Break'],brushes:Array.isArray(r.brushes)&&r.brushes.length?r.brushes:['Brush'],setup:Array.isArray(r.setup)&&r.setup.length?r.setup:['Setup']}}
function metersBetween(a,b,c,d){const R=6371000,toRad=x=>x*Math.PI/180,p1=toRad(a),p2=toRad(c),dp=toRad(c-a),dl=toRad(d-b),h=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;return 2*R*Math.asin(Math.sqrt(h))}
const notifications=createNotifications({q,tx,webpush});
function pushConfigured(){return notifications.configured()}
async function memberByName(roomId,name){const {rows:[m]}=await q('SELECT * FROM room_members WHERE room_id=$1 AND lower(name)=lower($2) LIMIT 1',[roomId,name]);return m}
const notifyMember=notifications.notifyMember;
async function notifyManagers(roomId,eventKey,title,body){const {rows}=await q(`SELECT name FROM room_members WHERE room_id=$1 AND active=true AND is_manager=true`,[roomId]);for(const r of rows)await notifyMember(roomId,r.name,eventKey+':'+r.name.toLowerCase(),title,body)}
async function notifyAllDealers(roomId,eventKey,title,body,exclude=''){const {rows}=await q(`SELECT name FROM room_members WHERE room_id=$1 AND active=true`,[roomId]);for(const r of rows)if(String(r.name).toLowerCase()!==String(exclude).toLowerCase())await notifyMember(roomId,r.name,eventKey+':'+r.name.toLowerCase(),title,body)}
async function maybeShiftReminder(room){await notifications.reminders(room.id);await notifications.drainSafely(room.id,10)}

async function roomPublic(room,viewer='',viewerRole='guest'){
  const [members,eo,joins,shifts,reqs,times,att,audit,downs,downCounts,priorHoursRows]=await Promise.all([
    q('SELECT name,dealer_number AS "dealerNumber",active,is_manager AS manager FROM room_members WHERE room_id=$1 ORDER BY lower(name)',[room.id]),
    q(`SELECT id,name,status,requested_at,approved_at,approved_by,queue_order FROM eo_requests WHERE room_id=$1`,[room.id]),
    q(`SELECT id,name,status,requested_at FROM join_requests WHERE room_id=$1 AND status='pending' ORDER BY requested_at`,[room.id]),
    q(`SELECT id,shift_date::text AS date,start_time AS start,end_time AS end,dealer_name AS dealer,status,created_at,shift_label AS "shiftLabel" FROM shifts WHERE room_id=$1 ORDER BY shift_date,start_time`,[room.id]),
    q(`SELECT id,shift_id AS "shiftId",request_type AS type,requester,acceptor,status,created_at,approved_at,approved_by,denied_at FROM shift_requests WHERE room_id=$1 ORDER BY created_at`,[room.id]),
    q(`SELECT id,name,clock_in AS "clockIn",clock_out AS "clockOut" FROM time_entries WHERE room_id=$1 ORDER BY clock_in`,[room.id]),
    q(`SELECT shift_id AS "shiftId",name,status,at,marked_by AS by FROM attendance WHERE room_id=$1 ORDER BY at`,[room.id]),
    q(`SELECT id,event_text AS text,actor,created_at AS at FROM audit_logs WHERE room_id=$1 ORDER BY created_at DESC LIMIT 100`,[room.id]),
    viewer?q(`SELECT id,card_upload_id AS "uploadId",series_name AS "seriesName",work_date::text AS date,shift_start AS "shiftStart",table_label AS "table",entry_kind AS kind,down_start AS start,down_end AS "end",ends_next_day AS "endNextDay",correction_needed AS correction,created_at AS "createdAt" FROM down_entries WHERE room_id=$1 AND lower(dealer_name)=lower($2) ORDER BY work_date,down_start`,[room.id,viewer]):Promise.resolve({rows:[]}),
    q(`SELECT lower(dealer_name) AS k,COUNT(*) FILTER(WHERE entry_kind='table' AND work_date=(now() AT TIME ZONE $2)::date)::int AS downs FROM down_entries WHERE room_id=$1 GROUP BY lower(dealer_name)`,[room.id,room.timezone||'America/Chicago']),
    q(`SELECT lower(name) AS k,COALESCE(SUM(EXTRACT(EPOCH FROM (clock_out-clock_in))/3600.0),0)::float8 AS hours
       FROM time_entries
       WHERE room_id=$1 AND clock_out IS NOT NULL AND (clock_in AT TIME ZONE $2)::date < (now() AT TIME ZONE $2)::date
       GROUP BY lower(name)`,[room.id,room.timezone||'America/Chicago'])
  ]);
  const schedToday=shifts.rows.filter(x=>x.date===roomDay(room)&&x.dealer&&x.status!=='cancelled');
  const starts={};for(const sh of schedToday){const k=String(sh.dealer).toLowerCase();if(!starts[k]||sh.start<starts[k])starts[k]=sh.start}
  const dc=Object.fromEntries(downCounts.rows.map(x=>[x.k,+x.downs||0]));const priorHours=Object.fromEntries(priorHoursRows.rows.map(x=>[x.k,+x.hours||0]));
  const bounds=roomDayBounds(room),workedHours={};for(const e of times.rows){const k=String(e.name).toLowerCase(),from=Math.max(ms(e.clockIn),bounds.start),to=Math.min(e.clockOut?ms(e.clockOut):Date.now(),bounds.end);workedHours[k]=(workedHours[k]||0)+Math.max(0,to-from)/36e5;}
  const metricHours=name=>workedHours[String(name).toLowerCase()]||0;
  const management=viewerRole==='manager'||viewerRole==='owner';
  const visibleTimes=management?times.rows:times.rows.filter(x=>viewer&&String(x.name).toLowerCase()===String(viewer).toLowerCase());
  const visibleAttendance=management?att.rows:[];
  const visibleActivity=management?audit.rows:[];
  const method=room.eo_method||'shift_start',tie=room.eo_tiebreaker||'signup',minH=+room.eo_min_hours||0,minD=+room.eo_min_downs||0;
  const waiting=eo.rows.filter(x=>x.status==='waiting').map(x=>({id:x.id,name:x.name,requestedAt:ms(x.requested_at),status:x.status,manualOrder:+x.queue_order||0,shiftStart:starts[String(x.name).toLowerCase()]||null,hours:+metricHours(x.name).toFixed(2),downs:dc[String(x.name).toLowerCase()]||0,priorHours:+(priorHours[String(x.name).toLowerCase()]||0).toFixed(2)}));
  const cmpTie=(a,b)=>tie==='shift_start'?(a.shiftStart||'99:99').localeCompare(b.shiftStart||'99:99')||a.requestedAt-b.requestedAt:tie==='manual'?a.manualOrder-b.manualOrder||a.requestedAt-b.requestedAt:a.requestedAt-b.requestedAt;
  waiting.sort((a,b)=>{if(method==='choctaw_prior_hours')return (a.shiftStart||'99:99').localeCompare(b.shiftStart||'99:99')||b.priorHours-a.priorHours||a.requestedAt-b.requestedAt;if(method==='manual')return a.manualOrder-b.manualOrder||a.requestedAt-b.requestedAt;if(method==='signup')return a.requestedAt-b.requestedAt;if(method==='shift_start')return (a.shiftStart||'99:99').localeCompare(b.shiftStart||'99:99')||cmpTie(a,b);if(method==='hours'){const ae=a.hours>=minH,be=b.hours>=minH;if(ae!==be)return ae?-1:1;return b.hours-a.hours||cmpTie(a,b)}if(method==='downs'){const ae=a.downs>=minD,be=b.downs>=minD;if(ae!==be)return ae?-1:1;return b.downs-a.downs||cmpTie(a,b)}return a.requestedAt-b.requestedAt});
  const approved=eo.rows.filter(x=>x.status==='approved').sort((a,b)=>ms(b.approved_at)-ms(a.approved_at)).map(x=>({id:x.id,name:x.name,requestedAt:ms(x.requested_at),approvedAt:ms(x.approved_at),approvedBy:x.approved_by,status:x.status}));
  const publicQueue=management?waiting:waiting.map(({hours,priorHours,downs,...x})=>x);
  let notifications=[];
  if(viewer&&viewerRole!=='owner'){const m=await memberByName(room.id,viewer);if(m){const {rows}=await q(`SELECT id,event_key AS "eventKey",title,body,created_at AS "createdAt",read_at AS "readAt" FROM notification_events WHERE room_id=$1 AND member_id=$2 ORDER BY created_at DESC LIMIT 30`,[room.id,m.id]);notifications=rows.map(x=>({...x,createdAt:ms(x.createdAt),readAt:ms(x.readAt)}))}}
  return {code:room.code,roomName:room.room_name,shiftName:room.shift_name,roster:members.rows,queue:publicQueue,approved,joinRequests:joins.rows.map(x=>({...x,requestedAt:ms(x.requested_at)})),schedule:shifts.rows.map(x=>({...x,createdAt:ms(x.created_at)})),swapRequests:reqs.rows.map(x=>({...x,createdAt:ms(x.created_at),approvedAt:ms(x.approved_at),deniedAt:ms(x.denied_at)})),settings:{requirePickupApproval:room.require_pickup_approval,requireSwapApproval:room.require_swap_approval,eoMethod:method,eoTiebreaker:tie,eoMinHours:minH,eoMinDowns:minD,eventName:room.event_name||'',eventStart:dateOnly(room.event_start_date),eventEnd:dateOnly(room.event_end_date),timezone:room.timezone||'America/Chicago',geofenceEnabled:!!room.geofence_enabled,geofenceLat:room.geofence_lat,geofenceLng:room.geofence_lng,geofenceRadiusM:+room.geofence_radius_m||250,resources:roomResources(room),notificationsEnabled:room.notifications_enabled!==false,pushConfigured:pushConfigured()},dailyHours:Object.fromEntries(Object.entries(workedHours).filter(([name])=>management||name===String(viewer).toLowerCase())),timeEntries:visibleTimes.map(x=>({...x,clockIn:ms(x.clockIn),clockOut:ms(x.clockOut)})),attendance:visibleAttendance.map(x=>({...x,at:ms(x.at)})),activity:visibleActivity.map(x=>({...x,at:ms(x.at)})),myDowns:downs.rows.map(x=>({...x,createdAt:ms(x.createdAt)})),notifications,updatedAt:ms(room.updated_at)};
}
function orgPublic(org,rooms){return {code:org.code,name:org.name,plan:org.plan,owner:{name:org.owner_name},rooms:rooms.map(r=>({code:r.code,name:r.room_name,archived:!!r.archived_at,archivedAt:ms(r.archived_at)})),createdAt:ms(org.created_at),updatedAt:ms(org.updated_at)}}

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  try{
    if(!process.env.DATABASE_URL)return res.status(500).json({error:'Database not configured'});
    const workerAction=req.query?.action==='notificationWorker'||req.body?.action==='notificationWorker';
    if(workerAction&&!cronAuthorized(req.headers?.authorization,process.env.CRON_SECRET))return res.status(401).json({error:'Unauthorized'});
    if(workerAction&&req.method!=='GET')return res.status(405).json({error:'GET required'});
    await ensureChoctawSchema();
    if(workerAction)return res.json({ok:true,...await notifications.worker()});
    const b=req.body||{},action=b.action||req.query.action||'';
    if(req.method==='GET'&&action==='bootstrap'){
      const code=clean(req.query.room,20)||'4271';const room=await getRoomByCode(code);if(!room)return res.status(404).json({error:'Room not found'});return res.json({room:await roomPublic(room)});
    }
    if(action==='ownerLogin'){
      const orgCode=clean(b.orgCode,20).toUpperCase(),pin=digits(b.pin);let {rows:[org]}=await q('SELECT * FROM organizations WHERE code=$1',[orgCode]);if(!org&&orgCode==='DEMO'&&demoEnabled()){await ensureDemo();({rows:[org]}=await q('SELECT * FROM organizations WHERE code=$1',[orgCode]));}
      if(!org)return res.status(401).json({error:'Invalid owner login'});
      const {rows:allOwnerRows}=await q(`SELECT * FROM organization_owners WHERE organization_id=$1`,[org.id]);
      if(!demoEnabled()&&pin==='5555')return res.status(403).json({error:'The published demo owner PIN is disabled. An administrator must configure a private owner PIN.'});
      let matchedOwner=allOwnerRows.find(o=>o.active&&verifyPin(pin,o.pin_salt,o.pin_hash));
      const legacyGood=!allOwnerRows.length&&verifyPin(pin,org.owner_pin_salt,org.owner_pin_hash);
      if(!legacyGood&&!matchedOwner)return res.status(401).json({error:'Invalid owner login'});
      if(!matchedOwner){const hp=hashPin(pin);({rows:[matchedOwner]}=await q('INSERT INTO organization_owners(organization_id,name,pin_hash,pin_salt,active) VALUES($1,$2,$3,$4,true) RETURNING *',[org.id,org.owner_name,hp.hash,hp.salt]));}
      const t=token();await q(`INSERT INTO sessions(organization_id,owner_id,role,token_hash,expires_at) VALUES($1,$2,'owner',$3,now()+interval '7 days')`,[org.id,matchedOwner.id,tokenHash(t)]);const {rows}=await q('SELECT *,event_start_date::text AS event_start_date,event_end_date::text AS event_end_date FROM rooms WHERE organization_id=$1 ORDER BY archived_at NULLS FIRST,created_at',[org.id]);return res.json({token:t,ownerName:matchedOwner?.name||org.owner_name,org:orgPublic(org,rows),owners:await ownersForOrg(org.id)});
    }
    if(action==='ownerBootstrap'){
      const orgCode=clean(req.query.orgCode||b.orgCode,20).toUpperCase();const {rows:[org]}=await q('SELECT * FROM organizations WHERE code=$1',[orgCode]);if(!org)return res.status(404).json({error:'Organization not found'});if(!await ownerSession(org.id,req.query.token||b.token))return res.status(401).json({error:'Owner session expired'});const {rows}=await q('SELECT *,event_start_date::text AS event_start_date,event_end_date::text AS event_end_date FROM rooms WHERE organization_id=$1 ORDER BY archived_at NULLS FIRST,created_at',[org.id]);return res.json({org:orgPublic(org,rows),owners:await ownersForOrg(org.id)});
    }
    if(action==='createOwner'||action==='resetOwnerPin'||action==='setOwnerActive'){
      const orgCode=clean(b.orgCode,20).toUpperCase();
      const {rows:[org]}=await q('SELECT * FROM organizations WHERE code=$1',[orgCode]);
      if(!org||!await ownerSession(org.id,b.token))return res.status(401).json({error:'Owner session expired'});
      if(['createOwner','resetOwnerPin'].includes(action)&&!demoEnabled()&&digits(b.pin)==='5555')return res.status(400).json({error:'Choose a private owner PIN; the published demo PIN is disabled.'});
      if(action==='createOwner'){
        const name=clean(b.name,80),pin=digits(b.pin);
        if(!name||pin.length<4)return res.status(400).json({error:'Owner name and 4+ digit PIN required'});
        const hp=hashPin(pin);
        try{await q(`INSERT INTO organization_owners(organization_id,name,pin_hash,pin_salt,active) VALUES($1,$2,$3,$4,true)`,[org.id,name,hp.hash,hp.salt])}
        catch(e){if(e.code==='23505')return res.status(400).json({error:'Owner name already exists'});throw e}
      }else if(action==='resetOwnerPin'){
        const ownerId=Number(b.ownerId),pin=digits(b.pin);if(!ownerId||pin.length<4)return res.status(400).json({error:'Owner and 4+ digit PIN required'});const hp=hashPin(pin);
        const {rowCount}=await q(`UPDATE organization_owners SET pin_hash=$1,pin_salt=$2,updated_at=now() WHERE id=$3 AND organization_id=$4`,[hp.hash,hp.salt,ownerId,org.id]);if(!rowCount)return res.status(404).json({error:'Owner not found'});await q('DELETE FROM sessions WHERE owner_id=$1',[ownerId]);
      }else{
        const ownerId=Number(b.ownerId),active=!!b.active;if(!ownerId)return res.status(400).json({error:'Owner required'});
        await tx(async db=>{
          await db.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[org.id]);
          const {rows:[target]}=await db.query('SELECT active FROM organization_owners WHERE id=$1 AND organization_id=$2',[ownerId,org.id]);
          if(!target)throw Object.assign(new Error('Owner not found'),{status:404});
          if(!active&&target.active){const {rows:[c]}=await db.query('SELECT COUNT(*)::int AS n FROM organization_owners WHERE organization_id=$1 AND active=true',[org.id]);if(c.n<=1)throw Object.assign(new Error('At least one active owner must remain'),{status:400});}
          await db.query('UPDATE organization_owners SET active=$1,updated_at=now() WHERE id=$2 AND organization_id=$3',[active,ownerId,org.id]);
          if(!active)await db.query('DELETE FROM sessions WHERE owner_id=$1',[ownerId]);
        });
      }
      const {rows}=await q('SELECT *,event_start_date::text AS event_start_date,event_end_date::text AS event_end_date FROM rooms WHERE organization_id=$1 ORDER BY archived_at NULLS FIRST,created_at',[org.id]);return res.json({ok:true,org:orgPublic(org,rows),owners:await ownersForOrg(org.id)});
    }
    if(action==='createRoom'){
      const orgCode=clean(b.orgCode,20).toUpperCase(),code=digits(b.roomCode).slice(0,8),name=clean(b.roomName)||'New Room';
      const managerName=clean(b.managerName,80),managerPin=digits(b.managerPin);
      const {rows:[org]}=await q('SELECT * FROM organizations WHERE code=$1',[orgCode]);
      if(!org||!await ownerSession(org.id,b.token))return res.status(401).json({error:'Owner session expired'});
      if(code.length<4)return res.status(400).json({error:'Room code must be at least 4 digits'});
      if(!managerName)return res.status(400).json({error:'First manager name is required'});
      if(managerPin.length<4)return res.status(400).json({error:'Manager PIN must be at least 4 digits'});
      let newRoomId=null;
      try{
        await tx(async c=>{
          const {rows:[nr]}=await c.query(`INSERT INTO rooms(organization_id,code,room_name,shift_name) VALUES($1,$2,$3,'WSOP Circuit') RETURNING *`,[org.id,code,name]);
          newRoomId=nr.id;
          await saveManager(c,nr.id,managerName,managerPin);
          const {rows:[check]}=await c.query(`SELECT id,is_manager,active,manager_pin_hash,manager_pin_salt FROM room_members WHERE room_id=$1 AND lower(name)=lower($2) LIMIT 1`,[nr.id,managerName]);
          if(!check||!check.is_manager||!check.active||!check.manager_pin_hash||!check.manager_pin_salt)throw new Error('Manager verification failed');
        });
      }catch(e){
        if(e.status)return res.status(e.status).json({error:e.message});
        if(e.code==='23505')return res.status(400).json({error:'Room code already exists'});
        throw e;
      }
      const {rows:[room]}=await q('SELECT *,event_start_date::text AS event_start_date,event_end_date::text AS event_end_date FROM rooms WHERE id=$1 AND organization_id=$2',[newRoomId,org.id]);
      if(!room)return res.status(500).json({error:'Room save did not verify'});
      const {rows:[managerCheck]}=await q(`SELECT id,name,is_manager,active FROM room_members WHERE room_id=$1 AND lower(name)=lower($2) LIMIT 1`,[room.id,managerName]);
      if(!managerCheck||!managerCheck.is_manager||!managerCheck.active)return res.status(500).json({error:'Room was created, but manager save did not verify'});
      const {rows}=await q('SELECT *,event_start_date::text AS event_start_date,event_end_date::text AS event_end_date FROM rooms WHERE organization_id=$1 ORDER BY archived_at NULLS FIRST,created_at',[org.id]);
      return res.json({org:orgPublic(org,rows),room:await roomPublic(room,org.owner_name,'owner'),roomCode:room.code,managerName:managerCheck.name,managerCreated:true});
    }
    if(action==='upsertRoomManager'){
      const orgCode=clean(b.orgCode,20).toUpperCase(),roomCode=digits(b.roomCode).slice(0,8),managerName=clean(b.managerName,80),managerPin=digits(b.managerPin);
      const {rows:[org]}=await q('SELECT * FROM organizations WHERE code=$1',[orgCode]);
      if(!org||!await ownerSession(org.id,b.token))return res.status(401).json({error:'Owner session expired'});
      if(!managerName||managerPin.length<4)return res.status(400).json({error:'Manager name and 4+ digit PIN required'});
      const {rows:[room]}=await q('SELECT *,event_start_date::text AS event_start_date,event_end_date::text AS event_end_date FROM rooms WHERE organization_id=$1 AND code=$2',[org.id,roomCode]);
      if(!room)return res.status(404).json({error:'Room not found'});
      let saved;
      try{ saved=await saveManager(pool,room.id,managerName,managerPin); }
      catch(e){ if(e.status)return res.status(e.status).json({error:e.message}); throw e; }
      const created=saved.created;
      const {rows:[check]}=await q(`SELECT id,is_manager,active FROM room_members WHERE room_id=$1 AND lower(name)=lower($2) LIMIT 1`,[room.id,managerName]);
      if(!check||!check.is_manager||!check.active)return res.status(500).json({error:'Manager save did not verify'});
      const {rows}=await q('SELECT *,event_start_date::text AS event_start_date,event_end_date::text AS event_end_date FROM rooms WHERE organization_id=$1 ORDER BY archived_at NULLS FIRST,created_at',[org.id]);
      return res.json({ok:true,created,managerName,org:orgPublic(org,rows)});
    }
    if(action==='archiveRoom'||action==='restoreRoom'||action==='deleteRoom'){
      const orgCode=clean(b.orgCode,20).toUpperCase(),roomCode=digits(b.roomCode).slice(0,8);
      const {rows:[org]}=await q('SELECT * FROM organizations WHERE code=$1',[orgCode]);
      if(!org||!await ownerSession(org.id,b.token))return res.status(401).json({error:'Owner session expired'});
      const {rows:[ownedRoom]}=await q('SELECT *,event_start_date::text AS event_start_date,event_end_date::text AS event_end_date FROM rooms WHERE organization_id=$1 AND code=$2',[org.id,roomCode]);
      if(!ownedRoom)return res.status(404).json({error:'Room not found'});
      if(action==='archiveRoom'){
        await q('UPDATE rooms SET archived_at=now(),updated_at=now() WHERE id=$1',[ownedRoom.id]);
      }else if(action==='restoreRoom'){
        await q('UPDATE rooms SET archived_at=NULL,updated_at=now() WHERE id=$1',[ownedRoom.id]);
      }else{
        await q('DELETE FROM rooms WHERE id=$1 AND organization_id=$2',[ownedRoom.id,org.id]);
      }
      const {rows}=await q('SELECT *,event_start_date::text AS event_start_date,event_end_date::text AS event_end_date FROM rooms WHERE organization_id=$1 ORDER BY archived_at NULLS FIRST,created_at',[org.id]);
      return res.json({ok:true,org:orgPublic(org,rows)});
    }
    if(action==='roomLogin'){
      const code=clean(b.room,20),name=clean(b.name),role=b.role==='manager'?'manager':'dealer',pin=digits(b.pin);const room=await getRoomByCode(code);if(!room)return res.status(401).json({error:'Invalid login'});const m=await member(room.id,name);if(!m)return res.status(401).json({error:'Invalid login'});let good=false;if(role==='manager'){if(m.is_manager){good=verifyPin(pin,m.manager_pin_salt,m.manager_pin_hash);if(!good){const legacyGood=verifyPin(pin,m.pin_salt,m.pin_hash);if(legacyGood){good=true;const hp=hashPin(pin);await q(`UPDATE room_members SET manager_pin_hash=$1,manager_pin_salt=$2,updated_at=now() WHERE id=$3`,[hp.hash,hp.salt,m.id]);}}}}else good=verifyPin(pin,m.pin_salt,m.pin_hash);if(!good)return res.status(401).json({error:'Invalid login'});const t=token();await q(`INSERT INTO sessions(room_id,member_id,role,token_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '7 days')`,[room.id,m.id,role,tokenHash(t)]);return res.json({token:t,session:{name:m.name,role,room:room.code},requiresPinChange:role==='dealer'&&!!m.must_change_pin,room:await roomPublic(room,m.name,role)});
    }
    if(action==='changeInitialPin'){
      const code=clean(b.room,20),newPin=digits(b.newPin);if(newPin.length<4||newPin.length>6)return res.status(400).json({error:'PIN must be 4–6 digits'});const room=await getRoomByCode(code);if(!room)return res.status(404).json({error:'Room not found'});const ss=await roomSession(room.id,b.token);if(!ss||ss.role!=='dealer')return res.status(401).json({error:'Dealer session expired'});const {rows:[m]}=await q(`SELECT * FROM room_members WHERE id=$1 AND room_id=$2`,[ss.member_id,room.id]);if(!m)return res.status(404).json({error:'Dealer not found'});if(!m.must_change_pin)return res.status(400).json({error:'PIN has already been changed'});const hp=hashPin(newPin);await q(`UPDATE room_members SET pin_hash=$1,pin_salt=$2,must_change_pin=false,updated_at=now() WHERE id=$3`,[hp.hash,hp.salt,m.id]);await log(room.id,`${m.name} created a personal PIN`,m.name);return res.json({ok:true,room:await roomPublic(room,m.name,'dealer')});
    }
    if(action==='requestJoin'){
      const code=clean(b.room,20),name=clean(b.name),pin=digits(b.pin);if(!name||pin.length<4)return res.status(400).json({error:'Name and 4+ digit PIN required'});const room=await getRoomByCode(code);if(!room)return res.status(404).json({error:'Room not found'});const ex=await q(`SELECT 1 FROM room_members WHERE room_id=$1 AND lower(name)=lower($2) UNION ALL SELECT 1 FROM join_requests WHERE room_id=$1 AND lower(name)=lower($2) AND status='pending' LIMIT 1`,[room.id,name]);if(ex.rows.length)return res.status(400).json({error:'Name already exists or is pending'});const hp=hashPin(pin);await q(`INSERT INTO join_requests(id,room_id,name,pin_hash,pin_salt) VALUES($1,$2,$3,$4,$5)`,[id('join'),room.id,name,hp.hash,hp.salt]);await log(room.id,`${name} requested to join`,name);return res.json({ok:true});
    }
    const code=clean(b.room||req.query.room,20);if(!code)return res.status(400).json({error:'Room required'});const room=await getRoomByCode(code);if(!room)return res.status(404).json({error:'Room not found'});const ss=await roomSession(room.id,b.token||req.query.token);if(!ss)return res.status(401).json({error:'Session expired'});const actor=ss.name;
    if(await handleChat({action,b,room,ss,q,tx,res}))return;
    if(await notifications.handle({action,b,room,ss,res}))return;
    if(await handleDownCards({action,b,room,ss,q,tx,res}))return;
    if(action==='state'){await maybeShiftReminder(room,ss);return res.json({session:{name:actor,role:ss.role,room:code,manager:ss.manager},room:await roomPublic(room,actor,ss.role)})};
    if(action==='markNotificationsRead'){if(ss.member_id)await q(`UPDATE notification_events SET read_at=COALESCE(read_at,now()) WHERE room_id=$1 AND member_id=$2`,[room.id,ss.member_id]);return res.json({ok:true})};
    if(action==='analyzeScheduleImage'){
      if(!requireManager(ss,res))return;
      if(!process.env.OPENAI_API_KEY)return res.status(503).json({error:'AI schedule import is not configured yet. Add OPENAI_API_KEY in Vercel Environment Variables.'});
      const imageData=String(b.imageData||'');
      if(!/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(imageData))return res.status(400).json({error:'Please upload a PNG, JPG, or WebP schedule image'});
      const prompt=`Read this poker dealer work schedule. Extract every visible scheduled assignment. Return dates as YYYY-MM-DD when determinable, start/end times as 24-hour HH:MM, and dealer numbers as exactly the visible digits (usually 3 digits). If a field is unreadable, use an empty string and set confidence to low. Do not invent values. End time may be blank. Notes should briefly explain uncertainty. Current event context: ${room.event_name||room.room_name||'PokerEx event'} ${room.event_start_date?`from ${String(room.event_start_date).slice(0,10)}`:''} ${room.event_end_date?`to ${String(room.event_end_date).slice(0,10)}`:''}.`;
      const rr=await fetch('https://api.openai.com/v1/responses',{method:'POST',signal:AbortSignal.timeout(90000),headers:{'Authorization':`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:process.env.OPENAI_SCHEDULE_MODEL||'gpt-4.1-mini',input:[{role:'user',content:[{type:'input_text',text:prompt},{type:'input_image',image_url:imageData,detail:'high'}]}],text:{format:{type:'json_schema',name:'dealerflow_schedule',strict:true,schema:{type:'object',additionalProperties:false,properties:{rows:{type:'array',items:{type:'object',additionalProperties:false,properties:{dealer:{type:'string'},dealerNumber:{type:'string'},date:{type:'string'},start:{type:'string'},end:{type:'string'},confidence:{type:'string',enum:['high','medium','low']},notes:{type:'string'}},required:['dealer','dealerNumber','date','start','end','confidence','notes']}}},required:['rows']}}}})});
      const data=await rr.json();if(!rr.ok)throw photoServiceError(rr.status,data);
      const txt=data.output_text||data.output?.flatMap(x=>x.content||[]).find(x=>x.type==='output_text')?.text||'';
      let parsed;try{parsed=JSON.parse(txt)}catch{return res.status(502).json({error:'AI returned an unreadable schedule response'})}
      const rosterNames=new Set((await q(`SELECT lower(name) AS n FROM room_members WHERE room_id=$1`,[room.id])).rows.map(x=>x.n));
      const rows=(parsed.rows||[]).map(x=>({dealer:clean(x.dealer,80),dealerNumber:digits(x.dealerNumber).slice(-3),date:clean(x.date,10),start:clean(x.start,5),end:clean(x.end,5),shift:'',confidence:['high','medium','low'].includes(x.confidence)?x.confidence:'low',notes:clean(x.notes,180),existingDealer:rosterNames.has(String(x.dealer||'').trim().toLowerCase())}));
      return res.json({rows});
    }

    const operation=await handleOperations({action,b,room,ss,q,tx,res,hashPin,notifyMember,notifyManagers,notifyAllDealers,metersBetween});
    if(operation){const {rows:[fresh]}=await q('SELECT *,event_start_date::text AS event_start_date,event_end_date::text AS event_end_date FROM rooms WHERE id=$1',[room.id]);return res.json({...operation.extra,room:await roomPublic(fresh,actor,ss.role)});}
    if(action==='setEvent'){

      if(!requireManager(ss,res))return;
      const eventName=clean(b.eventName,120)||'Poker Executives Event',roomName=clean(b.roomName,120)||room.room_name;
      const start=/^\d{4}-\d{2}-\d{2}$/.test(clean(b.eventStart,10))?clean(b.eventStart,10):null;
      const end=/^\d{4}-\d{2}-\d{2}$/.test(clean(b.eventEnd,10))?clean(b.eventEnd,10):null;
      await q(`UPDATE rooms SET event_name=$1,event_start_date=$2,event_end_date=$3,room_name=$4,eo_method='choctaw_prior_hours',eo_tiebreaker='signup',updated_at=now() WHERE id=$5`,[eventName,start,end,roomName,room.id]);
      await log(room.id,`Pilot event configured: ${eventName}`,actor);
    } else if(action==='importRosterSchedule'){
      if(!requireManager(ss,res))return;
      const rows=Array.isArray(b.rows)?b.rows.slice(0,2500):[];
      if(!rows.length)return res.status(400).json({error:'No import rows supplied'});
      let dealersAdded=0,dealersUpdated=0,shiftsAdded=0,skipped=0,tempPins=[];
      for(const r of rows){
        const dealer=clean(r.dealer||r.name,80),raw=digits(r.dealerNumber).slice(-3),num=raw?raw.padStart(3,'0'):'',explicitPin=digits(r.pin).slice(0,6);
        const date=clean(r.date,10),start=clean(r.start,5),end=clean(r.end,5),label=clean(r.shift||r.shiftLabel,40);
        if(!dealer){skipped++;continue}
        let mem=null;
        const {rows:[byName]}=await q(`SELECT * FROM room_members WHERE room_id=$1 AND lower(name)=lower($2) LIMIT 1`,[room.id,dealer]);
        if(byName)mem=byName;
        if(!mem&&num){const {rows:[byNum]}=await q(`SELECT * FROM room_members WHERE room_id=$1 AND dealer_number=$2 LIMIT 1`,[room.id,num]);if(byNum)mem=byNum}
        const pinToUse=explicitPin.length>=4?explicitPin:(num?'0'+num:'');
        if(!mem){
          if(!pinToUse){skipped++;continue}
          const hp=hashPin(pinToUse);
          const {rows:[created]}=await q(`INSERT INTO room_members(room_id,name,dealer_number,pin_hash,pin_salt,active,is_manager,must_change_pin) VALUES($1,$2,$3,$4,$5,true,false,$6) RETURNING *`,[room.id,dealer,num||null,hp.hash,hp.salt,explicitPin.length>=4?false:true]);
          mem=created;dealersAdded++;if(explicitPin.length<4)tempPins.push({name:dealer,dealerNumber:num,pin:pinToUse});
        }else{
          const sets=[],vals=[];let n=1;
          if(num&&mem.dealer_number!==num){sets.push(`dealer_number=$${n++}`);vals.push(num)}
          if(dealer&&mem.name!==dealer){sets.push(`name=$${n++}`);vals.push(dealer)}
          if(explicitPin.length>=4){const hp=hashPin(explicitPin);sets.push(`pin_hash=$${n++}`,`pin_salt=$${n++}`,`must_change_pin=false`);vals.push(hp.hash,hp.salt)}
          if(mem.active===false)sets.push('active=true');
          if(sets.length){vals.push(mem.id);await q(`UPDATE room_members SET ${sets.join(',')},updated_at=now() WHERE id=$${n}`,vals);dealersUpdated++;const {rows:[fresh]}=await q('SELECT * FROM room_members WHERE id=$1',[mem.id]);mem=fresh}
        }
        const hasSchedule=date||start||end||label;
        if(hasSchedule){
          if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d{1,2}:\d{2}$/.test(start)){skipped++;continue}
          const exists=await q(`SELECT 1 FROM shifts WHERE room_id=$1 AND shift_date=$2 AND lower(COALESCE(dealer_name,''))=lower($3) AND start_time=$4 AND status<>'cancelled' LIMIT 1`,[room.id,date,mem.name,start]);
          if(exists.rows.length){skipped++;continue}
          await q(`INSERT INTO shifts(id,room_id,shift_date,start_time,end_time,dealer_name,status,shift_label) VALUES($1,$2,$3,$4,$5,$6,'assigned',$7)`,[id('sh'),room.id,date,start,end||'',mem.name,label||null]);shiftsAdded++;
        }
      }
      await log(room.id,`Unified import: ${dealersAdded} dealers added, ${dealersUpdated} updated, ${shiftsAdded} shifts, ${skipped} skipped`,actor);
      return res.json({ok:true,dealersAdded,dealersUpdated,shiftsAdded,skipped,tempPins,room:await roomPublic(room,actor,ss.role)});
    } else if(action==='importDealers'){
      if(!requireManager(ss,res))return;const dealers=Array.isArray(b.dealers)?b.dealers.slice(0,500):[];if(!dealers.length)return res.status(400).json({error:'No dealers supplied'});let added=0,skipped=0,generated=[];for(const d of dealers){const n=clean(d.name,80),raw=digits(d.dealerNumber).slice(-3),num=raw.padStart(3,'0');if(!n||!/^\d{3}$/.test(num)){skipped++;continue}const exists=await q(`SELECT 1 FROM room_members WHERE room_id=$1 AND (lower(name)=lower($2) OR dealer_number=$3) LIMIT 1`,[room.id,n,num]);if(exists.rows.length){skipped++;continue}const pin='0'+num,hp=hashPin(pin);await q(`INSERT INTO room_members(room_id,name,dealer_number,pin_hash,pin_salt,active,is_manager,must_change_pin) VALUES($1,$2,$3,$4,$5,true,false,true)`,[room.id,n,num,hp.hash,hp.salt]);generated.push({name:n,dealerNumber:num,pin});added++}await log(room.id,`Pilot dealer import: ${added} added, ${skipped} skipped`,actor);return res.json({ok:true,added,skipped,generated,room:await roomPublic(room,actor,ss.role)});
        } else if(action==='setEOSettings'){
      if(!requireManager(ss,res))return;const method=['choctaw_prior_hours','shift_start','signup','hours','downs','manual'].includes(b.eoMethod)?b.eoMethod:'choctaw_prior_hours';const tie=['signup','shift_start','manual'].includes(b.eoTiebreaker)?b.eoTiebreaker:'signup';const mh=Math.max(0,Math.min(24,+b.eoMinHours||0)),md=Math.max(0,Math.min(100,+b.eoMinDowns||0));await q(`UPDATE rooms SET eo_method=$1,eo_tiebreaker=$2,eo_min_hours=$3,eo_min_downs=$4,updated_at=now() WHERE id=$5`,[method,tie,mh,md,room.id]);await log(room.id,`EO rules updated: ${method}`,actor);
    } else if(action==='importSchedule'){
      if(!requireManager(ss,res))return;const rows=Array.isArray(b.rows)?b.rows.slice(0,1000):[];if(!rows.length)return res.status(400).json({error:'No schedule rows found'});let added=0,skipped=0,dealersCreated=0,tempPins=[];for(const r of rows){const date=clean(r.date,10),dealer=clean(r.dealer,80),start=clean(r.start,5),end=clean(r.end,5),label=clean(r.shift||r.shiftLabel,40),raw=digits(r.dealerNumber).slice(-3),num=raw?raw.padStart(3,'0'):'';if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!dealer||!/^\d{1,2}:\d{2}$/.test(start)){skipped++;continue}let mem=await member(room.id,dealer);if(!mem&&num){const {rows:[byNum]}=await q(`SELECT * FROM room_members WHERE room_id=$1 AND dealer_number=$2 LIMIT 1`,[room.id,num]);if(byNum)mem=byNum}if(!mem&&num){const tp='0'+num,hp=hashPin(tp);const {rows:[created]}=await q(`INSERT INTO room_members(room_id,name,dealer_number,pin_hash,pin_salt,active,is_manager,must_change_pin) VALUES($1,$2,$3,$4,$5,true,false,true) RETURNING *`,[room.id,dealer,num,hp.hash,hp.salt]);mem=created;dealersCreated++;tempPins.push({name:dealer,dealerNumber:num,pin:tp})}if(!mem){skipped++;continue}const exists=await q(`SELECT 1 FROM shifts WHERE room_id=$1 AND shift_date=$2 AND lower(COALESCE(dealer_name,''))=lower($3) AND start_time=$4 AND status<>'cancelled' LIMIT 1`,[room.id,date,mem.name,start]);if(exists.rows.length){skipped++;continue}await q(`INSERT INTO shifts(id,room_id,shift_date,start_time,end_time,dealer_name,status,shift_label) VALUES($1,$2,$3,$4,$5,$6,'assigned',$7)`,[id('sh'),room.id,date,start,end||'',mem.name,label||null]);added++}await log(room.id,`Schedule import: ${added} shifts, ${dealersCreated} dealers created, ${skipped} skipped`,actor);return res.json({ok:true,added,skipped,dealersCreated,tempPins,room:await roomPublic(room,actor,ss.role)});
        } else if(action==='addDown'){
      if(ss.role!=='dealer')return res.status(403).json({error:'Down tracking is dealer-only'});
      const workDate=/^\d{4}-\d{2}-\d{2}$/.test(clean(b.date,10))?clean(b.date,10):roomDay(room),table=clean(b.table,30),start=clean(b.start,5),requestedEnd=clean(b.end,5);
      if(!/^\d{1,2}:(00|30)$/.test(start)||!table)return res.status(400).json({error:'Table and :00/:30 down start are required'});
      if(requestedEnd&&!timeKey(requestedEnd))return res.status(400).json({error:'Enter a valid down end time.'});
      const series=clean(b.seriesName,100)||clean(room.event_name,100)||clean(room.room_name,100)||'PokerEx Event';
      const {rows:[todayShift]}=await q(`SELECT start_time FROM shifts WHERE room_id=$1 AND lower(dealer_name)=lower($2) AND shift_date=$3 AND status<>'cancelled' ORDER BY start_time LIMIT 1`,[room.id,actor,workDate]);
      const shiftStart=clean(b.shiftStart,5)||todayShift?.start_time||start;
      const [hh,mm]=start.split(':').map(Number),mins=hh*60+mm+30,defaultEnd=`${String(Math.floor((mins%1440)/60)).padStart(2,'0')}:${String(mins%60).padStart(2,'0')}`,end=/^\d{1,2}:\d{2}$/.test(requestedEnd)?requestedEnd:defaultEnd;
      const low=table.toLowerCase(),kind=low.includes('break')?'break':low.includes('setup')?'setup':low.includes('brush')?'brush':'table';
      if(!validDate(workDate)||!timeKey(start)||!timeKey(end))return res.status(400).json({error:'Valid down date and times required'});
      const endNextDay=b.endNextDay===true;
      if((!endNextDay&&timeKey(end)<=timeKey(start))||(endNextDay&&timeKey(end)>=timeKey(start)))return res.status(400).json({error:'End must follow start. For an overnight down, select End is next day and an earlier end time.'});
      const added=await tx(async db=>{const {rows:[m]}=await db.query('SELECT id,name,dealer_number FROM room_members WHERE room_id=$1 AND id=$2',[room.id,ss.member_id]);return insertDown(db,room.id,{event:series,date:workDate,table,time:timeKey(start)},m,null,{kind,shiftStart,end:timeKey(end),endNextDay})});
      if(!added)return res.status(409).json({error:'This down is already recorded.'});
    } else if(action==='toggleDownCorrection'){
      if(ss.role!=='dealer')return res.status(403).json({error:'Down tracking is dealer-only'});await q(`UPDATE down_entries SET correction_needed=NOT correction_needed WHERE id=$1 AND room_id=$2 AND member_id=$3`,[clean(b.id,80),room.id,ss.member_id]);
    } else if(action==='deleteDown'){
      if(ss.role!=='dealer')return res.status(403).json({error:'Down tracking is dealer-only'});await q(`DELETE FROM down_entries WHERE id=$1 AND room_id=$2 AND member_id=$3 AND card_upload_id IS NULL`,[clean(b.id,80),room.id,ss.member_id]);
    } else if(action==='joinEO'){
      const {rows:[ex]}=await q(`SELECT id FROM eo_requests WHERE room_id=$1 AND lower(name)=lower($2) AND status='waiting' LIMIT 1`,[room.id,actor]);if(!ex){const {rows:[mx]}=await q(`SELECT COALESCE(MAX(queue_order),0)+1 AS n FROM eo_requests WHERE room_id=$1 AND status='waiting'`,[room.id]);await q(`INSERT INTO eo_requests(id,room_id,member_id,name,status,queue_order) VALUES($1,$2,$3,$4,'waiting',$5)`,[id('eo'),room.id,ss.member_id,actor,mx.n]);await log(room.id,`${actor} joined the EO list`,actor)}
    } else if(action==='leaveEO'){
      await q(`DELETE FROM eo_requests WHERE room_id=$1 AND lower(name)=lower($2) AND status='waiting'`,[room.id,actor]);await log(room.id,`${actor} left the EO list`,actor);
    } else if(action==='moveEO'){
      if(!requireManager(ss,res))return;if((room.eo_method||'shift_start')!=='manual')return res.status(400).json({error:'Manual move is only available in Manual EO mode'});const a=clean(b.id,80),z=clean(b.swapId,80);const {rows}=await q(`SELECT id,queue_order FROM eo_requests WHERE room_id=$1 AND status='waiting' AND id=ANY($2::text[])`,[room.id,[a,z]]);if(rows.length===2){const x=rows.find(r=>r.id===a),y=rows.find(r=>r.id===z);await tx(async c=>{await c.query('UPDATE eo_requests SET queue_order=$1 WHERE id=$2',[y.queue_order,x.id]);await c.query('UPDATE eo_requests SET queue_order=$1 WHERE id=$2',[x.queue_order,y.id])})}
    } else if(action==='approveEO'){
      if(!requireManager(ss,res))return;const {rows:[r]}=await q(`SELECT * FROM eo_requests WHERE room_id=$1 AND id=$2 AND status='waiting'`,[room.id,clean(b.id,80)]);if(r){await q(`UPDATE eo_requests SET status='approved',approved_at=now(),approved_by=$1 WHERE id=$2`,[actor,r.id]);await log(room.id,`${r.name} was EO'd by ${actor}`,actor);await notifyMember(room.id,r.name,`eo:${r.id}`,'You are out on EO',`You have been released on EO by ${actor}.`)}
    } else if(action==='removeEO'){
      if(!requireManager(ss,res))return;await q(`DELETE FROM eo_requests WHERE room_id=$1 AND id=$2 AND status='waiting'`,[room.id,clean(b.id,80)]);
    } else if(action==='approveJoin'){
      if(!requireManager(ss,res))return;const {rows}=await q(`SELECT * FROM join_requests WHERE room_id=$1 AND status='pending' ORDER BY requested_at`,[room.id]);const r=rows[+b.index];if(r){await tx(async c=>{await c.query(`INSERT INTO room_members(room_id,name,pin_hash,pin_salt,active,is_manager) VALUES($1,$2,$3,$4,true,false)`,[room.id,r.name,r.pin_hash,r.pin_salt]);await c.query(`UPDATE join_requests SET status='approved' WHERE id=$1`,[r.id])});await log(room.id,`${r.name} joined the roster`,actor)}
    } else if(action==='denyJoin'){
      if(!requireManager(ss,res))return;const {rows}=await q(`SELECT * FROM join_requests WHERE room_id=$1 AND status='pending' ORDER BY requested_at`,[room.id]);const r=rows[+b.index];if(r){await q(`UPDATE join_requests SET status='denied' WHERE id=$1`,[r.id]);await log(room.id,`${r.name}'s join request was denied`,actor)}
    } else if(action==='addDealer'){
      if(!requireManager(ss,res))return;const n=clean(b.name),pin=digits(b.pin);if(!n||pin.length<4)return res.status(400).json({error:'Name and 4+ digit PIN required'});const hp=hashPin(pin);try{await q(`INSERT INTO room_members(room_id,name,pin_hash,pin_salt,active,is_manager) VALUES($1,$2,$3,$4,true,false)`,[room.id,n,hp.hash,hp.salt])}catch(e){if(e.code==='23505')return res.status(400).json({error:'Dealer already exists'});throw e}await log(room.id,`${n} added to roster`,actor);
    } else if(action==='setDealer'){
      if(!requireManager(ss,res))return;const m=await member(room.id,b.name);if(!m)return res.status(404).json({error:'Dealer not found'});const sets=[],vals=[];let n=1;if(b.active!==undefined){sets.push(`active=$${n++}`);vals.push(!!b.active)}if(b.manager!==undefined){sets.push(`is_manager=$${n++}`);vals.push(!!b.manager)}if(digits(b.pin).length>=4){const hp=hashPin(digits(b.pin));sets.push(`pin_hash=$${n++}`,`pin_salt=$${n++}`);vals.push(hp.hash,hp.salt)}if(digits(b.managerPin).length>=4){const hp=hashPin(digits(b.managerPin));sets.push(`pin_hash=$${n++}`,`pin_salt=$${n++}`,`manager_pin_hash=$${n++}`,`manager_pin_salt=$${n++}`);vals.push(hp.hash,hp.salt,hp.hash,hp.salt)}if(sets.length){vals.push(m.id);await q(`UPDATE room_members SET ${sets.join(',')},updated_at=now() WHERE id=$${n}` ,vals)}await log(room.id,`${m.name}'s access was updated`,actor);
    } else if(action==='setRoom'){
      if(!requireManager(ss,res))return;await q(`UPDATE rooms SET room_name=$1,shift_name=$2,updated_at=now() WHERE id=$3`,[clean(b.roomName)||room.room_name,clean(b.shiftName)||room.shift_name,room.id]);await log(room.id,'Room settings updated',actor);
    } else if(action==='setWorkflow'){
      if(!requireManager(ss,res))return;await q(`UPDATE rooms SET require_pickup_approval=$1,require_swap_approval=$2,updated_at=now() WHERE id=$3`,[!!b.requirePickupApproval,!!b.requireSwapApproval,room.id]);await log(room.id,'Workflow settings updated',actor);
    } else if(action==='setOperationsConfig'){
      if(!requireManager(ss,res))return;
      const enabled=!!b.geofenceEnabled,lat=Number(b.geofenceLat),lng=Number(b.geofenceLng),radius=Math.max(25,Math.min(5000,Number(b.geofenceRadiusM)||250));
      if(enabled&&(!Number.isFinite(lat)||!Number.isFinite(lng)))return res.status(400).json({error:'Latitude and longitude are required when location clock-in is enabled'});
      const arr=v=>Array.from(new Set((Array.isArray(v)?v:[]).map(x=>clean(x,40)).filter(Boolean))).slice(0,300);
      const resources={tables:arr(b.tables),breaks:arr(b.breaks).length?arr(b.breaks):['Break'],brushes:arr(b.brushes).length?arr(b.brushes):['Brush'],setup:arr(b.setup).length?arr(b.setup):['Setup']};
      await q(`UPDATE rooms SET geofence_enabled=$1,geofence_lat=$2,geofence_lng=$3,geofence_radius_m=$4,resource_config=$5,notifications_enabled=$6,updated_at=now() WHERE id=$7`,[enabled,enabled?lat:null,enabled?lng:null,radius,resources,!!b.notificationsEnabled,room.id]);await log(room.id,'Room operations settings updated',actor);
    } else if(action==='addShift'){
      if(!requireManager(ss,res))return;const date=clean(b.date),start=clean(b.start),end=clean(b.end),dealer=clean(b.dealer);if(!date||!start)return res.status(400).json({error:'Date and start required'});await q(`INSERT INTO shifts(id,room_id,shift_date,start_time,end_time,dealer_name,status,shift_label) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[id('sh'),room.id,date,start,end,dealer==='OPEN'||!dealer?null:dealer,dealer==='OPEN'||!dealer?'open':'assigned',clean(b.shiftLabel,40)||null]);await log(room.id,`Shift created for ${date} ${start}-${end}`,actor);
    } else if(action==='cancelShift'){
      if(!requireManager(ss,res))return;const {rows:[sh]}=await q(`UPDATE shifts SET status='cancelled' WHERE room_id=$1 AND id=$2 RETURNING *`,[room.id,b.shiftId]);if(sh)await log(room.id,`Shift cancelled ${sh.shift_date} ${sh.start_time}`,actor);
    } else if(action==='claimShift'){
      const {rows:[sh]}=await q(`SELECT * FROM shifts WHERE room_id=$1 AND id=$2`,[room.id,b.shiftId]);if(!sh||sh.status!=='open')return res.status(400).json({error:'Shift unavailable'});if(room.require_pickup_approval){const {rows:[ex]}=await q(`SELECT 1 FROM shift_requests WHERE room_id=$1 AND shift_id=$2 AND request_type='pickup' AND requester=$3 AND status='pending' LIMIT 1`,[room.id,sh.id,actor]);if(!ex)await q(`INSERT INTO shift_requests(id,room_id,shift_id,request_type,requester,status) VALUES($1,$2,$3,'pickup',$4,'pending')`,[id('rq'),room.id,sh.id,actor])}else await q(`UPDATE shifts SET dealer_name=$1,status='assigned' WHERE id=$2`,[actor,sh.id]);await log(room.id,`${actor} requested/picked up ${sh.shift_date} shift`,actor);
    } else if(action==='offerSwap'){
      const {rows:[sh]}=await q(`SELECT * FROM shifts WHERE room_id=$1 AND id=$2`,[room.id,b.shiftId]);if(!sh||sh.dealer_name!==actor||sh.status!=='assigned')return res.status(400).json({error:'Shift not eligible'});const {rows:[ex]}=await q(`SELECT id FROM shift_requests WHERE room_id=$1 AND shift_id=$2 AND request_type='swap' AND status IN ('open','pending_manager') LIMIT 1`,[room.id,sh.id]);let requestId=ex?.id;if(!ex){requestId=id('rq');await q(`INSERT INTO shift_requests(id,room_id,shift_id,request_type,requester,status) VALUES($1,$2,$3,'swap',$4,'open')`,[requestId,room.id,sh.id,actor])}await log(room.id,`${actor} offered a shift`,actor);await notifyAllDealers(room.id,`swap-posted:${requestId}`,'Shift swap posted',`${actor} posted a ${sh.shift_date} ${sh.start_time} shift for swap.`,actor);
    } else if(action==='acceptSwap'){
      const {rows:[r]}=await q(`SELECT * FROM shift_requests WHERE room_id=$1 AND id=$2`,[room.id,b.requestId]);if(!r||r.status!=='open'||r.requester===actor)return res.status(400).json({error:'Swap unavailable'});if(room.require_swap_approval)await q(`UPDATE shift_requests SET acceptor=$1,status='pending_manager' WHERE id=$2`,[actor,r.id]);else await tx(async c=>{await c.query(`UPDATE shift_requests SET acceptor=$1,status='approved',approved_at=now(),approved_by=$1 WHERE id=$2`,[actor,r.id]);await c.query(`UPDATE shifts SET dealer_name=$1,status='assigned' WHERE id=$2`,[actor,r.shift_id])});await log(room.id,`${actor} accepted a swap`,actor);await notifyMember(room.id,r.requester,`swap-accepted:${r.id}`,'Your swap was accepted',`${actor} accepted your shift swap.`);if(room.require_swap_approval)await notifyManagers(room.id,`swap-manager:${r.id}`,'Accepted swap needs approval',`${r.requester} → ${actor} is waiting for manager approval.`);
    } else if(action==='approveRequest'){
      if(!requireManager(ss,res))return;const {rows:[r]}=await q(`SELECT * FROM shift_requests WHERE room_id=$1 AND id=$2`,[room.id,b.requestId]);if(!r)return res.status(404).json({error:'Request not found'});await tx(async c=>{await c.query(`UPDATE shift_requests SET status='approved',approved_at=now(),approved_by=$1 WHERE id=$2`,[actor,r.id]);await c.query(`UPDATE shifts SET dealer_name=$1,status='assigned' WHERE id=$2`,[r.request_type==='pickup'?r.requester:r.acceptor,r.shift_id])});await log(room.id,`${actor} approved a ${r.request_type}`,actor);
    } else if(action==='denyRequest'){
      if(!requireManager(ss,res))return;const {rows:[r]}=await q(`UPDATE shift_requests SET status='denied',denied_at=now() WHERE room_id=$1 AND id=$2 RETURNING *`,[room.id,b.requestId]);if(r)await log(room.id,`${actor} denied a ${r.request_type}`,actor);
    } else if(action==='clockIn'){
      if(room.geofence_enabled){const lat=Number(b.lat),lng=Number(b.lng);if(!Number.isFinite(lat)||!Number.isFinite(lng))return res.status(400).json({error:'Location is required to clock in at this room'});const dist=metersBetween(lat,lng,Number(room.geofence_lat),Number(room.geofence_lng));if(dist>(+room.geofence_radius_m||250))return res.status(403).json({error:`You are ${Math.round(dist)}m from the property. You must be within ${+room.geofence_radius_m||250}m to clock in.`})}
      const {rows:[ex]}=await q(`SELECT id FROM time_entries WHERE room_id=$1 AND lower(name)=lower($2) AND clock_out IS NULL LIMIT 1`,[room.id,actor]);if(ex)return res.status(400).json({error:'Already clocked in'});await q(`INSERT INTO time_entries(id,room_id,member_id,name,clock_in) VALUES($1,$2,$3,$4,now())`,[id('tm'),room.id,ss.member_id,actor]);await log(room.id,`${actor} clocked in`,actor);
    } else if(action==='clockOut'){
      const {rows:[e]}=await q(`SELECT id,clock_in FROM time_entries WHERE room_id=$1 AND lower(name)=lower($2) AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1`,[room.id,actor]);if(!e)return res.status(400).json({error:'Not clocked in'});const {rows:[done]}=await q(`UPDATE time_entries SET clock_out=now() WHERE id=$1 RETURNING clock_in,clock_out`,[e.id]);await log(room.id,`${actor} clocked out`,actor);const hrs=(new Date(done.clock_out)-new Date(done.clock_in))/36e5;await notifyMember(room.id,actor,`clockout:${e.id}`,'Today’s hours',`You worked ${hrs.toFixed(2)} hours in this session today.`);
    } else if(action==='managerClockIn'){
      if(!requireManager(ss,res))return;const name=clean(b.name,80),at=b.at?new Date(b.at):new Date();if(!name||Number.isNaN(at.getTime()))return res.status(400).json({error:'Dealer and valid clock-in time required'});const m=await memberByName(room.id,name);if(!m||!m.active)return res.status(404).json({error:'Active dealer not found'});const {rows:[ex]}=await q(`SELECT id FROM time_entries WHERE room_id=$1 AND member_id=$2 AND clock_out IS NULL LIMIT 1`,[room.id,m.id]);if(ex)return res.status(400).json({error:'Dealer is already clocked in'});await q(`INSERT INTO time_entries(id,room_id,member_id,name,clock_in) VALUES($1,$2,$3,$4,$5)`,[id('tm'),room.id,m.id,m.name,at]);await log(room.id,`${actor} clocked ${m.name} in${b.at?' (backdated)':''}`,actor);
    } else if(action==='managerClockOut'){
      if(!requireManager(ss,res))return;const name=clean(b.name,80),at=b.at?new Date(b.at):new Date();if(!name||Number.isNaN(at.getTime()))return res.status(400).json({error:'Dealer and valid clock-out time required'});const {rows:[e]}=await q(`SELECT id,clock_in FROM time_entries WHERE room_id=$1 AND lower(name)=lower($2) AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1`,[room.id,name]);if(!e)return res.status(400).json({error:'Dealer is not clocked in'});if(at<=new Date(e.clock_in))return res.status(400).json({error:'Clock-out must be after clock-in'});await q(`UPDATE time_entries SET clock_out=$1 WHERE id=$2`,[at,e.id]);await log(room.id,`${actor} clocked ${name} out`,actor);
    } else if(action==='markNoShow'){
      if(!requireManager(ss,res))return;const {rows:[sh]}=await q(`SELECT * FROM shifts WHERE room_id=$1 AND id=$2`,[room.id,b.shiftId]);if(!sh?.dealer_name)return res.status(400).json({error:'Assigned shift not found'});await q(`INSERT INTO attendance(room_id,shift_id,name,status,at,marked_by) VALUES($1,$2,$3,'no_show',now(),$4) ON CONFLICT(room_id,shift_id) DO UPDATE SET status='no_show',at=now(),marked_by=excluded.marked_by`,[room.id,sh.id,sh.dealer_name,actor]);await log(room.id,`${sh.dealer_name} marked no-show`,actor);
    } else if(action==='clearAttendance'){
      if(!requireManager(ss,res))return;await q(`DELETE FROM attendance WHERE room_id=$1 AND shift_id=$2`,[room.id,b.shiftId]);
    } else return res.status(400).json({error:'Unknown action'});
    await notifications.drainSafely(room.id);
    const {rows:[fresh]}=await q('SELECT *,event_start_date::text AS event_start_date,event_end_date::text AS event_end_date FROM rooms WHERE id=$1',[room.id]);return res.json({room:await roomPublic(fresh,actor,ss.role)});
  }catch(e){console.error(e.status?e.message:e.code||'Request failed');return res.status(e.status||500).json({error:e.status?e.message:'Unable to complete this request. Please retry.'})}
}
