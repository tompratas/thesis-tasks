const state = {
  tasks: [],
  milestones: [],
  statusFilter: "all",
  categoryFilter: "all",
  calYear: new Date().getFullYear(),
  calMonth: new Date().getMonth(), // 0-indexed
};

const MONTHS_PT = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
const MONTHS_SHORT_PT = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
const STATUS_LABEL = { todo: "A fazer", doing: "Em curso", done: "Concluída" };

// ---------- Date helpers ----------

function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function parseDateStr(str) {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
}
// Monday-based week start, matching the backend's week_monday()
function mondayOf(d) {
  const day = (d.getDay() + 6) % 7; // 0 = Monday ... 6 = Sunday
  const monday = new Date(d);
  monday.setDate(d.getDate() - day);
  return monday;
}
function addDays(d, n) {
  const nd = new Date(d);
  nd.setDate(d.getDate() + n);
  return nd;
}
function formatShort(d) {
  return `${d.getDate()} ${MONTHS_SHORT_PT[d.getMonth()]}`;
}
function formatWeekRange(mondayStr) {
  if (!mondayStr) return "Sem semana definida";
  const monday = parseDateStr(mondayStr);
  const sunday = addDays(monday, 6);
  if (monday.getMonth() === sunday.getMonth()) {
    return `${monday.getDate()}–${sunday.getDate()} ${MONTHS_SHORT_PT[monday.getMonth()]}`;
  }
  return `${formatShort(monday)} – ${formatShort(sunday)}`;
}

// ---------- API helpers ----------

async function apiGet(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Falha ao obter dados");
  return res.json();
}
async function apiSend(url, method, body) {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("Falha ao guardar");
  return res.json();
}
async function apiDelete(url) {
  const res = await fetch(url, { method: "DELETE" });
  if (!res.ok) throw new Error("Falha ao eliminar");
  return res.json();
}

// ---------- Load & render ----------

async function loadAll() {
  const [tasks, milestones, stats] = await Promise.all([
    apiGet("/api/tasks"),
    apiGet("/api/milestones"),
    apiGet("/api/stats"),
  ]);
  state.tasks = tasks;
  state.milestones = milestones;
  renderStats(stats);
  renderShelf(stats.by_category);
  renderCategoryOptions();
  renderCalendar();
  renderMilestoneList();
  renderLedger();
}

function renderStats(stats) {
  document.getElementById("stat-total").textContent = stats.total;
  document.getElementById("stat-overdue").textContent = stats.overdue;
  document.getElementById("ring-percent").textContent = stats.percent + "%";
  const circumference = 327;
  const offset = circumference - (circumference * stats.percent) / 100;
  document.getElementById("ring-progress").style.strokeDashoffset = offset;
}

function renderShelf(byCategory) {
  const shelf = document.getElementById("shelf");
  const entries = Object.entries(byCategory || {});
  if (!entries.length) {
    shelf.innerHTML = '<p class="shelf-empty">Ainda sem categorias — adiciona uma tarefa para começar o cronograma.</p>';
    return;
  }
  const colors = ["#ff8fb1", "#b9a3e3", "#6fd9b3", "#f6b93b", "#ff6f7d", "#8fc9e0"];
  shelf.innerHTML = entries.map(([name, d], i) => {
    const pct = d.total ? Math.round((d.done / d.total) * 100) : 0;
    const color = colors[i % colors.length];
    return `
      <div class="shelf-row">
        <span class="shelf-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
        <div class="shelf-track">
          <div class="shelf-fill" style="width:${pct}%; background:${color};"></div>
        </div>
        <span class="shelf-pct">${d.done}/${d.total}</span>
      </div>`;
  }).join("");
}

