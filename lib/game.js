import { randomInt } from 'node:crypto';

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['♠', '♥', '♦', '♣'];

function requireRule(condition, message) {
  if (!condition) throw new Error(message);
}

function shuffle(cards) {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

export function cardValue(card) {
  if (card.rank === 'K') return 0;
  if (card.rank === 'A') return -1;
  if (card.rank === 'J' || card.rank === 'Q') return 10;
  return Number(card.rank);
}

export function scoreHand(hand) {
  let score = 0;
  for (const [top, bottom] of [[0, 2], [1, 3]]) {
    if (hand[top].rank !== hand[bottom].rank) {
      score += cardValue(hand[top]) + cardValue(hand[bottom]);
    }
  }
  return score;
}

export function createGame({ maxPlayers, rounds }) {
  requireRule(Number.isInteger(maxPlayers) && maxPlayers >= 2 && maxPlayers <= 4, 'Choose 2–4 players.');
  requireRule(Number.isInteger(rounds) && rounds >= 1 && rounds <= 20, 'Choose 1–20 rounds.');
  return {
    maxPlayers, rounds, round: 0, phase: 'lobby', players: [],
    stock: [], discard: [], turnIndex: 0, drawn: null,
    finalPlayerId: null, finalTurnsRemaining: null, results: []
  };
}

export function addPlayer(game, { id, name }) {
  requireRule(game.phase === 'lobby', 'This game has already started.');
  requireRule(game.players.length < game.maxPlayers, 'This room is full.');
  requireRule(!game.players.some((player) => player.id === id), 'You already joined.');
  requireRule(typeof name === 'string' && name.trim().length > 0 && name.trim().length <= 24, 'Enter a display name of 1–24 characters.');
  game.players.push({
    id, name: name.trim(), hand: [], total: 0,
    peekUsed: false, peeking: false, ready: false
  });
}

function startRound(game) {
  game.round++;
  game.stock = shuffle(SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit }))));
  game.discard = [];
  game.drawn = null;
  game.finalPlayerId = null;
  game.finalTurnsRemaining = null;
  game.turnIndex = (game.round - 1) % game.players.length;
  for (const player of game.players) {
    player.hand = Array.from({ length: 4 }, () => ({ ...game.stock.pop(), faceUp: false }));
    player.peekUsed = false;
    player.peeking = false;
    player.ready = false;
  }
  game.discard.push(game.stock.pop());
  game.phase = 'peek';
}

function discardCard(game, card) {
  game.discard.push({ rank: card.rank, suit: card.suit });
}

function finishRound(game) {
  const scores = game.players.map((player) => {
    for (const card of player.hand) card.faceUp = true;
    const score = scoreHand(player.hand);
    player.total += score;
    return { playerId: player.id, score, total: player.total };
  });
  const lowest = Math.min(...scores.map((entry) => entry.score));
  game.results.push({
    round: game.round, scores,
    winnerIds: scores.filter((entry) => entry.score === lowest).map((entry) => entry.playerId)
  });
  game.phase = game.round === game.rounds ? 'finished' : 'roundEnd';
  game.drawn = null;
}

function finishTurn(game, player) {
  game.drawn = null;
  if (game.finalPlayerId !== null) {
    game.finalTurnsRemaining--;
    if (game.finalTurnsRemaining === 0) return finishRound(game);
  } else if (player.hand.every((card) => card.faceUp)) {
    game.finalPlayerId = player.id;
    game.finalTurnsRemaining = game.players.length - 1;
  }
  game.turnIndex = (game.turnIndex + 1) % game.players.length;
}

function refillStock(game) {
  if (game.stock.length) return;
  requireRule(game.discard.length > 1, 'The stockpile is empty. Take the discard instead.');
  const top = game.discard.pop();
  game.stock = shuffle(game.discard);
  game.discard = [top];
}

