// App shell: accounts, hub (missions, techniques, loadout, leaderboard) and
// the battle screen. All game state lives on the server.
(() => {
"use strict";
const $ = id => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const Engine = window.KodaEngine;

/* ---------- API ---------- */
async function api(method, path, body) {
  const opts = { method, credentials: "same-origin", headers: {} };
  if (method !== "GET") { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body ?? {}); }
  let res;
  try { res = await fetch(path, opts); } catch { throw new Error("Can't reach the server. Check your connection and try again."); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || `Request failed (${res.status})`); e.status = res.status; throw e; }
  return data;
}

/* ---------- state ---------- */
let me = null;            // /api/me response
let battle = null;        // { id, mission, state }
let choiceOpen = false;
let busy = false;
let loadoutDraft = [];
const roman = n => ["", "I", "II", "III"][n] || String(n);
const techName = id => (me && me.allTechniques[id] ? me.allTechniques[id].name : id);

/* ---------- views ---------- */
function show(view) {
  for (const v of ["authView", "hubView", "battleView"]) $(v).hidden = v !== view;
  $("meBar").hidden = view === "authView";
  if (view === "battleView") Engine.start(); else Engine.stop();
}
function toast(msg, isErr = false) { const t = $("toast"); t.textContent = msg; t.className = "toast" + (isErr ? " err" : ""); clearTimeout(toast.t); toast.t = setTimeout(() => { t.textContent = ""; }, 4000); }

function renderMe() {
  const p = me.player;
  $("meName").textContent = p.username; $("meLevel").textContent = p.level; $("meRyo").textContent = p.ryo.toLocaleString();
  $("meXp").style.width = Math.round(p.xpInto / p.xpNeed * 100) + "%"; $("meXpText").textContent = `${p.xpInto}/${p.xpNeed} XP`;
}

/* ---------- auth ---------- */
let mode = "login";
function setMode(m) {
  mode = m;
  $("modeLogin").setAttribute("aria-selected", m === "login"); $("modeRegister").setAttribute("aria-selected", m === "register");
  $("authSubmit").textContent = m === "login" ? "Log in" : "Create account";
  $("password").autocomplete = m === "login" ? "current-password" : "new-password";
  $("authHint").textContent = m === "login" ? "" : "Username: 3–20 letters, numbers or underscores. Password: at least 8 characters.";
  $("authError").textContent = "";
}
$("modeLogin").addEventListener("click", () => setMode("login"));
$("modeRegister").addEventListener("click", () => setMode("register"));
$("authForm").addEventListener("submit", async e => {
  e.preventDefault();
  const username = $("username").value.trim(), password = $("password").value;
  $("authError").textContent = ""; $("authSubmit").disabled = true;
  try {
    await api("POST", mode === "login" ? "/api/auth/login" : "/api/auth/register", { username, password });
    $("password").value = "";
    await enterHub("missions");
  } catch (err) { $("authError").textContent = err.message; }
  finally { $("authSubmit").disabled = false; }
});
$("logout").addEventListener("click", async () => {
  try { await api("POST", "/api/auth/logout"); } catch {}
  me = null; battle = null; show("authView"); setMode("login"); location.hash = "";
});

/* ---------- hub ---------- */
async function loadMe() { me = await api("GET", "/api/me"); renderMe(); return me; }
async function enterHub(tab) {
  await loadMe();
  show("hubView");
  renderHub();
  selectTab(tab || "missions");
}
function selectTab(tab) {
  for (const b of document.querySelectorAll(".tabs-nav button")) b.setAttribute("aria-selected", b.dataset.tab === tab);
  for (const t of ["missions", "techniques", "loadout", "leaderboard"]) $("tab-" + t).hidden = t !== tab;
  if (location.hash !== "#" + tab) history.replaceState(null, "", "#" + tab);
  if (tab === "leaderboard") loadBoard();
  if (tab === "loadout") { loadoutDraft = me.techniques.filter(t => t.slot != null).sort((a, b) => a.slot - b.slot).map(t => t.id); renderLoadout(); }
}
for (const b of document.querySelectorAll(".tabs-nav button")) b.addEventListener("click", () => selectTab(b.dataset.tab));

