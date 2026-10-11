const panelRuntimeVersion=chrome.runtime.getManifest().version;
const panelDocumentVersion=document.documentElement.dataset.buildVersion||null;
if(panelDocumentVersion && panelDocumentVersion!==panelRuntimeVersion) {
  const target=chrome.runtime.getURL('observer.html')+'?v='+encodeURIComponent(panelRuntimeVersion);
  if(location.href!==target) location.replace(target);
}

const $=id=>document.getElementById(id);
const must=id=>{const element=$(id);if(!element) throw new Error('Missing required Observer element #'+id);return element;};
const send=m=>chrome.runtime.sendMessage(m);
let follow=true;
let renderedKeys=null;
let lastState=null;
let browserLocalChatActivity=null;
let currentBrowserConversationId=null;
let pendingActionApprovalCount=0;
let timelineScope='all';
let timelineView='raw';
const DENSITIES=new Set(['compact','normal','forensic']);
let observerDensity='normal';
try { const stored=localStorage.getItem('edh.observer.density'); if(DENSITIES.has(stored)) observerDensity=stored; } catch {}
document.body.dataset.density=observerDensity;
let focusedSpanId=null;
let timelineRawJson='';
let timelineRawReturnFocus=null;
let transientTimelineScope=null;
let projectTaskSnapshot=null;
let latestRdcIntent=null;
let selectedActor=null;
let currentConversationBinding=null;
let knownConversationBindings=[];
let timelineScopeOptionsFingerprint='';
let timelineConversationIds=new Set();
const expandedKeys=new Set();
const rawRevealKeys=new Set();

function eventKey(event) { const c=event.correlation||{}; return [event.ts||0,event.source||'',event.message||'',c.correlation_id||'',c.span_id||'',c.conversation_id||'',c.turn_id||'',c.source_quality||'',event.attribution||''].join('|'); }

function boundedChatTitle(value,max=96) {
  const clean=String(value||'').replace(/\s+/g,' ').trim();
  if(!clean) return '';
  return clean.length>max ? clean.slice(0,max-1)+'…' : clean;
}
function meaningfulTimelineConversationIds(events=[]) {
  const ids=new Set();
  for(const event of events) {
    const id=timelineConversationId(event);
    if(!id) continue;
    const source=String(event?.source||'');
    const message=String(event?.message||'');
    if(source==='CHAT' && /^OBSERVED\b/.test(message)) continue;
    ids.add(id);
  }
  return ids;
}
function scopeOptionModel(bindings) {
  const byId=new Map();
  for(const binding of bindings||[]) {
    if(binding?.conversation_id && !byId.has(binding.conversation_id)) byId.set(binding.conversation_id,binding);
  }
  const model=[
    {value:'all',label:'All activity'},
    {value:'unscoped',label:'Unscoped'}
  ];
  if(transientTimelineScope && !model.some(item=>item.value===transientTimelineScope.value)) model.push(transientTimelineScope);
  for(const [id,binding] of byId) {
    if(!binding.is_current && !timelineConversationIds.has(id)) continue;
    const title=boundedChatTitle(binding.title);
    model.push({
      value:'chat:'+id,
      label:(binding.is_current?'Current · ':'')+(title||'ChatGPT chat')+' · '+String(id).slice(-8),
      binding
    });
  }
  return {model,byId};
}

function reconcileTimelineScopeOptions(list, model) {
  const fingerprint=JSON.stringify(model.map(x=>[x.value,x.label]));
  if(fingerprint!==timelineScopeOptionsFingerprint) {
    const existing=new Map([...list.querySelectorAll('.timeline-scope-option')].map(option=>[option.dataset.value,option]));
    const ordered=[];
    for(const item of model) {
      let option=existing.get(item.value);
      if(!option) {
        option=document.createElement('button');
        option.type='button';
        option.className='timeline-scope-option';
        option.setAttribute('role','option');
        option.dataset.value=item.value;
      }
      if(option.textContent!==item.label) option.textContent=item.label;
      ordered.push(option);
      existing.delete(item.value);
    }
    for(const option of existing.values()) option.remove();
    for(let index=0;index<ordered.length;index++) {
      const option=ordered[index];
      if(list.children[index]!==option) list.insertBefore(option,list.children[index]||null);
    }
    timelineScopeOptionsFingerprint=fingerprint;
  }
  for(const option of list.querySelectorAll('.timeline-scope-option')) {
    option.setAttribute('aria-selected',String(option.dataset.value===timelineScope));
    option.tabIndex=option.dataset.value===timelineScope?0:-1;
  }
}

function setTimelineScopeOpen(open,{focusSelected=true}={}) {
  const trigger=$('timeline-scope-trigger'), list=$('timeline-scope-list');
  if(!trigger||!list) return;
  trigger.setAttribute('aria-expanded',String(open));
  list.hidden=!open;
  if(open && focusSelected) {
    const selected=list.querySelector('.timeline-scope-option[aria-selected="true"]')||list.querySelector('.timeline-scope-option');
    selected?.focus();
  }
}

function applyTimelineScope(value,{close=true,focusTrigger=true}={}) {
  const {model,byId}=scopeOptionModel(knownConversationBindings);
  const valid=new Set(model.map(item=>item.value));
  const wanted=valid.has(value)?value:'all';
  timelineScope=wanted;
  if(transientTimelineScope && timelineScope!==transientTimelineScope.value) transientTimelineScope=null;
  currentConversationBinding=timelineScope.startsWith('chat:') ? byId.get(timelineScope.slice(5))||null : null;
  renderedKeys=null;
  renderTimelineScopeOptions();
  if(close) setTimelineScopeOpen(false,{focusSelected:false});
  if(focusTrigger) $('timeline-scope-trigger')?.focus();
  if(lastState) renderTimeline(lastState);
}

function renderTimelineScopeOptions() {
  const list=$('timeline-scope-list'), label=$('timeline-scope-label'), trigger=$('timeline-scope-trigger');
  if(!list||!label||!trigger) return;
  const previous=timelineScope;
  const {model,byId}=scopeOptionModel(knownConversationBindings);
  const valid=new Set(model.map(item=>item.value));
  const wanted=valid.has(previous)?previous:'all';
  timelineScope=wanted;
  currentConversationBinding=timelineScope.startsWith('chat:') ? byId.get(timelineScope.slice(5))||null : null;
  reconcileTimelineScopeOptions(list,model);
  const selected=model.find(item=>item.value===timelineScope)||model[0];
  label.textContent=selected?.label||'All activity';
  trigger.title=selected?.label||'Timeline scope';
}

function moveTimelineScopeFocus(direction) {
  const list=$('timeline-scope-list');
  if(!list) return;
  const options=[...list.querySelectorAll('.timeline-scope-option')];
  if(!options.length) return;
  let index=options.indexOf(document.activeElement);
  if(direction==='home') index=0;
  else if(direction==='end') index=options.length-1;
  else if(direction>0) index=index<0?0:(index+1)%options.length;
  else index=index<0?options.length-1:(index-1+options.length)%options.length;
  options[index].focus();
}

function compactMessage(message) {
  return String(message||'')
    .replaceAll('/Users/dzzk/WORK/_bridge-local-execution/','…/harness/')
    .replaceAll('/Users/dzzk/WORK/browser-bridge-runs/','…/runs/')
    .replaceAll('/Users/dzzk/','~/');
}
function timelineTimestamp(ts) {
  const d=new Date(Number(ts||0)*1000);
  if(Number.isNaN(d.getTime())) return '---- -- -- --:--:--';
  const pad=value=>String(value).padStart(2,'0');
  return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+' '+pad(d.getHours())+':'+pad(d.getMinutes())+':'+pad(d.getSeconds());
}
function timelineDay(ts) {
  return timelineTimestamp(ts).slice(0,10);
}
function timelineClock(ts) {
  return timelineTimestamp(ts).slice(11);
}
function timelineTimestampTitle(ts) {
  const d=new Date(Number(ts||0)*1000);
  if(Number.isNaN(d.getTime())) return timelineTimestamp(ts);
  const offset=-d.getTimezoneOffset();
  const sign=offset>=0?'+':'-';
  const abs=Math.abs(offset);
  const zone='UTC'+sign+String(Math.floor(abs/60)).padStart(2,'0')+':'+String(abs%60).padStart(2,'0');
  return timelineTimestamp(ts)+' '+zone;
}
function seconds(n) {
  n=Math.max(0,Number(n)||0);
  if(n<60) return String(Math.floor(n))+'s';
  const m=Math.floor(n/60), s=Math.floor(n%60);
  if(m<60) return m+':'+String(s).padStart(2,'0');
  const h=Math.floor(m/60);
  return h+':'+String(m%60).padStart(2,'0')+':'+String(s).padStart(2,'0');
}
function openSpans(state) {
  return (state.spans||[]).filter(s=>!['DONE','ERROR','CANCELED','EXITED'].includes(s.status));
}
function activeSpans(state) {
  return (state.spans||[]).filter(s=>s.status==='RUNNING');
}
function recentSpans(state) {
  const all=state.spans||[];
  const now=Date.now()/1000;
  const currentTask=state.task_lifecycle?.task_id||null;
  const currentRun=state.task_lifecycle?.run_id||null;
  const currentChat=currentBrowserConversationId||null;
  const open=openSpans(state).filter(s=>{
    if(s.status!=='WAITING') return true;
    const age=now-(s.updated||s.started||now);
    return !(s.actor==='TERM' && age>30);
  });
  const terminal=all.filter(s=>{
    if(!['DONE','ERROR','CANCELED','EXITED'].includes(String(s.status||'').toUpperCase())) return false;
    const c=s.correlation||{};
    if(currentTask && c.task_id===currentTask) return true;
    if(currentRun && c.run_id===currentRun) return true;
    if(currentChat && c.conversation_id===currentChat) return true;
    const age=now-Number(s.updated||s.ended||s.started||0);
    return Number.isFinite(age) && age>=0 && age<=180;
  }).slice(-8);
  const seen=new Set();
  return [...open,...terminal].filter(s=>!seen.has(s.id)&&seen.add(s.id)).sort((a,b)=>(b.started||0)-(a.started||0));
}
function detachedRunHealth(state) {
  const run=state.detached_run;
  if(!run) return null;
  const heartbeat=Date.parse(run.heartbeat_at||run.started_at||'')/1000;
  const age=Number.isFinite(heartbeat)?Math.max(0,Date.now()/1000-heartbeat):null;
  return {...run,heartbeat_age_seconds:age};
}
function derivedStatus(state) {
  const detached=detachedRunHealth(state);
  const detachedStatus=String(detached?.status||'').toUpperCase();
  if(['STARTING','RUNNING'].includes(detachedStatus)) {
    if(detached.heartbeat_age_seconds!=null && detached.heartbeat_age_seconds>8) return {label:'STALLED',cls:'stalled',age:detached.heartbeat_age_seconds};
    return {label:'BUSY',cls:'busy',age:detached.heartbeat_age_seconds};
  }
  const task=state.task_lifecycle||{};
  const taskStatus=String(task.status||'').toUpperCase();
  if(taskStatus==='RUNNING') {
    const waiting=Boolean(task.waiting_reason)||String(task.phase||'').toUpperCase().includes('WAIT');
    return {label:waiting?'WAITING':'BUSY',cls:waiting?'waiting':'busy',age:null};
  }
  if(taskStatus==='WAITING') return {label:'WAITING',cls:'waiting',age:null};
  const active=activeSpans(state);
  const stalled=String(state.state||'').startsWith('STALLED');
  if(stalled) return {label:'STALLED',cls:'stalled',age:null};
  if(active.length) {
    const running=active[0];
    return {label:'BUSY',cls:'busy',age:running.age_seconds||0};
  }
  const external=currentExternalActivity(state);
  const externalAge=external?.ts ? Math.max(0,Date.now()/1000-Number(external.ts)) : null;
  if(external && externalAge!=null && externalAge<=10) return {label:'OBSERVED',cls:'observed',age:externalAge};
  if(state.rdc?.last_activity_seconds!=null && state.rdc.last_activity_seconds<=10) return {label:'OBSERVED',cls:'observed',age:state.rdc.last_activity_seconds};
  return {label:'EXEC IDLE',cls:'idle',age:null};
}
// Header status reports observed execution, not the browser turn lifecycle.
// A ChatGPT turn can remain active while no executor activity is visible.
function executionStatusExplanation(status) {
  const details={
    'EXEC IDLE':'No currently observed executor activity. ChatGPT may still be responding; check CHAT and timeline WORKING/SETTLING for turn state.',
    OBSERVED:'Recent external activity was detected. This does not establish Harness ownership, task admission, or an executing tool.',
    BUSY:'An active execution span, Harness run, or task lifecycle is observed.',
    WAITING:'An admitted task or Harness execution is waiting.',
    STALLED:'An observed execution appears stalled or its heartbeat is stale.'
  };
  return details[status.label]||'Observed executor state; not an authoritative ChatGPT turn-completion signal.';
}
function activeChain(state) {
  const detached=detachedRunHealth(state);
  if(detached && ['STARTING','RUNNING'].includes(String(detached.status||'').toUpperCase())) {
    return 'HARNESS '+String(detached.phase||detached.status||'RUNNING')+' · detached';
  }
  const active=activeSpans(state);
  if(active.length) {
    return active.slice(-3).map(s=>(s.actor||'?')+(s.pid?' #'+s.pid:'')).join(' › ');
  }
  if(state.active_source) return state.active_source;
  const external=currentExternalActivity(state);
  const externalAge=external?.ts ? Math.max(0,Date.now()/1000-Number(external.ts)) : null;
  if(external && externalAge!=null && externalAge<=10) return 'external MCP/RDC activity · unscoped';
  const open=state.rdc?.open_count||0;
  return open ? (open+' background open · gateway partial visibility') : 'no local work · gateway partial visibility';
}

// A Git snapshot is interactive: preserve it across the 1.5s Observer refresh
// and allow the pointer to cross the chip-to-popover gap without collapsing it.
let gitHoverExitTimer=null;
// Position a flyout by its own trigger, clamped to the Side Panel viewport.
// Do not anchor every flyout to the far right edge of its parent row.
function alignPopoverToTrigger(popover,trigger,container) {
  if(!popover || !trigger || !container) return;
  const bounds=container.getBoundingClientRect();
  const anchor=trigger.getBoundingClientRect();
  const width=popover.getBoundingClientRect().width;
  const free=Math.max(0,bounds.width-width);
  const margin=Math.min(4,free/2);
  const left=Math.max(margin,Math.min(anchor.left-bounds.left,free-margin));
  popover.style.left=left+'px';
  popover.style.right='auto';
}
function positionGitPopover() {
  const wrap=document.querySelector('.actor-strip-wrap');
  alignPopoverToTrigger($('git-popover'),$('actor-strip')?.querySelector('.actor-chip.git'),wrap);
}
function gitPopoverHover(inside) {
  clearTimeout(gitHoverExitTimer);
  const wrap=document.querySelector('.actor-strip-wrap');
  if(!wrap) return;
  if(inside) { positionGitPopover(); if(!wrap.classList.contains('git-popover-dismissed')) wrap.classList.add('git-popover-hovered'); }
  else gitHoverExitTimer=setTimeout(()=>wrap.classList.remove('git-popover-hovered'),350);
}
function setGitPopoverPinned(open) {
  const wrap=document.querySelector('.actor-strip-wrap');
  if(!wrap) return;
  wrap.classList.toggle('git-popover-pinned',open);
  if(open) { positionGitPopover(); wrap.classList.remove('git-popover-dismissed'); }
  const chip=$('actor-strip')?.querySelector('.actor-chip.git');
  if(chip) chip.setAttribute('aria-expanded',String(open));
}

