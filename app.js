/* Klusplanner – client-side (localStorage)
   - Startdata: /data/tasks.json + /data/people.json
   - Persist: localStorage key "klusplanner_v1"
*/

const STORAGE_KEY = "klusplanner_v1";

const STATUSES = [
  "Backlog",
  "Ingepland",
  "Bezig",
  "Wacht op materiaal",
  "Wacht op hulp/afspraak",
  "Afgerond"
];

let state = {
  tasks: [],
  people: [],
  selectedTaskId: null,
  planning: {
    mode: "gantt", // gantt | calendar
    zoom: "week",  // month | week | day
    focusDate: null // YYYY-MM-DD
  }
};

function slugify(s){
  return (s||"")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\-]/g, "")
    .replace(/\-+/g, "-");
}

function fmtDateTime(iso){
  if(!iso) return "–";
  try{
    const d = new Date(iso);
    const pad = (x)=>String(x).padStart(2,"0");
    return `${pad(d.getDate())}/${pad(d.getMonth()+1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }catch(e){
    return String(iso);
  }
}

function fmtHours(n){
  if (n === null || n === undefined || n === "") return "–";
  const x = Number(n);
  if (Number.isNaN(x)) return "–";
  return x % 1 === 0 ? String(x) : String(x).replace(".", ",");
}

function loadFromStorage(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return null;
    return JSON.parse(raw);
  }catch(e){
    console.warn("Storage parse failed", e);
    return null;
  }
}

function saveToStorage(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ tasks: state.tasks, people: state.people }));
}

async function loadDefaults(){
  const [tasksRes, peopleRes] = await Promise.all([
    fetch("data/tasks.json"),
    fetch("data/people.json")
  ]);
  const [tasks, people] = await Promise.all([tasksRes.json(), peopleRes.json()]);
  return { tasks, people };
}

function getPersonName(id){
  const p = state.people.find(x => x.id === id);
  return p ? p.name : (id || "–");
}

function getStatusDot(status){
  if(status === "Afgerond") return "good";
  if(status.startsWith("Wacht")) return "warn";
  if(status === "Bezig") return "warn";
  return "bad";
}

function el(tag, attrs={}, children=[]){
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([k,v])=>{
    if(k === "class") node.className = v;
    else if(k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if(k === "html") node.innerHTML = v;
    else node.setAttribute(k, v);
  });
  (Array.isArray(children) ? children : [children]).forEach(c=>{
    if(c === null || c === undefined) return;
    if(typeof c === "string") node.appendChild(document.createTextNode(c));
    else node.appendChild(c);
  });
  return node;
}

function switchView(view){
  document.querySelectorAll(".tab").forEach(t=>{
    t.classList.toggle("active", t.dataset.view === view);
  });
  document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
  document.getElementById(`view-${view}`).classList.remove("hidden");

  // close drawer when leaving tasks view
  if(view !== "tasks"){
    document.getElementById("drawer").classList.add("hidden");
    state.selectedTaskId = null;
  }

  if(view === "dashboard") renderDashboard();
  if(view === "planning") renderPlanning();
  if(view === "tasks") renderTasks();
  if(view === "people") renderPeople();
  if(view === "materials") renderMaterials();
}

function renderDashboard(){
  // harden schedule data
  state.tasks.forEach(t=>{ try{ ensureSchedule(t); }catch(e){} });
  const total = state.tasks.length;
  const done = state.tasks.filter(t=>t.status==="Afgerond").length;
  const progressPct = total ? Math.round((done/total)*100) : 0;

  const sumRealistic = state.tasks.reduce((a,t)=>a + (Number(t.estimate_hours?.realistic)||0),0);
  const sumActual = state.tasks.reduce((a,t)=>a + (Number(t.actual_hours)||0),0);

  const blocked = state.tasks.filter(t=>t.status.startsWith("Wacht")).length;
  document.getElementById("kpi-progress").textContent = `${progressPct}%`;
  document.getElementById("kpi-progress-note").textContent = `${done}/${total} afgerond`;

  document.getElementById("kpi-hours").textContent = `${fmtHours(sumActual)} / ${fmtHours(sumRealistic)} u`;
  document.getElementById("kpi-hours-note").textContent = `Werkelijk / Realistisch begroot`;

  document.getElementById("kpi-blocked").textContent = String(blocked);
  // upcoming table: Ingepland/Bezig/Wacht sorted by start
const upcoming = state.tasks
  .filter(t => ["Ingepland","Bezig","Wacht op materiaal","Wacht op hulp/afspraak"].includes(t.status))
  .filter(t => t.scheduled && (t.scheduled.start || t.scheduled.date))
  .slice()
  .sort((a,b)=>{
    const sa = a.scheduled.start || (a.scheduled.date ? a.scheduled.date+"T00:00" : "9999-12-31T00:00");
    const sb = b.scheduled.start || (b.scheduled.date ? b.scheduled.date+"T00:00" : "9999-12-31T00:00");
    if(sa !== sb) return sa.localeCompare(sb);
      return (a.title||"").localeCompare(b.title||"");
    });

  const tbody = document.querySelector("#table-upcoming tbody");
  tbody.innerHTML = "";
  if(upcoming.length === 0){
    tbody.appendChild(el("tr", {}, [
      el("td", {colspan:"8", class:"muted"}, "Nog geen klussen ingepland. Tip: plan eerst OH-PRE (presentatie) en de Must-keukenpunten.")
    ]));
    return;
  }

  upcoming.forEach(t=>{
    const dot = getStatusDot(t.status);
    const statusCell = el("span", {class:"tag"}, [
      el("span", {class:`dot ${dot}`}),
      t.status
    ]);

    const startTxt = t.scheduled?.start ? fmtDateTime(t.scheduled.start) : (t.scheduled?.date || "–");
    const endTxt = t.scheduled?.end ? fmtDateTime(t.scheduled.end) : "–";
    const exec1Txt = getPersonName((t.assignees||[])[0]);
    const exec2Txt = getPersonName((t.assignees||[])[1]);

    tbody.appendChild(el("tr", {class:"clickrow", onclick:(e)=>{ if(e.target && (e.target.tagName==="A" || e.target.closest("a"))) return; switchView("tasks"); openTaskAndScroll(t.id);} }, [
      el("td", {}, t.title),
      el("td", {}, t.location || "–"),
      el("td", {}, statusCell),
      el("td", {}, startTxt),
      el("td", {}, endTxt),
      el("td", {}, exec1Txt),
      el("td", {}, exec2Txt),
      el("td", {}, el("a", {class:"action-link", href:"#", onclick:(e)=>{e.preventDefault(); switchView("tasks"); openTaskAndScroll(t.id);} }, "Open"))
    ]));
  });
}

function populateFilters(){
  // status
  const statusSel = document.getElementById("filter-status");
  statusSel.innerHTML = "";
  statusSel.appendChild(el("option", {value:""}, "Alle status"));
  STATUSES.forEach(s => statusSel.appendChild(el("option", {value:s}, s)));

  // group
  const groups = Array.from(new Set(state.tasks.map(t=>t.group).filter(Boolean))).sort();
  const groupSel = document.getElementById("filter-group");
  groupSel.innerHTML = "";
  groupSel.appendChild(el("option", {value:""}, "Alle groepen"));
  groups.forEach(g => groupSel.appendChild(el("option", {value:g}, g)));

  // assignee
  const assSel = document.getElementById("filter-person");
  assSel.innerHTML = "";
  assSel.appendChild(el("option", {value:""}, "Iedereen"));
  state.people
    .slice()
    .sort((a,b)=>a.name.localeCompare(b.name))
    .forEach(p => assSel.appendChild(el("option", {value:p.id}, p.name)));
}

function applyTaskFilters(list){
  const q = (document.getElementById("filter-search").value||"").trim().toLowerCase();
  const st = document.getElementById("filter-status").value;
  const gr = document.getElementById("filter-group").value;
  const person = document.getElementById("filter-person").value;

  return list.filter(t=>{
    if(q){
      const hay = `${t.title||""} ${t.location||""} ${t.group||""}`.toLowerCase();
      if(!hay.includes(q)) return false;
    }
    if(st && t.status !== st) return false;
    if(gr && (t.group||"") !== gr) return false;
    if(person){
      const a1 = (t.assignees||[])[0] || "";
      const a2 = (t.assignees||[])[1] || "";
      if(a1 !== person && a2 !== person) return false;
    }
    return true;
  });
}


function renderTasks(){
  // harden schedule data
  state.tasks.forEach(t=>{ try{ ensureSchedule(t); }catch(e){} });
  populateFilters();

  const tbody = document.querySelector("#table-tasks tbody");
  tbody.innerHTML = "";

  const tasksSorted = state.tasks.slice().sort((a,b)=>{
    const sa = STATUSES.indexOf(a.status);
    const sb = STATUSES.indexOf(b.status);
    if(sa !== sb) return sa - sb;

    const aStart = a.scheduled?.start || (a.scheduled?.date ? a.scheduled.date+"T00:00" : "9999-12-31T00:00");
    const bStart = b.scheduled?.start || (b.scheduled?.date ? b.scheduled.date+"T00:00" : "9999-12-31T00:00");
    if(aStart !== bStart) return aStart.localeCompare(bStart);

    return (a.title||"").localeCompare(b.title||"");
  });

  const filtered = applyTaskFilters(tasksSorted);

  if(filtered.length === 0){
    tbody.appendChild(el("tr", {}, [
      el("td", {colspan:"10", class:"muted"}, "Geen resultaten met deze filters.")
    ]));
    return;
  }

  filtered.forEach(t=>{
    const dot = getStatusDot(t.status);
    const statusTag = el("span", {class:"tag"}, [
      el("span", {class:`dot ${dot}`}),
      t.status
    ]);

    const exec1Txt = getPersonName((t.assignees||[])[0]);
    const exec2Txt = getPersonName((t.assignees||[])[1]);
    const startTxt = t.scheduled?.start ? fmtDateTime(t.scheduled.start) : (t.scheduled?.date || "–");
    const endTxt = t.scheduled?.end ? fmtDateTime(t.scheduled.end) : "–";

    tbody.appendChild(el("tr", {}, [
      el("td", {}, t.title),
      el("td", {}, t.group || "–"),
      el("td", {}, t.location || "–"),
      el("td", {}, statusTag),
      el("td", {}, exec1Txt),
      el("td", {}, exec2Txt),
      el("td", {class:"small"}, startTxt),
      el("td", {class:"small"}, endTxt),
      el("td", {}, fmtHours(t.estimate_hours?.realistic)),
      el("td", {}, el("a", {class:"action-link", href:"#", onclick:(e)=>{e.preventDefault(); openTaskAndScroll(t.id);} }, "Open"))
    ]));
  });

  ["filter-search","filter-status","filter-group","filter-person"].forEach(id=>{
    const node = document.getElementById(id);
    if(!node) return;
    node.oninput = () => renderTasks();
    node.onchange = () => renderTasks();
  });
}


function newTaskTemplate(){
  return {
    id: generateTaskId("OH-NEW"),
    project: "Oud huis",
    group: "Binnen",
    location: "",
    type: "Binnen",
    category: "",
    title: "Nieuwe klus",
    priority: "",
    status: "Backlog",
    owner: "",
    assignees: [],
    estimate_hours: { optimistic: 0, realistic: 0, worst: 0 },
    actual_hours: 0,
    scheduled: { date:"", timeblock:"", start:"", end:"" },
    dependencies: [],
    definition_of_done: "",
    materials: [],
    tools: [],
    steps: [],
    notes: ""
  };
}

function generateTaskId(prefix){
  // prefix like OH-BIN or OH-PRE etc
  const existing = new Set(state.tasks.map(t=>t.id));
  let n = 1;
  while(true){
    const id = `${prefix}-${String(n).padStart(3,"0")}`;
    if(!existing.has(id)) return id;
    n++;
  }
}

function openTaskAndScroll(taskId){
  openTask(taskId);
  const drawer = document.getElementById("drawer");
  drawer.scrollIntoView({behavior:"smooth", block:"start"});
  // focus first field
  const title = document.getElementById("f-title");
  if(title) title.focus();
}

function openTask(taskId){
  const t = state.tasks.find(x=>x.id===taskId);
  if(!t) return;
  // harden / migrate schedule
  ensureSchedule(t);
  if(!Array.isArray(t.assignees)) t.assignees = [];
  state.selectedTaskId = taskId;

  const drawer = document.getElementById("drawer");
  drawer.classList.remove("hidden");

  document.getElementById("drawer-title").textContent = t.title;

  // status select
  const stSel = document.getElementById("f-status");
  stSel.innerHTML = "";
  STATUSES.forEach(s => stSel.appendChild(el("option", {value:s}, s)));

  // executor selects
  const exec1Sel = document.getElementById("f-exec1");
  const exec2Sel = document.getElementById("f-exec2");
  exec1Sel.innerHTML = "";
  exec2Sel.innerHTML = "";
  exec1Sel.appendChild(el("option", {value:""}, "—"));
  exec2Sel.appendChild(el("option", {value:""}, "—"));
  state.people.slice().sort((a,b)=>a.name.localeCompare(b.name)).forEach(p=>{
    exec1Sel.appendChild(el("option", {value:p.id}, p.name));
    exec2Sel.appendChild(el("option", {value:p.id}, p.name));
  });

  // basic
  document.getElementById("f-title").value = t.title || "";
  document.getElementById("f-project").value = t.project || "";
  document.getElementById("f-group").value = t.group || "";
  document.getElementById("f-location").value = t.location || "";
  document.getElementById("f-status").value = t.status || "Backlog";

  // executors
  document.getElementById("f-exec1").value = (t.assignees||[])[0] || "";
  document.getElementById("f-exec2").value = (t.assignees||[])[1] || "";

  // schedule
  document.getElementById("f-start").value = t.scheduled?.start || "";
  document.getElementById("f-end").value = t.scheduled?.end || "";

  // hours
  document.getElementById("f-o").value = t.estimate_hours?.optimistic ?? 0;
  document.getElementById("f-r").value = t.estimate_hours?.realistic ?? 0;
  document.getElementById("f-w").value = t.estimate_hours?.worst ?? 0;
  document.getElementById("f-actual").value = t.actual_hours ?? 0;

  document.getElementById("f-dod").value = t.definition_of_done || "";

  // materials/tools/steps
  document.getElementById("f-materials").value = (t.materials||[]).map(m=>{
    const qty = m.qty || "";
    const st = m.status || "";
    return `${m.item||""}${qty? " | "+qty:""}${st? " | "+st:""}`.trim();
  }).join("\n");
  document.getElementById("f-tools").value = (t.tools||[]).join("\n");
  document.getElementById("f-steps").value = (t.steps||[]).join("\n");
  document.getElementById("f-notes").value = t.notes || "";
}


function renderAssigneeMulti(task){
  const wrap =   wrap.innerHTML = "";
  const selected = new Set(task.assignees || []);
  state.people.slice().sort((a,b)=>a.name.localeCompare(b.name)).forEach(p=>{
    const id = `ass-${p.id}`;
    const chk = el("input", {type:"checkbox", id, "data-pid":p.id});
    chk.checked = selected.has(p.id);
    const pill = el("label", {class:"pill", for:id}, [chk, p.name]);
    wrap.appendChild(pill);
  });
}

function readTaskForm(){
  const id = state.selectedTaskId;
  const t = state.tasks.find(x=>x.id===id);
  if(!t) return null;
  // ensure nested structures exist
  ensureSchedule(t);
  if(!Array.isArray(t.assignees)) t.assignees = [];

  t.title = document.getElementById("f-title").value.trim() || t.title;
  t.project = document.getElementById("f-project").value.trim();
  t.group = document.getElementById("f-group").value.trim();
  t.location = document.getElementById("f-location").value.trim();
  t.status = document.getElementById("f-status").value;

  const exec1 = document.getElementById("f-exec1").value;
  const exec2 = document.getElementById("f-exec2").value;
  t.assignees = [exec1, exec2].filter(Boolean);

  if(!t.scheduled) t.scheduled = { date:"", timeblock:"", start:"", end:"" };
  t.scheduled.start = document.getElementById("f-start").value;
  t.scheduled.end = document.getElementById("f-end").value;

  // keep legacy date in sync when start is set
  if(t.scheduled.start){
    try{
      const s = new Date(t.scheduled.start);
      const pad=(n)=>String(n).padStart(2,"0");
      t.scheduled.date = `${s.getFullYear()}-${pad(s.getMonth()+1)}-${pad(s.getDate())}`;
    }catch(e){}
  }

  // hours
  t.estimate_hours = {
    optimistic: Number(document.getElementById("f-o").value||0),
    realistic: Number(document.getElementById("f-r").value||0),
    worst: Number(document.getElementById("f-w").value||0)
  };
  t.actual_hours = Number(document.getElementById("f-actual").value||0);

  t.definition_of_done = document.getElementById("f-dod").value;

  t.materials = parseMaterialsText(document.getElementById("f-materials").value);
  t.tools = parseLines(document.getElementById("f-tools").value);
  t.steps = parseLines(document.getElementById("f-steps").value);
  t.notes = document.getElementById("f-notes").value;

  return t;
}


function buildPrintSheet(task){
  const exec1 = getPersonName((task.assignees||[])[0]);
  const exec2 = getPersonName((task.assignees||[])[1]);
  const start = task.scheduled?.start ? fmtDateTime(task.scheduled.start) : "–";
  const end = task.scheduled?.end ? fmtDateTime(task.scheduled.end) : "–";

  const mats = (task.materials||[]).map(m=>{
    const qty = m.qty ? ` — ${escapeHtml(m.qty)}` : "";
    const st = m.status ? ` (${escapeHtml(m.status)})` : "";
    return `<li>${escapeHtml(m.item||"")}${qty}${st}</li>`;
  }).join("") || "<li>–</li>";

  const tools = (task.tools||[]).map(x=>`<li>${escapeHtml(x)}</li>`).join("") || "<li>–</li>";
  const steps = (task.steps||[]).map(x=>`<li>${escapeHtml(x)}</li>`).join("") || "<li>–</li>";
  const dod = task.definition_of_done ? escapeHtml(task.definition_of_done) : "–";
  const notes = task.notes ? escapeHtml(task.notes) : "–";

  return `
    <div class="ps-header">
      <div>
        <div class="ps-title">${escapeHtml(task.title||"")}</div>
        <div class="ps-sub">${escapeHtml(task.group||"–")} • ${escapeHtml(task.location||"–")}</div>
      </div>
      <div class="ps-meta">
        <div><strong>Status:</strong> ${escapeHtml(task.status||"–")}</div>
        <div><strong>Start:</strong> ${escapeHtml(start)}</div>
        <div><strong>Eind:</strong> ${escapeHtml(end)}</div>
      </div>
    </div>

    <div class="ps-grid">
      <div class="ps-box">
        <h4>Uitvoerders</h4>
        <p><strong>Uitvoerder 1:</strong> ${escapeHtml(exec1)}<br/>
        <strong>Uitvoerder 2:</strong> ${escapeHtml(exec2)}</p>
      </div>
      <div class="ps-box">
        <h4>Definition of Done</h4>
        <p>${dod}</p>
      </div>

      <div class="ps-box">
        <h4>Materialen</h4>
        <ul>${mats}</ul>
      </div>
      <div class="ps-box">
        <h4>Tools</h4>
        <ul>${tools}</ul>
      </div>

      <div class="ps-box ps-full">
        <h4>Stappenplan</h4>
        <ul>${steps}</ul>
      </div>
      <div class="ps-box ps-full">
        <h4>Notities</h4>
        <p>${notes}</p>
      </div>
    </div>
  `;
}


function escapeHtml(s){
  return String(s ?? "")
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;")
    .replace(/'/g,"&#039;");
}


function renderMaterials(){
  const tbody = document.querySelector("#table-materials tbody");
  tbody.innerHTML = "";

  const openTasks = state.tasks.filter(t=>t.status!=="Afgerond");
  const map = new Map(); // item -> {qty:Set/arr, statuses:Set, tasks:Set}
  openTasks.forEach(t=>{
    (t.materials||[]).forEach(m=>{
      if(typeof m === "string"){
        const item = m;
        if(!map.has(item)) map.set(item, {qty:new Set(), statuses:new Set(), tasks:new Set()});
        map.get(item).qty.add("");
        map.get(item).statuses.add("");
        map.get(item).tasks.add(t.id);
      }else{
        const item = (m.item||"").trim();
        if(!item) return;
        if(!map.has(item)) map.set(item, {qty:new Set(), statuses:new Set(), tasks:new Set()});
        map.get(item).qty.add((m.qty||"").trim());
        map.get(item).statuses.add((m.status||"").trim());
        map.get(item).tasks.add(t.id);
      }
    });
  });

  const rows = Array.from(map.entries()).sort((a,b)=>a[0].localeCompare(b[0]));
  if(rows.length === 0){
    tbody.appendChild(el("tr", {}, [
      el("td", {colspan:"4", class:"muted"}, "Geen materialen gevonden in openstaande klussen.")
    ]));
    return;
  }

  rows.forEach(([item, info])=>{
    const qty = Array.from(info.qty).filter(Boolean).join(", ") || "–";
    const sts = Array.from(info.statuses).filter(Boolean).join(", ") || "–";
    const tasks = Array.from(info.tasks).sort().map(id=>`<span class="tag">${id}</span>`).join(" ");

    tbody.appendChild(el("tr", {}, [
      el("td", {}, item),
      el("td", {}, qty),
      el("td", {}, sts),
      el("td", {html: tasks || "–"})
    ]));
  });
}

function renderPeople(){
  const tbody = document.querySelector("#table-people tbody");
  tbody.innerHTML = "";

  state.people
    .slice()
    .sort((a,b)=>a.name.localeCompare(b.name))
    .forEach(p=>{
      const nameInput = el("input", {type:"text", value:p.name});
      nameInput.onchange = ()=>{
        p.name = nameInput.value.trim() || p.name;
        saveToStorage();
        renderPeople();
        // refresh tasks view chips/names
        renderDashboard();
      };

      const delBtn = el("button", {class:"btn danger"}, "Verwijder");
      delBtn.onclick = ()=>{
        if(!confirm(`Verwijder ${p.name}? (IDs in klussen blijven bestaan als tekst)`)) return;
        state.people = state.people.filter(x=>x.id!==p.id);
        // also remove from assignments/owner
        state.tasks.forEach(t=>{
          if(t.owner === p.id) t.owner = "";
          t.assignees = (t.assignees||[]).filter(id=>id!==p.id);
        });
        saveToStorage();
        renderPeople();
        renderDashboard();
      };

      tbody.appendChild(el("tr", {}, [
        el("td", {}, p.id),
        el("td", {}, nameInput),
        el("td", {}, delBtn)
      ]));
    });
}

function addPerson(){
  const name = prompt("Naam van persoon:");
  if(!name) return;
  let id = slugify(name);
  if(!id) return;
  const exists = new Set(state.people.map(p=>p.id));
  if(exists.has(id)){
    let n = 2;
    while(exists.has(`${id}-${n}`)) n++;
    id = `${id}-${n}`;
  }
  state.people.push({id, name: name.trim()});
  saveToStorage();
  renderPeople();
  renderTasks();
}

function addTask(){
  const t = newTaskTemplate();
  state.tasks.push(t);
  saveToStorage();
  switchView("tasks");
  openTaskAndScroll(t.id);
  renderTasks();
  renderDashboard();
}

function wireUI(){
  // tabs
  document.querySelectorAll(".tab").forEach(btn=>{
    btn.addEventListener("click", ()=>switchView(btn.dataset.view));
  });

  document.getElementById("btn-add-task").onclick = addTask;
  document.getElementById("btn-add-task-2").onclick = addTask;

  document.getElementById("btn-clear-filters").onclick = ()=>{
    document.getElementById("filter-search").value = "";
    document.getElementById("filter-status").value = "";
    document.getElementById("filter-group").value = "";
    document.getElementById("filter-person").value = "";
    renderTasks();
  };

  // filters: live update
  document.getElementById("filter-search").addEventListener("input", ()=>renderTasks());
  ["filter-status","filter-group","filter-person"].forEach(id=>{
    const elx = document.getElementById(id);
    if(elx) elx.addEventListener("change", ()=>renderTasks());
  });


  document.getElementById("btn-close").onclick = ()=>{
    document.getElementById("drawer").classList.add("hidden");
    state.selectedTaskId = null;
  };

  document.getElementById("btn-save").onclick = (e)=>{
    if(e){ e.preventDefault(); }
    const btn = document.getElementById("btn-save");
    try{
      const t = readTaskForm();
      if(!t){
        // no selected task -> nothing to save
        btn.classList.add("shake");
        setTimeout(()=>btn.classList.remove("shake"), 400);
        return;
      }
      // update drawer title
      document.getElementById("drawer-title").textContent = t.title;
      saveToStorage();
      renderTasks();
      renderDashboard();

      // subtle inline feedback (no popup dependency)
      const old = btn.textContent;
      btn.textContent = "Opgeslagen ✅";
      btn.disabled = true;
      setTimeout(()=>{ btn.textContent = old; btn.disabled = false; }, 900);
    }catch(err){
      console.error(err);
      alert("Opslaan mislukt. Open je browser-console voor details.");
    }
  };

  document.getElementById("btn-print").onclick = (e)=>{
    if(e){ e.preventDefault(); e.stopPropagation(); }
    const t = readTaskForm(); // include latest edits
    if(!t) return;
    saveToStorage();
    const sheet = document.getElementById("print-sheet");
    sheet.innerHTML = buildPrintSheet(t);
    // ensure DOM update before print (some browsers need a frame)
    requestAnimationFrame(()=>window.print());
  };

  document.getElementById("btn-refresh-materials").onclick = renderMaterials;

  document.getElementById("btn-add-person").onclick = addPerson;

  // export/import/reset
  document.getElementById("btn-export").onclick = ()=>{
    const payload = { exported_at: new Date().toISOString(), tasks: state.tasks, people: state.people };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {type:"application/json"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "klusplanner-export.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  document.getElementById("btn-import").onclick = async ()=>{
    const file = document.getElementById("file-import").files[0];
    if(!file){ alert("Kies eerst een JSON-bestand."); return; }
    try{
      const text = await file.text();
      const obj = JSON.parse(text);
      if(!obj.tasks || !obj.people) throw new Error("Onverwacht formaat: verwacht {tasks, people}.");
      state.tasks = obj.tasks;
      state.people = obj.people;
      saveToStorage();
      alert("Import klaar ✅");
      renderDashboard();
      renderTasks();
      renderPeople();
      renderMaterials();
    }catch(e){
      alert("Import mislukt: " + e.message);
    }
  };

  document.getElementById("btn-reset").onclick = async ()=>{
    if(!confirm("Reset naar defaults? Dit overschrijft je huidige data.")) return;
    const d = await loadDefaults();
    state.tasks = d.tasks;
    state.people = d.people;
    saveToStorage();
    alert("Teruggezet ✅");
    renderDashboard();
    renderTasks();
    renderPeople();
    renderMaterials();
  };
}


function ymd(d){
  const pad = (n)=>String(n).padStart(2,"0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function ensureSchedule(t){
  if(!t.scheduled) t.scheduled = { date:"", timeblock:"", start:"", end:"" };
  if(typeof t.scheduled !== "object") t.scheduled = { date:"", timeblock:"", start:"", end:"" };

  // migrate legacy date/timeblock -> start/end
  if(!t.scheduled.start && t.scheduled.date){
    const tb = parseTimeblock(t.scheduled.timeblock || "") || { sh:9, sm:0, eh:17, em:0 };
    const pad=(n)=>String(n).padStart(2,"0");
    t.scheduled.start = `${t.scheduled.date}T${pad(tb.sh)}:${pad(tb.sm)}`;
    t.scheduled.end = `${t.scheduled.date}T${pad(tb.eh)}:${pad(tb.em)}`;
  }

  // infer legacy date from start if needed
  if(t.scheduled.start && !t.scheduled.date){
    try{
      const s = new Date(t.scheduled.start);
      const pad=(n)=>String(n).padStart(2,"0");
      t.scheduled.date = `${s.getFullYear()}-${pad(s.getMonth()+1)}-${pad(s.getDate())}`;
    }catch(e){}
  }

  // if end missing, default +1h
  if(t.scheduled.start && !t.scheduled.end){
    try{
      const s = new Date(t.scheduled.start);
      s.setHours(s.getHours()+1);
      const pad=(n)=>String(n).padStart(2,"0");
      t.scheduled.end = `${s.getFullYear()}-${pad(s.getMonth()+1)}-${pad(s.getDate())}T${pad(s.getHours())}:${pad(s.getMinutes())}`;
    }catch(e){}
  }
}


function parseTimeblock(tb){
  // supports "09:00–12:00", "09:00-12:00", "09:00 – 12:00"
  const s = (tb||"").trim();
  if(!s) return null;
  const m = s.match(/(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})/);
  if(!m) return null;
  const sh = Number(m[1]), sm = Number(m[2]), eh = Number(m[3]), em = Number(m[4]);
  if([sh,sm,eh,em].some(x=>Number.isNaN(x))) return null;
  return { startMin: sh*60+sm, endMin: eh*60+em };
}
function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }
function startOfWeek(dateObj){
  // Monday start
  const d = new Date(dateObj);
  const day = (d.getDay()+6)%7; // Mon=0
  d.setDate(d.getDate()-day);
  d.setHours(0,0,0,0);
  return d;
}
function addDays(d, n){
  const x = new Date(d);
  x.setDate(x.getDate()+n);
  return x;
}
function rangeForZoom(focusYmd, zoom){
  const fd = focusYmd ? new Date(focusYmd+"T00:00:00") : new Date();
  fd.setHours(0,0,0,0);

  if(zoom === "day"){
    const start = new Date(fd);
    const end = addDays(start, 1);
    return { start, end, unit:"hour" };
  }
  if(zoom === "week"){
    const start = startOfWeek(fd);
    const end = addDays(start, 7);
    return { start, end, unit:"day" };
  }
  // month
  const start = new Date(fd.getFullYear(), fd.getMonth(), 1);
  const end = new Date(fd.getFullYear(), fd.getMonth()+1, 1);
  return { start, end, unit:"day" };
}

function scheduledTasksInRange(range){
  return state.tasks
    .filter(t => t.scheduled && t.scheduled.start && t.scheduled.end)
    .map(t=>{
      const start = new Date(t.scheduled.start);
      const end = new Date(t.scheduled.end);
      return { task: t, start, end };
    })
    .filter(x => x.end > range.start && x.start < range.end)
    .sort((a,b)=> (a.start - b.start) || ((a.task.title||"").localeCompare(b.task.title||"")));
}


function statusClass(t){
  if(t.status === "Afgerond") return "done";
  if(t.status.startsWith("Wacht") || t.status === "Bezig" || t.status === "Ingepland") return "blocked";
  return "";
}

function buildGantt(range){
  const items = scheduledTasksInRange(range);
  const wrap = el("div", {class:"gantt"});
  const grid = el("div", {class:"gantt-grid"});
  wrap.appendChild(grid);

  const labelW = 320;
  let cols = 0;
  let colW = 44;
  let labels = [];

  if(range.unit === "hour"){
    cols = 24;
    colW = 54;
    labels = Array.from({length:24}, (_,h)=> `${String(h).padStart(2,"0")}:00`);
  }else{
    const days = Math.round((range.end - range.start)/(1000*60*60*24));
    cols = days;
    colW = 44;
    labels = Array.from({length:days}, (_,i)=>{
      const d = addDays(range.start, i);
      return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}`;
    });
  }

  grid.style.gridTemplateColumns = `${labelW}px repeat(${cols}, ${colW}px)`;

  grid.appendChild(el("div", {class:"gantt-cell gantt-head gantt-label"}, "Klus"));
  labels.forEach(l=> grid.appendChild(el("div", {class:"gantt-cell gantt-head"}, l)));

  if(items.length === 0){
    grid.appendChild(el("div", {class:"gantt-cell gantt-label"}, "–"));
    grid.appendChild(el("div", {class:"gantt-cell", style:`grid-column: span ${cols}`}, "Geen ingeplande klussen in deze periode."));
    return wrap;
  }

  items.forEach(({task, start, end})=>{
    const exec1 = getPersonName((task.assignees||[])[0]);
    const exec2 = getPersonName((task.assignees||[])[1]);

    const label = el("div", {class:"gantt-cell gantt-label"}, [
      el("div", {style:"font-weight:900"}, `${task.title}`),
      el("div", {class:"small"}, `${task.group || "–"} • ${task.location || "–"} • ${exec1}${exec2 && exec2!=="–" ? " + " + exec2 : ""}`)
    ]);
    grid.appendChild(label);

    const track = el("div", {class:"gantt-cell gantt-track gantt-row", style:`grid-column: span ${cols}; position:relative; padding:0;`});
    track.style.height = "54px";
    grid.appendChild(track);

    let startPos = 0, endPos = cols;

    if(range.unit === "hour"){
      const s = new Date(Math.max(start.getTime(), range.start.getTime()));
      const e = new Date(Math.min(end.getTime(), range.end.getTime()));
      const startMin = s.getHours()*60 + s.getMinutes();
      const endMin = e.getHours()*60 + e.getMinutes();
      startPos = clamp(startMin/60, 0, 24);
      endPos = clamp(endMin/60, 0, 24);
    }else{
      const sDay = new Date(start); sDay.setHours(0,0,0,0);
      const eDay = new Date(end); eDay.setHours(0,0,0,0);
      const dayIndexStart = Math.floor((sDay - range.start)/(1000*60*60*24));
      const endsAtMidnight = end.getHours()===0 && end.getMinutes()===0;
      const dayIndexEnd = Math.floor((eDay - range.start)/(1000*60*60*24)) + (endsAtMidnight ? 0 : 1);
      startPos = clamp(dayIndexStart, 0, cols);
      endPos = clamp(dayIndexEnd, 0, cols);
      if(endPos <= startPos) endPos = startPos + 1;
    }

    const left = startPos * colW + 6;
    const width = Math.max(24, (endPos - startPos) * colW - 12);

    const bar = el("div", { class:`gantt-bar ${statusClass(task)}`, style:`left:${left}px; width:${width}px;` }, [
      el("span", {}, task.title),
      el("span", {class:"tiny"}, `(${fmtDateTime(task.scheduled.start)} → ${fmtDateTime(task.scheduled.end)})`)
    ]);

    bar.onclick = ()=>{ switchView("tasks"); openTaskAndScroll(task.id); };
    track.appendChild(bar);
  });

  return wrap;
}


