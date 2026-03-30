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
  applyEndOfTurnDamage, applyWeatherEffect, tickVolatiles,
  getStatusSpdPenalty
} from "./effecthandler.js"
import { fadeBgmOut } from "./intro.js"

const roomRef = doc(db, "rooms", ROOM_ID)
const logsRef = collection(db, "rooms", ROOM_ID, "logs")

const SFX_DICE = "https://slippery-copper-mzpmcmc2ra.edgeone.app/soundreality-bicycle-bell-155622.mp3"
const SFX_BTN  = "https://usual-salmon-mnqxptwyvw.edgeone.app/Pokemon%20(A%20Button)%20-%20Sound%20Effect%20(HD)%20(1)%20(1).mp3"

const API = "https://betatest-ten.vercel.app"

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

let mySlot = null, myUid = null, myTurn = false
let diceShown = false, actionDone = false, gameOver = false
let pendingGameOver = null
let introDone = false  // 인트로 끝났는지 추적

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
    if (!isSameMove) { self.lastRankMove = moveName; self.rankStack = 1 }
    else if (stack >= 2) { selfR.atk = 0; selfR.atkTurns = 0; selfR.def = 0; selfR.defTurns = 0; selfR.spd = 0; selfR.spdTurns = 0; self.rankStack = 1 }
    else { self.rankStack = stack + 1 }
  }
  if (r.atk !== undefined) {
    if (r.atk > 0) { const p = selfR.atk; selfR.atk = Math.min(4, selfR.atk + r.atk); selfR.atkTurns = r.turns ?? 2; msgs.push(`${self.name}의 공격이 올라갔다! (+${selfR.atk - p})`) }
    else if (r.atk < 0) { if (selfR.atk === 0) msgs.push(`${self.name}의 공격은 더 이상 내려가지 않는다!`); else { const p = selfR.atk; selfR.atk = Math.max(0, selfR.atk + r.atk); selfR.atkTurns = r.turns ?? 2; msgs.push(`${self.name}의 공격이 내려갔다! (${selfR.atk - p})`) } }
  }
  if (r.def !== undefined) {
    if (r.def > 0) { const p = selfR.def; selfR.def = Math.min(3, selfR.def + r.def); selfR.defTurns = r.turns ?? 2; msgs.push(`${self.name}의 방어가 올라갔다! (+${selfR.def - p})`) }
    else if (r.def < 0) { if (selfR.def === 0) msgs.push(`${self.name}의 방어는 더 이상 내려가지 않는다!`); else { const p = selfR.def; selfR.def = Math.max(0, selfR.def + r.def); selfR.defTurns = r.turns ?? 2; msgs.push(`${self.name}의 방어가 내려갔다! (${selfR.def - p})`) } }
  }
  if (r.spd !== undefined) {
    if (r.spd > 0) { const p = selfR.spd; selfR.spd = Math.min(5, selfR.spd + r.spd); selfR.spdTurns = r.turns ?? 2; msgs.push(`${self.name}의 스피드가 올라갔다! (+${selfR.spd - p}%p)`) }
    else if (r.spd < 0) { if (selfR.spd === 0) msgs.push(`${self.name}의 스피드는 더 이상 내려가지 않는다!`); else { const p = selfR.spd; selfR.spd = Math.max(0, selfR.spd + r.spd); selfR.spdTurns = r.turns ?? 2; msgs.push(`${self.name}의 스피드가 내려갔다! (${selfR.spd - p}%p)`) } }
  }
  if (r.targetAtk !== undefined) {
    if (r.targetAtk < 0) { if (targetR.atk === 0) msgs.push(`${target.name}의 공격은 더 이상 내려가지 않는다!`); else { const p = targetR.atk; targetR.atk = Math.max(0, targetR.atk + r.targetAtk); targetR.atkTurns = r.turns ?? 2; msgs.push(`${target.name}의 공격이 내려갔다! (${targetR.atk - p})`) } }
    else if (r.targetAtk > 0) { const p = targetR.atk; targetR.atk = Math.min(4, targetR.atk + r.targetAtk); targetR.atkTurns = r.turns ?? 2; msgs.push(`${target.name}의 공격이 올라갔다! (+${targetR.atk - p})`) }
  }
  if (r.targetDef !== undefined) {
    if (r.targetDef < 0) { if (targetR.def === 0) msgs.push(`${target.name}의 방어는 더 이상 내려가지 않는다!`); else { const p = targetR.def; targetR.def = Math.max(0, targetR.def + r.targetDef); targetR.defTurns = r.turns ?? 2; msgs.push(`${target.name}의 방어가 내려갔다! (${targetR.def - p})`) } }
    else if (r.targetDef > 0) { const p = targetR.def; targetR.def = Math.min(3, targetR.def + r.targetDef); targetR.defTurns = r.turns ?? 2; msgs.push(`${target.name}의 방어가 올라갔다! (+${targetR.def - p})`) }
  }
  if (r.targetSpd !== undefined) {
    if (r.targetSpd < 0) { if (targetR.spd === 0) msgs.push(`${target.name}의 스피드는 더 이상 내려가지 않는다!`); else { const p = targetR.spd; targetR.spd = Math.max(0, targetR.spd + r.targetSpd); targetR.spdTurns = r.turns ?? 2; msgs.push(`${target.name}의 스피드가 내려갔다! (${targetR.spd - p}%p)`) } }
    else if (r.targetSpd > 0) { const p = targetR.spd; targetR.spd = Math.min(5, targetR.spd + r.targetSpd); targetR.spdTurns = r.turns ?? 2; msgs.push(`${target.name}의 스피드가 올라갔다! (+${targetR.spd - p}%p)`) }
  }
  self.ranks = selfR; target.ranks = targetR
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