function renderActors(state,companionAvailable=true) {
  const activity=state.actor_activity||{};
  const chatActivity=browserLocalChatActivity||state.chat_activity||null;
  const rdcAge=state.rdc?.last_activity_seconds;
  const rdcRecent=Number.isFinite(rdcAge) && rdcAge<=30;
  const liveTerm=liveSessionForActor(state,'TERM');
  const liveTermRunning=isFreshManagedSession(liveTerm);
  const defs=[
    ['CHAT',chatActivity?.state==='waiting_user'?'waiting':chatActivity?.state==='pending'?'pending':chatActivity?.state==='active'?'active':'','ChatGPT browser turn','browser conversation / turn context',chatActivity?.state?('state '+chatActivity.state):null],
    ['MCP','','Observed MCP transport activity','transport boundary; only instrumented providers are visible',null],
    ['RDC',rdcRecent?seconds(rdcAge):'','Remote Desktop Commander','provider / tool family',Number.isFinite(rdcAge)?('last observed '+seconds(rdcAge)+' ago'):null],
    ['TERM',liveTermRunning?'LIVE':'','Terminal / managed process lifecycle','local managed sessions only',liveTermRunning?('session '+liveTerm.session_id):'no active managed TERM session; RDC process count is separate'],
    ['OC','','OpenCode worker','local executor',null],
    ['QWEN','','Qwen model actor','local model',null],
    ['LLAMA',String(state.llama||'').replace(/^slot\d+:/,''),'llama.cpp inference runtime','local inference runtime',null],
    ['GIT','Δ'+String(state.git_total??0),'Git repository working-tree state','repository state',null]
  ];
  const frag=document.createDocumentFragment();
  for(const [name,detail,fullName,origin,diagnostic] of defs) {
    const isBrowserActor=name==='CHAT';
    const unavailable=!isBrowserActor && !companionAvailable;
    const isActive=isBrowserActor ? chatActivity?.state==='active' : activity[name]===true;
    const isWaiting=isBrowserActor && chatActivity?.state==='waiting_user';
    const isPending=isBrowserActor && chatActivity?.state==='pending';
    const chip=document.createElement('button');
    chip.type='button';
    chip.className='actor-chip '+name.toLowerCase()+(isActive?' active':'')+(isWaiting?' waiting':'')+(isPending?' pending':'')+(unavailable?' unavailable':'');
    chip.setAttribute('aria-label','Open '+name+' execution evidence');
    if(name==='GIT') {
      chip.setAttribute('aria-haspopup','true');
      chip.setAttribute('aria-controls','git-popover');
      chip.setAttribute('aria-expanded',String(document.querySelector('.actor-strip-wrap')?.classList.contains('git-popover-pinned')||false));
      chip.addEventListener('pointerenter',()=>{document.querySelector('.actor-strip-wrap')?.classList.remove('git-popover-dismissed');gitPopoverHover(true);});
      chip.addEventListener('pointerleave',()=>gitPopoverHover(false));
      chip.addEventListener('click',()=>{document.querySelector('.actor-strip-wrap')?.classList.remove('git-popover-dismissed');setGitPopoverPinned(!document.querySelector('.actor-strip-wrap')?.classList.contains('git-popover-pinned'));});
    } else chip.addEventListener('click',()=>openActorInspector(name));
    const titleParts=[];
    if(origin) titleParts.push(origin);
    if(detail) titleParts.push(detail);
    if(diagnostic) titleParts.push(diagnostic);
    if(unavailable) titleParts.push('telemetry unavailable');
    else if(isActive) titleParts.push(name==='CHAT'?'positive browser activity evidence':'recently observed activity');
    else if(isWaiting) titleParts.push('turn open · waiting for user input');
    else if(isPending) titleParts.push('turn open · no positive activity evidence');
    else titleParts.push('known idle');
    if(name==='GIT') {
      chip.setAttribute('aria-describedby','git-popover-description');
      // The selectable Git popover replaces the native browser title tooltip.
    } else chip.title=titleParts.join(' · ');
    const dot=document.createElement('span'); dot.className='dot';
    const label=document.createElement('span'); label.textContent=name;
    chip.append(dot,label);
    if(detail){const d=document.createElement('span');d.className='detail';d.textContent=detail;chip.append(d);}
    frag.append(chip);
  }
  $('actor-strip').replaceChildren(frag);
  renderGitPopover(state);
  positionGitPopover();
}
function renderGitPopover(state) {
  const paths=Array.isArray(state?.git)?state.git.map(String):[];
  const total=Number(state?.git_total??paths.length);
  const description=$('git-popover-description');
  description.textContent=total+' changed/untracked path(s) · git status --short · repository snapshot, not an activity signal.';
  const details=$('git-popover-paths');
  details.hidden=total===0;
  $('git-popover-paths-label').textContent='Changed paths ('+total+')';
  const list=$('git-popover-path-list');
  const signature=JSON.stringify([total,paths]);
  if(list.dataset.signature===signature) return;
  const fragment=document.createDocumentFragment();
  for(const path of paths) {
    const li=document.createElement('li'); li.textContent=path; fragment.append(li);
  }
  if(!paths.length && total) {
    const li=document.createElement('li'); li.className='git-path-note'; li.textContent='Path details unavailable in current snapshot.'; fragment.append(li);
  }
  list.replaceChildren(fragment);
  list.dataset.signature=signature;
}
function actorTimelineText(state,name,limit=24) {
  const events=(state?.timeline||[]).filter(event=>String(event.source||'')===name).slice(-limit);
  return events.map(event=>{
    const at=Number(event.ts);
    const stamp=Number.isFinite(at)?timelineTimestamp(at):'---- -- -- --:--:--';
    return stamp+' '+name+' '+String(event.message||'');
  }).join('\n');
}
function qwenTextTail(raw) {
  const out=[];
  for(const line of String(raw||'').split('\n')) {
    if(!line.trim().startsWith('{')) continue;
    try {
      const event=JSON.parse(line);
      if(event.type==='text' && event.part?.text) out.push(String(event.part.text));
    } catch {}
  }
  return out.join('\n').slice(-12000);
}
function isFreshManagedSession(session) {
  if(!session || !['STARTING','RUNNING'].includes(String(session.status||'').toUpperCase())) return false;
  const age=Number(session.heartbeat_age_seconds);
  return Number.isFinite(age) && age>=0 && age<=8;
}
function liveSessionForActor(state,name) {
  const sessions=(state?.live_sessions||[]).filter(session=>String(session.actor||'').toUpperCase()===name);
  return sessions.find(isFreshManagedSession)||sessions[0]||null;
}
function isTermProbe(session) {
  return Boolean(session && (/^p0-live-term-acceptance$/.test(String(session.session_id||'')) || /^(?:TERM-LIVE\s+\d+\s+\d{2}:\d{2}:\d{2}\s*)+$/m.test(String(session.console_tail||'').trim())));
}
function liveSessionRows(session) {
  if(!session) return [];
  const live=isFreshManagedSession(session);
  const command=[session.program,...(session.argv||[])].filter(Boolean).join(' ');
  return [
    ['Session',session.session_id||'-','','Stable observable-session identity.'],
    ['View',live?'LIVE':'HISTORICAL',live?'live-evidence':'','LIVE requires a running managed session and a fresh producer heartbeat (8s maximum).'],
    ['Status',live?String(session.status||'?').toUpperCase():(['RUNNING','STARTING'].includes(String(session.status||'').toUpperCase())?'STALE · '+String(session.status).toUpperCase():String(session.status||'?').toUpperCase()),'','Recorded lifecycle state; a stale RUNNING record does not prove a live process.'],
    ['Evidence kind',isTermProbe(session)?'TEST PROBE':'PROCESS',isTermProbe(session)?'test-evidence':'','Synthetic heartbeat acceptance output is test telemetry, not agent task execution.'],
    ['Started',session.started_at||'-','','Timestamp recorded when the managed session started.'],
    ['Ended',session.ended_at||'-','','Recorded completion time; absent for unclosed or stale sessions.'],
    ['Exit code',session.exit_code==null?'not reported':String(session.exit_code),'','Process exit code, if the wrapper captured it.'],
    ['Signal',session.signal||'-','','Termination signal, when recorded.'],
    ['Error',session.error||'-','','Recorded wrapper or process failure, if any.'],
    ['Transport',session.transport||'-','','Execution transport that launched the observable session.'],
    ['PID',session.pid==null?'-':String(session.pid),'','Child operating-system process identifier.'],
    ['Command',command||'-','','Program and argv recorded by the observable session wrapper.'],
    ['Cwd',session.cwd||'-','','Process working directory.'],
    ['Last update',session.heartbeat_age_seconds==null?'-':seconds(session.heartbeat_age_seconds)+' ago'+(live?' · live':' · historical/stale'),'','Age of the last state update; an old timestamp is not an active heartbeat.'],
    ['Output',String(Number(session.stdout_bytes||0)+Number(session.stderr_bytes||0))+' bytes','','Console bytes observed so far.'],
    ['Run',session.run_id||'-','','Optional owning Harness run identity.'],
    ['Task',session.task_id||'-','','Optional owning Harness task identity.']
  ];
}

function actorInspectionModel(state,name) {
  const inspection=state?.run_inspection||{};
  const local=state?.local_executor||{};
  const session=liveSessionForActor(state,name);
  const spans=recentSpans(state||{}).filter(span=>String(span.actor||'')===name);
  if(name==='GIT') {
    const paths=Array.isArray(state?.git)?state.git.map(String):[];
    return {rows:[
      ['Actor','GIT','','Repository working-tree snapshot; not an execution activity event.'],
      ['Changed / untracked',String(state?.git_total??paths.length),'','Number of changed/untracked paths from git status --short, not commits.'],
      ['Source','git status --short','','Repository status as observed by the local Observer.'],
      ['Paths',paths.length?paths.join('\n'):'None available','','Exact source status prefixes and paths, where available.']
    ],raw:paths.length?paths.join('\n'):'No path details in current snapshot.'};
  }
  if(name==='MCP') {
    const source=state?.mcp_console||{events:[],raw_tail:'',active:0};
    const latest=(source.events||[]).slice(-1)[0]||null;
    return {
      rows:[
        ['Actor','MCP','','Live MCP transport evidence stream.'],
        ['View','LIVE','','Source is the append-only MCP observer event stream, refreshed with the dashboard snapshot.'],
        ['Active spans',String(source.active||0),'','Currently open MCP tool spans derived from START without terminal DONE/ERROR.'],
        ['Last event',latest?.event||'-','','Latest MCP lifecycle event.'],
        ['Tool',latest?.meta?.tool||'-','','Latest observed MCP tool name.'],
        ['Correlation',latest?.correlation_id||'-','','Causal correlation identity.'],
        ['Run',latest?.run_id||'-','','Owning MCP run identity.'],
        ['Span',latest?.span_id||'-','','MCP tool span identity.'],
        ['Client',latest?.source?.client||'-','','Observed MCP client/source identity.'],
        ['Source quality',latest?.source?.source_quality||'-','','Transport/source evidence quality.']
      ],
      raw:source.raw_tail||actorTimelineText(state,name)||'No MCP source events captured yet.'
    };
  }
  if(name==='TERM') {
    const span=spans.find(item=>item.status==='RUNNING')||spans[0]||null;
    if(session) return {
      rows:[['Actor','TERM','','Managed process evidence, independent of RDC open process count.'],['Current session',isFreshManagedSession(session)?session.session_id:'NO ACTIVE SESSION','','Only a fresh running managed session is current.'],...liveSessionRows(session)],
      raw:session.console_tail||'Session is live; no console output has been emitted yet.'
    };
    return {
      rows:[
        ['Actor','TERM','','Historical process evidence observed through transport history.'],
        ['View','HISTORICAL','','No current observable TERM session; showing retained process evidence.'],
        ['Status',span?.status||'IDLE','','Latest bounded process lifecycle status.'],
        ['PID',span?.pid==null?'-':String(span.pid),'','Operating-system process identifier when captured.'],
        ['Command',span?.command||span?.label||'-','','Command captured at process start.'],
        ['Cwd',span?.cwd||'-','','Explicit process working directory when supplied by the transport.'],
        ['Elapsed',span?seconds(span.age_seconds||0):'-','','Observed process lifetime.'],
        ['Detail',span?.detail||'-','','Latest process lifecycle evidence.']
      ],
      raw:span?.output_tail||actorTimelineText(state,name)||'No TERM output evidence captured yet.'
    };
  }
  if(name==='OC') {
    const argv=Array.isArray(inspection.command_argv)?inspection.command_argv.join(' '):'-';
    return {
      rows:[
        ['Actor','OC','','OpenCode bounded worker evidence.'],...liveSessionRows(session),
        ['Status',String(inspection.status||local.status||'IDLE').toUpperCase(),'','Worker/run status from durable local evidence.'],
        ['Run',local.run_id||inspection.id||'-','','Harness/local worker run identity.'],
        ['OpenCode',inspection.opencode_version||local.opencode_version||'-','','Observed OpenCode runtime version.'],
        ['Step',local.step_count!=null?String(local.step_count)+' / '+String(local.max_steps??'?'):'-','','Current OpenCode step budget progress.'],
        ['Last tool',local.last_tool?local.last_tool+' · '+String(local.last_tool_status||'?'):'none','','Most recent OpenCode tool event.'],
        ['Command',argv||'-','','Actual bounded worker argv captured in command.json.'],
        ['Cwd',inspection.command_cwd||'-','','Worker process working directory.'],
        ['Run dir',inspection.run_dir||local.run_dir||'-','','Durable evidence directory.']
      ],
      raw:session?.console_tail||inspection.events_tail||actorTimelineText(state,name)||'No OpenCode console evidence captured yet.'
    };
  }
  if(name==='QWEN') {
    const usage=inspection.usage||{};
    const text=qwenTextTail(inspection.events_tail);
    return {
      rows:[
        ['Actor','QWEN','','Local model actor inside the bounded OpenCode worker.'],...liveSessionRows(session),
        ['Model',inspection.model||local.model||'-','','Observed model identity.'],
        ['Inference',local.model_busy?'ACTIVE':'IDLE','','Current model-slot attribution from local-agent.'],
        ['Model cycle',String(local.model_cycle??0),'','Number of observed Qwen inference cycles in this worker.'],
        ['Step',local.step_count!=null?String(local.step_count)+' / '+String(local.max_steps??'?'):'-','','OpenCode step budget around model/tool cycles.'],
        ['Output ceiling',inspection.tokens_per_turn!=null?String(inspection.tokens_per_turn)+' tokens':'-','','Declared per-turn output-token ceiling, not actual usage.'],
        ['Output usage',usageMetricText(usage.output_tokens),'','Reported/estimated provenance is preserved; never treated as billing truth.'],
        ['Run',local.run_id||inspection.id||'-','','Owning execution run.']
      ],
      raw:session?.console_tail||text||actorTimelineText(state,name)||inspection.events_tail||'No Qwen text evidence captured yet.'
    };
  }
  if(name==='LLAMA') {
    const llama=inspection.llama_progress||local.llama||{};
    const usage=inspection.usage||{};
    return {
      rows:[
        ['Actor','LLAMA','','llama.cpp local inference runtime evidence.'],...liveSessionRows(session),
        ['Runtime',state?.llama||'-','','Observed llama.cpp slot/runtime state.'],
        ['Model',inspection.model||local.model||'-','','Model bound to the current local worker.'],
        ['Inference',local.model_busy?'ACTIVE':'IDLE','','Whether local-agent currently attributes slot activity to this worker.'],
        ['Context',llama.n_ctx==null?'-':Number(llama.n_ctx).toLocaleString(),'','llama.cpp context capacity reported by the slot.'],
        ['Prompt',llama.prompt_tokens==null?'-':Number(llama.prompt_tokens).toLocaleString(),'','Prompt tokens reported by the active slot.'],
        ['Processed',llama.prompt_tokens_processed==null?'-':Number(llama.prompt_tokens_processed).toLocaleString(),'','Prompt tokens processed by the active slot.'],
        ['Cache',llama.prompt_tokens_cache==null?'-':Number(llama.prompt_tokens_cache).toLocaleString(),'','Prompt cache tokens reported by llama.cpp.'],
        ['Throughput',usageMetricText(usage.output_tokens_per_second,{unit:'tok/s',digits:2}),'','Reported or derived throughput with provenance.']
      ],
      raw:session?.console_tail||[JSON.stringify(llama,null,2),actorTimelineText(state,name)].filter(Boolean).join('\n\n')||'No llama.cpp evidence captured yet.'
    };
  }
  return {
    rows:[['Actor',name,'','Observed Harness actor/source.']],
    raw:actorTimelineText(state,name)||'No actor evidence captured yet.'
  };
}
// Human-readable projection only. Source bytes remain available below verbatim.
function actorEvidenceEntries(state,name,model) {
  if(name==='GIT') return []; // Status snapshot is not an activity event.
  if(name==='MCP') {
    const events=(state?.mcp_console?.events||[]).slice(-45).reverse();
    return events.map(item=>{
      const phase=String(item.event||'OBSERVED').toUpperCase();
      const tool=String(item.meta?.tool||'unknown tool');
      const message=String(item.message||'').trim();
      return {time:item.ts||'',label:tool,phase,detail:message,meta:[item.source?.client,item.source?.source_quality,item.correlation_id].filter(Boolean).join(' · '),raw:JSON.stringify(item,null,2)};
    });
  }
  if(name==='TERM') {
    const session=liveSessionForActor(state,name);
    if(session?.console_tail) {
      const lines=String(session.console_tail).split('\n').filter(Boolean).slice(-40).reverse();
      const probe=isTermProbe(session);
      if(probe) return [{time:'',label:'Heartbeat / console probe',phase:'TEST',detail:lines.length+' synthetic lines; first '+(lines.at(-1)||'-')+'; last '+(lines[0]||'-')+'. Not agent work.',meta:'session '+String(session.session_id||'-')+' · full source below',raw:String(session.console_tail)}];
      return lines.map(line=>({time:'',label:'Console output',phase:'OUTPUT',detail:line,meta:'session '+String(session.session_id||'-'),raw:line}));
    }
  }
  const events=(state?.timeline||[]).filter(event=>String(event.source||'')===name).slice(-45).reverse();
  return events.map(event=>{
    const message=String(event.message||'');
    const match=message.match(/^([A-Za-z_][\w-]*):\s*(.*)$/s);
    const action=match?match[1]:(message.split(/\s+/,1)[0]||'OBSERVED');
    const detail=match?match[2]:message;
    const phase=/\b(ERROR|FAILED|DENIED|EXITED)\b/i.test(message)?'OBSERVED ERROR':/\b(DONE|PASS)\b/i.test(message)?'OBSERVED DONE':'OBSERVED';
    return {time:timelineTimestampTitle(event.ts),label:action,phase,detail:compactMessage(detail),meta:'source '+name+' · observation, not task verification',raw:message};
  });
}
function renderActorEvidence(state,name,model) {
  const note=$('actor-evidence-note'),parent=$('actor-evidence-events');
  const entries=actorEvidenceEntries(state,name,model);
  const notes={GIT:'Working-tree snapshot is displayed above; ΔN does not imply N Git activity events.',RDC:'RDC transport operations. A recorded call does not prove task completion.',MCP:'MCP tool lifecycle from transport-observed events. START, DONE and ERROR are not Harness task verification.',TERM:'Process/console observations. Probe output is test telemetry, not agent work.'};
  note.textContent=notes[name]||'Observed source events. Use original evidence for exact bytes and provenance.';
  const fingerprint=JSON.stringify(entries.map(e=>[e.time,e.label,e.phase,e.detail,e.meta]));
  if(parent.dataset.fingerprint===fingerprint&&parent.dataset.actor===name) return;
  const previousOpen=new Set([...parent.querySelectorAll('details[open]')].map(el=>el.dataset.key));
  const wasAtTop=parent.scrollTop<12;
  const priorScroll=parent.scrollTop;
  const fragment=document.createDocumentFragment();
  if(!entries.length) {const empty=document.createElement('p');empty.textContent='No individual '+name+' events captured in this snapshot.';fragment.append(empty);}
  for(const [i,item] of entries.entries()) {
    const card=document.createElement('details');card.className='actor-evidence-event';card.dataset.key=[item.time,item.label,item.detail].join('|');card.setAttribute('role','listitem');
    const summary=document.createElement('summary');
    const phase=document.createElement('strong');phase.className='actor-event-phase';phase.textContent=item.phase;
    const label=document.createElement('span');label.className='actor-event-label';label.textContent=item.label;
    const time=document.createElement('time');time.className='actor-event-time';time.textContent=item.time?String(item.time).slice(11,19):'';time.title=item.time||'Timestamp not present in source';
    summary.append(phase,label,time);
    const detail=document.createElement('div');detail.className='actor-event-detail';detail.textContent=item.detail||'No message supplied';
    const meta=document.createElement('div');meta.className='actor-event-meta';meta.textContent=item.meta||'No additional provenance supplied';
    const raw=document.createElement('pre');raw.className='actor-event-source';raw.textContent=item.raw;
    card.append(summary,detail,meta,raw);
    if(previousOpen.has(card.dataset.key))card.open=true;
    fragment.append(card);
  }
  parent.replaceChildren(fragment);parent.dataset.fingerprint=fingerprint;parent.dataset.actor=name;
  if(!wasAtTop) parent.scrollTop=priorScroll;
}
function renderActorInspector(state,name) {
  const model=actorInspectionModel(state,name);
  $('actor-inspector-title').textContent=name;
  const parent=$('actor-inspector-summary');
  const old=parent.dataset.actor===name?Array.from(parent.querySelectorAll('.actor-field')):[];
  const same=old.length===model.rows.length&&old.every((node,i)=>node.dataset.field===model.rows[i][0]);
  if(!same) {
    const frag=document.createDocumentFragment();
    for(const [key] of model.rows) {
      const row=document.createElement('div'); row.className='actor-field'; row.dataset.field=key;
      const button=document.createElement('button'); button.type='button'; button.className='actor-field-label'; button.textContent=key;
      button.setAttribute('aria-expanded','false');
      const value=document.createElement('span'); value.className='value';
      const help=document.createElement('div'); help.className='actor-field-help'; help.hidden=true;
      button.addEventListener('click',()=>{
        help.hidden=!help.hidden;
        button.setAttribute('aria-expanded',String(!help.hidden));
      });
      row.append(button,value,help); frag.append(row);
    }
    parent.replaceChildren(frag); parent.dataset.actor=name;
  }
  const nodes=Array.from(parent.querySelectorAll('.actor-field'));
  model.rows.forEach(([key,value,cls,help],i)=>{
    const row=nodes[i],button=row.children[0],val=row.children[1],detail=row.children[2];
    const next=String(value??'-');
    if(val.textContent!==next) val.textContent=next;
    val.className='value'+(cls?' '+cls:'');
    button.title=help||'';
    button.setAttribute('aria-label',key+'. Click for explanation.');
    detail.textContent=help||'No additional description is available for this field.';
  });
  renderActorEvidence(state,name,model);
  const raw=$('actor-inspector-raw');
  if(raw.textContent!==model.raw) raw.textContent=model.raw;
}
function openActorInspector(name) {
  selectedActor=name;
  if(lastState) renderActorInspector(lastState,name);
  $('actor-inspector').hidden=false;
}

