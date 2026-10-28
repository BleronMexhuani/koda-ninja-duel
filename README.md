# Koda: Path of the Storm

A turn-based ninja RPG for the browser with a Go backend. Players create an account, take missions against five opponents, earn ryo and experience, buy and upgrade techniques, and build a six-slot loadout. Every battle is resolved on the server, so rewards can't be faked from the browser.

Characters are drawn on a 17-bone 2D skeleton with inverse-kinematics legs, cloth physics on scarves and capes, and particle effects for fire, lightning, wind and void attacks.

## Quick start

With Docker:

```bash
docker compose up --build
```

Open http://localhost:8080 and create an account.

Without Docker you need Go 1.24+ and PostgreSQL 13+:

```bash
make db        # or point DATABASE_URL at your own Postgres
make run       # DATABASE_URL defaults to postgres://koda:koda@localhost:5432/koda
```

The server creates its tables on startup.

## How the game works

**Missions.** Five missions in story order. Each unlocks after the previous one and at a minimum level. Wins pay ryo and XP, plus a one-time first-clear bonus. Losses still pay a quarter of the XP.

| Rank | Mission | Opponent | Reward | First clear | Unlocks at |
|---|---|---|---|---|---|
| D | Trouble on the Old Road | Gorou, road bandit | 120 ryo · 60 XP | +100 | — |
| C | The Ash Acolyte | Sen, ash acolyte | 170 ryo · 90 XP | +150 | Clear the bandit |
| C | Reeds at Dusk | Mirei, kunoichi | 240 ryo · 130 XP | +220 | Level 2, clear the Acolyte |
| B | Storm over the Pass | Varga, storm-monk | 420 ryo · 220 XP | +400 | Level 3, clear the kunoichi |
| A | The Thunder Sage | Ikaru | 750 ryo · 400 XP | +800 | Level 5, clear Varga |

**Levels.** Level *n* needs 100 × *n* XP to reach level *n + 1*. Koda's health is 100 + 10 × level.

**Techniques.** New accounts own Strike, Shuriken Volley, Guard and Meditate, and start with 150 ryo.

| Technique | Energy | Price | Requires | Effect |
|---|---|---|---|---|
| Fireball | 35 | 250 | — | 22–27 damage, Burn for 2 turns |
| Smoke Bomb | 20 | 350 | Level 2 | Next attack against you has a 70% chance to miss |
| Wind Blade | 25 | 500 | Level 2, clear the Acolyte | 16–20, shatters Guard/Barrier |
| Phoenix Dive | 80 | 1200 | Level 4 | 42–50, ignores guard, Burn for 3 turns |
| Thunder Palm | 40 | 1800 | Level 5, clear Varga | 28–34 melee, breaks storms, 30% stun |

Upgrading a technique to rank II or III adds 15% damage or healing per rank. Upgrade cost is ¾ of the price times the current rank (starter techniques count as 150).

**Battle rules.** Both sides gain 12 energy at the start of their turn. Guard cuts damage by 70% until your next turn. Burn deals 6 per turn. Storm-monks can spend a turn gathering a storm, then drop Thunderfall (40–48 over five bolts) unless you break it with Shuriken Volley or Thunder Palm. Direct attacks crit 10% of the time for 1.5×.

**Strategy scripts.** In battle, the Strategy script tab runs your own JavaScript at the start of each turn and returns a technique id. Switch on Autoplay to let it fight for you.

## Architecture

```
cmd/server/          entry point: config, DB connection, migrations, HTTP server
internal/game/       rules: techniques, enemies, missions, levels, battle engine, enemy AI
internal/store/      PostgreSQL access (players, sessions, techniques, battles, ledger)
internal/api/        HTTP routes, auth, rate limiting, JSON handlers
migrations/          SQL schema, embedded and applied on startup
web/static/          browser client (no build step)
  engine.js          rig, rendering, effects, playback of battle events
  app.js             screens: login, missions, techniques, loadout, leaderboard, battle
scripts/smoke.sh     end-to-end API check against a running server
```

**Server-authoritative battles.** The browser sends only the technique it picked. The server checks it is equipped, affordable and off cooldown, resolves the player's move, runs the enemy AI, and returns an ordered list of events (`turnStart`, `move` with per-hit results, `skip`, `end`). Each event carries a snapshot of both fighters. The client animates the events and never decides outcomes. Battle state is stored as JSONB and locked with `SELECT … FOR UPDATE`, so double-clicks or parallel requests can't resolve a turn twice. Rewards are paid in the same transaction that closes the battle.

**Accounts.** Passwords are hashed with PBKDF2-HMAC-SHA256 (600,000 iterations, per-user salt) from Go's standard library. Sessions are random 256-bit tokens; only their SHA-256 hash is stored. Cookies are `HttpOnly` and `SameSite=Lax`. Login and registration are rate-limited per IP, and state-changing requests must be JSON, which blocks cross-site form posts.

**Economy.** Every ryo change is written to a `ledger` table. Purchases use a conditional `UPDATE … WHERE ryo >= price`, so balances can't go negative.

## API

All endpoints return JSON. POST and PUT bodies must be `application/json`.

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/api/auth/register` | `{username, password}` | Sets the session cookie |
| POST | `/api/auth/login` | `{username, password}` | |
| POST | `/api/auth/logout` | `{}` | |
| GET | `/api/me` | | Profile, techniques, missions, active battle |
| POST | `/api/shop/buy` | `{technique}` | |
| POST | `/api/techniques/{id}/upgrade` | `{}` | |
| PUT | `/api/loadout` | `{slots: [ids…]}` | 1–6 owned techniques, in key order |
| POST | `/api/battles` | `{mission}` | Starts a battle; forfeits any running one |
| GET | `/api/battles/active` | | Resume after a reload |
| POST | `/api/battles/{id}/turn` | `{move}` | Returns events, and the reward when it ends |
| POST | `/api/battles/{id}/forfeit` | `{}` | Counts as a loss |
| GET | `/api/leaderboard` | | Top 20 by XP |
| GET | `/api/health` | | Database check |

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | required | PostgreSQL connection string |
| `PORT` | `8080` | HTTP port |
| `COOKIE_SECURE` | `false` | Set `true` when served over HTTPS |
| `TRUST_PROXY` | `false` | Use `X-Forwarded-For` for rate limiting behind a reverse proxy |

## Tests

```bash
make test                                      # unit tests: battle engine, balance, auth
scripts/smoke.sh http://localhost:8080          # end-to-end against a running server
```

The battle tests play 200 seeded fights per mission to check every battle finishes, values stay in range, and each mission is winnable.

## Adding content

- **A technique:** add it to `Techniques` in `internal/game/catalog.go`, resolve it in `perform()` in `battle.go`, and animate it in `MOVES` in `web/static/engine.js`.
- **An enemy:** add it to `Enemies` with a move list, and give it a look in `LOOKS` in `engine.js` (`ninja` or `monk` rig).
- **A mission:** append to `Missions`.
- **A schema change:** add `migrations/002_….sql`. It runs once on the next start.
