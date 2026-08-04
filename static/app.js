const state = {
  tasks: [],
  milestones: [],
  categories: [],
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
function formatWeekRange(startStr, endStr) {
  if (!startStr || !endStr) return "Sem semana definida";
  const start = parseDateStr(startStr);
  const end = parseDateStr(endStr);
  if (start.getMonth() === end.getMonth()) {
    return `${start.getDate()}–${end.getDate()} ${MONTHS_SHORT_PT[start.getMonth()]}`;
  }
  return `${formatShort(start)} – ${formatShort(end)}`;
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
  const [tasks, milestones, categories, stats] = await Promise.all([
    apiGet("/api/tasks"),
    apiGet("/api/milestones"),
    apiGet("/api/categories"),
    apiGet("/api/stats"),
  ]);
  state.tasks = tasks;
  state.milestones = milestones;
  state.categories = categories;
  renderStats(stats);
  renderShelf();
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

function renderShelf() {
  const shelf = document.getElementById("shelf");
  if (!state.categories.length) {
    shelf.innerHTML = '<p class="shelf-empty">Ainda sem categorias — cria a primeira com o botão acima ✨</p>';
    return;
  }
  shelf.innerHTML = state.categories.map(c => {
    const tasksInCat = state.tasks.filter(t => t.category_id === c.id);
    const total = tasksInCat.length;
    const done = tasksInCat.filter(t => t.status === "done").length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    return `
      <div class="shelf-row" data-id="${c.id}">
        <span class="shelf-name">${escapeHtml(c.name)}</span>
        <div class="shelf-track" style="background:${c.bg_color};">
          <div class="shelf-fill" style="width:${pct}%; background:${c.bar_color};"></div>
        </div>
        <span class="shelf-pct">${done}/${total}</span>
        <button class="shelf-edit" data-action="edit-category" title="Editar categoria">✎</button>
      </div>`;
  }).join("");

  shelf.querySelectorAll('[data-action="edit-category"]').forEach(btn => {
    btn.addEventListener("click", () => {
      const id = Number(btn.closest(".shelf-row").dataset.id);
      openCategoryModal(id);
    });
  });
}

function renderCategoryOptions() {
  const taskSelect = document.getElementById("task-category");
  const currentTaskValue = taskSelect.value;
  taskSelect.innerHTML = '<option value="">Sem categoria</option>' +
    state.categories.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
  taskSelect.value = currentTaskValue;

  const filterSelect = document.getElementById("category-filter");
  const currentFilterValue = filterSelect.value;
  filterSelect.innerHTML =
    '<option value="all">Todas as categorias</option>' +
    '<option value="none">Sem categoria</option>' +
    state.categories.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
  filterSelect.value = ["all", "none", ...state.categories.map(c => String(c.id))].includes(currentFilterValue)
    ? currentFilterValue
    : "all";
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
    if (!t.week_start || !t.week_end) return;
    let cursor = parseDateStr(t.week_start);
    const end = parseDateStr(t.week_end);
    while (cursor <= end) {
      const key = toDateStr(cursor);
      (tasksByWeek[key] = tasksByWeek[key] || []).push(t);
      cursor = addDays(cursor, 7);
    }
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
    const taskChips = weekTasks.map(t => {
      const catName = t.category ? t.category.name : "Sem categoria";
      const catBg = t.category ? t.category.badge_bg : "var(--lavender-soft)";
      const catColor = t.category ? t.category.badge_text : "var(--ink-soft)";
      return `
      <div class="week-task-chip priority-${t.priority} ${t.status === 'done' ? 'done' : ''}" data-id="${t.id}">
        <span class="week-task-dot"></span>
        <span class="week-task-title">${escapeHtml(t.title)}</span>
        <span class="week-task-cat" style="background:${catBg}; color:${catColor};">${escapeHtml(catName)}</span>
      </div>`;
    }).join("");

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
  if (state.categoryFilter === "none") {
    tasks = tasks.filter(t => !t.category_id);
  } else if (state.categoryFilter !== "all") {
    tasks = tasks.filter(t => String(t.category_id) === state.categoryFilter);
  }

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
    const catName = t.category ? t.category.name : "Sem categoria";
    const catBg = t.category ? t.category.badge_bg : "var(--lavender-soft)";
    const catColor = t.category ? t.category.badge_text : "var(--ink-soft)";
    return `
    <li class="ledger-row" data-id="${t.id}">
      <button class="status-toggle ${toggleClass}" data-action="toggle" title="Alterar estado">${toggleMark}</button>
      <div class="ledger-main" data-action="edit">
        <div class="ledger-title ${t.status === 'done' ? 'done' : ''}">${escapeHtml(t.title)}</div>
        <div class="ledger-meta">
          <span class="category-tag" style="background:${catBg}; color:${catColor};">${escapeHtml(catName)}</span>
          <span>${STATUS_LABEL[t.status]}</span>
        </div>
      </div>
      <span class="priority-mark ${t.priority}">${priorityLabel(t.priority)}</span>
      <span class="due-date ${overdue ? 'overdue' : ''}">${formatWeekRange(t.week_start, t.week_end)}</span>
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
const weekStartInput = document.getElementById("task-week-start");
const weekEndInput = document.getElementById("task-week-end");
const weekHint = document.getElementById("task-week-hint");

function updateWeekHint() {
  if (!weekStartInput.value && !weekEndInput.value) { weekHint.textContent = ""; return; }
  let s = parseDateStr(weekStartInput.value || weekEndInput.value);
  let e = parseDateStr(weekEndInput.value || weekStartInput.value);
  if (e < s) { [s, e] = [e, s]; }
  const monday = mondayOf(s);
  const sunday = addDays(mondayOf(e), 6);
  const range = formatWeekRange(toDateStr(monday), toDateStr(sunday));
  const spanDays = Math.round((sunday - monday) / (1000 * 60 * 60 * 24));
  weekHint.textContent = spanDays <= 6 ? `Semana de ${range}` : `Semanas de ${range}`;
}
weekStartInput.addEventListener("change", updateWeekHint);
weekEndInput.addEventListener("change", updateWeekHint);

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
    document.getElementById("task-category").value = t.category_id || "";
    weekStartInput.value = t.week_start || "";
    weekEndInput.value = t.week_end || "";
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
    category_id: document.getElementById("task-category").value || null,
    week_start: weekStartInput.value || null,
    week_end: weekEndInput.value || null,
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

// ---------- Category modal ----------

const categoryModal = document.getElementById("category-modal");
const categoryForm = document.getElementById("category-form");
const categoryNameInput = document.getElementById("category-name");
const categoryBgInput = document.getElementById("category-bg");
const categoryBarInput = document.getElementById("category-bar");
const categoryBadgeBgInput = document.getElementById("category-badge-bg");
const categoryBadgeTextInput = document.getElementById("category-badge-text");

function updateCategoryPreview() {
  document.getElementById("category-preview-name").textContent = categoryNameInput.value || "Nome da categoria";
  document.getElementById("category-preview-track").style.background = categoryBgInput.value;
  document.getElementById("category-preview-fill").style.background = categoryBarInput.value;
  const badge = document.getElementById("category-preview-badge");
  badge.textContent = categoryNameInput.value || "Nome da categoria";
  badge.style.background = categoryBadgeBgInput.value;
  badge.style.color = categoryBadgeTextInput.value;
}
categoryNameInput.addEventListener("input", updateCategoryPreview);
categoryBgInput.addEventListener("input", updateCategoryPreview);
categoryBarInput.addEventListener("input", updateCategoryPreview);
categoryBadgeBgInput.addEventListener("input", updateCategoryPreview);
categoryBadgeTextInput.addEventListener("input", updateCategoryPreview);

function openCategoryModal(id) {
  categoryForm.reset();
  const deleteBtn = document.getElementById("delete-category-btn");
  if (id) {
    const c = state.categories.find(c => c.id === id);
    document.getElementById("category-modal-eyebrow").textContent = "Editar categoria 🎨";
    document.getElementById("category-id").value = c.id;
    categoryNameInput.value = c.name;
    categoryBgInput.value = c.bg_color;
    categoryBarInput.value = c.bar_color;
    categoryBadgeBgInput.value = c.badge_bg;
    categoryBadgeTextInput.value = c.badge_text;
    deleteBtn.style.display = "inline-block";
  } else {
    document.getElementById("category-modal-eyebrow").textContent = "Nova categoria 🎨";
    document.getElementById("category-id").value = "";
    categoryBgInput.value = "#ffd6e5";
    categoryBarInput.value = "#ff8fb1";
    categoryBadgeBgInput.value = "#ffd6e5";
    categoryBadgeTextInput.value = "#ff5c8a";
    deleteBtn.style.display = "none";
  }
  updateCategoryPreview();
  categoryModal.style.display = "flex";
  categoryNameInput.focus();
}

function closeCategoryModal() {
  categoryModal.style.display = "none";
}

document.getElementById("new-category-btn").addEventListener("click", () => openCategoryModal(null));
document.getElementById("cancel-category-btn").addEventListener("click", closeCategoryModal);
categoryModal.addEventListener("click", (e) => { if (e.target === categoryModal) closeCategoryModal(); });

document.getElementById("delete-category-btn").addEventListener("click", async () => {
  const id = Number(document.getElementById("category-id").value);
  if (id) {
    if (!confirm("Eliminar esta categoria? As tarefas ficam sem categoria.")) return;
    await apiDelete(`/api/categories/${id}`);
    closeCategoryModal();
    await loadAll();
  }
});

categoryForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("category-id").value;
  const payload = {
    name: categoryNameInput.value,
    bg_color: categoryBgInput.value,
    bar_color: categoryBarInput.value,
    badge_bg: categoryBadgeBgInput.value,
    badge_text: categoryBadgeTextInput.value,
  };
  try {
    if (id) {
      await apiSend(`/api/categories/${id}`, "PUT", payload);
    } else {
      await apiSend("/api/categories", "POST", payload);
    }
    closeCategoryModal();
    await loadAll();
  } catch (err) {
    alert("Não foi possível guardar a categoria (o nome já pode existir).");
  }
});

// ---------- Secret theme panel (easter egg) ----------

const DEFAULT_THEME = {
  bgType: "solid",
  bg: "#fff5fa",
  bgFrom: "#fff5fa",
  bgTo: "#ffd6e5",
  bgDirection: "135deg",
  outline: "#ffd6e5",
  title: "#5b3a56",
};

function computeBgValue(theme) {
  if (theme.bgType === "gradient") {
    if (theme.bgDirection === "radial") {
      return `radial-gradient(circle, ${theme.bgFrom}, ${theme.bgTo})`;
    }
    return `linear-gradient(${theme.bgDirection}, ${theme.bgFrom}, ${theme.bgTo})`;
  }
  return theme.bg;
}

function applyTheme(theme) {
  document.documentElement.style.setProperty("--bg", computeBgValue(theme));
  document.documentElement.style.setProperty("--outline-color", theme.outline);
  document.documentElement.style.setProperty("--title-color", theme.title);
}

function loadSavedTheme() {
  try {
    const saved = JSON.parse(localStorage.getItem("customTheme"));
    if (saved && saved.outline && saved.title) {
      const merged = { ...DEFAULT_THEME, ...saved };
      applyTheme(merged);
      return merged;
    }
  } catch (e) { /* ignore malformed storage */ }
  return { ...DEFAULT_THEME };
}

let currentTheme = loadSavedTheme();

const themeModal = document.getElementById("theme-modal");
const themeBgInput = document.getElementById("theme-bg");
const themeBgFromInput = document.getElementById("theme-bg-from");
const themeBgToInput = document.getElementById("theme-bg-to");
const themeBgDirectionInput = document.getElementById("theme-bg-direction");
const themeOutlineInput = document.getElementById("theme-outline");
const themeTitleInput = document.getElementById("theme-title");
const bgSolidFields = document.getElementById("bg-solid-fields");
const bgGradientFields = document.getElementById("bg-gradient-fields");

function setBgTypeUI(type) {
  document.querySelectorAll("#bg-type-toggle .chip").forEach(c => c.classList.toggle("active", c.dataset.type === type));
  bgSolidFields.style.display = type === "solid" ? "block" : "none";
  bgGradientFields.style.display = type === "gradient" ? "block" : "none";
}

document.getElementById("bg-type-toggle").addEventListener("click", (e) => {
  const btn = e.target.closest(".chip");
  if (!btn) return;
  currentTheme.bgType = btn.dataset.type;
  setBgTypeUI(currentTheme.bgType);
  applyTheme(currentTheme);
  localStorage.setItem("customTheme", JSON.stringify(currentTheme));
});

function openThemeModal() {
  themeBgInput.value = currentTheme.bg;
  themeBgFromInput.value = currentTheme.bgFrom;
  themeBgToInput.value = currentTheme.bgTo;
  themeBgDirectionInput.value = currentTheme.bgDirection;
  themeOutlineInput.value = currentTheme.outline;
  themeTitleInput.value = currentTheme.title;
  setBgTypeUI(currentTheme.bgType);
  themeModal.style.display = "flex";
}

function handleThemeInputChange() {
  currentTheme = {
    ...currentTheme,
    bg: themeBgInput.value,
    bgFrom: themeBgFromInput.value,
    bgTo: themeBgToInput.value,
    bgDirection: themeBgDirectionInput.value,
    outline: themeOutlineInput.value,
    title: themeTitleInput.value,
  };
  applyTheme(currentTheme);
  localStorage.setItem("customTheme", JSON.stringify(currentTheme));
}
[themeBgInput, themeBgFromInput, themeBgToInput, themeBgDirectionInput, themeOutlineInput, themeTitleInput]
  .forEach(input => input.addEventListener("input", handleThemeInputChange));

document.getElementById("theme-reset-btn").addEventListener("click", () => {
  currentTheme = { ...DEFAULT_THEME };
  applyTheme(currentTheme);
  localStorage.removeItem("customTheme");
  themeBgInput.value = currentTheme.bg;
  themeBgFromInput.value = currentTheme.bgFrom;
  themeBgToInput.value = currentTheme.bgTo;
  themeBgDirectionInput.value = currentTheme.bgDirection;
  themeOutlineInput.value = currentTheme.outline;
  themeTitleInput.value = currentTheme.title;
  setBgTypeUI(currentTheme.bgType);
});

document.getElementById("theme-close-btn").addEventListener("click", () => {
  themeModal.style.display = "none";
});
themeModal.addEventListener("click", (e) => { if (e.target === themeModal) themeModal.style.display = "none"; });

// 5 clicks on the header sparkle line within 2.5s unlocks the secret panel
let eggClicks = 0;
let eggTimer = null;
document.getElementById("egg-trigger").addEventListener("click", () => {
  eggClicks++;
  clearTimeout(eggTimer);
  eggTimer = setTimeout(() => { eggClicks = 0; }, 2500);
  if (eggClicks >= 5) {
    eggClicks = 0;
    openThemeModal();
  }
});

// ---------- Motivational quote slideshow ----------

const QUOTES = [
  "A persistência é o caminho do êxito.",
  "Um capítulo de cada vez — a tese não se escreve num dia.",
  "Feito é melhor que perfeito.",
  "Cada página escrita é um passo mais perto da entrega.",
  "O trabalho duro de hoje é o diploma de amanhã.",
  "Não desistas a meio do caminho — já vieste tão longe.",
  "A tua tese não te define, mas a tua persistência sim.",
  "Pequenos progressos diários somam-se a grandes conquistas.",
  "Respira, organiza, escreve. Um passo de cada vez.",
  "O orientador não morde — e tu és mais capaz do que pensas.",
  "A revisão de hoje poupa dores de cabeça amanhã.",
  "Vais conseguir. A tese não te vai vencer.",
];

let quoteIndex = 0;
let quoteTimer = null;

function renderQuoteDots() {
  const dots = document.getElementById("quote-dots");
  dots.innerHTML = QUOTES.map((_, i) =>
    `<button class="quote-dot ${i === quoteIndex ? 'active' : ''}" data-index="${i}" aria-label="Frase ${i + 1}"></button>`
  ).join("");
  dots.querySelectorAll(".quote-dot").forEach(dot => {
    dot.addEventListener("click", () => {
      showQuote(Number(dot.dataset.index));
      restartQuoteTimer();
    });
  });
}

function showQuote(index) {
  quoteIndex = (index + QUOTES.length) % QUOTES.length;
  const el = document.getElementById("quote-text");
  el.classList.add("fading");
  setTimeout(() => {
    el.textContent = `"${QUOTES[quoteIndex]}"`;
    el.classList.remove("fading");
  }, 350);
  renderQuoteDots();
}

function restartQuoteTimer() {
  if (quoteTimer) clearInterval(quoteTimer);
  quoteTimer = setInterval(() => showQuote(quoteIndex + 1), 7000);
}

document.getElementById("quote-prev").addEventListener("click", () => {
  showQuote(quoteIndex - 1);
  restartQuoteTimer();
});
document.getElementById("quote-next").addEventListener("click", () => {
  showQuote(quoteIndex + 1);
  restartQuoteTimer();
});

showQuote(0);
restartQuoteTimer();

// ---------- Pomodoro ----------

const RING_CIRCUMFERENCE = 327;

const pomo = {
  workMin: 20,
  breakMin: 5,
  phase: "setup", // "setup" | "work" | "work-done" | "break" | "break-done"
  remainingSeconds: 20 * 60,
  running: false,
  round: 1,
  intervalId: null,
};

const pomoWorkDisplay = document.getElementById("pomo-work-display");
const pomoBreakDisplay = document.getElementById("pomo-break-display");
const pomoWorkAddBtn = document.getElementById("pomo-work-add");
const pomoBreakAddBtn = document.getElementById("pomo-break-add");
const pomoTimeEl = document.getElementById("pomo-time");
const pomoPhaseEl = document.getElementById("pomo-phase");
const pomoRoundLabelEl = document.getElementById("pomo-round-label");
const pomoNoticeEl = document.getElementById("pomo-notice");
const pomoNoticeTextEl = document.getElementById("pomo-notice-text");
const pomoNoticeBtn = document.getElementById("pomo-notice-btn");
const pomoRingProgress = document.getElementById("pomo-ring-progress");
const pomoStartBtn = document.getElementById("pomo-start-btn");
const pomoPauseBtn = document.getElementById("pomo-pause-btn");
const pomoResetBtn = document.getElementById("pomo-reset-btn");
const otterPool = document.getElementById("otter-pool");

function formatMMSS(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function phaseTotalSeconds() {
  const min = pomo.phase === "break" ? pomo.breakMin : pomo.workMin;
  return min * 60;
}

function renderPomodoro() {
  pomoWorkDisplay.textContent = `${pomo.workMin} min`;
  pomoBreakDisplay.textContent = `${pomo.breakMin} min`;

  const adjustDisabled = pomo.running;
  pomoWorkAddBtn.disabled = adjustDisabled;
  pomoBreakAddBtn.disabled = adjustDisabled;

  pomoTimeEl.textContent = formatMMSS(pomo.remainingSeconds);

  const phaseLabels = {
    setup: "Pronta?",
    work: "🧠 Foco",
    "work-done": "⏰ Trabalho concluído",
    break: "☕ Intervalo",
    "break-done": "🎉 Intervalo concluído",
  };
  pomoPhaseEl.textContent = phaseLabels[pomo.phase];

  const total = phaseTotalSeconds();
  const fraction = total ? pomo.remainingSeconds / total : 0;
  pomoRingProgress.style.strokeDashoffset = RING_CIRCUMFERENCE * (1 - fraction);
  pomoRingProgress.style.stroke = pomo.phase === "break" ? "var(--mint)" : "var(--pink-deep)";

  otterPool.classList.toggle("resting", !(pomo.phase === "work" && pomo.running));

  pomoRoundLabelEl.style.display = (pomo.phase === "work" || pomo.phase === "break") ? "block" : "none";
  pomoRoundLabelEl.textContent = `Ronda ${pomo.round}`;

  if (pomo.phase === "work-done" || pomo.phase === "break-done") {
    pomoNoticeEl.style.display = "flex";
    if (pomo.phase === "work-done") {
      pomoNoticeTextEl.textContent = "⏰ Acabou o período de trabalho!";
      pomoNoticeBtn.textContent = "☕ Começar intervalo";
    } else {
      pomoNoticeTextEl.textContent = "☕ Acabou o período de intervalo!";
      pomoNoticeBtn.textContent = "🧠 Começar período de trabalho";
    }
  } else {
    pomoNoticeEl.style.display = "none";
  }

  pomoStartBtn.style.display = pomo.phase === "setup" ? "inline-block" : "none";
  pomoPauseBtn.style.display = (pomo.phase === "work" || pomo.phase === "break") ? "inline-block" : "none";
  pomoPauseBtn.textContent = pomo.running ? "⏸ Pausar" : "▶ Continuar";
}

function tickPomodoro() {
  pomo.remainingSeconds--;
  if (pomo.remainingSeconds <= 0) {
    pomo.remainingSeconds = 0;
    clearInterval(pomo.intervalId);
    pomo.running = false;
    if (pomo.phase === "work") {
      pomo.phase = "work-done";
    } else if (pomo.phase === "break") {
      pomo.phase = "break-done";
    }
  }
  renderPomodoro();
}

function beginWork() {
  pomo.phase = "work";
  pomo.remainingSeconds = pomo.workMin * 60;
  pomo.running = true;
  pomo.intervalId = setInterval(tickPomodoro, 1000);
  renderPomodoro();
}

function beginBreak() {
  pomo.phase = "break";
  pomo.remainingSeconds = pomo.breakMin * 60;
  pomo.running = true;
  pomo.intervalId = setInterval(tickPomodoro, 1000);
  renderPomodoro();
}

function togglePause() {
  if (pomo.running) {
    pomo.running = false;
    clearInterval(pomo.intervalId);
  } else {
    pomo.running = true;
    pomo.intervalId = setInterval(tickPomodoro, 1000);
  }
  renderPomodoro();
}

function resetPomodoro() {
  clearInterval(pomo.intervalId);
  pomo.workMin = 20;
  pomo.breakMin = 5;
  pomo.phase = "setup";
  pomo.remainingSeconds = pomo.workMin * 60;
  pomo.running = false;
  pomo.round = 1;
  renderPomodoro();
}

pomoWorkAddBtn.addEventListener("click", () => {
  pomo.workMin += 5;
  if (pomo.phase === "setup") pomo.remainingSeconds = pomo.workMin * 60;
  renderPomodoro();
});
pomoBreakAddBtn.addEventListener("click", () => {
  pomo.breakMin += 1;
  renderPomodoro();
});

pomoStartBtn.addEventListener("click", beginWork);
pomoPauseBtn.addEventListener("click", togglePause);
pomoResetBtn.addEventListener("click", resetPomodoro);
pomoNoticeBtn.addEventListener("click", () => {
  if (pomo.phase === "work-done") {
    beginBreak();
  } else if (pomo.phase === "break-done") {
    pomo.round++;
    beginWork();
  }
});

renderPomodoro();

// ---------- Init ----------

loadAll().catch(err => console.error(err));