async function currentShareTarget() {
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  if(!tab?.id) throw new Error('No active browser tab.');
  let url=tab.url, title=tab.title||'';
  if(!url) {
    try {
      const result=await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>({url:location.href,title:document.title})});
      url=result[0]?.result?.url||'';
      title=result[0]?.result?.title||title;
    } catch {}
  }
  let parsed=null;
  try { parsed=new URL(url); } catch {}
  const shareable=Boolean(parsed&&['http:','https:'].includes(parsed.protocol)&&!tab.incognito&&tab.status!=='loading');
  return {tabId:tab.id,url,title,host:parsed?.hostname||'',shareable};
}
function renderShareTarget(target) {
  const box=$('share-target');
  box.replaceChildren();
  const label=document.createElement('strong');
  label.textContent=target.shareable ? 'Current target' : 'Current target unavailable';
  const detail=document.createElement('span');
  detail.textContent=target.shareable ? ((target.title||'(untitled)')+'\\n'+target.host+'\\n'+target.url) : 'Activate a fully loaded HTTP(S) page and reopen or refresh Bridge controls.';
  box.append(label,detail);
  $('share-current').disabled=!target.shareable;
  $('share-current').textContent=target.shareable ? ('Share '+target.host+' for 30 minutes') : 'Share current tab for 30 minutes';
}
function settingsCard(parent,text,buttons) {
  const div=document.createElement('div'); div.className='card';
  const p=document.createElement('p'); p.textContent=text; div.append(p);
  for(const [label,fn] of buttons){const b=document.createElement('button');b.textContent=label;b.addEventListener('click',fn);div.append(b);}
  parent.append(div);
}
function renderExecutorPolicy(policy,preparedReady=false) {
  const select=$('executor-policy-select');
  const status=$('executor-policy-status');
  const compare=$('create-compare-plan');
  if(!policy) {
    status.textContent='executor policy unavailable';
    compare.hidden=true; compare.disabled=true;
    return;
  }
  select.value=policy.mode||'AUTO';
  status.textContent=(policy.mode||'AUTO')+' · dispatch policy'+(policy.updated_at?' · updated '+new Date(policy.updated_at).toLocaleString():'');
  compare.hidden=!preparedReady || policy.mode!=='COMPARE';
  compare.disabled=!preparedReady || policy.mode!=='COMPARE';
}

function renderProjectTasks(snapshot) {
  const select=$('project-task-select');
  const recommendation=$('project-task-recommendation');
  const description=$('project-task-description');
  const status=$('project-task-admission-status');
  const takeNext=$('take-next-task');
  const takeSelected=$('take-selected-task');
  const prepare=$('prepare-current-task');
  const release=$('release-current-task');
  if(!snapshot) {
    projectTaskSnapshot=null;
    if(select.options.length) select.replaceChildren(); select.disabled=true;
    description.textContent='No backlog task details available.';
    takeNext.disabled=true; takeSelected.disabled=true; prepare.disabled=true; release.disabled=true;
    recommendation.textContent='Backlog admission unavailable';
    status.textContent='No canonical project task state available.';
    return;
  }
  projectTaskSnapshot=snapshot;
  const previous=select.value;
  const options=(snapshot.tasks||[]).map(task=>({
    id:task.id,
    label:(task.priority==='release_critical'?'▶ ':'')+(task.milestone_supporting?'★ ':'')+task.id+' · '+task.percent+'% · '+task.title
  }));
  // Keep the native select/options alive during polling: otherwise an open
  // dropdown closes and the owner's selection/focus is lost every second.
  const signature=JSON.stringify(options);
  if(select.dataset.optionsSignature!==signature) {
    const existing=new Map([...select.options].map(option=>[option.value,option]));
    const ordered=options.map(item=>{
      const option=existing.get(item.id)||document.createElement('option');
      option.value=item.id;
      if(option.textContent!==item.label) option.textContent=item.label;
      return option;
    });
    for(let i=0;i<ordered.length;i++) if(select.options[i]!==ordered[i]) select.insertBefore(ordered[i],select.options[i]||null);
    for(const option of [...select.options]) if(!options.some(item=>item.id===option.value)) option.remove();
    select.dataset.optionsSignature=signature;
  }
  const ids=new Set((snapshot.tasks||[]).map(x=>x.id));
  const selected=ids.has(previous)?previous:(snapshot.recommended?.id||'');
  if(select.value!==selected) select.value=selected;
  const task=(snapshot.tasks||[]).find(item=>item.id===selected);
  const taskDescription=task ? task.id+' · '+task.title+' · '+task.percent+'% · '+task.eta+' remaining\n'+(task.detail||'No TODO.md description available.') : 'No backlog task selected.';
  if(description.textContent!==taskDescription) description.textContent=taskDescription;
  select.disabled=!snapshot.tasks?.length || snapshot.current_admission?.status==='ADMITTED';
  takeSelected.disabled=!snapshot.tasks?.length || snapshot.current_admission?.status==='ADMITTED';
  takeNext.disabled=!snapshot.recommended || snapshot.current_admission?.status==='ADMITTED';
  prepare.disabled=!snapshot.envelope?.ready || snapshot.current_admission?.status!=='ADMITTED';
  release.disabled=snapshot.current_admission?.status!=='ADMITTED';
  const releasePlan=snapshot.release_plan;
  recommendation.textContent=snapshot.recommended
    ? (releasePlan?.phase?'Release '+releasePlan.target+' · '+releasePlan.phase.id+' '+releasePlan.phase.title+' · ':'')+'Recommended next: '+snapshot.recommended.id+' · '+snapshot.recommended.percent+'% · '+snapshot.recommended.title+(snapshot.recommended.priority==='release_critical'?' · release critical':'')+(snapshot.recommended.milestone_supporting&&snapshot.next_milestone?' · gates '+snapshot.next_milestone.id:'')
    : 'No incomplete backlog item is available.';
  if(snapshot.current_admission?.status==='ADMITTED') {
    status.textContent='ADMITTED · '+snapshot.current_admission.backlog_task_id+' → '+snapshot.current_admission.runtime_task_id+' · '+(snapshot.envelope?.ready?'BOUNDED TASK READY':'PLANNING REQUIRED');
  } else if(snapshot.current_admission?.status==='RELEASED') {
    status.textContent='No active admission · last released '+snapshot.current_admission.backlog_task_id;
  } else {
    status.textContent='No backlog item currently admitted into execution.';
  }
}

function renderRdcExecution(snapshot) {
  const section=$('rdc-execution-section');
  const intent=snapshot?.latest||null;
  latestRdcIntent=intent;
  if(!intent) { section.hidden=true; delete section.dataset.taskId; delete section.dataset.runId; updateRunDetailGroups(); return; }
  section.hidden=false;
  section.dataset.taskId=String(intent.task_id||'');
  section.dataset.runId=String(intent.run_id||'');
  const caps=intent.capabilities||{};
  const approval=intent.approval||{};
  const result=intent.result||{};
  appendKeyValues($('rdc-execution-summary'),[
    ['Intent',intent.intent_id||'-','', 'Stable EDH dispatch intent for this RDC execution attempt.'],
    ['Run',intent.run_id||'-','', 'RDC Run identity allocated before external execution begins.'],
    ['Task',intent.task_id||'-','', 'Bounded Task that this RDC Run is allowed to execute.'],
    ['Status',intent.status||'-','', 'RDC adapter lifecycle: AWAITING_CLAIM, CLAIMED, RUNNING or terminal.'],
    ['Approval',approval.state||'-','', 'External ChatGPT/RDC platform approval boundary. EDH records it but cannot bypass it.'],
    ['Device',intent.adapter?.device_id||'-','', 'RDC device chosen by the external adapter when known.'],
    ['Allowed tools',(caps.rdc_tools||[]).join(', ')||'-','', 'Capability-minimized RDC tool set derived from the bounded Task scope.'],
    ['Declared reads',(caps.declared_reads||[]).join(', ')||'-','', 'Task-declared read scope. Platform RDC permission may be broader, but adapter policy must remain within this scope.'],
    ['Declared writes',(caps.declared_writes||[]).join(', ')||'-','', 'Task-declared write scope.'],
    ['Tool calls',String(intent.metrics?.tool_calls??0),'', 'RDC tool calls recorded under this EDH intent.'],
    ['Tool errors',String(intent.metrics?.tool_errors??0),'', 'Recorded RDC tool errors under this intent.'],
    ['Outcome',result.outcome||'-','', 'Terminal executor result reported back to EDH.']
  ]);
  updateRunDetailGroups();
}

function renderPreparedDispatchSnapshot(prepared,policy) {
  const box=$('prepared-dispatch');
  const button=$('dispatch-prepared');
  const label=$('prepared-dispatch-label');
  const status=$('prepared-dispatch-status');
  if(!prepared?.ready) {
    box.hidden=true; status.textContent=''; button.disabled=false; renderExecutorPolicy(policy,false); updateRunDetailGroups(); return;
  }
  box.hidden=false;
  const preparedAt=prepared.prepared_at?Date.parse(prepared.prepared_at)/1000:null;
  const preparedAge=Number.isFinite(preparedAt)?seconds(Math.max(0,Date.now()/1000-preparedAt))+' old':'age unknown';
  label.textContent=(prepared.label||prepared.task_id||'Ready handoff')+(prepared.goal?' — '+prepared.goal:'')+' · prepared '+preparedAge;
  label.title=label.textContent;
  button.title='Dispatch is available only while the handoff state is READY. It starts a new Harness-owned run; completed/PASS handoffs cannot be dispatched again.';
  status.textContent='READY · not yet dispatched';
  button.disabled=false;
  renderExecutorPolicy(policy,true);
  updateRunDetailGroups();
}

async function refreshConnectionRequests() {
  const box=$('connection-requests');
  try {
    const s=await send({type:'state'});
    box.replaceChildren();
    const requests=s.consents||[];
    pendingActionApprovalCount=(s.actions||[]).length;
    box.hidden=requests.length===0;
    for(const c of requests) {
      const card=document.createElement('div'); card.className='card connection-request-card';
      const title=document.createElement('strong'); title.textContent='Connection request: '+(c.name||'MCP client');
      const detail=document.createElement('p');
      detail.textContent='Callback: '+(c.redirectOrigin||'?')+'. Read explicitly shared Chrome pages only.';
      const allow=document.createElement('button'); allow.className='primary'; allow.textContent='Allow';
      const deny=document.createElement('button'); deny.textContent='Deny';
      const decide=async allowValue=>{
        allow.disabled=true; deny.disabled=true;
        try {
          await send({type:'consent',id:c.id,allow:allowValue});
          await refreshConnectionRequests();
    if(lastState) renderTimeline(lastState);
        } catch(e) {
          allow.disabled=false; deny.disabled=false;
          $('error').textContent=e.message;
        }
      };
      allow.addEventListener('click',()=>void decide(true));
      deny.addEventListener('click',()=>void decide(false));
      card.append(title,detail,allow,deny); box.append(card);
    }
  } catch(e) {
    box.hidden=true;
  }
}

async function refreshSettings() {
  try {
    const s=await send({type:'state'});
    $('bridge-status').textContent=s.status;
    const target=await currentShareTarget();
    renderShareTarget(target);
    $('share-current').disabled=$('share-current').disabled || s.status!=='Connected' || s.paused;
    $('pause-actions').textContent=s.paused?'Resume actions':'Pause all actions';
    $('pause-actions').dataset.paused=String(s.paused);
    const box=$('shared-pages'); box.replaceChildren();
    for(const g of s.grants) settingsCard(box,(g.title||'Shared page')+'\n'+g.url,[['Stop sharing',async()=>{await send({type:'revoke',handle:g.handle});await refreshSettings();}]]);
    $('settings-error').textContent='';
  } catch(e){$('settings-error').textContent=e.message;}
}

function incidentSummary(incident) {
  if(!incident) return '';
  const method=incident.method||'';
  const path=incident.path||'';
  const status=incident.http_status!=null?'HTTP '+incident.http_status:'transport error';
  const versions=[];
  if(incident.client_version) versions.push('client '+incident.client_version);
  if(incident.server_version) versions.push('server '+incident.server_version);
  else if(incident.kind==='PROTOCOL_MISMATCH') versions.push('server legacy/unknown');
  return [incident.kind||'INCIDENT',[method,path].filter(Boolean).join(' ')||'request unspecified',status,versions.join(' → ')].filter(Boolean).join(' · ');
}
function renderReliabilityIncidents(incidents=[],connection={}) {
  const section=$('reliability-incidents');
  if(!section) return;
  const rows=Array.isArray(incidents)?incidents:[];
  const latest=connection?.incident||rows.at(-1)||null;
  if(!latest) { section.hidden=true; section.classList.remove('recovered'); $('incident-current').replaceChildren(); $('incident-list').replaceChildren(); return; }
  const recovered=connection?.status==='CONNECTED' && !connection?.incident;
  section.hidden=false; section.classList.toggle('recovered',recovered);
  section.classList.toggle('recovered-collapsed',recovered);
  $('incident-meta').textContent=(recovered?'CONNECTION RESTORED':'CONNECTION DEGRADED')+' · last failure '+(latest.last_seen_at?new Date(latest.last_seen_at).toLocaleTimeString():'unknown')+(latest.count>1?' · '+latest.count+' occurrences':'');
  const current=$('incident-current'); current.replaceChildren();
  const title=document.createElement('strong'); title.textContent=(recovered?'HISTORICAL · ':'')+incidentSummary(latest);
  const detail=document.createElement('div'); detail.textContent=recovered
    ? 'Companion connectivity is restored; root cause remains unverified. Historical evidence retained.'
    : (latest.explanation||latest.message||'No diagnostic explanation recorded.');
  const evidence=document.createElement('div'); evidence.className='incident-row-meta';
  evidence.textContent='first '+(latest.first_seen_at?new Date(latest.first_seen_at).toLocaleString():'?')+
    (latest.last_seen_at?' · last '+new Date(latest.last_seen_at).toLocaleTimeString():'')+
    (latest.recovered_at?' · recovered '+new Date(latest.recovered_at).toLocaleTimeString()+(latest.recovery_inferred?' (inferred)':''):'')+
    (latest.last_good_at?' · last good before failure '+new Date(latest.last_good_at).toLocaleTimeString():' · no last-good dashboard snapshot');
  current.append(title,detail,evidence);
  const frag=document.createDocumentFragment();
  for(const incident of rows.slice(-10).reverse()) {
    const row=document.createElement('div'); row.className='incident-row';
    const head=document.createElement('div'); head.textContent=incidentSummary(incident);
    const body=document.createElement('div'); body.textContent=(incident.explanation||incident.message||'')+(incident.diagnostic_id?' · diagnostic '+incident.diagnostic_id+' / '+(incident.diagnostic_stage||'?'):'');
    const meta=document.createElement('div'); meta.className='incident-row-meta';
    meta.textContent='first '+(incident.first_seen_at?new Date(incident.first_seen_at).toLocaleString():'unknown')+' · last failure '+(incident.last_seen_at?new Date(incident.last_seen_at).toLocaleString():'unknown')+(incident.count>1?' · '+incident.count+' occurrences':'')+(incident.recovered_at?' · recovered '+new Date(incident.recovered_at).toLocaleString()+(incident.recovery_inferred?' (inferred)':''):' · recovery not recorded');
    row.append(head,body,meta); frag.append(row);
  }
  $('incident-list').replaceChildren(frag);
}

function renderLocalExecutorProgress(state) {
  const section=$('local-executor-section');
  const box=$('local-executor-summary');
  if(!section||!box) return;
  const local=state?.local_executor;
  if(!local || !local.run_dir) { section.hidden=true; delete section.dataset.taskId; delete section.dataset.runId; box.replaceChildren(); updateRunDetailGroups(); return; }
  const llama=local.llama||{};
  const processed=Number(llama.prompt_tokens_processed);
  const prompt=Number(llama.prompt_tokens);
  const context=Number.isFinite(processed)&&Number.isFinite(prompt)&&prompt>0
    ? processed.toLocaleString()+' / '+prompt.toLocaleString()+' · '+Math.min(100,Math.max(0,processed/prompt*100)).toFixed(0)+'%'
    : (Number.isFinite(prompt)?prompt.toLocaleString()+' prompt tokens':'not reported');
  const elapsed=local.elapsed_seconds!=null?Number(local.elapsed_seconds):null;
  const deadline=local.deadline_seconds!=null?Number(local.deadline_seconds):null;
  const budget=elapsed!=null && deadline!=null ? seconds(elapsed)+' / '+seconds(deadline)+' · '+seconds(Math.max(0,deadline-elapsed))+' remaining' : '-';
  const step=local.step_count!=null ? String(local.step_count)+' / '+String(local.max_steps??'?') : '-';
  const resource=[];
  if(local.process_cpu_percent!=null) resource.push(Number(local.process_cpu_percent).toFixed(1)+'% process CPU');
  if(local.process_rss_mb!=null) resource.push(Number(local.process_rss_mb).toFixed(1)+' MB RSS');
  if(local.host_load_1m!=null) resource.push('load1 '+Number(local.host_load_1m).toFixed(2));
  section.hidden=false;
  section.dataset.taskId=String(local.task_id||'');
  section.dataset.runId=String(local.run_id||'');
  $('local-executor-label').textContent=(local.task_id||local.run_id||'task unknown')+' · '+String(local.status||'?').toUpperCase();
  appendKeyValues(box,[
    ['Status',String(local.status||'?').toUpperCase(),'','Local-agent lifecycle state persisted outside the browser.'],
    ['Task',local.task_id||'-','','Bounded task currently owned by the local executor.'],
    ['Run',local.run_id||'-','','Harness run identity for this local worker.'],
    ['Model',local.model||'-','','Local model selected for this worker.'],
    ['Model cycle',String(local.model_cycle??0)+(local.model_busy?' · inference active':' · idle'),'','Inference cycle observed by local-agent from llama.cpp slot state.'],
    ['Context',context,'','llama.cpp prompt tokens processed versus current prompt size while the slot is active.'],
    ['Step',step,'','Completed OpenCode model/tool steps versus declared maximum.'],
    ['Last tool',local.last_tool?local.last_tool+' · '+String(local.last_tool_status||'?'):'none','','Most recent OpenCode tool event observed in the worker log.'],
    ['Budget',budget,'','Elapsed runtime versus declared worker deadline.'],
    ['Resources',resource.join(' · ')||'not reported','','Worker process CPU/RSS plus host 1-minute load.'],
    ['Thermal',local.thermal==='unavailable_without_privileged_sensor'?'unavailable · no privileged sensor source':(local.thermal||'unavailable'),'','Temperature is never guessed; macOS privileged sensor telemetry requires a separate authorized source.'],
    ['Run dir',local.run_dir||'-','','Durable local-agent evidence directory.']
  ]);
  updateRunDetailGroups();
}