function renderHub() {
  const active = me.activeBattle;
  $("resumeBar").hidden = !active;
  if (active) $("resumeFoe").textContent = active.enemy;
  renderMissions(); renderTechniques();
}
function renderMissions() {
  const list = $("missionList"); list.replaceChildren();
  for (const m of me.missions) {
    const card = el("article", "mission" + (m.unlocked ? "" : " locked"));
    card.append(el("div", "rank " + m.rank, m.rank));
    const body = el("div", "m-body");
    body.append(el("h3", null, m.name), el("p", null, m.brief));
    const meta = el("div", "m-meta");
    const foe = el("span"); foe.append("vs ", el("b", null, m.enemyInfo.name), ` · ${m.enemyInfo.title} · ${m.enemyInfo.maxHp} HP`); meta.append(foe);
    const rw = el("span"); rw.append(el("b", null, `${m.ryo} ryo`), " · ", el("b", null, `${m.xp} XP`)); meta.append(rw);
    if (!m.clears) meta.append(el("span", "first", `First clear +${m.firstBonus} ryo`));
    else meta.append(el("span", null, `Cleared ${m.clears}× · best ${m.bestTurns} turns`));
    body.append(meta);
    const act = el("div", "m-act");
    if (m.unlocked) {
      const btn = el("button", "primary", m.clears ? "Fight again" : "Start mission"); btn.type = "button";
      if (me.activeBattle) { btn.disabled = true; act.append(btn, el("span", "lock", "Finish your current battle first")); }
      else { btn.addEventListener("click", () => startMission(m.id, btn)); act.append(btn); }
    } else act.append(el("span", "lock", m.lockReason));
    card.append(body, act); list.append(card);
  }
}
function renderTechniques() {
  const list = $("techList"); list.replaceChildren();
  for (const t of me.techniques) {
    const card = el("article", "tech" + (t.locked ? " locked" : ""));
    const head = el("div", "tech-head"); head.append(el("h3", null, t.name), el("span", "cost" + (t.cost ? "" : " gain"), t.cost ? `${t.cost} energy` : `+${t.gain} energy`));
    card.append(head, el("p", null, t.desc));
    const foot = el("div", "tech-foot");
    if (t.owned) {
      const pips = el("div", "pips"); pips.append(`Rank ${roman(t.rank)} `);
      for (let i = 1; i <= me.maxRank; i++) pips.append(el("i", i <= t.rank ? "on" : ""));
      const left = el("div", "tech-left"); left.append(pips);
      if (t.slot != null) left.append(el("span", "chip eq", `Slot ${t.slot + 1}`));
      foot.append(left);
      if (t.upgradeCost) {
        const b = el("button", "ghost small", `Upgrade · ${t.upgradeCost} ryo`); b.type = "button"; b.disabled = me.player.ryo < t.upgradeCost;
        b.addEventListener("click", () => upgrade(t, b)); foot.append(b);
      } else foot.append(el("span", "chip", "Max rank"));
    } else if (t.locked) {
      foot.append(el("span", "lock", t.lockReason), el("span", "chip", `${t.price} ryo`));
    } else {
      foot.append(el("span", "hint", me.player.ryo < t.price ? `Need ${t.price - me.player.ryo} more ryo` : ""));
      const b = el("button", "primary small", `Buy · ${t.price} ryo`); b.type = "button"; b.disabled = me.player.ryo < t.price;
      b.addEventListener("click", () => buy(t, b)); foot.append(b);
    }
    card.append(foot); list.append(card);
  }
}
async function buy(t, btn) {
  btn.disabled = true;
  try { await api("POST", "/api/shop/buy", { technique: t.id }); await loadMe(); renderHub(); toast(`Learned ${t.name}.`); }
  catch (e) { toast(e.message, true); btn.disabled = false; }
}
async function upgrade(t, btn) {
  btn.disabled = true;
  try { const r = await api("POST", `/api/techniques/${t.id}/upgrade`); await loadMe(); renderHub(); toast(`${t.name} is now rank ${roman(r.rank)}.`); }
  catch (e) { toast(e.message, true); btn.disabled = false; }
}
function renderLoadout() {
  const slots = $("slots"); slots.replaceChildren();
  for (let i = 0; i < me.maxSlots; i++) {
    const id = loadoutDraft[i], t = id && me.techniques.find(x => x.id === id);
    const b = el("button", "slot" + (t ? " filled" : "")); b.type = "button";
    b.append(el("kbd", null, `Key ${i + 1}`));
    if (t) { b.append(el("b", null, t.name), el("span", null, `Rank ${roman(t.rank)} · ${t.cost ? t.cost + " energy" : "+" + t.gain + " energy"}`)); b.title = "Remove from loadout";
      b.addEventListener("click", () => { loadoutDraft.splice(i, 1); renderLoadout(); }); }
    else { b.append(el("span", null, "Empty")); b.disabled = true; }
    slots.append(b);
  }
  const owned = $("ownedList"); owned.replaceChildren();
  for (const t of me.techniques.filter(x => x.owned)) {
    const b = el("button", "own", t.name); b.type = "button";
    b.disabled = loadoutDraft.includes(t.id) || loadoutDraft.length >= me.maxSlots;
    b.addEventListener("click", () => { loadoutDraft.push(t.id); renderLoadout(); });
    owned.append(b);
  }
  $("saveLoadout").disabled = loadoutDraft.length === 0;
  $("loadoutMsg").textContent = loadoutDraft.length === 0 ? "Equip at least one technique." : "";
}
$("saveLoadout").addEventListener("click", async () => {
  try { await api("PUT", "/api/loadout", { slots: loadoutDraft }); await loadMe(); renderHub(); renderLoadout(); $("loadoutMsg").textContent = "Saved."; }
  catch (e) { $("loadoutMsg").textContent = e.message; }
});
async function loadBoard() {
  const tb = $("board"); tb.replaceChildren();
  try {
    const d = await api("GET", "/api/leaderboard");
    d.rows.forEach((r, i) => { const tr = el("tr", r.username === d.you ? "you" : "");
      for (const v of [i + 1, r.username, r.level, r.wins, r.clears]) tr.append(el("td", null, String(v))); tb.append(tr); });
  } catch (e) { toast(e.message, true); }
}
$("resumeBtn").addEventListener("click", resumeBattle);
$("forfeitHub").addEventListener("click", async () => {
  try { await api("POST", `/api/battles/${me.activeBattle.id}/forfeit`); await loadMe(); renderHub(); toast("Battle forfeited."); }
  catch (e) { toast(e.message, true); }
});

