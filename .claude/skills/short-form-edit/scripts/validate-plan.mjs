import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
// Schema v2 (opt-in, "schemaVersion": 2): per-scene visual metadata, motifs and planned callbacks. See plan-schema.md.
export const VISUAL={
 purpose:['performance','evidence','explanation','metaphor','orientation','emphasis','callback','cta'],
 broll:['none','source-footage','screen-recording','generated-video','screenshot','designed','ui-mock','generated-image'],
 evidence:['authentic','reconstructed','illustrative','simulated','none'],
 method:['have','capture','generate','design'],status:['planned','ready']};
const VIDEO=new Set(['source-footage','screen-recording','generated-video']),FILED=new Set([...VIDEO,'screenshot','generated-image']);
// An intent is rejected only when nothing specific is left after removing generic phrases and filler words.
const GENERIC=[/\b(an? )?(interesting|cool|nice|dynamic|engaging|eye catching|modern|sleek|fun|epic|smooth) (animation|transition|visual|graphic|motion|effect|shot)s?\b/g,
 /\bshow(s|ing)? (the )?(automation|ai|product|process|tool|app|workflow|result|technology|tech)\b/g,
 /\b(generic |some )?(stock|b ?roll) (footage|clip|video|shot)s?( of)?\b/g,/\b(b ?roll|stock footage|visuals?|graphics?|animation|text card|motion graphics?)\b/g];
