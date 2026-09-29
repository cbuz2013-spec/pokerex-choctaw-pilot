const pxDirty=new Map();let pxLastScope='';
const pxDraftGroups={setEvent:['eventName','eventStart','eventEnd','pilotRoomName'],setRoom:['roomNameInput','shiftNameInput'],setEOSettings:['eoMethod','eoTie','eoMinHours','eoMinDowns'],setWorkflow:['pickupApproval','swapApproval'],setOperationsConfig:['geofenceEnabled','geofenceRadius','geofenceLat','geofenceLng','notificationsEnabled','roomTables','roomBreaks','roomBrushes','roomSetup']};
const pxManagedFields=new Set(Object.values(pxDraftGroups).flat());
const pxValue=el=>el.type==='checkbox'?el.checked:el.value;
function pxDraftScope(){return session?[session.room,session.role,session.name].join(':'):''}
function pxDraftSnapshot(action){return (pxDraftGroups[action]||[]).map(id=>[id,pxValue(document.getElementById(id))]);}
function pxDraftSaved(snapshot){for(const [id,value]of snapshot)if(pxDirty.get(id)===value)pxDirty.delete(id);}
document.addEventListener('input',e=>{if(pxManagedFields.has(e.target.id))pxDirty.set(e.target.id,pxValue(e.target));});
document.addEventListener('change',e=>{if(pxManagedFields.has(e.target.id))pxDirty.set(e.target.id,pxValue(e.target));});
function pxSyncInput(id,value){if(pxDirty.has(id))return;const el=document.getElementById(id),key=el.type==='checkbox'?'checked':'value';if(el[key]!==value)el[key]=value;}
function render(){const scope=pxDraftScope();if(scope!==pxLastScope){pxDirty.clear();pxLastScope=scope;}renderServer();}
function pxRoomDay(at=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:roomState?.settings?.timezone||'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(at);}
async function pxConfirm(message){const result=await pxOwnerAction({title:'Confirm action',message,submitLabel:'Continue',submit:async()=>true});return !!result;}
async function pxPrompt(message){let value=null;await pxOwnerAction({title:message,fields:[{name:'value',label:'PIN',type:'password',numeric:true,minLength:4,maxLength:12}],submitLabel:'Save',submit:async fields=>{value=fields.value;return true}});return value;}
window.alert=message=>{let notice=document.getElementById('pxNotice');if(!notice){notice=document.createElement('div');notice.id='pxNotice';notice.className='px-notice';notice.setAttribute('role','alert');document.body.append(notice);}const text=document.createElement('span'),close=document.createElement('button');text.textContent=String(message);close.type='button';close.textContent='Dismiss';close.onclick=()=>notice.remove();notice.replaceChildren(text,close);};
