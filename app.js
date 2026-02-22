/* ================================================================
   KLUSPLANNER PRO — v2.0
   Complete rewrite: GitHub collab backend, 3 view modes,
   flexible groups/labels, iCal sync, warm Todoist/Asana UI
   ================================================================ */

// ─── Constants ─────────────────────────────────────────────
const STORAGE_KEY   = "klusplanner_v2";
const CONFIG_KEY    = "klusplanner_gh";
const SESSION_KEY   = "klusplanner_session";

// ─── User accounts (hardcoded) ─────────────────────────────
const USERS = [
  { username: "Martje",  password: "Benja01!",  displayName: "Martje",  avatar: "M" },
  { username: "Justin",  password: "Teun01!",   displayName: "Justin",  avatar: "J" }
];

// ─── Default taxonomy lists (editable by user) ─────────────
const DEFAULT_STATUSES   = ["Backlog","Ingepland","Bezig","Wacht op materiaal","Wacht op hulp/afspraak","Afgerond"];
const DEFAULT_LOCATIONS  = ["Woonkamer","Keuken","Badkamer","Slaapkamer","Tuin","Schuur","Zolder","Hal","Garage","Overloop"];
const DEFAULT_CATEGORIES = ["Schilderwerk","Timmerwerk","Elektra","Loodgieter","Schoonmaak","Verhuizen","Reparatie","Installatie"];
const DEFAULT_PROJECTS   = [];

const GROUP_COLORS  = [
  "#5B8A72","#6B8FBF","#C5952E","#9B6FB5","#DC6B3F",
  "#4A8C9F","#B5694D","#7B886E","#8B6EA8","#CC7A6E",
  "#5C7EA3","#9D8B5E","#6D9B8F","#A67BAB","#C49058"
];

const DEFAULT_GROUPS = [
  { id: "binnen",      name: "Binnen",       color: "#5B8A72" },
  { id: "buiten",      name: "Buiten",       color: "#6B8FBF" },
  { id: "pre-verkoop", name: "Pre-verkoop",  color: "#C5952E" },
  { id: "nieuw-huis",  name: "Nieuw huis",   color: "#9B6FB5" },
  { id: "logistiek",   name: "Logistiek",    color: "#DC6B3F" }
];

// ─── State ─────────────────────────────────────────────────
let state = {
  tasks: [],
  people: [],
  groups: [...DEFAULT_GROUPS],
  statuses: [...DEFAULT_STATUSES],
  locations: [...DEFAULT_LOCATIONS],
  categories: [...DEFAULT_CATEGORIES],
  projects: [...DEFAULT_PROJECTS],
  selectedTaskId: null,
  currentView: "dashboard",
  currentUser: null,
  ganttCollapsed: new Set(),  // group IDs that are collapsed in Gantt
  overzicht: {
    mode: "list",
    agendaZoom: "month",
    ganttZoom: "month",
    focusDate: todayYmd()
  }
};

let githubConfig = null;  // { token, owner, repo }
let isOnline     = false;
let tasksSha     = null;
let peopleSha    = null;
let configSha    = null;  // data/config.json (groups, statuses, locations, categories)

// ─── Dirty state (unsaved changes) ───────────────────────
let isDirty      = false;
let cleanSnapshot= null;  // JSON string of last saved state

// ─── Utility ───────────────────────────────────────────────
function $(id)       { return document.getElementById(id); }
function $$(sel)     { return document.querySelectorAll(sel); }
function todayYmd()  { return ymd(new Date()); }
function ymd(d)      { const p=n=>String(n).padStart(2,"0"); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`; }
function addDays(d,n){ const x=new Date(d); x.setDate(x.getDate()+n); return x; }
function startOfWeek(d){ const x=new Date(d); x.setDate(x.getDate()-((x.getDay()+6)%7)); x.setHours(0,0,0,0); return x; }
function clamp(n,a,b){ return Math.max(a,Math.min(b,n)); }

function fmtDate(iso){
  if(!iso) return "–";
  try { const d=new Date(iso); const p=n=>String(n).padStart(2,"0"); return `${p(d.getDate())}/${p(d.getMonth()+1)}`; } catch(e){ return iso; }
}
function fmtDateTime(iso){
  if(!iso) return "–";
  try {
    // Date-only string (e.g. "2026-03-15") — no time component
    if(/^\d{4}-\d{2}-\d{2}$/.test(iso)){
      const [y,m,d]=iso.split("-");
      return `${d}/${m}/${y}`;
    }
    const d=new Date(iso); const p=n=>String(n).padStart(2,"0");
    return `${p(d.getDate())}/${p(d.getMonth()+1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
  } catch(e){ return iso; }
}
function fmtHours(n){
  if(n==null||n===""||isNaN(n)) return "–";
  return Number(n)%1===0?String(Number(n)):Number(n).toFixed(1).replace(".",",");
}
function escHtml(s){ return String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
// Parse date string safely (date-only "2026-03-15" → local midnight, datetime stays as-is)
function parseDate(s){ return s?new Date(/^\d{4}-\d{2}-\d{2}$/.test(s)?s+"T00:00:00":s):null; }
// Get display start/end for a task (all-day end gets +1 day so bars have width)
function taskDisplayDates(item){
  const s=parseDate(item.scheduled?.start);
  if(!s) return null;
  let e=item.scheduled?.end?parseDate(item.scheduled.end):null;
  if(item.allDay){
    // All-day: end is inclusive date, so add 1 day for display range
    e=e||new Date(s);
    e=new Date(e.getFullYear(),e.getMonth(),e.getDate()+1);
  }
  if(!e) e=new Date(s.getTime()+36e5);
  return {s,e};
}
function slugify(s){ return (s||"").toLowerCase().trim().replace(/\s+/g,"-").replace(/[^a-z0-9\-]/g,"").replace(/-+/g,"-"); }

function statusClass(status){
  if(status==="Afgerond") return "done";
  if(status==="Backlog") return "backlog";
  return "active";
}
function getStatusDot(status){ return statusClass(status); }

function getPersonName(id){
  if(!id) return "–";
  const p=state.people.find(x=>x.id===id);
  return p?p.name:id;
}
function getGroupObj(groupId){
  return state.groups.find(g=>g.id===groupId) || state.groups.find(g=>g.name===groupId) || { id:groupId, name:groupId||"–", color:"#78716C" };
}
function getGroupColor(groupName){
  const g=state.groups.find(x=>x.name===groupName||x.id===groupName);
  return g?g.color:"#78716C";
}

// ─── Toast ────────────────────────────────────────────────
function toast(msg, kind="ok"){
  const el=$("toast");
  if(!el) return;
  el.textContent=msg;
  el.classList.remove("hidden","ok","warn","err");
  el.classList.add(kind);
  clearTimeout(toast._t);
  toast._t=setTimeout(()=>el.classList.add("hidden"), 2200);
}

// ─── DOM helper ───────────────────────────────────────────
function h(tag, attrs={}, children=[]){
  const node=document.createElement(tag);
  for(const [k,v] of Object.entries(attrs)){
    if(k==="class") node.className=v;
    else if(k==="html") node.innerHTML=v;
    else if(k==="style"&&typeof v==="object") Object.assign(node.style,v);
    else if(k.startsWith("on")&&typeof v==="function") node.addEventListener(k.slice(2),v);
    else node.setAttribute(k,v);
  }
  (Array.isArray(children)?children:[children]).forEach(c=>{
    if(c==null) return;
    if(typeof c==="string"||typeof c==="number") node.appendChild(document.createTextNode(String(c)));
    else node.appendChild(c);
  });
  return node;
}

// ─── Materials parser ─────────────────────────────────────
function parseMaterialsText(text){
  return (text||"").split("\n").map(line=>{
    const t=line.trim();
    if(!t) return null;
    const parts=t.split("|").map(p=>p.trim());
    return { item:parts[0]||"", qty:parts[1]||"", status:parts[2]||"" };
  }).filter(Boolean);
}
function materialsToText(mats){
  return (mats||[]).map(m=>{
    if(typeof m==="string") return m;
    return [m.item||"",m.qty||"",m.status||""].filter(Boolean).join(" | ");
  }).join("\n");
}
function parseLines(text){ return (text||"").split("\n").map(l=>l.trim()).filter(Boolean); }

// ─── Schedule helper ──────────────────────────────────────
function ensureSchedule(t){
  if(!t.scheduled||typeof t.scheduled!=="object") t.scheduled={date:"",timeblock:"",start:"",end:""};

  // Migrate legacy date/timeblock → start/end
  if(!t.scheduled.start&&t.scheduled.date){
    if(t.allDay){
      t.scheduled.start=t.scheduled.date;
      if(!t.scheduled.end) t.scheduled.end=t.scheduled.date;
    } else {
      t.scheduled.start=t.scheduled.date+"T09:00";
      if(!t.scheduled.end) t.scheduled.end=t.scheduled.date+"T17:00";
    }
  }

  // If start exists but end is missing/empty → auto-generate end
  if(t.scheduled.start&&!t.scheduled.end){
    if(t.allDay){
      // All-day: end = start (same day)
      t.scheduled.end=t.scheduled.start.slice(0,10);
    } else {
      try {
        const s=parseDate(t.scheduled.start);
        const hrs=Number(t.estimate_hours?.realistic)||1;
        s.setMinutes(s.getMinutes()+Math.round(hrs*60));
        const p=n=>String(n).padStart(2,"0");
        t.scheduled.end=`${s.getFullYear()}-${p(s.getMonth()+1)}-${p(s.getDate())}T${p(s.getHours())}:${p(s.getMinutes())}`;
      } catch(e){}
    }
  }

  // Keep legacy date in sync
  if(t.scheduled.start&&!t.scheduled.date){
    try { t.scheduled.date=t.scheduled.start.split("T")[0].slice(0,10); } catch(e){}
  }

  if(!Array.isArray(t.assignees)) t.assignees=[];
  if(!Array.isArray(t.subtasks)) t.subtasks=[];
  if(typeof t.inCalendar==="undefined") t.inCalendar=true;
  if(typeof t.allDay==="undefined") t.allDay=false;

  // Auto-promote Backlog → Ingepland when scheduled
  if(t.scheduled.start && t.status==="Backlog") t.status="Ingepland";
}

// ═══════════════════════════════════════════════════════════
// GITHUB API
// ═══════════════════════════════════════════════════════════
async function ghFetch(path, opts={}){
  const url=`https://api.github.com/repos/${githubConfig.owner}/${githubConfig.repo}/contents/${path}`;
  const headers={ "Authorization":`Bearer ${githubConfig.token}`, "Accept":"application/vnd.github.v3+json", ...opts.headers };
  const res=await fetch(url, { ...opts, headers });
  if(!res.ok){
    const err=await res.json().catch(()=>({}));
    const e=new Error(err.message||`GitHub ${res.status}`);
    e.status=res.status;
    throw e;
  }
  return res.json();
}

// Read file → {content, sha} or null if 404
async function ghRead(path){
  try {
    const data=await ghFetch(path);
    const raw=atob(data.content.replace(/\n/g,""));
    return { content:JSON.parse(raw), sha:data.sha };
  } catch(e){
    if(e.status===404) return null;
    throw e;
  }
}

// Get just the SHA of a file, or null if not found
async function ghSha(path){
  try { const d=await ghFetch(path); return d.sha; }
  catch(e){ return null; }
}

// Write file. Auto-fetches SHA if missing or mismatched.
async function ghWrite(path, content, sha, message){
  const encoded=btoa(unescape(encodeURIComponent(JSON.stringify(content,null,2))));

  async function attempt(useSha){
    const body={ message, content:encoded };
    if(useSha) body.sha=useSha;
    const data=await ghFetch(path, { method:"PUT", body:JSON.stringify(body) });
    return data.content.sha;
  }

  try {
    return await attempt(sha);
  } catch(e){
    // SHA mismatch or file exists without SHA → fetch current SHA and retry
    if(e.status===409||e.status===422){
      const currentSha=await ghSha(path);
      return await attempt(currentSha);
    }
    throw e;
  }
}

async function ghValidate(){
  try { await ghFetch(""); return true; }
  catch(e){ return false; }
}

// ─── Sync from GitHub ─────────────────────────────────────
async function syncFromGitHub(silent){
  if(!githubConfig) return false;
  try {
    updateSyncIndicator("syncing");

    // Read all three files in parallel (ghRead returns null for 404)
    const [td,pd,cd]=await Promise.all([
      ghRead("data/tasks.json"),
      ghRead("data/people.json"),
      ghRead("data/config.json")
    ]);

    if(td){ state.tasks=td.content||[]; tasksSha=td.sha; }
    if(pd){ state.people=pd.content||[]; peopleSha=pd.sha; }
    if(cd){
      const c=cd.content||{};
      if(c.groups?.length) state.groups=c.groups;
      if(c.statuses?.length) state.statuses=c.statuses;
      if(c.locations?.length) state.locations=c.locations;
      if(c.categories?.length) state.categories=c.categories;
      if(c.projects) state.projects=c.projects;
      configSha=cd.sha;
    }

    state.tasks.forEach(t=>ensureSchedule(t));
    saveLocal();

    // Track .ics SHA for future pushes
    try { const icsData=await ghSha("klusplanner.ics"); if(icsData) icsSha=icsData; } catch(e){}

    updateSyncIndicator("online");
    return true;
  } catch(e){
    console.error("syncFrom:", e);
    updateSyncIndicator("error");
    if(!silent) toast("Sync ophalen mislukt: "+e.message,"err");
    return false;
  }
}

// ─── Sync to GitHub (SEQUENTIAL writes to avoid 409) ──────
async function syncToGitHub(){
  if(!githubConfig) return false;
  try {
    updateSyncIndicator("syncing");

    const cfg={
      groups:state.groups, statuses:state.statuses,
      locations:state.locations, categories:state.categories, projects:state.projects
    };

    // Write one at a time — parallel commits cause 409 conflicts
    tasksSha  =await ghWrite("data/tasks.json",  state.tasks,  tasksSha,  "Update tasks");
    peopleSha =await ghWrite("data/people.json", state.people, peopleSha, "Update people");
    configSha =await ghWrite("data/config.json", cfg,          configSha, "Update config");

    // Auto-push .ics for live calendar subscriptions
    await pushICalToGitHub().catch(e=>console.warn("iCal push:",e));

    updateSyncIndicator("online");
    toast("Gesynchroniseerd ✓");
    return true;
  } catch(e){
    console.error("syncTo:", e);
    updateSyncIndicator("error");
    toast("Sync opslaan mislukt: "+e.message,"err");
    return false;
  }
}

function updateSyncIndicator(status){
  const dot=$("sync-indicator")?.querySelector(".sync-dot");
  const label=$("sync-label");
  if(!dot||!label) return;
  dot.classList.remove("online","syncing");
  if(status==="online"){ dot.classList.add("online"); label.textContent="Verbonden"; isOnline=true; }
  else if(status==="syncing"){ dot.classList.add("syncing"); label.textContent="Syncing..."; }
  else if(status==="error"){ label.textContent="Sync fout"; }
  else { label.textContent="Offline"; isOnline=false; }
}

// ─── Local storage ────────────────────────────────────────
function saveLocal(){
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({
    tasks:state.tasks, people:state.people, groups:state.groups,
    statuses:state.statuses, locations:state.locations, categories:state.categories, projects:state.projects
  })); } catch(e){}
}
function loadLocal(){
  try { const d=JSON.parse(localStorage.getItem(STORAGE_KEY)); if(d) return d; } catch(e){} return null;
}
function saveGHConfig(){
  if(!githubConfig) { localStorage.removeItem(CONFIG_KEY); return; }
  try { localStorage.setItem(CONFIG_KEY, JSON.stringify(githubConfig)); } catch(e){}
}
function loadGHConfig(){
  try { return JSON.parse(localStorage.getItem(CONFIG_KEY)); } catch(e){ return null; }
}
function saveSession(){
  if(!state.currentUser) { localStorage.removeItem(SESSION_KEY); return; }
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(state.currentUser)); } catch(e){}
}
function loadSession(){
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch(e){ return null; }
}

