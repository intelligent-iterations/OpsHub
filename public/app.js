const el = (id) => document.getElementById(id);

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
  return isNaN(d) ? v : d.toLocaleString();
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

async function moveTask(taskId, to) {
  await fetch('/api/kanban/move', {
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
      <div><strong>${task.name}</strong></div>
      <div class="muted">Priority: ${task.priority}</div>
      <div class="muted">${task.description || 'No description'}</div>
      <div class="muted">Status: ${statusLabel(task.status)}</div>
      <div class="muted">Created: ${ts(task.createdAt)}</div>
      <div class="muted">Completed: ${task.completedAt ? ts(task.completedAt) : '-'}</div>
      ${task.status !== 'done' ? `<button data-id="${task.id}" data-to="${to}" class="move-btn">${moveLabel}</button>` : ''}
    </div>
  `;
}

async function loadKanban() {
  const res = await fetch('/api/kanban');
  const data = await res.json();
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

  renderList('kanbanLog', board.activityLog.slice(0, 50), (x) =>
    `<strong>${x.type}</strong> — ${x.taskName}<br/><span class="muted">${ts(x.at)} • ${x.from || '-'} → ${x.to || '-'} • ${x.detail || ''}</span>`
  );
}

async function addTask() {
  const name = el('taskName').value.trim();
  const description = el('taskDesc').value.trim();
  const priority = el('taskPriority').value;
  if (!name) return;

  await fetch('/api/kanban/task', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description, priority, status: 'backlog', source: 'ui' })
  });

  el('taskName').value = '';
  el('taskDesc').value = '';
  await loadKanban();
}

async function loadDashboard() {
  const res = await fetch('/api/dashboard');
  const data = await res.json();

  el('meta').textContent = `Last updated: ${ts(data.generatedAt)} • Auto-refresh: ${data.refreshSeconds}s`;

  renderList('subagents', data.subagents.items, (x) =>
    `<strong>${x.task}</strong><br/><span class="muted">ID: ${x.id} • Status: ${x.status} • Source: ${x.source}</span>`
  );
  if (data.subagents.reason) {
    el('subagents').innerHTML += `<p class="muted">${data.subagents.reason}</p>`;
  }

  renderList('sessions', data.sessions, (x) =>
    `<strong>${x.summary}</strong><br/><span class="muted">${ts(x.timestamp)} • ${x.source}</span>`
  );

  renderList('errors', data.errors, (x) =>
    `<strong>${x.message}</strong><br/><span class="muted">${ts(x.timestamp)} • ${x.source}</span>`
  );

  const t = data.tokenUsage;
  el('tokens').innerHTML = `
    <div class="item"><strong>Used:</strong> ${t.used.toLocaleString()} tokens</div>
    <div class="item"><strong>Quota:</strong> ${t.quota.toLocaleString()} tokens (${t.quotaPct}% used)</div>
    <div class="item"><strong>Estimated cost:</strong> $${Number(t.estimatedCostUsd || 0).toFixed(2)}</div>
    <p class="muted">${t.reason}</p>
  `;

  renderList('activity', data.activity, (x) =>
    `<strong>${x.action}</strong><br/><span class="muted">${ts(x.timestamp)} • ${x.source}</span>`
  );
}

async function load() {
  try {
    await Promise.all([loadDashboard(), loadKanban()]);
  } catch (err) {
    el('meta').textContent = 'Failed to load OpsHub data';
    console.error(err);
  }
}

el('addTaskBtn').addEventListener('click', addTask);
load();
setInterval(load, 60000);
