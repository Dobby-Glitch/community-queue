const toastArea = document.querySelector('#toast-area');
function toast(message, type = '', duration = 2600) {
  const el = document.createElement('div'); el.className = `toast ${type}`; el.textContent = message;
  toastArea.append(el); setTimeout(() => el.remove(), duration);
}
function timeLabel(iso) { return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(iso)); }
function render(data) {
  const players = data.players || []; const current = players[0];
  document.querySelector('#current-player').textContent = current ? `@${current.username}` : 'Queue is open';
  document.querySelector('#current-time').textContent = current ? `Joined at ${timeLabel(current.joinedAt)}` : 'Be the first to join tonight';
  const waiting = players.slice(1);
  document.querySelector('#queue-count').textContent = `${waiting.length} waiting`;
  const list = document.querySelector('#waiting-list'); list.replaceChildren();
  if (!waiting.length) { const empty = document.createElement('div'); empty.className = 'empty-state'; empty.textContent = current ? 'You’re all caught up. The next player will appear here.' : 'No players in line yet. Come on in!'; list.append(empty); return; }
  waiting.forEach((player, i) => {
    const row = document.createElement('div'); row.className = 'player-row';
    const num = document.createElement('span'); num.className = 'row-number'; num.textContent = `#${i + 2}`;
    const name = document.createElement('span'); name.className = 'row-name'; name.textContent = `@${player.username}`;
    const time = document.createElement('span'); time.className = 'row-time'; time.textContent = timeLabel(player.joinedAt);
    row.append(num, name, time); list.append(row);
  });
}
document.querySelector('#join-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.currentTarget.querySelector('button'); button.disabled = true;
  try {
    const response = await fetch('/api/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: document.querySelector('#username').value }) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not join the queue.');
    render(data); document.querySelector('#username').value = ''; toast(data.message);
  } catch (error) { toast(error.message, 'error'); } finally { button.disabled = false; }
});
document.querySelector('#secret').addEventListener('click', () => toast('dobbby_y Rulez', 'secret-toast', 2000));
const socket = io(); socket.on('queue:state', render); socket.on('connect_error', () => toast('Reconnecting to the live queue…', 'error'));
fetch('/api/queue').then(r => r.json()).then(render).catch(() => toast('Could not load the queue.', 'error'));
