// Shared strict CSV parser for upload and paste, including quoted newlines.
(function(root) {
  const aliases = {dealer:'dealer',dealername:'dealer',name:'dealer',employee:'dealer',employeename:'dealer',dealernumber:'dealerNumber','dealer#':'dealerNumber',dealerno:'dealerNumber',dealernum:'dealerNumber',number:'dealerNumber',employeeid:'dealerNumber',dealerid:'dealerNumber',pin:'pin',dealerpin:'pin',loginpin:'pin',date:'date',workdate:'date',start:'start',starttime:'start',shiftstart:'start',end:'end',endtime:'end',shiftend:'end',shift:'shift',shiftlabel:'shift',session:'shift'};
  function records(text) {
    const rows=[]; let row=[],cell='',quoted=false,closed=false;
    const input=String(text||'').replace(/^\uFEFF/,'');
    for(let i=0;i<input.length;i++) {
      const c=input[i];
      if(quoted) {if(c==='"'&&input[i+1]==='"'){cell+='"';i++;}else if(c==='"'){quoted=false;closed=true;}else cell+=c;continue;}
      if(c==='"') {if(cell.trim()||closed)throw Error('Invalid CSV quoting.');quoted=true;cell='';continue;}
      if(c===','||c==='\n'||c==='\r') {
        row.push(cell.trim());cell='';closed=false;
        if(c!==','){if(row.some(Boolean))rows.push(row);row=[];if(c==='\r'&&input[i+1]==='\n')i++;}continue;
      }
      if(closed&&!/\s/.test(c))throw Error('Unexpected text after a quoted CSV value.');cell+=c;
    }
    if(quoted)throw Error('CSV contains an unclosed quote.');
    row.push(cell.trim());if(row.some(Boolean))rows.push(row);return rows;
  }
  function parse(text, schedule=false) {
    const all=records(text);if(!all.length)return [];
    const header=all.shift().map(h=>aliases[h.toLowerCase().replace(/[^a-z0-9#]/g,'')]||null);
    for(const key of ['dealer','dealerNumber',...(schedule?['date','start']:[])])if(!header.includes(key))throw Error('CSV requires '+({dealer:'Dealer',dealerNumber:'Dealer Number',date:'Date',start:'Start'}[key])+' header. Download or follow the displayed template.');
    if(new Set(header.filter(Boolean)).size!==header.filter(Boolean).length)throw Error('CSV contains duplicate column headers.');
    return all.map((values,i)=>{
      if(values.length!==header.length)throw Error(`CSV row ${i+2}: column count does not match the header.`);
      const row={dealer:'',dealerNumber:'',pin:'',date:'',start:'',end:'',shift:''};
      header.forEach((key,j)=>{if(key)row[key]=values[j]});
      if(!row.dealer||!/^\d{1,3}$/.test(row.dealerNumber))throw Error(`CSV row ${i+2}: dealer name and 1–3 digit dealer number are required.`);
      if(schedule&&(!row.date||!row.start))throw Error(`CSV row ${i+2}: date and start time are required.`);
      return row;
    });
  }
  root.PokerExCSV={parse,records};
})(globalThis);