const FILLER=new Set('a an the of to for and or with on in at some this that it its here there more make makes making add adds adding something things stuff about relevant related appropriate'.split(' '));
const norm=s=>String(s??'').toLowerCase().replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();
export function genericIntent(text){let t=norm(text);for(const re of GENERIC)t=t.replace(re,' ');return !t.split(' ').filter(w=>w&&!FILLER.has(w)).length;}
export function validateVisualPlan(plan,{stage='preflight',exists=()=>true,hash=null}={}){
 const errors=[],warnings=[],fail=m=>errors.push('Visual: '+m),warn=m=>warnings.push('Visual: '+m),eps=.005;
 if(plan?.schemaVersion!==2)fail(`schemaVersion must be 2 (found ${plan?.schemaVersion??'none'})`);
 const dur=plan?.duration,scenes=Array.isArray(plan?.scenes)?plan.scenes:[];
 if(!(dur>0))fail('duration must be a positive number');if(!scenes.length)fail('No scenes');
 const byId=new Map();let end=0;
 for(const s of scenes){if(byId.has(s.id))fail(`Duplicate scene ${s.id}`);byId.set(s.id,s);
  if(Math.abs(s.start-end)>eps)fail(`Scene gap or overlap at ${s.id}`);if(!(s.end>s.start))fail(`Scene ${s.id} has no duration`);end=s.end;}
 if(scenes.length&&Math.abs(end-dur)>eps)fail('Scene coverage differs from duration');
 const motifs=new Map();
 for(const m of Array.isArray(plan?.motifs)?plan.motifs:[]){
  if(!m?.id)fail('Motif without id');else if(motifs.has(m.id))fail(`Duplicate motif ${m.id}`);else motifs.set(m.id,m);
  if(!String(m?.description??'').trim())fail(`Motif ${m?.id} has no description`);
  const r=m?.activeRange;if(r!==undefined&&!(Array.isArray(r)&&r.length===2&&r[0]>=0&&r[0]<r[1]&&r[1]<=dur+eps))fail(`Motif ${m?.id} activeRange must be [start,end] with 0 <= start < end <= duration`);}
 const range=id=>Array.isArray(motifs.get(id)?.activeRange)?motifs.get(id).activeRange:null;
 const motifRef=(s,id,where)=>{if(!motifs.has(id)){fail(`Scene ${s.id} ${where} names unknown motif ${id}`);return false;}return true;};
 const metrics={simulatedScenes:[],authenticScenes:[],paidAssets:[],callbacks:[],elements:[]};
 for(const s of scenes){
  const {visualPurpose:p,brollMode:b,evidenceType:e,asset:a}=s;
  if(!VISUAL.purpose.includes(p))fail(`Scene ${s.id} visualPurpose "${p}" is not one of ${VISUAL.purpose.join(', ')}`);
  if(!VISUAL.broll.includes(b))fail(`Scene ${s.id} brollMode "${b}" is not one of ${VISUAL.broll.join(', ')}`);
  if(!VISUAL.evidence.includes(e))fail(`Scene ${s.id} evidenceType "${e}" is not one of ${VISUAL.evidence.join(', ')}`);
  if(e==='simulated')metrics.simulatedScenes.push(s.id);if(e==='authentic')metrics.authenticScenes.push(s.id);
  if(String(s.layout||'').includes('broll')&&!VIDEO.has(b))fail(`Scene ${s.id} layout ${s.layout} needs moving footage (source-footage, screen-recording or generated-video), not ${b}`);
  if(b&&b!=='none'){
   const intent=String(s.visualIntent??'').trim();
   if(!intent)fail(`Scene ${s.id} needs a visualIntent: what happens on screen and what the viewer understands`);
   else if(genericIntent(intent))fail(`Scene ${s.id} visualIntent "${intent}" is only a generic description; say what happens on screen and what the viewer understands`);
   else if(intent.split(/\s+/).length<6)warn(`Scene ${s.id} visualIntent is short (${intent.split(/\s+/).length} words); check it says what the viewer sees and understands`);
   if(e==='none')fail(`Scene ${s.id} shows ${b} but evidenceType is none; say whether it is authentic, reconstructed, illustrative or simulated`);
   if(!a||typeof a!=='object')fail(`Scene ${s.id} needs an asset plan (ref, source, method, paid, whyThis)`);
   else{
    for(const k of ['ref','source','whyThis'])if(!String(a[k]??'').trim())fail(`Scene ${s.id} asset.${k} is empty`);
    if(!VISUAL.method.includes(a.method))fail(`Scene ${s.id} asset.method "${a.method}" is not one of ${VISUAL.method.join(', ')}`);
    if(typeof a.paid!=='boolean')fail(`Scene ${s.id} asset.paid must be true or false`);else if(a.paid)metrics.paidAssets.push(s.id);
    if(a.status!==undefined&&!VISUAL.status.includes(a.status))fail(`Scene ${s.id} asset.status "${a.status}" is not planned or ready`);}
  }
  if(['generated-video','generated-image','ui-mock'].includes(b)&&e==='authentic')fail(`Scene ${s.id} is ${b} and cannot be authentic evidence`);
  if(e==='authentic'&&/^generated$/i.test(String(a?.source??'').trim()))fail(`Scene ${s.id} is authentic but its source is "generated"`);
  for(const id of Array.isArray(s.motifs)?s.motifs:[])if(motifRef(s,id,'motifs')){const r=range(id);if(r&&!(r[0]<s.end&&r[1]>s.start))fail(`Scene ${s.id} uses motif ${id} outside its activeRange`);}
  // Planned callbacks: consistency only. Nothing here proves a transition renders (Phase 2).
  for(const c of Array.isArray(s.carryOut)?s.carryOut:[]){
   const t=byId.get(c?.to);if(!t){fail(`Scene ${s.id} carryOut targets unknown scene ${c?.to}`);continue;}
   if(t===s){fail(`Scene ${s.id} carryOut targets itself`);continue;}
   if(t.start<s.end-eps)fail(`Scene ${s.id} carryOut to ${t.id} goes backwards in time`);
   if(!motifRef(s,c.motif,'carryOut'))continue;
   if(!(t.carryIn||[]).some(i=>i.from===s.id&&i.motif===c.motif&&(i.element??null)===(c.element??null)))fail(`Scene ${s.id} carryOut ${c.motif} to ${t.id} has no matching carryIn on ${t.id}`);
   const r=range(c.motif);if(r&&!(r[0]<=s.end+eps&&r[1]>=t.start-eps))fail(`Motif ${c.motif} activeRange does not span the handoff ${s.id} -> ${t.id}`);
   metrics.callbacks.push({from:s.id,to:t.id,motif:c.motif,element:c.element??null,adjacent:Math.abs(t.start-s.end)<=eps});
   if(c.element)metrics.elements.push(c.element);}
  for(const c of Array.isArray(s.carryIn)?s.carryIn:[]){
   const f=byId.get(c?.from);if(!f){fail(`Scene ${s.id} carryIn names unknown scene ${c?.from}`);continue;}
   if(!motifRef(s,c.motif,'carryIn'))continue;
   if(!(f.carryOut||[]).some(o=>o.to===s.id&&o.motif===c.motif&&(o.element??null)===(c.element??null)))fail(`Scene ${s.id} carryIn ${c.motif} from ${f.id} has no matching carryOut on ${f.id}`);}
  // Production: the planned asset now exists in the project and matches its recorded hash.
  if(stage==='production'&&FILED.has(b)){
   const file=String(a?.file??'').replaceAll('\\','/');
   if(a?.status!=='ready')fail(`Scene ${s.id} asset.status is ${a?.status??'missing'}; production needs ready`);
   if(!file||path.isAbsolute(file)||file.split('/').includes('..'))fail(`Scene ${s.id} asset.file must be a path inside the project`);
   else if(!exists(file))fail(`Scene ${s.id} asset.file ${file} does not exist`);
   else if(!/^[a-f0-9]{64}$/.test(a?.sha256||''))fail(`Scene ${s.id} asset.sha256 is missing`);
   else if(hash&&hash(file)!==a.sha256)fail(`Scene ${s.id} asset hash mismatch for ${file}`);}
 }
 if(stage!=='preflight'&&stage!=='production')fail(`Unknown stage ${stage}`);
 return {ok:!errors.length,errors,warnings,metrics};
}
export function validatePlan(plan,transcript,edl,exists=()=>true,hash=null){
 const errors=[],fail=m=>errors.push(m),fps=plan.fps,tol=1/fps+.005;
 if(!Number.isFinite(fps)||fps<=0)fail('Invalid fps');
 if(!plan.scenes?.length)fail('No scenes');
 const words=transcript.words.filter(w=>w.type!=='spacing');
 const caps=(plan.captions||[]).flatMap(g=>g.words);
 if(caps.length!==words.length)fail(`Caption word count ${caps.length} != retained word count ${words.length}`);
 words.forEach((w,i)=>{
  const cap=caps[i];if(!cap||cap.text!==w.text)fail(`Caption ${i} missing or different`);
  else if(Math.abs(cap.start-w.start)>.005||Math.abs(cap.end-w.end)>.005)fail(`Caption ${i} timing differs from transcript`);
  if(w.end<=w.start||w.start<0||w.end>plan.duration+tol)fail(`Word ${i} outside timeline`);
  const k=edl.keeps.find(k=>w.sourceStart>=k.sourceStart-.016&&w.sourceEnd<=k.sourceEnd+.016);
  if(!k)fail(`Word ${i} crosses a cut or has no source range`);
  else if(Math.abs(w.start-(k.start+w.sourceStart-k.sourceStart))>.006)fail(`Word ${i} source mapping incorrect`);
 });
 let end=0;const ids=new Set();for(const s of plan.scenes||[]){
  if(ids.has(s.id))fail(`Duplicate scene ${s.id}`);ids.add(s.id);
  if(Math.abs(s.start-end)>.005)fail(`Scene gap or overlap at ${s.id}`);
  if(s.end<=s.start)fail(`Scene ${s.id} has no duration`);
  if(Math.abs(s.start*fps-Math.round(s.start*fps))>.01)fail(`Scene ${s.id} is not frame aligned`);
  if(!s.anchor||!Number.isFinite(s.anchorTime))fail(`Scene ${s.id} has no verified anchor`);
  else if(s.anchorTime-s.start<-.15||s.anchorTime-s.start>.2)fail(`Scene ${s.id} anchor not close to cut`);
  if(s.layout.includes('broll')&&!exists('assets/'+s.kind+'.mp4'))fail(`Missing moving B-roll ${s.kind}`);
  end=s.end;
 }
 if(Math.abs(end-plan.duration)>.005)fail('Scene coverage differs from duration');
 const times=[0,...(plan.events||[]).map(e=>e.time),plan.duration].sort((a,b)=>a-b);let maxGap=0;
 for(let i=1;i<times.length;i++){const gap=times[i]-times[i-1];maxGap=Math.max(maxGap,gap);if(gap>2.2){const s=plan.scenes.find(s=>times[i-1]>=s.start&&times[i-1]<s.end);if(!s?.holdReason)fail(`Unexplained visual-event gap ${gap.toFixed(2)}s at ${times[i-1].toFixed(2)}`);}}
 for(const e of plan.events||[])if(!ids.has(e.visual)||e.time<0||e.time>=plan.duration)fail('Invalid visual event '+JSON.stringify(e));
 for(let i=0;i<(plan.captions||[]).length;i++){const g=plan.captions[i];if(g.start>g.words[0].start+.005||g.end<g.words.at(-1).end-.005)fail('Caption group truncates word '+i);if(i&&g.start<plan.captions[i-1].end-.005)fail('Caption groups overlap '+i);}
 const metrics={duration:plan.duration,retainedWords:words.length,scenes:plan.scenes.length,averageShotSeconds:plan.duration/plan.scenes.length,visualEvents:plan.events.length,maxEventGap:maxGap,speakerShare:plan.scenes.filter(s=>['face','split','broll-split'].includes(s.layout)).reduce((a,s)=>a+s.end-s.start,0)/plan.duration};
 // Legacy plans (no schemaVersion) return exactly the fields they always did.
 if(!(plan.schemaVersion>=2))return {ok:!errors.length,errors,metrics};
 const v=validateVisualPlan(plan,{stage:'production',exists,hash});errors.push(...v.errors);
 return {ok:!errors.length,errors,warnings:v.warnings,metrics:{...metrics,visual:v.metrics}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(import.meta.filename)){
 const root=path.resolve(process.argv[2]||'.');const read=n=>JSON.parse(fs.readFileSync(path.join(root,'assets',n)));
 const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex');
 const result=validatePlan(read('plan.json'),read('transcript.json'),read('edit-decisions.json'),p=>fs.existsSync(path.join(root,p)),hash);
 console.log(JSON.stringify(result,null,2));process.exitCode=result.ok?0:1;
}