function renderExtensionVersion(state,extensionControl={}) {
  const loaded=chrome.runtime.getManifest().version;
  const disk=state?.extension_version?.disk||null;
  const label=$('extension-version');
  const gateway=$('gateway-version');
  const button=$('reload-version');
  label.textContent='v'+loaded;
  label.title='Loaded extension version '+loaded+(disk?' · disk '+disk:'');
  const sourceChanged=Number(extensionControl.pendingReloadRevision)>0;
  const mismatch=Boolean((disk&&disk!==loaded)||sourceChanged);
  button.hidden=!mismatch;
  button.disabled=false;
  button.textContent=mismatch ? '↻' : '';
  const reason=sourceChanged?'Extension source files changed on disk; loaded code may be stale.':('Extension version '+loaded+' differs from disk '+disk+'.');
  button.title=mismatch ? reason+' Reload extension.' : '';
  button.setAttribute('aria-label',mismatch ? reason+' Reload extension.' : 'Extension up to date');
  button.dataset.targetVersion=mismatch?(disk||loaded):'';

  const gv=state?.gateway_version||{};
  const runtime=gv.runtime_commit?String(gv.runtime_commit).slice(0,8):'?';
  const head=gv.repo_head?String(gv.repo_head).slice(0,8):'?';
  gateway.className='muted gateway-version'+(gv.restart_required?' restart-required':'');
  gateway.textContent=gv.restart_required
    ? ('Gateway restart '+runtime+' → '+head)
    : ('gw '+runtime+(gv.repo_changed?' · repo '+head:''));
  gateway.title='Gateway runtime '+runtime+' · repo HEAD '+head+
    (gv.started_at?' · started '+gv.started_at:'')+
    (gv.repo_changed?' · repository moved since gateway start':'')+
    (gv.restart_required?' · server code changed; restart required':'');
  const versionLine=$('version-line');
  if(versionLine) versionLine.hidden=!gv.restart_required;
}

function setDisclosureDefault(section, open) {
  if(!section || section.dataset.disclosureInitialized==='true') return;
  section.open=Boolean(open);
  section.dataset.disclosureInitialized='true';
}

function recentAttributionHealth(state, windowSeconds=120) {
  const now=Date.now()/1000;
  const workSources=new Set(['MCP','RDC','TERM','ACTION','OC','QWEN','LLAMA']);
  const events=(state.timeline||[]).filter(event=>
    workSources.has(String(event.source||'')) &&
    Number.isFinite(Number(event.ts)) &&
    now-Number(event.ts)<=windowSeconds
  );
  const scoped=events.filter(event=>Boolean(event.correlation?.conversation_id)).length;
  const issues=events.filter(event=>!event.correlation?.conversation_id);
  return {total:events.length,scoped,unscoped:issues.length,issues,rate:events.length?Math.round(scoped*100/events.length):null,windowSeconds};
}

function renderAttributionHealth(state) {
  const health=recentAttributionHealth(state);
  const button=$('attribution-health');
  const label=$('attribution-health-label');
  button.className='attribution-health';
  button.disabled=true;
  button.setAttribute('aria-disabled','true');
  if(!health.total) {
    label.textContent='Attribution coverage · no recent work';
    button.title='No recent work events require conversation attribution in the current 2-minute window.';
    return health;
  }
  const healthy=health.unscoped===0;
  button.classList.add(healthy?'healthy':'degraded');
  if(healthy) {
    label.textContent='Attribution coverage · healthy · 100% · '+health.scoped+'/'+health.total;
    button.title='Recent 2-minute work attribution: every observed work event is scoped to a conversation.';
  } else {
    button.disabled=false;
    button.setAttribute('aria-disabled','false');
    label.textContent='Attribution coverage · degraded · '+health.unscoped+'/'+health.total+' unscoped · Inspect';
    button.title='Recent work contains events with no trustworthy conversation identity. Click to inspect the attribution breakpoints.';
    if(health.rate<90) setDisclosureDefault($('trace-section'),true);
  }
  return health;
}

function historicalRunIdentityWarning() {
  const sources=[['Detached Harness', 'detached-run-section'],['Local executor','local-executor-section'],['Handoff/result','prepared-result-section'],['RDC intent','rdc-execution-section']];
  const identities=sources.map(([label,id])=>{
    const el=$(id);
    return el && !el.hidden ? {label,task:el.dataset.taskId||'',run:el.dataset.runId||''} : null;
  }).filter(Boolean);
  const distinctTasks=new Set(identities.map(x=>x.task).filter(Boolean));
  const distinctRuns=new Set(identities.map(x=>x.run).filter(Boolean));
  const ambiguous=identities.length>1 && (distinctTasks.size>1 || distinctRuns.size>1);
  return ambiguous ? 'Historical records belong to different tasks or runs. Their outcomes are independent; expand each record for its identity and evidence.' : '';
}
function updateRunDetailGroups() {
  const warning=$('run-identity-warning');
  if(warning) { warning.textContent=historicalRunIdentityWarning(); warning.hidden=!warning.textContent; }
  const execution=$('run-execution-group');
  const handoff=$('run-handoff-group');
  if(execution) execution.hidden=($('detached-run-section')?.hidden!==false)&&($('rdc-execution-section')?.hidden!==false)&&($('local-executor-section')?.hidden!==false);
  if(handoff) handoff.hidden=($('prepared-dispatch')?.hidden!==false)&&($('prepared-result-section')?.hidden!==false);
}

function renderRunMeta(state) {
  const section=$('run-section');
  const meta=$('run-meta');
  const stateLabel=$('run-state');
  const preview=$('run-preview');
  const run=detachedRunHealth(state);
  const prepared=state.prepared_dispatch;
  const ready=!$('prepared-dispatch')?.hidden;
  const runStatus=String(run?.status||'').toUpperCase();
  const runActive=Boolean(run && !['DONE','ERROR','CANCELED'].includes(runStatus));

  section.hidden=false;

  if(runActive) {
    stateLabel.textContent=runStatus||'RUNNING';
    meta.textContent=run.phase||'active';
    preview.textContent='Harness-owned execution is active'+(run.safe_to_interrupt?' · interrupt '+run.safe_to_interrupt:'');
    preview.title=preview.textContent;
    meta.title='Current execution phase reported by the Harness-owned run.';
    setDisclosureDefault(section,true);
    return;
  }

  const rdcStatus=String(latestRdcIntent?.status||'').toUpperCase();
  if(latestRdcIntent && !['DONE','ERROR','CANCELED','DENIED'].includes(rdcStatus)) {
    stateLabel.textContent=rdcStatus||'RDC';
    meta.textContent='RDC · '+String(latestRdcIntent.approval?.state||'approval unknown');
    preview.textContent='EDH-controlled RDC execution intent'+(latestRdcIntent.task_id?' · '+latestRdcIntent.task_id:'');
    preview.title=preview.textContent;
    meta.title='RDC backend status from the EDH dispatch intent. Platform approval remains external.';
    setDisclosureDefault(section,true);
    return;
  }

  if(ready) {
    stateLabel.textContent='ACTION REQUIRED';
    meta.textContent='Dispatch available';
    preview.textContent='Prepared Harness task is ready to start';
    preview.title=preview.textContent;
    meta.title='A prepared task can be dispatched into Harness-owned execution.';
    setDisclosureDefault(section,true);
    return;
  }

  // Multiple unrelated terminal records are an evidence collection, not one
  // authoritative current Run. Do not promote the handoff PASS to headline.
  const mixed=historicalRunIdentityWarning();
  if(mixed) {
    stateLabel.textContent='HISTORY';
    meta.textContent='independent records';
    preview.textContent='No unified current Run · unrelated historical execution records';
    preview.removeAttribute('title');
    meta.removeAttribute('title');
    setDisclosureDefault(section,true);
    return;
  }

  if(prepared) {
    const result=String(prepared.result||prepared.run_status||prepared.status||'?').toUpperCase();
    stateLabel.textContent=result;
    meta.textContent=prepared.seconds!=null?seconds(prepared.seconds):'last result';
    preview.textContent='Last dispatched handoff / run result'+(prepared.task_id?' · '+prepared.task_id:'');
    preview.title=preview.textContent;
    meta.title='Historical result of the last dispatched handoff. A PASS result is terminal evidence and is not dispatchable again.';
    setDisclosureDefault(section,false);
    return;
  }

  if(run) {
    stateLabel.textContent=runStatus||'DONE';
    meta.textContent=run.phase||'finished';
    preview.textContent='Last Harness-owned run'+(run.ended_at?' · finished':'');
    preview.title=preview.textContent;
    meta.title='Terminal phase of the latest Harness-owned execution.';
    setDisclosureDefault(section,false);
    return;
  }

  stateLabel.textContent='IDLE';
  meta.textContent='';
  preview.textContent='No active or recent run';
  preview.title=preview.textContent;
  meta.title='';
  setDisclosureDefault(section,false);
}

function usageMetricText(metric,{unit='tokens',digits=0}={}) {
  if(!metric || metric.value==null) return 'not reported';
  const value=Number(metric.value);
  const formatted=Number.isFinite(value) ? value.toLocaleString(undefined,{maximumFractionDigits:digits,minimumFractionDigits:digits}) : String(metric.value);
  const quality=metric.quality||'unknown';
  const source=metric.source||'unknown';
  const estimator=metric.estimator?' · '+metric.estimator:'';
  return formatted+(unit?' '+unit:'')+' · '+quality+' · '+source+estimator;
}
function usageCostText(cost) {
  if(!cost) return 'not available';
  if(cost.value_usd!=null) {
    const value=Number(cost.value_usd);
    return '$'+(Number.isFinite(value)?value.toFixed(value<0.01?6:4):String(cost.value_usd))+' · '+(cost.quality||'unknown')+' · '+(cost.source||'unknown');
  }
  if(cost.status==='not_metered') return 'not metered · local runtime';
  return 'not available'+(cost.source?' · '+cost.source:'');
}
function modelUsageRows(usage,profile={}) {
  if(!usage || typeof usage!=='object') return [];
  return [
    ['Provider',usage.provider||profile.provider||'-','', 'Model provider/runtime family associated with this usage record.'],
    ['Model',usage.model||profile.model||'-','', 'Model identity associated with this usage record.'],
    ['Input tokens',usageMetricText(usage.input_tokens),'', 'Exact means provider/runtime reported. Estimated means a local heuristic; estimates are never billing truth.'],
    ['Output tokens',usageMetricText(usage.output_tokens),'', 'Generated token count. Exact/estimated and source are shown explicitly.'],
    ['Total tokens',usageMetricText(usage.total_tokens),'', 'Total normalized token count for this model request.'],
    ['Cache read',usageMetricText(usage.cache_read_tokens),'', 'Prompt/input tokens reported as read from provider/runtime cache, when exposed.'],
    ['Cache write',usageMetricText(usage.cache_write_tokens),'', 'Tokens written/created in provider/runtime cache, when exposed.'],
    ['Throughput',usageMetricText(usage.output_tokens_per_second,{unit:'tok/s',digits:2}),'', 'Output generation throughput. Source states whether the runtime reported it or EDH derived it from output tokens and elapsed time.'],
    ['Cost',usageCostText(usage.cost),'', 'API/provider billing cost only when reported or backed by pricing metadata. Local runtime is marked not metered rather than $0.'],
    ['Usage truth',usage.semantics||'Exact/provider reported where available; local estimates are labeled.','','Accounting provenance rule for this usage record.']
  ];
}

function usageMetricParts(metric,{unit='tokens',digits=0}={}) {
  if(!metric || metric.value==null) return {value:'not reported',quality:'unavailable',source:'not_reported',estimator:null};
  const n=Number(metric.value);
  const formatted=Number.isFinite(n)?n.toLocaleString(undefined,{maximumFractionDigits:digits,minimumFractionDigits:digits}):String(metric.value);
  return {value:formatted+(unit?' '+unit:''),quality:metric.quality||'unknown',source:metric.source||'unknown',estimator:metric.estimator||null};
}
function usageCostParts(cost) {
  if(!cost) return {value:'not available',quality:'unavailable',source:'not_reported'};
  if(cost.value_usd!=null) {
    const n=Number(cost.value_usd);
    return {value:'$'+(Number.isFinite(n)?n.toFixed(n<0.01?6:4):String(cost.value_usd)),quality:cost.quality||'unknown',source:cost.source||'unknown',estimator:null};
  }
  if(cost.status==='not_metered') return {value:'not metered',quality:'unavailable',source:'local_runtime',estimator:null};
  return {value:'not available',quality:'unavailable',source:cost.source||'pricing_unavailable',estimator:null};
}
function appendUsageMetric(parent,label,parts) {
  const box=document.createElement('div'); box.className='usage-metric';
  const l=document.createElement('span'); l.className='usage-metric-label'; l.textContent=label;
  const v=document.createElement('span'); v.className='usage-metric-value'; v.textContent=parts.value;
  const provenance=document.createElement('div'); provenance.className='usage-metric-provenance';
  for(const [text,cls] of [[parts.quality,parts.quality],[parts.source,'source'],[parts.estimator,'estimator']]) {
    if(!text) continue;
    const badge=document.createElement('span'); badge.className='usage-badge '+(cls||''); badge.textContent=text; provenance.append(badge);
  }
  box.append(l,v,provenance); parent.append(box);
}
function appendUsageCard(parent,title,meta='') {
  const card=document.createElement('section'); card.className='usage-card';
  const head=document.createElement('div'); head.className='usage-card-head';
  const t=document.createElement('span'); t.className='usage-card-title'; t.textContent=title;
  const m=document.createElement('span'); m.className='usage-card-meta'; m.textContent=meta;
  head.append(t,m); card.append(head); parent.append(card); return card;
}
function budgetMetric(value,suffix='') {
  return {value:value==null?'not set':String(value)+suffix,quality:value==null?'unavailable':'declared',source:'task_envelope'};
}
function recentResourceRows(state,usage,profile={}) {
  const rows=[];
  const seen=new Set();
  const add=(role,name,quality)=>{ if(!name) return; const key=role+'|'+name; if(seen.has(key)) return; seen.add(key); rows.push([role,String(name),quality]); };
  add('Model',usage?.model||profile.model,usage?.model?'usage_bound':'profile_declared');
  add('Provider',usage?.provider||profile.provider,usage?.provider?'usage_bound':'profile_declared');
  const run=state.run_inspection||{};
  if(run.opencode_version) add('Agent','OpenCode '+run.opencode_version,'run_reported');
  const now=Date.now()/1000;
  const recent=(state.timeline||[]).filter(event=>Number(event.ts||0)>0 && now-Number(event.ts)<=300);
  const counts=new Map();
  for(const event of recent) {
    const src=String(event.source||'').toUpperCase();
    if(src==='RDC') add('Transport','Remote Desktop Commander','recently_observed');
    if(src==='MCP') add('Protocol','MCP','recently_observed');
    if(src==='LLAMA') add('Runtime','llama.cpp','recently_observed');
    if(src==='OC') add('Agent','OpenCode','recently_observed');
    if(src==='QWEN') add('Model','Qwen','recently_observed');
    let tool=null;
    if(src==='RDC') tool=String(event.message||'').match(/^(start_process|read_process_output|search_files|read_file|write_file|list_directory|find_files|kill_process)/)?.[1]||null;
    if(src==='MCP') tool=String(event.message||'').match(/\btool\s+([A-Za-z0-9_.:-]+)/i)?.[1]||null;
    if(tool) counts.set(tool,(counts.get(tool)||0)+1);
  }
  for(const [tool,count] of [...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5)) add('Tool',tool+(count>1?' ×'+count:''),'recently_observed');
  return rows;
}
function renderUsagePanel(state,usage,budget={},profile={}) {
  const root=$('task-usage');
  const hasBudget=budget && Object.keys(budget).length>0;
  const resources=recentResourceRows(state,usage,profile);
  if(!usage && !hasBudget && !resources.length) { root.hidden=true; root.replaceChildren(); return; }
  root.hidden=false; root.replaceChildren();

  if(hasBudget) {
    const card=appendUsageCard(root,'Budget envelope','declared · task_envelope');
    const grid=document.createElement('div'); grid.className='usage-metrics';
    appendUsageMetric(grid,'Deadline',budgetMetric(budget.deadline_seconds,' s'));
    appendUsageMetric(grid,'Agent steps',budgetMetric(budget.max_agent_steps));
    appendUsageMetric(grid,'Output cap',budgetMetric(budget.max_output_tokens,' tokens'));
    appendUsageMetric(grid,'Repairs',budgetMetric(budget.max_repairs));
    card.append(grid);
  }

  if(usage) {
    const identity=[usage.provider||profile.provider,usage.model||profile.model].filter(Boolean).join(' · ')||'model request';
    const card=appendUsageCard(root,'Model usage',identity);
    const grid=document.createElement('div'); grid.className='usage-metrics';
    appendUsageMetric(grid,'Input',usageMetricParts(usage.input_tokens));
    appendUsageMetric(grid,'Output',usageMetricParts(usage.output_tokens));
    appendUsageMetric(grid,'Cache read',usageMetricParts(usage.cache_read_tokens));
    appendUsageMetric(grid,'Cache write',usageMetricParts(usage.cache_write_tokens));
    appendUsageMetric(grid,'Throughput',usageMetricParts(usage.output_tokens_per_second,{unit:'tok/s',digits:2}));
    appendUsageMetric(grid,'Cost',usageCostParts(usage.cost));
    card.append(grid);
  }

  if(resources.length) {
    const card=appendUsageCard(root,'Resources','role-aware · provenance labeled');
    const list=document.createElement('div'); list.className='resource-list';
    for(const [role,name,quality] of resources) {
      const row=document.createElement('div'); row.className='resource-row';
      const r=document.createElement('span'); r.className='resource-role'; r.textContent=role;
      const n=document.createElement('span'); n.className='resource-name'; n.textContent=name;
      const q=document.createElement('span'); q.className='resource-quality'; q.textContent=quality;
      row.append(r,n,q); list.append(row);
    }
    card.append(list);
  }
}
function currentUsage(state) {
  return browserLocalChatActivity?.last_turn_usage || state.task_lifecycle?.budget_used?.model_usage || state.run_inspection?.usage || null;
}
function compactUsageSummary(usage) {
  if(!usage) return 'not reported for current run';
  const input=usage.input_tokens, output=usage.output_tokens;
  if(!input && !output) return 'record exists · token counts unavailable';
  const bits=[];
  if(input?.value!=null) bits.push(Number(input.value).toLocaleString()+' in');
  if(output?.value!=null) bits.push(Number(output.value).toLocaleString()+' out');
  const qualities=[input?.quality,output?.quality].filter(Boolean);
  const q=qualities.length && qualities.every(x=>x===qualities[0])?qualities[0]:'mixed quality';
  if(q) bits.push(q);
  return bits.join(' · ');
}