function renderCategoryOptions() {
  const categories = [...new Set(state.tasks.map(t => t.category || "Geral"))].sort();
  const select = document.getElementById("category-filter");
  const current = select.value;
  select.innerHTML = '<option value="all">Todas as categorias</option>' +
    categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  select.value = categories.includes(current) ? current : "all";

  const datalist = document.getElementById("category-suggestions");
  datalist.innerHTML = categories.map(c => `<option value="${escapeHtml(c)}">`).join("");
}

// ---------- Calendar (week-row agenda view) ----------

function renderCalendar() {
  const { calYear, calMonth } = state;
  document.getElementById("cal-month").textContent = `${MONTHS_PT[calMonth]} ${calYear}`;

  const firstOfMonth = new Date(calYear, calMonth, 1);
  const lastOfMonth = new Date(calYear, calMonth + 1, 0);

  const gridStart = mondayOf(firstOfMonth);
  // Extend to the Sunday that ends the last week touching this month
  const lastWeekMonday = mondayOf(lastOfMonth);
  const gridEnd = addDays(lastWeekMonday, 6);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = toDateStr(today);
  const thisWeekMondayStr = toDateStr(mondayOf(today));

  const tasksByWeek = {};
  state.tasks.forEach(t => {
    if (!t.week_start) return;
    (tasksByWeek[t.week_start] = tasksByWeek[t.week_start] || []).push(t);
  });
  const milestonesByDate = {};
  state.milestones.forEach(m => {
    (milestonesByDate[m.date] = milestonesByDate[m.date] || []).push(m);
  });

  const weeks = [];
  let cursor = new Date(gridStart);
  while (cursor <= gridEnd) {
    const weekMonday = new Date(cursor);
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(weekMonday, i);
      days.push({
        date: d,
        dateStr: toDateStr(d),
        muted: d.getMonth() !== calMonth,
      });
    }
    weeks.push({ mondayStr: toDateStr(weekMonday), days });
    cursor = addDays(cursor, 7);
  }

  const container = document.getElementById("cal-weeks");
  container.innerHTML = weeks.map(week => {
    const isCurrentWeek = week.mondayStr === thisWeekMondayStr;
    const dayCells = week.days.map(day => {
      const classes = ["week-day-cell"];
      if (day.muted) classes.push("muted");
      if (day.dateStr === todayStr) classes.push("today");
      const dayMilestones = milestonesByDate[day.dateStr] || [];
      const milestoneBadge = dayMilestones.map(m =>
        `<span class="milestone-badge" title="${escapeHtml(m.title)}">🎓 ${escapeHtml(m.title)}</span>`
      ).join("");
      return `<div class="${classes.join(' ')}">
        <span class="week-day-num">${day.date.getDate()}</span>
        ${milestoneBadge}
      </div>`;
    }).join("");

    const weekTasks = tasksByWeek[week.mondayStr] || [];
    const taskChips = weekTasks.map(t => `
      <div class="week-task-chip priority-${t.priority} ${t.status === 'done' ? 'done' : ''}" data-id="${t.id}">
        <span class="week-task-dot"></span>
        <span class="week-task-title">${escapeHtml(t.title)}</span>
        <span class="week-task-cat">${escapeHtml(t.category || 'Geral')}</span>
      </div>`).join("");

    return `<div class="week-block ${isCurrentWeek ? 'current-week' : ''}">
      <div class="week-days">${dayCells}</div>
      <div class="week-tasks">${taskChips}</div>
    </div>`;
  }).join("");

  container.querySelectorAll(".week-task-chip").forEach(chip => {
    chip.addEventListener("click", () => openModal(Number(chip.dataset.id)));
  });
}

document.getElementById("cal-prev").addEventListener("click", () => {
  state.calMonth--;
  if (state.calMonth < 0) { state.calMonth = 11; state.calYear--; }
  renderCalendar();
});
document.getElementById("cal-next").addEventListener("click", () => {
  state.calMonth++;
  if (state.calMonth > 11) { state.calMonth = 0; state.calYear++; }
  renderCalendar();
});
document.getElementById("cal-today").addEventListener("click", () => {
  const now = new Date();
  state.calYear = now.getFullYear();
  state.calMonth = now.getMonth();
  renderCalendar();
});

