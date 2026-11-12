const http=require('http'),fs=require('fs'),path=require('path');
const {WebSocketServer}=require('ws');
const stages=JSON.parse(fs.readFileSync(path.join(__dirname,'stages.json'),'utf8'));
const PASS=process.env.TEACHER_PASS||'1234',MAX=5,PORT=process.env.PORT||3000;
const pub=path.join(__dirname,'public');
const server=http.createServer((req,res)=>{
  let f=req.url.split('?')[0];if(f==='/')f='/index.html';
  const p=path.join(pub,path.normalize(f));
  if(!p.startsWith(pub)||!fs.existsSync(p)){res.writeHead(404);return res.end();}
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(fs.readFileSync(p));
});
const wss=new WebSocketServer({server});
let stage=-1,monsters=[],teacher=null,nextId=1;const players={};
const cur=()=>stages[stage];
const cells=(ch)=>{const o=[];cur().grid.forEach((r,y)=>[...r].forEach((c,x)=>{if(c===ch)o.push({x,y})}));return o};
const start=()=>cells('S')[0];
const wall=(x,y)=>(cur().grid[y]||'')[x]==='#'||(cur().grid[y]||'')[x]===undefined;
function enter(n){
  stage=n;monsters=[];
  Object.values(players).forEach(p=>{p.answered=false;p.got=[];if(cur()&&cur().type==='maze'){Object.assign(p,start())}});
  if(cur()&&cur().type==='maze')monsters=cells('M');
}
function send(ws,o){if(ws&&ws.readyState===1)ws.send(JSON.stringify(o))}
function broadcast(){
  const c=cur();let sd=null;
  if(c)sd=c.type==='maze'?{type:'maze',grid:c.grid}:{type:'question',cat:c.cat,gems:c.gems,q:c.q,options:c.options};
  const list=Object.values(players).map(p=>({id:p.id,name:p.name,x:p.x,y:p.y,gems:p.gems,canPlay:p.canPlay,got:p.got,answered:p.answered,at:p.at}));
  list.sort((a,b)=>b.gems-a.gems||a.at-b.at);
  const msg={t:'state',stage,total:stages.length,sd,monsters,players:list};
  wss.clients.forEach(ws=>send(ws,msg));
}
function hit(p){if(monsters.some(m=>m.x===p.x&&m.y===p.y)){Object.assign(p,start());p.hitAt=Date.now();}}
setInterval(()=>{
  if(!cur()||cur().type!=='maze')return;
  monsters=monsters.map(m=>{
    const d=[[1,0],[-1,0],[0,1],[0,-1]].sort(()=>Math.random()-.5).find(([dx,dy])=>!wall(m.x+dx,m.y+dy));
    return d?{x:m.x+d[0],y:m.y+d[1]}:m;
  });
  Object.values(players).forEach(hit);broadcast();
},700);
wss.on('connection',ws=>{
  ws.on('message',raw=>{
    let m;try{m=JSON.parse(raw)}catch{return}
    if(m.t==='teacher'){
      if(m.pass!==PASS)return send(ws,{t:'err',msg:'كلمة السر خطأ'});
      teacher=ws;ws.isTeacher=true;return broadcast();
    }
    if(m.t==='join'){
      if(Object.keys(players).length>=MAX)return send(ws,{t:'err',msg:'الغرفة ممتلئة (5 لاعبين)'});
      const p={id:nextId++,name:String(m.name||'لاعب').slice(0,15),x:0,y:0,gems:0,canPlay:false,got:[],answered:false,at:0};
      players[p.id]=p;ws.pid=p.id;if(cur()&&cur().type==='maze')Object.assign(p,start());
      send(ws,{t:'me',id:p.id});return broadcast();
    }
    if(ws.isTeacher){
      if(m.t==='next'&&stage<stages.length-1)enter(stage+1);
      if(m.t==='toggle'&&players[m.id])players[m.id].canPlay=!players[m.id].canPlay;
      if(m.t==='all')Object.values(players).forEach(p=>p.canPlay=!!m.on);
      if(m.t==='reset'){stage=-1;monsters=[];Object.values(players).forEach(p=>Object.assign(p,{gems:0,got:[],answered:false,at:0,canPlay:false}));}
      return broadcast();
    }
    const p=players[ws.pid];if(!p||!p.canPlay||!cur())return;
    if(m.t==='move'&&cur().type==='maze'){
      const dx=Math.sign(m.dx|0),dy=Math.sign(m.dy|0);
      if(Math.abs(dx)+Math.abs(dy)!==1||wall(p.x+dx,p.y+dy))return;
      p.x+=dx;p.y+=dy;
      const key=p.x+','+p.y;
      if((cur().grid[p.y][p.x]==='G')&&!p.got.includes(key)){p.got.push(key);p.gems++;p.at=Date.now();}
      hit(p);
    }
    if(m.t==='answer'&&cur().type==='question'&&!p.answered){
      p.answered=true;
      if(m.i===cur().answer){p.gems+=cur().gems;p.at=Date.now();}
    }
    broadcast();
  });
  ws.on('close',()=>{if(ws.pid){delete players[ws.pid];broadcast();}});
});
server.listen(PORT,()=>console.log('http://localhost:'+PORT+'  |  المعلم: /?teacher'));
