/* ================================================================
   KLUSPLANNER PRO — v2.0
   Complete rewrite: GitHub collab backend, 3 view modes,
   flexible groups/labels, iCal sync, warm Todoist/Asana UI
   ================================================================ */

// ─── Constants ─────────────────────────────────────────────
const STORAGE_KEY   = "klusplanner_v2";
const CONFIG_KEY    = "klusplanner_gh";
const SESSION_KEY   = "klusplanner_session";
const STATUSES      = ["Backlog","Ingepland","Bezig","Wacht op materiaal","Wacht op hulp/afspraak","Afgerond"];

// ─── User accounts (hardcoded) ─────────────────────────────
const USERS = [
  { username: "Martje",  password: "Benja01!",  displayName: "Martje",  avatar: "M" },
  { username: "Justin",  password: "Teun01!",   displayName: "Justin",  avatar: "J" }
];

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
  selectedTaskId: null,
  currentView: "dashboard",
  currentUser: null,  // { username, displayName, avatar }
  overzicht: {
    mode: "list",       // list | gantt | agenda
    agendaZoom: "month",// month | week | day
    ganttZoom: "month",
    focusDate: todayYmd()
  }
};

let githubConfig = null;  // { token, owner, repo }
let isOnline     = false;
let tasksSha     = null;
let peopleSha    = null;
let groupsSha    = null;

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
  try { const d=new Date(iso); const p=n=>String(n).padStart(2,"0"); return `${p(d.getDate())}/${p(d.getMonth()+1)} ${p(d.getHours())}:${p(d.getMinutes())}`; } catch(e){ return iso; }
}
function fmtHours(n){
  if(n==null||n===""||isNaN(n)) return "–";
  return Number(n)%1===0?String(Number(n)):Number(n).toFixed(1).replace(".",",");
}
function escHtml(s){ return String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
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
  if(!t.scheduled.start&&t.scheduled.date){
    t.scheduled.start=t.scheduled.date+"T09:00";
    t.scheduled.end=t.scheduled.date+"T17:00";
  }
  if(t.scheduled.start&&!t.scheduled.end){
    try { const s=new Date(t.scheduled.start); s.setHours(s.getHours()+1); const p=n=>String(n).padStart(2,"0"); t.scheduled.end=`${s.getFullYear()}-${p(s.getMonth()+1)}-${p(s.getDate())}T${p(s.getHours())}:${p(s.getMinutes())}`; } catch(e){}
  }
  if(!Array.isArray(t.assignees)) t.assignees=[];
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
    throw new Error(err.message||`GitHub API ${res.status}`);
  }
  return res.json();
}

async function ghRead(path){
  const data=await ghFetch(path);
  const content=atob(data.content.replace(/\n/g,""));
  return { content: JSON.parse(content), sha: data.sha };
}

async function ghWrite(path, content, sha, message){
  const encoded=btoa(unescape(encodeURIComponent(JSON.stringify(content,null,2))));
  const body={ message, content:encoded };
  if(sha) body.sha=sha;
  const data=await ghFetch(path, { method:"PUT", body:JSON.stringify(body) });
  return data.content.sha;
}

async function ghValidate(){
  try {
    await ghFetch("", { method:"GET" });
    return true;
  } catch(e){ return false; }
}

async function syncFromGitHub(){
  if(!githubConfig) return;
  try {
    updateSyncIndicator("syncing");
    const [tasksData, peopleData] = await Promise.all([
      ghRead("data/tasks.json").catch(()=>null),
      ghRead("data/people.json").catch(()=>null)
    ]);
    let groupsData=null;
    try { groupsData=await ghRead("data/groups.json"); } catch(e){}

    if(tasksData){ state.tasks=tasksData.content; tasksSha=tasksData.sha; }
    if(peopleData){ state.people=peopleData.content; peopleSha=peopleData.sha; }
    if(groupsData){ state.groups=groupsData.content; groupsSha=groupsData.sha; }

    state.tasks.forEach(t=>ensureSchedule(t));
    saveLocal();
    updateSyncIndicator("online");
    return true;
  } catch(e){
    console.error("Sync from GitHub failed:", e);
    updateSyncIndicator("error");
    toast("Sync mislukt: "+e.message, "err");
    return false;
  }
}

