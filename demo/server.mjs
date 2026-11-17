import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {access,readFile,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {extname,resolve,sep} from 'node:path';
import {createDemo} from './seed.mjs';

const port = Number(process.env.DEMO_PORT || 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid DEMO_PORT');
const host = '127.0.0.1:'+port, origin = 'http://'+host;
const web = fileURLToPath(new URL('../dist/web/',import.meta.url));
await access(resolve(web,'index.html'));
const home = await readFile(new URL('index.html',import.meta.url));
const demo = await createDemo(origin);
const roleNames = new Set(['admin','staff','manager','leader']);
const mime = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript','.svg':'image/svg+xml','.json':'application/json','.webmanifest':'application/manifest+json','.gz':'application/gzip','.txt':'text/plain; charset=utf-8','.wasm':'application/wasm'};
const pairs = [['__Host-shixu_session','demo_'+port+'_owner'],['__Host-shixu_company_session','demo_'+port+'_member']];
function fromBrowser(cookie='') {
  return cookie.split(';').map(v=>v.trim()).flatMap(v=>{
    const pair = pairs.find(([,local])=>v.startsWith(local+'='));
    return pair ? [pair[0]+v.slice(pair[1].length)] : [];
  }).join('; ');
}
function toBrowser(cookie) {
  const pair = pairs.find(([name])=>cookie.startsWith(name+'='));
  if (!pair) throw Error('Unsupported cookie format');
  return (pair[1]+cookie.slice(pair[0].length)).replace('; Secure','');
}
async function readBody(req,limit) {
  const chunks=[]; let size=0;
  for await(const chunk of req) {
    size+=chunk.length;
    if(size>limit) throw Object.assign(Error('Request too large'),{status:413});
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString();
}
const server = createServer(async(req,res)=>{
  try {
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    if(req.headers.host!==host) {res.writeHead(403).end();return;}
    const path = decodeURIComponent(new URL(req.url,origin).pathname);
    if(path==='/demo/enter' && req.method==='POST') {
      if(req.headers.origin!==origin){res.writeHead(403).end();return;}
      const role = new URLSearchParams(await readBody(req,512)).get('role');
      if(!roleNames.has(role)){res.writeHead(400).end();return;}
      const reply = await demo.login(role);
      if(reply.statusCode!==200){res.writeHead(reply.statusCode,{'Content-Type':'application/json'}).end(reply.body);return;}
      const localCookie = toBrowser(reply.headers['Set-Cookie']);
      const other = pairs.find(([,key])=>!localCookie.startsWith(key+'='))[1];
      res.writeHead(303,{'Set-Cookie':[localCookie,other+'=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'],Location:'/workbench/?space=company'}).end();
      return;
    }
    if(path.startsWith('/shixu-api/')) {
      const handle = path==='/shixu-api/team' ? demo.company : demo.personal;
      const reply = await handle({path,httpMethod:req.method,headers:{...req.headers,cookie:fromBrowser(req.headers.cookie)},body:await readBody(req,6*1024*1024)});
      const headers={...reply.headers};
      if(headers['Set-Cookie'])headers['Set-Cookie']=toBrowser(headers['Set-Cookie']);
      res.writeHead(reply.statusCode,headers).end(reply.body);
      return;
    }
    if(req.method!=='GET' && req.method!=='HEAD'){res.writeHead(405).end();return;}
    if(path==='/'){res.writeHead(200,{'Content-Type':mime['.html']}).end(req.method==='HEAD'?undefined:home);return;}
    if(path==='/workbench'){res.writeHead(302,{Location:'/workbench/'}).end();return;}
    if(!path.startsWith('/workbench/')){res.writeHead(404).end();return;}
    const file = resolve(web,path.slice('/workbench/'.length)||'index.html');
    if(!file.startsWith(resolve(web)+sep)){res.writeHead(404).end();return;}
    const info = await stat(file);
    if(!info.isFile()){res.writeHead(404).end();return;}
    res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Content-Length':info.size});
    if(req.method==='HEAD')res.end();else createReadStream(file).on('error',()=>res.destroy()).pipe(res);
  } catch (error) {
    if(!res.headersSent)res.writeHead(error.status || (error.code==='ENOENT'?404:500));
    res.end();
  }
});
server.listen(port,'127.0.0.1',()=>console.log('拾序 · 本地角色演示  '+origin+'/'));