// Keep "hoje" / current-week highlight accurate even if the tab stays open across midnight
setInterval(renderCalendar, 15 * 60 * 1000);

// ---------- Milestones ----------

function renderMilestoneList() {
  const list = document.getElementById("milestone-list");
  if (!state.milestones.length) {
    list.innerHTML = '<p class="milestone-empty">Sem marcos ainda.</p>';
    return;
  }
  const sorted = [...state.milestones].sort((a, b) => a.date.localeCompare(b.date));
  list.innerHTML = sorted.map(m => `
    <div class="milestone-item" data-id="${m.id}">
      <span>🎓 <strong>${escapeHtml(m.title)}</strong> — ${formatShort(parseDateStr(m.date))}</span>
      <button class="milestone-delete" data-action="delete-milestone" title="Eliminar marco">✕</button>
    </div>`).join("");

  list.querySelectorAll('[data-action="delete-milestone"]').forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const id = Number(e.target.closest(".milestone-item").dataset.id);
      if (!confirm("Eliminar este marco?")) return;
      await apiDelete(`/api/milestones/${id}`);
      await loadAll();
    });
  });
}

document.getElementById("milestone-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = document.getElementById("milestone-title-input").value.trim();
  const dateVal = document.getElementById("milestone-date-input").value;
  if (!title || !dateVal) return;
  await apiSend("/api/milestones", "POST", { title, date: dateVal });
  document.getElementById("milestone-form").reset();
  await loadAll();
});

// ---------- Ledger ----------

