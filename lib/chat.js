import crypto from 'node:crypto';
export const chatMigration=`
CREATE TABLE IF NOT EXISTS chat_conversations (
 id TEXT PRIMARY KEY,room_id BIGINT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('channel','dm')),name TEXT NOT NULL,
 conversation_key TEXT NOT NULL,participants JSONB NOT NULL DEFAULT '[]',
 managers_only BOOLEAN NOT NULL DEFAULT false,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(room_id,conversation_key)
);
CREATE TABLE IF NOT EXISTS chat_messages (
 id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
 sender_key TEXT NOT NULL,sender_name TEXT NOT NULL,body TEXT NOT NULL,
 client_id TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(conversation_id,sender_key,client_id)
);
CREATE INDEX IF NOT EXISTS chat_message_history_idx ON chat_messages(conversation_id,created_at,id);
`;
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const identity=ss=>ss.role==='owner'?'owner:'+ss.owner_id:'member:'+ss.member_id;
const manager=ss=>!!ss.manager&&['manager','owner'].includes(ss.role);
const canRead=(c,ss)=>c.kind==='dm'?c.participants.includes(identity(ss)):!c.managers_only||manager(ss);
const plain=(v,max)=>String(v??'').trim().slice(0,max);
async function people(q,room){
 const {rows:members}=await q('SELECT id,name,is_manager FROM room_members WHERE room_id=$1 AND active=true ORDER BY lower(name)',[room.id]);
 const {rows:owners}=await q('SELECT id,name FROM organization_owners WHERE organization_id=$1 AND active=true ORDER BY lower(name)',[room.organization_id]);
 return [...members.map(m=>({key:'member:'+m.id,name:m.name,role:m.is_manager?'manager':'dealer'})),...owners.map(o=>({key:'owner:'+o.id,name:o.name,role:'owner'}))];
}
export async function handleChat({action,b,room,ss,q,tx,res}){
 if(!['chatState','chatCreateChannel','chatOpenDM','chatSend'].includes(action))return false;
 const me=identity(ss),peers=await people(q,room);let selected=b.conversationId;
 if(action==='chatState'){
  await q("INSERT INTO chat_conversations(id,room_id,kind,name,conversation_key) VALUES($1,$2,'channel','general','channel:general') ON CONFLICT(room_id,conversation_key) DO NOTHING",[crypto.randomUUID(),room.id]);
 }else await tx(async db=>{
  const run=(s,p=[])=>db.query(s,p);await run('SELECT id FROM rooms WHERE id=$1 FOR UPDATE',[room.id]);
  if(action==='chatCreateChannel'){
   if(!manager(ss))throw fail('Only managers or owners can create channels.',403);
   const name=plain(b.name,40).toLowerCase();if(!/^[a-z0-9][a-z0-9-]{0,39}$/.test(name))throw fail('Use letters, numbers and hyphens for the channel name.');
   const {rows:[count]}=await run("SELECT count(*)::int AS n FROM chat_conversations WHERE room_id=$1 AND kind='channel'",[room.id]);if(count.n>=30)throw fail('This room already has 30 channels.');
   const {rows:[c]}=await run("INSERT INTO chat_conversations(id,room_id,kind,name,conversation_key,managers_only) VALUES($1,$2,'channel',$3,$4,$5) ON CONFLICT(room_id,conversation_key) DO NOTHING RETURNING id",[crypto.randomUUID(),room.id,name,'channel:'+name,!!b.managersOnly]);if(!c)throw fail('That channel already exists.',409);selected=c.id;
  }else if(action==='chatOpenDM'){
   const target=String(b.target||'');if(target===me||!peers.some(p=>p.key===target))throw fail('Choose another active person in this room.');
   const participants=[me,target].sort(),key='dm:'+participants.join('|');
   await run("INSERT INTO chat_conversations(id,room_id,kind,name,conversation_key,participants) VALUES($1,$2,'dm','Direct message',$3,$4) ON CONFLICT(room_id,conversation_key) DO NOTHING",[crypto.randomUUID(),room.id,key,JSON.stringify(participants)]);
   const {rows:[c]}=await run('SELECT id FROM chat_conversations WHERE room_id=$1 AND conversation_key=$2',[room.id,key]);selected=c.id;
  }else{
   const {rows:[c]}=await run('SELECT * FROM chat_conversations WHERE id=$1 AND room_id=$2',[selected,room.id]);if(!c||!canRead(c,ss))throw fail('Conversation unavailable.',403);
   if(c.kind==='dm'&&c.participants.some(key=>!peers.some(p=>p.key===key)))throw fail('This person is no longer active in the room.');
   const body=String(b.message??'').trim(),clientId=String(b.clientId||'');if(!body||body.length>2000)throw fail('Enter a message of 1–2000 characters.');if(!/^[\w-]{16,80}$/.test(clientId))throw fail('Missing message reference. Reload and retry.');
   const {rows:[old]}=await run('SELECT body FROM chat_messages WHERE conversation_id=$1 AND sender_key=$2 AND client_id=$3',[c.id,me,clientId]);if(old){if(old.body!==body)throw fail('This send reference belongs to a different message.',409);return;}
   const {rows:[rate]}=await run("SELECT count(*)::int AS n FROM chat_messages m JOIN chat_conversations c ON c.id=m.conversation_id WHERE c.room_id=$1 AND m.sender_key=$2 AND m.created_at>now()-interval '1 minute'",[room.id,me]);if(rate.n>=30)throw fail('Please wait a moment before sending more messages.',429);
   await run('INSERT INTO chat_messages(id,conversation_id,sender_key,sender_name,body,client_id) VALUES($1,$2,$3,$4,$5,$6)',[crypto.randomUUID(),c.id,me,ss.name,body,clientId]);
  }
 });
 const {rows:all}=await q('SELECT * FROM chat_conversations WHERE room_id=$1 ORDER BY kind,name,created_at',[room.id]);
 const conversations=all.filter(c=>canRead(c,ss)).map(c=>({id:c.id,kind:c.kind,name:c.kind==='dm'?(peers.find(p=>p.key===c.participants.find(k=>k!==me))?.name||'Inactive person'):c.name,managersOnly:c.managers_only}));
 if(!selected)selected=conversations.find(c=>c.kind==='channel'&&c.name==='general')?.id;
 if(selected&&!conversations.some(c=>c.id===selected))throw fail('Conversation unavailable.',403);
 let messages=[],hasMore=false;
 if(selected){const before=b.before;let boundary='';const params=[selected];if(before){const {rows:[m]}=await q('SELECT created_at,id FROM chat_messages WHERE id=$1 AND conversation_id=$2',[String(before),selected]);if(!m)throw fail('Message history reference is unavailable.');params.push(m.created_at,m.id);boundary=' AND (created_at,id)<($2,$3)';}const r=await q(`SELECT id,sender_key AS "senderKey",sender_name AS "senderName",body,created_at AS "createdAt" FROM chat_messages WHERE conversation_id=$1${boundary} ORDER BY created_at DESC,id DESC LIMIT 61`,params);hasMore=r.rows.length>60;messages=r.rows.slice(0,60).reverse();}
 res.json({me,canManage:manager(ss),peers:peers.filter(p=>p.key!==me),conversations,selected,messages,hasMore});return true;
}
