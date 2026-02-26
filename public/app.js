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

async function load() {
  try {
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
  } catch (err) {
    el('meta').textContent = 'Failed to load dashboard data';
    console.error(err);
  }
}

load();
setInterval(load, 60000);
