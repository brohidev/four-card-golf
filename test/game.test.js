import test from 'node:test';
import assert from 'node:assert/strict';
import { cardValue, scoreHand } from '../lib/game.js';

test('Aces are worth minus one; other card values are unchanged', () => {
  assert.equal(cardValue({ rank: 'A' }), -1);
  assert.equal(cardValue({ rank: 'K' }), 0);
  for (const rank of ['J', 'Q']) assert.equal(cardValue({ rank }), 10);
  for (let value = 2; value <= 10; value++) {
    assert.equal(cardValue({ rank: String(value) }), value);
  }
});

test('an unpaired Ace reduces the hand score', () => {
  const hand = ['Q', 'K', 'Q', 'A'].map((rank) => ({ rank }));
  assert.equal(scoreHand(hand), -1);
});

test('a matching column of Aces scores zero together', () => {
  const hand = ['A', '2', 'A', '3'].map((rank) => ({ rank }));
  assert.equal(scoreHand(hand), 5);
});

test('horizontal Aces do not cancel and can produce a negative score', () => {
  const hand = ['A', 'A', 'K', 'K'].map((rank) => ({ rank }));
  assert.equal(scoreHand(hand), -2);
});
