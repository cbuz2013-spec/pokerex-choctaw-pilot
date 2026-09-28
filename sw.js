// No response caching: authentication, rosters and notification data stay fresh.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('push',event=>{
 let data={title:'PokerEx',body:'You have a PokerEx update.',url:'/',tag:'pokerex-update'};
 try{data={...data,...event.data.json()};}catch{}
 let url='/';try{const candidate=new URL(data.url,self.location.origin);if(candidate.origin===self.location.origin)url=candidate.pathname+candidate.search;}catch{}
 event.waitUntil(self.registration.showNotification(String(data.title).slice(0,160),{body:String(data.body).slice(0,1600),icon:'/poker-executives-logo.png',tag:String(data.tag).slice(0,100),data:{url}}));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();const url=new URL(event.notification.data?.url||'/',self.location.origin);
 if(url.origin!==self.location.origin)return;
 event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async list=>{
  for(const client of list){if('focus'in client){await client.navigate(url.href);return client.focus();}}
  return self.clients.openWindow(url.href);
 }));
});
self.addEventListener('pushsubscriptionchange',event=>event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{for(const client of list)client.postMessage({type:'pokerex-push-renew'});})));