// ─── Dirty state management ──────────────────────────────
function takeSnapshot(){
  cleanSnapshot=JSON.stringify({
    tasks:state.tasks, people:state.people, groups:state.groups,
    statuses:state.statuses, locations:state.locations, categories:state.categories, projects:state.projects
  });
}

function markDirty(){
  // Always persist to localStorage immediately — survives hard refresh
  saveLocal();
  if(!isDirty){
    isDirty=true;
    try { localStorage.setItem(STORAGE_KEY+"_dirty","1"); } catch(e){}
    $("save-bar")?.classList.remove("hidden");
  }
}

function markClean(){
  isDirty=false;
  try { localStorage.removeItem(STORAGE_KEY+"_dirty"); } catch(e){}
  $("save-bar")?.classList.add("hidden");
  takeSnapshot();
}

async function commitChanges(){
  saveLocal();
  if(githubConfig){
    const ok=await syncToGitHub();
    if(!ok) return;
  } else {
    toast("Opgeslagen ✓");
  }
  markClean();
}

function discardChanges(){
  if(!cleanSnapshot) return;
  try {
    const snap=JSON.parse(cleanSnapshot);
    state.tasks=snap.tasks||[];
    state.people=snap.people||[];
    state.groups=snap.groups||[...DEFAULT_GROUPS];
    state.statuses=snap.statuses||[...DEFAULT_STATUSES];
    state.locations=snap.locations||[...DEFAULT_LOCATIONS];
    state.categories=snap.categories||[...DEFAULT_CATEGORIES];
    state.projects=snap.projects||[...DEFAULT_PROJECTS];
    state.tasks.forEach(t=>ensureSchedule(t));
  } catch(e){ return; }

  markClean();
  toast("Wijzigingen ongedaan gemaakt");
  switchView(state.currentView);
}

// ═══════════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════════
function switchView(view){
  state.currentView=view;
  $$(".nav-item[data-view]").forEach(btn=>{
    btn.classList.toggle("active", btn.dataset.view===view);
  });
  $$(".view").forEach(v=>v.classList.add("hidden"));
  $(`view-${view}`)?.classList.remove("hidden");

  const titles={dashboard:"Dashboard",overzicht:"Overzicht",materials:"Materialen",people:"Personen",settings:"Instellingen"};
  $("page-title").textContent=titles[view]||view;

  if(view==="dashboard") renderDashboard();
  else if(view==="overzicht") renderOverzicht();
  else if(view==="materials") renderMaterials();
  else if(view==="people") renderPeople();
  else if(view==="settings") renderSettings();

  // close mobile sidebar
  $("sidebar")?.classList.remove("open");
}

// ═══════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════
function renderDashboard(){
  state.tasks.forEach(t=>ensureSchedule(t));
  const total=state.tasks.length;
  const done=state.tasks.filter(t=>t.status==="Afgerond").length;
  const pct=total?Math.round(done/total*100):0;
  const sumR=state.tasks.reduce((a,t)=>a+(Number(t.estimate_hours?.realistic)||0),0);
  const sumA=state.tasks.reduce((a,t)=>a+(Number(t.actual_hours)||0),0);
  const blocked=state.tasks.filter(t=>(t.status||"").startsWith("Wacht")).length;
  const scheduled=state.tasks.filter(t=>t.scheduled?.start&&t.status!=="Afgerond").length;

  const kpi=$("kpi-grid");
  kpi.innerHTML="";
  const cards=[
    { label:"Voortgang", value:`${pct}%`, sub:`${done} / ${total} afgerond`, bar:pct, barColor:"var(--success)" },
    { label:"Uren", value:`${fmtHours(sumA)} / ${fmtHours(sumR)}`, sub:"Werkelijk / Begroot", bar:sumR?Math.min(100,Math.round(sumA/sumR*100)):0, barColor:"var(--primary)" },
    { label:"Blokkades", value:String(blocked), sub:"Wacht op materiaal / hulp", bar:0 },
    { label:"Ingepland", value:String(scheduled), sub:"Klussen met datum", bar:0 }
  ];
  cards.forEach(c=>{
    const card=h("div",{class:"kpi-card"},[
      h("div",{class:"kpi-label"},c.label),
      h("div",{class:"kpi-value"},c.value),
      h("div",{class:"kpi-sub"},c.sub),
      c.bar>0?h("div",{class:"kpi-bar"},[h("div",{class:"kpi-bar-fill",style:{width:c.bar+"%",background:c.barColor}})]):null
    ]);
    kpi.appendChild(card);
  });

  // Upcoming
  const upcoming=state.tasks
    .filter(t=>t.status!=="Afgerond"&&t.scheduled?.start)
    .sort((a,b)=>(a.scheduled.start||"").localeCompare(b.scheduled.start||""))
    .slice(0,8);

  const list=$("upcoming-list");
  list.innerHTML="";
  if(!upcoming.length){
    list.innerHTML=`<div class="empty-state"><p>Nog geen ingeplande klussen</p></div>`;
  } else {
    upcoming.forEach(t=>{
      const gc=getGroupColor(t.group);
      list.appendChild(h("div",{class:"upcoming-item",onclick:()=>openTaskModal(t.id)},[
        h("div",{class:"upcoming-dot",style:{background:gc}}),
        h("div",{class:"upcoming-info"},[
          h("div",{class:"upcoming-title"},t.title),
          h("div",{class:"upcoming-meta"},`${t.group||"–"} · ${t.location||"–"} · ${getPersonName((t.assignees||[])[0])}`)
        ]),
        h("div",{class:"upcoming-date"},fmtDateTime(t.scheduled.start))
      ]));
    });
  }

  // Group summary
  const gs=$("group-summary");
  gs.innerHTML="";
  const groupMap=new Map();
  state.tasks.forEach(t=>{
    const g=t.group||"Overig";
    if(!groupMap.has(g)) groupMap.set(g,{total:0,done:0});
    groupMap.get(g).total++;
    if(t.status==="Afgerond") groupMap.get(g).done++;
  });
  Array.from(groupMap.entries()).sort((a,b)=>b[1].total-a[1].total).forEach(([name,info])=>{
    const pct=info.total?Math.round(info.done/info.total*100):0;
    const gc=getGroupColor(name);
    gs.appendChild(h("div",{class:"group-row"},[
      h("div",{class:"group-color",style:{background:gc}}),
      h("div",{class:"group-name"},name),
      h("div",{class:"group-count"},`${info.done}/${info.total}`),
      h("div",{class:"group-bar-wrap"},[h("div",{class:"group-bar",style:{width:pct+"%",background:gc}})])
    ]));
  });
}

// ═══════════════════════════════════════════════════════════
// OVERZICHT (3-in-1)
// ═══════════════════════════════════════════════════════════
function renderOverzicht(){
  state.tasks.forEach(t=>ensureSchedule(t));
  populateFilters();
  updateOverzichtControls();

  const content=$("overzicht-content");
  content.innerHTML="";

  if(state.overzicht.mode==="list") renderListView(content);
  else if(state.overzicht.mode==="gantt") renderGanttView(content);
  else if(state.overzicht.mode==="agenda") renderAgendaView(content);
}

function updateOverzichtControls(){
  $$(".mode-btn[data-mode]").forEach(b=>b.classList.toggle("active",b.dataset.mode===state.overzicht.mode));
  $("agenda-controls")?.classList.toggle("hidden",state.overzicht.mode!=="agenda");
  $("gantt-controls")?.classList.toggle("hidden",state.overzicht.mode!=="gantt");

  $$(".mode-btn[data-zoom]").forEach(b=>b.classList.toggle("active",b.dataset.zoom===state.overzicht.agendaZoom));
  $$(".mode-btn[data-gzoom]").forEach(b=>b.classList.toggle("active",b.dataset.gzoom===state.overzicht.ganttZoom));

  // Update labels
  const fd=new Date(state.overzicht.focusDate+"T00:00:00");
  const months=["Januari","Februari","Maart","April","Mei","Juni","Juli","Augustus","September","Oktober","November","December"];

  if(state.overzicht.mode==="agenda"){
    const z=state.overzicht.agendaZoom;
    let label="";
    if(z==="month") label=`${months[fd.getMonth()]} ${fd.getFullYear()}`;
    else if(z==="week"){ const ws=startOfWeek(fd); const we=addDays(ws,6); label=`${fmtDate(ymd(ws))} – ${fmtDate(ymd(we))}`; }
    else label=fd.toLocaleDateString("nl-NL",{weekday:"long",day:"numeric",month:"long",year:"numeric"});
    if($("cal-label")) $("cal-label").textContent=label;
  }
  if(state.overzicht.mode==="gantt"){
    const z=state.overzicht.ganttZoom;
    let label="";
    if(z==="month") label=`${months[fd.getMonth()]} ${fd.getFullYear()}`;
    else { const ws=startOfWeek(fd); const we=addDays(ws,6); label=`${fmtDate(ymd(ws))} – ${fmtDate(ymd(we))}`; }
    if($("gantt-label")) $("gantt-label").textContent=label;
  }
}

function populateFilters(){
  const statusSel=$("filter-status");
  const val=statusSel.value;
  statusSel.innerHTML='<option value="">Alle statussen</option>';
  state.statuses.forEach(s=>statusSel.appendChild(h("option",{value:s},s)));
  statusSel.value=val;

  const groupSel=$("filter-group");
  const gval=groupSel.value;
  groupSel.innerHTML='<option value="">Alle groepen</option>';
  state.groups.forEach(g=>groupSel.appendChild(h("option",{value:g.name},g.name)));
  groupSel.value=gval;

  const personSel=$("filter-person");
  const pval=personSel.value;
  personSel.innerHTML='<option value="">Alle personen</option>';
  state.people.slice().sort((a,b)=>a.name.localeCompare(b.name)).forEach(p=>personSel.appendChild(h("option",{value:p.id},p.name)));
  personSel.value=pval;

  const projSel=$("filter-project");
  const prval=projSel.value;
  projSel.innerHTML='<option value="">Alle projecten</option>';
  const projects=[...new Set([...state.projects, ...state.tasks.map(t=>t.project).filter(Boolean)])].sort();
  projects.forEach(p=>projSel.appendChild(h("option",{value:p},p)));
  projSel.value=prval;
}

function getFilteredTasks(){
  const q=($("filter-search")?.value||"").trim().toLowerCase();
  const st=$("filter-status")?.value||"";
  const gr=$("filter-group")?.value||"";
  const pe=$("filter-person")?.value||"";
  const pr=$("filter-project")?.value||"";

  return state.tasks.filter(t=>{
    if(q&&!`${t.title||""} ${t.location||""} ${t.group||""} ${t.category||""}`.toLowerCase().includes(q)) return false;
    if(st&&t.status!==st) return false;
    if(gr&&t.group!==gr) return false;
    if(pr&&t.project!==pr) return false;
    if(pe){
      const a1=(t.assignees||[])[0]||"";
      const a2=(t.assignees||[])[1]||"";
      if(a1!==pe&&a2!==pe) return false;
    }
    return true;
  });
}

// ─── LIST VIEW ────────────────────────────────────────────
function renderListView(container){
  const filtered=getFilteredTasks().sort((a,b)=>{
    const si=state.statuses.indexOf(a.status)-state.statuses.indexOf(b.status);
    if(si!==0) return si;
    const sa=a.scheduled?.start||"9999";
    const sb=b.scheduled?.start||"9999";
    if(sa!==sb) return sa.localeCompare(sb);
    return (a.title||"").localeCompare(b.title||"");
  });

  if(!filtered.length){
    container.innerHTML=`<div class="empty-state"><p>Geen klussen gevonden met deze filters.</p></div>`;
    return;
  }

  const table=h("table",{class:"data-table"});
  const thead=h("thead",{},[h("tr",{},[
    h("th",{},"Klus"),
    h("th",{},"Groep"),
    h("th",{},"Locatie"),
    h("th",{},"Status"),
    h("th",{},"Uitvoerder"),
    h("th",{},"Start"),
    h("th",{},"Uren (R)")
  ])]);
  table.appendChild(thead);

  const tbody=h("tbody");
  filtered.forEach(t=>{
    const gc=getGroupColor(t.group);
    const sc=statusClass(t.status);
    const exec=[getPersonName((t.assignees||[])[0]),getPersonName((t.assignees||[])[1])].filter(x=>x!=="–").join(", ")||"–";

    const calIcon=t.inCalendar!==false&&t.scheduled?.start?'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--primary);flex-shrink:0;margin-left:4px;vertical-align:middle"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>':"";
    const stCount=(t.subtasks||[]).length;
    const stDone=(t.subtasks||[]).filter(s=>s.status==="done").length;
    const stBadge=stCount?` <span style="font-size:11px;font-weight:400;color:var(--text-tertiary);margin-left:4px">${stDone}/${stCount} subtaken</span>`:"";
    const titleCell=document.createElement("td");
    titleCell.innerHTML=`<span style="font-weight:600">${escHtml(t.title)}</span>${calIcon}${stBadge}`;
    titleCell.style.cssText="display:flex;align-items:center;gap:2px;";

    tbody.appendChild(h("tr",{onclick:()=>openTaskModal(t.id)},[
      titleCell,
      h("td",{},[h("span",{class:"group-badge",style:{borderColor:gc+"55",background:gc+"15",color:gc}},t.group||"–")]),
      h("td",{class:"cell-muted"},t.location||"–"),
      h("td",{},[h("span",{class:`status-badge ${sc}`},[h("span",{class:"dot"}),t.status])]),
      h("td",{class:"cell-small"},exec),
      h("td",{class:"cell-small"},t.scheduled?.start?(t.allDay?"Hele dag":fmtDateTime(t.scheduled.start)):"–"),
      h("td",{class:"cell-small"},fmtHours(t.estimate_hours?.realistic))
    ]));
  });
  table.appendChild(tbody);

  const wrap=h("div",{class:"table-wrap",style:{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:"var(--radius-lg)",overflow:"hidden",boxShadow:"var(--shadow-sm)"}});
  wrap.appendChild(table);
  container.appendChild(wrap);
}

