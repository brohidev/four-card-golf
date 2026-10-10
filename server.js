import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomInt, randomUUID } from 'node:crypto';
import WebSocket, { WebSocketServer } from 'ws';
import { createGame, addPlayer, applyAction, publicState } from './lib/game.js';

const port = Number(process.env.PORT || 3000);
const rooms = new Map();
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']]
]);

const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('OK');
  }
  const asset = assets.get(pathname);
  if (!asset || !['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(404);
    return res.end('Not found');
  }
  try {
    const body = await readFile(new URL(`./public/${asset[0]}`, import.meta.url));
    res.writeHead(200, {
      'Content-Type': asset[1],
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (error) {
    res.writeHead(error.code === 'ENOENT' ? 404 : 500);
    res.end('Website files are unavailable.');
  }
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });

function send(socket, message) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function broadcast(room) {
  room.updatedAt = Date.now();
  for (const [playerId, connection] of room.members) {
    if (!connection.socket) continue;
    send(connection.socket, {
      type: 'state',
      state: {
        ...publicState(room.game, playerId),
        roomCode: room.code,
        hostId: room.hostId,
        you: playerId,
        connectedPlayerIds: [...room.members]
          .filter(([, member]) => member.socket?.readyState === WebSocket.OPEN)
          .map(([id]) => id)
      }
    });
  }
}

function newCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function displayName(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 24) {
    throw new Error('Enter a display name of 1–24 characters.');
  }
  return value.trim();
}

function attach(socket, room, playerId, member) {
  const previousSocket = member.socket;
  member.socket = socket;
  socket.session = { room, playerId };
  if (previousSocket && previousSocket !== socket) {
    previousSocket.close(4001, 'Your seat was opened in another connection.');
  }
  send(socket, { type: 'session', roomCode: room.code, playerId, token: member.token });
  broadcast(room);
}

wss.on('connection', (socket) => {
  socket.alive = true;
  socket.on('pong', () => { socket.alive = true; });
  socket.on('error', () => {});
  let windowStart = Date.now();
  let messageCount = 0;

  socket.on('message', (data, isBinary) => {
    try {
      if (Date.now() - windowStart > 1000) {
        windowStart = Date.now();
        messageCount = 0;
      }
      if (++messageCount > 30) throw new Error('Too many actions. Please slow down.');
      if (isBinary) throw new Error('Send text messages only.');
      const message = JSON.parse(data.toString());
      if (!message || typeof message !== 'object' || Array.isArray(message)) {
        throw new Error('Invalid message.');
      }

      if (['create', 'join', 'resume'].includes(message.type)) {
        if (socket.session) throw new Error('You already have a seat.');
        if (message.type === 'resume') {
          const room = rooms.get(message.roomCode);
          const member = room?.members.get(message.playerId);
          if (!member || member.token !== message.token) {
            throw new Error('Could not reconnect. The room may have expired.');
          }
          return attach(socket, room, message.playerId, member);
        }

        const name = displayName(message.name);
        const playerId = randomUUID();
        let room;
        if (message.type === 'create') {
          if (!Number.isInteger(message.maxPlayers) || message.maxPlayers < 2 || message.maxPlayers > 4) {
            throw new Error('Choose 2–4 players.');
          }
          if (!Number.isInteger(message.rounds) || message.rounds < 1 || message.rounds > 20) {
            throw new Error('Choose 1–20 rounds.');
          }
          if (rooms.size >= 1000) throw new Error('The server is full. Try again later.');
          const code = newCode();
          room = {
            code, hostId: playerId, members: new Map(), updatedAt: Date.now(),
            game: createGame({ maxPlayers: message.maxPlayers, rounds: message.rounds })
          };
          addPlayer(room.game, { id: playerId, name });
          rooms.set(code, room);
        } else {
          const code = typeof message.roomCode === 'string' ? message.roomCode.trim().toUpperCase() : '';
          room = rooms.get(code);
          if (!room) throw new Error('Room not found. Check the code.');
          addPlayer(room.game, { id: playerId, name });
        }
        const member = { token: randomUUID(), socket: null };
        room.members.set(playerId, member);
        return attach(socket, room, playerId, member);
      }

      const session = socket.session;
      if (!session || session.room.members.get(session.playerId)?.socket !== socket) {
        throw new Error('Join a room first.');
      }
      if (message.type !== 'action') throw new Error('Unknown message type.');
      const { room, playerId } = session;
      if (['start', 'nextRound'].includes(message.action?.type)) {
        if (playerId !== room.hostId) throw new Error('Only the room creator can start a round.');
        if ([...room.members.values()].some((member) => member.socket?.readyState !== WebSocket.OPEN)) {
          throw new Error('Wait for all players to reconnect before starting.');
        }
      }
      applyAction(room.game, playerId, message.action);
      broadcast(room);
    } catch (error) {
      send(socket, { type: 'error', message: error instanceof SyntaxError ? 'Invalid JSON message.' : error.message });
    }
  });

  socket.on('close', () => {
    const session = socket.session;
    if (!session) return;
    const member = session.room.members.get(session.playerId);
    if (member?.socket !== socket) return;
    member.socket = null;
    broadcast(session.room);
  });
});

const maintenance = setInterval(() => {
  for (const socket of wss.clients) {
    if (!socket.alive) {
      socket.terminate();
      continue;
    }
    socket.alive = false;
    socket.ping();
  }
  for (const [code, room] of rooms) {
    const empty = [...room.members.values()].every((member) => !member.socket);
    if (empty && Date.now() - room.updatedAt > 60 * 60 * 1000) rooms.delete(code);
  }
}, 30000);
maintenance.unref();

server.listen(port, '0.0.0.0', () => {
  console.log(`Golf is running at http://localhost:${port}`);
});