function buildCalendar(range){
  const items = scheduledTasksInRange(range);
  const byDate = new Map();

  items.forEach(({task, start, end})=>{
    const cur = new Date(start); cur.setHours(0,0,0,0);
    const last = new Date(end); last.setHours(0,0,0,0);

    for(let d = new Date(cur); d <= last; d.setDate(d.getDate()+1)){
      const dayStart = new Date(d);
      const dayEnd = new Date(d); dayEnd.setDate(dayEnd.getDate()+1);
      if(end <= dayStart || start >= dayEnd) continue;
      const key = ymd(dayStart);
      if(!byDate.has(key)) byDate.set(key, []);
      byDate.get(key).push({task, start, end});
    }
  });

  if(state.planning.zoom === "day"){
    return buildDayAgenda(range, byDate);
  }

  if(state.planning.zoom === "week"){
    const cal = el("div", {class:"cal"});
    const week = el("div", {class:"cal-week"});
    cal.appendChild(week);
    for(let i=0;i<7;i++){
      const d = addDays(range.start, i);
      const key = ymd(d);
      const col = el("div", {class:"cal-week-col"});
      col.appendChild(el("div", {class:"cal-week-title"}, `${["Ma","Di","Wo","Do","Vr","Za","Zo"][i]} ${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}`));
      const list = (byDate.get(key)||[]);
      if(list.length === 0){
        col.appendChild(el("div", {class:"muted"}, "–"));
      }else{
        list.forEach(({task})=>{
          const chip = el("div", {class:`cal-chip ${statusClass(task)}`}, `${task.title}`);
          chip.onclick = (e)=>{ e.stopPropagation(); switchView("tasks"); openTaskAndScroll(task.id); };
          col.appendChild(chip);
        });
      }
      col.onclick = ()=>{ state.planning.zoom = "day"; state.planning.focusDate = key; renderPlanning(); };
      week.appendChild(col);
    }
    return cal;
  }

  // month
  const cal = el("div", {class:"cal"});
  const dows = ["Ma","Di","Wo","Do","Vr","Za","Zo"];
  const dowRow = el("div", {class:"cal-month"});
  dows.forEach(d=>dowRow.appendChild(el("div", {class:"cal-dow"}, d)));
  cal.appendChild(dowRow);

  const monthGrid = el("div", {class:"cal-month"});
  cal.appendChild(monthGrid);

  const first = new Date(range.start);
  const startDow = (first.getDay()+6)%7;
  for(let i=0;i<startDow;i++){
    monthGrid.appendChild(el("div", {class:"cal-day", style:"opacity:.35; cursor:default"}, ""));
  }

  const daysInMonth = Math.round((range.end - range.start)/(1000*60*60*24));
  for(let i=0;i<daysInMonth;i++){
    const d = addDays(range.start, i);
    const key = ymd(d);
    const cell = el("div", {class:"cal-day"});
    cell.appendChild(el("div", {class:"cal-day-num"}, String(d.getDate())));

    const list = (byDate.get(key)||[]).slice(0,3);
    list.forEach(({task})=>{
      const chip = el("div", {class:`cal-chip ${statusClass(task)}`}, `${task.title}`);
      chip.onclick = (e)=>{ e.stopPropagation(); switchView("tasks"); openTaskAndScroll(task.id); };
      cell.appendChild(chip);
    });

    const extra = (byDate.get(key)||[]).length - list.length;
    if(extra>0){
      cell.appendChild(el("div", {class:"small"}, `+${extra} meer…`));
    }

    cell.onclick = ()=>{ state.planning.zoom = "day"; state.planning.focusDate = key; renderPlanning(); };
    monthGrid.appendChild(cell);
  }

  return cal;
}