/* ---------- battle ---------- */
Engine.mount($("stage"), $("stageWrap"), $("banner"));
Engine.setHooks({ hud: updateHUD, log, moveName: techName, acting: (f, move) => setPrompt(`${f.name} uses ${techName(move)}.`, f.side === "p" ? "you" : "foe") });

function log(text, kind = "n") { const cls = { p: "p", e: "e", w: "w", t: "t" }[kind] || "n"; const d = el("div", cls, text); const L = $("log"); L.append(d); while (L.childNodes.length > 300) L.firstChild.remove(); L.scrollTop = L.scrollHeight; }
function setPrompt(text, kind) { $("prompt").className = "prompt" + (kind ? " " + kind : ""); $("promptText").textContent = text; }

function tags(f) {
  const t = [];
  if (f.status.guard) t.push(["guard", f.style === "monk" ? "Barrier" : "Guard"]);
  if (f.status.smoke) t.push(["smoke", "Hidden"]);
  if (f.status.burn) t.push(["burn", `Burn ${f.status.burn}`]);
  if (f.status.stun) t.push(["stun", "Stunned"]);
  if (f.status.charging) t.push(["storm", "Storm charged"]);
  for (const k in f.cooldowns) if (f.cooldowns[k] > 0) t.push(["cd", `${techName(k)} ${f.cooldowns[k]}`]);
  return t;
}
function updateHUD() {
  const P = Engine.P, E = Engine.E; if (!P || !E) return;
  for (const [f, s] of [[P, "P"], [E, "E"]]) {
    const pct = Math.max(0, f.hp) / f.maxHp * 100;
    $("fill" + s).style.width = pct + "%"; $("gh" + s).style.width = pct + "%"; $("en" + s).style.width = f.energy + "%";
    $("hp" + s).textContent = `${Math.max(0, f.hp)}/${f.maxHp} · ${f.energy} EN`;
    $("st" + s).replaceChildren(...tags(f).map(([c, txt]) => el("span", "tag " + c, txt)));
  }
  renderMoves();
}
const canUse = (f, id) => { const t = me.allTechniques[id]; return t && f.energy >= t.cost && !(f.cooldowns[id] > 0); };
function whyNot(f, id) { const t = me.allTechniques[id]; if (f.cooldowns[id] > 0) return `Ready in ${f.cooldowns[id]} turn${f.cooldowns[id] > 1 ? "s" : ""}`; if (f.energy < t.cost) return `Needs ${t.cost} energy`; return ""; }
function buildMoves() {
  const bar = $("movebar"); bar.replaceChildren();
  battle.state.p.moves.forEach((m, i) => {
    const t = me.allTechniques[m.id], b = el("button", "mv"); b.type = "button"; b.dataset.id = m.id;
    const row = el("span", "row"); row.append(el("kbd", null, String(i + 1)), el("span", "nm", `${t.name}${m.rank > 1 ? " " + roman(m.rank) : ""}`), el("span", "cost" + (t.cost ? "" : " gain"), t.cost ? `${t.cost} EN` : `+${t.gain} EN`));
    b.append(row, el("span", "ds", t.short), el("span", "why")); b.title = t.desc;
    b.addEventListener("click", () => choose(m.id)); bar.append(b);
  });
}
function renderMoves() {
  const P = Engine.P; if (!P || !battle) return;
  for (const b of $("movebar").children) { const why = whyNot(P, b.dataset.id); b.disabled = !choiceOpen || !!why; b.querySelector(".why").textContent = choiceOpen && why ? why : ""; }
}