function calcDamage(attacker, moveName, defender, atkRank = 0, defRank = 0, powerOverride = null) {
  const move = moves[moveName]
  if (!move) return { damage: 0, multiplier: 1, stab: false, dice: 0, critical: false }
  const dice = rollD10()
  const defTypes = Array.isArray(defender.type) ? defender.type : [defender.type]
  let multiplier = 1
  for (const dt of defTypes) multiplier *= getTypeMultiplier(move.type, dt)
  if (multiplier === 0) return { damage: 0, multiplier: 0, stab: false, dice, critical: false }
  const atkTypes = Array.isArray(attacker.type) ? attacker.type : [attacker.type]
  const stab = atkTypes.includes(move.type)
  const power = powerOverride ?? (move.power ?? 40)
  const base = power + (attacker.attack ?? 3) * 4 + dice
  const raw  = Math.floor(base * multiplier * (stab ? 1.3 : 1))
  const afterAtk = Math.max(0, raw + Math.max(-raw, atkRank))
  const afterDef = Math.max(0, afterAtk - (defender.defense ?? 3) * 5)
  const baseDmg  = Math.max(0, afterDef - Math.min(3, Math.max(0, defRank)) * 3)
  const critical = Math.random() * 100 < Math.min(100, (attacker.attack ?? 3) * 2)
  return { damage: critical ? Math.floor(baseDmg * 1.5) : baseDmg, multiplier, stab, dice, critical }
}

