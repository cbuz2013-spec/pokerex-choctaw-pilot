// Owner actions use page dialogs because embedded browsers may not support prompt().
function pxOwnerStatus(message){
 let status=$('pxOwnerStatus');
 if(!status){status=document.createElement('p');status.id='pxOwnerStatus';status.className='notice';status.setAttribute('role','status');$('orgRooms').before(status);}
 status.textContent=message;
}
function pxOwnerRequest(action,extra){
 const orgCode=JSON.parse(localStorage.getItem('df52owner')||'{}').orgCode;
 return call({action,orgCode,token:ownerToken,...extra});
}
function pxOwnerAction({title,message,fields=[],submitLabel='Save',danger=false,submit}){
 if($('pxOwnerDialog'))return Promise.resolve(null);
 return new Promise(resolve=>{
  const trigger=document.activeElement,dialog=document.createElement('dialog'),form=document.createElement('form');
  dialog.id='pxOwnerDialog';dialog.className='px-owner-dialog';dialog.setAttribute('aria-labelledby','pxOwnerDialogTitle');dialog.setAttribute('aria-describedby','pxOwnerDialogMessage');
  const heading=document.createElement('h2');heading.id='pxOwnerDialogTitle';heading.textContent=title;
  const description=document.createElement('p');description.id='pxOwnerDialogMessage';description.textContent=message;
  form.append(heading,description);
  const inputs={};
  for(const field of fields){
   const label=document.createElement('label'),input=document.createElement('input');
   input.id='pxOwnerField-'+field.name;input.name=field.name;input.type=field.type||'text';input.required=true;input.autocomplete=field.type==='password'?'new-password':'off';input.value=field.value||'';
   if(field.numeric)input.inputMode='numeric';if(field.maxLength)input.maxLength=field.maxLength;
   if(field.pattern)input.pattern=field.pattern;
   label.htmlFor=input.id;label.textContent=field.label;inputs[field.name]=input;form.append(label,input);
  }
  const error=document.createElement('p');error.className='px-owner-error';error.setAttribute('role','alert');
  const actions=document.createElement('div');actions.className='px-owner-actions';
  const cancel=document.createElement('button');cancel.type='button';cancel.className='btn ghost';cancel.textContent='Cancel';
  const save=document.createElement('button');save.type='submit';save.className='btn '+(danger?'danger':'primary');save.textContent=submitLabel;
  actions.append(cancel,save);form.append(error,actions);dialog.append(form);document.body.append(dialog);
  let busy=false,result=null;
  cancel.onclick=()=>dialog.close();
  dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  dialog.addEventListener('close',()=>{dialog.remove();if(trigger?.isConnected)trigger.focus();resolve(result);},{once:true});
  form.onsubmit=async event=>{
   event.preventDefault();if(busy)return;
   const values=Object.fromEntries(fields.map(field=>[field.name,inputs[field.name].value.trim()]));
   for(const field of fields){
    let warning='';
    if(!values[field.name])warning='Enter '+field.label.toLowerCase()+'.';
    else if(field.equals!==undefined&&values[field.name]!==field.equals)warning='Enter the exact room code '+field.equals+' to confirm deletion.';
    else if(field.matches&&values[field.name]!==values[field.matches])warning='PINs do not match.';
    if(warning){error.textContent=warning;inputs[field.name].focus();return;}
   }
   busy=true;error.textContent='';save.textContent='Saving…';for(const control of form.elements)control.disabled=true;
   try{result=await submit(values);dialog.close();}
   catch(e){error.textContent=e.message||'Could not save. Please try again.';}
   finally{busy=false;save.textContent=submitLabel;for(const control of form.elements)control.disabled=false;}
  };
  dialog.showModal();(fields.length?inputs[fields[0].name]:cancel).focus();
 });
}
const pxPinFields=label=>[
 {name:'pin',label,type:'password',numeric:true,pattern:'[0-9]{4,12}',maxLength:12},
 {name:'confirmPin',label:'Confirm PIN',type:'password',numeric:true,pattern:'[0-9]{4,12}',maxLength:12,matches:'pin'}
];
const px={scope:'',device:'',sending:false,requestId:null,requestData:null};
const pxEsc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pxCall=(action,extra={})=>call({action,room:session.room,token:session.token,...extra});
function pxIsManager(){return ['manager','owner'].includes(session?.role);}
function pxRenderDeviceStatus(){
 if(!session)return;
 let text=px.device||'In-app notifications are active. Enable push on each device you use.';
 if(session.role==='owner')text='Owners can send messages. Use your manager login to receive push notifications on this device.';
 $('notificationStatus').textContent=text;
 for(const id of ['enableNotifications','pxTestPush','pxDisablePush'])$(id).disabled=session.role==='owner';
}
function pxSessionChanged(manager){
 const scope=[session.room,session.role,session.name].join(':');
 document.querySelector('[data-tab="messages"]').classList.toggle('hidden',!manager);
 if(!manager&&document.querySelector('.tabs button.active')?.dataset.tab==='messages')document.querySelector('[data-tab="eo"]').click();
 if(px.scope===scope)return;
 px.scope=scope;px.device='';px.requestId=null;px.requestData=null;
 $('pxSubject').value='';$('pxBody').value='';$('pxAudience').value='all';$('pxSendResult').textContent='';$('pxHistory').innerHTML='';$('pxAdmin').innerHTML='';$('pxRecipients').innerHTML='';$('pxRecipientSearch').value='';pxFillRecipients();pxUpdateAudience();
 const params=new URLSearchParams(location.search);
 if(params.get('tab')==='time'&&(!params.get('room')||params.get('room')===session.room))document.querySelector('[data-tab="time"]').click();
 pxSyncDevice(false).catch(e=>{px.device=e.message;pxRenderDeviceStatus();});
}
function pxFillRecipients(){
 const chosen=new Set([...document.querySelectorAll('[data-px-recipient]:checked')].map(el=>el.value));
 $('pxRecipients').innerHTML=(roomState.roster||[]).filter(m=>m.active!==false).map(m=>`<label class="px-recipient"><input type="checkbox" data-px-recipient value="${pxEsc(m.name)}" ${chosen.has(m.name)?'checked':''}><span><b>${pxEsc(m.name)}</b><small>#${pxEsc(m.dealerNumber||'—')}${m.manager?' · Manager':''}</small></span></label>`).join('');
}
function pxUpdateAudience(){$('pxRecipientsWrap').classList.toggle('hidden',$('pxAudience').value!=='selected');}
async function pxSyncDevice(requestPermission){
 const scope=px.scope;
 if(!session||session.role==='owner')return pxRenderDeviceStatus();
 if(!('serviceWorker'in navigator)||!('PushManager'in window)||!('Notification'in window))throw Error('Push is unavailable here. On iPhone, add PokerEx to your Home Screen and open it there, then enable notifications.');
 if(requestPermission){const permission=await Notification.requestPermission();if(permission!=='granted')throw Error('Notifications are not allowed. Enable them in your browser or phone settings.');}
 if(Notification.permission!=='granted'){px.device='In-app notifications are active. Tap Enable Notifications to allow background alerts. On iPhone, open PokerEx from the Home Screen.';pxRenderDeviceStatus();return;}
 const cfg=await pxCall('pushConfig');if(!cfg.configured)throw Error(cfg.reason);
 const reg=await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;
 let sub=await reg.pushManager.getSubscription();
 if(sub?.options.applicationServerKey){const expected=urlBase64ToUint8Array(cfg.publicKey),actual=new Uint8Array(sub.options.applicationServerKey);if(expected.length!==actual.length||expected.some((v,i)=>v!==actual[i])){await sub.unsubscribe();sub=null;}}
 if(!sub&&!requestPermission){px.device='Push is not enabled on this device. Tap Enable Notifications.';pxRenderDeviceStatus();return;}
 if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(cfg.publicKey)});
 if(scope!==px.scope)return;
 await pxCall('subscribePush',{subscription:sub.toJSON()});px.device='Push enabled on this device. Use Test Notification to verify delivery.';pxRenderDeviceStatus();
}
async function pxDetachPush(){
 if(!('serviceWorker'in navigator))return;
 const reg=await navigator.serviceWorker.getRegistration('/'),sub=await reg?.pushManager.getSubscription();
 if(sub){try{if(session)await pxCall('unsubscribePush',{endpoint:sub.endpoint});}finally{await sub.unsubscribe();}}
 px.device='Push disabled on this device. In-app notifications remain available.';pxRenderDeviceStatus();
}
$('enableNotifications').onclick=async()=>{try{await pxSyncDevice(true)}catch(e){px.device=e.message;pxRenderDeviceStatus();}};
$('pxDisablePush').onclick=async()=>{try{await pxDetachPush()}catch(e){px.device='Could not disable push. Please retry before signing out.';pxRenderDeviceStatus();}};
$('pxTestPush').onclick=async()=>{try{const r=await pxCall('testPush');px.device=r.sent?'Test sent to the push service. Check your device notifications.':'Test saved. Check notification setup and delivery status if it does not arrive.';pxRenderDeviceStatus();await refresh();}catch(e){px.device=e.message;pxRenderDeviceStatus();}};
$('logout').onclick=async()=>{try{await pxDetachPush()}catch{}logout();};
$('ownerDashboardBtn').onclick=async()=>{try{await pxDetachPush()}catch{}clearInterval(poll);session=null;roomState=null;px.scope='';showOwner();};
$('roomSwitch').onchange=async()=>{try{await pxDetachPush()}catch{}await ownerOpenRoom($('roomSwitch').value);};
$('pxAudience').onchange=pxUpdateAudience;
$('pxRecipientSearch').oninput=()=>{const search=$('pxRecipientSearch').value.toLowerCase();document.querySelectorAll('.px-recipient').forEach(el=>el.classList.toggle('hidden',!el.textContent.toLowerCase().includes(search)));};
$('pxSend').onclick=async()=>{
 if(px.sending)return;
 const subject=$('pxSubject').value.trim(),message=$('pxBody').value.trim(),audience=$('pxAudience').value;
 const recipients=[...document.querySelectorAll('[data-px-recipient]:checked')].map(el=>el.value).sort();
 if(!subject||!message){$('pxSendResult').textContent='Enter a subject and message.';return;}
 if(audience==='selected'&&!recipients.length){$('pxSendResult').textContent='Select at least one dealer.';return;}
 const payload={subject,message,audience,recipients:audience==='all'?[]:recipients};const fingerprint=JSON.stringify(payload);
 if(px.requestData!==fingerprint){px.requestId=crypto.randomUUID();px.requestData=fingerprint;}
 const count=audience==='all'?(roomState.roster||[]).filter(m=>m.active!==false).length:recipients.length;
 if(!await pxConfirm(`Send “${subject}” to ${count} ${audience==='all'?'active':'selected'} dealers?`))return;
 const scope=px.scope;px.sending=true;$('pxSend').disabled=true;$('pxSendResult').textContent='Sending…';
 try{const r=await pxCall('sendManagerMessage',{...payload,requestId:px.requestId});if(scope!==px.scope)return;
 $('pxSendResult').textContent=`${r.replayed?'Previously sent message confirmed':'Message sent'} to ${r.count} ${r.count===1?'dealer':'dealers'}. Saved in their in-app notifications; enabled devices receive push.`;
  $('pxSubject').value='';$('pxBody').value='';px.requestId=null;px.requestData=null;await pxLoadHistory();await pxLoadAdmin();
 }catch(e){$('pxSendResult').textContent=e.message+' You can retry this same message safely.';}finally{px.sending=false;$('pxSend').disabled=false;}
};
async function pxLoadHistory(){const scope=px.scope;try{const r=await pxCall('managerMessageHistory');if(scope!==px.scope)return;$('pxHistory').innerHTML=r.messages.length?r.messages.map(m=>`<article class="px-message"><div class="section"><h3>${pxEsc(m.subject)}</h3><span class="pill">${m.recipients.length} recipients</span></div><p class="px-message-body">${pxEsc(m.body)}</p><div class="small">${pxEsc(m.sender)} · ${new Date(m.createdAt).toLocaleString()}</div><details><summary>${m.audience==='all'?'All active dealers at send time':'Selected dealers'}</summary><p>${m.recipients.map(x=>pxEsc(x.name)+(x.dealer_number?' #'+pxEsc(x.dealer_number):'')).join(', ')}</p></details></article>`).join(''):'<div class="empty">No manager messages sent in this room yet.</div>';}catch(e){$('pxHistory').textContent=e.message;}}
async function pxLoadAdmin(){const scope=px.scope;try{const r=await pxCall('notificationAdmin');if(scope!==px.scope)return;
 const recent=r.lastSchedulerRun&&(Date.now()-Date.parse(r.lastSchedulerRun)<180000);
 $('pxTimezone').value=r.timezone;
 $('pxAdmin').innerHTML=`<div class="px-status-grid"><div><b>${r.configured?'Push configured':'Push needs setup'}</b><p>${pxEsc(r.reason||'VAPID key pair and contact are valid.')}</p></div><div><b>${recent?'Scheduler recently active':'Scheduler needs attention'}</b><p>${r.lastSchedulerRun?'Last completed: '+new Date(r.lastSchedulerRun).toLocaleString():'No completed scheduler run recorded.'}</p><p>${r.schedulerSecretConfigured?'Scheduler secret is configured.':'Configure CRON_SECRET before connecting a scheduler.'}</p></div><div><b>${r.notificationsEnabled?'Room notifications enabled':'Room notifications disabled'}</b><p>${Object.entries(r.delivery).map(([k,v])=>pxEsc(k)+': '+v).join(' · ')||'No push deliveries yet.'}</p><p>“Sent” means accepted by the push service, not confirmed read.</p></div></div><details><summary>Device registration by dealer</summary><div class="list">${r.dealers.map(d=>`<div class="px-device-row"><span>${pxEsc(d.dealerNumber||'—')} · ${pxEsc(d.name)}</span><b>${d.devices} device${d.devices===1?'':'s'}</b></div>`).join('')}</div></details>`;
 }catch(e){$('pxAdmin').textContent=e.message;}}
$('pxSaveTimezone').onclick=async()=>{try{await pxCall('setNotificationTimezone',{timezone:$('pxTimezone').value});$('pxTimezoneStatus').textContent='Room time zone saved.';await pxLoadAdmin();}catch(e){$('pxTimezoneStatus').textContent=e.message;}};
document.querySelector('[data-tab="messages"]').addEventListener('click',()=>{if(!pxIsManager())return;pxFillRecipients();pxLoadHistory();pxLoadAdmin();});
$('pxRefreshHistory').onclick=pxLoadHistory;$('pxRefreshAdmin').onclick=pxLoadAdmin;
if(session&&roomState)pxSessionChanged(pxIsManager());
if('serviceWorker'in navigator)navigator.serviceWorker.addEventListener('message',event=>{if(event.data?.type==='pokerex-push-renew'){px.device='Your push subscription changed. Tap Enable Notifications to reconnect this device.';pxRenderDeviceStatus();}});