// ─── GANTT VIEW ───────────────────────────────────────────
function renderGanttView(container){
  const allFiltered=getFilteredTasks().filter(t=>t.scheduled?.start).map(t=>{
    if(!t.scheduled.end) ensureSchedule(t);
    return t;
  });
  const fd=new Date(state.overzicht.focusDate+"T00:00:00");

  // Timeline range
  let rangeStart, rangeEnd, cols, colLabels;
  if(state.overzicht.ganttZoom==="week"){
    rangeStart=startOfWeek(fd);
    rangeEnd=addDays(rangeStart,7);
    cols=7;
    const days=["Ma","Di","Wo","Do","Vr","Za","Zo"];
    colLabels=Array.from({length:7},(_,i)=>{
      const d=addDays(rangeStart,i);
      return `${days[i]} ${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}`;
    });
  } else {
    rangeStart=new Date(fd.getFullYear(),fd.getMonth(),1);
    rangeEnd=new Date(fd.getFullYear(),fd.getMonth()+1,1);
    cols=Math.round((rangeEnd-rangeStart)/(864e5));
    colLabels=Array.from({length:cols},(_,i)=>{
      const d=addDays(rangeStart,i);
      return String(d.getDate()).padStart(2,"0");
    });
  }

  // Filter tasks visible in this range
  const inRange=allFiltered.filter(t=>{
    const d=taskDisplayDates(t);
    return d&&d.e>rangeStart&&d.s<rangeEnd;
  }).sort((a,b)=>(a.scheduled.start||"").localeCompare(b.scheduled.start||""));

  // Group tasks by group name — include ALL groups from state even if empty
  const grouped=new Map();
  state.groups.forEach(g=>grouped.set(g.name,[]));
  // Also catch tasks with groups not in state.groups
  inRange.forEach(t=>{
    const gn=t.group||"Geen groep";
    if(!grouped.has(gn)) grouped.set(gn,[]);
    grouped.get(gn).push(t);
  });
  // Ensure "Geen groep" exists if there are ungrouped tasks
  if(!grouped.has("Geen groep")) grouped.set("Geen groep",[]);

  const labelW=280;
  const colW=state.overzicht.ganttZoom==="week"?100:36;
  const gc=h("div",{class:"gantt-container"});
  const grid=h("div",{class:"gantt-grid",style:{gridTemplateColumns:`${labelW}px repeat(${cols},${colW}px)`}});

  // Header row
  grid.appendChild(h("div",{class:"gantt-hcell",style:{position:"sticky",left:"0",zIndex:"4",minWidth:labelW+"px"}},"Klus"));
  colLabels.forEach(l=>grid.appendChild(h("div",{class:"gantt-hcell"},l)));

  let hasVisibleRows=false;

  // Render groups
  grouped.forEach((tasks,groupName)=>{
    // Skip "Geen groep" if empty
    if(groupName==="Geen groep"&&tasks.length===0) return;

    const groupObj=state.groups.find(g=>g.name===groupName);
    const color=groupObj?.color||"#78716C";
    const isCollapsed=state.ganttCollapsed.has(groupName);
    const taskCountInRange=tasks.length;

    // Group header row
    const headerLabel=document.createElement("div");
    headerLabel.className="gantt-group-header";
    headerLabel.style.cssText=`position:sticky;left:0;z-index:3;min-width:${labelW}px;`;
    headerLabel.innerHTML=`
      <span class="gantt-group-toggle">${isCollapsed?"▶":"▼"}</span>
      <span class="gantt-group-dot" style="background:${color}"></span>
      <span class="gantt-group-name">${escHtml(groupName)}</span>
      <span class="gantt-group-count">${taskCountInRange}</span>
    `;
    headerLabel.addEventListener("click",()=>{
      if(state.ganttCollapsed.has(groupName)) state.ganttCollapsed.delete(groupName);
      else state.ganttCollapsed.add(groupName);
      renderGanttView(container);
    });
    grid.appendChild(headerLabel);

    // Group header track (empty spanning bar area)
    const headerTrack=document.createElement("div");
    headerTrack.className="gantt-group-header-track";
    headerTrack.style.gridColumn=`span ${cols}`;
    grid.appendChild(headerTrack);

    hasVisibleRows=true;

    // Task rows (only if expanded)
    if(!isCollapsed){
      if(tasks.length===0){
        // Empty group hint
        const emptyLabel=document.createElement("div");
        emptyLabel.className="gantt-label-cell gantt-task-indent";
        emptyLabel.innerHTML=`<div class="gantt-label-meta" style="font-style:italic">Geen klussen in deze periode</div>`;
        grid.appendChild(emptyLabel);
        const emptyTrack=document.createElement("div");
        emptyTrack.style.cssText=`grid-column:span ${cols};height:36px;border-bottom:1px solid var(--border);`;
        grid.appendChild(emptyTrack);
      } else {
        tasks.forEach(t=>{
          const exec=[getPersonName((t.assignees||[])[0]),getPersonName((t.assignees||[])[1])].filter(x=>x!=="–").join(" + ")||"–";
          const stCount=(t.subtasks||[]).length;
          const stDone=(t.subtasks||[]).filter(s=>s.status==="done").length;

          const labelCell=document.createElement("div");
          labelCell.className="gantt-label-cell gantt-task-indent";
          labelCell.innerHTML=`
            <div class="gantt-label-title">${escHtml(t.title)}${stCount?` <span style="font-weight:400;font-size:11px;color:var(--text-tertiary)">(${stDone}/${stCount})</span>`:""}</div>
            <div class="gantt-label-meta">${escHtml(t.location||"–")} · ${escHtml(exec)}</div>
          `;
          grid.appendChild(labelCell);

          const track=document.createElement("div");
          track.style.cssText=`grid-column:span ${cols};position:relative;height:52px;border-bottom:1px solid var(--border);`;

          const {s,e}=taskDisplayDates(t);
          let startIdx,endIdx;
          if(state.overzicht.ganttZoom==="week"){
            startIdx=Math.max(0,(s-rangeStart)/864e5);
            endIdx=Math.min(cols,(e-rangeStart)/864e5);
          } else {
            startIdx=Math.max(0,(new Date(s.getFullYear(),s.getMonth(),s.getDate())-rangeStart)/864e5);
            endIdx=Math.min(cols,Math.ceil((e-rangeStart)/864e5));
          }
          if(endIdx<=startIdx) endIdx=startIdx+0.5;

          const left=startIdx*colW+4;
          const width=Math.max(24,(endIdx-startIdx)*colW-8);
          const sc=statusClass(t.status);

          const bar=document.createElement("div");
          bar.className=`gantt-bar ${sc}`;
          bar.style.cssText=`left:${left}px;width:${width}px;`;
          bar.textContent=t.title;
          bar.addEventListener("click",()=>openTaskModal(t.id));
          track.appendChild(bar);
          grid.appendChild(track);

          // ── Subtask rows (deeper indent) ──
          (t.subtasks||[]).forEach(st=>{
            if(!st.scheduled?.start) return;
            const stS=parseDate(st.scheduled.start);
            const stE=st.scheduled.end?parseDate(st.scheduled.end):new Date(stS.getTime()+36e5);
            if(stE<=rangeStart||stS>=rangeEnd) return; // outside range

            const stLabel=document.createElement("div");
            stLabel.className="gantt-label-cell gantt-subtask-indent";
            stLabel.innerHTML=`
              <div class="gantt-label-title" style="font-weight:500;font-size:12px">${st.status==="done"?"✓ ":""}${escHtml(st.title)}</div>
            `;
            grid.appendChild(stLabel);

            const stTrack=document.createElement("div");
            stTrack.style.cssText=`grid-column:span ${cols};position:relative;height:36px;border-bottom:1px solid var(--border);background:var(--bg-subtle);`;

            let stStartIdx,stEndIdx;
            if(state.overzicht.ganttZoom==="week"){
              stStartIdx=Math.max(0,(stS-rangeStart)/864e5);
              stEndIdx=Math.min(cols,(stE-rangeStart)/864e5);
            } else {
              stStartIdx=Math.max(0,(new Date(stS.getFullYear(),stS.getMonth(),stS.getDate())-rangeStart)/864e5);
              stEndIdx=Math.min(cols,Math.ceil((stE-rangeStart)/864e5));
            }
            if(stEndIdx<=stStartIdx) stEndIdx=stStartIdx+0.5;

            const stLeft=stStartIdx*colW+4;
            const stWidth=Math.max(20,(stEndIdx-stStartIdx)*colW-8);
            const stSc=st.status==="done"?"done":st.status==="bezig"?"active":"backlog";

            const stBar=document.createElement("div");
            stBar.className=`gantt-bar gantt-bar-sub ${stSc}`;
            stBar.style.cssText=`left:${stLeft}px;width:${stWidth}px;`;
            stBar.textContent=st.title;
            stBar.addEventListener("click",()=>openTaskModal(t.id));
            stTrack.appendChild(stBar);
            grid.appendChild(stTrack);
          });
        });
      }
    }
  });

  if(!hasVisibleRows){
    container.innerHTML=`<div class="empty-state" style="background:var(--surface);border-radius:var(--radius-lg);border:1px solid var(--border)"><p>Geen groepen of klussen gevonden.</p></div>`;
    return;
  }

  gc.appendChild(grid);
  container.innerHTML="";
  container.appendChild(gc);
}

// ─── AGENDA VIEW ──────────────────────────────────────────
function renderAgendaView(container){
  const zoom=state.overzicht.agendaZoom;
  if(zoom==="month") renderMonthAgenda(container);
  else if(zoom==="week") renderWeekAgenda(container);
  else renderDayAgenda(container);
}

function getScheduledTasksByDate(rangeStart,rangeEnd){
  const filtered=getFilteredTasks().filter(t=>t.scheduled?.start);
  const byDate=new Map();

  function addToDate(key, item){
    if(!byDate.has(key)) byDate.set(key,[]);
    byDate.get(key).push(item);
  }

  filtered.forEach(t=>{
    const s=parseDate(t.scheduled.start);
    const e=t.scheduled.end?parseDate(t.scheduled.end):new Date(s.getTime()+36e5);
    if(e<=rangeStart||s>=rangeEnd) return;
    for(let d=new Date(Math.max(s,rangeStart)); d<rangeEnd&&d<e; d=addDays(d,1)){
      addToDate(ymd(d), t);
    }

    // Include subtasks with their own schedule
    (t.subtasks||[]).forEach(st=>{
      if(!st.scheduled?.start) return;
      const ss=parseDate(st.scheduled.start);
      const se=st.scheduled.end?parseDate(st.scheduled.end):new Date(ss.getTime()+36e5);
      if(se<=rangeStart||ss>=rangeEnd) return;
      // Create a virtual task-like object for display
      const virtual={
        id:t.id, title:`↳ ${st.title}`, status:st.status==="done"?"Afgerond":"Bezig",
        group:t.group, location:t.location, scheduled:{start:st.scheduled.start,end:st.scheduled.end},
        _isSubtask:true, _parentTitle:t.title
      };
      for(let d=new Date(Math.max(ss,rangeStart)); d<rangeEnd&&d<se; d=addDays(d,1)){
        addToDate(ymd(d), virtual);
      }
    });
  });
  return byDate;
}

function renderMonthAgenda(container){
  const fd=new Date(state.overzicht.focusDate+"T00:00:00");
  const firstDay=new Date(fd.getFullYear(),fd.getMonth(),1);
  const lastDay=new Date(fd.getFullYear(),fd.getMonth()+1,0);
  const startDow=(firstDay.getDay()+6)%7;
  const gridStart=addDays(firstDay,-startDow);
  const totalCells=Math.ceil((startDow+lastDay.getDate())/7)*7;
  const gridEnd=addDays(gridStart,totalCells);

  const byDate=getScheduledTasksByDate(gridStart,gridEnd);
  const today=todayYmd();

  const cal=h("div",{class:"cal-container"});
  const grid=h("div",{class:"cal-month-grid"});

  // Day headers
  ["Ma","Di","Wo","Do","Vr","Za","Zo"].forEach(d=>grid.appendChild(h("div",{class:"cal-dow-header"},d)));

  // Day cells
  for(let i=0;i<totalCells;i++){
    const d=addDays(gridStart,i);
    const key=ymd(d);
    const isOutside=d.getMonth()!==fd.getMonth();
    const isToday=key===today;

    const cell=h("div",{class:`cal-day-cell${isOutside?" outside":""}${isToday?" today":""}`,onclick:()=>{
      state.overzicht.agendaZoom="day";
      state.overzicht.focusDate=key;
      renderOverzicht();
    }});
    cell.appendChild(h("div",{class:"cal-day-num"},String(d.getDate())));

    const tasks=(byDate.get(key)||[]).slice(0,3);
    tasks.forEach(t=>{
      const ev=h("div",{class:`cal-event ${statusClass(t.status)}`,onclick:e=>{e.stopPropagation();openTaskModal(t.id);}},t.title);
      cell.appendChild(ev);
    });
    const extra=(byDate.get(key)||[]).length-tasks.length;
    if(extra>0) cell.appendChild(h("div",{class:"cal-more"},`+${extra} meer`));

    grid.appendChild(cell);
  }

  cal.appendChild(grid);
  container.appendChild(cal);
}