export function applyAction(game, playerId, action) {
  const player = game.players.find((entry) => entry.id === playerId);
  requireRule(Boolean(player), 'Player not found.');
  requireRule(action && typeof action === 'object' && !Array.isArray(action), 'Invalid action.');

  if (action.type === 'start') {
    requireRule(game.phase === 'lobby', 'The game has already started.');
    requireRule(game.players.length === game.maxPlayers, 'Wait for the chosen number of players to join.');
    startRound(game);
    return;
  }
  if (action.type === 'nextRound') {
    requireRule(game.phase === 'roundEnd', 'The next round is not available.');
    startRound(game);
    return;
  }
  if (action.type === 'peek') {
    requireRule(game.phase === 'peek' && !player.peekUsed && !player.ready, 'You can peek only once at the start of each round.');
    player.peekUsed = true;
    player.peeking = true;
    return;
  }
  if (action.type === 'finishPeek') {
    requireRule(game.phase === 'peek' && player.peeking && !player.ready, 'Look at your bottom cards first.');
    player.peeking = false;
    player.ready = true;
    if (game.players.every((entry) => entry.ready)) game.phase = 'playing';
    return;
  }

  requireRule(game.phase === 'playing', 'Wait until play begins.');
  requireRule(game.players[game.turnIndex].id === playerId, 'It is not your turn.');

  if (action.type === 'draw') {
    requireRule(game.drawn === null, 'Finish placing or discarding your drawn card first.');
    requireRule(action.source === 'stock' || action.source === 'discard', 'Choose the stock or discard pile.');
    if (action.source === 'stock') {
      refillStock(game);
      game.drawn = { card: game.stock.pop(), source: 'stock', playerId };
    } else {
      requireRule(game.discard.length > 0, 'The discard pile is empty.');
      game.drawn = { card: game.discard.pop(), source: 'discard', playerId };
    }
    return;
  }

  requireRule(action.type === 'swap' || action.type === 'discardAndFlip', 'Unknown action.');
  requireRule(game.drawn !== null, 'Draw a card first.');
  requireRule(Number.isInteger(action.index) && action.index >= 0 && action.index < 4, 'Choose one of your four cards.');

  if (action.type === 'swap') {
    discardCard(game, player.hand[action.index]);
    player.hand[action.index] = { ...game.drawn.card, faceUp: true };
  } else {
    requireRule(game.drawn.source === 'stock', 'A card taken from the discard pile must be swapped.');
    requireRule(!player.hand[action.index].faceUp, 'Choose a face-down card to flip.');
    discardCard(game, game.drawn.card);
    player.hand[action.index].faceUp = true;
  }
  finishTurn(game, player);
}

// Build a new view without exposing the deck, hidden ranks, or internal objects.
export function publicState(game, playerId) {
  const overallLowest = game.players.length ? Math.min(...game.players.map((player) => player.total)) : null;
  return {
    phase: game.phase,
    maxPlayers: game.maxPlayers,
    rounds: game.rounds,
    round: game.round,
    turnPlayerId: game.phase === 'playing' ? game.players[game.turnIndex].id : null,
    stockCount: game.stock.length,
    discardTop: game.discard.length ? { ...game.discard.at(-1) } : null,
    drawn: game.drawn ? { ...game.drawn, card: { ...game.drawn.card } } : null,
    finalPlayerId: game.finalPlayerId,
    finalTurnsRemaining: game.finalTurnsRemaining,
    overallLeaderIds: game.players.filter((player) => player.total === overallLowest).map((player) => player.id),
    players: game.players.map((player) => ({
      id: player.id,
      name: player.name,
      total: player.total,
      ready: player.ready,
      peekUsed: player.peekUsed,
      peeking: player.id === playerId && player.peeking,
      hand: player.hand.map((card, index) => {
        const peekVisible = game.phase === 'peek' && player.id === playerId && player.peeking && index >= 2;
        return card.faceUp || peekVisible
          ? { rank: card.rank, suit: card.suit, faceUp: card.faceUp, peekVisible }
          : { faceUp: false };
      })
    })),
    results: game.results.map((result) => ({
      round: result.round,
      scores: result.scores.map((score) => ({ ...score })),
      winnerIds: [...result.winnerIds]
    }))
  };
}