function buildDayAgenda(range, byDate){
  const date = ymd(range.start);
  const list = (byDate.get(date)||[]).slice().sort((a,b)=> a.start - b.start);

  const wrap = el("div", {class:"day-agenda"});
  const grid = el("div", {class:"day-grid"});
  wrap.appendChild(grid);

  for(let h=0;h<24;h++){
    grid.appendChild(el("div", {class:"hour-row"}, [
      el("div", {class:"hour-label"}, `${String(h).padStart(2,"0")}:00`),
      el("div", {class:"hour-line"}, "")
    ]));
  }

  const layer = el("div", {class:"agenda-layer"});
  grid.appendChild(layer);

  const pxPerMin = 56/60;
  list.forEach(({task, start, end})=>{
    const s = new Date(Math.max(start.getTime(), range.start.getTime()));
    const e = new Date(Math.min(end.getTime(), range.end.getTime()));
    const startMin = s.getHours()*60 + s.getMinutes();
    const endMin = e.getHours()*60 + e.getMinutes();

    const top = startMin * pxPerMin;
    const height = Math.max(34, (endMin - startMin) * pxPerMin);

    const exec1 = getPersonName((task.assignees||[])[0]);
    const exec2 = getPersonName((task.assignees||[])[1]);

    const block = el("div", {class:`agenda-block ${statusClass(task)}`, style:`top:${top}px; height:${height}px;`}, [
      el("div", {}, `${fmtDateTime(task.scheduled.start)} → ${fmtDateTime(task.scheduled.end)} — ${task.title}`),
      el("div", {class:"tiny"}, `${task.location||"–"} • ${exec1}${exec2 && exec2!=="–" ? " + " + exec2 : ""}`)
    ]);
    block.onclick = ()=>{ switchView("tasks"); openTaskAndScroll(task.id); };
    layer.appendChild(block);
  });

  if(list.length === 0){
    layer.appendChild(el("div", {class:"muted", style:"position:absolute; top:12px; left:12px;"}, "Geen klussen ingepland op deze dag."));
  }

  return wrap;
}