function renderWeekAgenda(container){
  const fd=new Date(state.overzicht.focusDate+"T00:00:00");
  const ws=startOfWeek(fd);
  const we=addDays(ws,7);
  const byDate=getScheduledTasksByDate(ws,we);
  const today=todayYmd();
  const dayNames=["Ma","Di","Wo","Do","Vr","Za","Zo"];

  const cal=h("div",{class:"cal-container"});
  const grid=h("div",{class:"cal-week-grid"});

  // Corner
  grid.appendChild(h("div",{class:"cal-week-header",style:{borderRight:"1px solid var(--border)"}}));
  // Day headers
  for(let i=0;i<7;i++){
    const d=addDays(ws,i);
    const isToday=ymd(d)===today;
    grid.appendChild(h("div",{class:`cal-week-header${isToday?" today":""}`,style:{borderRight:"1px solid var(--border)"}},[
      h("div",{class:"cal-week-dayname"},dayNames[i]),
      h("div",{class:"cal-week-daynum"},String(d.getDate()))
    ]));
  }

  // Time rows (6am – 22pm)
  for(let hr=6;hr<=22;hr++){
    grid.appendChild(h("div",{class:"cal-time-label"},`${String(hr).padStart(2,"0")}:00`));
    for(let i=0;i<7;i++){
      const slot=h("div",{class:"cal-week-slot"});
      const d=addDays(ws,i);
      const key=ymd(d);
      const tasks=(byDate.get(key)||[]).filter(t=>{
        const s=parseDate(t.scheduled.start);
        return s.getHours()===hr;
      });
      tasks.forEach(t=>{
        const ev=h("div",{class:`cal-event ${statusClass(t.status)}`,style:{fontSize:"11px",cursor:"pointer"},onclick:()=>openTaskModal(t.id)},t.title);
        slot.appendChild(ev);
      });
      grid.appendChild(slot);
    }
  }

  cal.appendChild(grid);
  container.appendChild(cal);
}

function renderDayAgenda(container){
  const fd=new Date(state.overzicht.focusDate+"T00:00:00");
  const nextDay=addDays(fd,1);
  const tasks=getFilteredTasks().filter(t=>{
    if(!t.scheduled?.start) return false;
    const s=parseDate(t.scheduled.start);
    const e=t.scheduled.end?parseDate(t.scheduled.end):new Date(s.getTime()+36e5);
    return e>fd&&s<nextDay;
  }).sort((a,b)=>(a.scheduled.start||"").localeCompare(b.scheduled.start||""));

  const cal=h("div",{class:"cal-container",style:{overflow:"auto",maxHeight:"700px"}});
  const grid=h("div",{class:"cal-day-grid"});

  // Time slots (0-23)
  for(let hr=0;hr<24;hr++){
    grid.appendChild(h("div",{class:"cal-time-label",style:{height:"56px"}},`${String(hr).padStart(2,"0")}:00`));
    const slot=h("div",{class:"cal-day-slot"});

    // Place events
    tasks.forEach(t=>{
      const s=parseDate(t.scheduled.start);
      const e=t.scheduled.end?parseDate(t.scheduled.end):new Date(s.getTime()+36e5);
      if(s.getHours()!==hr||(s<fd)) return;

      const startMin=s.getHours()*60+s.getMinutes();
      const endMin=e.getHours()*60+e.getMinutes()||(e>nextDay?24*60:0);
      const topOffset=(s.getMinutes()/60)*56;
      const height=Math.max(28,((endMin-startMin)/60)*56);
      const sc=statusClass(t.status);
      const exec=[getPersonName((t.assignees||[])[0]),getPersonName((t.assignees||[])[1])].filter(x=>x!=="–").join(", ")||"";

      slot.appendChild(h("div",{class:`cal-day-event ${sc}`,style:{top:topOffset+"px",height:height+"px"},onclick:()=>openTaskModal(t.id)},[
        h("div",{class:"cal-day-event-title"},t.title),
        h("div",{class:"cal-day-event-meta"},`${fmtDateTime(t.scheduled.start)} – ${fmtDateTime(t.scheduled.end)}${exec?" · "+exec:""}`)
      ]));
    });

    grid.appendChild(slot);
  }

  cal.appendChild(grid);
  container.appendChild(cal);
}

