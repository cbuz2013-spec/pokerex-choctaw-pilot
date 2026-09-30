// Shared form submission handling for the Choctaw QA fixes.
async function pxSubmit(button,fn){if(button.disabled)return;button.disabled=true;try{return await fn()}catch(e){alert(e.message)}finally{button.disabled=false;}}
const pxPreviewImport=(schedule=false)=>{
 const input=$(schedule?'schedulePaste':'unifiedPaste'),target=$(schedule?'importPreview':'unifiedPreview');
 try{const rows=PokerExCSV.parse(input.value,schedule);target.textContent=rows.length?`${rows.length} rows ready for validation. No data has been imported.`:'';return rows;}
 catch(e){target.textContent=e.message;return null;}
};
$('unifiedPaste').oninput=()=>pxPreviewImport(false);
$('schedulePaste').oninput=()=>pxPreviewImport(true);
for(const [file,input,schedule]of [['unifiedFile','unifiedPaste',false],['scheduleFile','schedulePaste',true]])$(file).onchange=async()=>{try{if(!$(file).files[0])return;$(input).value=await $(file).files[0].text();pxPreviewImport(schedule);}catch(e){alert(e.message)}};
for(const [button,schedule]of [['importUnified',false],['importSchedule',true]])$(button).onclick=()=>pxSubmit($(button),async()=>{
 const rows=pxPreviewImport(schedule);if(!rows)throw Error($(schedule?'importPreview':'unifiedPreview').textContent);if(!rows.length)throw Error('Choose or paste a CSV with the required headers and at least one row.');
 if(!await pxConfirm(`Import ${rows.length} validated rows into this room?`))return;
 const j=await call({action:schedule?'importSchedule':'importRosterSchedule',room:session.room,token:session.token,rows});
 roomState=j.room;render();const result=`Dealers added: ${j.dealersAdded||0}; shifts added: ${j.shiftsAdded||0}; duplicates skipped: ${j.skipped||0}.`;
 $(schedule?'importPreview':'unifiedResult').textContent=result;
 if(j.tempPins?.length)$('unifiedResult').textContent+='\nTemporary PINs: '+j.tempPins.map(x=>`${x.name} (#${x.dealerNumber}): ${x.pin}`).join(', ');
});
for(const id of ['eventName','pilotRoomName','eventStart','eventEnd'])$(id).required=true;
$('saveEvent').onclick=()=>pxSubmit($('saveEvent'),async()=>{
 for(const id of ['eventName','pilotRoomName','eventStart','eventEnd'])if(!$(id).reportValidity())return;
 if($('eventEnd').value<$('eventStart').value)throw Error('Event end must be on or after event start.');
 if(await act('setEvent',{eventName:$('eventName').value,eventStart:$('eventStart').value,eventEnd:$('eventEnd').value,roomName:$('pilotRoomName').value}))alert('Event saved.');
});
$('addShift').onclick=()=>pxSubmit($('addShift'),async()=>{
 const value={date:$('shiftDate').value,start:$('shiftStart').value,end:$('shiftEnd').value,dealer:$('shiftDealer').value,shiftLabel:$('shiftLabel').value};
 if(await act('addShift',value)){if($('shiftStart').value===value.start)$('shiftStart').value='';if($('shiftEnd').value===value.end)$('shiftEnd').value='';alert('Shift saved.');}
});
// iOS native date/time pickers may commit on change rather than input.
document.addEventListener('change',e=>{if(e.target.matches('[data-dc-field]')&&typeof e.target.oninput==='function')e.target.oninput();});
