const state = {
  tasks: [],
  statusFilter: "all",
  categoryFilter: "all",
  dateFilter: null, // "YYYY-MM-DD"
  calYear: new Date().getFullYear(),
  calMonth: new Date().getMonth(), // 0-indexed
};

const MONTHS_PT = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
const STATUS_LABEL = { todo: "A fazer", doing: "Em curso", done: "Concluída" };

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
  const [tasks, stats] = await Promise.all([apiGet("/api/tasks"), apiGet("/api/stats")]);
  state.tasks = tasks;
  renderStats(stats);
  renderShelf(stats.by_category);
  renderCategoryOptions();
  renderCalendar();
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
    shelf.innerHTML = '<p class="shelf-empty">Ainda sem categorias — adicione uma tarefa para começar o cronograma.</p>';
    return;
  }
  const colors = ["#7a2e33", "#b9861f", "#55684a", "#3d5a80", "#8a4f7d", "#6b7280"];
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

// ---------- Calendar ----------

function renderCalendar() {
  const { calYear, calMonth } = state;
  document.getElementById("cal-month").textContent = `${MONTHS_PT[calMonth]} ${calYear}`;

  const firstDay = new Date(calYear, calMonth, 1);
  const startWeekday = firstDay.getDay(); // 0 = Sunday
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const daysInPrevMonth = new Date(calYear, calMonth, 0).getDate();

  const todayStr = toDateStr(new Date());

  const tasksByDate = {};
  state.tasks.forEach(t => {
    if (!t.due_date) return;
    (tasksByDate[t.due_date] = tasksByDate[t.due_date] || []).push(t);
  });

  const cells = [];

  for (let i = startWeekday - 1; i >= 0; i--) {
    cells.push({ day: daysInPrevMonth - i, muted: true });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = toDateStr(new Date(calYear, calMonth, d));
    cells.push({ day: d, muted: false, dateStr, tasks: tasksByDate[dateStr] || [] });
  }
  while (cells.length % 7 !== 0) {
    cells.push({ day: cells.length, muted: true });
  }

  const grid = document.getElementById("cal-grid");
  grid.innerHTML = cells.map(c => {
    if (c.muted) return `<div class="cal-day muted">${c.day}</div>`;
    const classes = ["cal-day"];
    if (c.dateStr === todayStr) classes.push("today");
    if (c.dateStr === state.dateFilter) classes.push("selected");
    const dots = c.tasks.slice(0, 4).map(t => `<span class="dot p-${t.priority}"></span>`).join("");
    return `<div class="${classes.join(' ')}" data-date="${c.dateStr}">
      <span>${c.day}</span>
      <span class="dots">${dots}</span>
    </div>`;
  }).join("");

  grid.querySelectorAll(".cal-day:not(.muted)").forEach(el => {
    el.addEventListener("click", () => {
      const date = el.dataset.date;
      state.dateFilter = state.dateFilter === date ? null : date;
      document.getElementById("cal-clear").style.display = state.dateFilter ? "inline-block" : "none";
      renderCalendar();
      renderLedger();
    });
  });
}

function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
document.getElementById("cal-clear").addEventListener("click", () => {
  state.dateFilter = null;
  document.getElementById("cal-clear").style.display = "none";
  renderCalendar();
  renderLedger();
});

// ---------- Ledger ----------

function renderLedger() {
  let tasks = [...state.tasks];

  if (state.statusFilter !== "all") tasks = tasks.filter(t => t.status === state.statusFilter);
  if (state.categoryFilter !== "all") tasks = tasks.filter(t => (t.category || "Geral") === state.categoryFilter);
  if (state.dateFilter) tasks = tasks.filter(t => t.due_date === state.dateFilter);

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
    const overdue = t.due_date && t.due_date < todayStr && t.status !== "done";
    const toggleClass = t.status === "done" ? "done" : t.status === "doing" ? "doing" : "";
    const toggleMark = t.status === "done" ? "✓" : "";
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
      <span class="due-date ${overdue ? 'overdue' : ''}">${formatDate(t.due_date)}</span>
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
  return { low: "Baixa", medium: "Média", high: "Alta" }[p] || p;
}
function formatDate(dateStr) {
  if (!dateStr) return "—";
  const [y, m, d] = dateStr.split("-");
  return `${d}/${m}`;
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

function openModal(id) {
  form.reset();
  const deleteBtn = document.getElementById("delete-task-btn");
  if (id) {
    const t = state.tasks.find(t => t.id === id);
    document.getElementById("modal-eyebrow").textContent = "Editar tarefa";
    document.getElementById("task-id").value = t.id;
    document.getElementById("task-title").value = t.title;
    document.getElementById("task-notes").value = t.notes;
    document.getElementById("task-category").value = t.category;
    document.getElementById("task-due").value = t.due_date || "";
    document.getElementById("task-priority").value = t.priority;
    document.getElementById("task-status").value = t.status;
    deleteBtn.style.display = "inline-block";
  } else {
    document.getElementById("modal-eyebrow").textContent = "Nova tarefa";
    document.getElementById("task-id").value = "";
    if (state.dateFilter) document.getElementById("task-due").value = state.dateFilter;
    deleteBtn.style.display = "none";
  }
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
    due_date: document.getElementById("task-due").value || null,
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