function enterBattle(b) {
  battle = b;
  $("bMissionName").textContent = b.mission;
  const m = me.missions.find(x => x.id === b.state.missionId);
  $("bMissionRank").textContent = m ? `${m.rank}-rank mission` : "Mission";
  $("nameP").textContent = b.state.p.name; $("nameE").textContent = b.state.e.name;
  $("endcard").hidden = true; $("log").replaceChildren(); choiceOpen = false;
  show("battleView");
  history.replaceState(null, "", "#battle");
  Engine.setup(b.state); buildMoves(); updateHUD();
}
async function startMission(id, btn) {
  if (busy) return; busy = true; if (btn) btn.disabled = true;
  try {
    const d = await api("POST", "/api/battles", { mission: id });
    enterBattle(d.battle);
    log(`${d.battle.state.e.name} — ${d.battle.state.e.title}`, "t");
    await Engine.playEvents(d.events);
    openChoice();
  } catch (e) { toast(e.message, true); if (btn) btn.disabled = false; }
  finally { busy = false; }
}
async function resumeBattle() {
  try {
    const d = await api("GET", "/api/battles/active");
    enterBattle(d.battle); log("Battle resumed.", "t"); openChoice();
  } catch (e) { toast(e.message, true); await loadMe(); renderHub(); }
}
function openChoice() {
  if (!battle || battle.state.phase === "over") return;
  choiceOpen = true; renderMoves();
  const E = Engine.E;
  if ($("auto").checked) {
    const r = runStrategy(true);
    if (r.ok) { setPrompt(`Strategy picks ${techName(r.id)}.`, "you"); setTimeout(() => choose(r.id), 450); return; }
    $("auto").checked = false;
  }
  if (E.status.charging) setPrompt(`${E.name}'s storm lands next turn. Break it with Shuriken or Thunder Palm, guard, or race it.`, "warn");
  else setPrompt("Your turn. Choose a technique.", "you");
}
async function choose(id) {
  if (!choiceOpen || busy || !canUse(Engine.P, id)) return;
  choiceOpen = false; busy = true; renderMoves(); setPrompt("…", "");
  try {
    const d = await api("POST", `/api/battles/${battle.id}/turn`, { move: id });
    battle.state = d.battle.state;
    await Engine.playEvents(d.events);
    if (d.reward) { finishBattle(d); return; }
    openChoice();
  } catch (e) {
    setPrompt(e.message, "err");
    if (e.status === 404) { setTimeout(() => enterHub("missions"), 1200); return; }
    choiceOpen = true; renderMoves();
  } finally { busy = false; }
}
function finishBattle(d) {
  const r = d.reward; if (d.player) { me.player = d.player; renderMe(); }
  setPrompt(r.won ? "Victory." : "Defeat.", r.won ? "you" : "foe");
  setTimeout(() => {
    $("endTitle").textContent = r.won ? "Victory" : "Defeat";
    const ul = $("endRewards"); ul.replaceChildren();
    const li = (label, val, cls) => { const x = el("li", cls); x.append(label + " ", el("b", null, val)); ul.append(x); };
    if (r.ryo) li("Ryo", `+${r.ryo}`);
    if (r.firstClear) li("First clear bonus", `+${r.bonus} ryo`, "gold");
    li("Experience", `+${r.xp} XP`);
    if (r.levelTo > r.levelFrom) li("Level up!", `${r.levelFrom} → ${r.levelTo}`, "gold");
    if (!r.won) ul.append(el("li", null, "Upgrade techniques or try a different loadout."));
    $("endcard").hidden = false; $("endBack").focus({ preventScroll: true });
  }, 1400);
}
$("endBack").addEventListener("click", () => enterHub("missions"));
$("endAgain").addEventListener("click", async () => { await loadMe(); startMission(battle.state.missionId); });
$("forfeitBtn").addEventListener("click", async () => {
  if (!battle || busy) return;
  try { await api("POST", `/api/battles/${battle.id}/forfeit`); } catch {}
  battle = null; enterHub("missions"); toast("Battle forfeited. It counts as a loss.");
});
document.addEventListener("keydown", e => {
  if ($("battleView").hidden || (e.target.closest && e.target.closest("textarea,input"))) return;
  const i = "123456".indexOf(e.key);
  if (i >= 0 && battle && battle.state.p.moves[i]) { choose(battle.state.p.moves[i].id); e.preventDefault(); }
});
for (const [tab, pane, otherTab, otherPane] of [["tabLog", "paneLog", "tabStrat", "paneStrat"], ["tabStrat", "paneStrat", "tabLog", "paneLog"]])
  $(tab).addEventListener("click", () => { $(tab).setAttribute("aria-selected", "true"); $(otherTab).setAttribute("aria-selected", "false"); $(pane).hidden = false; $(otherPane).hidden = true; });