function setPlanningButtons(){
  // mode buttons
  const mg = document.getElementById("plan-mode-gantt");
  const mc = document.getElementById("plan-mode-cal");
  if(mg && mc){
    mg.classList.toggle("active", state.planning.mode === "gantt");
    mc.classList.toggle("active", state.planning.mode === "calendar");
  }
  // zoom
  const zm = document.getElementById("zoom-month");
  const zw = document.getElementById("zoom-week");
  const zd = document.getElementById("zoom-day");
  if(zm && zw && zd){
    zm.classList.toggle("active", state.planning.zoom === "month");
    zw.classList.toggle("active", state.planning.zoom === "week");
    zd.classList.toggle("active", state.planning.zoom === "day");
  }

  const dateInput = document.getElementById("plan-date");
  if(dateInput){
    dateInput.value = state.planning.focusDate || ymd(new Date());
  }
}

function wirePlanningControls(){
  const mg = document.getElementById("plan-mode-gantt");
  const mc = document.getElementById("plan-mode-cal");
  if(mg && !mg.dataset.wired){
    mg.dataset.wired = "1";
    mg.onclick = ()=>{ state.planning.mode = "gantt"; renderPlanning(); };
    mc.onclick = ()=>{ state.planning.mode = "calendar"; renderPlanning(); };

    document.getElementById("zoom-month").onclick = ()=>{ state.planning.zoom = "month"; renderPlanning(); };
    document.getElementById("zoom-week").onclick = ()=>{ state.planning.zoom = "week"; renderPlanning(); };
    document.getElementById("zoom-day").onclick = ()=>{ state.planning.zoom = "day"; renderPlanning(); };

    document.getElementById("plan-prev").onclick = ()=>{
  const d = new Date((state.planning.focusDate || ymd(new Date())) + "T00:00:00");
  if(state.planning.zoom === "day") d.setDate(d.getDate()-1);
  else if(state.planning.zoom === "week") d.setDate(d.getDate()-7);
  else d.setMonth(d.getMonth()-1);
  state.planning.focusDate = ymd(d);
  renderPlanning();
};

document.getElementById("plan-next").onclick = ()=>{
  const d = new Date((state.planning.focusDate || ymd(new Date())) + "T00:00:00");
  if(state.planning.zoom === "day") d.setDate(d.getDate()+1);
  else if(state.planning.zoom === "week") d.setDate(d.getDate()+7);
  else d.setMonth(d.getMonth()+1);
  state.planning.focusDate = ymd(d);
  renderPlanning();
};

document.getElementById("plan-today").onclick = ()=>{
      state.planning.focusDate = ymd(new Date());
      renderPlanning();
    };

    document.getElementById("plan-date").onchange = (e)=>{
      state.planning.focusDate = e.target.value;
      renderPlanning();
    };
  }
}

