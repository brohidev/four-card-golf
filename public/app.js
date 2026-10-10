const $ = (id) => document.getElementById(id);
const SESSION_KEY = 'golf-seat';
let socket;
let state = null;
let pending = false;
let awaitingResume = false;
let move = 'swap';
let retryDelay = 1000;
let retryTimer;
let seat = null;
try { seat = JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch {}

function show(id, visible) { $(id).hidden = !visible; }
function text(id, value) { $(id).textContent = value; }
function error(message = '') {
  text('error-message', message);
  show('error-message', Boolean(message));
}
function online() { return socket?.readyState === WebSocket.OPEN; }
function send(message) {
  if (!online()) return error('Connection lost. Wait while we reconnect.');
  if (pending) return;
  pending = true;
  error();
  socket.send(JSON.stringify(message));
  render();
}
function action(value) { send({ type: 'action', action: value }); }
function saveSeat(value) {
  seat = value;
  try {
    if (value) sessionStorage.setItem(SESSION_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    error('Browser storage is unavailable. Refreshing may lose your seat.');
  }
}

function connect() {
  clearTimeout(retryTimer);
  const connection = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
  socket = connection;
  text('connection-status', 'Connecting…');
  render();
  connection.addEventListener('open', () => {
    if (socket !== connection) return;
    retryDelay = 1000;
    text('connection-status', 'Connected');
    if (seat) {
      awaitingResume = true;
      send({ type: 'resume', ...seat });
    } else render();
  });
  connection.addEventListener('message', (event) => {
    if (socket !== connection) return;
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (message.type === 'session') {
      awaitingResume = false;
      saveSeat({ roomCode: message.roomCode, playerId: message.playerId, token: message.token });
    } else if (message.type === 'state') {
      state = message.state;
      pending = false;
      render();
    } else if (message.type === 'error') {
      if (awaitingResume) {
        awaitingResume = false;
        saveSeat(null);
        state = null;
      }
      pending = false;
      render();
      error(message.message);
    }
  });
  connection.addEventListener('close', (event) => {
    if (socket !== connection) return;
    pending = false;
    awaitingResume = false;
    if (event.code === 4001) {
      saveSeat(null);
      state = null;
      render();
      error('Your seat was opened in another window. This window can join as a different player.');
    }
    text('connection-status', 'Disconnected — reconnecting…');
    render();
    retryTimer = setTimeout(connect, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 10000);
  });
  connection.addEventListener('error', () => {
    if (socket === connection) text('connection-status', 'Unable to connect — retrying…');
  });
}

function paintCard(element, card) {
  element.replaceChildren();
  element.classList.remove('card-back', 'red', 'peek');
  if (!card) {
    element.textContent = 'Empty';
    return;
  }
  if (!card.rank) {
    element.classList.add('card-back');
    element.textContent = 'Golf';
    return;
  }
  element.textContent = `${card.rank} ${card.suit}`;
  element.classList.toggle('red', card.suit === '♥' || card.suit === '♦');
  element.classList.toggle('peek', Boolean(card.peekVisible));
  if (card.peekVisible) {
    const label = document.createElement('small');
    label.textContent = 'Your peek';
    element.append(label);
  }
}

function render() {
  const blocked = !online() || pending;
  for (const button of document.querySelectorAll('form button')) button.disabled = blocked;
  show('home-screen', !state);
  show('room-screen', Boolean(state));
  if (!state) return;
  const me = state.players.find((player) => player.id === state.you);
  if (!me) return;
  const host = state.you === state.hostId;
  const connected = (id) => state.connectedPlayerIds.includes(id);
  const allConnected = state.players.every((player) => connected(player.id));
  const results = state.phase === 'roundEnd' || state.phase === 'finished';
  const myTurn = state.phase === 'playing' && state.turnPlayerId === state.you;
  const placing = myTurn && Boolean(state.drawn);
  const canPlace = placing && !blocked;
  if (!placing || state.drawn.source === 'discard') move = 'swap';
  const names = (ids) => state.players.filter((player) => ids.includes(player.id)).map((player) => player.name).join(', ');

  text('room-code', state.roomCode);
  show('lobby-panel', state.phase === 'lobby');
  show('game-panel', state.phase !== 'lobby');
  show('results-panel', results);
  text('lobby-summary', `${state.players.length} of ${state.maxPlayers} players · ${state.rounds} rounds`);
  $('lobby-players').replaceChildren(...state.players.map((player) => {
    const item = document.createElement('li');
    item.textContent = `${player.name}${player.id === state.you ? ' (you)' : ''}${player.id === state.hostId ? ' · host' : ''} · ${connected(player.id) ? 'connected' : 'reconnecting'}`;
    return item;
  }));
  text('lobby-message', host ? 'Share the room code. Start when everyone has joined.' : 'The room creator will start the game.');
  show('start-game', host && state.phase === 'lobby');
  $('start-game').disabled = blocked || !allConnected || state.players.length !== state.maxPlayers;
  text('round-number', `${state.round} of ${state.rounds}`);
  const turnPlayer = state.players.find((player) => player.id === state.turnPlayerId);
  text('turn-message', results ? 'All cards are revealed.' : state.phase === 'peek'
    ? 'Memorize your bottom two cards before play begins.'
    : myTurn ? (placing ? 'Your turn — choose a move and a card in your grid.' : 'Your turn — choose a pile.')
      : `${turnPlayer?.name ?? 'Player'}’s turn${turnPlayer && !connected(turnPlayer.id) ? ' — waiting for reconnection' : ''}.`);
  show('final-turn-message', state.phase === 'playing' && state.finalPlayerId !== null);
  text('final-turn-message', `${names([state.finalPlayerId])} revealed all four cards. ${state.finalTurnsRemaining} final turn(s) remaining.`);

  show('peek-panel', state.phase === 'peek');
  text('peek-message', me.ready ? 'Your cards are hidden. Waiting for everyone else.' : me.peeking ? 'Memorize these two cards, then hide them.' : 'You may look at your bottom two cards once this round.');
  show('peek-cards', !me.peekUsed && !me.ready);
  show('finish-peek', me.peeking);
  $('peek-cards').disabled = blocked;
  $('finish-peek').disabled = blocked;

  text('stock-count', state.stockCount);
  $('draw-stock').disabled = blocked || !myTurn || Boolean(state.drawn);
  $('draw-discard').disabled = blocked || !myTurn || Boolean(state.drawn) || !state.discardTop;
  paintCard($('draw-discard'), state.discardTop);
  $('draw-discard').setAttribute('aria-label', state.discardTop ? `Take discard ${state.discardTop.rank} ${state.discardTop.suit}` : 'Discard pile is empty');
  show('drawn-panel', Boolean(state.drawn));
  paintCard($('drawn-card'), state.drawn?.card);
  text('drawn-source', state.drawn ? `From ${state.drawn.source}` : '');
  show('move-controls', placing);
  $('choose-swap').disabled = !canPlace;
  $('choose-flip').disabled = !canPlace || state.drawn?.source !== 'stock' || me.hand.every((card) => card.faceUp);
  $('choose-swap').setAttribute('aria-pressed', String(move === 'swap'));
  $('choose-flip').setAttribute('aria-pressed', String(move === 'discardAndFlip'));
  text('move-message', move === 'swap' ? 'Choose any card in your grid to replace. The new card will be face up.' : 'Choose a face-down card to flip. Your drawn card will be discarded.');

  const positions = ['top left', 'top right', 'bottom left', 'bottom right'];
  $('my-hand').replaceChildren(...me.hand.map((card, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'card';
    paintCard(button, card);
    button.disabled = !canPlace || (move === 'discardAndFlip' && card.faceUp);
    button.setAttribute('aria-label', `${positions[index]}: ${card.rank ? `${card.rank} ${card.suit}${card.peekVisible ? ' (peek)' : ''}` : 'face down'}`);
    button.addEventListener('click', () => action({ type: move, index }));
    return button;
  }));
  $('my-hand').closest('.player-panel').classList.toggle('current-turn', myTurn);
  text('my-hand-title', `Your cards · ${me.total} total points`);
  $('opponents').replaceChildren(...state.players.filter((player) => player.id !== state.you).map((player) => {
    const panel = document.createElement('article');
    panel.className = 'opponent';
    panel.classList.toggle('current-turn', state.turnPlayerId === player.id);
    const title = document.createElement('h4');
    title.textContent = player.name;
    const summary = document.createElement('p');
    summary.textContent = `${player.total} total points · ${connected(player.id) ? 'connected' : 'reconnecting'}${state.phase === 'peek' && player.ready ? ' · ready' : ''}`;
    const grid = document.createElement('div');
    grid.className = 'card-grid';
    for (const card of player.hand) {
      const face = document.createElement('div');
      face.className = 'card';
      paintCard(face, card);
      grid.append(face);
    }
    panel.append(title, summary, grid);
    return panel;
  }));

  if (results) {
    const result = state.results.at(-1);
    text('results-title', state.phase === 'finished' ? 'Game complete' : `Round ${state.round} results`);
    text('round-winners', `Round winner(s): ${names(result.winnerIds)}`);
    text('overall-leaders', `${state.phase === 'finished' ? 'Overall winner(s)' : 'Overall leader(s)'}: ${names(state.overallLeaderIds)}`);
    $('score-rows').replaceChildren(...result.scores.map((entry) => {
      const row = document.createElement('tr');
      for (const value of [names([entry.playerId]), entry.score, entry.total]) {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.append(cell);
      }
      return row;
    }));
    text('results-message', state.phase === 'finished' ? 'Thanks for playing! Return home to create or join another game.' : host ? 'Start the next round when everyone is ready and connected.' : 'The room creator will start the next round.');
  }
  show('next-round', host && state.phase === 'roundEnd');
  $('next-round').disabled = blocked || !allConnected;
  show('new-game', state.phase === 'finished');
}

$('create-form').addEventListener('submit', (event) => {
  event.preventDefault();
  send({ type: 'create', name: $('create-name').value.trim(), maxPlayers: Number($('max-players').value), rounds: Number($('round-count').value) });
});
$('join-form').addEventListener('submit', (event) => {
  event.preventDefault();
  send({ type: 'join', name: $('join-name').value.trim(), roomCode: $('join-code').value.trim().toUpperCase() });
});
$('start-game').addEventListener('click', () => action({ type: 'start' }));
$('next-round').addEventListener('click', () => action({ type: 'nextRound' }));
$('peek-cards').addEventListener('click', () => action({ type: 'peek' }));
$('finish-peek').addEventListener('click', () => action({ type: 'finishPeek' }));
$('draw-stock').addEventListener('click', () => action({ type: 'draw', source: 'stock' }));
$('draw-discard').addEventListener('click', () => action({ type: 'draw', source: 'discard' }));
$('choose-swap').addEventListener('click', () => { move = 'swap'; render(); });
$('choose-flip').addEventListener('click', () => { move = 'discardAndFlip'; render(); });
$('copy-code').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(state.roomCode);
    text('copy-code', 'Copied!');
    setTimeout(() => text('copy-code', 'Copy room code'), 1500);
  } catch { error(`Copy this room code: ${state.roomCode}`); }
});
$('new-game').addEventListener('click', () => {
  clearTimeout(retryTimer);
  const oldSocket = socket;
  socket = null;
  oldSocket?.close();
  saveSeat(null);
  state = null;
  pending = false;
  awaitingResume = false;
  error();
  connect();
});

connect();