/* ---------- strategy script ---------- */
const SAMPLE = `// Runs at the start of each of your turns when Autoplay is on.
// Return the id of a technique in your loadout:
//   strike, shuriken, guard, meditate, fireball, smoke, windblade, phoenix, thunderpalm
// me / foe have: hp, maxHp, energy, burn, stunned, guarding, charging, hidden
// me.can("fireball") is true when it's equipped, affordable and off cooldown.

if (foe.charging) {
  if (me.can("thunderpalm")) return "thunderpalm"
  return me.can("shuriken") ? "shuriken" : "guard"
}
if (me.hp < me.maxHp * 0.35 && me.can("meditate")) return "meditate"
if (me.can("phoenix")) return "phoenix"
if (foe.guarding && me.can("windblade")) return "windblade"
if (me.can("fireball") && foe.burn === 0) return "fireball"
if (me.energy < 20 && me.hp < me.maxHp * 0.6) return "guard"
return "strike"
`;
const stratEl = $("strategy"), stratMsg = $("stratMsg");
let saved = null; try { saved = localStorage.getItem("koda-strategy-v2"); } catch {}
stratEl.value = saved || SAMPLE;
stratEl.addEventListener("input", () => { try { localStorage.setItem("koda-strategy-v2", stratEl.value); } catch {} });
stratEl.addEventListener("keydown", e => { if (e.key === "Tab" && !e.shiftKey) { e.preventDefault(); const s = stratEl.selectionStart, en = stratEl.selectionEnd;
  stratEl.value = stratEl.value.slice(0, s) + "  " + stratEl.value.slice(en); stratEl.selectionStart = stratEl.selectionEnd = s + 2; } });
