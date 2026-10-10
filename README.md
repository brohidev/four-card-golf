# Four-Card Golf

A browser multiplayer game for 2–4 players, built with plain HTML/CSS/JavaScript,
Node.js, and WebSockets. One server serves both the website and real-time game.
Players join by room code without accounts.

## Run on a Mac

Use Node.js 22 or newer. Deployment uses Node.js 24.21.0, pinned in `.node-version`.

```bash
cd "/Users/omerbrohi/Documents/ChatGPT/Golf Card Game"
npm ci
npm test
npm start
```

Open http://localhost:3000. For automatic server restarts while developing, use
`npm run dev` instead of `npm start`. Server restarts clear rooms.

## Rules

- Each player has four face-down cards in a 2×2 grid.
- Peek once at your bottom two cards, then hide them. Everyone must finish before play begins.
- On your turn, draw stock or take the top discard. Drawn cards are revealed.
- Swap the drawn card into any hand position, face up, discarding the old card.
- Alternatively, a stock draw may be discarded while you flip a hidden hand card.
- A discard draw must be swapped.
- Finishing a turn with all four cards face up gives every other player one final turn.
- Then all hands are revealed and scored. Aces = −1, kings = 0, jacks/queens = 10,
  and numbers = face value. Matching ranks in a vertical column score zero together.
- Lowest score wins. Totals accumulate over the selected rounds; ties share the win.
- Empty stock is replenished from shuffled discards, keeping the top discard.
- The first player rotates each round.

## Test multiplayer

1. Create a two-player, two-round room in a normal browser window.
2. Join from a private window or another browser using the room code.
3. Check private peeking, both draw sources, swaps, and discard-and-flip moves.
4. Refresh a player window to check reconnection.
5. Reveal all four cards for one player; verify everyone else gets one final turn.
6. Check revealed hands, round scores, running totals, and the next round.
7. Repeat with three or four players and a phone after deployment.

Avoid duplicating a player tab: some browsers copy its session storage and therefore its seat.
Reconnection credentials are held in session storage, so refreshes in the same tab
retain the seat; returning later in a different tab is not guaranteed to do so.

`npm test` currently checks Ace values, column cancellation, and negative scores.
Broader automated game-rule tests are still pending.

## Publish the source to GitHub

Create a new repository named `four-card-golf` at https://github.com/new.
It can be private. Leave the README, .gitignore, and license initialization options
unchecked because this project already has local files.

The project folder already has a Git repository. Run:

```bash
git add .gitignore .node-version package.json package-lock.json server.js lib public test README.md
git commit -m "Build multiplayer four-card Golf"
git branch -M main
```

Copy the HTTPS URL of your new GitHub repository. Substitute it for the placeholder:

```bash
git remote add origin YOUR_GITHUB_REPOSITORY_URL
git push -u origin main
```

Authenticate with GitHub when requested. If authentication fails, paste the error
into the project chat without including passwords or tokens.

## Deploy to Render

Only one Render web service is required. No database or separate frontend service is needed.

1. Sign in at https://dashboard.render.com and choose **New → Web Service**.
2. Connect GitHub and authorize access to the `four-card-golf` repository.
3. Select that repository and configure:

| Setting | Value |
| --- | --- |
| Name | `four-card-golf` (or an available name) |
| Language / Runtime | Node |
| Branch | `main` |
| Region | A region near your players |
| Root Directory | Leave blank |
| Build Command | `npm ci && npm test` |
| Start Command | `npm start` |
| Instance Type | Free |
| Health Check Path | `/health` |

4. Let Render provide `PORT`. Do not set it manually. No secrets or extra environment
   variables are needed; `.node-version` selects Node.js 24.21.0.
5. Create the web service and wait for the deployment to become live.
6. Open the HTTPS URL shown by Render. This is the public game link.
7. Visit `/health` on that URL and confirm it shows `OK`.
8. Open the game on a laptop and a phone (cellular data is a useful independent-network test).
   Create a room, share its code, and play two rounds. Refresh to check reconnection.

The client automatically uses secure `wss://` on the HTTPS site. The server already
listens on `0.0.0.0` and uses Render's `PORT`. Keep this service at one instance:
rooms are in memory and are not shared across separate server instances.

### Hosting limits

Render's Free service can sleep after 15 minutes without incoming HTTP requests or
WebSocket messages. Waking can take about a minute. Free usage limits also apply.
Restarts, sleep, and redeployments clear all active rooms and scores in this project.
Reconnection restores a seat only while that room remains on the running server.
Paid hosting avoids the free-tier idle sleep, but does not add game-state persistence.

Avoid deploying changes during a match. Render normally deploys linked-branch pushes
automatically; each server replacement clears the current rooms.

Official guides:
- https://render.com/docs/deploy-node-express-app
- https://render.com/docs/websocket
- https://render.com/docs/free
- https://render.com/docs/node-version

## Files

- `server.js`: HTTP assets, health endpoint, rooms, WebSocket sessions and updates.
- `lib/game.js`: authoritative rules, deck, turns, private views and scoring.
- `public/index.html`: screens and rules.
- `public/styles.css`: responsive card-table styling.
- `public/app.js`: browser actions, rendering and reconnects.
- `test/game.test.js`: scoring regression tests.

## Current limitations

- No persistent storage: restarting the server clears games.
- A disconnected player keeps their seat and turn; there is no removal or turn timer.
- Only the room creator can start rounds, and all players must be connected.
- Rooms with no connected players expire after an hour.