function renderPlanning(){
  if(!state.planning.focusDate){
    state.planning.focusDate = ymd(new Date());
  }
  wirePlanningControls();
  setPlanningButtons();

  const range = rangeForZoom(state.planning.focusDate, state.planning.zoom);

  const wrap = document.getElementById("planning-wrap");
  wrap.innerHTML = "";

  const header = el("div", {class:"muted", style:"margin:6px 2px 10px 2px;"});
  const startTxt = range.start.toLocaleDateString("nl-NL");
  const endTxt = addDays(range.end, -1).toLocaleDateString("nl-NL");
  header.textContent = state.planning.zoom === "day"
    ? `Dagoverzicht: ${startTxt} (per uur)`
    : `${state.planning.zoom[0].toUpperCase()+state.planning.zoom.slice(1)}overzicht: ${startTxt} – ${endTxt}`;

  wrap.appendChild(header);

  const view = state.planning.mode === "gantt" ? buildGantt(range) : buildCalendar(range);
  wrap.appendChild(view);
}


async function init(){
  const stored = loadFromStorage();
  if(stored && stored.tasks && stored.people){
    state.tasks = stored.tasks;
    state.people = stored.people;
  }else{
    const d = await loadDefaults();
    state.tasks = d.tasks;
    state.people = d.people;
    saveToStorage();
  }

// Migration v1.5: ensure scheduled.start/end exist (from legacy date/timeblock) and cap assignees to 2.
state.tasks.forEach(t=>{
  if(!t.scheduled) t.scheduled = { date:"", timeblock:"", start:"", end:"" };
  if(!t.scheduled.start && t.scheduled.date){
    const tb = parseTimeblock(t.scheduled.timeblock || "");
    const sh = tb ? Math.floor(tb.startMin/60) : 9;
    const sm = tb ? tb.startMin%60 : 0;
    const eh = tb ? Math.floor(tb.endMin/60) : 17;
    const em = tb ? tb.endMin%60 : 0;
    const pad = (n)=>String(n).padStart(2,"0");
    t.scheduled.start = `${t.scheduled.date}T${pad(sh)}:${pad(sm)}`;
    t.scheduled.end = `${t.scheduled.date}T${pad(eh)}:${pad(em)}`;
  }
  if(t.scheduled.start && !t.scheduled.end){
    try{
      const s = new Date(t.scheduled.start);
      s.setHours(s.getHours()+1);
      const pad=(n)=>String(n).padStart(2,"0");
      t.scheduled.end = `${s.getFullYear()}-${pad(s.getMonth()+1)}-${pad(s.getDate())}T${pad(s.getHours())}:${pad(s.getMinutes())}`;
    }catch(e){}
  }
  if(!Array.isArray(t.assignees)) t.assignees = [];
  t.assignees = t.assignees.slice(0,2);
  t.priority = "";
});

  wireUI();
  renderDashboard();
  renderTasks();
}

init();