function calcRolloutDamage(moveName, defender, power) {
  const move = moves[moveName]
  if (!move) return 0
  const defTypes = Array.isArray(defender.type) ? defender.type : [defender.type]
  let multiplier = 1
  for (const dt of defTypes) multiplier *= getTypeMultiplier(move.type, dt)
  return Math.floor(power * multiplier)
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
  setTimeout(() => { img.classList.add("visible", ...(animate ? [prefix === "my" ? "slide-in-my" : "slide-in-enemy"] : [])) }, 80)
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

// ── 로그 큐 시스템
let renderedLogIds = new Set()
let logQueue = []
let isProcessing = false
let lastRoomData = null  // 최신 room 데이터 캐시

function processLogQueue() {
  if (isProcessing || logQueue.length === 0) return
  isProcessing = true
  const entry = logQueue.shift()
  handleLogEntry(entry).then(() => {
    isProcessing = false
    if (logQueue.length === 0 && pendingGameOver) {
      const data = pendingGameOver
      pendingGameOver = null
      showGameOver(data)
      return
    }
    // 큐 소진 시 버튼 상태 갱신
    if (logQueue.length === 0 && lastRoomData) {
      updateMoveButtons(lastRoomData)
      updateBenchButtons(lastRoomData)
    }
    setTimeout(processLogQueue, 50)
  })
}

async function handleLogEntry({ text, type, meta }) {
  const log = document.getElementById("battle-log")

  switch (type) {
    case "intro_wait": {
      // 포트레이트 + HP바 초기값 세팅 + 3초 대기
      const snap = await getDoc(roomRef)
      const data = snap.data()
      if (data) {
        const enemySlot = mySlot === "p1" ? "p2" : "p1"
        updatePortrait("my", data[`${mySlot}_entry`]?.[0], true)
        updatePortrait("enemy", data[`${enemySlot}_entry`]?.[0], true)
        const myPkmn = data[`${mySlot}_entry`]?.[0]
        const enePkmn = data[`${enemySlot}_entry`]?.[0]
        if (myPkmn) updateHpBar("my-hp-bar", "my-active-hp", myPkmn.hp, myPkmn.maxHp, true)
        if (enePkmn) updateHpBar("enemy-hp-bar", "enemy-active-hp", enePkmn.hp, enePkmn.maxHp, false)
      }
      await wait(3000)
      // 인트로 끝 → intro_done 세팅 + 선공 다이스 애니메이션
      await updateDoc(roomRef, { intro_done: true })
      introDone = true
      // 선공 다이스 애니메이션 (인트로 끝난 후)
      const freshSnap = await getDoc(roomRef)
      const freshData = freshSnap.data()
      if (freshData?.p1_dice && freshData?.p2_dice && freshData?.first_slot) {
        await animateDualDiceAsync(freshData.p1_dice, freshData.p2_dice, freshData.player1_name, freshData.player2_name)
      }
      break
    }
    case "switch": {
      const { slot, hp, maxHp } = meta ?? {}
      const prefix = slot === mySlot ? "my" : "enemy"
      if (hp !== undefined && maxHp !== undefined) {
        updateHpBar(`${prefix}-hp-bar`, `${prefix}-active-hp`, hp, maxHp, prefix === "my")
      }
      if (text) await typeText(log, text)
      await wait(150)
      break
    }
    case "dice": {
      // 공격 주사위 — 관전자 포함 모두에게 보임
      const { slot, roll } = meta ?? {}
      const snap = await getDoc(roomRef)
      const d = snap.data()
      // 관전자는 공격자가 누구든 양쪽 다이스 박스 모두 표시
      await animateDiceSingle(slot, roll, d?.player1_name, d?.player2_name)
      break
    }
    case "attack": {
      await triggerAttackEffect("my", "enemy")
      break
    }
    case "hit": {
      const { defender, hp, maxHp } = meta ?? {}
      const prefix = defender === mySlot ? "my" : "enemy"
      await triggerBlink(prefix)
      if (hp !== undefined && maxHp !== undefined) {
        updateHpBar(`${prefix}-hp-bar`, `${prefix}-active-hp`, hp, maxHp, prefix === "my")
      }
      await wait(200)
      break
    }
    case "hit_self": {
      const { hp, maxHp } = meta ?? {}
      await triggerBlink("my")
      if (hp !== undefined && maxHp !== undefined) {
        updateHpBar("my-hp-bar", "my-active-hp", hp, maxHp, true)
      }
      await wait(200)
      break
    }
    case "critical": {
      showBattlePopup("enemy", "critical")
      await typeText(log, text)
      await wait(200)
      break
    }
    case "evade": {
      showBattlePopup("enemy", "evade")
      await typeText(log, text)
      await wait(200)
      break
    }
    case "faint": {
      await typeText(log, text)
      await wait(500)
      break
    }
    case "win": {
      await typeText(log, text)
      await wait(500)
      break
    }
    default: {
      if (text) {
        await typeText(log, text)
        await wait(150)
      }
      break
    }
  }
}

function typeText(log, text) {
  return new Promise(resolve => {
    if (!log || !text) { resolve(); return }
    const line = document.createElement("p")
    log.appendChild(line)
    const chars = [...text]; let i = 0
    function typeNext() {
      if (i >= chars.length) { resolve(); return }
      line.textContent += chars[i++]
      log.scrollTop = log.scrollHeight
      setTimeout(typeNext, 18)
    }
    typeNext()
  })
}

async function addLog(text) { await addDoc(logsRef, { text, type: "normal", ts: Date.now() }) }

function listenLogs() {
  const q = query(logsRef, orderBy("ts"))
  onSnapshot(q, snap => {
    snap.docs.forEach(d => {
      if (renderedLogIds.has(d.id)) return
      renderedLogIds.add(d.id)
      const data = d.data()
      logQueue.push({ id: d.id, text: data.text ?? "", type: data.type ?? "normal", meta: data })
    })
    processLogQueue()
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

async function saveGameLog() {
  if (isSpectator || mySlot !== "p1") return
  try {
    const roomSnap = await getDoc(roomRef), data = roomSnap.data()
    const logSnap = await getDocs(query(logsRef, orderBy("ts")))
    const logs = logSnap.docs.map(d => ({ text: d.data().text, ts: d.data().ts }))
    const gamesRef = collection(db, "rooms", ROOM_ID, "games")
    await addDoc(gamesRef, { p1: data.player1_name ?? "???", p2: data.player2_name ?? "???", winner: data.winner ?? null, logs, createdAt: Date.now() })
  } catch(e) { console.warn("게임 로그 저장 실패", e) }
}

// 선공 다이스 — 양쪽 모두 보이는 버전 (Promise 반환)
function animateDualDiceAsync(p1Roll, p2Roll, p1Name, p2Name) {
  return new Promise(resolve => {
    animateDualDice(p1Roll, p2Roll, resolve, p1Name, p2Name)
  })
}

function animateDiceSingle(slot, finalRoll, p1Name, p2Name) {
  return new Promise(resolve => {
    const wrap = document.getElementById("dice-wrap")
    const p1Box = document.getElementById("dice-box-p1"), p2Box = document.getElementById("dice-box-p2")
    const diceEl = document.getElementById(slot === "p1" ? "dice-p1" : "dice-p2")
    const nameEl = document.getElementById(slot === "p1" ? "p1-name-dice" : "p2-name-dice")
    if (!wrap || !diceEl) { resolve(); return }

    // 관전자는 공격자 슬롯과 상관없이 양쪽 다 표시
    if (isSpectator) {
      if (p1Box) p1Box.style.display = "block"
      if (p2Box) p2Box.style.display = "block"
      const p1NameEl = document.getElementById("p1-name-dice")
      const p2NameEl = document.getElementById("p2-name-dice")
      if (p1NameEl) p1NameEl.innerText = p1Name ?? "Player1"
      if (p2NameEl) p2NameEl.innerText = p2Name ?? "Player2"
    } else {
      if (p1Box) p1Box.style.display = slot === "p1" ? "block" : "none"
      if (p2Box) p2Box.style.display = slot === "p2" ? "block" : "none"
      if (nameEl) nameEl.innerText = slot === "p1" ? (p1Name ?? "Player1") : (p2Name ?? "Player2")
    }

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
  if (p1Box) p1Box.style.display = "block"; if (p2Box) p2Box.style.display = "block"
  wrap.style.display = "flex"
  let count = 0
  const iv = setInterval(() => {
    if (p1El) p1El.innerText = rollD10(); if (p2El) p2El.innerText = rollD10()
    if (++count >= 22) {
      clearInterval(iv)
      if (p1El) p1El.innerText = p1Roll; if (p2El) p2El.innerText = p2Roll
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
  waitForBattleReady(); listenLogs()
})

function waitForBattleReady() {
  const screen = document.getElementById("battle-screen")
  if (screen.classList.contains("visible")) { listenRoom(); return }
  const obs = new MutationObserver(() => { if (screen.classList.contains("visible")) { obs.disconnect(); listenRoom() } })
  obs.observe(screen, { attributes: true, attributeFilter: ["class"] })
}

function listenRoom() {
  onSnapshot(roomRef, async snap => {
    const data = snap.data(); if (!data) return
    lastRoomData = data  // 최신 데이터 캐시
    document.getElementById("p1-name").innerText = data.player1_name ?? "대기..."
    document.getElementById("p2-name").innerText = data.player2_name ?? "대기..."
    const spectEl = document.getElementById("spectator-list")
    if (spectEl) { const n = data.spectator_names ?? []; spectEl.innerText = n.length > 0 ? "관전: " + n.join(", ") : "" }
    if (!data.p1_entry || !data.p2_entry) return

    updateActiveUINoHp(mySlot, data, "my")
    updateActiveUINoHp(mySlot === "p1" ? "p2" : "p1", data, "enemy")

    if (data.game_over) {
      if (logQueue.length === 0 && !isProcessing) {
        showGameOver(data)
      } else {
        pendingGameOver = data
      }
      return
    }

    if (!data.current_turn) return

    if (!isSpectator) {
      const wasMine = myTurn
      myTurn = data.current_turn === mySlot
      if (!wasMine && myTurn) {
        actionDone = false
        // 버튼 활성화는 큐 소진 후에
        waitForQueueThenUpdateButtons(data)
      } else if (wasMine && !myTurn) {
        updateTurnUI(data)
        updateMoveButtons(data)
        updateBenchButtons(data)
      }
    } else {
      // 관전자는 바로 업데이트
      updateBenchButtons(data)
      updateMoveButtons(data)
    }
  })
}

// 로그 큐 소진 후 버튼 + 턴 UI 업데이트
function waitForQueueThenUpdateButtons(data) {
  if (logQueue.length === 0 && !isProcessing) {
    updateTurnUI(data)
    updateMoveButtons(data)
    updateBenchButtons(data)
    return
  }
  setTimeout(() => waitForQueueThenUpdateButtons(data), 100)
}

function updateActiveUINoHp(slot, data, prefix) {
  const activeIdx = data[`${slot}_active_idx`], pokemon = data[`${slot}_entry`]?.[activeIdx]
  if (!pokemon) return
  const st = pokemon.status ? ` [${statusName(pokemon.status)}]` : ""
  const cf = (pokemon.confusion ?? 0) > 0 ? " [혼란]" : ""
  const nameEl = document.getElementById(`${prefix}-active-name`)
  if (nameEl) nameEl.innerText = data.intro_done ? (pokemon.name + st + cf) : "???"
  if (data.intro_done) updatePortrait(prefix, pokemon)
}

function showGameOver(data) {
  if (gameOver) return
  gameOver = true
  fadeBgmOut(2000)
  const td = document.getElementById("turn-display")
  if (isSpectator) {
    if (td) { td.innerText = `🏆 ${data.winner}의 승리!`; td.style.color = "gold" }
  } else {
    const myName = mySlot === "p1" ? data.player1_name : data.player2_name
    const enemyName = mySlot === "p1" ? data.player2_name : data.player1_name
    const win = data.winner === myName
    if (td) { td.innerText = win ? `${enemyName}${josa(enemyName,"과와")}의 전투에서 승리했다!` : `${enemyName}${josa(enemyName,"과와")}의 전투에서 패배했다…`; td.style.color = win ? "gold" : "red" }
    grantWinCoins(data.winner, data)
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
    spectators: (data.spectators ?? []).filter(u => u !== myUid),
    spectator_names: (data.spectator_names ?? []).filter((_, i) => (data.spectators ?? [])[i] !== myUid)
  })
  location.href = "../main.html"
}

async function leaveGame() {
  await saveGameLog()
  const logSnap = await getDocs(logsRef)
  await Promise.all(logSnap.docs.map(d => deleteDoc(d.ref)))
  await updateDoc(roomRef, {
    player1_uid: null, player1_name: null, player1_ready: false,
    player2_uid: null, player2_name: null, player2_ready: false,
    game_started: false, game_over: false, winner: null,
    current_turn: null, turn_count: 0, p1_entry: null, p2_entry: null,
    p1_active_idx: 0, p2_active_idx: 0, p1_dice: null, p2_dice: null,
    first_slot: null, first_pokemon_name: null, intro_done: false,
    intro_ready_p1: false, intro_ready_p2: false,
    hit_event: null, background: null, dice_event: null,
    revenge_ready_p1: false, revenge_ready_p2: false
  })
  location.href = "../main.html"
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
    const isLastResort = moveInfo?.lastResort
    const lrUnlocked = isLastResort ? checkLastResortUnlocked(myPokemon, i, movesArr) : true
    const rollActive = (myPokemon?.rollState?.active ?? false)
    const isRollout = moveInfo?.rollout
    const lockedByRoll = rollActive && !isRollout
    btn.innerHTML = `<span style="display:block;font-size:13px;font-weight:bold;">${move.name}</span><span style="display:block;font-size:10px;opacity:0.85;">PP: ${move.pp} | ${accText}</span>`
    const color = typeColors[moveInfo?.type] ?? "#a0a0a0"
    btn.style.setProperty("--btn-color", color); btn.style.background = color
    btn.style.boxShadow = `inset 0 0 0 2px white, 0 0 0 2px ${color}`
    // 큐가 비어있을 때만 활성화
    const queueBusy = logQueue.length > 0 || isProcessing
    const disabled = isSpectator || fainted || move.pp <= 0 || !myTurn || actionDone || !lrUnlocked || lockedByRoll || queueBusy
    if (disabled) { btn.disabled = true; btn.onclick = null }
    else { btn.disabled = false; btn.onclick = () => { playSound(SFX_BTN); useMove(i, data) } }
  }
}

function checkLastResortUnlocked(pokemon, lrIdx, movesArr) {
  const usedMoves = pokemon.usedMoves ?? []
  for (let i = 0; i < movesArr.length; i++) {
    if (i === lrIdx) continue
    if (!usedMoves.includes(movesArr[i].name)) return false
  }
  return usedMoves.length > 0
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
      const queueBusy = logQueue.length > 0 || isProcessing
      btn.disabled = isSpectator || !myTurn || actionDone || queueBusy
      if (!isSpectator) btn.onclick = () => { playSound(SFX_BTN); switchPokemon(idx) }
    }
    bench.appendChild(btn)
  })
}

function updateTurnUI(data) {
  const el = document.getElementById("turn-display")
  if (el && !isSpectator) {
    el.innerText = myTurn ? "내 턴!" : "상대 턴..."
    el.style.color = myTurn ? "green" : "gray"
  }
  const tc = document.getElementById("turn-count")
  if (tc) tc.innerText = `${data.turn_count ?? 1}턴`
}

async function switchPokemon(newIdx) {
  if (isSpectator || !myTurn || actionDone || gameOver) return
  actionDone = true
  const res = await fetch(`${API}/api/switch-pokemon`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roomId: ROOM_ID, mySlot, newIdx })
  })
  const result = await res.json()
  if (!result.ok) {
    console.error("교체 실패:", result.error)
    actionDone = false
  }
}

async function useMove(moveIdx, data) {
  if (isSpectator || !myTurn || actionDone || gameOver) return
  actionDone = true
  updateMoveButtons(data)
  const res = await fetch(`${API}/api/use-move`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roomId: ROOM_ID, mySlot, moveIdx })
  })
  const result = await res.json()
  if (!result.ok) {
    console.error("기술 사용 실패:", result.error)
    actionDone = false
  }
}