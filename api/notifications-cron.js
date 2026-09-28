import handler from './app.js';
export default function notificationsCron(req,res){req.query={...req.query,action:'notificationWorker'};req.body={};return handler(req,res);}
