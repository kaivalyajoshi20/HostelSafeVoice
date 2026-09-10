export function registerPhase5({ app }) {
  const WINDOW_MS=10*60*1000, MAX_FAILED=10, failures=new Map();
  const ip=req=>req.ip||req.socket?.remoteAddress||'unknown';
  function loginGuard(req,res,next){
    const now=Date.now(),k=ip(req),r=(failures.get(k)||[]).filter(t=>now-t<WINDOW_MS);
    if(r.length>=MAX_FAILED)return res.status(429).json({error:'Too many failed login attempts. Please try again later.'});
    const original=res.status.bind(res);
    res.status=code=>{if(code===401){r.push(now);failures.set(k,r);}return original(code);};
    next();
  }
  setInterval(()=>{const now=Date.now();for(const[k,v]of failures){const r=v.filter(t=>now-t<WINDOW_MS);if(r.length)failures.set(k,r);else failures.delete(k);}},WINDOW_MS).unref?.();

  // Security headers are added before the existing static/API handlers.
  app.use((req,res,next)=>{
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
    if(process.env.NODE_ENV==='production')res.setHeader('Strict-Transport-Security','max-age=31536000');
    next();
  });
  const stack=app.router?.stack||[];
  const securityLayer=stack[stack.length-1];
  if(securityLayer){stack.splice(stack.indexOf(securityLayer),1);stack.unshift(securityLayer);}

  app.post('/api/admin/login',loginGuard);
  app.post('/api/higher/login',loginGuard);
  const s=app.router?.stack||[];
  for(const path of ['/api/admin/login','/api/higher/login']){
    const guard=s[s.length-1];
    const target=s.find(x=>x!==guard&&x.route?.path===path&&x.route?.methods?.post);
    if(guard&&target){s.splice(s.indexOf(guard),1);s.splice(s.indexOf(target),0,guard);}
  }
}