function appendKeyValues(parent, rows) {
  // Polls must not replace a selectable diagnostic grid. Reuse each pair
  // when its key matches; unchanged text nodes retain selection and focus.
  const existing=[...parent.children];
  const sameShape=existing.length===rows.length*2 && rows.every(([key],i)=>
    existing[i*2]?.classList.contains('key') &&
    existing[i*2+1]?.classList.contains('value') &&
    existing[i*2].textContent===String(key));
  if(sameShape) {
    for(let i=0;i<rows.length;i++) {
      const [key,value,cls,help]=rows[i];
      const k=existing[i*2], val=existing[i*2+1];
      const nextValue=String(value??'-');
      const nextClass='value'+(cls?' '+cls:'');
      if(val.textContent!==nextValue) val.textContent=nextValue;
      if(val.className!==nextClass) val.className=nextClass;
      const nextKeyClass=help?'key has-help':'key';
      if(k.className!==nextKeyClass) k.className=nextKeyClass;
      if(help) {
        if(k.title!==help) k.title=help;
        if(k.tabIndex!==0) k.tabIndex=0;
        const label=key+': '+help;
        if(k.getAttribute('aria-label')!==label) k.setAttribute('aria-label',label);
      } else {
        if(k.hasAttribute('title')) k.removeAttribute('title');
        if(k.hasAttribute('tabindex')) k.removeAttribute('tabindex');
        if(k.hasAttribute('aria-label')) k.removeAttribute('aria-label');
      }
    }
    return;
  }
  const frag=document.createDocumentFragment();
  for(const [key,value,cls,help] of rows) {
    const k=document.createElement('span');
    k.className='key';
    k.textContent=key;
    if(help) {
      k.title=help;
      k.classList.add('has-help');
      k.tabIndex=0;
      k.setAttribute('aria-label',key+': '+help);
    }
    const val=document.createElement('span'); val.className='value'+(cls?' '+cls:''); val.textContent=value??'-';
    frag.append(k,val);
  }
  parent.replaceChildren(frag);
}
function renderPreparedResult(state) {
  const p=state.prepared_dispatch;
  const section=$('prepared-result-section');
  if(!p){section.hidden=true; delete section.dataset.taskId; delete section.dataset.runId; $('prepared-result-summary').replaceChildren(); $('prepared-result-meta').textContent=''; updateRunDetailGroups(); return;}
  section.hidden=false;
  section.dataset.taskId=String(p.task_id||'');
  section.dataset.runId=String(p.run_id||'');
  $('prepared-result-label').textContent=(p.task_id||'task unknown')+' · '+String(p.result||p.run_status||p.status||'?').toUpperCase()+(p.seconds!=null?' · '+seconds(p.seconds):'');
  const corr=p.correlation_id?correlationShort(p.correlation_id):'-';
  const files=Array.isArray(p.changed_files)?p.changed_files:[];
  const preparedTs=p.prepared_at?Date.parse(p.prepared_at)/1000:null;
  const dispatchedTs=p.dispatched_at?Date.parse(p.dispatched_at)/1000:null;
  const endedTs=p.ended_at?Date.parse(p.ended_at)/1000:null;
  const nowTs=Date.now()/1000;
  const rows=[
    ['Result',p.result||p.run_status||p.status||'?','', 'Terminal result of the run created from this handoff. PASS means acceptance succeeded; it is historical evidence, not a task waiting for Dispatch.'],
    ['Handoff state',p.status||'-','', 'READY means Dispatch may start a new run. DISPATCHED means that transition already happened and the same handoff must not be dispatched again.'],
    ['Task',p.task_id||'-','', 'Harness task identifier associated with this prepared handoff.'],
    ['Prepared',p.prepared_at?new Date(p.prepared_at).toLocaleString():'-','', 'When the execution envelope was prepared.'],
    ['Prepared age',Number.isFinite(preparedTs)?seconds(Math.max(0,nowTs-preparedTs)):'-','', 'How long ago this execution envelope was prepared.'],
    ['Dispatched',p.dispatched_at?new Date(p.dispatched_at).toLocaleString():'-','', 'When READY crossed into a Harness-owned Run.'],
    ['Finished',p.ended_at?new Date(p.ended_at).toLocaleString():'-','', 'When the resulting run reached its terminal state.'],
    ['Result age',Number.isFinite(endedTs)?seconds(Math.max(0,nowTs-endedTs)):(Number.isFinite(dispatchedTs)?seconds(Math.max(0,nowTs-dispatchedTs)):'-'),'', 'Age of the terminal run result, or dispatch age when no finish timestamp is available.'],
    ['Correlation',corr,'', 'Short correlation identifier linking this run result to its causal trace and evidence.'],
    ['Runtime',p.seconds!=null?seconds(p.seconds):'-','', 'Elapsed execution time reported for the prepared handoff.'],
    ['Executor',p.opencode_version?'OpenCode '+p.opencode_version:'-','', 'Executor runtime and version that performed the work.'],
    ['Model',p.model||'-','', 'Model/runtime identity used by the executor for this run.'],
    ['Artifacts',files.length?files.join(', '):'-','', 'Files or durable outputs produced or changed by this run.'],
    ['Outcome',p.outcome_reason||p.worker_status||'-','', 'Harness interpretation of why the run ended in its reported result.']
  ];
  appendKeyValues($('prepared-result-summary'),rows);
  $('prepared-result-meta').textContent='HISTORICAL · '+String(p.result||p.run_status||p.status||'?').toUpperCase()+(p.seconds!=null?' · '+seconds(p.seconds):'');
  updateRunDetailGroups();
}
function projectAge(secondsValue) {
  const n=Math.max(0,Number(secondsValue)||0);
  const days=Math.floor(n/86400);
  const hours=Math.floor((n%86400)/3600);
  return days?days+'d '+hours+'h':hours+'h';
}
function appendTrajectoryRows(parent,rows) {
  // Git-derived history is stable across polls. Preserve existing DOM and
  // selection unless its displayed content actually changes.
  const fingerprint=JSON.stringify(rows);
  if(parent.dataset.trajectoryFingerprint===fingerprint) return;
  parent.dataset.trajectoryFingerprint=fingerprint;
  const frag=document.createDocumentFragment();
  for(const [date,value,detail] of rows) {
    const row=document.createElement('div'); row.className='trajectory-row';
    const d=document.createElement('span'); d.className='trajectory-date'; d.textContent=date;
    const v=document.createElement('span'); v.className='trajectory-value'; v.textContent=value;
    const rest=document.createElement('span'); rest.className='trajectory-detail'; rest.textContent=detail||'';
    row.append(d,v,rest); frag.append(row);
  }
  parent.replaceChildren(frag);
}

function hoursRange(low,high) {
  const lo=Number(low)||0, hi=Number(high)||0;
  if(!hi) return '0 h';
  return (lo===hi?String(lo):String(lo)+'–'+String(hi))+' h';
}
function renderProjectStatus(state) {
  const p=state.project_status;
  const section=$('project-status-section');
  if(!p){section.hidden=true; return;}
  section.hidden=false;
  const critical=(p.critical_path||[]).map(t=>t.id+' '+t.percent+'%').join(' · ')||'-';
  const milestone=p.next_milestone;
  const rows=[
    ['Project',p.project_name||p.project_id||'-','', 'Selected Harness Project whose task graph is being projected here. It is independent of the current ChatGPT conversation.'],
    ['Project ID',p.project_id||'-','', 'Stable project identity used by readiness configuration and future project selection.'],
    ['Task catalog',compactMessage(p.task_catalog_path||'TODO.md'),'','Percentages and task rows are read from this TODO catalog.'],
    ['Milestones',compactMessage(p.readiness_path||'project/readiness.json'),'','Milestone gates and supporting-task relationships are read from this readiness file.'],
    ['Calculation',p.calculation_protocol||'todo-percent-average-v1','','Overall is recomputed from the explicit percentages stored in TODO.md; the Observer does not ask an LLM to estimate these percentages.'],
    ['Catalog updated',p.task_catalog_updated_at?new Date(p.task_catalog_updated_at).toLocaleString():'unknown','','Filesystem modification time of TODO.md. This tells you when the inputs last changed, not when the Observer last refreshed.'],
    ['Refresh','automatic on Observer snapshot','','The Observer rereads the files automatically. The values stay unchanged until TODO.md or readiness configuration changes.'],
    ['Overall',String(p.average_percent??0)+'% average across '+String(p.task_count??0)+' tracked tasks','', 'Arithmetic average of tracked task percentages from TODO.md. Informative only; milestone readiness remains gate-based.'],
    ['Completed',String(p.complete_count??0)+' / '+String(p.task_count??0),'', 'Tracked tasks whose completion value is 100%.'],
    ['Critical path',critical,'', 'Configured unfinished tasks that currently gate the next delivery milestone.'],
    ['Next milestone',milestone?(milestone.id+' · '+milestone.title):'all configured milestones ready','', 'First configured milestone whose supporting tasks are not all complete.'],
    ['Remaining ETA',hoursRange(p.remaining_eta_low_hours,p.remaining_eta_high_hours)+' backlog sum; not calendar time','', 'Sum of remaining task effort estimates. This is backlog effort, not a delivery-date prediction.'],
    ['Observed today',seconds(p.observed_today_active_seconds||0)+' active heuristic · '+seconds(p.observed_today_window_seconds||0)+' first→last event window','', 'Observed event activity today. Active time is a heuristic with event gaps capped; window is first-to-last observed event.']
  ];
  appendKeyValues($('project-status-summary'),rows);
  const projectLabel=p.project_name||p.project_id||'Project identity unavailable';
  $('project-status-project').textContent=projectLabel;
  $('project-status-project').title='Selected Project: '+projectLabel+'. Project scope is independent of the current ChatGPT conversation.';
  $('project-status-meta').textContent=String(p.average_percent??0)+'% · '+String(p.complete_count??0)+'/'+String(p.task_count??0)+' backlog items complete';
  const t=p.trajectory||{};
  appendKeyValues($('project-trajectory-summary'),[
    ['Started',t.started_at?new Date(t.started_at).toLocaleString():'unknown','', 'First commit in the current Git lineage.'],
    ['EDH since',t.edh_since?new Date(t.edh_since).toLocaleString():'unknown','', 'First commit whose package identity is execution-delivery-harness.'],
    ['Project age',t.age_seconds==null?'-':projectAge(t.age_seconds),'', 'Elapsed wall-clock age from the first commit in this lineage.'],
    ['Commits',String(t.commit_count??0),'', 'Git commits reachable from the current branch HEAD.'],
    ['Last 24h',String(t.commits_last_24h??0)+' commits','', 'Commits authored in the rolling 24-hour window.'],
    ['Average velocity',t.average_commits_per_day==null?'-':String(t.average_commits_per_day)+' commits/day','', 'Simple average commit rate over project wall-clock age; this is delivery activity, not story-point throughput.'],
    ['TODO checkpoints',String(t.todo_commit_count??0),'', 'Commits that changed TODO.md, indicating project-model/readiness evolution.']
  ]);
  appendTrajectoryRows($('project-readiness-history'),(t.readiness_trajectory||[]).map(item=>[
    item.date,String(item.average_percent)+'%',String(item.complete_count)+'/'+String(item.task_count)+' complete · '+item.commit
  ]));
  appendTrajectoryRows($('project-version-history'),(t.recent_versions||[]).map(item=>[
    new Date(item.at).toLocaleDateString(),item.version,item.hash+' · '+item.subject
  ]));
}

function renderDetachedRun(state) {
  const section=$('detached-run-section');
  const run=detachedRunHealth(state);
  if(!run) { section.hidden=true; delete section.dataset.taskId; delete section.dataset.runId; updateRunDetailGroups(); return; }
  section.hidden=false;
  section.dataset.taskId=String(run.task_id||'');
  section.dataset.runId=String(run.run_id||'');
  $('detached-run-label').textContent=(run.task_id||run.run_id||'task unknown')+' · '+String(run.status||'?').toUpperCase();
  const terminal=['DONE','ERROR','CANCELED'].includes(String(run.status||'').toUpperCase());
  const ended=Date.parse(run.ended_at||'')/1000;
  const finishedAge=Number.isFinite(ended)?Math.max(0,Date.now()/1000-ended):null;
  $('detached-heartbeat').textContent=terminal
    ? (finishedAge==null?'finished':'finished '+seconds(finishedAge)+' ago')
    : (run.heartbeat_age_seconds==null?'heartbeat unknown':'heartbeat '+seconds(run.heartbeat_age_seconds)+' ago');
  appendKeyValues($('detached-run-summary'),[
    ['Controller',run.controller_id||'-','', 'Durable controller identity that owns this Harness execution.'],
    ['Status',run.status||'-','', 'High-level run status, for example RUNNING, WAITING, DONE, ERROR or CANCELED.'],
    ['Phase',run.phase||'-','', 'Current or terminal execution phase inside this run.'],
    ['PID',run.pid==null?'-':String(run.pid),'', 'Local operating-system process ID when this run owns a live process.'],
    ['Ownership',run.owner||'-','', 'Which subsystem currently owns responsibility for progressing this run.'],
    ['Mode',run.mode||'-','', 'Execution mode, for example detached Harness-owned work versus interactive execution.'],
    ['Safe to interrupt',run.safe_to_interrupt||'-','', 'Declared interruption boundary for this run; informational until an explicit stop action is used.'],
    ['Run dir',run.run_dir||'-','', 'Durable filesystem directory containing this run state, checkpoints and evidence.']
  ]);
  updateRunDetailGroups();
}

function renderTaskLifecycle(state) {
  const task=state.task_lifecycle;
  const section=$('task-lifecycle-section');
  section.hidden=false;
  section.classList.toggle('no-lifecycle-task',!task);
  if(!task) {
    $('task-state').textContent='NONE OBSERVED';
    $('task-preview').textContent='No Harness lifecycle task in current snapshot';
    $('task-safety').textContent='safety unavailable';
    $('task-safety').title='The Harness has not received enough task lifecycle state to judge interruption safety.';
    appendKeyValues($('task-lifecycle-summary'),[
      ['Evidence','No admitted lifecycle task observed'],
      ['Progress / budget','Unavailable until lifecycle evidence arrives']
    ]);
    $('task-lifecycle-work').replaceChildren();
    $('task-usage').replaceChildren(); $('task-usage').hidden=true;
    $('task-evidence-actions').replaceChildren();
    return;
  }
  const terminal=['DONE','ERROR','CANCELED'].includes(String(task.status||'').toUpperCase());
  setDisclosureDefault(section,!terminal);
  $('task-lifecycle-title').textContent=terminal?'Last task':'Current task';
  $('task-state').textContent=String(task.phase||task.status||'?').toUpperCase();
  const previewParts=[];
  if(task.task_id) previewParts.push(task.task_id);
  if(task.current) previewParts.push(task.current);
  else if(task.goal) previewParts.push(task.goal);
  const previewText=previewParts.join(' · ')||'Task lifecycle details';
  $('task-preview').textContent=previewText;
  $('task-preview').title=previewText;
  const safe=String(task.safe_to_interrupt||'?');
  $('task-safety').textContent=safe==='yes'||safe==='true'||safe==='after_checkpoint' ? 'safe to interrupt' : ('interrupt '+safe);
  $('task-safety').title=safe==='after_checkpoint'
    ? 'Orchestration safety status: stopping after the current durable checkpoint should preserve accepted progress. This badge is informational; use the owning run/control to actually stop work.'
    : 'Orchestration safety status reported by the owning Harness task/run. This badge does not stop anything by itself.';
  appendKeyValues($('task-lifecycle-summary'),[
    ['Task',task.task_id||'-','', 'Stable Harness runtime task identifier used to correlate lifecycle state and evidence.'],
    ['Backlog item',task.source?.backlog_task_id||'-','', 'Project TODO/catalog item that this runtime task was admitted from, when applicable.'],
    ['Status',task.status||'-','', 'High-level task lifecycle status, for example WAITING, RUNNING, DONE or ERROR.'],
    ['Phase',task.phase||'-','', 'Current orchestration phase inside the task lifecycle, such as VERIFYING.'],
    ['Goal',task.goal||'-','', 'Requested outcome the task is expected to produce.'],
    ['Waiting',task.waiting_reason||'-','', 'Why the task cannot advance right now, if it is waiting.'],
    ['Checkpoint',task.last_durable_checkpoint||'-','', 'Latest durable progress marker that can survive interruption or resume.']
  ]);
  const taskActions=$('task-evidence-actions'); taskActions.replaceChildren();
  if(task.task_id) {
    const b=document.createElement('button'); b.type='button'; b.textContent='Show task timeline';
    b.addEventListener('click',()=>focusTimelineScope('task:'+task.task_id,'Task · '+task.task_id)); taskActions.append(b);
  }
  if(task.run_id) {
    const b=document.createElement('button'); b.type='button'; b.textContent='Show run timeline';
    b.addEventListener('click',()=>focusTimelineScope('run:'+task.run_id,'Run · '+task.run_id)); taskActions.append(b);
  }
  const usage=task.budget_used?.model_usage||null;
  appendKeyValues($('task-lifecycle-work'),[
    ['Completed',(task.completed||[]).join(' · ')||'none','', 'Lifecycle steps already completed for this task.'],
    ['Current',task.current||'none','', 'The work step the Harness currently considers in progress.'],
    ['Pending',(task.pending||[]).join(' · ')||'none','', 'Known lifecycle steps still required before the task can finish.']
  ]);
  renderUsagePanel(state,usage,task.budget||{},task.execution_profile||{});
}

function renderRunInspection(state) {
  const run=state.run_inspection;
  if(!run) {
    appendKeyValues($('run-summary'),[['Status','No local-agent run observed']]);
    $('run-task').textContent='';
    $('run-artifacts').replaceChildren();
    return;
  }
  const runRows=[
    ['Run',run.id],
    ['Result',String(run.status||'?').toUpperCase()],
    ['Reason',run.reason||'-','failure-reason'],
    ['Executor','OpenCode '+(run.opencode_version||'-')],
    ['Model',run.model||'-'],
    ['Budget',(run.steps??'?')+' steps · '+(run.tokens_per_turn??'?')+' tokens/turn · '+(run.deadline_seconds??'?')+'s deadline'],
    ['Elapsed',run.elapsed_seconds==null?'-':String(run.elapsed_seconds)+'s'],
    ['Process exit',run.process_exit==null?'-':String(run.process_exit)],
    ['Expected',run.expected||'-'],
    ['Changed',(run.changed_files||[]).join(', ')||'none'],
    ['Run dir',run.run_dir||'-']
  ];
  runRows.push(...modelUsageRows(run.usage, {provider:run.provider,model:run.model}));
  appendKeyValues($('run-summary'),runRows);
  $('run-task').textContent=run.task||'(task text unavailable)';
  const frag=document.createDocumentFragment();
  for(const [name,path] of Object.entries(run.artifacts||{})) {
    const row=document.createElement('div'); row.className='artifact-row';
    const strong=document.createElement('strong'); strong.textContent=name+': ';
    const value=document.createElement('span'); value.textContent=path;
    row.append(strong,value); frag.append(row);
  }
  $('run-artifacts').replaceChildren(frag);
}

