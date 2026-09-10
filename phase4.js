export function registerPhase4({ app, pool, requireAdmin, requireHigher }) {
  const WINDOW_MS = 10 * 60 * 1000;
  const MAX_SUBMISSIONS = 6;
  const buckets = new Map();
  const clean = v => String(v ?? '').trim().replace(/\s+/g, ' ');
  const norm = v => clean(v).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  const tokens = v => new Set(norm(v).split(' ').filter(x => x.length >= 3));
  const similarity = (a,b) => { const A=tokens(a),B=tokens(b); if(!A.size||!B.size)return 0; let n=0; for(const x of A)if(B.has(x))n++; return n/(A.size+B.size-n); };
  const key = req => req.ip || req.socket?.remoteAddress || 'unknown';
  function allow(req){ const now=Date.now(), k=key(req); const r=(buckets.get(k)||[]).filter(t=>now-t<WINDOW_MS); if(r.length>=MAX_SUBMISSIONS){buckets.set(k,r);return false;} r.push(now);buckets.set(k,r);return true; }
  setInterval(()=>{const now=Date.now();for(const [k,v] of buckets){const r=v.filter(t=>now-t<WINDOW_MS);if(r.length)buckets.set(k,r);else buckets.delete(k);}},WINDOW_MS).unref?.();

  async function assess({category,description,location}) {
    let score=0, flags=[];
    const text=norm(description);
    if(text.length<20){score+=20;flags.push('VERY_SHORT_DESCRIPTION');}
    if(text.length<8){score+=25;flags.push('LOW_INFORMATION');}
    if(/^(.)\1{5,}$/u.test(text.replace(/\s/g,''))){score+=35;flags.push('REPEATED_CHARACTERS');}
    if(/https?:\/\/|www\./i.test(description)){score+=10;flags.push('LINK_IN_DESCRIPTION');}
    const recent=await pool.query(`SELECT complaint_code,category,description,location FROM complaints WHERE created_at>=NOW()-INTERVAL '24 hours' ORDER BY created_at DESC LIMIT 150`);
    let max=0,similarCode=null,count=0;
    for(const r of recent.rows){const s=similarity(description,r.description);if(s>=.82)count++;if(s>max){max=s;similarCode=r.complaint_code;}}
    if(max>=.90){score+=35;flags.push('VERY_SIMILAR_RECENT_COMPLAINT');}else if(max>=.82){score+=20;flags.push('SIMILAR_RECENT_COMPLAINT');}
    if(count>=5){score+=15;flags.push('REPEATED_PATTERN');}
    const common=recent.rows.filter(r=>r.category===category&&similarity(description,r.description)>=.55).length;
    if(common>=3)flags.push('POSSIBLE_COMMON_ISSUE');
    return {score:Math.min(100,score),flags,reviewStatus:score>=60?'NEEDS_REVIEW':'NORMAL',similarCode,commonIssue:common};
  }

  app.post('/api/complaints/risk',async(req,res)=>{ if(!allow(req))return res.status(429).json({error:'Too many submissions in a short period. Please try again later.'}); const {category,description,location}=req.body||{}; if(!category||!description)return res.status(400).json({error:'category and description are required'}); if(clean(description).length>2000||clean(location).length>200)return res.status(400).json({error:'Input is too long'}); res.json(await assess({category,description,location})); });
  async function queue(kind,res){const filter=kind==='admin'?`c.complaint_destination IN ('ADMIN','ESCALATED')`:`c.complaint_destination IN ('HIGHER_AUTHORITY','ESCALATED')`;const r=await pool.query(`SELECT complaint_code,category,urgency,status,complaint_destination,created_at,updated_at,COALESCE(risk_score,0)::int AS risk_score,COALESCE(risk_flags,'{}') AS risk_flags,COALESCE(review_status,'NORMAL') AS review_status FROM complaints c WHERE ${filter} AND COALESCE(review_status,'NORMAL')<>'NORMAL' ORDER BY risk_score DESC,created_at ASC LIMIT 200`);res.json(r.rows);}
  app.get('/api/admin/review-queue',requireAdmin,(_,res)=>queue('admin',res));
  app.get('/api/higher/review-queue',requireHigher,(_,res)=>queue('higher',res));
  async function setReview(req,res,role){const s=String(req.body?.reviewStatus||'').toUpperCase();if(!['NORMAL','NEEDS_REVIEW','REVIEWED','REJECTED','DUPLICATE'].includes(s))return res.status(400).json({error:'Invalid review status'});const r=await pool.query(`UPDATE complaints SET review_status=$1,updated_at=NOW() WHERE complaint_code=$2 RETURNING complaint_code,review_status,updated_at`,[s,req.params.code.toUpperCase()]);if(!r.rowCount)return res.status(404).json({error:'Complaint not found'});res.json(r.rows[0]);}
  app.patch('/api/admin/complaints/:code/review',requireAdmin,(req,res)=>setReview(req,res,'admin'));
  app.patch('/api/higher/complaints/:code/review',requireHigher,(req,res)=>setReview(req,res,'higher'));
  (async()=>{await pool.query(`ALTER TABLE complaints ADD COLUMN IF NOT EXISTS risk_score INTEGER NOT NULL DEFAULT 0`);await pool.query(`ALTER TABLE complaints ADD COLUMN IF NOT EXISTS risk_flags TEXT[] NOT NULL DEFAULT '{}'`);await pool.query(`ALTER TABLE complaints ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'NORMAL'`);await pool.query(`CREATE INDEX IF NOT EXISTS idx_complaints_review_queue ON complaints(review_status,risk_score DESC,created_at ASC)`);})().catch(e=>console.error('Phase 4 database setup failed:',e.message));
}