// ═══════════════════════════════════════════════════════════
// MATERIALS
// ═══════════════════════════════════════════════════════════
function renderMaterials(){
  const wrap=$("materials-table-wrap");
  wrap.innerHTML="";
  const matFilter=$("mat-filter-status")?.value||"";

  const openTasks=state.tasks.filter(t=>t.status!=="Afgerond");
  // Collect all materials with references back to their source tasks
  const allMats=[];
  openTasks.forEach(t=>{
    (t.materials||[]).forEach((m,mi)=>{
      const item=(typeof m==="string"?m:(m.item||"")).trim();
      if(!item) return;
      const qty=typeof m==="string"?"":((m.qty||"").trim());
      const status=typeof m==="string"?"":((m.status||"").trim());
      allMats.push({ item, qty, status, taskId:t.id, taskTitle:t.title, matIndex:mi });
    });
  });

  let rows=allMats.sort((a,b)=>a.item.localeCompare(b.item));
  if(matFilter){
    rows=rows.filter(r=>r.status.toLowerCase().includes(matFilter.toLowerCase()));
  }

  if(!rows.length){
    wrap.innerHTML='<div class="empty-state"><p>Geen materialen gevonden.</p></div>';
    return;
  }

  const matStatuses=["","kopen","kijken","in huis","onderweg","geregeld"];
  const table=h("table",{class:"data-table"});
  table.appendChild(h("thead",{},[h("tr",{},[
    h("th",{},"Materiaal"),h("th",{},"Hoeveelheid"),h("th",{},"Status"),h("th",{},"Klus")
  ])]));
  const tbody=h("tbody");
  rows.forEach(r=>{
    const statusSel=h("select",{style:{padding:"4px 8px",border:"1px solid var(--border)",borderRadius:"var(--radius)",fontSize:"12px",cursor:"pointer"}});
    matStatuses.forEach(s=>{
      const opt=h("option",{value:s},s||"—");
      if(s===r.status) opt.selected=true;
      statusSel.appendChild(opt);
    });
    statusSel.addEventListener("click",e=>e.stopPropagation());
    statusSel.addEventListener("change",e=>{
      e.stopPropagation();
      const task=state.tasks.find(t=>t.id===r.taskId);
      if(!task) return;
      const mat=task.materials[r.matIndex];
      if(typeof mat==="object") mat.status=statusSel.value;
      markDirty();
    });

    tbody.appendChild(h("tr",{style:{cursor:"default"}},[
      h("td",{style:{fontWeight:"600"}},r.item),
      h("td",{},r.qty||"–"),
      h("td",{},[statusSel]),
      h("td",{class:"cell-small"},r.taskTitle)
    ]));
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
}

// ═══════════════════════════════════════════════════════════
// PEOPLE
// ═══════════════════════════════════════════════════════════
function renderPeople(){
  const wrap=$("people-table-wrap");
  wrap.innerHTML="";

  if(!state.people.length){
    wrap.innerHTML='<div class="empty-state"><p>Nog geen personen toegevoegd.</p></div>';
    return;
  }

  const table=h("table",{class:"data-table"});
  table.appendChild(h("thead",{},[h("tr",{},[
    h("th",{},"ID"),h("th",{style:{width:"40%"}},"Naam"),h("th",{},"Klussen"),h("th",{style:{width:"120px"}},"Acties")
  ])]));
  const tbody=h("tbody");

  state.people.slice().sort((a,b)=>a.name.localeCompare(b.name)).forEach(p=>{
    const taskCount=state.tasks.filter(t=>(t.assignees||[]).includes(p.id)).length;

    // Editable name input
    const nameInput=document.createElement("input");
    nameInput.type="text";
    nameInput.value=p.name;
    nameInput.style.cssText="border:1px solid var(--border);border-radius:var(--radius);padding:6px 10px;width:100%;font-size:13px;background:var(--surface);";
    nameInput.addEventListener("click",e=>e.stopPropagation());
    nameInput.addEventListener("focus",()=>{ nameInput.style.borderColor="var(--primary)"; nameInput.style.boxShadow="0 0 0 3px var(--primary-subtle)"; });
    nameInput.addEventListener("blur",()=>{ nameInput.style.borderColor="var(--border)"; nameInput.style.boxShadow="none"; });
    nameInput.addEventListener("change",e=>{
      e.stopPropagation();
      const newName=nameInput.value.trim();
      if(!newName){ nameInput.value=p.name; return; }
      p.name=newName;
      markDirty();
    });

    // Delete button
    const delBtn=document.createElement("button");
    delBtn.className="btn danger small";
    delBtn.textContent="Verwijder";
    delBtn.addEventListener("click",e=>{
      e.stopPropagation();
      e.preventDefault();
      if(!confirm(`"${p.name}" verwijderen?\n\nDeze persoon wordt ook verwijderd als uitvoerder bij ${taskCount} klus(sen).`)) return;
      state.people=state.people.filter(x=>x.id!==p.id);
      state.tasks.forEach(t=>{
        if(t.owner===p.id) t.owner="";
        t.assignees=(t.assignees||[]).filter(id=>id!==p.id);
      });
      markDirty();
      toast(`${p.name} verwijderd`);
      renderPeople();
    });

    const tr=document.createElement("tr");
    tr.style.cursor="default";

    const td1=document.createElement("td"); td1.className="cell-muted"; td1.textContent=p.id;
    const td2=document.createElement("td"); td2.appendChild(nameInput);
    const td3=document.createElement("td"); td3.className="cell-small"; td3.textContent=`${taskCount} klussen`;
    const td4=document.createElement("td"); td4.appendChild(delBtn);

    tr.appendChild(td1);
    tr.appendChild(td2);
    tr.appendChild(td3);
    tr.appendChild(td4);
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  wrap.appendChild(table);
}

// ═══════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════
function renderSettings(){
  updateGHSettingsUI();
  renderGroupsManager();
  renderSimpleListManager("mgr-locations", state.locations, "locations");
  renderSimpleListManager("mgr-categories", state.categories, "categories");
  renderSimpleListManager("mgr-statuses", state.statuses, "statuses");
  renderSimpleListManager("mgr-projects", state.projects, "projects");
}

function updateGHSettingsUI(){
  const statusText=$("gh-status-text");
  const infoBox=$("gh-settings-info");
  const repoLabel=$("gh-conn-repo");
  const setupBtn=$("btn-gh-setup");
  const disconnBtn=$("btn-gh-disconnect");

  if(githubConfig){
    statusText.textContent="Verbonden met GitHub — wijzigingen worden automatisch gesynchroniseerd.";
    statusText.style.color="var(--success)";
    infoBox?.classList.remove("hidden");
    if(repoLabel) repoLabel.textContent=`${githubConfig.owner}/${githubConfig.repo}`;
    setupBtn.textContent="Opnieuw koppelen";
    setupBtn.classList.remove("primary");
    setupBtn.classList.add("secondary");
    disconnBtn?.classList.remove("hidden");

    // Show iCal subscription URL
    const icalBox=$("ical-url-box");
    const icalUrl=$("ical-url");
    if(icalBox&&icalUrl){
      const url=`https://raw.githubusercontent.com/${githubConfig.owner}/${githubConfig.repo}/main/klusplanner.ics`;
      icalUrl.textContent=url;
      icalUrl.onclick=()=>{
        navigator.clipboard?.writeText(url).then(()=>toast("URL gekopieerd ✓")).catch(()=>{});
      };
      icalBox.classList.remove("hidden");
    }
  } else {
    statusText.textContent="Niet verbonden — data wordt lokaal opgeslagen.";
    statusText.style.color="";
    infoBox?.classList.add("hidden");
    setupBtn.textContent="GitHub koppelen";
    setupBtn.classList.remove("secondary");
    setupBtn.classList.add("primary");
    disconnBtn?.classList.add("hidden");
    $("ical-url-box")?.classList.add("hidden");
  }
}

function updateSidebarUser(){
  const avatar=$("user-avatar");
  const name=$("user-name");
  if(!avatar||!name) return;
  if(state.currentUser){
    avatar.textContent=state.currentUser.avatar||state.currentUser.displayName?.charAt(0)||"?";
    name.textContent=state.currentUser.displayName||"–";
  } else {
    avatar.textContent="?";
    name.textContent="–";
  }
}

function showGHSetupModal(){
  // Create inline modal for GitHub setup
  const existing=document.getElementById("gh-setup-overlay");
  if(existing) existing.remove();

  const overlay=h("div",{id:"gh-setup-overlay",class:"gh-setup-overlay",onclick:e=>{if(e.target===overlay)overlay.remove();}});
  const card=h("div",{class:"gh-setup-card"});
  card.innerHTML=`
    <h3>GitHub koppelen</h3>
    <p class="login-subtitle">Eenmalige configuratie — geldt voor alle gebruikers op dit apparaat</p>
    <div class="login-form">
      <div class="login-field">
        <label for="gh-s-token">Personal Access Token</label>
        <input id="gh-s-token" type="password" placeholder="ghp_xxxxxxxxxxxx" value="${githubConfig?.token||""}" />
        <span class="login-hint">Fine-grained token · Permissions: Contents → Read & Write</span>
      </div>
      <div class="login-row">
        <div class="login-field">
          <label for="gh-s-owner">Repo eigenaar</label>
          <input id="gh-s-owner" type="text" placeholder="jouw-username" value="${githubConfig?.owner||""}" />
        </div>
        <div class="login-field">
          <label for="gh-s-repo">Repo naam</label>
          <input id="gh-s-repo" type="text" placeholder="klusplanner" value="${githubConfig?.repo||""}" />
        </div>
      </div>
      <button id="btn-gh-s-connect" class="btn-login" type="button">Verbinden</button>
      <div id="gh-s-error" class="login-error hidden"></div>
      <button id="btn-gh-s-cancel" class="btn-offline" type="button">Annuleren</button>
    </div>
  `;
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  $("btn-gh-s-cancel").onclick=()=>overlay.remove();
  $("btn-gh-s-connect").onclick=async ()=>{
    const token=$("gh-s-token").value.trim();
    const owner=$("gh-s-owner").value.trim();
    const repo=$("gh-s-repo").value.trim();
    if(!token||!owner||!repo){
      $("gh-s-error").textContent="Vul alle velden in.";
      $("gh-s-error").classList.remove("hidden");
      return;
    }
    $("btn-gh-s-connect").textContent="Verbinden...";
    $("btn-gh-s-connect").disabled=true;

    githubConfig={token,owner,repo};
    try {
      const valid=await ghValidate();
      if(!valid) throw new Error("Kan repo niet bereiken. Check token/repo.");
      saveGHConfig();
      await syncFromGitHub();
      overlay.remove();
      toast("GitHub gekoppeld ✓");
      updateGHSettingsUI();
      switchView(state.currentView);
    } catch(e){
      githubConfig=loadGHConfig(); // revert
      $("gh-s-error").textContent=e.message;
      $("gh-s-error").classList.remove("hidden");
    } finally {
      const btn=$("btn-gh-s-connect");
      if(btn){ btn.textContent="Verbinden"; btn.disabled=false; }
    }
  };
}

function renderGroupsManager(){
  const container=$("mgr-groups");
  if(!container) return;
  container.innerHTML="";

  if(!state.groups.length){
    container.innerHTML='<p style="color:var(--text-tertiary);font-size:13px;">Nog geen groepen. Voeg er hieronder een toe.</p>';
    return;
  }

  const table=document.createElement("table");
  table.className="data-table";
  table.style.marginBottom="0";

  const thead=document.createElement("thead");
  thead.innerHTML='<tr><th>Kleur</th><th style="width:50%">Naam</th><th>Klussen</th><th style="width:100px">Acties</th></tr>';
  table.appendChild(thead);

  const tbody=document.createElement("tbody");

  state.groups.forEach(g=>{
    const taskCount=state.tasks.filter(t=>t.group===g.name||t.group===g.id).length;
    const tr=document.createElement("tr");
    tr.style.cursor="default";

    // Color picker
    const tdColor=document.createElement("td");
    const colorInput=document.createElement("input");
    colorInput.type="color";
    colorInput.value=g.color||"#78716C";
    colorInput.style.cssText="width:32px;height:28px;border:1px solid var(--border);border-radius:6px;cursor:pointer;padding:2px;";
    colorInput.addEventListener("click",e=>e.stopPropagation());
    colorInput.addEventListener("change",e=>{
      e.stopPropagation();
      g.color=colorInput.value;
      markDirty();
    });
    tdColor.appendChild(colorInput);

    // Editable name
    const tdName=document.createElement("td");
    const nameInput=document.createElement("input");
    nameInput.type="text";
    nameInput.value=g.name;
    nameInput.style.cssText="border:1px solid var(--border);border-radius:var(--radius);padding:6px 10px;width:100%;font-size:13px;font-weight:600;background:var(--surface);";
    nameInput.addEventListener("click",e=>e.stopPropagation());
    nameInput.addEventListener("focus",()=>{ nameInput.style.borderColor="var(--primary)"; nameInput.style.boxShadow="0 0 0 3px var(--primary-subtle)"; });
    nameInput.addEventListener("blur",()=>{ nameInput.style.borderColor="var(--border)"; nameInput.style.boxShadow="none"; });
    nameInput.addEventListener("change",e=>{
      e.stopPropagation();
      const oldName=g.name;
      const newName=nameInput.value.trim();
      if(!newName){ nameInput.value=g.name; return; }
      // Update all tasks referencing old name
      state.tasks.forEach(t=>{
        if(t.group===oldName) t.group=newName;
      });
      g.name=newName;
      g.id=slugify(newName)||g.id;
      markDirty();
    });
    tdName.appendChild(nameInput);

    // Count
    const tdCount=document.createElement("td");
    tdCount.className="cell-small";
    tdCount.textContent=`${taskCount} klussen`;

    // Delete
    const tdActions=document.createElement("td");
    const delBtn=document.createElement("button");
    delBtn.className="btn danger small";
    delBtn.textContent="Verwijder";
    delBtn.addEventListener("click",e=>{
      e.stopPropagation();
      e.preventDefault();
      if(!confirm(`Groep "${g.name}" verwijderen?\n\n${taskCount} klus(sen) behouden hun groepsnaam maar de groep verdwijnt uit de filters.`)) return;
      state.groups=state.groups.filter(x=>x.id!==g.id);
      markDirty();
      toast(`Groep "${g.name}" verwijderd`);
      renderGroupsManager();
    });
    tdActions.appendChild(delBtn);

    tr.appendChild(tdColor);
    tr.appendChild(tdName);
    tr.appendChild(tdCount);
    tr.appendChild(tdActions);
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  container.appendChild(table);
}

// ─── Generic list manager (for simple string lists) ───────
function renderSimpleListManager(containerId, list, stateKey){
  const container=$(containerId);
  if(!container) return;
  container.innerHTML="";

  if(!list.length){
    container.innerHTML='<p style="color:var(--text-tertiary);font-size:13px;">Nog geen items.</p>';
    return;
  }

  const wrap=document.createElement("div");
  wrap.style.cssText="display:flex;flex-wrap:wrap;gap:6px;";

  list.forEach((item,i)=>{
    const chip=document.createElement("span");
    chip.className="tag-chip";
    chip.style.cssText="display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border-radius:var(--radius-full);font-size:12px;font-weight:600;background:var(--bg-subtle);color:var(--text);border:1px solid var(--border);";

    const label=document.createElement("span");
    label.textContent=item;
    label.contentEditable=true;
    label.style.cssText="outline:none;min-width:20px;cursor:text;border-bottom:1px dashed transparent;";
    label.addEventListener("focus",()=>{ label.style.borderBottomColor="var(--primary)"; });
    label.addEventListener("blur",()=>{
      label.style.borderBottomColor="transparent";
      const newVal=label.textContent.trim();
      if(!newVal){ label.textContent=item; return; }
      if(newVal!==item){
        // Update tasks that reference old value
        const field=stateKey==="locations"?"location":stateKey==="categories"?"category":stateKey==="statuses"?"status":stateKey==="projects"?"project":null;
        if(field){
          state.tasks.forEach(t=>{ if(t[field]===item) t[field]=newVal; });
        }
        state[stateKey][i]=newVal;
        markDirty();
      }
    });
    label.addEventListener("keydown",e=>{ if(e.key==="Enter"){ e.preventDefault(); label.blur(); } });

    const del=document.createElement("span");
    del.textContent="×";
    del.style.cssText="cursor:pointer;opacity:.4;font-size:14px;line-height:1;";
    del.addEventListener("mouseenter",()=>{ del.style.opacity="1"; });
    del.addEventListener("mouseleave",()=>{ del.style.opacity=".4"; });
    del.addEventListener("click",e=>{
      e.stopPropagation();
      if(!confirm(`"${item}" verwijderen uit de lijst?`)) return;
      state[stateKey].splice(i,1);
      markDirty();
      renderSimpleListManager(containerId,state[stateKey],stateKey);
    });

    chip.appendChild(label);
    chip.appendChild(del);
    wrap.appendChild(chip);
  });

  container.appendChild(wrap);
}

// ═══════════════════════════════════════════════════════════
// TASK MODAL
// ═══════════════════════════════════════════════════════════
// ─── Subtask management (in-modal) ────────────────────────
let modalSubtasks=[]; // temp copy edited in modal, written back on save

function generateSubtaskId(){
  return "st-"+Math.random().toString(36).slice(2,8);
}

function renderSubtasks(){
  const container=$("subtasks-list");
  if(!container) return;
  container.innerHTML="";

  if(!modalSubtasks.length){
    container.innerHTML='<div class="subtask-empty">Nog geen subtaken. Voeg er een toe hieronder.</div>';
    return;
  }

  modalSubtasks.forEach((st,idx)=>{
    const card=document.createElement("div");
    card.className="subtask-card"+(st.status==="done"?" done":"");
    card.dataset.idx=idx;

    // Checkbox
    const check=document.createElement("div");
    check.className="subtask-check"+(st.status==="done"?" checked":"");
    check.innerHTML=st.status==="done"?'<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>':"";
    check.addEventListener("click",e=>{
      e.stopPropagation();
      st.status=st.status==="done"?"todo":"done";
      renderSubtasks();
    });

    // Body (title + schedule)
    const body=document.createElement("div");
    body.className="subtask-body";

    const titleInput=document.createElement("input");
    titleInput.type="text";
    titleInput.className="subtask-title";
    titleInput.value=st.title;
    titleInput.placeholder="Subtaak beschrijving...";
    titleInput.addEventListener("input",()=>{ st.title=titleInput.value; });
    titleInput.addEventListener("click",e=>e.stopPropagation());
    body.appendChild(titleInput);

    // Schedule row
    const schedRow=document.createElement("div");
    schedRow.className="subtask-schedule-row";

    // All-day toggle for subtask
    const stAllDay=document.createElement("button");
    stAllDay.type="button";
    stAllDay.className="subtask-cal-btn"+(st.allDay?" on":"");
    stAllDay.textContent=st.allDay?"Hele dag":"Hele dag";
    stAllDay.style.cssText=st.allDay?"background:var(--warning-subtle);border-color:var(--warning-subtle);color:#8B6914":"";
    stAllDay.addEventListener("click",e=>{
      e.stopPropagation();
      st.allDay=!st.allDay;
      renderSubtasks(); // re-render to swap input types
    });

    const startLabel=document.createElement("label");
    startLabel.textContent="Start:";
    const endLabel=document.createElement("label");
    endLabel.textContent="Eind:";

    let startInput, endInput;
    if(st.allDay){
      startInput=document.createElement("input");
      startInput.type="date";
      startInput.value=(st.scheduled?.start||"").slice(0,10);
      startInput.addEventListener("change",()=>{ if(!st.scheduled) st.scheduled={start:"",end:""}; st.scheduled.start=startInput.value; });

      endInput=document.createElement("input");
      endInput.type="date";
      endInput.value=(st.scheduled?.end||"").slice(0,10);
      endInput.addEventListener("change",()=>{ if(!st.scheduled) st.scheduled={start:"",end:""}; st.scheduled.end=endInput.value; });
    } else {
      startInput=document.createElement("input");
      startInput.type="datetime-local";
      startInput.value=st.scheduled?.start||"";
      startInput.addEventListener("change",()=>{ if(!st.scheduled) st.scheduled={start:"",end:""}; st.scheduled.start=startInput.value; });

      endInput=document.createElement("input");
      endInput.type="datetime-local";
      endInput.value=st.scheduled?.end||"";
      endInput.addEventListener("change",()=>{ if(!st.scheduled) st.scheduled={start:"",end:""}; st.scheduled.end=endInput.value; });
    }
    startInput.addEventListener("click",e=>e.stopPropagation());
    endInput.addEventListener("click",e=>e.stopPropagation());

    const calBtn=document.createElement("button");
    calBtn.type="button";
    calBtn.className="subtask-cal-btn"+(st.inCalendar!==false?" on":"");
    calBtn.textContent=st.inCalendar!==false?"📅 Agenda":"Agenda";
    calBtn.title="In iCal agenda opnemen";
    calBtn.addEventListener("click",e=>{
      e.stopPropagation();
      st.inCalendar=!st.inCalendar;
      calBtn.className="subtask-cal-btn"+(st.inCalendar?" on":"");
      calBtn.textContent=st.inCalendar?"📅 Agenda":"Agenda";
    });

    schedRow.appendChild(stAllDay);
    schedRow.appendChild(startLabel);
    schedRow.appendChild(startInput);
    schedRow.appendChild(endLabel);
    schedRow.appendChild(endInput);
    schedRow.appendChild(calBtn);
    body.appendChild(schedRow);

    // Actions
    const actions=document.createElement("div");
    actions.className="subtask-actions";
    const del=document.createElement("button");
    del.type="button";
    del.className="subtask-del";
    del.innerHTML="×";
    del.title="Subtaak verwijderen";
    del.addEventListener("click",e=>{
      e.stopPropagation();
      modalSubtasks.splice(idx,1);
      renderSubtasks();
    });
    actions.appendChild(del);

    card.appendChild(check);
    card.appendChild(body);
    card.appendChild(actions);
    container.appendChild(card);
  });
}

function wireSubtaskAdd(){
  const input=$("subtask-new-title");
  const btn=$("btn-add-subtask");
  if(!btn||!input) return;

  function addSubtask(){
    const title=input.value.trim();
    if(!title) return;
    modalSubtasks.push({
      id:generateSubtaskId(),
      title,
      status:"todo",
      scheduled:{start:"",end:""},
      inCalendar:true
    });
    input.value="";
    renderSubtasks();
    // Scroll to bottom of modal
    input.focus();
  }

  btn.onclick=addSubtask;
  input.onkeydown=(e)=>{ if(e.key==="Enter"){ e.preventDefault(); addSubtask(); }};
}

function openTaskModal(taskId){
  const t=state.tasks.find(x=>x.id===taskId);
  if(!t) return;
  ensureSchedule(t);
  state.selectedTaskId=taskId;

  $("modal-title").textContent=t.title||"Klus bewerken";
  $("task-modal").classList.remove("hidden");

  // Populate status select
  const stSel=$("f-status");
  stSel.innerHTML="";
  state.statuses.forEach(s=>stSel.appendChild(h("option",{value:s},s)));
  // If task has a status not in the list, add it
  if(t.status&&!state.statuses.includes(t.status)){
    stSel.appendChild(h("option",{value:t.status},t.status));
  }
  stSel.value=t.status||state.statuses[0]||"Backlog";

  // Populate executors
  const exec1=$("f-exec1"), exec2=$("f-exec2");
  [exec1,exec2].forEach(sel=>{
    sel.innerHTML='<option value="">—</option>';
    state.people.slice().sort((a,b)=>a.name.localeCompare(b.name)).forEach(p=>sel.appendChild(h("option",{value:p.id},p.name)));
  });
  exec1.value=(t.assignees||[])[0]||"";
  exec2.value=(t.assignees||[])[1]||"";

  // Populate datalists from state lists
  populateDatalist("dl-projects", [...new Set([...state.projects, ...state.tasks.map(t=>t.project).filter(Boolean)])]);
  populateDatalist("dl-groups", state.groups.map(g=>g.name));
  populateDatalist("dl-locations", state.locations);
  populateDatalist("dl-categories", state.categories);

  // Fill fields
  $("f-title").value=t.title||"";
  $("f-project").value=t.project||"";
  $("f-group").value=t.group||"";
  $("f-location").value=t.location||"";
  $("f-category").value=t.category||"";
  // All-day toggle
  const allDayBtn=$("f-allday");
  const allDayLabel=$("f-allday-label");
  function setAllDayMode(on){
    allDayBtn.classList.toggle("on",on);
    allDayLabel.textContent=on?"Ja":"Nee";
    // Swap visible inputs
    $("f-start").classList.toggle("hidden",on);
    $("f-start-date").classList.toggle("hidden",!on);
    $("f-end").classList.toggle("hidden",on);
    $("f-end-date").classList.toggle("hidden",!on);
  }
  setAllDayMode(!!t.allDay);

  // Populate date inputs from existing values
  if(t.allDay){
    $("f-start-date").value=(t.scheduled?.start||"").slice(0,10);
    $("f-end-date").value=(t.scheduled?.end||"").slice(0,10);
  }

  allDayBtn.onclick=()=>{
    const nowOn=!allDayBtn.classList.contains("on");
    setAllDayMode(nowOn);
    // Sync values between date/datetime fields
    if(nowOn){
      $("f-start-date").value=($("f-start").value||"").slice(0,10);
      $("f-end-date").value=($("f-end").value||"").slice(0,10);
    } else {
      const sd=$("f-start-date").value;
      const ed=$("f-end-date").value;
      if(sd&&!$("f-start").value) $("f-start").value=sd+"T09:00";
      if(ed&&!$("f-end").value) $("f-end").value=ed+"T17:00";
    }
  };

  $("f-start").value=t.scheduled?.start||"";
  $("f-end").value=t.scheduled?.end||"";

  // Calendar toggle
  const calBtn=$("f-calendar");
  const calLabel=$("f-calendar-label");
  const calOn=t.inCalendar!==false; // default true
  calBtn.classList.toggle("on",calOn);
  calLabel.textContent=calOn?"Ja":"Nee";
  calBtn.onclick=()=>{
    const nowOn=calBtn.classList.toggle("on");
    calLabel.textContent=nowOn?"Ja":"Nee";
  };

  $("f-hours-o").value=t.estimate_hours?.optimistic??0;
  $("f-hours-r").value=t.estimate_hours?.realistic??0;
  $("f-hours-w").value=t.estimate_hours?.worst??0;
  $("f-hours-actual").value=t.actual_hours??0;
  $("f-dod").value=t.definition_of_done||"";
  $("f-materials").value=materialsToText(t.materials);
  $("f-tools").value=(t.tools||[]).join("\n");
  $("f-notes").value=t.notes||"";

  // Load subtasks — deep clone to avoid mutating state before save
  modalSubtasks=JSON.parse(JSON.stringify(t.subtasks||[]));
  // Migrate old steps to subtasks if subtasks empty and steps exist
  if(!modalSubtasks.length && (t.steps||[]).length){
    modalSubtasks=t.steps.map(s=>({
      id:generateSubtaskId(),
      title:s,
      status:"todo",
      scheduled:{start:"",end:""},
      inCalendar:false
    }));
  }
  renderSubtasks();
  wireSubtaskAdd();
}

function populateDatalist(id, items){
  const dl=$(id);
  if(!dl) return;
  dl.innerHTML="";
  items.forEach(i=>dl.appendChild(h("option",{value:i})));
}

function closeTaskModal(){
  $("task-modal").classList.add("hidden");
  state.selectedTaskId=null;
}

function readTaskForm(){
  const id=state.selectedTaskId;
  const t=state.tasks.find(x=>x.id===id);
  if(!t) return null;
  ensureSchedule(t);

  t.title=$("f-title").value.trim()||t.title;
  t.project=$("f-project").value.trim();
  t.group=$("f-group").value.trim();
  t.location=$("f-location").value.trim();
  t.category=$("f-category").value.trim();
  t.status=$("f-status").value;
  t.assignees=[$("f-exec1").value,$("f-exec2").value].filter(Boolean);
  t.allDay=$("f-allday")?.classList.contains("on")??false;
  if(t.allDay){
    // All-day: store as date-only strings
    const sd=$("f-start-date").value;
    const ed=$("f-end-date").value;
    t.scheduled.start=sd||"";
    t.scheduled.end=ed||"";
  } else {
    t.scheduled.start=$("f-start").value;
    t.scheduled.end=$("f-end").value;
  }
  t.inCalendar=$("f-calendar")?.classList.contains("on")??true;
  if(t.scheduled.start){
    try { t.scheduled.date=t.scheduled.start.split("T")[0]; } catch(e){}
  }
  t.estimate_hours={
    optimistic:Number($("f-hours-o").value||0),
    realistic:Number($("f-hours-r").value||0),
    worst:Number($("f-hours-w").value||0)
  };
  t.actual_hours=Number($("f-hours-actual").value||0);
  t.definition_of_done=$("f-dod").value;
  t.materials=parseMaterialsText($("f-materials").value);
  t.tools=parseLines($("f-tools").value);
  t.subtasks=JSON.parse(JSON.stringify(modalSubtasks));
  // Keep steps as derived list of subtask titles for backward compat
  t.steps=t.subtasks.map(st=>st.title).filter(Boolean);
  t.notes=$("f-notes").value;
  return t;
}

function saveTask(){
  const t=readTaskForm();
  if(!t) { toast("Geen klus geselecteerd","warn"); return; }

  // Auto-add new values to taxonomy lists if user typed something new
  if(t.group&&!state.groups.find(g=>g.name===t.group)){
    const color=GROUP_COLORS[state.groups.length%GROUP_COLORS.length];
    state.groups.push({id:slugify(t.group),name:t.group,color});
  }
  if(t.location&&!state.locations.includes(t.location)){
    state.locations.push(t.location);
  }
  if(t.category&&!state.categories.includes(t.category)){
    state.categories.push(t.category);
  }
  if(t.project&&!state.projects.includes(t.project)){
    state.projects.push(t.project);
  }

  // Ensure end date exists when start is set
  ensureSchedule(t);

  // Auto-set status to "Ingepland" when a date/time is set
  if(t.scheduled.start && t.status==="Backlog"){
    t.status="Ingepland";
  }

  // Normalize end > start
  if(t.scheduled.start&&t.scheduled.end){
    if(new Date(t.scheduled.end)<=new Date(t.scheduled.start)){
      const s=parseDate(t.scheduled.start);
      // Default: add realistic hours, minimum 1 hour
      const hrs=Number(t.estimate_hours?.realistic)||1;
      s.setMinutes(s.getMinutes()+Math.round(hrs*60));
      const p=n=>String(n).padStart(2,"0");
      t.scheduled.end=`${s.getFullYear()}-${p(s.getMonth()+1)}-${p(s.getDate())}T${p(s.getHours())}:${p(s.getMinutes())}`;
    }
  }

  markDirty();
  closeTaskModal();

  // Auto-navigate calendar/gantt to show the saved task's date
  if(t.scheduled.start){
    try { state.overzicht.focusDate=t.scheduled.start.split("T")[0]; } catch(e){}
  }

  if(state.currentView==="dashboard") renderDashboard();
  else if(state.currentView==="overzicht") renderOverzicht();
  refreshNotifications();
}

function deleteTask(){
  if(!state.selectedTaskId) return;
  const t=state.tasks.find(x=>x.id===state.selectedTaskId);
  if(!t) return;
  if(!confirm(`Verwijder "${t.title}"? Dit kan niet ongedaan worden.`)) return;
  state.tasks=state.tasks.filter(x=>x.id!==state.selectedTaskId);
  markDirty();
  closeTaskModal();
  if(state.currentView==="dashboard") renderDashboard();
  else if(state.currentView==="overzicht") renderOverzicht();
}

function addNewTask(){
  const existing=new Set(state.tasks.map(t=>t.id));
  let n=1;
  while(existing.has(`TASK-${String(n).padStart(3,"0")}`)) n++;
  const id=`TASK-${String(n).padStart(3,"0")}`;

  const t={
    id,
    project:"",
    group:state.groups[0]?.name||"",
    location:"",
    type:"",
    category:"",
    title:"Nieuwe klus",
    priority:"",
    status:"Backlog",
    owner:"",
    assignees:[],
    estimate_hours:{optimistic:0,realistic:0,worst:0},
    actual_hours:0,
    scheduled:{date:"",timeblock:"",start:"",end:""},
    dependencies:[],
    definition_of_done:"",
    materials:[],
    tools:[],
    steps:[],
    subtasks:[],
    notes:"",
    inCalendar:true,
    allDay:false
  };
  state.tasks.push(t);
  markDirty();
  openTaskModal(id);
}

// ─── Print callsheet ──────────────────────────────────────
function printTask(){
  const t=readTaskForm();
  if(!t) return;
  const exec1=getPersonName((t.assignees||[])[0]);
  const exec2=getPersonName((t.assignees||[])[1]);
  const mats=(t.materials||[]).map(m=>`<li>${escHtml(m.item||"")}${m.qty?" — "+escHtml(m.qty):""}${m.status?" ("+escHtml(m.status)+")":""}</li>`).join("")||"<li>–</li>";
  const tools=(t.tools||[]).map(x=>`<li>${escHtml(x)}</li>`).join("")||"<li>–</li>";
  const subtaskList=(t.subtasks||[]).map(st=>{
    const check=st.status==="done"?"✓ ":"☐ ";
    const sched=st.scheduled?.start?` (${fmtDateTime(st.scheduled.start)})`:""  ;
    return `<li>${check}${escHtml(st.title)}${sched}</li>`;
  }).join("")||"<li>–</li>";

  $("print-sheet").innerHTML=`
    <div class="ps-header">
      <div class="ps-title">${escHtml(t.title)}</div>
      <div class="ps-meta">${escHtml(t.group||"–")} · ${escHtml(t.location||"–")} · Status: ${escHtml(t.status)} · Start: ${escHtml(fmtDateTime(t.scheduled?.start))} · Eind: ${escHtml(fmtDateTime(t.scheduled?.end))}</div>
    </div>
    <div class="ps-grid">
      <div class="ps-box"><h4>Uitvoerders</h4><p>${escHtml(exec1)}${exec2!=="–"?", "+escHtml(exec2):""}</p></div>
      <div class="ps-box"><h4>Definition of Done</h4><p>${escHtml(t.definition_of_done||"–")}</p></div>
      <div class="ps-box"><h4>Materialen</h4><ul>${mats}</ul></div>
      <div class="ps-box"><h4>Tools</h4><ul>${tools}</ul></div>
      <div class="ps-box ps-full"><h4>Subtaken</h4><ol>${subtaskList}</ol></div>
      <div class="ps-box ps-full"><h4>Notities</h4><p>${escHtml(t.notes||"–")}</p></div>
    </div>`;
  requestAnimationFrame(()=>window.print());
}

// ═══════════════════════════════════════════════════════════
// iCAL EXPORT
// ═══════════════════════════════════════════════════════════
function buildICalString(){
  const scheduled=state.tasks.filter(t=>t.scheduled?.start&&t.inCalendar!==false);
  if(!scheduled.length) return null;

  const fmtIcal=(iso)=>{
    const d=new Date(iso);
    const p=n=>String(n).padStart(2,"0");
    return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}00`;
  };
  const fmtDate=(dateStr)=>dateStr.replace(/-/g,"").slice(0,8);
  const nextDay=(dateStr)=>{
    const d=new Date(dateStr+"T00:00:00");
    d.setDate(d.getDate()+1);
    const p=n=>String(n).padStart(2,"0");
    return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}`;
  };

  function icalDates(item){
    if(item.allDay){
      const sd=item.scheduled.start.slice(0,10);
      const ed=(item.scheduled.end||item.scheduled.start).slice(0,10);
      return `DTSTART;VALUE=DATE:${fmtDate(sd)}\r\nDTEND;VALUE=DATE:${nextDay(ed)}`;
    }
    const start=fmtIcal(item.scheduled.start);
    const end=item.scheduled.end?fmtIcal(item.scheduled.end):fmtIcal(new Date(new Date(item.scheduled.start).getTime()+36e5).toISOString());
    return `DTSTART:${start}\r\nDTEND:${end}`;
  }

  let cal="BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Klusplanner Pro//NL\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\nX-WR-CALNAME:Klusplanner\r\n";
  scheduled.forEach(t=>{
    const uid=`${t.id}@klusplanner`;
    const desc=[
      t.group?`Groep: ${t.group}`:"",
      t.definition_of_done?`DoD: ${t.definition_of_done}`:"",
      (t.subtasks||[]).length?`Subtaken: ${t.subtasks.map(s=>s.title).join(", ")}`:"",
      getPersonName((t.assignees||[])[0])!=="–"?`Uitvoerder: ${getPersonName((t.assignees||[])[0])}`:"",
      t.notes||""
    ].filter(Boolean).join("\\n");

    cal+=`BEGIN:VEVENT\r\nUID:${uid}\r\nDTSTAMP:${fmtIcal(new Date().toISOString())}\r\n${icalDates(t)}\r\nSUMMARY:${(t.title||"").replace(/[,;\\]/g," ")}\r\nLOCATION:${(t.location||"").replace(/[,;\\]/g," ")}\r\nDESCRIPTION:${desc.replace(/[\\]/g,"\\\\").replace(/\n/g,"\\n")}\r\nSTATUS:${t.status==="Afgerond"?"COMPLETED":"CONFIRMED"}\r\nEND:VEVENT\r\n`;

    (t.subtasks||[]).forEach(st=>{
      if(!st.scheduled?.start||st.inCalendar===false) return;
      const stUid=`${st.id}@klusplanner`;
      const stDesc=`Subtaak van: ${(t.title||"").replace(/[,;\\]/g," ")}`;
      cal+=`BEGIN:VEVENT\r\nUID:${stUid}\r\nDTSTAMP:${fmtIcal(new Date().toISOString())}\r\n${icalDates(st)}\r\nSUMMARY:${(st.title||"").replace(/[,;\\]/g," ")}\r\nLOCATION:${(t.location||"").replace(/[,;\\]/g," ")}\r\nDESCRIPTION:${stDesc}\r\nSTATUS:${st.status==="done"?"COMPLETED":"CONFIRMED"}\r\nEND:VEVENT\r\n`;
    });
  });
  cal+="END:VCALENDAR\r\n";
  return cal;
}

function generateICal(){
  const cal=buildICalString();
  if(!cal){ toast("Geen klussen met agenda-vinkje en startdatum","warn"); return; }

  const count=state.tasks.filter(t=>t.scheduled?.start&&t.inCalendar!==false).length;
  const blob=new Blob([cal],{type:"text/calendar"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download="klusplanner.ics";
  a.click();
  URL.revokeObjectURL(a.href);
  toast(`${count} klussen geëxporteerd als .ics`);
}

// Push .ics to GitHub so calendar apps can subscribe to the URL
let icsSha=null;
async function pushICalToGitHub(){
  if(!githubConfig) return;
  const cal=buildICalString()||"BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Klusplanner Pro//NL\r\nEND:VCALENDAR\r\n";
  const encoded=btoa(unescape(encodeURIComponent(cal)));
  const body={ message:"Update klusplanner.ics", content:encoded };
  if(icsSha) body.sha=icsSha;

  try {
    const data=await ghFetch("klusplanner.ics",{ method:"PUT", body:JSON.stringify(body) });
    icsSha=data.content.sha;
  } catch(e){
    if(e.status===409||e.status===422){
      // SHA mismatch — fetch and retry
      const sha=await ghSha("klusplanner.ics");
      const retryBody={ message:"Update klusplanner.ics", content:encoded };
      if(sha) retryBody.sha=sha;
      try {
        const data=await ghFetch("klusplanner.ics",{ method:"PUT", body:JSON.stringify(retryBody) });
        icsSha=data.content.sha;
      } catch(e2){ console.warn("iCal push retry failed:",e2); }
    } else {
      console.warn("iCal push failed:",e);
    }
  }
}

// ═══════════════════════════════════════════════════════════
// EXPORT / IMPORT
// ═══════════════════════════════════════════════════════════
function exportJSON(){
  const payload={
    exported_at:new Date().toISOString(),
    tasks:state.tasks, people:state.people, groups:state.groups,
    statuses:state.statuses, locations:state.locations, categories:state.categories, projects:state.projects
  };
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download="klusplanner-export.json";
  a.click();
  URL.revokeObjectURL(a.href);
  toast("Data geëxporteerd");
}

async function importJSON(){
  const file=$("file-import")?.files[0];
  if(!file){ toast("Kies eerst een bestand","warn"); return; }
  try {
    const text=await file.text();
    const obj=JSON.parse(text);
    if(!Array.isArray(obj.tasks)) throw new Error("Verwacht {tasks:[...]}");
    state.tasks=obj.tasks;
    state.people=obj.people||[];
    if(obj.groups) state.groups=obj.groups;
    if(obj.statuses) state.statuses=obj.statuses;
    if(obj.locations) state.locations=obj.locations;
    if(obj.categories) state.categories=obj.categories;
    if(obj.projects) state.projects=obj.projects;
    state.tasks.forEach(t=>ensureSchedule(t));
    await commitChanges();
    toast("Import klaar ✓");
    switchView(state.currentView);
  } catch(e){
    toast("Import mislukt: "+e.message,"err");
  }
}

// ═══════════════════════════════════════════════════════════
// WIRE UI
// ═══════════════════════════════════════════════════════════
function wireUI(){
  // Save bar: commit / discard
  $("btn-commit")?.addEventListener("click",async ()=>{
    $("btn-commit").disabled=true;
    $("btn-commit").innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M23 4v6h-6M1 20v-6h6"/></svg> Bezig...';
    await commitChanges();
    $("btn-commit").disabled=false;
    $("btn-commit").innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg> Opslaan &amp; sync';
  });
  $("btn-discard")?.addEventListener("click",discardChanges);

  // Warn on page close if dirty
  window.addEventListener("beforeunload",e=>{
    if(isDirty){ e.preventDefault(); e.returnValue=""; }
  });

  // Navigation
  $$(".nav-item[data-view]").forEach(btn=>{
    btn.addEventListener("click",()=>switchView(btn.dataset.view));
  });

  // Sidebar collapse
  $("btn-collapse-sidebar")?.addEventListener("click",()=>{
    $("sidebar").classList.toggle("collapsed");
  });
  $("btn-open-sidebar")?.addEventListener("click",()=>{
    $("sidebar").classList.toggle("open");
  });

  // Quick add
  $("btn-quick-add")?.addEventListener("click",addNewTask);

  // Sync
  $("btn-sync")?.addEventListener("click",async ()=>{
    if(githubConfig){
      if(isDirty&&!confirm("Je hebt onopgeslagen wijzigingen. Eerst opslaan, of overschrijven met GitHub data?")) return;
      await syncFromGitHub();
      takeSnapshot();
      markClean();
      switchView(state.currentView);
      toast("Data opgehaald ✓");
    } else {
      toast("Niet verbonden met GitHub","warn");
    }
  });

  // Overzicht mode toggle
  $$(".mode-btn[data-mode]").forEach(btn=>{
    btn.addEventListener("click",()=>{
      state.overzicht.mode=btn.dataset.mode;
      renderOverzicht();
    });
  });

  // Agenda zoom
  $$(".mode-btn[data-zoom]").forEach(btn=>{
    btn.addEventListener("click",()=>{
      state.overzicht.agendaZoom=btn.dataset.zoom;
      renderOverzicht();
    });
  });

  // Gantt zoom
  $$(".mode-btn[data-gzoom]").forEach(btn=>{
    btn.addEventListener("click",()=>{
      state.overzicht.ganttZoom=btn.dataset.gzoom;
      renderOverzicht();
    });
  });

  // Calendar nav
  $("cal-prev")?.addEventListener("click",()=>navAgenda(-1));
  $("cal-next")?.addEventListener("click",()=>navAgenda(1));
  $("cal-today")?.addEventListener("click",()=>{ state.overzicht.focusDate=todayYmd(); renderOverzicht(); });

  // Gantt nav
  $("gantt-prev")?.addEventListener("click",()=>navGantt(-1));
  $("gantt-next")?.addEventListener("click",()=>navGantt(1));
  $("gantt-today")?.addEventListener("click",()=>{ state.overzicht.focusDate=todayYmd(); renderOverzicht(); });

  // Filters
  $("filter-search")?.addEventListener("input",()=>renderOverzicht());
  ["filter-status","filter-group","filter-person","filter-project"].forEach(id=>{
    $(id)?.addEventListener("change",()=>renderOverzicht());
  });
  $("btn-clear-filters")?.addEventListener("click",()=>{
    $("filter-search").value="";
    $("filter-status").value="";
    $("filter-group").value="";
    $("filter-person").value="";
    $("filter-project").value="";
    renderOverzicht();
  });
  $("mat-filter-status")?.addEventListener("change",renderMaterials);

  // Task modal
  $("btn-save-task")?.addEventListener("click",saveTask);
  $("btn-close-modal")?.addEventListener("click",closeTaskModal);
  $("btn-delete-task")?.addEventListener("click",deleteTask);
  $("btn-print-task")?.addEventListener("click",printTask);
  $("task-modal")?.addEventListener("click",(e)=>{
    if(e.target.id==="task-modal") closeTaskModal();
  });

  // People
  $("btn-add-person")?.addEventListener("click",()=>{
    const name=prompt("Naam van persoon:");
    if(!name) return;
    let id=slugify(name);
    if(!id) return;
    const existing=new Set(state.people.map(p=>p.id));
    if(existing.has(id)){ let n=2; while(existing.has(`${id}-${n}`)) n++; id=`${id}-${n}`; }
    state.people.push({id,name:name.trim()});
    markDirty();
    renderPeople();
  });

  // Settings
  $("btn-export")?.addEventListener("click",exportJSON);
  $("btn-import")?.addEventListener("click",importJSON);
  $("btn-ical")?.addEventListener("click",generateICal);

  // Generic "add to list" helper
  function wireAddButton(btnId,inputId,stateKey,renderFn,isGroup){
    $(btnId)?.addEventListener("click",()=>{
      const name=$(inputId)?.value.trim();
      if(!name) return;
      if(isGroup){
        const id=slugify(name);
        if(state.groups.find(g=>g.id===id)){ toast("Bestaat al","warn"); return; }
        const color=GROUP_COLORS[state.groups.length%GROUP_COLORS.length];
        state.groups.push({id,name,color});
      } else {
        if(state[stateKey].includes(name)){ toast("Bestaat al","warn"); return; }
        state[stateKey].push(name);
      }
      $(inputId).value="";
      markDirty();
      renderFn();
    });
    // Enter key support
    $(inputId)?.addEventListener("keydown",e=>{
      if(e.key==="Enter"){ e.preventDefault(); $(btnId)?.click(); }
    });
  }

  wireAddButton("btn-add-group","new-group-name","groups",()=>renderGroupsManager(),true);
  wireAddButton("btn-add-location","new-location-name","locations",()=>renderSimpleListManager("mgr-locations",state.locations,"locations"));
  wireAddButton("btn-add-category","new-category-name","categories",()=>renderSimpleListManager("mgr-categories",state.categories,"categories"));
  wireAddButton("btn-add-status","new-status-name","statuses",()=>renderSimpleListManager("mgr-statuses",state.statuses,"statuses"));
  wireAddButton("btn-add-project","new-project-name","projects",()=>renderSimpleListManager("mgr-projects",state.projects,"projects"));

  // Danger zone
  $("btn-clear-all")?.addEventListener("click",()=>{
    if(!confirm("Alle klussen en personen wissen? Lijsten en instellingen blijven behouden.")) return;
    state.tasks=[];
    state.people=[];
    markDirty();
    toast("Klussen en personen gewist");
    switchView("dashboard");
  });

  $("btn-clear-local")?.addEventListener("click",()=>{
    if(!confirm("Lokale cache wissen? Als je met GitHub werkt, worden de data opnieuw opgehaald bij volgende sync.")) return;
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_KEY+"_dirty");
    tasksSha=null; peopleSha=null; configSha=null;
    toast("Lokale cache gewist — herlaad de pagina","ok");
    setTimeout(()=>location.reload(),1500);
  });

  $("btn-reset-lists")?.addEventListener("click",()=>{
    if(!confirm("Alle lijsten (groepen, projecten, locaties, statussen, categorieën) terugzetten naar standaard?")) return;
    state.groups=[...DEFAULT_GROUPS];
    state.statuses=[...DEFAULT_STATUSES];
    state.locations=[...DEFAULT_LOCATIONS];
    state.categories=[...DEFAULT_CATEGORIES];
    state.projects=[...DEFAULT_PROJECTS];
    markDirty();
    renderSettings();
    toast("Lijsten teruggezet ✓");
  });

  // Logout — clears user session, keeps GitHub config
  $("btn-logout")?.addEventListener("click",()=>{
    if(isDirty&&!confirm("Je hebt onopgeslagen wijzigingen. Toch uitloggen?")) return;
    state.currentUser=null;
    localStorage.removeItem(SESSION_KEY);
    isOnline=false;
    updateSyncIndicator("offline");
    $("app-shell").classList.add("hidden");
    $("login-screen").classList.remove("hidden");
    $("login-user").value="";
    $("login-pass").value="";
    $("login-user").focus();
  });

  // GitHub setup from settings
  $("btn-gh-setup")?.addEventListener("click",showGHSetupModal);
  $("btn-gh-disconnect")?.addEventListener("click",()=>{
    if(!confirm("GitHub ontkoppelen? Data blijft lokaal beschikbaar.")) return;
    githubConfig=null;
    localStorage.removeItem(CONFIG_KEY);
    isOnline=false;
    updateSyncIndicator("offline");
    updateGHSettingsUI();
    toast("GitHub ontkoppeld");
  });
}

function navAgenda(dir){
  const d=new Date(state.overzicht.focusDate+"T00:00:00");
  const z=state.overzicht.agendaZoom;
  if(z==="day") d.setDate(d.getDate()+dir);
  else if(z==="week") d.setDate(d.getDate()+dir*7);
  else d.setMonth(d.getMonth()+dir);
  state.overzicht.focusDate=ymd(d);
  renderOverzicht();
}

function navGantt(dir){
  const d=new Date(state.overzicht.focusDate+"T00:00:00");
  if(state.overzicht.ganttZoom==="week") d.setDate(d.getDate()+dir*7);
  else d.setMonth(d.getMonth()+dir);
  state.overzicht.focusDate=ymd(d);
  renderOverzicht();
}

// ─── Load seed data ───────────────────────────────────────
async function loadDefaults(){
  try {
    const [tasksRes,peopleRes]=await Promise.all([fetch("data/tasks.json"),fetch("data/people.json")]);
    if(tasksRes.ok) state.tasks=await tasksRes.json();
    if(peopleRes.ok) state.people=await peopleRes.json();
    state.groups=[...DEFAULT_GROUPS];
    state.statuses=[...DEFAULT_STATUSES];
    state.locations=[...DEFAULT_LOCATIONS];
    state.categories=[...DEFAULT_CATEGORIES];
    state.projects=[...DEFAULT_PROJECTS];
    state.tasks.forEach(t=>ensureSchedule(t));
    saveLocal();
  } catch(e){ console.warn("Could not load defaults:",e); }
}

// ═══════════════════════════════════════════════════════════
// LOGIN — Simple user/pass → straight to app
// ═══════════════════════════════════════════════════════════
function wireLogin(){
  $("login-user")?.addEventListener("keydown",e=>{ if(e.key==="Enter") $("login-pass")?.focus(); });
  $("login-pass")?.addEventListener("keydown",e=>{ if(e.key==="Enter") $("btn-login")?.click(); });

  $("btn-login")?.addEventListener("click",()=>{
    const username=$("login-user").value.trim();
    const password=$("login-pass").value;

    if(!username||!password){
      showLoginError("Vul gebruikersnaam en wachtwoord in.");
      return;
    }

    const user=USERS.find(u=>
      u.username.toLowerCase()===username.toLowerCase() && u.password===password
    );

    if(!user){
      showLoginError("Onjuiste gebruikersnaam of wachtwoord.");
      $("login-pass").value="";
      $("login-pass").focus();
      return;
    }

    // Login successful — go straight to app
    state.currentUser={ username:user.username, displayName:user.displayName, avatar:user.avatar };
    saveSession();

    // Load GitHub config if previously set up (from Settings)
    const savedGH=loadGHConfig();
    if(savedGH) githubConfig=savedGH;

    proceedToApp();
  });
}

function proceedToApp(){
  // If GitHub connected, try sync first
  if(githubConfig){
    syncFromGitHub().then(synced=>{
      if(!synced) loadLocalData();
      startApp();
    }).catch(()=>{
      loadLocalData();
      startApp();
    });
  } else {
    loadLocalData();
    if(state.tasks.length===0){
      loadDefaults().then(()=>startApp()).catch(()=>startApp());
    } else {
      startApp();
    }
  }
}

function loadLocalData(){
  const local=loadLocal();
  if(local){
    state.tasks=local.tasks||[];
    state.people=local.people||[];
    state.groups=local.groups||[...DEFAULT_GROUPS];
    state.statuses=local.statuses||[...DEFAULT_STATUSES];
    state.locations=local.locations||[...DEFAULT_LOCATIONS];
    state.categories=local.categories||[...DEFAULT_CATEGORIES];
    state.projects=local.projects||[...DEFAULT_PROJECTS];
  }
}

function showLoginError(msg){
  const el=$("login-error");
  if(!el) return;
  el.textContent=msg;
  el.classList.remove("hidden");
  setTimeout(()=>el.classList.add("hidden"),4000);
}

// ═══════════════════════════════════════════════════════════
// NOTIFICATION BELL — upcoming & action-needed alerts
// ═══════════════════════════════════════════════════════════
let notifications=[];
let dismissedNotifKeys=new Set();

function loadDismissed(){
  try {
    const raw=localStorage.getItem(STORAGE_KEY+"_dismissed");
    if(raw){
      const data=JSON.parse(raw);
      // Reset dismissed daily — key includes date
      const savedDate=data._date||"";
      const today=new Date().toISOString().slice(0,10);
      if(savedDate===today){
        dismissedNotifKeys=new Set(data.keys||[]);
      } else {
        dismissedNotifKeys=new Set();
      }
    }
  } catch(e){}
}
function saveDismissed(){
  try {
    const today=new Date().toISOString().slice(0,10);
    localStorage.setItem(STORAGE_KEY+"_dismissed",JSON.stringify({_date:today,keys:[...dismissedNotifKeys]}));
  } catch(e){}
}

function buildNotifications(){
  const now=new Date();
  const today=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  const notifs=[];

  state.tasks.forEach(t=>{
    if(!t.scheduled?.start) return;
    if(t.status==="Afgerond") return;

    const start=parseDate(t.scheduled.start);
    const end=t.scheduled.end?parseDate(t.scheduled.end):null;
    if(!start) return;

    const daysUntilStart=Math.ceil((start-today)/(864e5));
    const daysUntilEnd=end?Math.ceil((end-today)/(864e5)):null;

    // ── 2 days before start ──
    if(daysUntilStart===2){
      notifs.push({
        key:`upcoming-2d-${t.id}`,
        icon:"📅", iconClass:"info",
        title:`"${t.title}" begint overmorgen`,
        desc:t.location?`Locatie: ${t.location}`:"",
        taskId:t.id,
        time:"Over 2 dagen",
        priority:2
      });
    }

    // ── 1 day before start (tomorrow) ──
    if(daysUntilStart===1){
      notifs.push({
        key:`upcoming-1d-${t.id}`,
        icon:"⏰", iconClass:"warn",
        title:`"${t.title}" begint morgen`,
        desc:t.location?`Locatie: ${t.location}`:"",
        taskId:t.id,
        time:"Morgen",
        priority:3
      });
    }

    // ── Starting today ──
    if(daysUntilStart===0 && t.status==="Ingepland"){
      notifs.push({
        key:`today-${t.id}`,
        icon:"🔨", iconClass:"warn",
        title:`"${t.title}" staat vandaag gepland`,
        desc:t.allDay?"Hele dag":`Start: ${fmtDateTime(t.scheduled.start)}`,
        taskId:t.id,
        time:"Vandaag",
        priority:4
      });
    }

    // ── Overdue: end date passed but not done ──
    if(daysUntilEnd!==null && daysUntilEnd<0 && t.status!=="Afgerond"){
      notifs.push({
        key:`overdue-${t.id}`,
        icon:"🚨", iconClass:"urgent",
        title:`"${t.title}" is verlopen`,
        desc:`Eindtijd was ${fmtDateTime(t.scheduled.end)}`,
        taskId:t.id,
        time:`${Math.abs(daysUntilEnd)} dag${Math.abs(daysUntilEnd)>1?"en":""} geleden`,
        priority:5
      });
    }

    // ── Materials needed (status "Wacht op materiaal") ──
    if(t.status==="Wacht op materiaal"){
      const missing=(t.materials||[]).filter(m=>m.status&&m.status.toLowerCase().includes("kopen")).map(m=>m.item).join(", ");
      notifs.push({
        key:`material-${t.id}`,
        icon:"🛒", iconClass:"warn",
        title:`Materiaal regelen voor "${t.title}"`,
        desc:missing?`Nog kopen: ${missing}`:"Check materiaalllijst",
        taskId:t.id,
        time:"Actie nodig",
        priority:3
      });
    }

    // ── Waiting for help/appointment ──
    if(t.status==="Wacht op hulp/afspraak"){
      notifs.push({
        key:`waiting-${t.id}`,
        icon:"📞", iconClass:"info",
        title:`Afspraak nodig voor "${t.title}"`,
        desc:"Hulp of afspraak regelen",
        taskId:t.id,
        time:"Actie nodig",
        priority:2
      });
    }

    // ── Subtasks with upcoming dates ──
    (t.subtasks||[]).forEach(st=>{
      if(!st.scheduled?.start||st.status==="done") return;
      const stStart=parseDate(st.scheduled.start);
      if(!stStart) return;
      const stDays=Math.ceil((stStart-today)/(864e5));

      if(stDays>=0 && stDays<=2){
        const when=stDays===0?"vandaag":stDays===1?"morgen":"overmorgen";
        notifs.push({
          key:`subtask-${st.id}`,
          icon:"📋", iconClass:"info",
          title:`Subtaak "${st.title}" — ${when}`,
          desc:`Onderdeel van: ${t.title}`,
          taskId:t.id,
          time:when.charAt(0).toUpperCase()+when.slice(1),
          priority:stDays===0?4:stDays===1?3:2
        });
      }
    });
  });

  // Sort by priority (highest first)
  notifs.sort((a,b)=>b.priority-a.priority);

  // Filter out dismissed
  notifications=notifs.filter(n=>!dismissedNotifKeys.has(n.key));
}

function renderNotifBadge(){
  const badge=$("notif-badge");
  if(!badge) return;
  const count=notifications.length;
  badge.textContent=count>99?"99+":count;
  badge.classList.toggle("hidden",count===0);
}

function renderNotifPanel(){
  const list=$("notif-list");
  if(!list) return;

  if(!notifications.length){
    list.innerHTML='<div class="notif-empty">Geen meldingen</div>';
    return;
  }

  list.innerHTML="";
  notifications.forEach(n=>{
    const item=document.createElement("div");
    item.className="notif-item unread";
    item.innerHTML=`
      <div class="notif-icon ${n.iconClass}">${n.icon}</div>
      <div class="notif-body">
        <div class="notif-title">${escHtml(n.title)}</div>
        <div class="notif-desc">${escHtml(n.desc)}</div>
      </div>
      <div class="notif-time">${escHtml(n.time)}</div>
    `;
    item.addEventListener("click",()=>{
      $("notif-panel")?.classList.add("hidden");
      openTaskModal(n.taskId);
    });
    list.appendChild(item);
  });
}

function refreshNotifications(){
  buildNotifications();
  renderNotifBadge();
  // Only re-render panel if it's open
  if(!$("notif-panel")?.classList.contains("hidden")){
    renderNotifPanel();
  }
}

function wireNotifBell(){
  const bell=$("btn-notif-bell");
  const panel=$("notif-panel");
  if(!bell||!panel) return;

  bell.addEventListener("click",(e)=>{
    e.stopPropagation();
    const willOpen=panel.classList.contains("hidden");
    panel.classList.toggle("hidden");
    if(willOpen) renderNotifPanel();
  });

  // Close panel on click outside
  document.addEventListener("click",(e)=>{
    if(!panel.contains(e.target)&&e.target!==bell&&!bell.contains(e.target)){
      panel.classList.add("hidden");
    }
  });

  // Clear all
  $("btn-notif-clear")?.addEventListener("click",(e)=>{
    e.stopPropagation();
    notifications.forEach(n=>dismissedNotifKeys.add(n.key));
    saveDismissed();
    notifications=[];
    renderNotifBadge();
    renderNotifPanel();
  });

  loadDismissed();
  refreshNotifications();
}

// ═══════════════════════════════════════════════════════════
// TASK SCHEDULER — auto-start & end-time notifications
// ═══════════════════════════════════════════════════════════
const snoozedEnds=new Set();
let notifyTaskId=null;
let schedulerTimer=null;

function startScheduler(){
  if(schedulerTimer) clearInterval(schedulerTimer);
  runScheduler();
  schedulerTimer=setInterval(runScheduler, 30000);
}

function runScheduler(){
  const now=new Date();
  let changed=false;

  state.tasks.forEach(t=>{
    if(!t.scheduled?.start) return;
    const start=t.allDay?new Date(t.scheduled.start+"T00:00:00"):new Date(t.scheduled.start);
    const end=t.allDay
      ?(t.scheduled.end?new Date(t.scheduled.end+"T23:59:59"):new Date(t.scheduled.start+"T23:59:59"))
      :(t.scheduled.end?new Date(t.scheduled.end):null);

    // Auto-start: set to "Bezig" when start time is reached
    if(now>=start && (t.status==="Backlog"||t.status==="Ingepland")){
      t.status="Bezig";
      changed=true;
      showBrowserNotif(`🔨 "${t.title}" is gestart`, t.location?`Locatie: ${t.location}`:"");
    }

    // End-time notification: prompt when end time is reached
    if(end && now>=end && t.status==="Bezig" && !snoozedEnds.has(t.id)){
      if(!notifyTaskId) showEndNotification(t);
    }

    // ── Subtask scheduling ──
    (t.subtasks||[]).forEach(st=>{
      if(!st.scheduled?.start) return;
      const stStart=new Date(st.scheduled.start);
      const stEnd=st.scheduled.end?new Date(st.scheduled.end):null;

      // Auto-start subtask
      if(now>=stStart && st.status==="todo"){
        st.status="bezig";
        changed=true;
        showBrowserNotif(`▶ Subtaak gestart: "${st.title}"`, `Onderdeel van: ${t.title}`);
      }

      // End-time notification for subtask
      if(stEnd && now>=stEnd && st.status==="bezig" && !snoozedEnds.has(st.id)){
        if(!notifyTaskId) showEndNotification(t, st);
      }
    });
  });

  if(changed){
    markDirty();
    if(state.currentView==="overzicht"||state.currentView==="dashboard") switchView(state.currentView);
  }

  // Refresh bell notifications
  refreshNotifications();
}

function showEndNotification(t, subtask){
  // If it's a subtask notification, track the subtask id; otherwise the task id
  const isSubtask=!!subtask;
  const item=subtask||t;
  const itemId=isSubtask?subtask.id:t.id;
  notifyTaskId=itemId;
  // Store parent task id so we can find it later
  $("notify-modal").dataset.taskId=t.id;
  $("notify-modal").dataset.subtaskId=isSubtask?subtask.id:"";

  const modal=$("notify-modal");
  const msg=$("notify-message");
  const endInput=$("notify-new-end");
  const endTime=isSubtask?subtask.scheduled.end:t.scheduled.end;

  const titleText=isSubtask?`Subtaak: ${escHtml(subtask.title)}`:`${escHtml(t.title)}`;
  const parentInfo=isSubtask?`<br><span style="font-size:12px;color:var(--text-tertiary)">Onderdeel van: ${escHtml(t.title)}</span>`:"";

  msg.innerHTML=`<strong>${titleText}</strong> zou nu klaar moeten zijn.${parentInfo}<br>
    <span style="color:var(--text-tertiary);font-size:13px">
      ${t.location?escHtml(t.location)+" · ":""}Eindtijd: ${fmtDateTime(endTime)}
    </span>`;

  const later=new Date(Date.now()+36e5);
  const p=n=>String(n).padStart(2,"0");
  endInput.value=`${later.getFullYear()}-${p(later.getMonth()+1)}-${p(later.getDate())}T${p(later.getHours())}:${p(later.getMinutes())}`;

  modal.classList.remove("hidden");
  showBrowserNotif(`⏰ "${item.title||t.title}" — eindtijd bereikt`,"Afronden of verlengen?");
}

function closeNotifyModal(){
  $("notify-modal")?.classList.add("hidden");
  notifyTaskId=null;
  // Check if there are more tasks waiting for notification
  setTimeout(()=>{ if(!notifyTaskId) runScheduler(); }, 500);
}

function wireNotifyModal(){
  // Click overlay to snooze
  $("notify-modal")?.addEventListener("click",(e)=>{
    if(e.target.id==="notify-modal"){
      if(notifyTaskId) snoozedEnds.add(notifyTaskId);
      closeNotifyModal();
    }
  });

  // Helper to get the current notification target (task or subtask)
  function getNotifyTarget(){
    const modal=$("notify-modal");
    const taskId=modal?.dataset.taskId;
    const subtaskId=modal?.dataset.subtaskId;
    const t=state.tasks.find(x=>x.id===taskId);
    if(!t) return null;
    if(subtaskId){
      const st=(t.subtasks||[]).find(s=>s.id===subtaskId);
      return { task:t, subtask:st, isSubtask:true };
    }
    return { task:t, subtask:null, isSubtask:false };
  }

  $("notify-done")?.addEventListener("click",()=>{
    const target=getNotifyTarget();
    if(target){
      if(target.isSubtask&&target.subtask){
        target.subtask.status="done";
        toast(`Subtaak "${target.subtask.title}" afgerond ✓`);
      } else {
        target.task.status="Afgerond";
        toast(`"${target.task.title}" afgerond ✓`);
      }
      markDirty();
      if(state.currentView==="overzicht"||state.currentView==="dashboard") switchView(state.currentView);
    }
    closeNotifyModal();
  });

  $("notify-extend")?.addEventListener("click",()=>{
    const target=getNotifyTarget();
    const newEnd=$("notify-new-end")?.value;
    if(target&&newEnd){
      if(target.isSubtask&&target.subtask){
        target.subtask.scheduled.end=newEnd;
        snoozedEnds.delete(target.subtask.id);
        toast(`Subtaak verlengd tot ${fmtDateTime(newEnd)}`);
      } else {
        target.task.scheduled.end=newEnd;
        snoozedEnds.delete(target.task.id);
        toast(`"${target.task.title}" verlengd tot ${fmtDateTime(newEnd)}`);
      }
      markDirty();
      if(state.currentView==="overzicht"||state.currentView==="dashboard") switchView(state.currentView);
    }
    closeNotifyModal();
  });

  $("notify-snooze")?.addEventListener("click",()=>{
    if(notifyTaskId){
      snoozedEnds.add(notifyTaskId);
      const tid=notifyTaskId;
      setTimeout(()=>snoozedEnds.delete(tid), 15*60*1000);
      toast("Herinnering over 15 minuten");
    }
    closeNotifyModal();
  });

  $("notify-close")?.addEventListener("click",()=>{
    if(notifyTaskId) snoozedEnds.add(notifyTaskId);
    closeNotifyModal();
  });
}

function requestNotifPermission(){
  if("Notification" in window && Notification.permission==="default"){
    Notification.requestPermission();
  }
}

function showBrowserNotif(title,body){
  if("Notification" in window && Notification.permission==="granted"){
    try { new Notification(title,{body,icon:"data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🏠</text></svg>"}); } catch(e){}
  }
}

function startApp(){
  state.tasks.forEach(t=>ensureSchedule(t));
  if(!state.groups||!state.groups.length) state.groups=[...DEFAULT_GROUPS];
  if(!state.statuses||!state.statuses.length) state.statuses=[...DEFAULT_STATUSES];
  if(!state.locations||!state.locations.length) state.locations=[...DEFAULT_LOCATIONS];
  if(!state.categories||!state.categories.length) state.categories=[...DEFAULT_CATEGORIES];
  if(!state.projects) state.projects=[...DEFAULT_PROJECTS];

  takeSnapshot();

  // Restore dirty state from before hard refresh
  try {
    if(localStorage.getItem(STORAGE_KEY+"_dirty")==="1"){
      isDirty=true;
      $("save-bar")?.classList.remove("hidden");
    }
  } catch(e){}

  $("login-screen").classList.add("hidden");
  $("app-shell").classList.remove("hidden");

  updateSidebarUser();
  wireUI();
  wireNotifyModal();
  wireNotifBell();
  requestNotifPermission();
  switchView("dashboard");
  startScheduler();
}

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
(function init(){
  wireLogin();

  // Check for existing session
  const savedSession=loadSession();
  if(savedSession?.username){
    const user=USERS.find(u=>u.username===savedSession.username);
    if(user){
      state.currentUser=savedSession;
      const savedGH=loadGHConfig();
      if(savedGH) githubConfig=savedGH;
      proceedToApp();
      return;
    }
  }

  // No valid session — show login screen
  $("login-screen").classList.remove("hidden");
  $("login-user")?.focus();
})();