// Hover previews are transient. Clicking pins the same evidence for selection/copy.
const EXPLAIN_HOVER_GRACE_MS=420;
let statusExplainMode=null;
let statusExplainPinned=false;
let statusExplainHoverTimer=null;
let statusExplainDismissed=false;
let runExplainPinned=false;
let runExplainHoverTimer=null;
let runExplainDismissed=false;
// The Run explanation floats over the panel; it must not increase the Run card height.
function positionRunExplanation() {
  const popover=$('run-explain-popover');
  const anchor=$('run-explain-trigger').getBoundingClientRect();
  const margin=10;
  const width=popover.getBoundingClientRect().width;
  const height=popover.getBoundingClientRect().height;
  const left=Math.max(margin,Math.min(anchor.left,window.innerWidth-width-margin));
  const below=anchor.bottom+6;
  const above=anchor.top-height-6;
  const top=below+height<=window.innerHeight-margin ? below : (above>=margin ? above : Math.max(margin,window.innerHeight-height-margin));
  popover.style.left=left+'px';
  popover.style.top=top+'px';
}
function cancelStatusExplainHoverExit() {
  clearTimeout(statusExplainHoverTimer);
  statusExplainHoverTimer=null;
}
function closeStatusExplanation() {
  cancelStatusExplainHoverExit();
  statusExplainMode=null;
  statusExplainPinned=false;
  $('status-explain-popover').classList.remove('open');
  for(const id of ['state-label','active-chain']) $(id).setAttribute('aria-expanded','false');
}
function positionStatusExplanation(mode) {
  // The status line and header footer are separate rows: place the flyout
  // beside its trigger rather than leaving a pointer-sized dead zone.
  const trigger=$(mode==='execution'?'state-label':'active-chain');
  const header=document.querySelector('.status-header');
  const top=trigger.getBoundingClientRect().bottom-header.getBoundingClientRect().top+5;
  $('status-explain-popover').style.top=Math.max(0,top)+'px';
  alignPopoverToTrigger($('status-explain-popover'),trigger,header);
}
function showStatusExplanation(mode,{pin=false}={}) {
  cancelStatusExplainHoverExit();
  if(statusExplainPinned && !pin) return;
  if(pin && statusExplainPinned && statusExplainMode===mode) {
    statusExplainDismissed=true;
    closeStatusExplanation();
    return;
  }
  if(!pin && statusExplainDismissed) return;
  statusExplainPinned=pin;
  statusExplainMode=mode;
  const status=derivedStatus(lastState||{});
  const chat=browserLocalChatActivity||lastState?.chat_activity||{};
  const chatState=String(chat.state||'unknown').toUpperCase();
  const title=$('status-explain-title'), body=$('status-explain-body'), note=$('status-explain-note');
  if(mode==='execution') {
    title.textContent='Executor observation · '+status.label;
    body.textContent=executionStatusExplanation(status);
    note.textContent='CHAT '+chatState+' is browser-observed turn state. Executor '+status.label+' is locally observed execution state. Both can coexist; neither proves the status of another device.';
  } else {
    title.textContent='Gateway · partial visibility';
    body.textContent='EDH does not yet receive an authoritative stream of ChatGPT turn/tool dispatch. Current ChatGPT execution may be invisible to this local Observer.';
    note.textContent='The displayed background count describes locally observed open sessions, not running jobs. No activity observed is not proof of global inactivity. Cross-device presence is deferred to GW tasks.';
  }
  positionStatusExplanation(mode);
  $('status-explain-popover').classList.add('open');
  for(const id of ['state-label','active-chain']) $(id).setAttribute('aria-expanded',String(id===(mode==='execution'?'state-label':'active-chain')));
}
function scheduleStatusExplainHoverExit() {
  cancelStatusExplainHoverExit();
  if(statusExplainPinned || !statusExplainMode) return;
  statusExplainHoverTimer=setTimeout(()=>{
    if(!statusExplainPinned) closeStatusExplanation();
  },EXPLAIN_HOVER_GRACE_MS);
}
function cancelRunExplainHoverExit() {
  clearTimeout(runExplainHoverTimer);
  runExplainHoverTimer=null;
}
function closeRunExplanation() {
  cancelRunExplainHoverExit();
  runExplainPinned=false;
  $('run-explain-popover').hidden=true;
  $('run-explain-trigger').setAttribute('aria-expanded','false');
}
function showRunExplanation({pin=false}={}) {
  cancelRunExplainHoverExit();
  if(runExplainPinned && !pin) return;
  if(pin && runExplainPinned) {
    runExplainDismissed=true;
    closeRunExplanation();
    return;
  }
  if(!pin && runExplainDismissed) return;
  runExplainPinned=pin;
  $('run-explain-popover').hidden=false;
  $('run-explain-trigger').setAttribute('aria-expanded','true');
  $('run-explain-body').textContent=historicalRunIdentityWarning()||'This section shows a Run or historical evidence. Verify matching task and run identities before combining outcomes.';
  positionRunExplanation();
}
function scheduleRunExplainHoverExit() {
  cancelRunExplainHoverExit();
  if(runExplainPinned || $('run-explain-popover').hidden) return;
  runExplainHoverTimer=setTimeout(()=>{
    if(!runExplainPinned) closeRunExplanation();
  },EXPLAIN_HOVER_GRACE_MS);
}
function renderHeader(state) {
  const status=derivedStatus(state);
  $('state-label').textContent=status.label;
  $('state-age').textContent=status.age==null?'':seconds(status.age);
  const statusHelp=executionStatusExplanation(status);
  $('state-label').removeAttribute('title');
  $('state-label').setAttribute('aria-label',status.label+'. '+statusHelp);
  $('state-dot').removeAttribute('title');
  const chain=activeChain(state);
  $('active-chain').textContent=chain;
  $('active-chain').removeAttribute('title');
  $('state-dot').className='state-dot '+status.cls;

  const v=state.versions||{};
  const rows=[
    ['Observer',state.state||'?'],
    ['Active actor',state.active_source||'-'],
    ['Run',state.run||'-'],
    ['OpenCode run',state.run_opencode||'-'],
    ['OpenCode default',v.opencode_default||'?'],
    ['OpenCode installed',v.opencode_parallel||'-'],
    ['llama.cpp',v.llama||'?'],
    ['llama slot',state.llama||'?'],
    ['MCP',v.mcp||'?'],
    ['Git',String(state.git_total||0)+' changed/untracked'],
    ['Last activity',seconds(state.last_activity_seconds??0)+' ago'],
    ['Turn truth','MCP gateway not implemented; current ChatGPT dispatch can be invisible']
  ];
  appendKeyValues($('runtime-grid'),rows);
  appendKeyValues($('help-runtime-grid'),rows);
  renderRunInspection(state);
}
function renderSpans(state) {
  const spans=recentSpans(state);
  const selected=(state.spans||[]).find(span=>span.id===focusedSpanId);
  if(selected && !spans.some(span=>span.id===selected.id)) spans.unshift(selected);
  const focusedBefore=document.activeElement?.closest('#spans .span-row')?.dataset.spanId||null;
  const openCount=spans.filter(s=>!['DONE','ERROR','CANCELED','EXITED'].includes(s.status)).length;
  const frag=document.createDocumentFragment();
  for(const span of spans) {
    const row=document.createElement('div');
    row.className='span-row '+String(span.status||'').toLowerCase()+(span.id===focusedSpanId?' focused-span':'');
    row.dataset.spanId=String(span.id||'');
    row.tabIndex=-1;
    const status=document.createElement('span'); status.className='span-status has-help'; status.textContent=span.status||'?'; status.title='Span lifecycle status: running/open, waiting, done, error, canceled or exited.';
    const actor=document.createElement('span'); actor.className='has-help'; actor.textContent=(span.actor||'?')+(span.pid?' #'+span.pid:''); actor.title='Observed actor/provider that owns this bounded operation. PID is shown when the span maps to a local process.';
    const main=document.createElement('div'); main.className='span-main';
    const label=document.createElement('div'); label.className='span-label has-help'; label.textContent=compactMessage(span.label||span.id||'operation'); label.title='Operation represented by this causally scoped execution span.';
    const updateAge=span.ended ? Math.max(0,Math.floor(Date.now()/1000-(span.updated||span.ended))) : Math.max(0,Math.floor(Date.now()/1000-(span.updated||span.started||Date.now()/1000)));
    const meta=document.createElement('div'); meta.className='span-meta';
    const terminalDetail=String(span.detail||'').trim();
    const statusText=String(span.status||'').trim().toUpperCase();
    const detailText=terminalDetail && terminalDetail.toUpperCase()!==statusText ? ' · '+terminalDetail : '';
    meta.textContent='elapsed '+seconds(span.age_seconds||0)+' · last update '+seconds(updateAge)+' ago'+detailText;
    meta.title='Elapsed is the span duration. Last update is observation freshness. A terminal event identical to the Status column is intentionally not repeated here.';
    main.append(label,meta);
    const actions=document.createElement('div'); actions.className='span-actions';
    const show=document.createElement('button'); show.type='button'; show.textContent='Show in timeline';
    show.addEventListener('click',()=>focusTimelineScope('span:'+span.id,'Span · '+compactMessage(span.label||span.id)));
    actions.append(show); main.append(actions);
    row.append(status,actor,main);
    frag.append(row);
  }
  $('spans').replaceChildren(frag);
  if(focusedBefore) [...$('spans').querySelectorAll('.span-row')].find(row=>row.dataset.spanId===focusedBefore)?.focus({preventScroll:true});
  $('span-count').textContent=openCount+' open · '+Math.max(0,spans.length-openCount)+' recent';
  const spansSection=$('spans-section');
  spansSection.hidden=spans.length===0;
  setDisclosureDefault(spansSection,openCount>0||spans.some(s=>String(s.status||'').toUpperCase()==='ERROR'));
}
function renderRdc(state) {
  const rdc=state.rdc||{};
  const box=$('rdc-activity'), meta=$('rdc-meta');
  const rows=[];
  if(rdc.last_tool) {
    rows.push(['Transport','Remote Desktop Commander','', 'Observed transport/provider carrying remote filesystem, search or process-control operations.']);
    rows.push(['Last operation',String(rdc.last_summary||rdc.last_tool),'transport-command', 'Most recent RDC operation observed by the Harness.']);
    rows.push(['Last activity',seconds(rdc.last_activity_seconds??0)+' ago','', 'Age of the most recent observed RDC event; this is not the duration of current work.']);
  }
  for(const proc of (rdc.open_processes||[])) {
    rows.push(['Process '+String(proc.pid||'?'),String(proc.status||'?')+' · '+compactMessage(proc.label||'process'),'', 'Background process currently known to the transport. Process presence is durable state; it does not by itself imply current activity.']);
  }
  if(!rows.length) {
    $('rdc-section').hidden=true; box.replaceChildren(); meta.textContent=''; return;
  }
  appendKeyValues(box,rows);
  meta.textContent=(rdc.last_activity_seconds!=null?'RDC '+seconds(rdc.last_activity_seconds)+' ago · ':'')+String(rdc.open_count||0)+' process'+((rdc.open_count||0)===1?'':'es');
  const section=$('rdc-section');
  section.hidden=false;
  setDisclosureDefault(section,false);
}

function correlationShort(value) {
  return String(value||'').replace(/^corr:/,'').split('-')[0]||'?';
}
function latestTimelineEvent(state) {
  const events=state.timeline||[];
  return events.length?events.at(-1):null;
}
function latestCorrelatedEvent(state) {
  const events=state.timeline||[];
  for(let i=events.length-1;i>=0;i--) {
    if(events[i].correlation?.correlation_id) return events[i];
  }
  return null;
}
function currentExternalActivity(state) {
  const latest=latestTimelineEvent(state);
  const correlated=latestCorrelatedEvent(state);
  if(!latest || latest.correlation?.correlation_id) return null;
  if(correlated && Number(latest.ts||0)<=Number(correlated.ts||0)) return null;
  return latest;
}

function chooseTraceCorrelation(state) {
  const events=state.timeline||[];
  const active=(state.spans||[]).filter(s=>s.status==='RUNNING' && s.correlation?.correlation_id);
  if(active.length) return active.at(-1).correlation.correlation_id;
  for(let i=events.length-1;i>=0;i--) {
    const corr=events[i].correlation?.correlation_id;
    if(corr) return corr;
  }
  return null;
}
function traceDepth(spanId,parents) {
  let depth=0, current=spanId, seen=new Set();
  while(current && parents.get(current) && !seen.has(current) && depth<8) {
    seen.add(current); current=parents.get(current); depth++;
  }
  return depth;
}
function renderTrace(state) {
  const health=recentAttributionHealth(state);
  const section=$('trace-section'), box=$('trace'), meta=$('trace-meta'), title=$('trace-title');
  title.textContent='Attribution diagnostics';

  if(!health.total || health.unscoped===0) {
    section.hidden=true;
    box.replaceChildren();
    meta.textContent='';
    section.open=false;
    return;
  }

  section.hidden=false;
  const severe=health.rate<90;
  meta.textContent=health.unscoped+' unscoped · '+health.total+' work events · last '+health.windowSeconds+'s';
  meta.title='Recent attribution coverage: '+health.scoped+' scoped, '+health.unscoped+' unscoped.';

  const frag=document.createDocumentFragment();
  for(const event of health.issues.slice(-12).reverse()) {
    const c=event.correlation||{};
    const row=document.createElement('div'); row.className='trace-row attribution-issue';
    const branch=document.createElement('span'); branch.className='trace-branch'; branch.textContent='!';
    const actor=document.createElement('span'); actor.className='trace-actor'; actor.textContent=event.source||'?';
    const msg=document.createElement('span'); msg.className='trace-msg'; msg.textContent=compactMessage(event.message||'');
    row.title=[
      'problem=missing conversation_id',
      c.correlation_id?'correlation='+c.correlation_id:'correlation=unknown',
      c.turn_id?'turn='+c.turn_id:'turn=unknown',
      c.source_quality?'source_quality='+c.source_quality:'source_quality=unknown'
    ].join('\n');
    row.append(branch,actor,msg); frag.append(row);
  }
  box.replaceChildren(frag);

  if(severe) {
    section.open=true;
    section.dataset.disclosureInitialized='true';
  } else if(section.dataset.disclosureInitialized!=='true') {
    section.open=false;
    section.dataset.disclosureInitialized='true';
  }
}

