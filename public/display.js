function displayTime(iso) { return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(iso)); }
function renderDisplay(data) {
  const players = data.players || []; const current = players[0];
  document.querySelector('#display-current').textContent = current ? `@${current.username}` : 'Queue is open';
  document.querySelector('#display-time').textContent = current ? `Joined at ${displayTime(current.joinedAt)}` : 'Waiting for players to join';
  const waiting = players.slice(1); document.querySelector('#display-count').textContent = `${waiting.length} waiting`;
  const list = document.querySelector('#display-list'); list.replaceChildren();
  if (!waiting.length) { const empty = document.createElement('div'); empty.className = 'display-empty'; empty.textContent = current ? 'You’re all caught up. Waiting for the next player.' : 'The queue is open. Join us for community night!'; list.append(empty); return; }
  waiting.forEach((player, i) => {
    const row = document.createElement('div'); row.className = 'display-row';
    const num = document.createElement('span'); num.className = 'row-number'; num.textContent = `#${i + 2}`;
    const name = document.createElement('span'); name.className = 'row-name'; name.textContent = `@${player.username}`;
    row.append(num, name); list.append(row);
  });
}
const socket = io(); socket.on('queue:state', renderDisplay);
fetch('/api/queue').then(r => r.json()).then(renderDisplay);
