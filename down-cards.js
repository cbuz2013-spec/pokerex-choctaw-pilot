/* Down-card UI shares the authenticated session and roster from PokerEx 6.0. */
const dc = {cards:[],report:null,room:null,busy:false,generation:0};
const dcEsc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dcKey=v=>String(v??'').trim().replace(/\s+/g,' ').toLowerCase();
const dcApi=(action,extra={})=>call({action,room:session.room,token:session.token,...extra});
function dcSessionChanged(manager) {
 if(dc.room!==session.room||(!manager&&dc.cards.length)){dc.room=session.room;dc.generation++;dc.cards=[];dc.report=null;dcRenderCards();$('dcEvent').innerHTML='<option value="">Current event</option>';$('dcMessage').textContent='';$('dcReportStatus').textContent='Choose an event to view its downs.';$('dcReportTable').innerHTML='';$('dcAudit').innerHTML='';$('dcExport').disabled=true;}
 for(const key of ['downcards','downreport'])document.querySelector(`[data-tab="${key}"]`).classList.toggle('hidden',!manager);
 if(!manager&&['downcards','downreport'].includes(document.querySelector('.tabs button.active')?.dataset.tab))document.querySelector('[data-tab="eo"]').click();
}
function dcIssues(r) {
 const issues=[];const number=/^\d{1,3}$/.test(r.dealerNumber)?r.dealerNumber.padStart(3,'0'):'';
 const m=(roomState.roster||[]).find(x=>x.dealerNumber&&String(x.dealerNumber).padStart(3,'0')===number);
 if(!r.event.trim())issues.push('Event required');if(!r.table.trim())issues.push('Table required');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(r.date)||Number.isNaN(Date.parse(r.date))||new Date(r.date).toISOString().slice(0,10)!==r.date)issues.push('Valid date required');
 if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(r.time))issues.push('Time required');
 if(!m)issues.push('Dealer number not in roster');else if(dcKey(m.name)!==dcKey(r.dealerName))issues.push('Roster name: '+m.name);
 return issues;
}
function dcRowStatus(r) {
 const issues=dcIssues(r);return issues.length?issues.join(' · '):r.approved?'Approved':r.confidence!=='high'?'Needs Review':'Ready for review';
}
function dcUpdateSummary() {
 const rows=dc.cards.flatMap(c=>c.rows),approved=rows.filter(r=>r.approved&&!dcIssues(r).length).length;
 $('dcSummary').textContent=`${dc.cards.length} cards · ${rows.length} rows · ${approved} approved`;
 $('dcImport').disabled=dc.busy||!approved;
}
function dcRenderCards() {
 $('dcCards').innerHTML=dc.cards.map((c,ci)=>`<article class="card dc-card"><div class="section"><h3>${dcEsc(c.filename)}</h3><button class="btn ghost" data-dc-remove="${ci}">Remove card</button></div><details><summary>View uploaded card</summary><img class="dc-source" src="${c.image}" alt="Uploaded table down card"></details><p class="small">Check every row against the photo. Dealer numbers must match the room roster. Approve only verified rows.</p><div class="report"><table class="dc-review"><thead><tr><th>Approve</th><th>Event</th><th>Table</th><th>Date</th><th>Time</th><th>Dealer #</th><th>Dealer name</th><th>Review status</th><th></th></tr></thead><tbody>${c.rows.map((r,ri)=>`<tr data-dc-row="${ci}:${ri}" class="${r.approved?'':'dc-needs'}"><td><input aria-label="Approve row ${ri+1} on ${dcEsc(c.filename)}" type="checkbox" data-dc-field="approved" data-card="${ci}" data-row="${ri}" ${r.approved?'checked':''} ${dcIssues(r).length?'disabled':''}></td>${['event','table','date','time','dealerNumber','dealerName'].map(k=>`<td><input aria-label="${k} row ${ri+1}" data-dc-field="${k}" data-card="${ci}" data-row="${ri}" type="${k==='date'?'date':k==='time'?'time':'text'}" value="${dcEsc(r[k])}" ${k==='dealerNumber'?'inputmode="numeric" maxlength="3"':''}></td>`).join('')}<td class="dc-status"><b>${dcEsc(dcRowStatus(r))}</b><div class="small">${dcEsc(r.notes)}</div></td><td><button class="btn ghost" aria-label="Remove row ${ri+1}" data-dc-delete="${ci}:${ri}">×</button></td></tr>`).join('')}</tbody></table></div><button class="btn ghost" data-dc-add="${ci}">+ Add missed row</button></article>`).join('');
 document.querySelectorAll('[data-dc-field]').forEach(input=>input.oninput=()=>{
  const ci=+input.dataset.card,ri=+input.dataset.row,r=dc.cards[ci].rows[ri],field=input.dataset.dcField;
  r[field]=field==='approved'?input.checked:input.value;if(field!=='approved')r.approved=false;
  const row=input.closest('tr'),check=row.querySelector('[type="checkbox"]');check.checked=r.approved;check.disabled=!!dcIssues(r).length;
  row.querySelector('.dc-status b').textContent=dcRowStatus(r);row.classList.toggle('dc-needs',!r.approved);dcUpdateSummary();
 });
 document.querySelectorAll('[data-dc-add]').forEach(el=>el.onclick=()=>{const c=dc.cards[+el.dataset.dcAdd],prev=c.rows.at(-1)||{};c.rows.push({event:prev.event||roomState.settings.eventName||'',table:prev.table||'',date:prev.date||'',time:'',dealerNumber:'',dealerName:'',confidence:'low',notes:'Manually added row',approved:false});dcRenderCards();});
 document.querySelectorAll('[data-dc-delete]').forEach(el=>el.onclick=()=>{const [c,r]=el.dataset.dcDelete.split(':').map(Number);dc.cards[c].rows.splice(r,1);dcRenderCards();});
 document.querySelectorAll('[data-dc-remove]').forEach(el=>el.onclick=()=>{dc.cards.splice(+el.dataset.dcRemove,1);dcRenderCards();});dcUpdateSummary();
}
function dcBusy(value) {dc.busy=value;$('dcRead').disabled=value;$('dcFiles').disabled=value;document.querySelectorAll('#dcCards input,#dcCards button').forEach(el=>el.disabled=value);if(!value)dcRenderCards();dcUpdateSummary();}
$('dcRead').onclick=async()=>{
 const files=[...$('dcFiles').files];if(!files.length){$('dcMessage').textContent='Choose one or more table-card photos first.';return;}
 if(files.length+dc.cards.length>20){$('dcMessage').textContent='Review up to 20 cards per batch.';return;}
 const generation=dc.generation;dcBusy(true);let failed=[];
 try {for(let i=0;i<files.length;i++){
  if(generation!==dc.generation)return;
  const f=files[i];$('dcMessage').textContent=`Reading card ${i+1} of ${files.length}: ${f.name}…`;
  try{
   if(!['image/jpeg','image/png','image/webp'].includes(f.type)||f.size>20*1024*1024)throw Error('Use JPG, PNG or WebP, up to 20 MB.');
   const image=await fileToScheduleImage(f);if(image.length>2800000)throw Error('Image is too large after resizing. Crop to the card and try again.');
   if(generation!==dc.generation)return;
   const result=await dcApi('analyzeDownCard',{filename:f.name,imageData:image});
   if(generation!==dc.generation)return;
   dc.cards.push({uploadId:result.uploadId,filename:f.name,image,rows:result.rows.map(r=>({...r,approved:false}))});
  }catch(e){failed.push(`${f.name}: ${e.message}`);}
 }
 $('dcFiles').value='';$('dcMessage').textContent=failed.length?`Some cards need another attempt. ${failed.join(' | ')}`:'Photos read. Review and approve each row, then import the batch.';
 }finally{dcBusy(false);}
};
$('dcImport').onclick=async()=>{
 const cards=dc.cards.map(c=>({uploadId:c.uploadId,rows:c.rows.filter(r=>r.approved)})).filter(c=>c.rows.length);
 const count=cards.reduce((s,c)=>s+c.rows.length,0),unapproved=dc.cards.flatMap(c=>c.rows).length-count;
 if(!count||!await pxConfirm(`Import ${count} approved downs? ${unapproved} unapproved rows will not be imported. Matching downs will be skipped.`))return;
 dcBusy(true);const generation=dc.generation;
 try{const result=await dcApi('importDownCards',{cards});if(generation!==dc.generation)return;
  // A card is finalized once imported; unapproved rows are deliberately excluded.
  const done=new Set(cards.map(c=>c.uploadId));dc.cards=dc.cards.filter(c=>!done.has(c.uploadId));dc.report=null;$('dcExport').disabled=true;
  $('dcMessage').textContent=`Imported ${result.imported} downs. Skipped ${result.duplicates} duplicate rows and ${result.alreadyImported} previously imported cards. Open Down Report to view totals.`;await refresh();
 }catch(e){$('dcMessage').textContent=e.message;}finally{dcBusy(false);}
};
async function dcLoadReport() {
 const generation=dc.generation;$('dcReportStatus').textContent='Loading down report…';$('dcRefresh').disabled=true;$('dcExport').disabled=true;
 try{const report=await dcApi('downReport',{event:$('dcEvent').value});if(generation!==dc.generation)return;dc.report=report;
  $('dcEvent').innerHTML=report.events.map(e=>`<option ${e===report.event?'selected':''}>${dcEsc(e)}</option>`).join('');
  $('dcReportStatus').textContent=`${report.total} downs · ${report.rows.length} dealers · ${report.dates.length} dates. Includes manual and uploaded downs; breaks, brush and setup are excluded.`;
  $('dcReportTable').innerHTML=report.dates.length?`<table><thead><tr><th>Dealer #</th><th>Dealer name</th>${report.dates.map(d=>`<th>${dcEsc(d)}</th>`).join('')}<th>Total Downs</th></tr></thead><tbody>${report.rows.map((r,ri)=>`<tr><th>${dcEsc(r.dealerNumber||'—')}</th><td>${dcEsc(r.dealerName)}</td>${report.dates.map(d=>`<td><button class="dc-count" data-dc-audit="${ri}" data-date="${d}" aria-label="${dcEsc(r.dealerName)} downs on ${d}">${r.counts[d]||0}</button></td>`).join('')}<th>${r.total}</th></tr>`).join('')}</tbody><tfoot><tr><th>TOTAL</th><td></td>${report.dates.map(d=>`<th>${report.totals[d]}</th>`).join('')}<th>${report.total}</th></tr></tfoot></table>`:'<div class="empty">No downs yet. Upload cards or set the event dates in Room settings.</div>';
  document.querySelectorAll('[data-dc-audit]').forEach(el=>el.onclick=()=>dcShowAudit(report.rows[+el.dataset.dcAudit],el.dataset.date));$('dcAudit').innerHTML='';$('dcExport').disabled=false;
 }catch(e){dc.report=null;$('dcReportTable').innerHTML='';$('dcReportStatus').textContent=e.message;}finally{$('dcRefresh').disabled=false;}
}
function dcShowAudit(dealer,day) {
 const records=dc.report.records.filter(r=>r.dealerKey===dealer.key&&r.date===day);
 $('dcAudit').innerHTML=`<h3>${dcEsc(dealer.dealerNumber)} · ${dcEsc(dealer.dealerName)} · ${day}</h3>${records.length?records.map((r,i)=>`<div class="row"><div><b>${dcEsc(r.time)} — Table ${dcEsc(r.table.replace(/^table\s*/i,''))}</b><div class="small">${dcEsc(r.event)} · ${r.uploadId?'Card import':'Manual entry'}${r.correction?' · Correction flagged':''}</div></div>${r.uploadId?`<button class="btn ghost" data-dc-image="${i}">View card</button>`:''}</div>`).join(''):'<p>No downs recorded for this date.</p>'}<div id="dcAuditImage"></div>`;
 document.querySelectorAll('[data-dc-image]').forEach(el=>el.onclick=async()=>{el.disabled=true;try{const c=await dcApi('downCardImage',{uploadId:records[+el.dataset.dcImage].uploadId});$('dcAuditImage').innerHTML=`<p>${dcEsc(c.filename)} · Uploaded by ${dcEsc(c.uploadedBy)} · Imported by ${dcEsc(c.importedBy)}</p><img class="dc-source" src="${c.image}" alt="Source table down card">`;}catch(e){$('dcAuditImage').textContent=e.message;}finally{el.disabled=false;}});
 $('dcAudit').scrollIntoView({behavior:'smooth',block:'start'});
}
$('dcRefresh').onclick=dcLoadReport;$('dcEvent').onchange=dcLoadReport;
$('dcExport').onclick=()=>{if(!dc.report)return;const url=URL.createObjectURL(new Blob([dc.report.csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='PokerEx-Down-Report-'+dc.report.event.replace(/[^a-z0-9_-]/gi,'-')+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
document.querySelector('[data-tab="downreport"]').addEventListener('click',dcLoadReport);
if(session&&roomState)dcSessionChanged(['manager','owner'].includes(session.role));