function compactPollingEvents(events) {
  // Raw timeline stays literal and lossless. Grouped/Semantic are projections only.
  return events.map(event=>({...event,repeat_count:1}));
}
function timelineConversationId(event) {
  const c=event?.correlation||{};
  return c.conversation_id||null;
}
function timelineEventsForScope(events,scope,binding) {
  if(scope==='all') return [...events];
  if(scope==='unscoped') return events.filter(event=>!timelineConversationId(event));
  if(scope.startsWith('chat:')) {
    const id=scope.slice(5);
    return events.filter(event=>timelineConversationId(event)===id);
  }
  if(scope.startsWith('task:')) {
    const id=scope.slice(5);
    return events.filter(event=>(event.correlation||{}).task_id===id);
  }
  if(scope.startsWith('run:')) {
    const id=scope.slice(4);
    return events.filter(event=>(event.correlation||{}).run_id===id);
  }
  if(scope.startsWith('span:')) {
    const id=scope.slice(5);
    return events.filter(event=>{ const c=event.correlation||{}; return c.span_id===id || c.parent_span_id===id; });
  }
  if(scope.startsWith('actor:')) {
    const actor=scope.slice(6);
    return events.filter(event=>String(event.source||'')===actor);
  }
  return [...events];
}
function focusTimelineScope(value,label) {
  transientTimelineScope={value,label,persistent:true};
  timelineScope=value;
  timelineScopeOptionsFingerprint='';
  renderedKeys=null;
  if(lastState) {
    renderTimelineScopeOptions();
    renderTimeline(lastState);
  }
  $('timeline-section')?.scrollIntoView({block:'start',behavior:'smooth'});
}
function focusSpanFromTimeline(spanId) {
  if(!spanId || !lastState) return;
  const span=(lastState.spans||[]).find(item=>item.id===spanId);
  if(!span) {
    $('error').textContent='Span '+spanId+' is referenced by this event but is not in the current Observer span snapshot. Raw correlation remains available.';
    return;
  }
  focusedSpanId=spanId;
  const section=$('spans-section');
  section.hidden=false;
  section.open=true;
  renderSpans(lastState);
  const row=[...$('spans').querySelectorAll('.span-row')].find(item=>item.dataset.spanId===spanId);
  if(row) { row.scrollIntoView({block:'center',behavior:'smooth'}); row.focus({preventScroll:true}); }
  else $('error').textContent='Span '+spanId+' is in the Observer snapshot but not in the current recent-span window. Timeline correlation remains available.';
}
function openTimelineRawInspector(event,key) {
  const rawEvents=event._derived ? (event._rawEvents||[]) : [event];
  timelineRawJson=JSON.stringify({
    projection:event._projection||'raw',
    ruleset:event._derived ? event._ruleset : null,
    source_event_refs:rawEvents.map(sourceEventRef),
    source_events:rawEvents
  },null,2);
  $('timeline-raw-title').textContent='Timeline source evidence · '+String(event.source||'?')+' · '+timelineClock(event.ts);
  $('timeline-raw-json').textContent=timelineRawJson;
  $('timeline-raw-copy-status').textContent='';
  timelineRawReturnFocus=[...$('timeline').querySelectorAll('.event')].find(row=>row.dataset.key===key)||null;
  $('timeline-raw-inspector').hidden=false;
  $('timeline-raw-close').focus();
}
function closeTimelineRawInspector() {
  $('timeline-raw-inspector').hidden=true;
  if(timelineRawReturnFocus?.isConnected) timelineRawReturnFocus.focus({preventScroll:true});
  timelineRawReturnFocus=null;
}
function appendTimelineEvidenceActions(full,event,key) {
  const actions=document.createElement('div');
  actions.className='timeline-evidence-actions';
  const inspect=document.createElement('button');
  inspect.type='button'; inspect.textContent='Inspect source JSON';
  inspect.title='Open a full-width, selectable source-event inspector';
  inspect.addEventListener('click',e=>{e.stopPropagation();openTimelineRawInspector(event,key);});
  actions.append(inspect);
  const ids=[...new Set((event._rawEvents||[event]).flatMap(raw=>[raw.correlation?.span_id,raw.correlation?.parent_span_id]).filter(Boolean))];
  for(const id of ids.slice(0,4)) {
    const focus=document.createElement('button');
    focus.type='button'; focus.textContent='Focus span · '+String(id).slice(-8);
    focus.title='Navigate from timeline evidence to the correlated execution span';
    focus.addEventListener('click',e=>{e.stopPropagation();focusSpanFromTimeline(id);});
    actions.append(focus);
  }
  actions.addEventListener('keydown',e=>e.stopPropagation());
  full.append(actions);
}
function sourceEventRef(event) {
  return event.event_id||event.id||eventKey(event);
}
function rawEventProvenance(event) {
  const c=event.correlation||{};
  return [
    event.message||'',
    c.correlation_id ? 'correlation='+c.correlation_id : 'correlation=unknown',
    c.run_id ? 'run='+c.run_id : null,
    c.task_id ? 'task='+c.task_id : null,
    c.plan_id ? 'plan='+c.plan_id : null,
    c.span_id ? 'span='+c.span_id : null,
    c.client ? 'client='+c.client : null,
    c.conversation_id ? 'conversation='+c.conversation_id : null,
    c.turn_id ? 'turn='+c.turn_id : null,
    c.message_id ? 'message='+c.message_id : null,
    c.action_id ? 'action='+c.action_id : null,
    c.action_label ? 'action_label='+c.action_label : null,
    event.process_key ? 'process_key='+event.process_key : null,
    event.process_id!=null ? 'pid='+event.process_id : null,
    'source_quality='+(c.source_quality||'unknown')
  ].filter(Boolean);
}
function firstCorrelation(events) {
  for(const event of events) {
    const c=event.correlation||{};
    if(Object.values(c).some(Boolean)) return {...c};
  }
  return {};
}
function messagePhase(event) {
  const text=String(event?.message||'').toUpperCase();
  if(/^ERROR\b/.test(text)||/\bREQUEST_ERROR\b/.test(text)) return 'ERROR';
  if(/^DONE\b/.test(text)||/^TURN_DONE\b/.test(text)||/\bREQUEST_DONE\b/.test(text)) return 'DONE';
  if(/^CANCELED\b/.test(text)||/^CANCELLED\b/.test(text)) return 'CANCELED';
  if(/^EXITED\b/.test(text)) return 'ENDED_UNKNOWN';
  if(/^TURN_ACTIVE\b/.test(text)) return 'ACTIVE';
  if(/^TURN_START\b/.test(text)||/^START\b/.test(text)||/\bREQUEST_START\b/.test(text)) return 'RUNNING';
  return null;
}
function groupedStatus(kind,events) {
  const phases=events.map(messagePhase).filter(Boolean);
  if(kind==='chat') {
    if(phases.includes('DONE')) return 'DONE';
    if(phases.includes('ACTIVE')) return 'ACTIVE';
    return 'RUNNING';
  }
  for(const phase of [...phases].reverse()) {
    if(['ERROR','CANCELED','ENDED_UNKNOWN','DONE'].includes(phase)) return phase;
  }
  return phases.includes('RUNNING')?'RUNNING':'OBSERVED';
}
function humanStatus(status) {
  return ({
    DONE:'done', ERROR:'error', CANCELED:'canceled', ENDED_UNKNOWN:'ended · outcome unknown',
    ACTIVE:'active', RUNNING:'running', OBSERVED:'observed'
  })[status]||String(status||'observed').toLowerCase();
}
function mcpToolName(events) {
  for(const event of events) {
    const c=event.correlation||{};
    if(c.action_label) return String(c.action_label);
    const m=String(event.message||'').match(/\btool\s+([A-Za-z0-9_.:-]+)/i);
    if(m) return m[1];
  }
  return 'tool call';
}
function processPid(events) {
  for(const event of events) if(event.process_id!=null) return event.process_id;
  for(const event of events) {
    const m=String(event.message||'').match(/\bpid=(\d+)/i);
    if(m) return Number(m[1]);
  }
  return null;
}
function makeGroupedItem(kind,key,events,firstIndex) {
  const sorted=[...events].sort((a,b)=>(a.ts||0)-(b.ts||0));
  const status=groupedStatus(kind,sorted);
  const latest=sorted.at(-1)||{};
  const correlation=firstCorrelation(sorted);
  let source=latest.source||'?';
  let message='Observed activity · '+humanStatus(status);
  if(kind==='mcp') {
    source='MCP';
    const tool=mcpToolName(sorted);
    let outcome=humanStatus(status);
    const terminal=String([...sorted].reverse().find(event=>['ERROR','DONE','CANCELED'].includes(messagePhase(event)))?.message||'');
    if(status==='ERROR' && /denied|blocked|paused/i.test(terminal)) outcome='blocked';
    else if(status==='ERROR' && /cancel/i.test(terminal)) outcome='canceled';
    message=tool+' · '+outcome;
  } else if(kind==='chat') {
    source='CHAT';
    message='ChatGPT turn · '+humanStatus(status);
  } else if(kind==='process') {
    source='TERM';
    const pid=processPid(sorted);
    message=(pid!=null?'Process '+pid:'Process execution')+' · '+humanStatus(status);
  }
  return {
    ts:Math.max(...sorted.map(event=>Number(event.ts)||0)),
    source,message,correlation,
    _derived:true,_projection:'grouped',_ruleset:'timeline-grouped-v1',_groupKind:kind,_groupKey:key,
    _status:status,_rawEvents:sorted,_derivedFrom:sorted.map(sourceEventRef),_firstIndex:firstIndex
  };
}
function groupedTimelineEvents(events) {
  const groups=new Map();
  const singles=[];
  events.forEach((event,index)=>{
    const c=event.correlation||{};
    let kind=null,key=null;
    if(event.source==='CHAT' && (c.turn_id||c.run_id||c.span_id)) {
      kind='chat'; key='chat:'+(c.turn_id||c.run_id||c.span_id);
    } else if(event.source==='MCP' && (c.correlation_id||c.span_id)) {
      kind='mcp'; key='mcp:'+(c.correlation_id||c.span_id);
    } else if((event.source==='RDC'||event.source==='TERM') && event.process_key) {
      kind='process'; key='process:'+event.process_key;
    }
    if(!key) {
      singles.push({_firstIndex:index,item:{...event,_derived:false,_projection:'raw'}});
      return;
    }
    if(!groups.has(key)) groups.set(key,{kind,key,events:[],firstIndex:index});
    groups.get(key).events.push(event);
  });
  const projected=[...singles];
  for(const group of groups.values()) projected.push({_firstIndex:group.firstIndex,item:makeGroupedItem(group.kind,group.key,group.events,group.firstIndex)});
  projected.sort((a,b)=>a._firstIndex-b._firstIndex);
  return projected.map(entry=>entry.item);
}
function processCommand(events) {
  for(const event of events) {
    if(event.source!=='RDC') continue;
    const text=String(event.message||'');
    const marker='start_process:';
    const at=text.indexOf(marker);
    if(at>=0) return text.slice(at+marker.length).trim();
  }
  return '';
}
function semanticCommandLabel(command) {
  const c=String(command||'');
  if(/\bnpm\s+test\b|\bnode\s+--test\b/.test(c)) return 'Run automated tests';
  if(/\bgit\s+(diff|status|log|show)\b/.test(c) && !/\bgit\s+(add|commit|push)\b/.test(c)) return 'Inspect repository state';
  if(/\bgit\s+commit\b/.test(c) && /\bgit\s+push\b/.test(c)) return 'Checkpoint and publish changes';
  if(/\bgit\s+(add|commit|push)\b/.test(c)) return 'Update Git checkpoint';
  if(/python3?\s+-\s+<<|Path\([^)]*\)\.write_text|\.replace\(/.test(c)) return 'Modify source or test files';
  if(/\b(grep|sed|find|cat)\b/.test(c)) return 'Inspect repository files';
  return 'Run local command';
}
function semanticTimelineEvents(events) {
  return groupedTimelineEvents(events).map(item=>{
    if(!item._derived) {
      return {
        ...item,
        _derived:true,_projection:'semantic',_ruleset:'timeline-semantic-v1',_groupKind:'event',
        _status:messagePhase(item)||'OBSERVED',_rawEvents:[{...item,_derived:undefined,_projection:undefined}],_derivedFrom:[sourceEventRef(item)],
        message:compactMessage(item.message||'')
      };
    }
    let source=item.source, message=item.message;
    if(item._groupKind==='process') {
      source='EXEC';
      message=semanticCommandLabel(processCommand(item._rawEvents))+' · '+humanStatus(item._status);
    } else if(item._groupKind==='mcp') {
      message='Tool '+mcpToolName(item._rawEvents)+' · '+humanStatus(item._status);
      const terminal=String([...item._rawEvents].reverse().find(event=>messagePhase(event)==='ERROR')?.message||'');
      if(item._status==='ERROR' && /denied|blocked|paused/i.test(terminal)) message='Tool '+mcpToolName(item._rawEvents)+' · blocked';
      else if(item._status==='ERROR' && /cancel/i.test(terminal)) message='Tool '+mcpToolName(item._rawEvents)+' · canceled';
    } else if(item._groupKind==='chat') {
      message='ChatGPT turn · '+humanStatus(item._status);
    }
    return {...item,source,message,_projection:'semantic',_ruleset:'timeline-semantic-v1'};
  });
}
function projectTimeline(events,view) {
  const raw=compactPollingEvents(events);
  if(view==='grouped') return groupedTimelineEvents(raw);
  if(view==='semantic') return semanticTimelineEvents(raw);
  return raw.map(event=>({...event,_derived:false,_projection:'raw'}));
}
function projectedEventKey(event) {
  if(!event._derived) return 'raw|'+eventKey(event);
  return [event._projection,event._ruleset,event._groupKey||event._groupKind||'',...(event._derivedFrom||[])].join('|');
}
function appendSourceChatButton(full,conversationId) {
  if(!conversationId) return;
  const nav=document.createElement('button');
  nav.className='source-chat-button';
  nav.textContent='Open source chat';
  nav.title='Activate the ChatGPT conversation that owns this event';
  nav.addEventListener('click',async e=>{
    e.stopPropagation();
    nav.disabled=true;
    const idleLabel='Open source chat';
    try {
      const result=await send({type:'conversation-open',conversation_id:conversationId});
      $('error').textContent='';
      nav.textContent=result?.opened==='current'?'Source chat is current':'Opened source chat';
      nav.title=result?.opened==='current'?'This event belongs to the ChatGPT conversation already active in this window.':'The ChatGPT conversation that owns this event was activated.';
      setTimeout(()=>{ nav.textContent=idleLabel; nav.title='Activate the ChatGPT conversation that owns this event'; nav.disabled=false; },1600);
    } catch(err) {
      $('error').textContent=String(err?.message||err);
      nav.textContent='Open failed · retry';
      nav.title='Source chat could not be opened. Click to retry.';
      nav.disabled=false;
    }
  });
  full.append(document.createElement('br'),nav);
}
function appendRawEventDrilldown(full,event,key) {
  const rawEvents=event._rawEvents||[];
  if(!event._derived || !rawEvents.length) return;
  const button=document.createElement('button');
  button.className='source-chat-button raw-events-button';
  const rawBox=document.createElement('div');
  rawBox.className='raw-event-list';
  const revealed=rawRevealKeys.has(key);
  rawBox.hidden=!revealed;
  const label=()=>((rawBox.hidden?'Show ':'Hide ')+rawEvents.length+' raw event'+(rawEvents.length===1?'':'s'));
  button.textContent=label();
  button.title='Reveal the exact source ledger events used to derive this row';
  for(const raw of rawEvents) {
    const item=document.createElement('div'); item.className='raw-event-item';
    const head=document.createElement('div'); head.className='raw-event-head';
    head.textContent=new Date((raw.ts||0)*1000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false})+'  '+String(raw.source||'?')+'  '+String(raw.message||'');
    const detail=document.createElement('pre'); detail.textContent=rawEventProvenance(raw).slice(1).join('\n');
    item.append(head,detail); rawBox.append(item);
  }
  button.addEventListener('click',e=>{
    e.stopPropagation();
    rawBox.hidden=!rawBox.hidden;
    if(rawBox.hidden) rawRevealKeys.delete(key); else rawRevealKeys.add(key);
    button.textContent=label();
  });
  full.append(document.createElement('br'),button,rawBox);
}
const QUIESCENCE_QUIET_SECONDS=15;
function quiescenceOutstandingSpans(state) {
  const now=Date.now()/1000;
  return (state.spans||[]).filter(span=>{
    const status=String(span.status||'').toUpperCase();
    if(['DONE','ERROR','CANCELED','EXITED'].includes(status)) return false;
    if(status==='WAITING' && span.actor==='TERM') {
      const updated=Number(span.updated||span.started||0);
      return updated>0 && now-updated<=30;
    }
    return true;
  });
}
function quiescenceRelevantEvents(state) {
  const workSources=new Set(['MCP','RDC','TERM','OC','QWEN','LLAMA','ACTION','CHAT']);
  const currentId=currentBrowserConversationId;
  const events=state.timeline||[];
  return events.filter(event=>{
    if(!workSources.has(String(event.source||'').toUpperCase())) return false;
    const conversation=timelineConversationId(event);
    if(currentId && conversation===currentId) return true;
    // Until gateway attribution is authoritative, recent unscoped execution must
    // conservatively delay a "safe next request" claim.
    return !conversation && String(event.source||'').toUpperCase()!=='CHAT';
  });
}
function deriveQuiescence(state) {
  const now=Date.now()/1000;
  const chat=browserLocalChatActivity||state.chat_activity||{state:'idle'};
  const chatState=String(chat.state||'idle');
  const spans=quiescenceOutstandingSpans(state);
  const events=quiescenceRelevantEvents(state);
  const latest=events.length?events.reduce((a,b)=>Number(a.ts||0)>=Number(b.ts||0)?a:b):null;
  const latestTs=latest?.ts?Number(latest.ts):null;
  const latestAge=latestTs ? Math.max(0,now-latestTs) : null;
  const latestLabel=latest ? String(latest.source||'?')+' · '+compactMessage(latest.message||'') : 'none observed';
  if(chatState==='active' || spans.some(span=>String(span.status||'').toUpperCase()==='RUNNING')) {
    return {state:'WORKING',safe:false,quality:'observer_inferred',reason:chatState==='active'?'ChatGPT turn has positive activity evidence':spans.length+' execution span(s) are running',latestAge,latestLabel,latestTs};
  }
  if(chatState==='waiting_user' || pendingActionApprovalCount>0) {
    return {state:'SETTLING',safe:false,quality:'observer_inferred',reason:pendingActionApprovalCount>0?pendingActionApprovalCount+' browser action approval(s) are pending':'ChatGPT turn is waiting for user input/approval',latestAge,latestLabel,latestTs};
  }
  if(chatState==='pending') {
    return {state:'SETTLING',safe:false,quality:'observer_inferred',reason:'ChatGPT turn is still open without positive activity evidence',latestAge,latestLabel,latestTs};
  }
  if(spans.length) {
    return {state:'SETTLING',safe:false,quality:'observer_inferred',reason:spans.length+' non-terminal execution span(s) remain observable',latestAge,latestLabel,latestTs};
  }
  if(latestAge!==null && latestAge<QUIESCENCE_QUIET_SECONDS) {
    const remaining=Math.max(1,Math.ceil(QUIESCENCE_QUIET_SECONDS-latestAge));
    return {state:'SETTLING',safe:false,quality:'observer_inferred',reason:'quiet-window probation · '+remaining+'s remaining after latest relevant evidence',latestAge,latestLabel,latestTs};
  }
  return {
    state:'QUIESCENT',safe:true,quality:'observer_inferred',
    reason:latestAge===null?'no outstanding observed execution and no recent relevant evidence':'no outstanding observed execution · quiet for '+Math.floor(latestAge)+'s',
    latestAge,latestLabel,latestTs
  };
}
function renderTimelineLive(state,rawCount,totalCount,displayCount) {
  const live=activeSpans(state).length>0 || browserLocalChatActivity?.state==='active';
  const cluster=$('position');
  cluster.classList.toggle('active',live);
  const total=Number.isFinite(totalCount)?totalCount:rawCount;
  const viewName=timelineView[0].toUpperCase()+timelineView.slice(1);
  $('timeline-live-trigger').title=live
    ? 'Live activity: an observed span or ChatGPT turn is active. Header IDLE only refers to observed executor activity.'
    : 'Live timeline: no positive activity evidence right now. This does not prove platform dispatch is complete.';
  const q=deriveQuiescence(state);
  cluster.classList.remove('working','settling','quiescent');
  cluster.classList.add(q.state.toLowerCase());
  const badge=$('timeline-quiescence');
  badge.textContent=q.state;
  badge.className='timeline-quiescence '+q.state.toLowerCase();
  badge.removeAttribute('title');
  badge.setAttribute('aria-label',q.state==='QUIESCENT'
    ? 'Observed quiescence: no known outstanding work; observer-inferred until GW-01 owns dispatch.'
    : q.state+'; current idle gap is not a proven end-of-turn boundary.');

  $('timeline-activity-summary').textContent=live?'ACTIVE':'IDLE';
  $('timeline-quiescence-summary').textContent=q.state;
  $('timeline-last-evidence').textContent=q.latestTs
    ? new Date(q.latestTs*1000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false})+' · '+seconds(q.latestAge)+' ago'
    : 'none observed';
  $('timeline-window-summary').textContent=rawCount.toLocaleString()+' / '+total.toLocaleString()+' raw events';
  $('timeline-view-summary').textContent=viewName+' · '+displayCount.toLocaleString()+' row'+(displayCount===1?'':'s');
  $('timeline-usage-summary').textContent=compactUsageSummary(currentUsage(state));
  $('timeline-live-updated').textContent='updated '+new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
  $('timeline-quiescence-reason').textContent=q.reason+'. Latest: '+q.latestLabel+'.';
}

function renderTimeline(state) {
  const box=$('timeline');
  const allEvents=state.timeline||[];
  const scoped=state.timeline_scopes?.[timelineScope];
  const events=Array.isArray(scoped)?scoped:timelineEventsForScope(allEvents,timelineScope,currentConversationBinding);
  const projected=projectTimeline(events,timelineView);
  const keys=projected.map(projectedEventKey);
  const unchanged=Array.isArray(renderedKeys) && keys.length===renderedKeys.length && keys.every((key,i)=>key===renderedKeys[i]);
  if(!unchanged) {
    for(const row of box.querySelectorAll('.event.expanded')) expandedKeys.add(row.dataset.key);
    const nearTop=box.scrollTop<24;
    const displayEvents=[...projected].reverse();
    const displayKeys=[...keys].reverse();
    const visibleDays=new Set(displayEvents.map(event=>timelineDay(event.ts)));
    const showDayDividers=visibleDays.size>1;
    const frag=document.createDocumentFragment();
    let previousDay=null;
    for(let i=0;i<displayEvents.length;i++) {
      const event=displayEvents[i], key=displayKeys[i]||projectedEventKey(event);
      const day=timelineDay(event.ts);
      if(showDayDividers && day!==previousDay) {
        const divider=document.createElement('div');
        divider.className='event-day';
        divider.textContent=day;
        divider.title='Calendar day for the events below';
        frag.append(divider);
      }
      previousDay=day;
      const row=document.createElement('div'); row.className='event'+(event._derived?' derived-event':''); row.dataset.key=key; row.tabIndex=0;
      if(expandedKeys.has(key)) row.classList.add('expanded');
      const time=document.createElement('span'); time.className='event-time'; time.textContent=timelineClock(event.ts); time.title=timelineTimestampTitle(event.ts);
      const src=document.createElement('span'); src.className='src'; src.textContent=event.source;
      const c=event.correlation||{};
      const prefix=!event._derived && c.correlation_id?'['+correlationShort(c.correlation_id)+'] '+(c.parent_span_id?'↳ ':''):'';
      const msg=document.createElement('span'); msg.className='msg'; msg.textContent=prefix+compactMessage(event.message||''); msg.title=event.message||'';
      const full=document.createElement('div'); full.className='event-full';
      if(event._derived) {
        const metadata=[
          'projection='+event._ruleset,
          'derived_from='+(event._derivedFrom||[]).length+' raw event'+((event._derivedFrom||[]).length===1?'':'s'),
          event._status?'status='+event._status:null,
          c.correlation_id?'correlation='+c.correlation_id:'correlation=unknown',
          c.conversation_id?'conversation='+c.conversation_id:null,
          c.turn_id?'turn='+c.turn_id:null,
          'source_quality='+(c.source_quality||'unknown')
        ].filter(Boolean);
        full.textContent=metadata.join('\n');
        appendRawEventDrilldown(full,event,key);
      } else {
        full.textContent=rawEventProvenance(event).join('\n');
      }
      appendSourceChatButton(full,c.conversation_id);
      appendTimelineEvidenceActions(full,event,key);
      const toggle=()=>{ row.classList.toggle('expanded'); if(row.classList.contains('expanded')) expandedKeys.add(key); else expandedKeys.delete(key); };
      row.addEventListener('click',toggle);
      row.addEventListener('keydown',e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); toggle(); }});
      row.append(time,src,msg,full); frag.append(row);
    }
    box.replaceChildren(frag);
    renderedKeys=keys;
    if(follow || nearTop) { box.scrollTop=0; follow=true; }
  }
  const current=currentConversationBinding?.conversation_id;
  $('current-conversation').textContent=current ? 'chat '+String(current).slice(-8) : (timelineScope==='unscoped'?'without chat identity':'');
  const scopeTotal=Number(state.timeline_scope_totals?.[timelineScope]);
  renderTimelineLive(state,events.length,Number.isFinite(scopeTotal)?scopeTotal:allEvents.length,projected.length);
}

