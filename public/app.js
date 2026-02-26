const el = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderList(containerId, items, formatter) {
  const container = el(containerId);
  if (!items || !items.length) {
    container.innerHTML = '<p class="muted">No items available.</p>';
    return;
  }
  container.innerHTML = `<div class="list">${items.map((x) => `<div class="item">${formatter(x)}</div>`).join('')}</div>`;
}

function ts(v) {
  const d = new Date(v);
  return isNaN(d) ? escapeHtml(v) : d.toLocaleString();
}

function statusLabel(status) {
  return {
    backlog: 'Backlog',
    todo: 'To Do',
    inProgress: 'In Progress',
    done: 'Done'
  }[status] || status;
}

function nextStatus(current) {
  if (current === 'backlog') return 'todo';
  if (current === 'todo') return 'inProgress';
  if (current === 'inProgress') return 'done';
  return 'done';
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    let reason = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error) reason = body.error;
    } catch {
      // ignore parse errors for non-json responses
    }
    throw new Error(reason);
  }
  return res.json();
}

async function moveTask(taskId, to) {
  await fetchJson('/api/kanban/move', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId, to })
  });
  await loadKanban();
}

function taskCard(task) {
  const to = nextStatus(task.status);
  const moveLabel = task.status === 'done' ? 'Done' : `Move to ${statusLabel(to)}`;
  return `
    <div class="task-card">
      <div><strong>${escapeHtml(task.name)}</strong></div>
      <div class="muted">Priority: ${escapeHtml(task.priority)}</div>
      <div class="muted">${escapeHtml(task.description || 'No description')}</div>
      <div class="muted">Status: ${escapeHtml(statusLabel(task.status))}</div>
      <div class="muted">Created: ${ts(task.createdAt)}</div>
      <div class="muted">Completed: ${task.completedAt ? ts(task.completedAt) : '-'}</div>
      ${task.status !== 'done' ? `<button data-id="${escapeHtml(task.id)}" data-to="${escapeHtml(to)}" class="move-btn">${escapeHtml(moveLabel)}</button>` : ''}
    </div>
  `;
}

async function loadKanban() {
  const data = await fetchJson('/api/kanban');
  const board = data.board;

  const cols = [
    ['backlog', 'Backlog'],
    ['todo', 'To Do'],
    ['inProgress', 'In Progress'],
    ['done', 'Done']
  ];

  const html = cols
    .map(([key, label]) => {
      const items = board.columns[key] || [];
      return `
        <div class="kanban-col">
          <h3>${label} (${items.length})</h3>
          ${items.length ? items.map(taskCard).join('') : '<p class="muted">No tasks</p>'}
        </div>
      `;
    })
    .join('');

  el('kanbanGrid').innerHTML = html;

  const btns = document.querySelectorAll('.move-btn');
  btns.forEach((btn) => {
    btn.addEventListener('click', async () => moveTask(btn.dataset.id, btn.dataset.to));
  });

  renderList(
    'kanbanLog',
    (board.activityLog || []).slice(0, 50),
    (x) =>
      `<strong>${escapeHtml(x.type)}</strong> — ${escapeHtml(x.taskName)}<br/><span class="muted">${ts(x.at)} • ${escapeHtml(x.from || '-')} → ${escapeHtml(x.to || '-')} • ${escapeHtml(x.detail || '')}</span>`
  );
}

async function addTask() {
  const name = el('taskName').value.trim();
  const description = el('taskDesc').value.trim();
  const priority = el('taskPriority').value;
  if (!name) return;

  await fetchJson('/api/kanban/task', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description, priority, status: 'backlog', source: 'ui' })
  });

  el('taskName').value = '';
  el('taskDesc').value = '';
  await loadKanban();
}

async function loadDashboard() {
  const data = await fetchJson('/api/dashboard');

  el('meta').textContent = `Last updated: ${ts(data.generatedAt)} • Auto-refresh: ${data.refreshSeconds}s`;

  renderList('subagents', data.subagents.items, (x) =>
    `<strong>${escapeHtml(x.task)}</strong><br/><span class="muted">ID: ${escapeHtml(x.id)} • Status: ${escapeHtml(x.status)} • Source: ${escapeHtml(x.source)}</span>`
  );
  if (data.subagents.reason) {
    el('subagents').innerHTML += `<p class="muted">${escapeHtml(data.subagents.reason)}</p>`;
  }

  renderList('sessions', data.sessions, (x) =>
    `<strong>${escapeHtml(x.summary)}</strong><br/><span class="muted">${ts(x.timestamp)} • ${escapeHtml(x.source)}</span>`
  );

  renderList('errors', data.errors, (x) =>
    `<strong>${escapeHtml(x.message)}</strong><br/><span class="muted">${ts(x.timestamp)} • ${escapeHtml(x.source)}</span>`
  );

  const t = data.tokenUsage;
  el('tokens').innerHTML = `
    <div class="item"><strong>Used:</strong> ${Number(t.used || 0).toLocaleString()} tokens</div>
    <div class="item"><strong>Quota:</strong> ${Number(t.quota || 0).toLocaleString()} tokens (${Number(t.quotaPct || 0)}% used)</div>
    <div class="item"><strong>Estimated cost:</strong> $${Number(t.estimatedCostUsd || 0).toFixed(2)}</div>
    <p class="muted">${escapeHtml(t.reason || '')}</p>
  `;

  renderList('activity', data.activity, (x) =>
    `<strong>${escapeHtml(x.action)}</strong><br/><span class="muted">${ts(x.timestamp)} • ${escapeHtml(x.source)}</span>`
  );
}

async function load() {
  try {
    await Promise.all([loadDashboard(), loadKanban()]);
  } catch (err) {
    el('meta').textContent = `Failed to load OpsHub data: ${err.message}`;
    console.error(err);
  }
}

el('addTaskBtn').addEventListener('click', addTask);
el('taskName').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addTask();
});

load();
setInterval(load, 60000);
