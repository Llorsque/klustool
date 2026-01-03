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
  const total = state.tasks.length;
  const done = state.tasks.filter(t=>t.status==="Afgerond").length;
  const progressPct = total ? Math.round((done/total)*100) : 0;

  const sumRealistic = state.tasks.reduce((a,t)=>a + (Number(t.estimate_hours?.realistic)||0),0);
  const sumActual = state.tasks.reduce((a,t)=>a + (Number(t.actual_hours)||0),0);

  const blocked = state.tasks.filter(t=>t.status.startsWith("Wacht")).length;
  const mustOpen = state.tasks.filter(t=>t.priority==="Must" && t.status!=="Afgerond").length;

  document.getElementById("kpi-progress").textContent = `${progressPct}%`;
  document.getElementById("kpi-progress-note").textContent = `${done}/${total} afgerond`;

  document.getElementById("kpi-hours").textContent = `${fmtHours(sumActual)} / ${fmtHours(sumRealistic)} u`;
  document.getElementById("kpi-hours-note").textContent = `Werkelijk / Realistisch begroot`;

  document.getElementById("kpi-blocked").textContent = String(blocked);
  
  // upcoming table: Ingepland/Bezig sorted by date then title
  const upcoming = state.tasks
    .filter(t => ["Ingepland","Bezig","Wacht op materiaal","Wacht op hulp/afspraak"].includes(t.status))
    .slice()
    .sort((a,b)=>{
      const da = a.scheduled?.date || "9999-12-31";
      const db = b.scheduled?.date || "9999-12-31";
      if(da !== db) return da.localeCompare(db);
      return (a.title||"").localeCompare(b.title||"");
    });

  const tbody = document.querySelector("#table-upcoming tbody");
  tbody.innerHTML = "";
  if(upcoming.length === 0){
    tbody.appendChild(el("tr", {class:"clickrow", onclick:(e)=>{ if(e.target && (e.target.tagName==="A" || e.target.closest("a"))) return; openTaskAndScroll(t.id);} }, [
      el("td", {colspan:"7", class:"muted"}, "Nog geen klussen ingepland. Tip: plan eerst OH-PRE (presentatie) en de Must-keukenpunten.")
    ]));
    return;
  }

  upcoming.forEach(t=>{
    const dot = getStatusDot(t.status);
    const statusCell = el("span", {class:"tag"}, [
      el("span", {class:`dot ${dot}`}),
      t.status
    ]);

    const startTxt = t.scheduled?.start ? fmtDateTime(t.scheduled.start) : "–";
    const endTxt = t.scheduled?.end ? fmtDateTime(t.scheduled.end) : "–";
    const exec1Txt = getPersonName(t.executors?.exec1);
    const exec2Txt = getPersonName(t.executors?.exec2);

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

function applyTaskFilters(tasks){
  const q = (document.getElementById("filter-search").value || "").toLowerCase().trim();
  const status = document.getElementById("filter-status").value;
  const group = document.getElementById("filter-group").value;
  const assignee = document.getElementById("filter-person").value;
  return tasks.filter(t=>{    if(status && t.status !== status) return false;
    if(group && t.group !== group) return false;
    if(assignee){
      const set = new Set([t.executors?.exec1, t.executors?.exec2].filter(Boolean));
      if(!set.has(assignee)) return false;
    }
    if(q){
      const hay = `${t.id} ${t.title} ${t.location} ${t.group} ${t.project}`.toLowerCase();
      if(!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderTasks(){
  populateFilters();

  const tbody = document.querySelector("#table-tasks tbody");
  tbody.innerHTML = "";

  const tasksSorted = state.tasks.slice().sort((a,b)=>{
    // prioritize must open, then status, then id
    const aMustOpen = (a.priority==="Must" && a.status!=="Afgerond") ? 0 : 1;
    const bMustOpen = (b.priority==="Must" && b.status!=="Afgerond") ? 0 : 1;
    if(aMustOpen !== bMustOpen) return aMustOpen - bMustOpen;

    const sa = STATUSES.indexOf(a.status);
    const sb = STATUSES.indexOf(b.status);
    if(sa !== sb) return sa - sb;

    return (a.id||"").localeCompare(b.id||"");
  });

  const filtered = applyTaskFilters(tasksSorted);

  if(filtered.length === 0){
    tbody.appendChild(el("tr", {}, [
      el("td", {colspan:"11", class:"muted"}, "Geen resultaten met deze filters.")
    ]));
    return;
  }

  filtered.forEach(t=>{
    const dot = getStatusDot(t.status);
    const statusTag = el("span", {class:"tag"}, [
      el("span", {class:`dot ${dot}`}),
      t.status
    ]);
      ? assignedIds.map(id => el("span", {class:"tag"}, getPersonName(id)))
      : el("span", {class:"muted"}, "–");

    const startTxt = t.scheduled?.start ? fmtDateTime(t.scheduled.start) : "–";
    const endTxt = t.scheduled?.end ? fmtDateTime(t.scheduled.end) : "–";
    const exec1Txt = getPersonName(t.executors?.exec1);
    const exec2Txt = getPersonName(t.executors?.exec2);

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

  // wire filter changes
  ["filter-search","filter-status","filter-group","filter-person"].forEach(id=>{
    const node = document.getElementById(id);
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
    status: "Backlog",
    executors: { exec1: "", exec2: "" },
    estimate_hours: { optimistic: 0, realistic: 0, worst: 0 },
    actual_hours: 0,
    scheduled: { start: "", end: "" },
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
  state.selectedTaskId = taskId;

  const drawer = document.getElementById("drawer");
  drawer.classList.remove("hidden");

    document.getElementById("drawer-title").textContent = t.title;

  // fill status select
  const stSel = document.getElementById("f-status");
  stSel.innerHTML = "";
  STATUSES.forEach(s => stSel.appendChild(el("option", {value:s}, s)));

  // fill executors selects
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

  // fill owner select
  const ownerSel = document.getElementById("f-owner");
  ownerSel.innerHTML = "";
  state.people.slice().sort((a,b)=>a.name.localeCompare(b.name)).forEach(p=>{
    ownerSel.appendChild(el("option", {value:p.id}, p.name));
  });

  // assignees multi
  
  // basic fields
  document.getElementById("f-title").value = t.title || "";
  document.getElementById("f-project").value = t.project || "";
  document.getElementById("f-group").value = t.group || "";
  document.getElementById("f-location").value = t.location || "";
    document.getElementById("f-status").value = t.status || "Backlog";
  document.getElementById("f-exec1").value = t.executors?.exec1 || "";
  document.getElementById("f-exec2").value = t.executors?.exec2 || "";
  document.getElementById("f-start").value = t.scheduled?.start || "";
  document.getElementById("f-end").value = t.scheduled?.end || "";
  
    
  document.getElementById("f-o").value = t.estimate_hours?.optimistic ?? 0;
  document.getElementById("f-r").value = t.estimate_hours?.realistic ?? 0;
  document.getElementById("f-w").value = t.estimate_hours?.worst ?? 0;
  document.getElementById("f-actual").value = t.actual_hours ?? 0;

  document.getElementById("f-dod").value = t.definition_of_done || "";

  // materials/tools/steps textareas
  document.getElementById("f-materials").value = (t.materials||[]).map(m=>{
    if(typeof m === "string") return m;
    return `${m.item||""} | ${m.qty||""} | ${m.status||""}`.trim();
  }).join("\n");

  document.getElementById("f-tools").value = (t.tools||[]).join("\n");
  document.getElementById("f-steps").value = (t.steps||[]).join("\n");
  document.getElementById("f-notes").value = t.notes || "";
}



function readTaskForm(){
  const t = state.tasks.find(x=>x.id===state.selectedTaskId);
  if(!t) return null;

  t.title = document.getElementById("f-title").value.trim();
  t.project = document.getElementById("f-project").value.trim();
  t.group = document.getElementById("f-group").value.trim();
  t.location = document.getElementById("f-location").value.trim();
  t.priority = document.getElementById("f-priority").value;
  t.status = document.getElementById("f-status").value;
  
  t.scheduled = {
    date: document.getElementById("f-date").value,
    timeblock: document.getElementById("f-timeblock").value.trim()
  };

  t.estimate_hours = {
    optimistic: Number(document.getElementById("f-o").value || 0),
    realistic: Number(document.getElementById("f-r").value || 0),
    worst: Number(document.getElementById("f-w").value || 0),
  };

  t.actual_hours = Number(document.getElementById("f-actual").value || 0);

  t.definition_of_done = document.getElementById("f-dod").value.trim();

  t.executors = {
    exec1: document.getElementById("f-exec1").value,
    exec2: document.getElementById("f-exec2").value
  };

  // parse materials
  const mLines = document.getElementById("f-materials").value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  t.materials = mLines.map(line=>{
    // allow either "a|b|c" or keep as string
    const parts = line.split("|").map(x=>x.trim());
    if(parts.length >= 2){
      return { item: parts[0], qty: parts[1] || "", status: (parts[2]||"").trim() };
    }
    return line;
  });

  // tools, steps
  t.tools = document.getElementById("f-tools").value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  t.steps = document.getElementById("f-steps").value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);

  t.notes = document.getElementById("f-notes").value.trim();

  return t;
}

function buildPrintSheet(task){
  const exec1 = getPersonName(task.executors?.exec1);
  const exec2 = getPersonName(task.executors?.exec2);
  
  const start = task.scheduled?.start ? fmtDateTime(task.scheduled.start) : "–";
  const end = task.scheduled?.end ? fmtDateTime(task.scheduled.end) : "–";
  const hrs = task.estimate_hours || {};
  const est = `${fmtHours(hrs.optimistic)} / ${fmtHours(hrs.realistic)} / ${fmtHours(hrs.worst)} u`;

  const mats = (task.materials||[]).map(m=>{
    if(typeof m === "string") return `<li>${escapeHtml(m)}</li>`;
    return `<li><strong>${escapeHtml(m.item||"")}</strong> — ${escapeHtml(m.qty||"")} <span class="muted">(${escapeHtml(m.status||"")})</span></li>`;
  }).join("") || "<li>–</li>";

  const tools = (task.tools||[]).map(x=>`<li>${escapeHtml(x)}</li>`).join("") || "<li>–</li>";
  const steps = (task.steps||[]).map(x=>`<li>${escapeHtml(x)}</li>`).join("") || "<li>–</li>";

  const html = `
    <h1 class="ps-title">${escapeHtml(task.title)}</h1>
    <div class="ps-meta">
      <div><strong>Project:</strong> ${escapeHtml(task.project||"–")} • <strong>Groep:</strong> ${escapeHtml(task.group||"–")} • <strong>Locatie:</strong> ${escapeHtml(task.location||"–")}</div>
      <div><strong>Status:</strong> ${escapeHtml(task.status||"–")} • <strong>Start:</strong> ${escapeHtml(start)} • <strong>Eind:</strong> ${escapeHtml(end)}</div>
    </div>

    <div class="ps-grid">
      <div class="ps-box">
        <h4>Mensen</h4>
        <p>
        <strong>Uitvoerder 1:</strong> ${escapeHtml(exec1)}<br/>
        <strong>Uitvoerder 2:</strong> ${escapeHtml(exec2)}</p>
      </div>
      <div class="ps-box">
        <h4>Tijd</h4>
        <p><strong>Inschatting (O/R/W):</strong> ${escapeHtml(est)}<br/>
        <strong>Werkelijk:</strong> ${escapeHtml(fmtHours(task.actual_hours))} u</p>
      </div>
      <div class="ps-box">
        <h4>Definition of Done</h4>
        <p>${escapeHtml(task.definition_of_done||"–")}</p>
      </div>
      <div class="ps-box">
        <h4>Notities</h4>
        <p>${escapeHtml(task.notes||"–")}</p>
      </div>
    </div>

    <div class="ps-grid">
      <div class="ps-box">
        <h4>Materialen</h4>
        <ul>${mats}</ul>
      </div>
      <div class="ps-box">
        <h4>Tools</h4>
        <ul>${tools}</ul>
      </div>
    </div>

    <div class="ps-box ps-steps">
      <h4>Stappen</h4>
      <ol>${steps}</ol>
    </div>
  `;

  return html;
}

function escapeHtml(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
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
          if(t.executors){
            if(t.executors.exec1 === p.id) t.executors.exec1 = "";
            if(t.executors.exec2 === p.id) t.executors.exec2 = "";
          }
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
    document.getElementById("filter-must").checked = false;
    renderTasks();
  };

  document.getElementById("btn-close").onclick = ()=>{
    document.getElementById("drawer").classList.add("hidden");
    state.selectedTaskId = null;
  };

  document.getElementById("btn-save").onclick = ()=>{
    const t = readTaskForm();
    if(!t) return;
    // update drawer title
    document.getElementById("drawer-title").textContent = t.title;
    saveToStorage();
    renderTasks();
    renderDashboard();
    alert("Opgeslagen ✅");
  };

  document.getElementById("btn-print").onclick = ()=>{
    const t = readTaskForm(); // ensure latest edits included
    if(!t) return;
    saveToStorage();
    const sheet = document.getElementById("print-sheet");
    sheet.innerHTML = buildPrintSheet(t);
    window.print();
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
    .filter(x=> x.end > range.start && x.start < range.end)
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
    // day columns
    const days = Math.round((range.end - range.start)/(1000*60*60*24));
    cols = days;
    colW = 44;
    labels = Array.from({length:days}, (_,i)=>{
      const d = addDays(range.start, i);
      return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}`;
    });
  }

  grid.style.gridTemplateColumns = `${labelW}px repeat(${cols}, ${colW}px)`;

  // header row
  grid.appendChild(el("div", {class:"gantt-cell gantt-head gantt-label"}, "Klus"));
  labels.forEach(l=>{
    grid.appendChild(el("div", {class:"gantt-cell gantt-head"}, l));
  });

  if(items.length === 0){
    // One empty row
    grid.appendChild(el("div", {class:"gantt-cell gantt-label"}, "–"));
    grid.appendChild(el("div", {class:"gantt-cell", style:`grid-column: span ${cols}`}, "Geen ingeplande klussen in deze periode."));
    return wrap;
  }

  items.forEach(({task, start, end})=>{
    // label cell
    const label = el("div", {class:"gantt-cell gantt-label"}, [
      el("div", {style:"font-weight:900"}, `${task.title}`),
      el("div", {class:"small"}, `${task.group || "–"} • ${task.location || "–"} • ${fmtDateTime(task.scheduled.start)} → ${fmtDateTime(task.scheduled.end)}`)
    ]);
    grid.appendChild(label);

    // track cells (merged in one big cell spanning all cols)
    const track = el("div", {class:"gantt-cell gantt-track gantt-row", style:`grid-column: span ${cols}; position:relative; padding:0;`});
    track.style.height = "54px";
    grid.appendChild(track);

    // compute bar position
    let startPos = 0, endPos = cols;
    if(range.unit === "hour"){
      const startMin = tb ? tb.startMin : 9*60;
      const endMin = tb ? tb.endMin : 17*60;
      startPos = clamp(startMin/60, 0, 24);
      endPos = clamp(endMin/60, 0, 24);
    }else{
      const dayIndex = Math.floor((new Date(date+"T00:00:00") - range.start)/(1000*60*60*24));
      startPos = clamp(dayIndex, 0, cols-1);
      endPos = clamp(dayIndex + 1, 1, cols);
    }

    const left = startPos * colW + 6;
    const width = Math.max(24, (endPos - startPos) * colW - 12);

    const bar = el("div", {
      class:`gantt-bar ${statusClass(task)}`,
      style:`left:${left}px; width:${width}px;`
    }, [
      el("span", {}, task.title),
      el("span", {class:"tiny"}, `(${getPersonName(task.executors?.exec1)})`)
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
    if(!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push({task, tb});
  });

  if(state.planning.zoom === "day"){
    return buildDayAgenda(range, byDate);
  }

  if(state.planning.zoom === "week"){
    // week columns
    const cal = el("div", {class:"cal"});
    const week = el("div", {class:"cal-week"});
    cal.appendChild(week);
    for(let i=0;i<7;i++){
      const d = addDays(range.start, i);
      const date = ymd(d);
      const col = el("div", {class:"cal-week-col"});
      col.appendChild(el("div", {class:"cal-week-title"}, `${["Ma","Di","Wo","Do","Vr","Za","Zo"][i]} ${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}`));

      const list = (byDate.get(date)||[]);
      if(list.length === 0){
        col.appendChild(el("div", {class:"muted"}, "–"));
      }else{
        list.forEach(({task})=>{
          const chip = el("div", {class:`cal-chip ${statusClass(task)}`}, `${task.title}`);
          chip.onclick = (e)=>{ e.stopPropagation(); switchView("tasks"); openTaskAndScroll(task.id); };
          col.appendChild(chip);
        });
      }

      col.onclick = ()=>{ state.planning.zoom = "day"; state.planning.focusDate = date; renderPlanning(); };
      week.appendChild(col);
    }
    return cal;
  }

  // month view
  const cal = el("div", {class:"cal"});
  // DOW
  const dows = ["Ma","Di","Wo","Do","Vr","Za","Zo"];
  const dowRow = el("div", {class:"cal-month"});
  dows.forEach(d=>dowRow.appendChild(el("div", {class:"cal-dow"}, d)));
  cal.appendChild(dowRow);

  const monthGrid = el("div", {class:"cal-month"});
  cal.appendChild(monthGrid);

  const first = new Date(range.start);
  const startDow = (first.getDay()+6)%7; // 0=Mon
  // Fill leading blanks
  for(let i=0;i<startDow;i++){
    monthGrid.appendChild(el("div", {class:"cal-day", style:"opacity:.35; cursor:default"}, ""));
  }

  const daysInMonth = Math.round((range.end - range.start)/(1000*60*60*24));
  for(let i=0;i<daysInMonth;i++){
    const d = addDays(range.start, i);
    const date = ymd(d);
    const cell = el("div", {class:"cal-day"});
    cell.appendChild(el("div", {class:"cal-day-num"}, String(d.getDate())));

    const list = (byDate.get(date)||[]).slice(0,3);
    list.forEach(({task})=>{
      const chip = el("div", {class:`cal-chip ${statusClass(task)}`}, `${task.title}`);
      chip.onclick = (e)=>{ e.stopPropagation(); switchView("tasks"); openTaskAndScroll(task.id); };
      cell.appendChild(chip);
    });

    const extra = (byDate.get(date)||[]).length - list.length;
    if(extra>0){
      cell.appendChild(el("div", {class:"small"}, `+${extra} meer…`));
    }

    cell.onclick = ()=>{ state.planning.zoom = "day"; state.planning.focusDate = date; renderPlanning(); };
    monthGrid.appendChild(cell);
  }

  return cal;
}

function buildDayAgenda(range, byDate){
  const date = ymd(range.start);
  const list = (byDate.get(date)||[]).slice().sort((a,b)=>{
    const am = a.task.scheduled?.timeblock ? (parseTimeblock(a.task.scheduled.timeblock)?.startMin ?? 0) : 0;
    const bm = b.task.scheduled?.timeblock ? (parseTimeblock(b.task.scheduled.timeblock)?.startMin ?? 0) : 0;
    return am - bm;
  });

  const wrap = el("div", {class:"day-agenda"});
  const grid = el("div", {class:"day-grid"});
  wrap.appendChild(grid);

  // hour rows
  for(let h=0;h<24;h++){
    const row = el("div", {class:"hour-row"}, [
      el("div", {class:"hour-label"}, `${String(h).padStart(2,"0")}:00`),
      el("div", {class:"hour-line"}, "")
    ]);
    grid.appendChild(row);
  }

  const layer = el("div", {class:"agenda-layer"});
  grid.appendChild(layer);

  const pxPerMin = 56/60; // 56px per hour
  list.forEach(({task})=>{
    const tb = parseTimeblock(task.scheduled.timeblock||"");
    const startMin = tb ? tb.startMin : 9*60;
    const endMin = tb ? tb.endMin : Math.min(startMin+60, 24*60);
    const top = startMin * pxPerMin;
    const height = Math.max(34, (endMin - startMin) * pxPerMin);

    const block = el("div", {class:`agenda-block ${statusClass(task)}`, style:`top:${top}px; height:${height}px;`}, [
      el("div", {}, `${fmtDateTime(task.scheduled.start)} → ${fmtDateTime(task.scheduled.end)} — ${task.title}`),
      el("div", {class:"tiny"}, `${task.id} • ${task.location||"–"} • ${getPersonName(task.owner)}`)
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

  // --- Migration (v1.4): date+timeblock -> start/end, owner/assignees -> executors, remove priority ---
  const tbParse = (tb)=>{
    const m = String(tb||"").trim().match(/(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})/);
    if(!m) return null;
    return { sh: Number(m[1]), sm: Number(m[2]), eh: Number(m[3]), em: Number(m[4]) };
  };
  state.tasks.forEach(t=>{
    if(!t.executors){
      t.executors = { exec1: t.owner || "", exec2: (Array.isArray(t.assignees) && t.assignees[0]) ? t.assignees[0] : "" };
    }
    if(!t.scheduled) t.scheduled = { start:"", end:"" };
    if(!t.scheduled.start && t.scheduled.date){
      const date = t.scheduled.date;
      const tb = tbParse(t.scheduled.timeblock || "");
      const sh = tb ? tb.sh : 9, sm = tb ? tb.sm : 0;
      const eh = tb ? tb.eh : 17, em = tb ? tb.em : 0;
      const pad = (n)=>String(n).padStart(2,"0");
      t.scheduled.start = `${date}T${pad(sh)}:${pad(sm)}`;
      t.scheduled.end = `${date}T${pad(eh)}:${pad(em)}`;
    }
    if(!t.scheduled.end && t.scheduled.start){
      try{
        const d = new Date(t.scheduled.start);
        d.setHours(d.getHours()+1);
        const pad = (n)=>String(n).padStart(2,"0");
        t.scheduled.end = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      }catch(e){}
    }
    delete t.scheduled.date;
    delete t.scheduled.timeblock;
    delete t.owner;
    delete t.assignees;
    delete t.priority;
  });

  wireUI();
  renderDashboard();
  renderTasks();
}

init();