let refreshInFlight=null;
async function refresh() {
  if(refreshInFlight) return refreshInFlight;
  refreshInFlight=(async()=>{
    let currentConversationState=null;
    try {
      currentConversationState=await send({type:'conversation-current'});
      browserLocalChatActivity=currentConversationState?.activity||null;
      currentBrowserConversationId=currentConversationState?.binding?.conversation_id||null;
    } catch {
      browserLocalChatActivity=null;
      currentBrowserConversationId=null;
    }
    try {
      const dashboard=await send({type:'dashboard-state'});
      const state=dashboard?.observer;
      if(!state) throw new Error('dashboard_state_missing_observer');
      state.chat_local_activity=browserLocalChatActivity;
      timelineConversationIds=meaningfulTimelineConversationIds(state.timeline||[]);
      try {
        const conversationState=await send({type:'conversation-state'});
        const activeBinding=currentConversationState?.binding ? {...currentConversationState.binding,is_current:true} : null;
        const cachedBindings=conversationState?.bindings||[];
        const ledgerBindings=[];
        for(const event of (state.timeline||[])) {
          const id=timelineConversationId(event);
          if(!id) continue;
          const c=event.correlation||{};
          ledgerBindings.push({conversation_id:id,title:event.meta?.title||'',url:c.locator||event.meta?.url||'',source_quality:c.source_quality||'unknown',observedAt:event.ts||0});
        }
        const byMergedId=new Map();
        for(const binding of ledgerBindings) {
          if(!binding?.conversation_id) continue;
          const prior=byMergedId.get(binding.conversation_id)||{};
          byMergedId.set(binding.conversation_id,{...prior,...binding});
        }
        for(const binding of cachedBindings) {
          if(!binding?.conversation_id) continue;
          const prior=byMergedId.get(binding.conversation_id)||{};
          byMergedId.set(binding.conversation_id,{...prior,...binding});
        }
        if(activeBinding?.conversation_id) {
          const prior=byMergedId.get(activeBinding.conversation_id)||{};
          byMergedId.set(activeBinding.conversation_id,{...prior,...activeBinding});
        }
        knownConversationBindings=[...byMergedId.values()];
        renderTimelineScopeOptions();
      } catch {
        knownConversationBindings=[];
        currentConversationBinding=null;
      }
      lastState=state;
      renderActors(state,dashboard.connection?.status!=='OFFLINE');
      if(selectedActor && !$('actor-inspector').hidden) renderActorInspector(state,selectedActor);
      renderHeader(state);
      let extensionControl={};
      try { extensionControl=await send({type:'state'}); } catch {}
      renderExtensionVersion(state,extensionControl);
      renderAttributionHealth(state);
      renderReliabilityIncidents(dashboard.incidents||[],dashboard.connection||{});
      renderPreparedResult(state);
      renderDetachedRun(state);
      renderLocalExecutorProgress(state);
      renderRdcExecution(dashboard.rdc);
      renderPreparedDispatchSnapshot(dashboard.prepared_dispatch,dashboard.executor_policy);
      renderRunMeta(state);
      renderTaskLifecycle(state);
      renderProjectStatus(state);
      renderProjectTasks(dashboard.project_tasks);
      renderSpans(state);
      renderRdc(state);
      renderTrace(state);
      renderTimeline(state);
      await refreshConnectionRequests();
      const connection=dashboard.connection||{status:'CONNECTED'};
      const companionStatus=$('companion-status');
      if(companionStatus) {
        const label=connection.status==='CONNECTED'?'COMPANION CONNECTED':connection.status==='THROTTLED'?'COMPANION THROTTLED':'COMPANION OFFLINE';
        companionStatus.textContent=label;
        companionStatus.className='companion-status '+(connection.status==='CONNECTED'?'connected':connection.status==='THROTTLED'?'throttled':'offline');
      }
      if(connection.status==='THROTTLED') {
        const retry=Math.max(0,Number(connection.retry_after_ms)||0);
        $('error').textContent='THROTTLED · companion rate limit · retry in '+Math.ceil(retry/1000)+'s · showing cached state';
        $('state-label').textContent='THROTTLED';
        $('state-dot').className='state-dot waiting';
        $('active-chain').textContent='Cached companion state · browser-local activity remains live';
      } else if(connection.status==='OFFLINE') {
        $('error').textContent=connection.error||'Companion unavailable · showing cached state';
        $('state-label').textContent='OFFLINE';
        $('state-dot').className='state-dot error';
        $('active-chain').textContent='Cached companion state · browser-local activity remains live';
      } else {
        $('error').textContent='';
      }
    } catch(e) {
      const message=String(e?.message||e);
      const degraded=message.includes('observer_unavailable')||message.includes('dashboard_unavailable');
      $('error').textContent=message;
      $('state-label').textContent=degraded?'DEGRADED':'OFFLINE';
      $('state-dot').className='state-dot error';
      $('active-chain').textContent=degraded?'Dashboard snapshot unavailable':'Companion unavailable';
      const companionStatus=$('companion-status');
      if(companionStatus) { companionStatus.textContent='COMPANION OFFLINE'; companionStatus.className='companion-status offline'; }
      renderActors(lastState?{...lastState,chat_local_activity:browserLocalChatActivity}:{chat_local_activity:browserLocalChatActivity},false);
      try { const incidentState=await send({type:'observer-incidents'}); renderReliabilityIncidents(incidentState?.incidents||[],{status:'OFFLINE'}); } catch {}
    }
  })();
  try { return await refreshInFlight; }
  finally { refreshInFlight=null; }
}
must('reload-version').addEventListener('click',async()=>{
  const button=must('reload-version');
  button.disabled=true;
  try { await send({type:'reload-extension'}); }
  catch { /* runtime reload can invalidate the message channel after acceptance */ }
});
must('project-task-select').addEventListener('change',()=>{
  const id=$('project-task-select').value;
  const task=(projectTaskSnapshot?.tasks||[]).find(item=>item.id===id);
  const description=$('project-task-description');
  const text=task ? task.id+' · '+task.title+' · '+task.percent+'% · '+task.eta+' remaining\n'+(task.detail||'No TODO.md description available.') : 'No backlog task selected.';
  if(description.textContent!==text) description.textContent=text;
});
must('take-next-task').addEventListener('click',async()=>{
  const status=$('project-task-admission-status');
  const button=$('take-next-task');
  button.disabled=true; status.textContent='Taking recommended backlog item…';
  try {
    const admission=await send({type:'task-admission',action:'take_next'});
    status.textContent='ADMITTED · '+admission.backlog_task_id+' · creating Current task';
    await refresh();
  } catch(e) { status.textContent=String(e?.message||e); await refresh(); }
});

must('take-selected-task').addEventListener('click',async()=>{
  const id=$('project-task-select').value;
  const status=$('project-task-admission-status');
  if(!id) return;
  const button=$('take-selected-task');
  button.disabled=true; status.textContent='Taking '+id+'…';
  try {
    const admission=await send({type:'task-admission',action:'take',task_id:id});
    status.textContent='ADMITTED · '+admission.backlog_task_id+' · creating Current task';
    await refresh();
  } catch(e) { status.textContent=String(e?.message||e); await refresh(); }
});

must('prepare-current-task').addEventListener('click',async()=>{
  const status=$('project-task-admission-status');
  const button=$('prepare-current-task');
  button.disabled=true; status.textContent='Preparing bounded handoff…';
  try {
    const result=await send({type:'task-admission',action:'prepare'});
    status.textContent='READY FOR HANDOFF · '+(result.prepared?.task_id||'bounded task');
    await refresh();
  } catch(e) { status.textContent=String(e?.message||e); await refresh(); }
});

must('release-current-task').addEventListener('click',async()=>{
  const status=$('project-task-admission-status');
  const button=$('release-current-task');
  button.disabled=true; status.textContent='Releasing current admission…';
  try {
    const admission=await send({type:'task-admission',action:'release'});
    status.textContent='RELEASED · '+admission.backlog_task_id;
    await refresh();
  } catch(e) { status.textContent=String(e?.message||e); await refresh(); }
});

must('timeline').addEventListener('scroll',()=>{
  const box=must('timeline');
  follow=box.scrollTop<24;
});
must('timeline-scope-trigger').addEventListener('click',()=>{
  const list=must('timeline-scope-list');
  setTimelineScopeOpen(list.hidden);
});
must('timeline-scope-trigger').addEventListener('keydown',event=>{
  if(['ArrowDown','ArrowUp','Enter',' '].includes(event.key)) {
    event.preventDefault();
    setTimelineScopeOpen(true);
    if(event.key==='ArrowDown') moveTimelineScopeFocus(1);
    else if(event.key==='ArrowUp') moveTimelineScopeFocus(-1);
  }
});
must('timeline-scope-list').addEventListener('click',event=>{
  const option=event.target.closest('.timeline-scope-option');
  if(option) applyTimelineScope(option.dataset.value);
});
must('timeline-scope-list').addEventListener('keydown',event=>{
  if(event.key==='ArrowDown'){event.preventDefault();moveTimelineScopeFocus(1);}
  else if(event.key==='ArrowUp'){event.preventDefault();moveTimelineScopeFocus(-1);}
  else if(event.key==='Home'){event.preventDefault();moveTimelineScopeFocus('home');}
  else if(event.key==='End'){event.preventDefault();moveTimelineScopeFocus('end');}
  else if(event.key==='Enter'||event.key===' '){
    const option=event.target.closest('.timeline-scope-option');
    if(option){event.preventDefault();applyTimelineScope(option.dataset.value);}
  } else if(event.key==='Escape') {
    event.preventDefault();
    setTimelineScopeOpen(false,{focusSelected:false});
    must('timeline-scope-trigger').focus();
  }
});
document.addEventListener('pointerdown',event=>{
  if(!event.target.closest('#timeline-scope-control')) setTimelineScopeOpen(false,{focusSelected:false});
});
function setObserverDensity(value) {
  if(!DENSITIES.has(value)) return;
  observerDensity=value;
  document.body.dataset.density=value;
  for(const button of must('observer-density').querySelectorAll('button[data-density]')) {
    button.setAttribute('aria-pressed',String(button.dataset.density===value));
  }
  try { localStorage.setItem('edh.observer.density',value); } catch {}
}
setObserverDensity(observerDensity);
must('observer-density').addEventListener('click',event=>{
  const button=event.target.closest('button[data-density]');
  if(button) setObserverDensity(button.dataset.density);
});
must('timeline-raw-close').addEventListener('click',closeTimelineRawInspector);
must('timeline-raw-inspector').addEventListener('keydown',event=>{
  if(event.key==='Escape') {event.preventDefault();closeTimelineRawInspector();}
});
must('timeline-raw-copy').addEventListener('click',async()=>{
  try {
    await navigator.clipboard.writeText(timelineRawJson);
    $('timeline-raw-copy-status').textContent='Copied';
  } catch(error) {
    $('timeline-raw-copy-status').textContent='Clipboard denied; select text in the inspector and copy manually.';
  }
});
must('timeline-view').addEventListener('click',event=>{
  const button=event.target.closest('button[data-view]');
  if(!button) return;
  const next=button.dataset.view;
  if(!['raw','grouped','semantic'].includes(next) || next===timelineView) return;
  timelineView=next;
  for(const candidate of must('timeline-view').querySelectorAll('button[data-view]')) candidate.setAttribute('aria-pressed',String(candidate===button));
  renderedKeys=null;
  if(lastState) renderTimeline(lastState);
});
const loadedObserverVersion=chrome.runtime.getManifest().version;
if($('extension-version')) { $('extension-version').textContent='v'+loadedObserverVersion; $('extension-version').title='Loaded Side Panel / extension version '+loadedObserverVersion+' · browser-local identity'; }
async function refreshLoop(){ await refresh(); setTimeout(()=>void refreshLoop(),1500); }
void refreshLoop();

must('help-toggle').addEventListener('click',()=>{$('help-panel').hidden=false;if(lastState){renderRunInspection(lastState);renderHeader(lastState);}});
must('help-close').addEventListener('click',()=>{$('help-panel').hidden=true;});
for(const [id,mode] of [['state-label','execution'],['active-chain','gateway']]) {
  const trigger=must(id);
  trigger.addEventListener('pointerenter',()=>{
    statusExplainDismissed=false;
    showStatusExplanation(mode);
  });
  trigger.addEventListener('pointerleave',scheduleStatusExplainHoverExit);
  trigger.addEventListener('click',()=>{statusExplainDismissed=false;showStatusExplanation(mode,{pin:true});});
}
must('status-explain-popover').addEventListener('pointerenter',cancelStatusExplainHoverExit);
must('status-explain-popover').addEventListener('pointerleave',scheduleStatusExplainHoverExit);
must('status-explain-close').addEventListener('click',()=>{
  statusExplainDismissed=true;
  closeStatusExplanation();
});
// Move the flyout out of the overflow-clipped Run details, without changing its content.
document.body.appendChild(must('run-explain-popover'));
window.addEventListener('resize',()=>{if(!$('run-explain-popover').hidden) positionRunExplanation();});
window.addEventListener('scroll',()=>{if(!$('run-explain-popover').hidden) positionRunExplanation();},true);
must('run-explain-trigger').addEventListener('pointerenter',()=>{
  runExplainDismissed=false;
  showRunExplanation();
});
must('run-explain-trigger').addEventListener('pointerleave',scheduleRunExplainHoverExit);
must('run-explain-trigger').addEventListener('click',event=>{
  event.preventDefault(); event.stopPropagation();
  runExplainDismissed=false;
  showRunExplanation({pin:true});
});
must('run-explain-popover').addEventListener('pointerenter',cancelRunExplainHoverExit);
must('run-explain-popover').addEventListener('pointerleave',scheduleRunExplainHoverExit);
must('run-explain-close').addEventListener('click',()=>{
  runExplainDismissed=true;
  closeRunExplanation();
});
document.addEventListener('pointerdown',event=>{
  if(statusExplainMode && !$('status-explain-popover').contains(event.target) && !['state-label','active-chain'].some(id=>$(id).contains(event.target))) closeStatusExplanation();
  if(!$('run-explain-popover').hidden && !$('run-explain-popover').contains(event.target) && !$('run-explain-trigger').contains(event.target)) closeRunExplanation();
});
document.addEventListener('keydown',event=>{
  if(event.key!=='Escape') return;
  if(statusExplainMode) { const focus=statusExplainMode==='execution'?'state-label':'active-chain';closeStatusExplanation();$(focus).focus(); }
  if(!$('run-explain-popover').hidden) {closeRunExplanation();$('run-explain-trigger').focus();}
});
must('git-popover').addEventListener('pointerenter',()=>gitPopoverHover(true));
must('git-popover').addEventListener('pointerleave',()=>gitPopoverHover(false));
must('git-popover-inspect').addEventListener('click',()=>{setGitPopoverPinned(false);openActorInspector('GIT');});
must('git-popover-close').addEventListener('click',()=>{const wrap=document.querySelector('.actor-strip-wrap');wrap?.classList.add('git-popover-dismissed');setGitPopoverPinned(false);clearTimeout(gitHoverExitTimer);wrap?.classList.remove('git-popover-hovered');must('git-popover-close').blur();});
document.addEventListener('pointerdown',event=>{
  const wrap=document.querySelector('.actor-strip-wrap');
  if(wrap?.classList.contains('git-popover-pinned') && !wrap.contains(event.target)) setGitPopoverPinned(false);
});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape' && document.querySelector('.actor-strip-wrap')?.classList.contains('git-popover-pinned')) {
    setGitPopoverPinned(false);
    gitPopoverHover(false);
    $('actor-strip')?.querySelector('.actor-chip.git')?.focus();
  }
});
must('actor-inspector-close').addEventListener('click',()=>{$('actor-inspector').hidden=true;selectedActor=null;});
must('actor-inspector-timeline').addEventListener('click',()=>{
  if(!selectedActor) return;
  $('actor-inspector').hidden=true;
  focusTimelineScope('actor:'+selectedActor,'Actor · '+selectedActor);
});
must('settings-toggle').addEventListener('click',async()=>{$('settings-panel').hidden=false;await refreshSettings();});
must('settings-close').addEventListener('click',()=>{$('settings-panel').hidden=true;});
must('share-current').addEventListener('click',async()=>{
  try{
    const target=await currentShareTarget();
    if(!target.shareable) throw new Error('Current tab is not a fully loaded HTTP(S) page.');
    await send({type:'share',tabId:target.tabId});
    await refreshSettings();
  }catch(e){$('settings-error').textContent=e.message;}
});
must('pause-actions').addEventListener('click',async()=>{
  try{await send({type:'set-policy',paused:$('pause-actions').dataset.paused!=='true'});await refreshSettings();}
  catch(e){$('settings-error').textContent=e.message;}
});
must('open-options').addEventListener('click',()=>chrome.runtime.openOptionsPage());


must('attribution-health').addEventListener('click',()=>{
  const section=$('trace-section');
  if(section) { section.hidden=false; section.open=true; section.scrollIntoView({block:'nearest'}); }
});
must('gw01-acceptance').addEventListener('click',async()=>{
  const button=$('gw01-acceptance');
  const status=$('gw01-acceptance-status');
  button.disabled=true; status.textContent='Running…';
  try {
    const result=await send({type:'gw01-acceptance'});
    const corr=String(result?.correlation_id||'').replace(/^corr:/,'').slice(0,8);
    status.textContent=(result?.result||'DONE')+' · action→MCP '+String(result?.action_before_mcp_ms??'?')+' ms · ['+corr+']';
    await refresh();
  } catch(e) {
    status.textContent=String(e?.message||e);
  } finally {
    button.disabled=false;
  }
});
must('executor-policy-select').addEventListener('change',async event=>{
  const select=event.currentTarget;
  const status=$('executor-policy-status');
  select.disabled=true; status.textContent='Saving executor policy…';
  try {
    const policy=await send({type:'set-executor-policy',mode:select.value});
    status.textContent=policy.mode+' · dispatch policy · updated '+new Date(policy.updated_at).toLocaleString();
    await refresh();
  } catch(e) { status.textContent=String(e?.message||e); }
  finally { select.disabled=false; }
});

must('create-compare-plan').addEventListener('click',async()=>{
  const button=$('create-compare-plan');
  const status=$('executor-policy-status');
  button.disabled=true; status.textContent='Creating sibling EDH/RDC run plan…';
  try {
    const plan=await send({type:'create-compare-plan'});
    status.textContent='COMPARE PLANNED · '+plan.comparison_id+' · same task/baseline, 2 sibling runs';
  } catch(e) { status.textContent=String(e?.message||e); }
  finally { button.disabled=false; }
});

must('dispatch-prepared').addEventListener('click',async()=>{
  const button=$('dispatch-prepared');
  const status=$('prepared-dispatch-status');
  button.disabled=true; status.textContent='Dispatching…';
  try {
    const result=await send({type:'dispatch-prepared'});
    if(result?.status==='AWAITING_RDC') {
      status.textContent='AWAITING RDC · '+(result.intent?.intent_id||'external handoff recorded');
    } else if(result?.status==='COMPARE_PLANNED') {
      status.textContent='COMPARE PLANNED · '+(result.comparison_id||'2 sibling runs');
    } else {
      status.textContent=(result?.status||'DISPATCHED')+(result?.executor_policy?' · '+result.executor_policy:'')+(result?.pid?' · pid '+result.pid:'');
    }
    await refresh();
  } catch(e) {
    const message=String(e?.message||e);
    status.textContent=message;
    button.disabled=false;
    if(/no prepared Harness task is ready/i.test(message)) {
      const box=$('prepared-dispatch');
      box.hidden=true;
      status.textContent='';
      button.disabled=false;
      if(lastState) renderRunMeta(lastState);
    }
  }
});
