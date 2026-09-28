const toastArea = document.querySelector('#toast-area');
let socket;
function toast(message, type = '') { const el = document.createElement('div'); el.className = `toast ${type}`; el.textContent = message; toastArea.append(el); setTimeout(() => el.remove(), 2600); }
function timeLabel(iso) { return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)); }
async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) { lockPanel(); throw new Error(data.error || 'Panel locked.'); }
  if (!response.ok) throw new Error(data.error || 'Action could not be completed.');
  return data;
}
function button(label, cls, action, disabled = false) { const b = document.createElement('button'); b.className = `icon-button ${cls || ''}`; b.textContent = label; b.title = action.title; b.setAttribute('aria-label', action.title); b.disabled = disabled; b.addEventListener('click', action.run); return b; }
async function perform(url, label) { try { await api(url, { method: 'POST' }); toast(label); } catch (e) { toast(e.message, 'error'); } }
function render(data) {
  const players = data.players || []; const current = players[0];
  document.querySelector('#mod-current').textContent = current ? `@${current.username}` : 'Queue is open';
  document.querySelector('#mod-current-time').textContent = current ? `Joined ${timeLabel(current.joinedAt)}` : 'Waiting for someone to join';
  document.querySelector('#finish-button').disabled = !current; document.querySelector('#rotate-button').disabled = players.length < 2;
  const waiting = players.slice(1); document.querySelector('#mod-count').textContent = `${waiting.length} waiting`;
  const list = document.querySelector('#mod-list'); list.replaceChildren();
  if (!waiting.length) { const empty = document.createElement('div'); empty.className = 'empty-state'; empty.textContent = 'No one is waiting in line.'; list.append(empty); return; }
  waiting.forEach((player, i) => {
    const row = document.createElement('div'); row.className = 'mod-player';
    const num = document.createElement('span'); num.className = 'row-number'; num.textContent = `#${i + 2}`;
    const name = document.createElement('span'); name.className = 'row-name'; name.textContent = `@${player.username}`;
    const time = document.createElement('span'); time.className = 'row-time'; time.textContent = timeLabel(player.joinedAt);
    const controls = document.createElement('div'); controls.className = 'row-controls';
    controls.append(button('↑', '', { title: 'Move up', run: () => perform(`/api/mod/move/${encodeURIComponent(player.id)}/up`, `Moved @${player.username} up.`) }, i === 0));
    controls.append(button('↓', '', { title: 'Move down', run: () => perform(`/api/mod/move/${encodeURIComponent(player.id)}/down`, `Moved @${player.username} down.`) }, i === waiting.length - 1));
    controls.append(button('×', 'remove', { title: 'Remove player', run: () => perform(`/api/mod/remove/${encodeURIComponent(player.id)}`, `Removed @${player.username}.`) }));
    row.append(num, name, time, controls); list.append(row);
  });
}
function showPanel(data) { document.querySelector('#login-view').classList.add('hidden'); document.querySelector('#panel-view').classList.remove('hidden'); render(data); }
function lockPanel() {
  document.querySelector('#panel-view').classList.add('hidden'); document.querySelector('#login-view').classList.remove('hidden');
  if (socket) { socket.disconnect(); socket = null; }
  document.querySelector('#pin').value = '';
}
document.querySelector('#login-form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const data = await api('/api/mod/login', { method: 'POST', body: JSON.stringify({ pin: document.querySelector('#pin').value }) });
    showPanel(data); socket = io(); socket.on('queue:mod-state', render); socket.on('queue:connect_error', () => toast('Live updates reconnecting…', 'error'));
    toast('Mod panel unlocked.');
  } catch (e) { toast(e.message, 'error'); }
});
document.querySelector('#finish-button').addEventListener('click', () => perform('/api/mod/finish', 'Current player finished.'));
document.querySelector('#rotate-button').addEventListener('click', () => perform('/api/mod/current-to-end', 'Current player moved to the end.'));
document.querySelector('#clear-button').addEventListener('click', async () => {
  if (!window.confirm('Clear the entire queue? This removes every player and cannot be undone.')) return;
  await perform('/api/mod/clear', 'Queue cleared.');
});
document.querySelector('#lock-button').addEventListener('click', async () => {
  try { await api('/api/mod/logout', { method: 'POST' }); } catch (_) {}
  lockPanel(); toast('Mod panel locked.');
});
