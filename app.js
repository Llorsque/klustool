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
  document.getElementById("kpi-must").textContent = String(mustOpen);

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
    tbody.appendChild(el("tr", {}, [
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

    const planned = t.scheduled?.date ? `${t.scheduled.date} ${t.scheduled.timeblock||""}`.trim() : "–";

    tbody.appendChild(el("tr", {}, [
      el("td", {}, t.id),
      el("td", {}, t.title),
      el("td", {}, t.location || "–"),
      el("td", {}, statusCell),
      el("td", {}, planned),
      el("td", {}, getPersonName(t.owner)),
      el("td", {}, el("a", {class:"action-link", href:"#", onclick:(e)=>{e.preventDefault(); switchView("tasks"); openTask(t.id);} }, "Open"))
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
  const assSel = document.getElementById("filter-assignee");
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
  const assignee = document.getElementById("filter-assignee").value;
  const onlyMust = document.getElementById("filter-must").checked;

  return tasks.filter(t=>{
    if(onlyMust && t.priority !== "Must") return false;
    if(status && t.status !== status) return false;
    if(group && t.group !== group) return false;
    if(assignee){
      const set = new Set([t.owner, ...(t.assignees||[])].filter(Boolean));
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

    const assignedIds = Array.from(new Set([...(t.assignees||[])]));
    const assigned = assignedIds.length
      ? assignedIds.map(id => el("span", {class:"tag"}, getPersonName(id)))
      : el("span", {class:"muted"}, "–");

    const planned = t.scheduled?.date ? `${t.scheduled.date} ${t.scheduled.timeblock||""}`.trim() : "–";

    tbody.appendChild(el("tr", {}, [
      el("td", {}, t.id),
      el("td", {}, t.title),
      el("td", {}, t.group || "–"),
      el("td", {}, t.location || "–"),
      el("td", {}, el("span", {class:"tag"}, t.priority || "–")),
      el("td", {}, statusTag),
      el("td", {}, getPersonName(t.owner)),
      el("td", {}, assigned),
      el("td", {}, fmtHours(t.estimate_hours?.realistic)),
      el("td", {class:"small"}, planned),
      el("td", {}, el("a", {class:"action-link", href:"#", onclick:(e)=>{e.preventDefault(); openTask(t.id);} }, "Open"))
    ]));
  });

  // wire filter changes
  ["filter-search","filter-status","filter-group","filter-assignee","filter-must"].forEach(id=>{
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
    priority: "Should",
    status: "Backlog",
    owner: "ian",
    assignees: [],
    estimate_hours: { optimistic: 0, realistic: 0, worst: 0 },
    actual_hours: 0,
    scheduled: { date: "", timeblock: "" },
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

function openTask(taskId){
  const t = state.tasks.find(x=>x.id===taskId);
  if(!t) return;
  state.selectedTaskId = taskId;

  const drawer = document.getElementById("drawer");
  drawer.classList.remove("hidden");

  document.getElementById("drawer-id").textContent = t.id;
  document.getElementById("drawer-title").textContent = t.title;

  // fill status select
  const stSel = document.getElementById("f-status");
  stSel.innerHTML = "";
  STATUSES.forEach(s => stSel.appendChild(el("option", {value:s}, s)));

  // fill owner select
  const ownerSel = document.getElementById("f-owner");
  ownerSel.innerHTML = "";
  state.people.slice().sort((a,b)=>a.name.localeCompare(b.name)).forEach(p=>{
    ownerSel.appendChild(el("option", {value:p.id}, p.name));
  });

  // assignees multi
  renderAssigneeMulti(t);

  // basic fields
  document.getElementById("f-title").value = t.title || "";
  document.getElementById("f-project").value = t.project || "";
  document.getElementById("f-group").value = t.group || "";
  document.getElementById("f-location").value = t.location || "";
  document.getElementById("f-priority").value = t.priority || "Should";
  document.getElementById("f-status").value = t.status || "Backlog";
  document.getElementById("f-owner").value = t.owner || state.people[0]?.id || "";

  document.getElementById("f-date").value = t.scheduled?.date || "";
  document.getElementById("f-timeblock").value = t.scheduled?.timeblock || "";

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

function renderAssigneeMulti(task){
  const wrap = document.getElementById("f-assignees");
  wrap.innerHTML = "";
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
  const t = state.tasks.find(x=>x.id===state.selectedTaskId);
  if(!t) return null;

  t.title = document.getElementById("f-title").value.trim();
  t.project = document.getElementById("f-project").value.trim();
  t.group = document.getElementById("f-group").value.trim();
  t.location = document.getElementById("f-location").value.trim();
  t.priority = document.getElementById("f-priority").value;
  t.status = document.getElementById("f-status").value;
  t.owner = document.getElementById("f-owner").value;

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

  // assignees
  const assWrap = document.getElementById("f-assignees");
  const picks = Array.from(assWrap.querySelectorAll("input[type=checkbox]"))
    .filter(x=>x.checked)
    .map(x=>x.dataset.pid);
  t.assignees = picks;

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
  const assignees = (task.assignees||[]).map(getPersonName).join(", ") || "–";
  const owner = getPersonName(task.owner);
  const planned = task.scheduled?.date ? `${task.scheduled.date} ${task.scheduled.timeblock||""}`.trim() : "–";
  const hrs = task.estimate_hours || {};
  const est = `${fmtHours(hrs.optimistic)} / ${fmtHours(hrs.realistic)} / ${fmtHours(hrs.worst)} u`;

  const mats = (task.materials||[]).map(m=>{
    if(typeof m === "string") return `<li>${escapeHtml(m)}</li>`;
    return `<li><strong>${escapeHtml(m.item||"")}</strong> — ${escapeHtml(m.qty||"")} <span class="muted">(${escapeHtml(m.status||"")})</span></li>`;
  }).join("") || "<li>–</li>";

  const tools = (task.tools||[]).map(x=>`<li>${escapeHtml(x)}</li>`).join("") || "<li>–</li>";
  const steps = (task.steps||[]).map(x=>`<li>${escapeHtml(x)}</li>`).join("") || "<li>–</li>";

  const html = `
    <h1 class="ps-title">${escapeHtml(task.id)} — ${escapeHtml(task.title)}</h1>
    <div class="ps-meta">
      <div><strong>Project:</strong> ${escapeHtml(task.project||"–")} • <strong>Groep:</strong> ${escapeHtml(task.group||"–")} • <strong>Locatie:</strong> ${escapeHtml(task.location||"–")}</div>
      <div><strong>Prioriteit:</strong> ${escapeHtml(task.priority||"–")} • <strong>Status:</strong> ${escapeHtml(task.status||"–")} • <strong>Gepland:</strong> ${escapeHtml(planned)}</div>
    </div>

    <div class="ps-grid">
      <div class="ps-box">
        <h4>Mensen</h4>
        <p><strong>Eigenaar:</strong> ${escapeHtml(owner)}<br/>
        <strong>Uitvoerders:</strong> ${escapeHtml(assignees)}</p>
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
  openTask(t.id);
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
    document.getElementById("filter-assignee").value = "";
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

  wireUI();
  renderDashboard();
  renderTasks();
}

init();