const view = f => ({ hp: f.hp, maxHp: f.maxHp, energy: f.energy, burn: f.status.burn || 0, stunned: !!f.status.stun, guarding: !!f.status.guard, charging: !!f.status.charging, hidden: !!f.status.smoke });
function runStrategy(live) {
  const P = Engine.P, E = Engine.E, ids = battle ? battle.state.p.moves.map(m => m.id) : [];
  try {
    if (!P) throw new Error("Start a battle to test the script.");
    const me_ = { ...view(P), can: id => ids.includes(id) && canUse(P, id) };
    const id = new Function("me", "foe", "turn", stratEl.value)(me_, view(E), battle.state.turn);
    if (!ids.includes(id)) throw new Error(`Returned ${JSON.stringify(id)}, which isn't in your loadout (${ids.join(", ")}).`);
    if (!canUse(P, id)) throw new Error(`Returned "${id}", but it isn't available: ${whyNot(P, id).toLowerCase()}.`);
    stratMsg.className = "strat-msg"; stratMsg.textContent = `Turn ${battle.state.turn}: strategy picked "${id}".`;
    return { ok: true, id };
  } catch (e) {
    stratMsg.className = "strat-msg err"; stratMsg.textContent = (e.name === "SyntaxError" ? "Syntax error: " : "") + e.message + (live ? "\nAutoplay turned off. Fix the script and switch it back on." : "");
    if (live) log("Strategy error. Autoplay off.", "w");
    return { ok: false };
  }
}
$("testStrat").addEventListener("click", () => runStrategy(false));
$("resetStrat").addEventListener("click", () => { stratEl.value = SAMPLE; try { localStorage.removeItem("koda-strategy-v2"); } catch {} stratMsg.className = "strat-msg"; stratMsg.textContent = "Example restored."; });
$("auto").addEventListener("change", () => { if ($("auto").checked && choiceOpen && !busy) { const r = runStrategy(true); if (r.ok) choose(r.id); else $("auto").checked = false; } });

/* ---------- boot ---------- */
(async () => {
  try {
    await loadMe();
    const want = location.hash.slice(1);
    if (want === "battle" && me.activeBattle) return resumeBattle();
    await enterHub(["missions", "techniques", "loadout", "leaderboard"].includes(want) ? want : "missions");
  } catch (e) {
    if (e.status !== 401) $("authError").textContent = e.message;
    show("authView"); setMode("login");
  }
})();
})();