async function syncToGitHub(){
  if(!githubConfig) return;
  try {
    updateSyncIndicator("syncing");
    const [newTasksSha, newPeopleSha] = await Promise.all([
      ghWrite("data/tasks.json", state.tasks, tasksSha, "Update tasks"),
      ghWrite("data/people.json", state.people, peopleSha, "Update people")
    ]);
    tasksSha=newTasksSha;
    peopleSha=newPeopleSha;

    // Also save groups
    const newGroupsSha=await ghWrite("data/groups.json", state.groups, groupsSha, "Update groups").catch(()=>null);
    if(newGroupsSha) groupsSha=newGroupsSha;

    updateSyncIndicator("online");
    toast("Gesynchroniseerd ✓");
    return true;
  } catch(e){
    console.error("Sync to GitHub failed:", e);
    updateSyncIndicator("error");
    if(e.message.includes("409")){
      toast("Conflict: iemand anders heeft gewijzigd. Haal eerst op.", "warn");
    } else {
      toast("Sync mislukt: "+e.message, "err");
    }
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
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({tasks:state.tasks,people:state.people,groups:state.groups})); } catch(e){}
}
function loadLocal(){
  try { const d=JSON.parse(localStorage.getItem(STORAGE_KEY)); if(d?.tasks) return d; } catch(e){} return null;
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

// ─── Save (auto-sync if online) ──────────────────────────
async function save(silent=false){
  saveLocal();
  if(githubConfig){
    await syncToGitHub();
  } else if(!silent){
    toast("Opgeslagen ✓");
  }
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
  STATUSES.forEach(s=>statusSel.appendChild(h("option",{value:s},s)));
  statusSel.value=val;

  const groupSel=$("filter-group");
  const gval=groupSel.value;
  groupSel.innerHTML='<option value="">Alle groepen</option>';
  const groups=[...new Set(state.tasks.map(t=>t.group).filter(Boolean))].sort();
  groups.forEach(g=>groupSel.appendChild(h("option",{value:g},g)));
  groupSel.value=gval;

  const personSel=$("filter-person");
  const pval=personSel.value;
  personSel.innerHTML='<option value="">Alle personen</option>';
  state.people.slice().sort((a,b)=>a.name.localeCompare(b.name)).forEach(p=>personSel.appendChild(h("option",{value:p.id},p.name)));
  personSel.value=pval;

  const projSel=$("filter-project");
  const prval=projSel.value;
  projSel.innerHTML='<option value="">Alle projecten</option>';
  const projects=[...new Set(state.tasks.map(t=>t.project).filter(Boolean))].sort();
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
    const si=STATUSES.indexOf(a.status)-STATUSES.indexOf(b.status);
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

    tbody.appendChild(h("tr",{onclick:()=>openTaskModal(t.id)},[
      h("td",{},[h("span",{style:{fontWeight:"600"}},t.title)]),
      h("td",{},[h("span",{class:"group-badge",style:{borderColor:gc+"55",background:gc+"15",color:gc}},t.group||"–")]),
      h("td",{class:"cell-muted"},t.location||"–"),
      h("td",{},[h("span",{class:`status-badge ${sc}`},[h("span",{class:"dot"}),t.status])]),
      h("td",{class:"cell-small"},exec),
      h("td",{class:"cell-small"},t.scheduled?.start?fmtDateTime(t.scheduled.start):"–"),
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
  const filtered=getFilteredTasks().filter(t=>t.scheduled?.start&&t.scheduled?.end);
  const fd=new Date(state.overzicht.focusDate+"T00:00:00");

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

  const items=filtered.filter(t=>{
    const s=new Date(t.scheduled.start), e=new Date(t.scheduled.end);
    return e>rangeStart&&s<rangeEnd;
  }).sort((a,b)=>(a.scheduled.start||"").localeCompare(b.scheduled.start||""));

  if(!items.length){
    container.innerHTML=`<div class="empty-state" style="background:var(--surface);border-radius:var(--radius-lg);border:1px solid var(--border)"><p>Geen ingeplande klussen in deze periode.</p></div>`;
    return;
  }

  const labelW=280;
  const colW=state.overzicht.ganttZoom==="week"?100:36;
  const gc=h("div",{class:"gantt-container"});
  const grid=h("div",{class:"gantt-grid",style:{gridTemplateColumns:`${labelW}px repeat(${cols},${colW}px)`}});

  // Header
  grid.appendChild(h("div",{class:"gantt-hcell",style:{position:"sticky",left:"0",zIndex:"4",minWidth:labelW+"px"}},"Klus"));
  colLabels.forEach(l=>grid.appendChild(h("div",{class:"gantt-hcell"},l)));

  // Rows
  items.forEach(t=>{
    const exec=[getPersonName((t.assignees||[])[0]),getPersonName((t.assignees||[])[1])].filter(x=>x!=="–").join(" + ")||"–";
    grid.appendChild(h("div",{class:"gantt-label-cell"},[
      h("div",{class:"gantt-label-title"},t.title),
      h("div",{class:"gantt-label-meta"},`${t.group||"–"} · ${t.location||"–"} · ${exec}`)
    ]));

    const track=h("div",{style:{gridColumn:`span ${cols}`,position:"relative",height:"52px",borderBottom:"1px solid var(--border)"}});

    const s=new Date(t.scheduled.start), e=new Date(t.scheduled.end);
    let startIdx,endIdx;
    if(state.overzicht.ganttZoom==="week"){
      startIdx=Math.max(0,(s-rangeStart)/864e5);
      endIdx=Math.min(cols,(e-rangeStart)/864e5);
    } else {
      startIdx=Math.max(0,(s.setHours(0,0,0,0),new Date(s)-rangeStart)/864e5);
      endIdx=Math.min(cols,Math.ceil((e-rangeStart)/864e5));
    }
    if(endIdx<=startIdx) endIdx=startIdx+0.5;

    const left=startIdx*colW+4;
    const width=Math.max(24,(endIdx-startIdx)*colW-8);
    const sc=statusClass(t.status);

    const bar=h("div",{class:`gantt-bar ${sc}`,style:{left:left+"px",width:width+"px"},onclick:()=>openTaskModal(t.id)},t.title);
    track.appendChild(bar);
    grid.appendChild(track);
  });

  gc.appendChild(grid);
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
  filtered.forEach(t=>{
    const s=new Date(t.scheduled.start);
    const e=t.scheduled.end?new Date(t.scheduled.end):new Date(s.getTime()+36e5);
    if(e<=rangeStart||s>=rangeEnd) return;
    for(let d=new Date(Math.max(s,rangeStart)); d<rangeEnd&&d<e; d=addDays(d,1)){
      const key=ymd(d);
      if(!byDate.has(key)) byDate.set(key,[]);
      byDate.get(key).push(t);
    }
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
        const s=new Date(t.scheduled.start);
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
    const s=new Date(t.scheduled.start);
    const e=t.scheduled.end?new Date(t.scheduled.end):new Date(s.getTime()+36e5);
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
      const s=new Date(t.scheduled.start);
      const e=t.scheduled.end?new Date(t.scheduled.end):new Date(s.getTime()+36e5);
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
  const map=new Map();
  openTasks.forEach(t=>{
    (t.materials||[]).forEach(m=>{
      const item=(typeof m==="string"?m:(m.item||"")).trim();
      if(!item) return;
      if(!map.has(item)) map.set(item,{qty:new Set(),statuses:new Set(),tasks:new Set()});
      if(typeof m!=="string"){
        map.get(item).qty.add((m.qty||"").trim());
        map.get(item).statuses.add((m.status||"").trim());
      }
      map.get(item).tasks.add(t.title);
    });
  });

  let rows=Array.from(map.entries()).sort((a,b)=>a[0].localeCompare(b[0]));
  if(matFilter){
    rows=rows.filter(([,info])=>Array.from(info.statuses).some(s=>s.toLowerCase().includes(matFilter.toLowerCase())));
  }

  if(!rows.length){
    wrap.innerHTML='<div class="empty-state"><p>Geen materialen gevonden.</p></div>';
    return;
  }

  const table=h("table",{class:"data-table"});
  table.appendChild(h("thead",{},[h("tr",{},[
    h("th",{},"Materiaal"),h("th",{},"Hoeveelheid"),h("th",{},"Status"),h("th",{},"Klussen")
  ])]));
  const tbody=h("tbody");
  rows.forEach(([item,info])=>{
    const qty=Array.from(info.qty).filter(Boolean).join(", ")||"–";
    const sts=Array.from(info.statuses).filter(Boolean).join(", ")||"–";
    const tasks=Array.from(info.tasks).join(", ");
    tbody.appendChild(h("tr",{style:{cursor:"default"}},[
      h("td",{style:{fontWeight:"600"}},item),
      h("td",{},qty),
      h("td",{},sts),
      h("td",{class:"cell-small"},tasks)
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

  const table=h("table",{class:"data-table"});
  table.appendChild(h("thead",{},[h("tr",{},[h("th",{},"ID"),h("th",{},"Naam"),h("th",{},"Klussen"),h("th",{},"")])]));
  const tbody=h("tbody");
  state.people.slice().sort((a,b)=>a.name.localeCompare(b.name)).forEach(p=>{
    const taskCount=state.tasks.filter(t=>(t.assignees||[]).includes(p.id)).length;
    const nameInput=h("input",{type:"text",value:p.name,style:{border:"1px solid var(--border)",borderRadius:"var(--radius)",padding:"6px 10px",width:"100%"}});
    nameInput.onchange=()=>{
      p.name=nameInput.value.trim()||p.name;
      save();
    };
    const delBtn=h("button",{class:"btn danger small",onclick:()=>{
      if(!confirm(`Verwijder ${p.name}?`)) return;
      state.people=state.people.filter(x=>x.id!==p.id);
      state.tasks.forEach(t=>{
        if(t.owner===p.id) t.owner="";
        t.assignees=(t.assignees||[]).filter(id=>id!==p.id);
      });
      save();
      renderPeople();
    }},"Verwijder");
    tbody.appendChild(h("tr",{style:{cursor:"default"}},[
      h("td",{class:"cell-muted"},p.id),
      h("td",{},nameInput),
      h("td",{class:"cell-small"},`${taskCount} klussen`),
      h("td",{},delBtn)
    ]));
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
}

// ═══════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════
function renderSettings(){
  renderGroupsManager();
  updateGHSettingsUI();
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
  } else {
    statusText.textContent="Niet verbonden — data wordt lokaal opgeslagen.";
    statusText.style.color="";
    infoBox?.classList.add("hidden");
    setupBtn.textContent="GitHub koppelen";
    setupBtn.classList.remove("secondary");
    setupBtn.classList.add("primary");
    disconnBtn?.classList.add("hidden");
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
  const container=$("groups-manager");
  if(!container) return;
  container.innerHTML="";
  state.groups.forEach(g=>{
    const chip=h("span",{class:"group-chip",style:{borderColor:g.color+"55",background:g.color+"15",color:g.color}},[
      g.name,
      h("span",{class:"remove-group",onclick:()=>{
        if(!confirm(`Groep "${g.name}" verwijderen?`)) return;
        state.groups=state.groups.filter(x=>x.id!==g.id);
        save();
        renderGroupsManager();
      }},"×")
    ]);
    container.appendChild(chip);
  });
}

// ═══════════════════════════════════════════════════════════
// TASK MODAL
// ═══════════════════════════════════════════════════════════
function openTaskModal(taskId){
  const t=state.tasks.find(x=>x.id===taskId);
  if(!t) return;
  ensureSchedule(t);
  state.selectedTaskId=taskId;

  $("modal-title").textContent=t.title||"Klus bewerken";
  $("task-modal").classList.remove("hidden");

  // Populate status
  const stSel=$("f-status");
  stSel.innerHTML="";
  STATUSES.forEach(s=>stSel.appendChild(h("option",{value:s},s)));
  stSel.value=t.status||"Backlog";

  // Populate group
  const grSel=$("f-group");
  grSel.innerHTML='<option value="">— Kies groep —</option>';
  state.groups.forEach(g=>grSel.appendChild(h("option",{value:g.name},g.name)));
  // Also add custom if not in list
  if(t.group&&!state.groups.find(g=>g.name===t.group)){
    grSel.appendChild(h("option",{value:t.group},t.group));
  }
  grSel.value=t.group||"";

  // Populate executors
  const exec1=$("f-exec1"), exec2=$("f-exec2");
  [exec1,exec2].forEach(sel=>{
    sel.innerHTML='<option value="">—</option>';
    state.people.slice().sort((a,b)=>a.name.localeCompare(b.name)).forEach(p=>sel.appendChild(h("option",{value:p.id},p.name)));
  });
  exec1.value=(t.assignees||[])[0]||"";
  exec2.value=(t.assignees||[])[1]||"";

  // Populate datalists for suggestions
  populateDatalist("project-suggestions", [...new Set(state.tasks.map(t=>t.project).filter(Boolean))]);
  populateDatalist("location-suggestions", [...new Set(state.tasks.map(t=>t.location).filter(Boolean))]);
  populateDatalist("category-suggestions", [...new Set(state.tasks.map(t=>t.category).filter(Boolean))]);

  // Fill fields
  $("f-title").value=t.title||"";
  $("f-project").value=t.project||"";
  $("f-location").value=t.location||"";
  $("f-category").value=t.category||"";
  $("f-start").value=t.scheduled?.start||"";
  $("f-end").value=t.scheduled?.end||"";
  $("f-hours-o").value=t.estimate_hours?.optimistic??0;
  $("f-hours-r").value=t.estimate_hours?.realistic??0;
  $("f-hours-w").value=t.estimate_hours?.worst??0;
  $("f-hours-actual").value=t.actual_hours??0;
  $("f-dod").value=t.definition_of_done||"";
  $("f-materials").value=materialsToText(t.materials);
  $("f-tools").value=(t.tools||[]).join("\n");
  $("f-steps").value=(t.steps||[]).join("\n");
  $("f-notes").value=t.notes||"";
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
  t.group=$("f-group").value;
  t.location=$("f-location").value.trim();
  t.category=$("f-category").value.trim();
  t.status=$("f-status").value;
  t.assignees=[$("f-exec1").value,$("f-exec2").value].filter(Boolean);
  t.scheduled.start=$("f-start").value;
  t.scheduled.end=$("f-end").value;
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
  t.steps=parseLines($("f-steps").value);
  t.notes=$("f-notes").value;
  return t;
}

function saveTask(){
  const t=readTaskForm();
  if(!t) { toast("Geen klus geselecteerd","warn"); return; }

  // Normalize end > start
  if(t.scheduled.start&&t.scheduled.end){
    if(new Date(t.scheduled.end)<=new Date(t.scheduled.start)){
      const s=new Date(t.scheduled.start);
      s.setHours(s.getHours()+1);
      const p=n=>String(n).padStart(2,"0");
      t.scheduled.end=`${s.getFullYear()}-${p(s.getMonth()+1)}-${p(s.getDate())}T${p(s.getHours())}:${p(s.getMinutes())}`;
    }
  }

  save();
  closeTaskModal();
  if(state.currentView==="dashboard") renderDashboard();
  else if(state.currentView==="overzicht") renderOverzicht();
}

function deleteTask(){
  if(!state.selectedTaskId) return;
  const t=state.tasks.find(x=>x.id===state.selectedTaskId);
  if(!t) return;
  if(!confirm(`Verwijder "${t.title}"? Dit kan niet ongedaan worden.`)) return;
  state.tasks=state.tasks.filter(x=>x.id!==state.selectedTaskId);
  save();
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
    notes:""
  };
  state.tasks.push(t);
  saveLocal();
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
  const steps=(t.steps||[]).map((x,i)=>`<li>${escHtml(x)}</li>`).join("")||"<li>–</li>";

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
      <div class="ps-box ps-full"><h4>Stappenplan</h4><ol>${steps}</ol></div>
      <div class="ps-box ps-full"><h4>Notities</h4><p>${escHtml(t.notes||"–")}</p></div>
    </div>`;
  requestAnimationFrame(()=>window.print());
}

// ═══════════════════════════════════════════════════════════
// iCAL EXPORT
// ═══════════════════════════════════════════════════════════
function generateICal(){
  const scheduled=state.tasks.filter(t=>t.scheduled?.start);
  if(!scheduled.length){ toast("Geen ingeplande klussen","warn"); return; }

  const fmtIcal=(iso)=>{
    const d=new Date(iso);
    const p=n=>String(n).padStart(2,"0");
    return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}00`;
  };

  let cal="BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Klusplanner Pro//NL\r\nCALSCALE:GREGORIAN\r\n";
  scheduled.forEach(t=>{
    const start=fmtIcal(t.scheduled.start);
    const end=t.scheduled.end?fmtIcal(t.scheduled.end):fmtIcal(new Date(new Date(t.scheduled.start).getTime()+36e5).toISOString());
    const desc=[
      t.group?`Groep: ${t.group}`:"",
      t.definition_of_done?`DoD: ${t.definition_of_done}`:"",
      (t.steps||[]).length?`Stappen: ${t.steps.join(", ")}`:"",
      getPersonName((t.assignees||[])[0])!=="–"?`Uitvoerder: ${getPersonName((t.assignees||[])[0])}`:"",
      t.notes||""
    ].filter(Boolean).join("\\n");

    cal+=`BEGIN:VEVENT\r\nDTSTART:${start}\r\nDTEND:${end}\r\nSUMMARY:${(t.title||"").replace(/[,;\\]/g," ")}\r\nLOCATION:${(t.location||"").replace(/[,;\\]/g," ")}\r\nDESCRIPTION:${desc.replace(/[\\]/g,"\\\\").replace(/\n/g,"\\n")}\r\nSTATUS:${t.status==="Afgerond"?"COMPLETED":"CONFIRMED"}\r\nEND:VEVENT\r\n`;
  });
  cal+="END:VCALENDAR\r\n";

  const blob=new Blob([cal],{type:"text/calendar"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download="klusplanner.ics";
  a.click();
  URL.revokeObjectURL(a.href);
  toast(`${scheduled.length} klussen geëxporteerd als .ics`);
}

// ═══════════════════════════════════════════════════════════
// EXPORT / IMPORT
// ═══════════════════════════════════════════════════════════
function exportJSON(){
  const payload={exported_at:new Date().toISOString(),tasks:state.tasks,people:state.people,groups:state.groups};
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
    if(!obj.tasks||!obj.people) throw new Error("Verwacht {tasks, people}");
    state.tasks=obj.tasks;
    state.people=obj.people;
    if(obj.groups) state.groups=obj.groups;
    state.tasks.forEach(t=>ensureSchedule(t));
    await save();
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
      await syncFromGitHub();
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
    save();
    renderPeople();
  });

  // Settings
  $("btn-export")?.addEventListener("click",exportJSON);
  $("btn-import")?.addEventListener("click",importJSON);
  $("btn-ical")?.addEventListener("click",generateICal);
  $("btn-add-group")?.addEventListener("click",()=>{
    const name=$("new-group-name")?.value.trim();
    if(!name) return;
    const id=slugify(name);
    if(state.groups.find(g=>g.id===id)){ toast("Groep bestaat al","warn"); return; }
    const color=GROUP_COLORS[state.groups.length%GROUP_COLORS.length];
    state.groups.push({id,name,color});
    $("new-group-name").value="";
    save();
    renderGroupsManager();
  });
  $("btn-reset")?.addEventListener("click",async ()=>{
    if(!confirm("Reset naar defaults? Dit overschrijft je huidige data.")) return;
    try {
      const [tasksRes,peopleRes]=await Promise.all([fetch("data/tasks.json"),fetch("data/people.json")]);
      state.tasks=await tasksRes.json();
      state.people=await peopleRes.json();
      state.groups=[...DEFAULT_GROUPS];
      state.tasks.forEach(t=>ensureSchedule(t));
      await save();
      toast("Teruggezet ✓");
      switchView("dashboard");
    } catch(e){
      toast("Reset mislukt: "+e.message,"err");
    }
  });

  // Logout — clears user session, keeps GitHub config
  $("btn-logout")?.addEventListener("click",()=>{
    state.currentUser=null;
    localStorage.removeItem(SESSION_KEY);
    isOnline=false;
    updateSyncIndicator("offline");
    $("app-shell").classList.add("hidden");
    $("login-screen").classList.remove("hidden");
    $("login-card").classList.remove("hidden");
    $("github-card").classList.add("hidden");
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
    state.tasks.forEach(t=>ensureSchedule(t));
    saveLocal();
  } catch(e){ console.warn("Could not load defaults:",e); }
}

// ═══════════════════════════════════════════════════════════
// LOGIN — Two-step: user/pass → GitHub setup (if needed)
// ═══════════════════════════════════════════════════════════
function wireLogin(){
  // Enter key support on login fields
  $("login-user")?.addEventListener("keydown",e=>{ if(e.key==="Enter") $("login-pass")?.focus(); });
  $("login-pass")?.addEventListener("keydown",e=>{ if(e.key==="Enter") $("btn-login")?.click(); });

  // Step 1: Username/password login
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

    // Login successful
    state.currentUser={ username:user.username, displayName:user.displayName, avatar:user.avatar };
    saveSession();

    // Check if GitHub is already configured
    const savedGH=loadGHConfig();
    if(savedGH){
      // GitHub already set up — go straight to app
      githubConfig=savedGH;
      proceedToApp();
    } else {
      // Show GitHub setup screen
      $("login-card").classList.add("hidden");
      $("github-card").classList.remove("hidden");
    }
  });

  // Step 2a: GitHub connect
  $("btn-gh-connect")?.addEventListener("click",async ()=>{
    const token=$("gh-token").value.trim();
    const owner=$("gh-owner").value.trim();
    const repo=$("gh-repo").value.trim();

    if(!token||!owner||!repo){
      showGHError("Vul alle velden in.");
      return;
    }

    $("btn-gh-connect").textContent="Verbinden...";
    $("btn-gh-connect").disabled=true;

    githubConfig={token,owner,repo};
    try {
      const valid=await ghValidate();
      if(!valid) throw new Error("Kan repo niet bereiken. Check token en repo-gegevens.");
      saveGHConfig();
      await syncFromGitHub();
      proceedToApp();
    } catch(e){
      githubConfig=null;
      showGHError(e.message);
    } finally {
      $("btn-gh-connect").textContent="Verbinden & starten";
      $("btn-gh-connect").disabled=false;
    }
  });

  // Step 2b: Skip GitHub, go offline
  $("btn-gh-skip")?.addEventListener("click",()=>{
    githubConfig=null;
    proceedToApp();
  });
}

function proceedToApp(){
  // Load data: GitHub first, then local fallback, then defaults
  const tryLocal=()=>{
    const local=loadLocal();
    if(local){
      state.tasks=local.tasks||[];
      state.people=local.people||[];
      state.groups=local.groups||[...DEFAULT_GROUPS];
    }
  };

  if(githubConfig&&state.tasks.length===0){
    // If sync already happened in the login flow, tasks are already loaded
    // Otherwise load local as fallback
    if(state.tasks.length===0) tryLocal();
  } else {
    tryLocal();
  }

  // Last resort: load seed data
  if(state.tasks.length===0){
    loadDefaults().then(()=>startApp()).catch(()=>startApp());
    return;
  }

  state.tasks.forEach(t=>ensureSchedule(t));
  startApp();
}

function showLoginError(msg){
  const el=$("login-error");
  if(!el) return;
  el.textContent=msg;
  el.classList.remove("hidden");
  setTimeout(()=>el.classList.add("hidden"),4000);
}

function showGHError(msg){
  const el=$("gh-error");
  if(!el) return;
  el.textContent=msg;
  el.classList.remove("hidden");
  setTimeout(()=>el.classList.add("hidden"),5000);
}

function startApp(){
  state.tasks.forEach(t=>ensureSchedule(t));
  if(!state.groups||!state.groups.length) state.groups=[...DEFAULT_GROUPS];

  $("login-screen").classList.add("hidden");
  $("app-shell").classList.remove("hidden");

  updateSidebarUser();
  wireUI();
  switchView("dashboard");
}

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
(function init(){
  wireLogin();

  // Check for existing session (user already logged in before)
  const savedSession=loadSession();
  if(savedSession?.username){
    // Verify it's a valid user
    const user=USERS.find(u=>u.username===savedSession.username);
    if(user){
      state.currentUser=savedSession;
      const savedGH=loadGHConfig();
      if(savedGH) githubConfig=savedGH;

      // Try sync if GitHub connected
      if(githubConfig){
        syncFromGitHub().then(synced=>{
          if(!synced){
            const local=loadLocal();
            if(local){
              state.tasks=local.tasks||[];
              state.people=local.people||[];
              state.groups=local.groups||[...DEFAULT_GROUPS];
            }
          }
          startApp();
        }).catch(()=>{
          const local=loadLocal();
          if(local){
            state.tasks=local.tasks||[];
            state.people=local.people||[];
            state.groups=local.groups||[...DEFAULT_GROUPS];
          }
          startApp();
        });
      } else {
        // Offline — load local
        const local=loadLocal();
        if(local){
          state.tasks=local.tasks||[];
          state.people=local.people||[];
          state.groups=local.groups||[...DEFAULT_GROUPS];
        }
        if(state.tasks.length===0){
          loadDefaults().then(()=>startApp()).catch(()=>startApp());
        } else {
          startApp();
        }
      }
      return;
    }
  }

  // No valid session — show login screen
  $("login-screen").classList.remove("hidden");
  $("login-user")?.focus();
})();
