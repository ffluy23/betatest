// battle.js

import { auth, db } from "./firebase.js"
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js"
import {
  doc, collection, getDoc, getDocs, updateDoc, addDoc, deleteDoc,
  onSnapshot, query, orderBy, increment
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js"
import { moves } from "./moves.js"
import { getTypeMultiplier } from "./typeChart.js"
import {
  statusName, josa as josaEH,
  applyMoveEffect, checkPreActionStatus, checkConfusion,
  applyEndOfTurnDamage, applyWeatherEffect,
  getStatusSpdPenalty
} from "./effecthandler.js"
import { fadeBgmOut } from "./intro.js"

const roomRef = doc(db, "rooms", ROOM_ID)
const logsRef = collection(db, "rooms", ROOM_ID, "logs")

const SFX_DICE = "https://slippery-copper-mzpmcmc2ra.edgeone.app/soundreality-bicycle-bell-155622.mp3"
const SFX_BTN  = "https://usual-salmon-mnqxptwyvw.edgeone.app/Pokemon%20(A%20Button)%20-%20Sound%20Effect%20(HD)%20(1)%20(1).mp3"

function playSound(url) {
  const a = new Audio(url); a.volume = 0.6; a.play().catch(() => {})
}

function popDiceNum(el) {
  if (!el) return
  el.classList.remove("pop"); void el.offsetWidth; el.classList.add("pop")
  el.addEventListener("animationend", () => el.classList.remove("pop"), { once: true })
}

function showBattlePopup(prefix, type) {
  const wrap = document.querySelector(`#${prefix}-pokemon-area .portrait-wrap`)
    ?? document.getElementById(`${prefix}-pokemon-area`)
  if (!wrap) return
  const el = document.createElement("div")
  el.className = `battle-popup ${type}`
  el.innerText = type === "critical" ? "급소!" : "회피!"
  wrap.style.position = "relative"; wrap.appendChild(el)
  void el.offsetWidth; el.classList.add("show")
  el.addEventListener("animationend", () => el.remove(), { once: true })
}

let mySlot   = null, myUid  = null, myTurn = false
let gameStarted = false, diceShown = false, actionDone = false, gameOver = false
let battleIntroSequenceStarted = false
let lastHitEventTs = 0, lastDiceEventTs = 0

const isSpectator = new URLSearchParams(location.search).get("spectator") === "true"

function wait(ms) { return new Promise(r => setTimeout(r, ms)) }
function josa(w, t) { return josaEH(w, t) }
function rollD10() { return Math.floor(Math.random() * 10) + 1 }
function isAllFainted(entry) { return entry.every(p => p.hp <= 0) }

function defaultRanks() { return { atk: 0, atkTurns: 0, def: 0, defTurns: 0, spd: 0, spdTurns: 0 } }
function getActiveRank(pokemon, key) {
  const r = pokemon.ranks ?? {}
  return (r[`${key}Turns`] ?? 0) > 0 ? (r[key] ?? 0) : 0
}
function tickMyRanks(pokemon) {
  if (!pokemon.ranks) return []
  const r = pokemon.ranks, msgs = []
  if (r.atkTurns > 0) { r.atkTurns--; if (!r.atkTurns) { r.atk = 0; msgs.push(`${pokemon.name}의 공격 랭크가 원래대로 돌아왔다!`) } }
  if (r.defTurns > 0) { r.defTurns--; if (!r.defTurns) { r.def = 0; msgs.push(`${pokemon.name}의 방어 랭크가 원래대로 돌아왔다!`) } }
  if (r.spdTurns > 0) { r.spdTurns--; if (!r.spdTurns) { r.spd = 0; msgs.push(`${pokemon.name}의 스피드 랭크가 원래대로 돌아왔다!`) } }
  return msgs
}

function clearRankStack(pokemon) {
  pokemon.lastRankMove = null
  pokemon.rankStack    = 0
}

function resetRankStack(pokemon) {
  pokemon.lastRankMove = null
  pokemon.rankStack    = 0
  if (pokemon.ranks) {
    pokemon.ranks.atk = 0; pokemon.ranks.atkTurns = 0
    pokemon.ranks.def = 0; pokemon.ranks.defTurns = 0
    pokemon.ranks.spd = 0; pokemon.ranks.spdTurns = 0
  }
}

function applyRankChanges(r, self, target, moveName) {
  if (!r) return []
  const msgs = []

  const roll = r.chance !== undefined ? Math.random() < r.chance : true
  if (!roll) return []

  const selfR   = { ...defaultRanks(), ...(self.ranks   ?? {}) }
  const targetR = { ...defaultRanks(), ...(target.ranks ?? {}) }

  const isSameMove = moveName && self.lastRankMove === moveName
  const stack = self.rankStack ?? 0

  if (moveName) {
    if (!isSameMove) {
      self.lastRankMove = moveName
      self.rankStack    = 1
    } else if (stack >= 2) {
      selfR.atk = 0; selfR.atkTurns = 0
      selfR.def = 0; selfR.defTurns = 0
      selfR.spd = 0; selfR.spdTurns = 0
      self.rankStack = 1
    } else {
      self.rankStack = stack + 1
    }
  }

  if (r.atk !== undefined) {
    if (r.atk > 0) {
      const prev = selfR.atk
      selfR.atk = Math.min(4, selfR.atk + r.atk); selfR.atkTurns = r.turns ?? 2
      msgs.push(`${self.name}의 공격이 올라갔다! (+${selfR.atk - prev})`)
    } else if (r.atk < 0) {
      if (selfR.atk === 0) msgs.push(`${self.name}의 공격은 더 이상 내려가지 않는다!`)
      else { const prev = selfR.atk; selfR.atk = Math.max(0, selfR.atk + r.atk); selfR.atkTurns = r.turns ?? 2; msgs.push(`${self.name}의 공격이 내려갔다! (${selfR.atk - prev})`) }
    }
  }
  if (r.def !== undefined) {
    if (r.def > 0) {
      const prev = selfR.def
      selfR.def = Math.min(3, selfR.def + r.def); selfR.defTurns = r.turns ?? 2
      msgs.push(`${self.name}의 방어가 올라갔다! (+${selfR.def - prev})`)
    } else if (r.def < 0) {
      if (selfR.def === 0) msgs.push(`${self.name}의 방어는 더 이상 내려가지 않는다!`)
      else { const prev = selfR.def; selfR.def = Math.max(0, selfR.def + r.def); selfR.defTurns = r.turns ?? 2; msgs.push(`${self.name}의 방어가 내려갔다! (${selfR.def - prev})`) }
    }
  }
  if (r.spd !== undefined) {
    if (r.spd > 0) {
      const prev = selfR.spd
      selfR.spd = Math.min(5, selfR.spd + r.spd); selfR.spdTurns = r.turns ?? 2
      msgs.push(`${self.name}의 스피드가 올라갔다! (+${selfR.spd - prev}%p)`)
    } else if (r.spd < 0) {
      if (selfR.spd === 0) msgs.push(`${self.name}의 스피드는 더 이상 내려가지 않는다!`)
      else { const prev = selfR.spd; selfR.spd = Math.max(0, selfR.spd + r.spd); selfR.spdTurns = r.turns ?? 2; msgs.push(`${self.name}의 스피드가 내려갔다! (${selfR.spd - prev}%p)`) }
    }
  }

  if (r.targetAtk !== undefined) {
    if (r.targetAtk < 0) {
      if (targetR.atk === 0) msgs.push(`${target.name}의 공격은 더 이상 내려가지 않는다!`)
      else { const prev = targetR.atk; targetR.atk = Math.max(0, targetR.atk + r.targetAtk); targetR.atkTurns = r.turns ?? 2; msgs.push(`${target.name}의 공격이 내려갔다! (${targetR.atk - prev})`) }
    } else if (r.targetAtk > 0) {
      const prev = targetR.atk; targetR.atk = Math.min(4, targetR.atk + r.targetAtk); targetR.atkTurns = r.turns ?? 2
      msgs.push(`${target.name}의 공격이 올라갔다! (+${targetR.atk - prev})`)
    }
  }
  if (r.targetDef !== undefined) {
    if (r.targetDef < 0) {
      if (targetR.def === 0) msgs.push(`${target.name}의 방어는 더 이상 내려가지 않는다!`)
      else { const prev = targetR.def; targetR.def = Math.max(0, targetR.def + r.targetDef); targetR.defTurns = r.turns ?? 2; msgs.push(`${target.name}의 방어가 내려갔다! (${targetR.def - prev})`) }
    } else if (r.targetDef > 0) {
      const prev = targetR.def; targetR.def = Math.min(3, targetR.def + r.targetDef); targetR.defTurns = r.turns ?? 2
      msgs.push(`${target.name}의 방어가 올라갔다! (+${targetR.def - prev})`)
    }
  }
  if (r.targetSpd !== undefined) {
    if (r.targetSpd < 0) {
      if (targetR.spd === 0) msgs.push(`${target.name}의 스피드는 더 이상 내려가지 않는다!`)
      else { const prev = targetR.spd; targetR.spd = Math.max(0, targetR.spd + r.targetSpd); targetR.spdTurns = r.turns ?? 2; msgs.push(`${target.name}의 스피드가 내려갔다! (${targetR.spd - prev}%p)`) }
    } else if (r.targetSpd > 0) {
      const prev = targetR.spd; targetR.spd = Math.min(5, targetR.spd + r.targetSpd); targetR.spdTurns = r.turns ?? 2
      msgs.push(`${target.name}의 스피드가 올라갔다! (+${targetR.spd - prev}%p)`)
    }
  }

  self.ranks   = selfR
  target.ranks = targetR
  return msgs
}

function calcHit(attacker, moveInfo, defender) {
  if (Math.random() * 100 >= (moveInfo.accuracy ?? 100)) return { hit: false, hitType: "missed" }
  if (moveInfo.alwaysHit || moveInfo.skipEvasion) return { hit: true, hitType: "hit" }
  const as = Math.max(1, (attacker.speed ?? 3) - getStatusSpdPenalty(attacker))
  const ds = Math.max(1, (defender.speed  ?? 3) - getStatusSpdPenalty(defender))
  const ev = Math.min(99, Math.max(0, 5 * (ds - as)) + Math.max(0, getActiveRank(defender, "spd")))
  return Math.random() * 100 < ev ? { hit: false, hitType: "evaded" } : { hit: true, hitType: "hit" }
}

function calcDamage(attacker, moveName, defender, atkRank = 0, defRank = 0) {
  const move = moves[moveName]
  if (!move) return { damage: 0, multiplier: 1, stab: false, dice: 0, critical: false }
  const dice = rollD10()
  const defTypes = Array.isArray(defender.type) ? defender.type : [defender.type]
  let multiplier = 1
  for (const dt of defTypes) multiplier *= getTypeMultiplier(move.type, dt)
  if (multiplier === 0) return { damage: 0, multiplier: 0, stab: false, dice, critical: false }
  const atkTypes = Array.isArray(attacker.type) ? attacker.type : [attacker.type]
  const stab = atkTypes.includes(move.type)
  const base = (move.power ?? 40) + (attacker.attack ?? 3) * 4 + dice
  const raw  = Math.floor(base * multiplier * (stab ? 1.3 : 1))
  const afterAtk = Math.max(0, raw + Math.max(-raw, atkRank))
  const afterDef = Math.max(0, afterAtk - (defender.defense ?? 3) * 5)
  const baseDmg  = Math.max(0, afterDef - Math.min(3, Math.max(0, defRank)) * 3)
  const critical = Math.random() * 100 < Math.min(100, (attacker.attack ?? 3) * 2)
  return { damage: critical ? Math.floor(baseDmg * 1.5) : baseDmg, multiplier, stab, dice, critical }
}

function updateHpBar(barId, textId, hp, maxHp, showNumbers) {
  const bar = document.getElementById(barId), txt = textId ? document.getElementById(textId) : null
  if (!bar) return
  const pct = maxHp > 0 ? Math.max(0, Math.min(100, (hp / maxHp) * 100)) : 0
  bar.style.width = pct + "%"
  bar.style.backgroundColor = pct > 50 ? "#4caf50" : pct > 20 ? "#ff9800" : "#f44336"
  if (txt) txt.innerText = showNumbers ? `HP: ${hp} / ${maxHp}` : ""
}

function updatePortrait(prefix, pokemon, animate = false) {
  const img = document.getElementById(`${prefix}-portrait`)
  const placeholder = document.getElementById(`${prefix}-portrait-placeholder`)
  if (!img) return
  if (!pokemon?.portrait) {
    img.classList.remove("visible"); img.style.display = "none"
    if (placeholder) placeholder.style.display = "block"; return
  }
  if (placeholder) placeholder.style.display = "none"
  img.classList.remove("visible", "slide-in-my", "slide-in-enemy")
  img.style.display = "block"; img.src = pokemon.portrait; img.alt = pokemon.name
  setTimeout(() => {
    img.classList.add("visible", ...(animate ? [prefix === "my" ? "slide-in-my" : "slide-in-enemy"] : []))
  }, 80)
}

function triggerAttackEffect(atkPfx, defPfx) {
  return new Promise(resolve => {
    const atkArea = document.getElementById(`${atkPfx}-pokemon-area`)
    const defArea = document.getElementById(`${defPfx}-pokemon-area`)
    const wrapper = document.getElementById("battle-wrapper")
    if (atkArea) { atkArea.classList.add("attacker-flash"); atkArea.addEventListener("animationend", () => atkArea.classList.remove("attacker-flash"), { once: true }) }
    if (wrapper) { wrapper.classList.add("screen-shake"); wrapper.addEventListener("animationend", () => wrapper.classList.remove("screen-shake"), { once: true }) }
    setTimeout(() => {
      if (defArea) { defArea.classList.add("defender-hit"); defArea.addEventListener("animationend", () => { defArea.classList.remove("defender-hit"); resolve() }, { once: true }) }
      else resolve()
    }, 120)
  })
}

function triggerBlink(prefix) {
  return new Promise(resolve => {
    const area = document.getElementById(`${prefix}-pokemon-area`)
    if (!area) { resolve(); return }
    area.classList.add("blink-damage")
    area.addEventListener("animationend", () => { area.classList.remove("blink-damage"); resolve() }, { once: true })
  })
}

let renderedLogIds = new Set(), typingQueue = [], isTyping = false

function processQueue() {
  if (isTyping || typingQueue.length === 0) return
  isTyping = true
  const { text, resolve } = typingQueue.shift()
  const log = document.getElementById("battle-log")
  if (!log) { isTyping = false; if (resolve) resolve(); processQueue(); return }
  const line = document.createElement("p"); log.appendChild(line)
  const chars = [...text]; let i = 0
  function typeNext() {
    if (i >= chars.length) { isTyping = false; if (resolve) resolve(); setTimeout(processQueue, 80); return }
    line.textContent += chars[i++]; log.scrollTop = log.scrollHeight; setTimeout(typeNext, 18)
  }
  typeNext()
}

async function addLog(text) { await addDoc(logsRef, { text, ts: Date.now() }) }
async function addLogs(lines) {
  const base = Date.now()
  for (let i = 0; i < lines.length; i++) await addDoc(logsRef, { text: lines[i], ts: base + i })
}

function listenLogs() {
  const q = query(logsRef, orderBy("ts"))
  onSnapshot(q, snap => {
    snap.docs.forEach(d => {
      if (renderedLogIds.has(d.id)) return
      renderedLogIds.add(d.id)
      typingQueue.push({ text: d.data().text, resolve: null })
    })
    processQueue()
  })
}

async function grantWinCoins(winnerName, data) {
  if (isSpectator) return
  const myName = mySlot === "p1" ? data.player1_name : data.player2_name
  if (winnerName !== myName) return
  try {
    await updateDoc(doc(db, "users", myUid), { coins: increment(300) })
    await addLog("🏆 승리 보상으로 300ZP를 받았다!")
  } catch(e) { console.warn("코인 지급 실패", e) }
}

// ── 게임 로그를 games 서브컬렉션에 저장
// leaveGame() 호출 전에 반드시 실행해야 함
async function saveGameLog() {
  // 스펙테이터나 p2는 저장 안 함 (p1만 저장 담당)
  if (isSpectator || mySlot !== "p1") return
  try {
    const roomSnap = await getDoc(roomRef)
    const data = roomSnap.data()
    const logSnap = await getDocs(query(logsRef, orderBy("ts")))
    const logs = logSnap.docs.map(d => ({ text: d.data().text, ts: d.data().ts }))
    const gamesRef = collection(db, "rooms", ROOM_ID, "games")
    await addDoc(gamesRef, {
      p1:       data.player1_name ?? "???",
      p2:       data.player2_name ?? "???",
      winner:   data.winner ?? null,
      logs,
      createdAt: Date.now()
    })
  } catch(e) { console.warn("게임 로그 저장 실패", e) }
}

function animateDiceSingle(slot, finalRoll, p1Name, p2Name) {
  return new Promise(resolve => {
    const wrap = document.getElementById("dice-wrap")
    const p1Box = document.getElementById("dice-box-p1"), p2Box = document.getElementById("dice-box-p2")
    const diceEl = document.getElementById(slot === "p1" ? "dice-p1" : "dice-p2")
    const nameEl = document.getElementById(slot === "p1" ? "p1-name-dice" : "p2-name-dice")
    if (!wrap || !diceEl) { resolve(); return }
    if (p1Box) p1Box.style.display = slot === "p1" ? "block" : "none"
    if (p2Box) p2Box.style.display = slot === "p2" ? "block" : "none"
    if (nameEl) nameEl.innerText = slot === "p1" ? (p1Name ?? "Player1") : (p2Name ?? "Player2")
    wrap.style.display = "flex"
    let count = 0
    const iv = setInterval(() => {
      diceEl.innerText = rollD10(); count++
      if (count >= 16) {
        clearInterval(iv); diceEl.innerText = finalRoll
        popDiceNum(diceEl); playSound(SFX_DICE)
        setTimeout(() => { wrap.style.display = "none"; resolve() }, 1000)
      }
    }, 60)
  })
}

function animateDualDice(p1Roll, p2Roll, onDone, p1Name, p2Name) {
  const p1El = document.getElementById("dice-p1"), p2El = document.getElementById("dice-p2")
  const wrap = document.getElementById("dice-wrap")
  const p1Box = document.getElementById("dice-box-p1"), p2Box = document.getElementById("dice-box-p2")
  const p1NameEl = document.getElementById("p1-name-dice"), p2NameEl = document.getElementById("p2-name-dice")
  if (!wrap) { onDone(); return }
  if (p1NameEl) p1NameEl.innerText = p1Name ?? "Player1"
  if (p2NameEl) p2NameEl.innerText = p2Name ?? "Player2"
  if (p1Box) p1Box.style.display = "block"
  if (p2Box) p2Box.style.display = "block"
  wrap.style.display = "flex"
  let count = 0
  const iv = setInterval(() => {
    if (p1El) p1El.innerText = rollD10()
    if (p2El) p2El.innerText = rollD10()
    if (++count >= 22) {
      clearInterval(iv)
      if (p1El) p1El.innerText = p1Roll
      if (p2El) p2El.innerText = p2Roll
      popDiceNum(p1Roll >= p2Roll ? p1El : p2El); playSound(SFX_DICE)
      setTimeout(() => { wrap.style.display = "none"; onDone() }, 1800)
    }
  }, 60)
}

onAuthStateChanged(auth, async user => {
  if (!user) return
  myUid = user.uid
  const roomSnap = await getDoc(roomRef), room = roomSnap.data()
  mySlot = room.player1_uid === myUid ? "p1" : "p2"
  if (isSpectator) {
    const td = document.getElementById("turn-display")
    if (td) { td.innerText = "관전 중"; td.style.color = "gray" }
    const lb = document.getElementById("leaveBtn")
    if (lb) { lb.style.display = "inline-block"; lb.disabled = false; lb.innerText = "관전 종료"; lb.onclick = leaveAsSpectator }
    document.getElementById("battle-screen").classList.add("visible")
  }
  waitForBattleReady()
  listenLogs()
})

function waitForBattleReady() {
  const screen = document.getElementById("battle-screen")
  if (screen.classList.contains("visible")) { listenRoom(); return }
  const obs = new MutationObserver(() => {
    if (screen.classList.contains("visible")) { obs.disconnect(); listenRoom() }
  })
  obs.observe(screen, { attributes: true, attributeFilter: ["class"] })
}

async function initTurn(data) {
  if (gameStarted) return
  gameStarted = true
  const p1 = data.p1_entry[0], p2 = data.p2_entry[0]
  const r1 = rollD10(), r2 = rollD10()
  const fs = (p1.speed ?? 3) + r1 >= (p2.speed ?? 3) + r2 ? "p1" : "p2"
  await updateDoc(roomRef, {
    first_slot: fs, first_pokemon_name: fs === "p1" ? p1.name : p2.name,
    p1_dice: r1, p2_dice: r2
  })
}

async function runBattleIntroSequence(data) {
  const p1Name = data.player1_name, p2Name = data.player2_name
  const enemySlot = mySlot === "p1" ? "p2" : "p1"
  await addLog(`${p1Name}${josa(p1Name, "과와")} ${p2Name}의 승부가 시작됐다!`)
  await wait(3000)
  const base = Date.now()
  await addDoc(logsRef, { text: `${p1Name}${josa(p1Name, "은는")} ${data.p1_entry[0].name}${josa(data.p1_entry[0].name, "을를")} 내보냈다!`, ts: base })
  await addDoc(logsRef, { text: `${p2Name}${josa(p2Name, "은는")} ${data.p2_entry[0].name}${josa(data.p2_entry[0].name, "을를")} 내보냈다!`, ts: base + 1 })
  updatePortrait("my",    data[`${mySlot}_entry`][0],    true)
  updatePortrait("enemy", data[`${enemySlot}_entry`][0], true)
  await wait(800)
  await addLog(`${data.first_pokemon_name}의 선공!`)
  await updateDoc(roomRef, { current_turn: data.first_slot, turn_count: 1, intro_done: true })
}

function listenRoom() {
  onSnapshot(roomRef, async snap => {
    const data = snap.data(); if (!data) return
    document.getElementById("p1-name").innerText = data.player1_name ?? "대기..."
    document.getElementById("p2-name").innerText = data.player2_name ?? "대기..."
    const spectEl = document.getElementById("spectator-list")
    if (spectEl) { const n = data.spectator_names ?? []; spectEl.innerText = n.length > 0 ? "관전: " + n.join(", ") : "" }
    if (!data.p1_entry || !data.p2_entry) return
    const enemySlot = mySlot === "p1" ? "p2" : "p1"
    updateActiveUI(mySlot, data, "my"); updateActiveUI(enemySlot, data, "enemy")
    if (data.hit_event && data.hit_event.ts > lastHitEventTs) {
      lastHitEventTs = data.hit_event.ts
      triggerBlink(data.hit_event.defender === mySlot ? "my" : "enemy")
    }
    if (data.dice_event && data.dice_event.ts > lastDiceEventTs) {
      lastDiceEventTs = data.dice_event.ts
      animateDiceSingle(data.dice_event.slot, data.dice_event.roll, data.player1_name, data.player2_name)
    }
    if (data.game_over) { showGameOver(data); return }
    if (!data.current_turn) {
      if (!isSpectator && mySlot === "p1" && !gameStarted) await initTurn(data)
      if (!diceShown && data.p1_dice && data.p2_dice && data.first_slot) {
        diceShown = true
        animateDualDice(data.p1_dice, data.p2_dice, async () => {
          if (!isSpectator && mySlot === "p1" && !data.intro_done && !battleIntroSequenceStarted) {
            battleIntroSequenceStarted = true
            await runBattleIntroSequence(data)
          }
        }, data.player1_name, data.player2_name)
      }
      return
    }
    if (!isSpectator) {
      const wasMine = myTurn; myTurn = data.current_turn === mySlot
      if (!wasMine && myTurn) actionDone = false
      updateTurnUI(data)
    }
    updateBenchButtons(data); updateMoveButtons(data)
  })
}

function showGameOver(data) {
  fadeBgmOut(2000)
  const td = document.getElementById("turn-display")
  if (isSpectator) {
    if (td) { td.innerText = `🏆 ${data.winner}의 승리!`; td.style.color = "gold" }
  } else {
    const myName = mySlot === "p1" ? data.player1_name : data.player2_name
    const enemyName = mySlot === "p1" ? data.player2_name : data.player1_name
    const win = data.winner === myName
    if (td) { td.innerText = win ? `${enemyName}${josa(enemyName,"과와")}의 전투에서 승리했다!` : `${enemyName}${josa(enemyName,"과와")}의 전투에서 패배했다…`; td.style.color = win ? "gold" : "red" }
  }
  for (let i = 0; i < 4; i++) { const b = document.getElementById(`move-btn-${i}`); if (b) { b.disabled = true; b.onclick = null } }
  const bench = document.getElementById("bench-container"); if (bench) bench.innerHTML = ""
  if (!isSpectator) {
    const lb = document.getElementById("leaveBtn")
    if (lb) { lb.style.display = "inline-block"; lb.disabled = false; lb.innerText = "방 나가기"; lb.onclick = leaveGame }
  }
}

async function leaveAsSpectator() {
  const snap = await getDoc(roomRef), data = snap.data()
  await updateDoc(roomRef, {
    spectators:      (data.spectators      ?? []).filter(u => u !== myUid),
    spectator_names: (data.spectator_names ?? []).filter((_, i) => (data.spectators ?? [])[i] !== myUid)
  })
  location.href = "../main.html"
}

async function leaveGame() {
  // 1. 게임 로그 먼저 저장 (p1만 담당)
  await saveGameLog()

  // 2. logs 서브컬렉션 삭제
  const logSnap = await getDocs(logsRef)
  await Promise.all(logSnap.docs.map(d => deleteDoc(d.ref)))

  // 3. 방 초기화
  await updateDoc(roomRef, {
    player1_uid: null, player1_name: null, player1_ready: false,
    player2_uid: null, player2_name: null, player2_ready: false,
    game_started: false, game_over: false, winner: null,
    current_turn: null, turn_count: 0, p1_entry: null, p2_entry: null,
    p1_active_idx: 0, p2_active_idx: 0, p1_dice: null, p2_dice: null,
    first_slot: null, first_pokemon_name: null, intro_done: false,
    intro_ready_p1: false, intro_ready_p2: false,
    hit_event: null, background: null, dice_event: null
  })
  location.href = "../main.html"
}

function updateActiveUI(slot, data, prefix) {
  const activeIdx = data[`${slot}_active_idx`], pokemon = data[`${slot}_entry`]?.[activeIdx]
  if (!pokemon) return
  const st = pokemon.status ? ` [${statusName(pokemon.status)}]` : ""
  const cf = (pokemon.confusion ?? 0) > 0 ? " [혼란]" : ""
  const nameEl = document.getElementById(`${prefix}-active-name`)
  if (nameEl) nameEl.innerText = data.intro_done ? (pokemon.name + st + cf) : "???"
  updateHpBar(`${prefix}-hp-bar`, `${prefix}-active-hp`, pokemon.hp, pokemon.maxHp, prefix === "my" && !!data.intro_done)
  if (data.intro_done) updatePortrait(prefix, pokemon)
}

function updateMoveButtons(data) {
  const typeColors = {
    "노말": "#949495", "불": "#e56c3e", "물": "#5185c5", "전기": "#fbb917", "풀": "#66a945",
    "얼음": "#6dc8eb", "격투": "#e09c40", "독": "#735198", "땅": "#9c7743", "바위": "#bfb889",
    "비행": "#a2c3e7", "에스퍼": "#dd6b7b", "벌레": "#9fa244", "고스트": "#684870",
    "드래곤": "#535ca8", "악": "#4c4948", "강철": "#69a9c7", "페어리": "#dab4d4"
  }
  const myPokemon = data[`${mySlot}_entry`]?.[data[`${mySlot}_active_idx`]]
  const fainted = !myPokemon || myPokemon.hp <= 0, movesArr = myPokemon?.moves ?? []
  for (let i = 0; i < 4; i++) {
    const btn = document.getElementById(`move-btn-${i}`); if (!btn) continue
    if (i >= movesArr.length) { btn.innerHTML = '<span style="font-size:13px;">-</span>'; btn.disabled = true; btn.onclick = null; continue }
    const move = movesArr[i], moveInfo = moves[move.name]
    const accText = moveInfo?.alwaysHit ? "필중" : `${moveInfo?.accuracy ?? 100}%`
    btn.innerHTML = `<span style="display:block;font-size:13px;font-weight:bold;">${move.name}</span><span style="display:block;font-size:10px;opacity:0.85;">PP: ${move.pp} | ${accText}</span>`
    const color = typeColors[moveInfo?.type] ?? "#a0a0a0"
    btn.style.setProperty("--btn-color", color); btn.style.background = color
    btn.style.boxShadow = `inset 0 0 0 2px white, 0 0 0 2px ${color}`
    if (isSpectator || fainted || move.pp <= 0 || !myTurn || actionDone) { btn.disabled = true; btn.onclick = null }
    else { btn.disabled = false; btn.onclick = () => { playSound(SFX_BTN); useMove(i, data) } }
  }
}

function updateBenchButtons(data) {
  const bench = document.getElementById("bench-container"); bench.innerHTML = ""
  const myEntry = data[`${mySlot}_entry`], activeIdx = data[`${mySlot}_active_idx`]
  myEntry.forEach((pkmn, idx) => {
    if (idx === activeIdx) return
    const btn = document.createElement("button")
    if (pkmn.hp <= 0) { btn.innerHTML = `<span class="bench-name">${pkmn.name}</span><span class="bench-hp">기절</span>`; btn.disabled = true }
    else {
      btn.innerHTML = `<span class="bench-name">${pkmn.name}</span><span class="bench-hp">HP: ${pkmn.hp}/${pkmn.maxHp}</span>`
      btn.disabled = isSpectator || !myTurn || actionDone
      if (!isSpectator) btn.onclick = () => { playSound(SFX_BTN); switchPokemon(idx) }
    }
    bench.appendChild(btn)
  })
}

function updateTurnUI(data) {
  const el = document.getElementById("turn-display")
  if (el && !isSpectator) { el.innerText = myTurn ? "내 턴!" : "상대 턴..."; el.style.color = myTurn ? "green" : "gray" }
  const tc = document.getElementById("turn-count"); if (tc) tc.innerText = `${data.turn_count ?? 1}턴`
}

async function switchPokemon(newIdx) {
  if (isSpectator || !myTurn || actionDone || gameOver) return
  actionDone = true
  const snap = await getDoc(roomRef), data = snap.data()
  const enemySlot = mySlot === "p1" ? "p2" : "p1"
  const myEntry = data[`${mySlot}_entry`].map(p => ({ ...p, ranks: { ...defaultRanks(), ...(p.ranks ?? {}) } }))
  const myPokemon = myEntry[data[`${mySlot}_active_idx`]]
  const myName = mySlot === "p1" ? data.player1_name : data.player2_name

  resetRankStack(myPokemon)

  const prev = myPokemon.name, next = myEntry[newIdx].name
  await addLog(`돌아와, ${prev}!`); await wait(400)
  await addLog(`${myName}${josa(myName, "은는")} ${next}${josa(next, "을를")} 내보냈다!`); await wait(200)
  await updateDoc(roomRef, { [`${mySlot}_entry`]: myEntry, [`${mySlot}_active_idx`]: newIdx, current_turn: enemySlot, turn_count: (data.turn_count ?? 1) + 1 })
}

async function useMove(moveIdx, data) {
  if (isSpectator || !myTurn || actionDone || gameOver) return
  actionDone = true; updateMoveButtons(data)

  const snap = await getDoc(roomRef), freshData = snap.data()
  const enemySlot = mySlot === "p1" ? "p2" : "p1"
  const myActiveIdx = freshData[`${mySlot}_active_idx`], eneActiveIdx = freshData[`${enemySlot}_active_idx`]

  const myEntry = freshData[`${mySlot}_entry`].map(p => ({ ...p, moves: (p.moves ?? []).map(m => ({ ...m })), ranks: { ...defaultRanks(), ...(p.ranks ?? {}) } }))
  const enemyEntry = freshData[`${enemySlot}_entry`].map(p => ({ ...p, ranks: { ...defaultRanks(), ...(p.ranks ?? {}) } }))
  const myPokemon = myEntry[myActiveIdx], enePokemon = enemyEntry[eneActiveIdx]

  if (myPokemon.hp <= 0) { actionDone = false; return }
  const moveData = myPokemon.moves[moveIdx]
  if (!moveData || moveData.pp <= 0) { actionDone = false; return }

  const myName = mySlot === "p1" ? freshData.player1_name : freshData.player2_name
  const enemyName = enemySlot === "p1" ? freshData.player1_name : freshData.player2_name

  const preAction = checkPreActionStatus(myPokemon)
  for (const msg of preAction.msgs) { await addLog(msg); await wait(350) }
  if (preAction.blocked) {
    resetRankStack(myPokemon)
    await updateDoc(roomRef, { [`${mySlot}_entry`]: myEntry, current_turn: enemySlot, turn_count: (freshData.turn_count ?? 1) + 1 })
    return
  }

  const confResult = checkConfusion(myPokemon)
  for (const msg of confResult.msgs) { await addLog(msg); await wait(350) }
  if (confResult.selfHit) {
    resetRankStack(myPokemon)
    if (isAllFainted(myEntry)) {
      await updateDoc(roomRef, { [`${mySlot}_entry`]: myEntry, turn_count: (freshData.turn_count ?? 1) + 1, game_over: true, winner: enemyName, current_turn: null })
      await grantWinCoins(enemyName, freshData)
      await addLog(`${enemyName}의 승리!`)
    } else {
      await updateDoc(roomRef, { [`${mySlot}_entry`]: myEntry, current_turn: enemySlot, turn_count: (freshData.turn_count ?? 1) + 1 })
    }
    return
  }

  myPokemon.moves[moveIdx] = { ...moveData, pp: moveData.pp - 1 }
  const moveInfo = moves[moveData.name]

  await addLog(`${myPokemon.name}의 ${moveData.name}!`); await wait(300)

  const diceRoll = rollD10(), diceTs = Date.now()
  await updateDoc(roomRef, { dice_event: { slot: mySlot, roll: diceRoll, ts: diceTs } })
  await animateDiceSingle(mySlot, diceRoll, freshData.player1_name, freshData.player2_name)
  await updateDoc(roomRef, { dice_event: null })

  if (!moveInfo?.power) {
    const r = moveInfo?.rank
    const targetsEnemy = r && (r.targetAtk !== undefined || r.targetDef !== undefined || r.targetSpd !== undefined)
    || moveInfo?.targetSelf === false

    if (targetsEnemy) {
      const { hit, hitType } = calcHit(myPokemon, moveInfo, enePokemon)
      if (!hit) {
        await addLog(hitType === "evaded" ? `${enePokemon.name}에게는 맞지 않았다!` : `그러나 ${myPokemon.name}의 공격은 빗나갔다!`)
        await updateDoc(roomRef, { [`${mySlot}_entry`]: myEntry, [`${enemySlot}_entry`]: enemyEntry, current_turn: enemySlot, turn_count: (freshData.turn_count ?? 1) + 1 })
        return
      }
    } else {
      if (!moveInfo?.alwaysHit && Math.random() * 100 >= (moveInfo?.accuracy ?? 100)) {
        await addLog(`그러나 ${myPokemon.name}의 기술은 실패했다!`)
        await updateDoc(roomRef, { [`${mySlot}_entry`]: myEntry, [`${enemySlot}_entry`]: enemyEntry, current_turn: enemySlot, turn_count: (freshData.turn_count ?? 1) + 1 })
        return
      }
    }

    const rankMsgs = applyRankChanges(r, myPokemon, enePokemon, moveData.name)
    for (const msg of rankMsgs) { await addLog(msg); await wait(300) }
    const rankEffectMsgs = applyMoveEffect(moveInfo?.effect, myPokemon, enePokemon, 0)
    for (const msg of rankEffectMsgs) { await addLog(msg); await wait(280) }
    await updateDoc(roomRef, { [`${mySlot}_entry`]: myEntry, [`${enemySlot}_entry`]: enemyEntry, current_turn: enemySlot, turn_count: (freshData.turn_count ?? 1) + 1 })
    return
  }

  const atkRank = getActiveRank(myPokemon, "atk"), defRankEne = getActiveRank(enePokemon, "def")
  let expiredMsgs = []

  await triggerAttackEffect("my", "enemy")

  const { hit, hitType } = calcHit(myPokemon, moveInfo, enePokemon)
  if (!hit) {
    if (hitType === "evaded") { showBattlePopup("enemy", "evade"); await addLog(`${enePokemon.name}에게는 맞지 않았다!`) }
    else { await addLog(`그러나 ${myPokemon.name}의 공격은 빗나갔다!`) }
  } else {
    const { damage, multiplier, stab, dice, critical } = calcDamage(myPokemon, moveData.name, enePokemon, atkRank, defRankEne)
    if (multiplier === 0) { await addLog(`${enePokemon.name}에게는 효과가 없다…`) }
    else {
      await updateDoc(roomRef, { hit_event: { defender: enemySlot, ts: Date.now() } })
      await triggerBlink("enemy")
      await updateDoc(roomRef, { hit_event: null })
      enePokemon.hp = Math.max(0, enePokemon.hp - damage)
      updateHpBar("enemy-hp-bar", "enemy-active-hp", enePokemon.hp, enePokemon.maxHp, false)
      await wait(500)
      if (multiplier > 1) { await addLog("효과가 굉장했다!"); await wait(280) }
      if (multiplier < 1) { await addLog("효과가 별로인 듯하다…"); await wait(280) }
      if (critical) { showBattlePopup("enemy", "critical"); await addLog("급소에 맞았다!"); await wait(280) }
      const effectMsgs = applyMoveEffect(moveInfo?.effect, myPokemon, enePokemon, damage)
      for (const msg of effectMsgs) { await addLog(msg); await wait(280) }
      if (moveInfo?.rank) {
        const rankMsgs = applyRankChanges(moveInfo.rank, myPokemon, enePokemon, null)
        for (const msg of rankMsgs) { await addLog(msg); await wait(280) }
      }
      if (enePokemon.hp <= 0) { await addLog(`${enePokemon.name}${josa(enePokemon.name, "은는")} 쓰러졌다!`); await wait(300) }
    }
  }

  const weatherResult = applyWeatherEffect(moveInfo?.effect)
  if (weatherResult.weather) { for (const msg of weatherResult.msgs) { await addLog(msg); await wait(280) } }

  expiredMsgs = tickMyRanks(myPokemon)
  clearRankStack(myPokemon)

  const nextTurn = (freshData.turn_count ?? 1) + 1
  if (nextTurn % 2 === 0) {
    const { msgs: eotMsgs, anyFainted } = applyEndOfTurnDamage([myEntry, enemyEntry])
    for (const msg of eotMsgs) { await addLog(msg); await wait(280) }
    if (anyFainted) {
      if (isAllFainted(enemyEntry)) {
        await updateDoc(roomRef, { [`${mySlot}_entry`]: myEntry, [`${enemySlot}_entry`]: enemyEntry, turn_count: nextTurn, game_over: true, winner: myName, current_turn: null, ...(weatherResult.weather ? { weather: weatherResult.weather } : {}) })
        await grantWinCoins(myName, freshData); await addLog(`${myName}의 승리!`); return
      } else if (isAllFainted(myEntry)) {
        await updateDoc(roomRef, { [`${mySlot}_entry`]: myEntry, [`${enemySlot}_entry`]: enemyEntry, turn_count: nextTurn, game_over: true, winner: enemyName, current_turn: null, ...(weatherResult.weather ? { weather: weatherResult.weather } : {}) })
        await grantWinCoins(enemyName, freshData); await addLog(`${enemyName}의 승리!`); return
      }
    }
  }

  for (const msg of expiredMsgs) { await addLog(msg); await wait(250) }

  if (isAllFainted(enemyEntry)) {
    await updateDoc(roomRef, { [`${mySlot}_entry`]: myEntry, [`${enemySlot}_entry`]: enemyEntry, turn_count: nextTurn, game_over: true, winner: myName, current_turn: null, ...(weatherResult.weather ? { weather: weatherResult.weather } : {}) })
    await grantWinCoins(myName, freshData); await addLog(`${myName}의 승리!`)
  } else if (isAllFainted(myEntry)) {
    await updateDoc(roomRef, { [`${mySlot}_entry`]: myEntry, [`${enemySlot}_entry`]: enemyEntry, turn_count: nextTurn, game_over: true, winner: enemyName, current_turn: null, ...(weatherResult.weather ? { weather: weatherResult.weather } : {}) })
    await grantWinCoins(enemyName, freshData); await addLog(`${enemyName}의 승리!`)
  } else {
    await updateDoc(roomRef, { [`${mySlot}_entry`]: myEntry, [`${enemySlot}_entry`]: enemyEntry, current_turn: enemySlot, turn_count: nextTurn, ...(weatherResult.weather ? { weather: weatherResult.weather } : {}) })
  }
}
