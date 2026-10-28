# Koda vs Varga

A turn-based ninja duel that runs in the browser. Koda (fire, shuriken, Phoenix Dive) fights Varga, a storm-monk who throws lightning and void orbs. Both characters are drawn on a 17-bone 2D skeleton with inverse-kinematics legs, cloth physics on the scarf and cape, and particle effects for every attack.

## Run it

No build step. Open `index.html` in a browser, or serve the folder:

```bash
npx serve .
# or
python3 -m http.server 8000
```

## How to play

You move first, then Varga answers. Keys `1`–`6` pick a move.

| Move | Energy | Effect |
|---|---|---|
| Strike | +10 | Two-hit combo, 10–13 damage |
| Shuriken Volley | 15 | 3 × 5–6, gets past most of a guard, breaks Varga's storm |
| Fireball | 35 | 22–27 damage and Burn for 2 turns |
| Guard | +15 | −70% damage until your next turn, counters melee |
| Meditate | +25 | Heal 18, clear Burn, 2-turn cooldown |
| Phoenix Dive | 80 | 42–50 damage, ignores guard, Burn for 3 turns |

Watch for **Gather Storm**: Varga charges for a turn, then drops Thunderfall (40–48). Break it with Shuriken or Guard through it.

## Strategy scripts

Open the **Strategy script** tab, write JavaScript that returns a move id, and switch on Autoplay:

```js
if (foe.charging) return me.can("shuriken") ? "shuriken" : "guard"
if (me.can("phoenix")) return "phoenix"
return "strike"
```

## Tech

Plain HTML, CSS and JavaScript. Rendering is the Canvas 2D API; no libraries or frameworks.

- `fk()` / `legIK()` — forward kinematics for the rig, two-bone IK for the legs
- `A` — animation definitions (keyframed and procedural poses)
- `MOVES` — every ability, written as an async sequence of animations, projectiles and hits
- `aiChoose()` — Varga's weighted decision logic
- `battle()` — the turn loop
