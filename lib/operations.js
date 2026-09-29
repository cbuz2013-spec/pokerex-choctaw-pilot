import crypto from 'node:crypto';
import {validDate,timeKey} from './down-cards.js';

export const operationsMigration=`
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS owner_id BIGINT REFERENCES organization_owners(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS sessions_owner_idx ON sessions(owner_id);
`;
export const dateOnly=v=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);
export function roomDay(room,at=new Date()) {return new Intl.DateTimeFormat('en-CA',{timeZone:room.timezone||'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(at);}
export function roomDayBounds(room,at=new Date()) {
 const zone=room.timezone||'America/Chicago',day=roomDay(room,at),target=Date.parse(day+'T00:00:00Z');
 const format=new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
 const midnight=wall=>{let probe=wall;for(let i=0;i<5;i++){const p=Object.fromEntries(format.formatToParts(new Date(probe)).map(x=>[x.type,x.value])),local=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second),delta=wall-local;if(!delta)break;probe+=delta;}return probe;};
 return {start:midnight(target),end:midnight(target+86400000)};
}
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const clean=(v,n=80)=>String(v??'').replace(/[<>]/g,'').trim().slice(0,n);
const id=()=>crypto.randomUUID();
const number=v=>{const s=String(v??'').trim();if(!/^\d{1,3}$/.test(s))throw fail('Each dealer needs a valid 1–3 digit dealer number.');return s.padStart(3,'0')};
const shiftData=r=>{const date=clean(r.date,10),start=timeKey(clean(r.start,8)),rawEnd=clean(r.end,8),end=rawEnd?timeKey(rawEnd):'';if(!validDate(date)||!start||(rawEnd&&!end)||start===end)throw fail('Use a valid shift date and start/end times.');return {date,start,end,label:clean(r.shift||r.shiftLabel,40)}};
const managedActions=new Set(['setEvent','setRoom','setEOSettings','setWorkflow','setOperationsConfig','importRosterSchedule','importSchedule','importDealers','addShift','cancelShift','approveRequest','denyRequest','managerClockIn','managerClockOut','approveJoin','denyJoin']);
const actions=new Set([...managedActions,'claimShift','offerSwap','acceptSwap','clockIn','clockOut','joinEO','leaveEO']);

// All operations in this module serialize writes to one room and commit as a unit.
export async function handleOperations({action,b,room,ss,q,tx,res,hashPin,notifyMember,notifyManagers,notifyAllDealers,metersBetween}) {
 if(!actions.has(action))return false;
 if(managedActions.has(action)&&(!ss.manager||!['manager','owner'].includes(ss.role)))throw fail('Manager required',403);
 if(['claimShift','offerSwap','acceptSwap','joinEO','leaveEO'].includes(action)&&ss.role!=='dealer')throw fail('Use a dealer login for this action.',403);
 const pending=[];let extra={};
 await tx(async db=>{
  const run=(s,p=[])=>db.query(s,p);
  const {rows:[current]}=await run('SELECT * FROM rooms WHERE id=$1 FOR UPDATE',[room.id]);room=current;
  const actor=ss.name;
  const audit=text=>run('INSERT INTO audit_logs(id,room_id,actor,event_text) VALUES($1,$2,$3,$4)',[id(),room.id,actor,text]);
  const active=async name=>{const {rows:[m]}=await run('SELECT * FROM room_members WHERE room_id=$1 AND lower(name)=lower($2) AND active=true',[room.id,name]);if(!m)throw fail('Active dealer not found');return m};
  const getShift=async shiftId=>{const {rows:[sh]}=await run('SELECT * FROM shifts WHERE id=$1 AND room_id=$2 FOR UPDATE',[shiftId,room.id]);if(!sh)throw fail('Shift not found',404);return sh};
  const closeCompetitors=(shiftId,keep)=>run("UPDATE shift_requests SET status='denied',denied_at=now() WHERE room_id=$1 AND shift_id=$2 AND id<>$3 AND status IN ('pending','pending_manager','open')",[room.id,shiftId,keep||'']);
  if(action==='setEvent'){
   const start=clean(b.eventStart,10),end=clean(b.eventEnd,10);
   if((start&&!validDate(start))||(end&&!validDate(end))||(start&&end&&end<start))throw fail('Enter valid event dates with the end on or after the start.');
   await run('UPDATE rooms SET event_name=$1,event_start_date=$2,event_end_date=$3,room_name=$4,updated_at=now() WHERE id=$5',[clean(b.eventName,120)||'Poker Executives Event',start||null,end||null,clean(b.roomName,120)||room.room_name,room.id]);
  }else if(action==='setRoom')await run('UPDATE rooms SET room_name=$1,shift_name=$2,updated_at=now() WHERE id=$3',[clean(b.roomName)||room.room_name,clean(b.shiftName)||room.shift_name,room.id]);
  else if(action==='setWorkflow')await run('UPDATE rooms SET require_pickup_approval=$1,require_swap_approval=$2 WHERE id=$3',[!!b.requirePickupApproval,!!b.requireSwapApproval,room.id]);
  else if(action==='setEOSettings'){
   if(!['choctaw_prior_hours','shift_start','signup','hours','downs','manual'].includes(b.eoMethod)||!['signup','shift_start','manual'].includes(b.eoTiebreaker))throw fail('Choose valid EO rules.');
   await run('UPDATE rooms SET eo_method=$1,eo_tiebreaker=$2,eo_min_hours=$3,eo_min_downs=$4 WHERE id=$5',[b.eoMethod,b.eoTiebreaker,Math.max(0,Math.min(24,+b.eoMinHours||0)),Math.max(0,Math.min(100,+b.eoMinDowns||0)),room.id]);
  }else if(action==='setOperationsConfig'){
   const enabled=!!b.geofenceEnabled,lat=Number(b.geofenceLat),lng=Number(b.geofenceLng);
   if(enabled&&([b.geofenceLat,b.geofenceLng].some(v=>v==null||String(v).trim()==='')||!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180))throw fail('Enter valid latitude and longitude before enabling location clock-in.');
   const arr=v=>[...new Set((Array.isArray(v)?v:[]).map(x=>clean(x,40)).filter(Boolean))].slice(0,300);
   const resources={tables:arr(b.tables),breaks:arr(b.breaks),brushes:arr(b.brushes),setup:arr(b.setup)};
   await run('UPDATE rooms SET geofence_enabled=$1,geofence_lat=$2,geofence_lng=$3,geofence_radius_m=$4,resource_config=$5,notifications_enabled=$6 WHERE id=$7',[enabled,enabled?lat:null,enabled?lng:null,Math.max(25,Math.min(5000,+b.geofenceRadiusM||250)),resources,!!b.notificationsEnabled,room.id]);
  }else if(['importRosterSchedule','importSchedule','importDealers'].includes(action)){
   const source=action==='importDealers'?b.dealers:b.rows;
   if(!Array.isArray(source)||!source.length||source.length>2500)throw fail('Supply between 1 and 2500 import rows.');
   // Parse every row before writing. The transaction also rolls back DB constraint failures.
   const rows=source.map((r,i)=>{try{const name=clean(r.dealer||r.name),num=number(r.dealerNumber);if(!name)throw fail('Dealer name required.');const pin=String(r.pin||'').trim();if(pin&&!/^\d{4,6}$/.test(pin))throw fail('Imported PINs must be 4–6 digits.');const hasShift=action!=='importDealers'&&!!(r.date||r.start||r.end||r.shift||r.shiftLabel);if(action==='importSchedule'&&!hasShift)throw fail('Schedule row needs a date and time.');return {name,num,pin,shift:hasShift?shiftData(r):null}}catch(e){throw fail(`Row ${i+1}: ${e.message}`)}});
   let dealersAdded=0,dealersUpdated=0,shiftsAdded=0,skipped=0,tempPins=[];
   for(const r of rows){
    const {rows:matches}=await run('SELECT * FROM room_members WHERE room_id=$1 AND (dealer_number=$2 OR lower(name)=lower($3)) FOR UPDATE',[room.id,r.num,r.name]);
    if(matches.length>1)throw fail(`Dealer name and number identify different people: ${r.name}.`);
    let mem=matches[0];
    if(mem&&action==='importDealers'){skipped++;continue;}
    if(!mem){const hp=hashPin(r.pin||'0'+r.num);({rows:[mem]}=await run('INSERT INTO room_members(room_id,name,dealer_number,pin_hash,pin_salt,must_change_pin) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[room.id,r.name,r.num,hp.hash,hp.salt,!r.pin]));dealersAdded++;if(!r.pin)tempPins.push({name:r.name,dealerNumber:r.num,pin:'0'+r.num});}
    else {
     const old=mem.name;
     if(old!==r.name){
      // Legacy operational tables are keyed by names. Keep all their references in sync atomically.
      for(const [table,column] of [['shifts','dealer_name'],['shift_requests','requester'],['shift_requests','acceptor'],['eo_requests','name'],['time_entries','name'],['attendance','name'],['down_entries','dealer_name']])await run(`UPDATE ${table} SET ${column}=$1 WHERE room_id=$2 AND lower(${column})=lower($3)`,[r.name,room.id,old]);
     }
     await run('UPDATE room_members SET name=$1,dealer_number=$2,active=true,updated_at=now() WHERE id=$3',[r.name,r.num,mem.id]);
     if(r.pin){const hp=hashPin(r.pin);await run('UPDATE room_members SET pin_hash=$1,pin_salt=$2,manager_pin_hash=CASE WHEN is_manager THEN $1 ELSE manager_pin_hash END,manager_pin_salt=CASE WHEN is_manager THEN $2 ELSE manager_pin_salt END,must_change_pin=false WHERE id=$3',[hp.hash,hp.salt,mem.id]);await run('DELETE FROM sessions WHERE member_id=$1',[mem.id]);}
     mem.name=r.name;dealersUpdated++;
    }
    if(r.shift){const s=r.shift;const {rows:exists}=await run("SELECT id FROM shifts WHERE room_id=$1 AND shift_date=$2 AND lower(dealer_name)=lower($3) AND start_time=$4 AND status<>'cancelled'",[room.id,s.date,mem.name,s.start]);if(exists.length){skipped++;continue;}await run("INSERT INTO shifts(id,room_id,shift_date,start_time,end_time,dealer_name,status,shift_label) VALUES($1,$2,$3,$4,$5,$6,'assigned',$7)",[id(),room.id,s.date,s.start,s.end,mem.name,s.label]);shiftsAdded++;}
   }
   extra={ok:true,dealersAdded,dealersUpdated,shiftsAdded,skipped,tempPins,added:action==='importDealers'?dealersAdded:shiftsAdded,dealersCreated:dealersAdded,generated:tempPins};
  }else if(action==='addShift'){
   const s=shiftData(b),name=b.dealer==='OPEN'?null:(await active(b.dealer)).name;
   await run('INSERT INTO shifts(id,room_id,shift_date,start_time,end_time,dealer_name,status,shift_label) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id(),room.id,s.date,s.start,s.end,name,name?'assigned':'open',s.label]);
  }else if(action==='cancelShift'){
   const sh=await getShift(b.shiftId);await run("UPDATE shifts SET status='cancelled' WHERE id=$1",[sh.id]);await closeCompetitors(sh.id);
  }else if(action==='claimShift'){
   const sh=await getShift(b.shiftId);if(sh.status!=='open')throw fail('Shift is no longer available.',409);
   if(room.require_pickup_approval){const {rows:old}=await run("SELECT id FROM shift_requests WHERE shift_id=$1 AND requester=$2 AND request_type='pickup' AND status='pending'",[sh.id,actor]);if(!old.length)await run("INSERT INTO shift_requests(id,room_id,shift_id,request_type,requester,status) VALUES($1,$2,$3,'pickup',$4,'pending')",[id(),room.id,sh.id,actor]);}
   else {await run("UPDATE shifts SET dealer_name=$1,status='assigned' WHERE id=$2",[actor,sh.id]);await closeCompetitors(sh.id);}
  }else if(action==='offerSwap'){
   const sh=await getShift(b.shiftId);if(sh.dealer_name!==actor||sh.status!=='assigned')throw fail('Shift is no longer eligible.',409);
   const {rows:old}=await run("SELECT id FROM shift_requests WHERE shift_id=$1 AND request_type='swap' AND status IN ('open','pending_manager')",[sh.id]);
   if(!old.length){const rid=id();await run("INSERT INTO shift_requests(id,room_id,shift_id,request_type,requester,status) VALUES($1,$2,$3,'swap',$4,'open')",[rid,room.id,sh.id,actor]);pending.push(()=>notifyAllDealers(room.id,'swap-posted:'+rid,'Shift swap posted',`${actor} posted a ${dateOnly(sh.shift_date)} ${sh.start_time} shift for swap.`,actor));}
  }else if(['acceptSwap','approveRequest','denyRequest'].includes(action)){
   const {rows:[r]}=await run('SELECT * FROM shift_requests WHERE id=$1 AND room_id=$2 FOR UPDATE',[b.requestId,room.id]);if(!r)throw fail('Request not found',404);
   if(action==='denyRequest'){if(!['pending','pending_manager','open'].includes(r.status))throw fail('Request has already been resolved.',409);await run("UPDATE shift_requests SET status='denied',denied_at=now() WHERE id=$1",[r.id]);}
   else {
    const sh=await getShift(r.shift_id);
    if(action==='acceptSwap'&&(r.request_type!=='swap'||r.status!=='open'||r.requester===actor))throw fail('Swap is no longer available.',409);
    if(action==='approveRequest'&&!['pending','pending_manager'].includes(r.status))throw fail('Request has already been resolved.',409);
    if(r.request_type==='pickup'?sh.status!=='open':(sh.status!=='assigned'||sh.dealer_name!==r.requester))throw fail('The shift has changed. Refresh requests.',409);
    const target=action==='acceptSwap'?actor:r.request_type==='pickup'?r.requester:r.acceptor;await active(target);
    if(action==='acceptSwap'&&room.require_swap_approval){await run("UPDATE shift_requests SET acceptor=$1,status='pending_manager' WHERE id=$2",[actor,r.id]);pending.push(()=>notifyManagers(room.id,'swap-manager:'+r.id,'Accepted swap needs approval',`${r.requester} → ${actor} is waiting for manager approval.`));}
    else {await run("UPDATE shift_requests SET acceptor=COALESCE($1,acceptor),status='approved',approved_at=now(),approved_by=$2 WHERE id=$3",[r.request_type==='swap'?target:null,actor,r.id]);await run("UPDATE shifts SET dealer_name=$1,status='assigned' WHERE id=$2",[target,sh.id]);await closeCompetitors(sh.id,r.id);}
    if(action==='acceptSwap')pending.push(()=>notifyMember(room.id,r.requester,'swap-accepted:'+r.id,'Your swap was accepted',`${actor} accepted your shift swap.`));
   }
  }else if(['clockIn','clockOut','managerClockIn','managerClockOut'].includes(action)){
   const managerial=action.startsWith('manager'),name=managerial?clean(b.name):actor,mem=await active(name),at=managerial&&b.at?new Date(b.at):new Date(),entering=action.endsWith('In');
   if(!Number.isFinite(at.getTime())||at.getTime()>Date.now())throw fail('Clock time must be valid and cannot be in the future.');
   if(!managerial&&entering&&room.geofence_enabled){const lat=Number(b.lat),lng=Number(b.lng);if([b.lat,b.lng].some(v=>v==null||String(v).trim()==='')||!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)throw fail('Location is required to clock in.');if(metersBetween(lat,lng,+room.geofence_lat,+room.geofence_lng)>+room.geofence_radius_m)throw fail('You must be within the property clock-in radius.',403);}
   const {rows:open}=await run('SELECT * FROM time_entries WHERE room_id=$1 AND member_id=$2 AND clock_out IS NULL FOR UPDATE',[room.id,mem.id]);
   if(entering){if(open.length)throw fail('Already clocked in.',409);const {rows:overlap}=await run('SELECT id FROM time_entries WHERE room_id=$1 AND member_id=$2 AND clock_out>$3',[room.id,mem.id,at]);if(overlap.length)throw fail('Clock-in overlaps an existing time entry.');await run('INSERT INTO time_entries(id,room_id,member_id,name,clock_in) VALUES($1,$2,$3,$4,$5)',[id(),room.id,mem.id,mem.name,at]);}
   else {if(open.length!==1)throw fail(open.length?'Multiple open entries need correction.':'Not clocked in.');const e=open[0];if(at<=new Date(e.clock_in))throw fail('Clock-out must be after clock-in.');await run('UPDATE time_entries SET clock_out=$1 WHERE id=$2',[at,e.id]);pending.push(()=>notifyMember(room.id,mem.name,'clockout:'+e.id,'Session hours',`You worked ${((at-new Date(e.clock_in))/36e5).toFixed(2)} hours in this session.`));}
  }else if(action==='joinEO'){
   const {rows:old}=await run("SELECT id FROM eo_requests WHERE room_id=$1 AND member_id=$2 AND status='waiting'",[room.id,ss.member_id]);if(!old.length)await run("INSERT INTO eo_requests(id,room_id,member_id,name,status,queue_order) SELECT $1,$2,$3,$4,'waiting',COALESCE(MAX(queue_order),0)+1 FROM eo_requests WHERE room_id=$2",[id(),room.id,ss.member_id,actor]);
  }else if(action==='leaveEO')await run("DELETE FROM eo_requests WHERE room_id=$1 AND member_id=$2 AND status='waiting'",[room.id,ss.member_id]);
  else if(action==='approveJoin'||action==='denyJoin'){
   if(!b.requestId)throw fail('Refresh the join requests and try again.');const {rows:[r]}=await run("SELECT * FROM join_requests WHERE id=$1 AND room_id=$2 AND status='pending' FOR UPDATE",[b.requestId,room.id]);if(!r)throw fail('Join request has already been resolved.',409);
   if(action==='approveJoin')await run('INSERT INTO room_members(room_id,name,pin_hash,pin_salt,active,is_manager) VALUES($1,$2,$3,$4,true,false)',[room.id,r.name,r.pin_hash,r.pin_salt]);await run('UPDATE join_requests SET status=$1 WHERE id=$2',[action==='approveJoin'?'approved':'denied',r.id]);
  }
  await audit(`${action} completed`);
 });
 // A notification failure must not turn an already committed operation into an apparent failed save.
 for(const send of pending)try{await send()}catch(e){console.error('Operation notification failed',e.code||'delivery error')}
 return {extra};
}