function renderLedger() {
  let tasks = [...state.tasks];

  if (state.statusFilter !== "all") tasks = tasks.filter(t => t.status === state.statusFilter);
  if (state.categoryFilter !== "all") tasks = tasks.filter(t => (t.category || "Geral") === state.categoryFilter);

  const list = document.getElementById("task-list");
  const empty = document.getElementById("empty-state");

  if (!tasks.length) {
    list.innerHTML = "";
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";

  const todayStr = toDateStr(new Date());

  list.innerHTML = tasks.map(t => {
    const overdue = t.week_end && t.week_end < todayStr && t.status !== "done";
    const toggleClass = t.status === "done" ? "done" : t.status === "doing" ? "doing" : "";
    const toggleMark = t.status === "done" ? "💗" : "";
    return `
    <li class="ledger-row" data-id="${t.id}">
      <button class="status-toggle ${toggleClass}" data-action="toggle" title="Alterar estado">${toggleMark}</button>
      <div class="ledger-main" data-action="edit">
        <div class="ledger-title ${t.status === 'done' ? 'done' : ''}">${escapeHtml(t.title)}</div>
        <div class="ledger-meta">
          <span class="category-tag">${escapeHtml(t.category || "Geral")}</span>
          <span>${STATUS_LABEL[t.status]}</span>
        </div>
      </div>
      <span class="priority-mark ${t.priority}">${priorityLabel(t.priority)}</span>
      <span class="due-date ${overdue ? 'overdue' : ''}">${formatWeekRange(t.week_start)}</span>
      <button class="ledger-delete" data-action="delete" title="Eliminar">✕</button>
    </li>`;
  }).join("");

  list.querySelectorAll(".ledger-row").forEach(row => {
    const id = Number(row.dataset.id);
    row.querySelector('[data-action="toggle"]').addEventListener("click", (e) => {
      e.stopPropagation();
      cycleStatus(id);
    });
    row.querySelector('[data-action="delete"]').addEventListener("click", (e) => {
      e.stopPropagation();
      removeTask(id);
    });
    row.querySelector('[data-action="edit"]').addEventListener("click", () => openModal(id));
  });
}

function priorityLabel(p) {
  return { low: "🌱 Baixa", medium: "⭐ Média", high: "💖 Alta" }[p] || p;
}
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

async function cycleStatus(id) {
  const task = state.tasks.find(t => t.id === id);
  const order = ["todo", "doing", "done"];
  const next = order[(order.indexOf(task.status) + 1) % order.length];
  await apiSend(`/api/tasks/${id}`, "PUT", { status: next });
  await loadAll();
}

async function removeTask(id) {
  if (!confirm("Eliminar esta tarefa?")) return;
  await apiDelete(`/api/tasks/${id}`);
  await loadAll();
}

// ---------- Filters ----------

document.getElementById("status-filters").addEventListener("click", (e) => {
  const btn = e.target.closest(".chip");
  if (!btn) return;
  document.querySelectorAll("#status-filters .chip").forEach(c => c.classList.remove("active"));
  btn.classList.add("active");
  state.statusFilter = btn.dataset.status;
  renderLedger();
});

document.getElementById("category-filter").addEventListener("change", (e) => {
  state.categoryFilter = e.target.value;
  renderLedger();
});

// ---------- Modal ----------

const modal = document.getElementById("task-modal");
const form = document.getElementById("task-form");
const weekInput = document.getElementById("task-week");
const weekHint = document.getElementById("task-week-hint");

function updateWeekHint() {
  if (!weekInput.value) { weekHint.textContent = ""; return; }
  const d = parseDateStr(weekInput.value);
  const monday = mondayOf(d);
  weekHint.textContent = `Semana de ${formatWeekRange(toDateStr(monday))}`;
}
weekInput.addEventListener("change", updateWeekHint);

function openModal(id) {
  form.reset();
  weekHint.textContent = "";
  const deleteBtn = document.getElementById("delete-task-btn");
  if (id) {
    const t = state.tasks.find(t => t.id === id);
    document.getElementById("modal-eyebrow").textContent = "Editar tarefa 💕";
    document.getElementById("task-id").value = t.id;
    document.getElementById("task-title").value = t.title;
    document.getElementById("task-notes").value = t.notes;
    document.getElementById("task-category").value = t.category;
    weekInput.value = t.week_start || "";
    document.getElementById("task-priority").value = t.priority;
    document.getElementById("task-status").value = t.status;
    deleteBtn.style.display = "inline-block";
  } else {
    document.getElementById("modal-eyebrow").textContent = "Nova tarefa ✨";
    document.getElementById("task-id").value = "";
    deleteBtn.style.display = "none";
  }
  updateWeekHint();
  modal.style.display = "flex";
  document.getElementById("task-title").focus();
}

function closeModal() {
  modal.style.display = "none";
}

document.getElementById("new-task-btn").addEventListener("click", () => openModal(null));
document.getElementById("cancel-task-btn").addEventListener("click", closeModal);
modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });

document.getElementById("delete-task-btn").addEventListener("click", async () => {
  const id = Number(document.getElementById("task-id").value);
  if (id) await removeTask(id);
  closeModal();
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("task-id").value;
  const payload = {
    title: document.getElementById("task-title").value,
    notes: document.getElementById("task-notes").value,
    category: document.getElementById("task-category").value || "Geral",
    week_start: weekInput.value || null,
    priority: document.getElementById("task-priority").value,
    status: document.getElementById("task-status").value,
  };
  if (id) {
    await apiSend(`/api/tasks/${id}`, "PUT", payload);
  } else {
    await apiSend("/api/tasks", "POST", payload);
  }
  closeModal();
  await loadAll();
});

// ---------- Thesis title persistence (local only, simple) ----------

const titleEl = document.getElementById("thesis-title");
titleEl.textContent = localStorage.getItem("thesisTitle") || "";
titleEl.addEventListener("blur", () => {
  localStorage.setItem("thesisTitle", titleEl.textContent.trim());
});

// ---------- Init ----------

loadAll().catch(err => console.error(err));
