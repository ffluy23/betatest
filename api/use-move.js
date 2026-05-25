import { db } from "./_firebase.js"
import { moves } from "./moves.js"
import { applyRapidSpin, applyFieldEffects } from "./field.js"
import { getTypeMultiplier } from "./typeChart.js"
import {
  josa,
  applyMoveEffect, checkPreActionStatus, checkConfusion,
  applyEndOfTurnDamage, tickVolatiles, applyStatus,
  applyLeechSeed, getStatusSpdPenalty
} from "./effecthandler.js"
import {
  startWeather, endWeather, tickWeather, getWeatherLog,
  applyWeatherDamage, getWeatherDamageMult,
  patchMoveForWeather, getSunnyGrowthBonus
} from "./weather.js"

function rollD10() { return Math.floor(Math.random() * 10) + 1 }

function sanitizeForFirestore(obj) {
  if (Array.isArray(obj)) return obj.map(sanitizeForFirestore)
  if (obj !== null && typeof obj === "object") {
    const result = {}
    for (const [k, v] of Object.entries(obj)) {
      result[k] = v === undefined ? null : sanitizeForFirestore(v)
    }
    return result
  }
  return obj
}
function isAllFainted(entry) { return entry.every(p => p.hp <= 0) }
function defaultRanks() {
  return { atk: 0, atkTurns: 0, def: 0, defTurns: 0, spd: 0, spdTurns: 0 }
}

function getActiveRank(pokemon, key) {
  const r = pokemon.ranks ?? {}
  return (r[`${key}Turns`] ?? 0) > 0 ? (r[key] ?? 0) : 0
}

function resetRankStack(pokemon) {
  pokemon.lastRankMove = null; pokemon.rankStack = 0
}

function clearRankStack(pokemon) {
  pokemon.lastRankMove = null; pokemon.rankStack = 0
}

function tickMyRanks(pokemon) {
  if (!pokemon.ranks) return []
  const r = pokemon.ranks, msgs = []
  if (r.atkTurns > 0) { r.atkTurns--; if (!r.atkTurns) { r.atk = 0; msgs.push(`${pokemon.name}의 공격이 원래대로 돌아왔다!`) } }
  if (r.defTurns > 0) { r.defTurns--; if (!r.defTurns) { r.def = 0; msgs.push(`${pokemon.name}의 방어가 원래대로 돌아왔다!`) } }
  if (r.spdTurns > 0) { r.spdTurns--; if (!r.spdTurns) { r.spd = 0; msgs.push(`${pokemon.name}의 스피드가 원래대로 돌아왔다!`) } }
  return msgs
}

function applyRankChanges(r, self, target, moveName) {
  if (!r) return []
  const msgs = []
  const roll = r.chance !== undefined ? Math.random() < r.chance : true
  if (!roll) return []

  const selfR = {
    atk: (self.ranks?.atkTurns ?? 0) > 0 ? (self.ranks?.atk ?? 0) : 0, atkTurns: self.ranks?.atkTurns ?? 0,
    def: (self.ranks?.defTurns ?? 0) > 0 ? (self.ranks?.def ?? 0) : 0, defTurns: self.ranks?.defTurns ?? 0,
    spd: (self.ranks?.spdTurns ?? 0) > 0 ? (self.ranks?.spd ?? 0) : 0, spdTurns: self.ranks?.spdTurns ?? 0,
  }
  const targetR = {
    atk: (target.ranks?.atkTurns ?? 0) > 0 ? (target.ranks?.atk ?? 0) : 0, atkTurns: target.ranks?.atkTurns ?? 0,
    def: (target.ranks?.defTurns ?? 0) > 0 ? (target.ranks?.def ?? 0) : 0, defTurns: target.ranks?.defTurns ?? 0,
    spd: (target.ranks?.spdTurns ?? 0) > 0 ? (target.ranks?.spd ?? 0) : 0, spdTurns: target.ranks?.spdTurns ?? 0,
  }

  const isSameMove = moveName && self.lastRankMove === moveName
  const stack = self.rankStack ?? 0
  if (moveName) {
    if (!isSameMove) { self.lastRankMove = moveName; self.rankStack = 1 }
    else if (stack >= 2) {
      selfR.atk = 0; selfR.atkTurns = 0
      selfR.def = 0; selfR.defTurns = 0
      selfR.spd = 0; selfR.spdTurns = 0
      self.rankStack = 1
    }
    else { self.rankStack = stack + 1 }
  }

  const MIN_ATK = -4, MIN_DEF = -3, MIN_SPD = -5
  const MAX_ATK = 4, MAX_DEF = 3, MAX_SPD = 5

  if (r.atk !== undefined) {
    if (r.atk > 0) { const p = selfR.atk; selfR.atk = Math.min(MAX_ATK, selfR.atk + r.atk); selfR.atkTurns = r.turns ?? 2; msgs.push(`${self.name}의 공격이 ${selfR.atk - p} 상승했다!`) }
    else if (r.atk < 0) { if (selfR.atk <= MIN_ATK) msgs.push(`${self.name}의 공격은 더 이상 내려가지 않는다!`); else { const p = selfR.atk; selfR.atk = Math.max(MIN_ATK, selfR.atk + r.atk); selfR.atkTurns = r.turns ?? 2; msgs.push(`${self.name}의 공격이 ${p - selfR.atk} 하락했다!`) } }
  }
  if (r.def !== undefined) {
    if (r.def > 0) { const p = selfR.def; selfR.def = Math.min(MAX_DEF, selfR.def + r.def); selfR.defTurns = r.turns ?? 2; msgs.push(`${self.name}의 방어가 ${selfR.def - p} 상승했다!`) }
    else if (r.def < 0) { if (selfR.def <= MIN_DEF) msgs.push(`${self.name}의 방어는 더 이상 내려가지 않는다!`); else { const p = selfR.def; selfR.def = Math.max(MIN_DEF, selfR.def + r.def); selfR.defTurns = r.turns ?? 2; msgs.push(`${self.name}의 방어가 ${p - selfR.def} 하락했다!`) } }
  }
  if (r.spd !== undefined) {
    if (r.spd > 0) { const p = selfR.spd; selfR.spd = Math.min(MAX_SPD, selfR.spd + r.spd); selfR.spdTurns = r.turns ?? 2; msgs.push(`${self.name}의 스피드가 ${selfR.spd - p} 상승했다!`) }
    else if (r.spd < 0) { if (selfR.spd <= MIN_SPD) msgs.push(`${self.name}의 스피드는 더 이상 내려가지 않는다!`); else { const p = selfR.spd; selfR.spd = Math.max(MIN_SPD, selfR.spd + r.spd); selfR.spdTurns = r.turns ?? 2; msgs.push(`${self.name}의 스피드가 ${p - selfR.spd} 하락했다!`) } }
  }
  if (r.targetAtk !== undefined) {
    if (r.targetAtk < 0) {
      if (targetR.atk <= MIN_ATK) msgs.push(`${target.name}의 공격은 더 이상 내려가지 않는다!`)
      else { const p = targetR.atk; targetR.atk = Math.max(MIN_ATK, targetR.atk + r.targetAtk); targetR.atkTurns = r.turns ?? 2; msgs.push(`${target.name}의 공격이 ${p - targetR.atk} 하락했다!`); target.rankDroppedThisTurn = true }
    }
    else if (r.targetAtk > 0) { const p = targetR.atk; targetR.atk = Math.min(MAX_ATK, targetR.atk + r.targetAtk); targetR.atkTurns = r.turns ?? 2; msgs.push(`${target.name}의 공격이 ${targetR.atk - p} 상승했다!`) }
  }
  if (r.targetDef !== undefined) {
    if (r.targetDef < 0) {
      if (targetR.def <= MIN_DEF) msgs.push(`${target.name}의 방어는 더 이상 내려가지 않는다!`)
      else { const p = targetR.def; targetR.def = Math.max(MIN_DEF, targetR.def + r.targetDef); targetR.defTurns = r.turns ?? 2; msgs.push(`${target.name}의 방어가 ${p - targetR.def} 하락했다!`); target.rankDroppedThisTurn = true }
    }
    else if (r.targetDef > 0) { const p = targetR.def; targetR.def = Math.min(MAX_DEF, targetR.def + r.targetDef); targetR.defTurns = r.turns ?? 2; msgs.push(`${target.name}의 방어가 ${targetR.def - p} 상승했다!`) }
  }
  if (r.targetSpd !== undefined) {
    if (r.targetSpd < 0) {
      if (targetR.spd <= MIN_SPD) msgs.push(`${target.name}의 스피드는 더 이상 내려가지 않는다!`)
      else { const p = targetR.spd; targetR.spd = Math.max(MIN_SPD, targetR.spd + r.targetSpd); targetR.spdTurns = r.turns ?? 2; msgs.push(`${target.name}의 스피드가 ${p - targetR.spd} 하락했다!`); target.rankDroppedThisTurn = true }
    }
    else if (r.targetSpd > 0) { const p = targetR.spd; targetR.spd = Math.min(MAX_SPD, targetR.spd + r.targetSpd); targetR.spdTurns = r.turns ?? 2; msgs.push(`${target.name}의 스피드가 ${targetR.spd - p} 상승했다!`) }
  }

  self.ranks = selfR; target.ranks = targetR
  return msgs
}

function calcHit(attacker, moveInfo, defender) {
  if (moveInfo.alwaysHit || moveInfo.skipEvasion) return { hit: true, hitType: "hit" }
  if (Math.random() * 100 >= (moveInfo.accuracy ?? 100)) return { hit: false, hitType: "missed" }
  if (defender.flyState?.flying && !moveInfo.twister && moveInfo._name !== "번개")
    return { hit: false, hitType: "evaded" }
  if (defender.digState?.digging && moveInfo._name !== "지진")
    return { hit: false, hitType: "evaded" }
  if (defender.ghostDiveState?.diving)
    return { hit: false, hitType: "evaded" }
  const as = Math.max(1, (attacker.speed ?? 3) - getStatusSpdPenalty(attacker))
  const ds = Math.max(1, (defender.speed ?? 3) - getStatusSpdPenalty(defender))
  const defSpdRank = (defender.ranks ?? {})
  const defSpdBonus = (defSpdRank.spdTurns ?? 0) > 0 ? (defSpdRank.spd ?? 0) : 0
  const ev = Math.min(99, Math.max(0, 5 * (ds - as) + defSpdBonus))
  return Math.random() * 100 < ev ? { hit: false, hitType: "evaded" } : { hit: true, hitType: "hit" }
}

function calcGyroBallPower(attacker, defender) {
  const atkSpd = Math.max(1, getActiveRank(attacker, "spd"))
  const defSpd = Math.max(1, getActiveRank(defender, "spd"))
  const ratio = defSpd / atkSpd
  if (ratio <= 1) return 30
  if (ratio <= 2) return 40
  if (ratio <= 3) return 50
  return 60
}

function calcDamage(attacker, moveName, defender, atkRankBonus = 0, defRankBonus = 0, powerOverride = null, atkStatOverride = null, weather = null) {
  const move = moves[moveName]
  if (!move) return { damage: 0, multiplier: 1, stab: false, dice: 0, critical: false, minRoll: false }
  const dice = rollD10()
  const defTypes = Array.isArray(defender.type) ? defender.type : [defender.type]
  let multiplier = 1
  for (const dt of defTypes) multiplier *= getTypeMultiplier(move.type, dt)
  if (multiplier === 0) return { damage: 0, multiplier: 0, stab: false, dice, critical: false, minRoll: false }
  multiplier = Math.round(multiplier * 10) / 10
  const atkTypes = Array.isArray(attacker.type) ? attacker.type : [attacker.type]
  const stab = atkTypes.includes(move.type)
  const power = powerOverride ?? (move.power ?? 40)
  const atkStat = atkStatOverride ?? (attacker.attack ?? 3)
  const base = power + atkStat * 4 + dice
  const raw = Math.floor(base * multiplier * (stab ? 1.3 : 1))
  const afterAtk = Math.max(0, raw + atkRankBonus)
  const afterDef = afterAtk - (defender.defense ?? 3) * 3
  const baseDmg = afterDef - defRankBonus * 3

  if (baseDmg <= 0) {
    const minDice = Math.floor(Math.random() * 5) + 1
    const minDamage = minDice * 5
    return { damage: minDamage, multiplier, stab, dice, critical: false, minRoll: true, minDice }
  }

  const lightScreenActive = (defender.lightScreenTurns ?? 0) > 0
  const breakBarrier = move.breakBarrier ?? false
  const screenMult = (lightScreenActive && !breakBarrier) ? 0.75 : 1.0
  const flyLightningMult = (defender.flyState?.flying && move.type === "번개") ? 1.2 : 1.0
  const twisterFlyMult = (move.twister && defender.flyState?.flying) ? 1.2 : 1.0
  const digEarthquakeMult = (defender.digState?.digging && move.type === "지진") ? 1.2 : 1.0
  const weatherMult = getWeatherDamageMult(weather, move.type)
  const critRate = Math.min(100, atkStat * 2 + (move.highCrit ? 3 : 0))
  const critical = Math.random() * 100 < critRate
  const finalDmg = Math.floor(baseDmg * screenMult * flyLightningMult * twisterFlyMult * digEarthquakeMult * weatherMult)
  return { damage: critical ? Math.floor(finalDmg * 1.5) : finalDmg, multiplier, stab, dice, critical, minRoll: false }
}

function calcBodyPressDamage(attacker, defender, defRankBonus = 0, weather = null) {
  const move = moves["바디프레스"]
  const dice = rollD10()
  const defTypes = Array.isArray(defender.type) ? defender.type : [defender.type]
  let multiplier = 1
  for (const dt of defTypes) multiplier *= getTypeMultiplier(move.type, dt)
  if (multiplier === 0) return { damage: 0, multiplier: 0, dice, critical: false }
  const atkTypes = Array.isArray(attacker.type) ? attacker.type : [attacker.type]
  const stab = atkTypes.includes(move.type)
  const baseDef = attacker.defense ?? 3
  const defRank = attacker.ranks ?? {}
  const defBonus = (defRank.defTurns ?? 0) > 0 ? (defRank.def ?? 0) : 0
  const base = move.power + (baseDef + defBonus) * 1.3 + dice
  const raw = Math.floor(base * multiplier * (stab ? 1.3 : 1))
  const afterDef = Math.max(0, raw - (defender.defense ?? 3) * 3)
  const finalDmg = Math.max(0, afterDef - defRankBonus * 3)
  const lightScreenActive = (defender.lightScreenTurns ?? 0) > 0
  const screenMult = lightScreenActive ? 0.75 : 1.0
  const weatherMult = getWeatherDamageMult(weather, move.type)
  const critRate = Math.min(100, (attacker.defense ?? 3) * 2)
  const critical = Math.random() * 100 < critRate
  const dmgAfterScreen = Math.floor(finalDmg * screenMult * weatherMult)
  return {
    damage: critical ? Math.floor(dmgAfterScreen * 1.5) : dmgAfterScreen,
    multiplier, stab, dice, critical
  }
}

function calcRolloutDamage(moveName, defender, power) {
  const move = moves[moveName]
  if (!move) return 0
  const defTypes = Array.isArray(defender.type) ? defender.type : [defender.type]
  let multiplier = 1
  for (const dt of defTypes) multiplier *= getTypeMultiplier(move.type, dt)
  return Math.floor(power * multiplier)
}

function calcAssistPower(pokemon) {
  const rankSum = Object.values(pokemon.ranks ?? {}).reduce((a, b) => a + Math.max(0, b), 0)
  return 30 + rankSum * 10
}

function recordDmg(obj, slot, dmg) { obj[`last_damage_taken_${slot}`] = dmg }

let logTs = Date.now()
function nextTs() { return logTs++ }

async function log(logsRef, text, type = "normal", meta = {}) {
  await logsRef.add({ text, type, ts: nextTs(), ...meta })
}

async function safeUpdate(ref, data) {
  return ref.update(sanitizeForFirestore(data))
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")
  if (req.method === "OPTIONS") return res.status(200).end()
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })

  try {
    const { roomId, mySlot, moveIdx } = req.body
    if (!roomId || !mySlot || moveIdx === undefined) return res.status(400).json({ error: "필수 파라미터 누락" })

    const roomRef = db.collection("rooms").doc(roomId)
    const logsRef = roomRef.collection("logs")
    logTs = Date.now()

    const snap = await roomRef.get()
    const freshData = snap.data()
    if (!freshData) return res.status(404).json({ error: "방 없음" })
    if (freshData.current_turn !== mySlot) return res.status(400).json({ error: "지금 네 턴이 아님" })

    const enemySlot = mySlot === "p1" ? "p2" : "p1"
    const myActiveIdx = freshData[`${mySlot}_active_idx`]
    const eneActiveIdx = freshData[`${enemySlot}_active_idx`]

    const currentWeather = freshData.weather ?? null
    const currentWeatherTurns = freshData.weatherTurns ?? 0

    const firstSlot = freshData.first_slot ?? "p1"
    const isSecondToAct = mySlot !== firstSlot

    const myEntry = freshData[`${mySlot}_entry`].map(p => {
      const r = p.ranks ?? {}
      const atkTurns = r.atkTurns > 0 ? r.atkTurns - 1 : 0
      const defTurns = r.defTurns > 0 ? r.defTurns - 1 : 0
      const spdTurns = r.spdTurns > 0 ? r.spdTurns - 1 : 0
      return { ...p, ranks: {
        atk: atkTurns > 0 ? r.atk : 0, atkTurns,
        def: defTurns > 0 ? r.def : 0, defTurns,
        spd: spdTurns > 0 ? r.spd : 0, spdTurns,
      }}
    })
    const enemyEntry = freshData[`${enemySlot}_entry`].map(p => {
      const r = p.ranks ?? {}
      return { ...p, ranks: {
        atk: r.atkTurns > 0 ? r.atk : 0, atkTurns: r.atkTurns ?? 0,
        def: r.defTurns > 0 ? r.def : 0, defTurns: r.defTurns ?? 0,
        spd: r.spdTurns > 0 ? r.spd : 0, spdTurns: r.spdTurns ?? 0,
      }}
    })
    const myPokemon = myEntry[myActiveIdx]
    const enePokemon = enemyEntry[eneActiveIdx]

    // ★ 매 턴 시작 시 초기화
    myPokemon.rankDroppedThisTurn = false
    myPokemon.lastMoveMissed = myPokemon.lastMoveMissed ?? false

    const sanitizeEntries = () => {
      myEntry.forEach((p, i) => { myEntry[i] = sanitizeForFirestore(p) })
      enemyEntry.forEach((p, i) => { enemyEntry[i] = sanitizeForFirestore(p) })
    }

    const myName = mySlot === "p1" ? freshData.player1_name : freshData.player2_name
    const enemyName = enemySlot === "p1" ? freshData.player1_name : freshData.player2_name
    const nextTurnCount = (freshData.turn_count ?? 1) + 1

    // ── 참기 중 턴 스킵
    if (req.body.bideSkip) {
      if (myPokemon.bideState && myPokemon.bideState.turnsLeft > 0) {
        myPokemon.bideState.turnsLeft--
        await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} 참고있다...`)
      }
      await safeUpdate(roomRef, { [`${mySlot}_entry`]: myEntry, current_turn: enemySlot, turn_count: nextTurnCount })
      return res.status(200).json({ ok: true })
    }

    // ── 참기 발사
    if (req.body.bideRelease) {
      const bide = myPokemon.bideState
      myPokemon.bideState = null
      if (!bide || bide.damage <= 0) {
        await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} 참기 발사에 실패했다!`)
        await safeUpdate(roomRef, { [`${mySlot}_entry`]: myEntry, current_turn: enemySlot, turn_count: nextTurnCount })
        return res.status(200).json({ ok: true })
      }
      const bideDmg = bide.damage * 2
      await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} 참기가 풀렸다!`)
      await log(logsRef, "", "attack", { attacker: mySlot })
      enePokemon.hp = Math.max(0, enePokemon.hp - bideDmg)
      if (enePokemon.hp <= 0 && enePokemon.enduring) { enePokemon.hp = 1; enePokemon.enduring = false }
      await hitLog(enemySlot, enePokemon)
      await log(logsRef, `${bideDmg} 데미지!`)
      if (enePokemon.hp <= 0) await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 쓰러졌다!`, "faint")
      const expMsgs = tickMyRanks(myPokemon); clearRankStack(myPokemon)
      for (const msg of expMsgs) await log(logsRef, msg)
      if (isAllFainted(enemyEntry)) {
        await safeUpdate(roomRef, { [`${mySlot}_entry`]: myEntry, [`${enemySlot}_entry`]: enemyEntry, turn_count: nextTurnCount, game_over: true, winner: myName, current_turn: null })
        await log(logsRef, `${myName}의 승리!`, "win")
      } else {
        await safeUpdate(roomRef, { [`${mySlot}_entry`]: myEntry, [`${enemySlot}_entry`]: enemyEntry, current_turn: enemySlot, turn_count: nextTurnCount })
      }
      return res.status(200).json({ ok: true })
    }

    if (moveIdx === -1 || moveIdx === "-1") {
      if (!myPokemon.bideState) return res.status(400).json({ error: "참기 상태 아님" })
    } else {
      const moveData = myPokemon.moves[moveIdx]
      if (!moveData || moveData.pp <= 0) return res.status(400).json({ error: "PP 없음" })
    }

    const moveData = moveIdx === -1 || moveIdx === "-1" ? null : myPokemon.moves[moveIdx]
    const moveInfo = moveData ? moves[moveData.name] : null

    if (myPokemon.hp <= 0 && moveIdx !== -1 && moveIdx !== "-1") {
      return res.status(400).json({ error: "포켓몬 기절" })
    }

    // ── 공중날기 2턴째
    if (myPokemon.flyState?.flying) {
      myPokemon.flyState = null
      await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} 내려꽂는다!`)
      await log(logsRef, "", "attack", { attacker: mySlot })
      const atkRankFly = getActiveRank(myPokemon, "atk")
      const defRankEneFly = getActiveRank(enePokemon, "def")
      const wasDefendingFly = enePokemon.defending ?? false
      enePokemon.defending = false; enePokemon.defendTurns = 0
      if (wasDefendingFly) {
        await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 방어했다!`)
      } else {
        const { hit, hitType } = calcHit(myPokemon, { accuracy: 95, type: "비행" }, enePokemon)
        if (!hit) {
          await log(logsRef, hitType === "evaded" ? `${enePokemon.name}에게는 맞지 않았다!` : `그러나 ${myPokemon.name}의 공격은 빗나갔다!`, hitType === "evaded" ? "evade" : "normal")
        } else {
          const flyMoveName = myPokemon.flyMoveName ?? "공중날기"
          const { damage, multiplier, critical, minRoll, minDice } = calcDamage(myPokemon, flyMoveName, enePokemon, atkRankFly, defRankEneFly, null, null, currentWeather)
          if (multiplier === 0) {
            await log(logsRef, `${enePokemon.name}에게는 효과가 없다…`)
          } else {
            enePokemon.hp = Math.max(0, enePokemon.hp - damage)
            if (enePokemon.hp <= 0 && enePokemon.enduring) { enePokemon.hp = 1; enePokemon.enduring = false }
            await log(logsRef, "", "hit", { defender: enemySlot, hp: enePokemon.hp, maxHp: enePokemon.maxHp ?? enePokemon.hp })
            if (multiplier > 1) await log(logsRef, "효과가 굉장했다!")
            if (multiplier < 1) await log(logsRef, "효과가 별로인 듯하다…")
            if (minRoll) await log(logsRef, `${minDice}! (최소 피해 보장)`)
            else if (critical) await log(logsRef, "급소에 맞았다!", "critical")
            if (enePokemon.hp <= 0) await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 쓰러졌다!`, "faint")
          }
        }
      }
      myPokemon.flyMoveName = null
      const expMsgs = tickMyRanks(myPokemon); clearRankStack(myPokemon)
      for (const msg of expMsgs) await log(logsRef, msg)
      if (isAllFainted(enemyEntry)) {
        await safeUpdate(roomRef, { [`${mySlot}_entry`]: myEntry, [`${enemySlot}_entry`]: enemyEntry, turn_count: nextTurnCount, game_over: true, winner: myName, current_turn: null })
        await log(logsRef, `${myName}의 승리!`, "win")
      } else {
        await safeUpdate(roomRef, { [`${mySlot}_entry`]: myEntry, [`${enemySlot}_entry`]: enemyEntry, current_turn: enemySlot, turn_count: nextTurnCount })
      }
      return res.status(200).json({ ok: true })
    }

    // ── 구멍파기 2턴째
    if (myPokemon.digState?.digging) {
      myPokemon.digState = null
      await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} 땅속에서 튀어나왔다!`)
      await log(logsRef, "", "attack", { attacker: mySlot })
      const atkRankDig = getActiveRank(myPokemon, "atk")
      const defRankEneDig = getActiveRank(enePokemon, "def")
      const wasDefendingDig = enePokemon.defending ?? false
      enePokemon.defending = false; enePokemon.defendTurns = 0
      if (wasDefendingDig) {
        await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 방어했다!`)
      } else {
        const { hit, hitType } = calcHit(myPokemon, { accuracy: 100, type: "땅" }, enePokemon)
        if (!hit) {
          await log(logsRef, hitType === "evaded" ? `${enePokemon.name}에게는 맞지 않았다!` : `그러나 ${myPokemon.name}의 공격은 빗나갔다!`, hitType === "evaded" ? "evade" : "normal")
        } else {
          const digMoveName = myPokemon.digMoveName ?? "구멍파기"
          const { damage, multiplier, critical, minRoll, minDice } = calcDamage(myPokemon, digMoveName, enePokemon, atkRankDig, defRankEneDig, null, null, currentWeather)
          if (multiplier === 0) {
            await log(logsRef, `${enePokemon.name}에게는 효과가 없다…`)
          } else {
            enePokemon.hp = Math.max(0, enePokemon.hp - damage)
            if (enePokemon.hp <= 0 && enePokemon.enduring) { enePokemon.hp = 1; enePokemon.enduring = false }
            await log(logsRef, "", "hit", { defender: enemySlot, hp: enePokemon.hp, maxHp: enePokemon.maxHp ?? enePokemon.hp })
            if (multiplier > 1) await log(logsRef, "효과가 굉장했다!")
            if (multiplier < 1) await log(logsRef, "효과가 별로인 듯하다…")
            if (minRoll) await log(logsRef, `${minDice}! (최소 피해 보장)`)
            else if (critical) await log(logsRef, "급소에 맞았다!", "critical")
            if (enePokemon.hp <= 0) await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 쓰러졌다!`, "faint")
          }
        }
      }
      myPokemon.digMoveName = null
      const expMsgsDig = tickMyRanks(myPokemon); clearRankStack(myPokemon)
      for (const msg of expMsgsDig) await log(logsRef, msg)
      if (isAllFainted(enemyEntry)) {
        await safeUpdate(roomRef, { [`${mySlot}_entry`]: myEntry, [`${enemySlot}_entry`]: enemyEntry, turn_count: nextTurnCount, game_over: true, winner: myName, current_turn: null })
        await log(logsRef, `${myName}의 승리!`, "win")
      } else {
        await safeUpdate(roomRef, { [`${mySlot}_entry`]: myEntry, [`${enemySlot}_entry`]: enemyEntry, current_turn: enemySlot, turn_count: nextTurnCount })
      }
      return res.status(200).json({ ok: true })
    }

    // ── 고스트다이브 2턴째
    if (myPokemon.ghostDiveState?.diving) {
      myPokemon.ghostDiveState = null
      await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} 나타났다!`)
      await log(logsRef, "", "attack", { attacker: mySlot })
      const atkRankGD = getActiveRank(myPokemon, "atk")
      const defRankEneGD = getActiveRank(enePokemon, "def")
      enePokemon.defending = false; enePokemon.defendTurns = 0
      const { hit, hitType } = calcHit(myPokemon, { accuracy: 100, type: "고스트", alwaysHit: false }, enePokemon)
      if (!hit) {
        await log(logsRef, hitType === "evaded" ? `${enePokemon.name}에게는 맞지 않았다!` : `그러나 ${myPokemon.name}의 공격은 빗나갔다!`, hitType === "evaded" ? "evade" : "normal")
      } else {
        const gdMoveName = myPokemon.ghostDiveMoveName ?? "고스트다이브"
        const { damage, multiplier, critical, minRoll, minDice } = calcDamage(myPokemon, gdMoveName, enePokemon, atkRankGD, defRankEneGD, null, null, currentWeather)
        if (multiplier === 0) {
          await log(logsRef, `${enePokemon.name}에게는 효과가 없다…`)
        } else {
          enePokemon.hp = Math.max(0, enePokemon.hp - damage)
          if (enePokemon.hp <= 0 && enePokemon.enduring) { enePokemon.hp = 1; enePokemon.enduring = false }
          await log(logsRef, "", "hit", { defender: enemySlot, hp: enePokemon.hp, maxHp: enePokemon.maxHp ?? enePokemon.hp })
          if (multiplier > 1) await log(logsRef, "효과가 굉장했다!")
          if (multiplier < 1) await log(logsRef, "효과가 별로인 듯하다…")
          if (minRoll) await log(logsRef, `${minDice}! (최소 피해 보장)`)
          else if (critical) await log(logsRef, "급소에 맞았다!", "critical")
          if (enePokemon.hp <= 0) await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 쓰러졌다!`, "faint")
        }
      }
      myPokemon.ghostDiveMoveName = null
      const expMsgsGD = tickMyRanks(myPokemon); clearRankStack(myPokemon)
      for (const msg of expMsgsGD) await log(logsRef, msg)
      if (isAllFainted(enemyEntry)) {
        await safeUpdate(roomRef, { [`${mySlot}_entry`]: myEntry, [`${enemySlot}_entry`]: enemyEntry, turn_count: nextTurnCount, game_over: true, winner: myName, current_turn: null })
        await log(logsRef, `${myName}의 승리!`, "win")
      } else {
        await safeUpdate(roomRef, { [`${mySlot}_entry`]: myEntry, [`${enemySlot}_entry`]: enemyEntry, current_turn: enemySlot, turn_count: nextTurnCount })
      }
      return res.status(200).json({ ok: true })
    }

    // ── 참기 중이면 자동으로 턴 스킵
    if (myPokemon.bideState && (!moveInfo || !moveInfo?.bide)) {
      myPokemon.bideState.turnsLeft--
      if (myPokemon.bideState.turnsLeft > 0) {
        await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} 참고있다...`)
        await safeUpdate(roomRef, { [`${mySlot}_entry`]: myEntry, current_turn: enemySlot, turn_count: nextTurnCount })
      } else {
        const bide = myPokemon.bideState
        myPokemon.bideState = null
        await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} 참고있다...`)
        if (!bide || bide.damage <= 0) {
          await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} 참기 발사에 실패했다!`)
          await safeUpdate(roomRef, { [`${mySlot}_entry`]: myEntry, [`${enemySlot}_entry`]: enemyEntry, current_turn: enemySlot, turn_count: nextTurnCount })
        } else {
          const bideDmg = bide.damage * 2
          await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} 참았던 에너지를 방출했다!`)
          await log(logsRef, "", "attack", { attacker: mySlot })
          enePokemon.hp = Math.max(0, enePokemon.hp - bideDmg)
          if (enePokemon.hp <= 0 && enePokemon.enduring) { enePokemon.hp = 1; enePokemon.enduring = false }
          await log(logsRef, "", "hit", { defender: enemySlot, hp: enePokemon.hp, maxHp: enePokemon.maxHp ?? enePokemon.hp })
          await log(logsRef, `${bideDmg} 데미지!`)
          if (enePokemon.hp <= 0) await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 쓰러졌다!`, "faint")
          if (isAllFainted(enemyEntry)) {
            await safeUpdate(roomRef, { [`${mySlot}_entry`]: myEntry, [`${enemySlot}_entry`]: enemyEntry, turn_count: nextTurnCount, game_over: true, winner: myName, current_turn: null })
            await log(logsRef, `${myName}의 승리!`, "win")
          } else {
            await safeUpdate(roomRef, { [`${mySlot}_entry`]: myEntry, [`${enemySlot}_entry`]: enemyEntry, current_turn: enemySlot, turn_count: nextTurnCount })
          }
        }
      }
      return res.status(200).json({ ok: true })
    }

    const hitLog = (defender, pokemon) => log(logsRef, "", "hit", { defender, hp: pokemon.hp, maxHp: pokemon.maxHp ?? pokemon.hp })
    const hitSelfLog = () => log(logsRef, "", "hit_self", { slot: mySlot, hp: myPokemon.hp, maxHp: myPokemon.maxHp ?? myPokemon.hp })

    // 희망사항 회복
    const hpBefore = myPokemon.hp
    const wishMsgs = tickVolatiles(myPokemon)
    for (const msg of wishMsgs) await log(logsRef, msg)
    if (myPokemon.hp > hpBefore) {
      await log(logsRef, "", "heal_self", { slot: mySlot, hp: myPokemon.hp, maxHp: myPokemon.maxHp ?? myPokemon.hp })
    }

    tickVolatiles(enePokemon)

    if (myPokemon.futureSight?.ready) {
      const fs = myPokemon.futureSight
      myPokemon.futureSight = null
      await log(logsRef, `${fs.attackerName}의 미래예지!`)
      await log(logsRef, "", "attack", { attacker: mySlot })
      const atkRankFS = getActiveRank(myPokemon, "atk")
      const defRankEneFS = getActiveRank(enePokemon, "def")
      enePokemon.defending = false; enePokemon.defendTurns = 0
      const { damage, multiplier, critical, minRoll, minDice } = calcDamage(myPokemon, "미래예지", enePokemon, atkRankFS, defRankEneFS, null, null, currentWeather)
      if (multiplier === 0) {
        await log(logsRef, `${enePokemon.name}에게는 효과가 없다…`)
      } else {
        enePokemon.hp = Math.max(0, enePokemon.hp - damage)
        if (enePokemon.hp <= 0 && enePokemon.enduring) { enePokemon.hp = 1; enePokemon.enduring = false }
        await log(logsRef, "", "hit", { defender: enemySlot, hp: enePokemon.hp, maxHp: enePokemon.maxHp ?? enePokemon.hp })
        if (multiplier > 1) await log(logsRef, "효과가 굉장했다!")
        if (multiplier < 1) await log(logsRef, "효과가 별로인 듯하다…")
        if (minRoll) await log(logsRef, `${minDice}! (최소 피해 보장)`)
        else if (critical) await log(logsRef, "급소에 맞았다!", "critical")
        if (enePokemon.hp <= 0) await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 쓰러졌다!`, "faint")
      }
    }

    if ((myPokemon.lightScreenTurns ?? 0) > 0) {
      myPokemon.lightScreenTurns--
      if (!myPokemon.lightScreenTurns) await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "의")} 빛의 장막이 사라졌다!`)
    }
    if ((enePokemon.lightScreenTurns ?? 0) > 0) {
      enePokemon.lightScreenTurns--
      if (!enePokemon.lightScreenTurns) await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "의")} 빛의 장막이 사라졌다!`)
    }

    const preAction = checkPreActionStatus(myPokemon)
    for (const msg of preAction.msgs) await log(logsRef, msg)
    if (preAction.blocked) {
      resetRankStack(myPokemon)
      myPokemon.rollState = { active: false, turn: 0 }
      myPokemon.flyState = null
      myPokemon.digState = null
      const blockedExpiredMsgs = tickMyRanks(myPokemon)
      for (const msg of blockedExpiredMsgs) await log(logsRef, msg)
      await safeUpdate(roomRef, { [`${mySlot}_entry`]: myEntry, current_turn: enemySlot, turn_count: nextTurnCount })
      return res.status(200).json({ ok: true })
    }

    const confResult = checkConfusion(myPokemon)
    for (const msg of confResult.msgs) await log(logsRef, msg)
    if (confResult.selfHit) {
      resetRankStack(myPokemon)
      myPokemon.rollState = { active: false, turn: 0 }
      myPokemon.flyState = null
      myPokemon.digState = null
      const confExpiredMsgs = tickMyRanks(myPokemon)
      for (const msg of confExpiredMsgs) await log(logsRef, msg)
      await hitSelfLog()
      if (isAllFainted(myEntry)) {
        await safeUpdate(roomRef, { [`${mySlot}_entry`]: myEntry, turn_count: nextTurnCount, game_over: true, winner: enemyName, current_turn: null })
        await log(logsRef, `${enemyName}의 승리!`, "win")
      } else {
        await safeUpdate(roomRef, { [`${mySlot}_entry`]: myEntry, current_turn: enemySlot, turn_count: nextTurnCount })
      }
      return res.status(200).json({ ok: true })
    }

    if (myPokemon.tormented && moveData.name === myPokemon.lastUsedMove) {
      await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} 트집 때문에 같은 기술을 연속으로 쓸 수 없다!`)
      await safeUpdate(roomRef, { [`${mySlot}_entry`]: myEntry, current_turn: enemySlot, turn_count: nextTurnCount })
      return res.status(200).json({ ok: true })
    }

    myPokemon.moves[moveIdx] = { ...moveData, pp: moveData.pp - 1 }
    myPokemon.lastUsedMove = moveData.name
    await log(logsRef, `${myPokemon.name}의 ${moveData.name}!`)

    const diceRoll = rollD10()
    await log(logsRef, "", "dice", { slot: mySlot, roll: diceRoll })

    const globalWasDefending = enePokemon.defending ?? false
    if (globalWasDefending && !moveInfo?.ghostDive && !moveInfo?.targetSelf) {
      enePokemon.defending = false; enePokemon.defendTurns = 0
      await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 방어했다!`)
      if (moveInfo?.jumpKick) {
        const selfDmg = Math.max(1, Math.floor((myPokemon.maxHp ?? myPokemon.hp) * 0.25))
        myPokemon.hp = Math.max(0, myPokemon.hp - selfDmg)
        await hitSelfLog()
        await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} 반동으로 ${selfDmg} 데미지를 입었다!`)
      }
      await finishTurn({})
      return res.status(200).json({ ok: true })
    }
    enePokemon.defending = false; enePokemon.defendTurns = 0

    async function finishTurn(revengeUpdate = {}) {
      clearRankStack(myPokemon)
      const prevRanks = freshData[`${mySlot}_entry`][myActiveIdx].ranks ?? {}
      if (!myPokemon.ranks?.atkTurns && (prevRanks.atkTurns ?? 0) > 0)
        await log(logsRef, `${myPokemon.name}의 공격이 원래대로 돌아왔다!`)
      if (!myPokemon.ranks?.defTurns && (prevRanks.defTurns ?? 0) > 0)
        await log(logsRef, `${myPokemon.name}의 방어가 원래대로 돌아왔다!`)
      if (!myPokemon.ranks?.spdTurns && (prevRanks.spdTurns ?? 0) > 0)
        await log(logsRef, `${myPokemon.name}의 스피드가 원래대로 돌아왔다!`)

      const nextTurn = nextTurnCount

      if (isSecondToAct) {
        if (enePokemon.chainBound) {
          enePokemon.chainBound.turnsLeft--
          if (enePokemon.chainBound.turnsLeft <= 0) {
            await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "의")} 사슬묶기가 풀렸다!`)
            enePokemon.chainBound = null
          }
        }
        if (myPokemon.chainBound) {
          myPokemon.chainBound.turnsLeft--
          if (myPokemon.chainBound.turnsLeft <= 0) {
            await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "의")} 사슬묶기가 풀렸다!`)
            myPokemon.chainBound = null
          }
        }

        if (enePokemon.throatChopped > 0) {
          enePokemon.throatChopped--
          if (enePokemon.throatChopped <= 0) await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 다시 소리를 낼 수 있게 됐다!`)
        }
        if (myPokemon.throatChopped > 0) {
          myPokemon.throatChopped--
          if (myPokemon.throatChopped <= 0) await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} 다시 소리를 낼 수 있게 됐다!`)
        }

        if (enePokemon.healBlocked > 0) {
          enePokemon.healBlocked--
          if (enePokemon.healBlocked <= 0) await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "의")} 회복봉인이 풀렸다!`)
        }
        if (myPokemon.healBlocked > 0) {
          myPokemon.healBlocked--
          if (myPokemon.healBlocked <= 0) await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "의")} 회복봉인이 풀렸다!`)
        }

        if ((enePokemon.taunted ?? 0) > 0) {
          enePokemon.taunted--
          if (enePokemon.taunted <= 0) await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "의")} 도발이 풀렸다!`)
        }
        if ((myPokemon.taunted ?? 0) > 0) {
          myPokemon.taunted--
          if (myPokemon.taunted <= 0) await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "의")} 도발이 풀렸다!`)
        }

        if (enePokemon.seeded) {
          const lastTick = enePokemon.seededLastTick ?? (enePokemon.seededSince ?? nextTurn)
          if (nextTurn - lastTick >= 2) {
            const seedMsgs = applyLeechSeed(myEntry, myActiveIdx, enemyEntry, eneActiveIdx)
            for (const msg of seedMsgs) await log(logsRef, msg)
            await log(logsRef, "", "hit", { defender: enemySlot, hp: enePokemon.hp, maxHp: enePokemon.maxHp ?? enePokemon.hp })
            if (myPokemon.hp > 0) await log(logsRef, "", "heal", { slot: mySlot, hp: myPokemon.hp, maxHp: myPokemon.maxHp ?? myPokemon.hp })
            enePokemon.seededLastTick = nextTurn
          }
        }
        if (myPokemon.seeded) {
          const lastTick = myPokemon.seededLastTick ?? (myPokemon.seededSince ?? nextTurn)
          if (nextTurn - lastTick >= 2) {
            const seedMsgs2 = applyLeechSeed(enemyEntry, eneActiveIdx, myEntry, myActiveIdx)
            for (const msg of seedMsgs2) await log(logsRef, msg)
            await log(logsRef, "", "hit", { defender: mySlot, hp: myPokemon.hp, maxHp: myPokemon.maxHp ?? myPokemon.hp })
            const eneAfter = enemyEntry[eneActiveIdx]
            if (eneAfter && eneAfter.hp > 0) await log(logsRef, "", "heal", { slot: enemySlot, hp: eneAfter.hp, maxHp: eneAfter.maxHp ?? eneAfter.hp })
            myPokemon.seededLastTick = nextTurn
          }
        }

        // ★ wrap 틱뎀 (isSecondToAct 블록 안, aquaRing 바로 위)
        if (enePokemon.wrapState && enePokemon.wrapState.attackerSlot === mySlot) {
          const wrapDmg = Math.max(1, Math.floor((enePokemon.maxHp ?? enePokemon.hp) * 0.12))
          enePokemon.hp = Math.max(0, enePokemon.hp - wrapDmg)
          await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} ${enePokemon.wrapState.moveName}의 데미지를 받았다! (-${wrapDmg})`)
          await log(logsRef, "", "hit", { defender: enemySlot, hp: enePokemon.hp, maxHp: enePokemon.maxHp ?? enePokemon.hp })
          enePokemon.wrapState.turnsLeft--
          if (enePokemon.wrapState.turnsLeft <= 0) {
            enePokemon.wrapState = null
            await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 속박에서 풀려났다!`)
          }
          if (enePokemon.hp <= 0) await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 쓰러졌다!`, "faint")
        }
        if (myPokemon.wrapState && myPokemon.wrapState.attackerSlot === enemySlot) {
          const wrapDmg = Math.max(1, Math.floor((myPokemon.maxHp ?? myPokemon.hp) * 0.12))
          myPokemon.hp = Math.max(0, myPokemon.hp - wrapDmg)
          await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} ${myPokemon.wrapState.moveName}의 데미지를 받았다! (-${wrapDmg})`)
          await log(logsRef, "", "hit_self", { slot: mySlot, hp: myPokemon.hp, maxHp: myPokemon.maxHp ?? myPokemon.hp })
          myPokemon.wrapState.turnsLeft--
          if (myPokemon.wrapState.turnsLeft <= 0) {
            myPokemon.wrapState = null
            await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} 속박에서 풀려났다!`)
          }
          if (myPokemon.hp <= 0) await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} 쓰러졌다!`, "faint")
        }


        // ★ tickDmg 틱뎀 (김밥말이)
        if (enePokemon.tickDmgState) {
          const tickDmg = Math.max(1, Math.floor((enePokemon.maxHp ?? enePokemon.hp) * 0.12))
          enePokemon.hp = Math.max(0, enePokemon.hp - tickDmg)
          await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} ${enePokemon.tickDmgState.moveName}의 데미지를 받았다! (-${tickDmg})`)
          await log(logsRef, "", "hit", { defender: enemySlot, hp: enePokemon.hp, maxHp: enePokemon.maxHp ?? enePokemon.hp })
          enePokemon.tickDmgState.turnsLeft--
          if (enePokemon.tickDmgState.turnsLeft <= 0) {
            enePokemon.tickDmgState = null
            await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 풀려났다!`)
          }
          if (enePokemon.hp <= 0) await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 쓰러졌다!`, "faint")
        }
        if (myPokemon.tickDmgState) {
          const tickDmg = Math.max(1, Math.floor((myPokemon.maxHp ?? myPokemon.hp) * 0.12))
          myPokemon.hp = Math.max(0, myPokemon.hp - tickDmg)
          await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} ${myPokemon.tickDmgState.moveName}의 데미지를 받았다! (-${tickDmg})`)
          await log(logsRef, "", "hit_self", { slot: mySlot, hp: myPokemon.hp, maxHp: myPokemon.maxHp ?? myPokemon.hp })
          myPokemon.tickDmgState.turnsLeft--
          if (myPokemon.tickDmgState.turnsLeft <= 0) {
            myPokemon.tickDmgState = null
            await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} 풀려났다!`)
          }
          if (myPokemon.hp <= 0) await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} 쓰러졌다!`, "faint")
        }

        if (myPokemon.aquaRing && myPokemon.hp > 0 && !(myPokemon.healBlocked > 0)) {
          const heal = Math.max(1, Math.floor((myPokemon.maxHp ?? myPokemon.hp) / 16))
          myPokemon.hp = Math.min(myPokemon.maxHp ?? myPokemon.hp, myPokemon.hp + heal)
          await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} 아쿠아링으로 HP를 회복했다! (+${heal})`)
          await log(logsRef, "", "heal_self", { slot: mySlot, hp: myPokemon.hp, maxHp: myPokemon.maxHp ?? myPokemon.hp })
        }
        if (enePokemon.aquaRing && enePokemon.hp > 0 && !(enePokemon.healBlocked > 0)) {
          const heal = Math.max(1, Math.floor((enePokemon.maxHp ?? enePokemon.hp) / 16))
          enePokemon.hp = Math.min(enePokemon.maxHp ?? enePokemon.hp, enePokemon.hp + heal)
          await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 아쿠아링으로 HP를 회복했다! (+${heal})`)
          await log(logsRef, "", "heal", { slot: enemySlot, hp: enePokemon.hp, maxHp: enePokemon.maxHp ?? enePokemon.hp })
        }

        const eotHpBefore = { my: myPokemon.hp, ene: enePokemon.hp }
        const { msgs: eotMsgs, anyFainted } = applyEndOfTurnDamage([[myPokemon], [enePokemon]])
        for (const msg of eotMsgs) await log(logsRef, msg)
        if (myPokemon.hp !== eotHpBefore.my)
          await log(logsRef, "", "hit_self", { slot: mySlot, hp: myPokemon.hp, maxHp: myPokemon.maxHp ?? myPokemon.hp })
        if (enePokemon.hp !== eotHpBefore.ene)
          await log(logsRef, "", "hit", { defender: enemySlot, hp: enePokemon.hp, maxHp: enePokemon.maxHp ?? enePokemon.hp })

        const weatherForEot = revengeUpdate.weather !== undefined ? revengeUpdate.weather : currentWeather
        if (weatherForEot) {
          const weatherLog = getWeatherLog(weatherForEot)
          if (weatherLog) await log(logsRef, weatherLog)
          const { msgs: wMsgs, hitLogs, anyFainted: wFainted } =
            applyWeatherDamage(weatherForEot, myPokemon, mySlot, enePokemon, enemySlot)
          for (let i = 0; i < wMsgs.length; i++) {
            await log(logsRef, wMsgs[i])
            if (hitLogs[i]) {
              const hl = hitLogs[i]
              const isMySlot = hl.slot === mySlot
              await log(logsRef, "", isMySlot ? "hit_self" : "hit",
                isMySlot ? { slot: hl.slot, hp: hl.hp, maxHp: hl.maxHp } : { defender: hl.slot, hp: hl.hp, maxHp: hl.maxHp })
            }
          }
          const weatherTurnsForTick = revengeUpdate.weatherTurns !== undefined ? revengeUpdate.weatherTurns : currentWeatherTurns
          const { expired, weatherTurns: nextWeatherTurns } = tickWeather(weatherTurnsForTick)
          if (expired) {
            const allPokemon = [...myEntry, ...enemyEntry]
            const { msgs: endMsgs } = endWeather(weatherForEot, allPokemon)
            for (const msg of endMsgs) await log(logsRef, msg)
            revengeUpdate.weather = null
            revengeUpdate.weatherTurns = 0
          } else {
            revengeUpdate.weather = weatherForEot
            revengeUpdate.weatherTurns = nextWeatherTurns
          }
        }

        sanitizeEntries()

const anyFaintedTotal = anyFainted || myPokemon.hp <= 0 || enePokemon.hp <= 0
        if (anyFaintedTotal) {
          if (!isAllFainted(enemyEntry)) revengeUpdate[`revenge_ready_${enemySlot}`] = true
          if (isAllFainted(enemyEntry)) {
            await safeUpdate(roomRef, { [`${mySlot}_entry`]: myEntry, [`${enemySlot}_entry`]: enemyEntry, turn_count: nextTurn, game_over: true, winner: myName, current_turn: null, ...revengeUpdate })
            await log(logsRef, `${myName}의 승리!`, "win"); return
          } else if (isAllFainted(myEntry)) {
            await safeUpdate(roomRef, { [`${mySlot}_entry`]: myEntry, [`${enemySlot}_entry`]: enemyEntry, turn_count: nextTurn, game_over: true, winner: enemyName, current_turn: null, ...revengeUpdate })
            await log(logsRef, `${enemyName}의 승리!`, "win"); return
          }
        }
      } else {
        sanitizeEntries()
      }

      const myFainted = myPokemon.hp <= 0
      const eneFainted = enePokemon.hp <= 0
      if (myFainted) { myPokemon.bideState = null; myPokemon.rollState = { active: false, turn: 0 }; myPokemon.flyState = null; myPokemon.digState = null; myPokemon.wrapState = null; myPokemon.tickDmgState = null }
      if (eneFainted) { enePokemon.bideState = null; enePokemon.rollState = { active: false, turn: 0 }; enePokemon.flyState = null; enePokemon.digState = null; enePokemon.wrapState = null; enePokemon.tickDmgState = null }
      if (eneFainted) revengeUpdate[`revenge_ready_${enemySlot}`] = false
      if (myFainted) {
        revengeUpdate[`revenge_ready_${mySlot}`] = true
        revengeUpdate[`force_switch_${mySlot}`] = true
      } else {
        revengeUpdate[`force_switch_${mySlot}`] = false
      }

      if (isAllFainted(enemyEntry)) {
        await safeUpdate(roomRef, { [`${mySlot}_entry`]: myEntry, [`${enemySlot}_entry`]: enemyEntry, turn_count: nextTurn, game_over: true, winner: myName, current_turn: null, ...revengeUpdate })
        await log(logsRef, `${myName}의 승리!`, "win")
      } else if (isAllFainted(myEntry)) {
        await safeUpdate(roomRef, { [`${mySlot}_entry`]: myEntry, [`${enemySlot}_entry`]: enemyEntry, turn_count: nextTurn, game_over: true, winner: enemyName, current_turn: null, ...revengeUpdate })
        await log(logsRef, `${enemyName}의 승리!`, "win")
      } else if (myFainted) {
        await safeUpdate(roomRef, { [`${mySlot}_entry`]: myEntry, [`${enemySlot}_entry`]: enemyEntry, current_turn: mySlot, turn_count: nextTurn, ...revengeUpdate })
      } else {
        await safeUpdate(roomRef, { [`${mySlot}_entry`]: myEntry, [`${enemySlot}_entry`]: enemyEntry, current_turn: enemySlot, turn_count: nextTurn, ...revengeUpdate })
      }
    }

    if (moveInfo?.defend) {
      const moveName = moveData.name
      const prevSame = myPokemon.lastDefendMove === moveName
      const stack = myPokemon.defendStack ?? 0
      const chance = (prevSame && stack >= 1) ? (1 / 3) : 1.0
      if (Math.random() < chance) {
        myPokemon.defending = true; myPokemon.defendTurns = 2
        myPokemon.lastDefendMove = moveName
        myPokemon.defendStack = prevSame ? stack + 1 : 1
        await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} 방어 태세에 들어갔다!`)
      } else {
        myPokemon.lastDefendMove = null; myPokemon.defendStack = 0
        await log(logsRef, `그러나 ${moveName}에 실패했다!`)
      }
      await finishTurn({})
      return res.status(200).json({ ok: true })
    }

    if (moveInfo?.curse) {
      const atkTypes = Array.isArray(myPokemon.type) ? myPokemon.type : [myPokemon.type]
      const isGhost = atkTypes.includes("고스트")
      if (isGhost) {
        const selfDmg = Math.max(1, Math.floor((myPokemon.maxHp ?? myPokemon.hp) / 3))
        myPokemon.hp = Math.max(0, myPokemon.hp - selfDmg)
        await hitSelfLog()
        if (enePokemon.cursed) {
          await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 이미 저주 상태다!`)
        } else {
          enePokemon.cursed = true
          await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} 저주를 걸었다!`)
          await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 저주에 걸렸다!`)
        }
        if (myPokemon.hp <= 0) await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} 쓰러졌다!`, "faint")
      } else {
        const rankMsgs = applyRankChanges({ spd: -1, atk: 1, def: 1, turns: 2 }, myPokemon, enePokemon, moveData.name)
        for (const msg of rankMsgs) await log(logsRef, msg)
      }
      await finishTurn({})
      return res.status(200).json({ ok: true })
    }

  

    if (moveInfo?.charge) {
      myPokemon.charged = true
      const rankMsgs = applyRankChanges({ def: 1, turns: 2 }, myPokemon, enePokemon, moveData.name)
      for (const msg of rankMsgs) await log(logsRef, msg)
      await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} 전기를 충전했다!`)
      await finishTurn({})
      return res.status(200).json({ ok: true })
    }

    if (moveInfo?.healingWish) {
      myPokemon.hp = 0
      await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} 쓰러졌다!`, "faint")
      await log(logsRef, "", "hit_self", { slot: mySlot, hp: 0, maxHp: myPokemon.maxHp ?? myPokemon.hp })
      myEntry.forEach((p, i) => {
        if (i !== myActiveIdx && p.hp > 0) p.healOnSwitchIn = true
      })
      sanitizeEntries()
      await safeUpdate(roomRef, {
        [`${mySlot}_entry`]: myEntry,
        [`${enemySlot}_entry`]: enemyEntry,
        current_turn: mySlot,
        turn_count: nextTurnCount,
        [`force_switch_${mySlot}`]: true,
      })
      return res.status(200).json({ ok: true })
    }

    if (moveInfo?.wish) {
      myPokemon.wishTurns = 2
      await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} 희망사항을 빌었다!`)
      await finishTurn({})
      return res.status(200).json({ ok: true })
    }

    if (moveInfo?.aquaRing) {
      myPokemon.aquaRing = true
      await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} 물의 베일로 몸을 감쌌다!`)
      await finishTurn({})
      return res.status(200).json({ ok: true })
    }

    if (moveInfo?.healBlock) {
      if (enePokemon.healBlocked > 0) {
        await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 이미 회복봉인 상태다!`)
      } else {
        enePokemon.healBlocked = 3
        await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "의")} HP 회복이 봉인됐다!`)
      }
      await finishTurn({})
      return res.status(200).json({ ok: true })
    }

    if (moveInfo?.torment) {
      const { hit, hitType } = calcHit(myPokemon, moveInfo, enePokemon)
      if (!hit) {
        await log(logsRef, hitType === "evaded" ? `${enePokemon.name}에게는 맞지 않았다!` : `그러나 ${myPokemon.name}의 공격은 빗나갔다!`, hitType === "evaded" ? "evade" : "normal")
      } else if (enePokemon.tormented) {
        await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 이미 트집 상태다!`)
      } else {
        enePokemon.tormented = true
        await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 트집을 잡혔다!`)
      }
      await finishTurn({})
      return res.status(200).json({ ok: true })
    }

    if (moveInfo?.taunt) {
      const { hit, hitType } = calcHit(myPokemon, moveInfo, enePokemon)
      if (!hit) {
        await log(logsRef, hitType === "evaded" ? `${enePokemon.name}에게는 맞지 않았다!` : `그러나 ${myPokemon.name}의 공격은 빗나갔다!`, hitType === "evaded" ? "evade" : "normal")
      } else if ((enePokemon.taunted ?? 0) > 0) {
        await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 이미 도발 상태다!`)
      } else {
        enePokemon.taunted = 3
        await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 도발에 걸렸다!`)
      }
      await finishTurn({})
      return res.status(200).json({ ok: true })
    }

    if (moveInfo?.memento) {
      const { hit, hitType } = calcHit(myPokemon, moveInfo, enePokemon)
      if (!hit) {
        await log(logsRef, hitType === "evaded" ? `${enePokemon.name}에게는 맞지 않았다!` : `그러나 ${myPokemon.name}의 공격은 빗나갔다!`, hitType === "evaded" ? "evade" : "normal")
        await finishTurn({})
        return res.status(200).json({ ok: true })
      }
      myPokemon.hp = 0
      await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} 모든 것을 바쳤다!`)
      await log(logsRef, "", "hit_self", { slot: mySlot, hp: 0, maxHp: myPokemon.maxHp ?? myPokemon.hp })
      await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} 쓰러졌다!`, "faint")
      const rankMsgs = applyRankChanges({ targetAtk: -2, turns: 2 }, myPokemon, enePokemon, null)
      for (const msg of rankMsgs) await log(logsRef, msg)
      await finishTurn({})
      return res.status(200).json({ ok: true })
    }

    if (moveInfo?.lightScreen) {
      myPokemon.lightScreenTurns = 5
      await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} 빛의 장막을 쳤다!`)
      await finishTurn({})
      return res.status(200).json({ ok: true })
    }

    if (moveInfo?.chainBind) {
      const { hit, hitType } = calcHit(myPokemon, moveInfo, enePokemon)
      if (!hit) {
        await log(logsRef, hitType === "evaded" ? `${enePokemon.name}에게는 맞지 않았다!` : `그러나 ${myPokemon.name}의 공격은 빗나갔다!`, hitType === "evaded" ? "evade" : "normal")
        await finishTurn({})
        return res.status(200).json({ ok: true })
      }
      const lastMove = enePokemon.lastUsedMove ?? null
      if (!lastMove) {
        await log(logsRef, `그러나 ${enePokemon.name}에게는 효과가 없었다!`)
      } else {
        enePokemon.chainBound = { moveName: lastMove, turnsLeft: isSecondToAct ? 3 : 2 }
        await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} ${lastMove}${josa(lastMove, "을를")} 2턴간 사용할 수 없게 됐다!`)
      }
      await finishTurn({})
      return res.status(200).json({ ok: true })
    }

    if (moveInfo?.rollout) {
      const rollState = myPokemon.rollState ?? { active: false, turn: 0 }
      const rollTurn = rollState.active ? rollState.turn + 1 : 1
      const rollPower = rollTurn === 1 ? 30 : rollTurn === 2 ? 60 : 120
      const { hit, hitType } = calcHit(myPokemon, moveInfo, enePokemon)
      if (!hit) {
        await log(logsRef, hitType === "evaded" ? `${enePokemon.name}에게는 맞지 않았다!` : `그러나 ${myPokemon.name}의 공격은 빗나갔다!`, hitType === "evaded" ? "evade" : "normal")
        myPokemon.rollState = { active: false, turn: 0 }
      } else {
        await log(logsRef, "", "attack", { attacker: mySlot })
        const dmg = calcRolloutDamage(moveData.name, enePokemon, rollPower)
        enePokemon.hp = Math.max(0, enePokemon.hp - dmg)
        await hitLog(enemySlot, enePokemon)
        await log(logsRef, `구르기 ${rollTurn}번째 (${rollPower} 데미지)!`)
        if (enePokemon.hp <= 0) await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 쓰러졌다!`, "faint")
        myPokemon.rollState = rollTurn >= 3 ? { active: false, turn: 0 } : { active: true, turn: rollTurn }
      }
      const expMsgs = tickMyRanks(myPokemon); clearRankStack(myPokemon)
      for (const msg of expMsgs) await log(logsRef, msg)
      const rollEotHpBefore = { my: myPokemon.hp, ene: enePokemon.hp }
      const { msgs: rollEotMsgs, anyFainted: rollEotFainted } = applyEndOfTurnDamage([[myPokemon], [enePokemon]])
      for (const msg of rollEotMsgs) await log(logsRef, msg)
      if (myPokemon.hp !== rollEotHpBefore.my)
        await log(logsRef, "", "hit_self", { slot: mySlot, hp: myPokemon.hp, maxHp: myPokemon.maxHp ?? myPokemon.hp })
      if (enePokemon.hp !== rollEotHpBefore.ene)
        await log(logsRef, "", "hit", { defender: enemySlot, hp: enePokemon.hp, maxHp: enePokemon.maxHp ?? enePokemon.hp })
      if (isAllFainted(enemyEntry)) {
        await safeUpdate(roomRef, { [`${mySlot}_entry`]: myEntry, [`${enemySlot}_entry`]: enemyEntry, turn_count: nextTurnCount, game_over: true, winner: myName, current_turn: null })
        await log(logsRef, `${myName}의 승리!`, "win")
      } else if (isAllFainted(myEntry)) {
        await safeUpdate(roomRef, { [`${mySlot}_entry`]: myEntry, [`${enemySlot}_entry`]: enemyEntry, turn_count: nextTurnCount, game_over: true, winner: enemyName, current_turn: null })
        await log(logsRef, `${enemyName}의 승리!`, "win")
      } else {
        await safeUpdate(roomRef, { [`${mySlot}_entry`]: myEntry, [`${enemySlot}_entry`]: enemyEntry, current_turn: enemySlot, turn_count: nextTurnCount })
      }
      return res.status(200).json({ ok: true })
    }

    if (moveInfo?.outrage) {
      const atkRankOut = getActiveRank(myPokemon, "atk")
      const defRankEneOut = getActiveRank(enePokemon, "def")
      const outrageUpdate = {}
      const outrageInfo = moveInfo.outrage
      const state = myPokemon.outrageState
      const isFirst = !state?.active
      const maxTurn = isFirst ? Math.floor(Math.random() * (outrageInfo.maxTurn - outrageInfo.minTurn + 1)) + outrageInfo.minTurn : state.maxTurn
      const currentTurn = isFirst ? 1 : state.turn
      const power = outrageInfo.powers[Math.min(currentTurn - 1, outrageInfo.powers.length - 1)]
      const isLastTurn = currentTurn >= maxTurn
      await log(logsRef, "", "attack", { attacker: mySlot })
      const { hit, hitType } = calcHit(myPokemon, moveInfo, enePokemon)
      if (!hit) {
        if (hitType === "evaded") await log(logsRef, `${enePokemon.name}에게는 맞지 않았다!`, "evade")
        else await log(logsRef, `그러나 ${myPokemon.name}의 공격은 빗나갔다!`)
      } else {
        const { damage, multiplier, critical, minRoll, minDice } = calcDamage(myPokemon, moveData.name, enePokemon, atkRankOut, defRankEneOut, power, null, currentWeather)
        if (multiplier === 0) {
          await log(logsRef, `${enePokemon.name}에게는 효과가 없다…`)
        } else {
          enePokemon.hp = Math.max(0, enePokemon.hp - damage)
          if (enePokemon.hp <= 0 && enePokemon.enduring) { enePokemon.hp = 1; enePokemon.enduring = false }
          await hitLog(enemySlot, enePokemon)
          if (enePokemon.flyState?.flying && moves[moveData.name]?.type === "번개") { enePokemon.flyState = null; enePokemon.flyMoveName = null; await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 번개에 맞아 땅으로 떨어졌다!`) }
          if (enePokemon.digState?.digging && moves[moveData.name]?.type === "지진") { enePokemon.digState = null; enePokemon.digMoveName = null; await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 지진에 맞아 땅 위로 튀어나왔다!`) }
          recordDmg(outrageUpdate, enemySlot, damage)
          if (multiplier > 1) await log(logsRef, "효과가 굉장했다!")
          if (multiplier < 1) await log(logsRef, "효과가 별로인 듯하다…")
          if (minRoll) await log(logsRef, `${minDice}! (최소 피해 보장)`)
          else if (critical) await log(logsRef, "급소에 맞았다!", "critical")
          if (enePokemon.hp <= 0) await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 쓰러졌다!`, "faint")
        }
      }
      if (isLastTurn) {
  myPokemon.outrageState = null
  if (outrageInfo.confusion && (myPokemon.confusion ?? 0) <= 0) {
    myPokemon.confusion = Math.floor(Math.random() * 3) + 1
    await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} 혼란에 빠졌다!`)
  }
  await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "의")} ${moveData.name}이 끝났다!`)
} else {
  myPokemon.outrageState = { active: true, turn: currentTurn + 1, maxTurn, moveName: moveData.name }
  if (!outrageInfo.confusion) await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} 소란을 피우고 있다!`)
}
      await finishTurn(outrageUpdate)
      return res.status(200).json({ ok: true })
    }

    if (moveInfo?.leechSeed) {
      const eneTypes = Array.isArray(enePokemon.type) ? enePokemon.type : [enePokemon.type]
      if (eneTypes.includes("풀")) {
        await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 씨뿌리기에 걸리지 않는다!`)
      } else if (enePokemon.seeded) {
        await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 이미 씨뿌리기 상태다!`)
      } else {
        const { hit, hitType } = calcHit(myPokemon, moveInfo, enePokemon)
        if (!hit) {
          await log(logsRef, hitType === "evaded" ? `${enePokemon.name}에게는 맞지 않았다!` : `그러나 ${myPokemon.name}의 공격은 빗나갔다!`, hitType === "evaded" ? "evade" : "normal")
        } else {
          enePokemon.seeded = true
          enePokemon.seededSince = nextTurnCount
          enePokemon.seededLastTick = nextTurnCount
          await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "의")} 몸에 씨를 뿌렸다!`)
        }
      }
      await finishTurn({})
      return res.status(200).json({ ok: true })
    }

    if (moveInfo?.healPulse) {
      if ((enePokemon.healBlocked ?? 0) > 0) {
        await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 회복봉인 상태라 회복할 수 없다!`)
        await finishTurn({})
        return res.status(200).json({ ok: true })
      }
      const heal = Math.max(1, Math.floor((enePokemon.maxHp ?? enePokemon.hp) * 0.22))
      enePokemon.hp = Math.min(enePokemon.maxHp ?? enePokemon.hp, enePokemon.hp + heal)
      await log(logsRef, "", "hit", { defender: enemySlot, hp: enePokemon.hp, maxHp: enePokemon.maxHp ?? enePokemon.hp })
      await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} HP를 회복했다! (+${heal})`)
      await finishTurn({})
      return res.status(200).json({ ok: true })
    }

    if (moveInfo?.bide) {
      myPokemon.bideState = { turnsLeft: 2, damage: 0 }
      await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} 참기 시작했다!`)
      await finishTurn({})
      return res.status(200).json({ ok: true })
    }

    if (moveInfo?.fly && !myPokemon.flyState?.flying) {
      myPokemon.flyState = { flying: true }
      myPokemon.flyMoveName = moveData.name
      await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} 하늘 높이 날아올랐다!`)
      await finishTurn({})
      return res.status(200).json({ ok: true })
    }

    if (moveInfo?.dig && !myPokemon.digState?.digging) {
      myPokemon.digState = { digging: true }
      myPokemon.digMoveName = moveData.name
      await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} 땅속으로 파고들었다!`)
      await finishTurn({})
      return res.status(200).json({ ok: true })
    }

    if (moveInfo?.meteorBeam && !myPokemon.meteorBeamState?.charging) {
  myPokemon.meteorBeamState = { charging: true }
  const rankMsgs = applyRankChanges({ atk: 1, turns: 3 }, myPokemon, enePokemon, moveData.name)
  for (const msg of rankMsgs) await log(logsRef, msg)
  await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} 우주의 힘을 모으고 있다!`)
  await finishTurn({})
  return res.status(200).json({ ok: true })
}
if (myPokemon.meteorBeamState?.charging) {
  myPokemon.meteorBeamState = null
}

    if (moveInfo?.solarBlade && !myPokemon.solarBladeState?.charging) {
  if (currentWeather === "쾌청") {
    // 쾌청이면 바로 공격 (아래 일반 공격 흐름으로 넘어감)
  } else {
    myPokemon.solarBladeState = { charging: true }
    await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} 빛을 모으고 있다!`)
    await finishTurn({})
    return res.status(200).json({ ok: true })
  }
}

// 2턴째 발사
if (myPokemon.solarBladeState?.charging) {
  myPokemon.solarBladeState = null
}

    if (moveInfo?.ghostDive && !myPokemon.ghostDiveState?.diving) {
      myPokemon.ghostDiveState = { diving: true }
      myPokemon.ghostDiveMoveName = moveData.name
      await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} 어디론가 사라졌다!`)
      await finishTurn({})
      return res.status(200).json({ ok: true })
    }

    if (moveInfo?.futureSight) {
      if (myPokemon.futureSight) {
        await log(logsRef, `이미 미래예지가 걸려있다!`)
      } else {
        myPokemon.futureSight = { turnsLeft: 2, attackerName: myPokemon.name, power: 70 }
        await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} 미래를 예지했다!`)
      }
      await finishTurn({})
      return res.status(200).json({ ok: true })
    }

    if (moveInfo?.fakeOut) {
      const { hit, hitType } = calcHit(myPokemon, moveInfo, enePokemon)
      if (!hit) {
        await log(logsRef, hitType === "evaded" ? `${enePokemon.name}에게는 맞지 않았다!` : `그러나 ${myPokemon.name}의 공격은 빗나갔다!`, hitType === "evaded" ? "evade" : "normal")
        await finishTurn({})
        return res.status(200).json({ ok: true })
      }
      if (Math.random() < 0.5) {
        await log(logsRef, "", "attack", { attacker: mySlot })
        const atkRankFO = getActiveRank(myPokemon, "atk")
        const defRankFO = getActiveRank(enePokemon, "def")
        const { damage, multiplier, critical, minRoll, minDice } = calcDamage(myPokemon, moveData.name, enePokemon, atkRankFO, defRankFO, null, null, currentWeather)
        if (multiplier === 0) {
          await log(logsRef, `${enePokemon.name}에게는 효과가 없다…`)
        } else {
          enePokemon.hp = Math.max(0, enePokemon.hp - damage)
          if (enePokemon.hp <= 0 && enePokemon.enduring) { enePokemon.hp = 1; enePokemon.enduring = false }
          await log(logsRef, "", "hit", { defender: enemySlot, hp: enePokemon.hp, maxHp: enePokemon.maxHp ?? enePokemon.hp })
          if (multiplier > 1) await log(logsRef, "효과가 굉장했다!")
          if (multiplier < 1) await log(logsRef, "효과가 별로인 듯하다…")
          if (minRoll) await log(logsRef, `${minDice}! (최소 피해 보장)`)
          else if (critical) await log(logsRef, "급소에 맞았다!", "critical")
          if (enePokemon.hp > 0) { enePokemon.flinch = true; await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 풀이 죽었다!`) }
          if (enePokemon.hp <= 0) await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 쓰러졌다!`, "faint")
        }
      } else {
        await log(logsRef, `속이기에 실패했다!`)
        const rankMsgsFO = applyRankChanges({ def: -2, turns: 2 }, myPokemon, enePokemon, null)
        for (const msg of rankMsgsFO) await log(logsRef, msg)
      }
      await finishTurn({})
      return res.status(200).json({ ok: true })
    }

    if (moveInfo?.haze) {
      const resetR = (p) => {
        if (p.ranks) { p.ranks.atk = 0; p.ranks.atkTurns = 0; p.ranks.def = 0; p.ranks.defTurns = 0; p.ranks.spd = 0; p.ranks.spdTurns = 0 }
        p.lastRankMove = null; p.rankStack = 0; p.weatherDefBoost = false
      }
      resetR(myPokemon); resetR(enePokemon)
      await log(logsRef, `흑안개가 배틀 전체를 뒤덮었다!`)
      await log(logsRef, `모든 포켓몬의 능력 변화가 원래대로 돌아왔다!`)
      await finishTurn({})
      return res.status(200).json({ ok: true })
    }

    if (moveInfo?.splash) {
      await log(logsRef, `그러나 아무 일도 일어나지 않았다!`)
      await finishTurn({})
      return res.status(200).json({ ok: true })
    }

    if (moveInfo?.burnOff) {
  const myTypes = Array.isArray(myPokemon.type) ? myPokemon.type : [myPokemon.type]
  if (!myTypes.includes("불")) {
    await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} 불타입이 아니라 실패했다!`)
    await finishTurn({})
    return res.status(200).json({ ok: true })
  }
  const { hit, hitType } = calcHit(myPokemon, moveInfo, enePokemon)
  if (!hit) {
    myPokemon.lastMoveMissed = true
    if (hitType === "evaded") await log(logsRef, `${enePokemon.name}에게는 맞지 않았다!`, "evade")
    else await log(logsRef, `그러나 ${myPokemon.name}의 공격은 빗나갔다!`)
    await finishTurn({})
    return res.status(200).json({ ok: true })
  }
  myPokemon.lastMoveMissed = false
  await log(logsRef, "", "attack", { attacker: mySlot })
  const atkRankBO = getActiveRank(myPokemon, "atk")
  const defRankEneBO = getActiveRank(enePokemon, "def")
  const { damage, multiplier, critical, minRoll, minDice } = calcDamage(myPokemon, moveData.name, enePokemon, atkRankBO, defRankEneBO, null, null, currentWeather)
  
  // 독립적인 burnOffUpdate 객체 사용
  const burnOffUpdate = {}
  
  if (multiplier === 0) {
    await log(logsRef, `${enePokemon.name}에게는 효과가 없다…`)
  } else {
    enePokemon.hp = Math.max(0, enePokemon.hp - damage)
    if (enePokemon.hp <= 0 && enePokemon.enduring) { enePokemon.hp = 1; enePokemon.enduring = false }
    await hitLog(enemySlot, enePokemon)
    if (multiplier > 1) await log(logsRef, "효과가 굉장했다!")
    if (multiplier < 1) await log(logsRef, "효과가 별로인 듯하다…")
    if (minRoll) await log(logsRef, `${minDice}! (최소 피해 보장)`)
    else if (critical) await log(logsRef, "급소에 맞았다!", "critical")
    if (enePokemon.hp <= 0) await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 쓰러졌다!`, "faint")
    recordDmg(burnOffUpdate, enemySlot, damage)  // burnOffUpdate에 기록
  }
  
  // 불 타입 제거
  const types = Array.isArray(myPokemon.type) ? [...myPokemon.type] : [myPokemon.type]
  myPokemon._origType = [...types]
  myPokemon.type = types.filter(t => t !== "불")
  if (myPokemon.type.length === 0) myPokemon.type = ["노말"]
  myPokemon.roostTurns = 3
  await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} 불꽃을 다 태워버려 불타입이 사라졌다!`)
  await finishTurn(burnOffUpdate)  // ★ burnOffUpdate 전달
  return res.status(200).json({ ok: true })
}

    if (moveInfo?.divineStrike) {
      if (Math.random() < 0.15) {
        await log(logsRef, `이게 되네!!`)
        await log(logsRef, `상대 포켓몬이 전멸했다!`)
        enemyEntry.forEach(p => { p.hp = 0 })
        await safeUpdate(roomRef, {
          [`${mySlot}_entry`]: myEntry,
          [`${enemySlot}_entry`]: enemyEntry,
          turn_count: nextTurnCount,
          game_over: true,
          winner: myName,
          current_turn: null
        })
        await log(logsRef, `${myName}의 승리!`, "win")
      } else {
        await log(logsRef, `그러나 아무 일도 일어나지 않았다!`)
        await finishTurn({})
      }
      return res.status(200).json({ ok: true })
    }

    if (moveInfo?.poisonPowder) {
      const eneTypes = Array.isArray(enePokemon.type) ? enePokemon.type : [enePokemon.type]
      if (eneTypes.includes("풀")) {
        await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} ${moveData.name}에 걸리지 않는다!`)
      } else if (enePokemon.status) {
        await log(logsRef, `그러나 ${enePokemon.name}${josa(enePokemon.name, "은는")} 이미 상태이상이다!`)
      } else {
        const { hit, hitType } = calcHit(myPokemon, moveInfo, enePokemon)
        if (!hit) {
          await log(logsRef, hitType === "evaded" ? `${enePokemon.name}에게는 맞지 않았다!` : `그러나 ${myPokemon.name}의 공격은 빗나갔다!`, hitType === "evaded" ? "evade" : "normal")
        } else {
          const statusMsgs = applyStatus(enePokemon, moveInfo.effect?.status ?? "독", currentWeather)
          for (const msg of statusMsgs) await log(logsRef, msg)
        }
      }
      await finishTurn({})
      return res.status(200).json({ ok: true })
    }

     if (moveInfo?.roar) {
  const candidates = enemyEntry.map((p, i) => ({ p, i })).filter(({ p, i }) => i !== eneActiveIdx && p.hp > 0)
  if (candidates.length === 0) {
    await log(logsRef, `그러나 ${enePokemon.name}에게는 맞지 않았다!`)
  } else {
    const chosen = candidates[Math.floor(Math.random() * candidates.length)]
    await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 물러났다!`)
    await log(logsRef, `${chosen.p.name}${josa(chosen.p.name, "이가")} 나왔다!`)
    chosen.p.seeded = false

    // ★ 교대 출전 필드 효과 적용
    const { msgs: fieldMsgs, hitLogs, statusMsgs, fieldUpdate } =
      applyFieldEffects(chosen.p, enemySlot, freshData)

    let ts = Date.now()
    for (const msg of fieldMsgs) await log(logsRef, msg)
    for (const hl of hitLogs) {
      await log(logsRef, "", "hit", {
        defender: enemySlot, hp: hl.hp, maxHp: hl.maxHp
      })
    }
    for (const msg of statusMsgs) await log(logsRef, msg)

    // 필드 효과로 쓰러진 경우 → 또 강제교체
    const fainted = chosen.p.hp <= 0
    const allFainted = enemyEntry.every(p => p.hp <= 0)

    await safeUpdate(roomRef, {
      [`${mySlot}_entry`]: myEntry,
      [`${enemySlot}_entry`]: enemyEntry,
      [`${enemySlot}_active_idx`]: chosen.i,
      current_turn: enemySlot,
      turn_count: nextTurnCount,
      ...fieldUpdate,
      ...(fainted && !allFainted ? { [`force_switch_${enemySlot}`]: true, current_turn: enemySlot } : {}),
      ...(allFainted ? { game_over: true, winner: myName, current_turn: null } : {})
    })

    if (allFainted) {
      await log(logsRef, `${myName}의 승리!`, "win")
    }
  }
  return res.status(200).json({ ok: true })
}

    if (!moveInfo?.power) {  
      const r = moveInfo?.rank
      const targetsEnemy = (r && (r.targetAtk !== undefined || r.targetDef !== undefined || r.targetSpd !== undefined)) || moveInfo?.targetSelf === false
      if (targetsEnemy) {
        const { hit, hitType } = calcHit(myPokemon, moveInfo, enePokemon)
        if (!hit) {
          await log(logsRef, hitType === "evaded" ? `${enePokemon.name}에게는 맞지 않았다!` : `그러나 ${myPokemon.name}의 공격은 빗나갔다!`, hitType === "evaded" ? "evade" : "normal")
          await finishTurn({})
          return res.status(200).json({ ok: true })
        }
      } else {
        if (!moveInfo?.alwaysHit && Math.random() * 100 >= (moveInfo?.accuracy ?? 100)) {
          await log(logsRef, `그러나 ${myPokemon.name}의 기술은 실패했다!`)
          await finishTurn({})
          return res.status(200).json({ ok: true })
        }
      }

      if (moveInfo?.field) {
        const fieldKey = `${moveInfo.field}_${enemySlot}`
        if (freshData[fieldKey]) {
          await log(logsRef, `이미 ${moveData.name}${josa(moveData.name, "이가")} 설치되어 있다!`)
        } else {
          await log(logsRef, `상대방 발밑에 ${moveData.name}${josa(moveData.name, "을를")} 뿌렸다!`)
          await finishTurn({ [fieldKey]: true })
          return res.status(200).json({ ok: true })
        }
        await finishTurn({})
        return res.status(200).json({ ok: true })
      }

      if (moveInfo?.effect?.moonlight) {
        if ((myPokemon.healBlocked ?? 0) > 0) {
          await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} 회복봉인 상태라 회복할 수 없다!`)
          await finishTurn({})
          return res.status(200).json({ ok: true })
        }
        const enemyActive = enemyEntry[eneActiveIdx]
        const isUproar = enemyActive?.outrageState?.active && moves[enemyActive.outrageState.moveName]?.outrage?.confusion === false
        const healRate = currentWeather === "쾌청" ? 0.25 : (currentWeather === "비" || currentWeather === "모래바람" || currentWeather === "싸라기눈" || isUproar) ? 0.18 : 0.22
        const heal = Math.max(1, Math.floor((myPokemon.maxHp ?? myPokemon.hp) * healRate))
        myPokemon.hp = Math.min(myPokemon.maxHp ?? myPokemon.hp, myPokemon.hp + heal)
        await log(logsRef, "", "heal_self", { slot: mySlot, hp: myPokemon.hp, maxHp: myPokemon.maxHp ?? myPokemon.hp })
        await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} HP를 회복했다! (+${heal})`)
        await finishTurn({})
        return res.status(200).json({ ok: true })
      }

      if (moveInfo?.effect?.weather) {
        const allPokemon = [...myEntry, ...enemyEntry]
        const prevWeather = currentWeather
        const { msgs: wStartMsgs, weather: newWeather, weatherTurns: newTurns } =
          startWeather(moveInfo.effect.weather, moveInfo.effect.weatherTurns ?? 5, prevWeather, allPokemon)
        for (const msg of wStartMsgs) await log(logsRef, msg)
        await finishTurn({ weather: newWeather, weatherTurns: newTurns })
        return res.status(200).json({ ok: true })
      }

      if (moveInfo?.clearSmog) {
        enePokemon.ranks = defaultRanks()
        await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "의")} 능력 변화가 원래대로 돌아왔다!`)
      }

     if (moveInfo?.effect?.removeFlying) {
  if ((myPokemon.healBlocked ?? 0) > 0) {
    await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} 회복봉인 상태라 날개쉬기에 실패했다!`)
    await finishTurn({})
    return res.status(200).json({ ok: true })
  }
  const healRate = moveInfo.effect.heal ?? 0.5
  const heal = Math.max(1, Math.floor((myPokemon.maxHp ?? myPokemon.hp) * healRate))
  myPokemon.hp = Math.min(myPokemon.maxHp ?? myPokemon.hp, myPokemon.hp + heal)
  await log(logsRef, "", "heal_self", { slot: mySlot, hp: myPokemon.hp, maxHp: myPokemon.maxHp ?? myPokemon.hp })
  await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} HP를 회복했다! (+${heal})`)
  const types = Array.isArray(myPokemon.type) ? [...myPokemon.type] : [myPokemon.type]
  myPokemon._origType = myPokemon.type
  if (types.length === 1) { myPokemon.type = ["노말"] }
  else { myPokemon.type = types.filter(t => t !== "비행"); if (myPokemon.type.length === 0) myPokemon.type = ["노말"] }
  myPokemon.roostTurns = 3
  await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} 땅에 내려앉아 비행 타입이 사라졌다!`)
  await finishTurn({})
  return res.status(200).json({ ok: true })
}
      let rankToApply = r
      if (moveData.name === "성장" && r) {
        rankToApply = { ...r, atk: getSunnyGrowthBonus(currentWeather) }
      }
      const rankMsgs = applyRankChanges(rankToApply, myPokemon, enePokemon, moveData.name)
      for (const msg of rankMsgs) await log(logsRef, msg)
      if (moveInfo?.effect?.heal) {
        if ((myPokemon.healBlocked ?? 0) > 0) {
          await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} 회복봉인 상태라 회복할 수 없다!`)
          await finishTurn({})
          return res.status(200).json({ ok: true })
        }
        const healRate = moveInfo.effect.heal
        const heal = Math.max(1, Math.floor((myPokemon.maxHp ?? myPokemon.hp) * healRate))
        myPokemon.hp = Math.min(myPokemon.maxHp ?? myPokemon.hp, myPokemon.hp + heal)
        await log(logsRef, "", "heal_self", { slot: mySlot, hp: myPokemon.hp, maxHp: myPokemon.maxHp ?? myPokemon.hp })
        await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} HP를 회복했다! (+${heal})`)
        await finishTurn({})
        return res.status(200).json({ ok: true })
      } else {
        const rankEffectMsgs = applyMoveEffect(moveInfo?.effect, myPokemon, enePokemon, 0, currentWeather)
        for (const msg of rankEffectMsgs) await log(logsRef, msg)
      }
      await finishTurn({})
      return res.status(200).json({ ok: true })
    }

    if (enePokemon.hp <= 0) {
      await finishTurn(revengeUpdate ?? {})
      return res.status(200).json({ ok: true })
    }

    resetRankStack(myPokemon)
    myPokemon.lastDefendMove = null; myPokemon.defendStack = 0

    const atkRank = getActiveRank(myPokemon, "atk")
    const defRankEne = moveInfo?.ignoreDefRank ? 0 : getActiveRank(enePokemon, "def")

    const chargedMult = (myPokemon.charged && moves[moveData.name]?.type === "전기") ? 1.2 : 1.0
    myPokemon.charged = false

    await log(logsRef, "", "attack", { attacker: mySlot })

    const revengeUpdate = {}
    if (moveInfo?.revenge) revengeUpdate[`revenge_ready_${mySlot}`] = false

    if (moveInfo?.endure) {
      const prevEndure = myPokemon.lastEndureMove === "버티기"
      const stack = myPokemon.endureStack ?? 0
      let chance = 1.0
      if (prevEndure && stack >= 1) chance = stack >= 2 ? 0.25 : 0.5
      if (Math.random() < chance) {
        myPokemon.enduring = true
        myPokemon.lastEndureMove = "버티기"
        myPokemon.endureStack = prevEndure ? Math.min(2, stack + 1) : 1
        await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} 버티기 태세에 들어갔다!`)
      } else {
        myPokemon.lastEndureMove = null; myPokemon.endureStack = 0
        await log(logsRef, `그러나 버티기에 실패했다!`)
      }
      await safeUpdate(roomRef, { [`${mySlot}_entry`]: myEntry, [`${enemySlot}_entry`]: enemyEntry, current_turn: enemySlot, turn_count: nextTurnCount })
      return res.status(200).json({ ok: true })
    }

    if (moveInfo?.multiHit) {
      const { min, max, fixedDamage } = moveInfo.multiHit
      const patchedMI = patchMoveForWeather(currentWeather, moveData.name, moveInfo)
      const { hit, hitType } = calcHit(myPokemon, patchedMI, enePokemon)
      if (!hit) {
        myPokemon.lastMoveMissed = true
        if (hitType === "evaded") { await log(logsRef, `${enePokemon.name}에게는 맞지 않았다!`, "evade") }
        else { await log(logsRef, `그러나 ${myPokemon.name}의 공격은 빗나갔다!`) }
      } else {
        myPokemon.lastMoveMissed = false
        const hits = Math.floor(Math.random() * (max - min + 1)) + min
        let totalDmg = 0, anyNoEffect = false, lastMultiplier = 1
        for (let h = 0; h < hits; h++) {
          let dmg, critical = false, multiplier = 1
          if (fixedDamage !== undefined) {
            const defTypes = Array.isArray(enePokemon.type) ? enePokemon.type : [enePokemon.type]
            for (const dt of defTypes) multiplier *= getTypeMultiplier(moves[moveData.name]?.type, dt)
            dmg = multiplier === 0 ? 0 : Math.floor(fixedDamage * multiplier)
          } else {
            const result = calcDamage(myPokemon, moveData.name, enePokemon, atkRank, defRankEne, null, null, currentWeather)
            dmg = result.damage; critical = result.critical; multiplier = result.multiplier
          }
          lastMultiplier = multiplier
          if (multiplier === 0) { await log(logsRef, `${enePokemon.name}에게는 효과가 없다…`); anyNoEffect = true; break }
          enePokemon.hp = Math.max(0, enePokemon.hp - dmg)
          totalDmg += dmg
          await hitLog(enemySlot, enePokemon)
          if (enePokemon.flyState?.flying && moves[moveData.name]?.type === "번개") { enePokemon.flyState = null; enePokemon.flyMoveName = null; await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 번개에 맞아 땅으로 떨어졌다!`) }
          if (enePokemon.digState?.digging && moves[moveData.name]?.type === "지진") { enePokemon.digState = null; enePokemon.digMoveName = null; await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 지진에 맞아 땅 위로 튀어나왔다!`) }
          if (critical) await log(logsRef, "급소에 맞았다!", "critical")
          if (enePokemon.hp <= 0) break
        }
        if (!anyNoEffect) {
          if (lastMultiplier > 1) await log(logsRef, "효과가 굉장했다!")
          if (lastMultiplier < 1) await log(logsRef, "효과가 별로인 듯하다…")
          await log(logsRef, `${hits}번 공격했다! (총 ${totalDmg} 데미지)`)
        }
        if (enePokemon.hp <= 0) await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 쓰러졌다!`, "faint")
        if (!moveInfo?.lastResort) myPokemon.usedMoves = [...new Set([...(myPokemon.usedMoves ?? []), moveData.name])]
      }
      await finishTurn(revengeUpdate)
      return res.status(200).json({ ok: true })
    }

    if (moveInfo?.dragonTail) {
      const { hit, hitType } = calcHit(myPokemon, moveInfo, enePokemon)
      if (!hit) {
        myPokemon.lastMoveMissed = true
        if (hitType === "evaded") { await log(logsRef, `${enePokemon.name}에게는 맞지 않았다!`, "evade") }
        else { await log(logsRef, `그러나 ${myPokemon.name}의 공격은 빗나갔다!`) }
      } else {
        myPokemon.lastMoveMissed = false
        const { damage, multiplier, critical, minRoll, minDice } = calcDamage(myPokemon, moveData.name, enePokemon, atkRank, defRankEne, null, null, currentWeather)
        if (multiplier === 0) {
          await log(logsRef, `${enePokemon.name}에게는 효과가 없다…`)
        } else {
          enePokemon.hp = Math.max(0, enePokemon.hp - damage)
          await hitLog(enemySlot, enePokemon)
          if (multiplier > 1) await log(logsRef, "효과가 굉장했다!")
          if (multiplier < 1) await log(logsRef, "효과가 별로인 듯하다…")
          if (minRoll) await log(logsRef, `${minDice}! (최소 피해 보장)`)
          else if (critical) await log(logsRef, "급소에 맞았다!", "critical")
          if (!moveInfo?.lastResort) myPokemon.usedMoves = [...new Set([...(myPokemon.usedMoves ?? []), moveData.name])]
          if (enePokemon.hp <= 0) {
            await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 쓰러졌다!`, "faint")
          } else {
            const candidates = enemyEntry.map((p, i) => ({ p, i })).filter(({ p, i }) => i !== eneActiveIdx && p.hp > 0)
            if (candidates.length > 0) {
              const chosen = candidates[Math.floor(Math.random() * candidates.length)]
              await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 튕겨나갔다!`)
              await log(logsRef, `${chosen.p.name}${josa(chosen.p.name, "이가")} 나왔다!`)
              const expMsgs = tickMyRanks(myPokemon); clearRankStack(myPokemon)
              for (const msg of expMsgs) await log(logsRef, msg)
              await safeUpdate(roomRef, { [`${mySlot}_entry`]: myEntry, [`${enemySlot}_entry`]: enemyEntry, [`${enemySlot}_active_idx`]: chosen.i, current_turn: enemySlot, turn_count: nextTurnCount, ...revengeUpdate })
              return res.status(200).json({ ok: true })
            }
          }
        }
      }
      await finishTurn(revengeUpdate)
      return res.status(200).json({ ok: true })
    }

    // 일반 공격 처리
    {
// 거대해머 쿨다운 체크
      if (moveInfo?.heavyHammer && myPokemon.heavyHammerCooldown) {
        myPokemon.heavyHammerCooldown = false
        await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} 거대해머를 아직 휘두를 수 없다!`)
        await finishTurn({})
        return res.status(200).json({ ok: true })
      }
      const patchedMoveInfo = patchMoveForWeather(currentWeather, moveData.name, moveInfo)
      const { hit, hitType } = calcHit(myPokemon, patchedMoveInfo, enePokemon)
      if (!hit) {
        // ★ 빗나감 추적
        myPokemon.lastMoveMissed = true
        if (hitType === "evaded") { await log(logsRef, `${enePokemon.name}에게는 맞지 않았다!`, "evade") }
        else { await log(logsRef, `그러나 ${myPokemon.name}의 공격은 빗나갔다!`) }
        if (moveInfo?.jumpKick) {
          const selfDmg = Math.max(1, Math.floor((myPokemon.maxHp ?? myPokemon.hp) * 0.25))
          myPokemon.hp = Math.max(0, myPokemon.hp - selfDmg)
          await hitSelfLog()
          await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} 반동으로 ${selfDmg} 데미지를 입었다!`)
        }
      } else {
        // ★ 명중 시 빗나감 초기화
        myPokemon.lastMoveMissed = false
        const atkStatOverride = moveInfo?.trickster ? (enePokemon.attack ?? 3) : null
        const revengeReady = freshData[`revenge_ready_${mySlot}`] ?? false
        const powerOverride_revenge = (moveInfo?.revenge && revengeReady) ? 80 : null
        const comebackReady = freshData[`comeback_ready_${mySlot}`] ?? false
        const comebackMult = (moveInfo?.comeback && comebackReady) ? 1.2 : 1.0
        const sickMult = (moveInfo?.sickPower && enePokemon.status) ? 1.2 : 1.0
        const venomShockMult = (moveInfo?.venomShock && enePokemon.status === "독") ? 1.2 : 1.0
        const gutsMult = (moveInfo?.guts && myPokemon.status) ? 1.2 : 1.0
        const finisherMult = (moveInfo?.finisher && enePokemon.hp <= (enePokemon.maxHp ?? enePokemon.hp) * 0.5) ? 1.2 : 1.0

        let revivedMult = 1.0
        if (moveInfo?.reversal) {
          const hpRatio = myPokemon.hp / (myPokemon.maxHp ?? myPokemon.hp)
          if (hpRatio <= 0.25) revivedMult = 2.0
          else if (hpRatio <= 0.5) revivedMult = 1.5
        }

        let counterDamage = null
        if (moveInfo?.counter) {
          const lastDmg = freshData[`last_damage_taken_${mySlot}`] ?? 0
          counterDamage = Math.max(1, Math.floor(lastDmg * 1.2))
        }

        let powerOverride = powerOverride_revenge
        if (moveInfo?.gyroBall) powerOverride = calcGyroBallPower(myPokemon, enePokemon)
        if (moveInfo?.assistPower) powerOverride = calcAssistPower(myPokemon)

        // ★ 소금물: HP 절반 이하면 위력 80
        if (moveInfo?.saltWater) {
          const hpRatio = enePokemon.hp / (enePokemon.maxHp ?? enePokemon.hp)
          powerOverride = hpRatio <= 0.5 ? 80 : 65
        }

        // ★ 분함의발구르기: 직전 턴 빗나갔으면 위력 60
        if (moveInfo?.stomping && (myPokemon.lastMoveMissed ?? false)) {
          powerOverride = 60
        }

        // ★ 분풀이: 이번 턴 랭크 하락 있었으면 위력 60
        if (moveInfo?.vengeance && (myPokemon.rankDroppedThisTurn ?? false)) {
          powerOverride = 60
        }

        if (moveInfo?.waterspout) {
          const hpRatio = myPokemon.hp / (myPokemon.maxHp ?? myPokemon.hp)
          if (hpRatio <= 0.2) powerOverride = 30
          else if (hpRatio <= 0.5) powerOverride = 40
          else if (hpRatio <= 0.7) powerOverride = 50
          else if (hpRatio <= 0.9) powerOverride = 60
          else powerOverride = 70
        }

        if (moveInfo?.bodyPress) {
          const defRankEneForBP = getActiveRank(enePokemon, "def")
          const { damage, multiplier, critical } = calcBodyPressDamage(myPokemon, enePokemon, defRankEneForBP, currentWeather)
          if (multiplier === 0) {
            await log(logsRef, `${enePokemon.name}에게는 효과가 없다…`)
          } else {
            enePokemon.hp = Math.max(0, enePokemon.hp - damage)
            if (enePokemon.hp <= 0 && enePokemon.enduring) { enePokemon.hp = 1; enePokemon.enduring = false }
            await hitLog(enemySlot, enePokemon)
            if (enePokemon.flyState?.flying && moves[moveData.name]?.type === "번개") { enePokemon.flyState = null; enePokemon.flyMoveName = null; await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 번개에 맞아 땅으로 떨어졌다!`) }
            if (enePokemon.digState?.digging && moves[moveData.name]?.type === "지진") { enePokemon.digState = null; enePokemon.digMoveName = null; await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 지진에 맞아 땅 위로 튀어나왔다!`) }
            recordDmg(revengeUpdate, enemySlot, damage)
            if (multiplier > 1) await log(logsRef, "효과가 굉장했다!")
            if (multiplier < 1) await log(logsRef, "효과가 별로인 듯하다…")
            if (critical) await log(logsRef, "급소에 맞았다!", "critical")
            if (enePokemon.hp <= 0) await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 쓰러졌다!`, "faint")
          }
          await finishTurn(revengeUpdate)
          return res.status(200).json({ ok: true })
        }

        if (moveInfo?.fixedDamage) {
          const defTypes = Array.isArray(enePokemon.type) ? enePokemon.type : [enePokemon.type]
          let mult = 1
          for (const dt of defTypes) mult *= getTypeMultiplier(moves[moveData.name]?.type, dt)
          if (mult === 0) {
            await log(logsRef, `${enePokemon.name}에게는 효과가 없다…`)
          } else {
            const dmg = moveInfo.fixedDamage
            enePokemon.hp = Math.max(0, enePokemon.hp - dmg)
            if (enePokemon.hp <= 0 && enePokemon.enduring) { enePokemon.hp = 1; enePokemon.enduring = false }
            await hitLog(enemySlot, enePokemon)
            await log(logsRef, `${dmg} 데미지!`)
            if (enePokemon.hp <= 0) await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 쓰러졌다!`, "faint")
            if (!moveInfo?.lastResort) myPokemon.usedMoves = [...new Set([...(myPokemon.usedMoves ?? []), moveData.name])]
          }
          await finishTurn(revengeUpdate)
          return res.status(200).json({ ok: true })
        }

        const { damage: rawDmg, multiplier, critical: calcCritical, minRoll, minDice } = calcDamage(myPokemon, moveData.name, enePokemon, atkRank, defRankEne, powerOverride, atkStatOverride, currentWeather)
        const critical = moveInfo?.alwaysCrit ? true : calcCritical
        const alwaysCritMult = (moveInfo?.alwaysCrit && !calcCritical) ? 1.5 : 1.0
        const tricksterMult = moveInfo?.trickster ? 0.7 : 1.0
        const damage = counterDamage ?? Math.floor(rawDmg * comebackMult * sickMult * gutsMult * revivedMult * tricksterMult * finisherMult * venomShockMult * chargedMult * alwaysCritMult)

        if (multiplier === 0) {
          await log(logsRef, `${enePokemon.name}에게는 효과가 없다…`)
        } else {
          enePokemon.hp = Math.max(0, enePokemon.hp - damage)
          if (enePokemon.hp <= 0 && enePokemon.enduring) { enePokemon.hp = 1; enePokemon.enduring = false }
          await hitLog(enemySlot, enePokemon)
          if (enePokemon.flyState?.flying && moves[moveData.name]?.type === "번개") { enePokemon.flyState = null; enePokemon.flyMoveName = null; await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 번개에 맞아 땅으로 떨어졌다!`) }
          if (enePokemon.digState?.digging && moves[moveData.name]?.type === "지진") { enePokemon.digState = null; enePokemon.digMoveName = null; await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 지진에 맞아 땅 위로 튀어나왔다!`) }
          recordDmg(revengeUpdate, enemySlot, damage)
          if (enePokemon.bideState) { enePokemon.bideState.damage = (enePokemon.bideState.damage ?? 0) + damage }
          if (multiplier > 1) await log(logsRef, "효과가 굉장했다!")
          if (multiplier < 1) await log(logsRef, "효과가 별로인 듯하다…")
          if (minRoll) await log(logsRef, `${minDice}! (최소 피해 보장)`)
          else if (critical) await log(logsRef, "급소에 맞았다!", "critical")
          if (moveInfo?.breakBarrier && (enePokemon.lightScreenTurns ?? 0) > 0) {
            enePokemon.lightScreenTurns = 0
            await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "의")} 빛의 장막이 깨졌다!`)
          }
          if (moveInfo?.rapidSpin && myPokemon.seeded) { myPokemon.seeded = false; await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} 씨뿌리기가 풀렸다!`) }
          // ★ 고속스핀으로 wrap 해제
          if (moveInfo?.rapidSpin && myPokemon.tickDmgState) {
            myPokemon.tickDmgState = null
            await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} 감긴 것이 풀렸다!`)
          }
          if (moveInfo?.rapidSpin) {
            const { msgs: spinMsgs, fieldUpdate: spinFieldUpdate } = applyRapidSpin(mySlot, freshData)
            for (const msg of spinMsgs) await log(logsRef, msg)
            if (Object.keys(spinFieldUpdate).length > 0) Object.assign(revengeUpdate, spinFieldUpdate)
          }
          if (moveInfo?.clearSmog) {
            enePokemon.ranks = defaultRanks()
            await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "의")} 능력 변화가 원래대로 돌아왔다!`)
          }
          const effectMsgs = applyMoveEffect(moveInfo?.effect ?? null, myPokemon, enePokemon, damage, currentWeather)
          for (const msg of effectMsgs) await log(logsRef, msg)

            if (moveInfo?.effect?.healBlock && enePokemon.hp > 0) {
  if ((enePokemon.healBlocked ?? 0) > 0) {
    await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 이미 회복봉인 상태다!`)
  } else {
    enePokemon.healBlocked = 3
    await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "의")} HP 회복이 봉인됐다!`)
  }
}

            if (moveInfo?.effect?.cureburn && enePokemon.hp > 0 && enePokemon.status === "화상") {
  enePokemon.status = null
  await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "의")} 화상이 나았다!`)
}

          // ★ 트라이어택 상태이상
          if (moveInfo?.effect?.triAttack && enePokemon.hp > 0 && !enePokemon.status) {
            if (Math.random() < 0.2) {
              const triStatuses = ["마비", "화상", "얼음"]
              const picked = triStatuses[Math.floor(Math.random() * 3)]
              const statusMsgs = applyStatus(enePokemon, picked, currentWeather)
              for (const msg of statusMsgs) await log(logsRef, msg)
            }
          }

          if (moveInfo?.throatChop && enePokemon.hp > 0) {
            enePokemon.throatChopped = 2
            await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 목을 눌려 소리를 낼 수 없게 됐다!`)
          }
          if (moveInfo?.enchantedVoice && enePokemon.hp > 0) {
            const eneRanks = enePokemon.ranks ?? {}
            const hasBuff =
              ((eneRanks.atkTurns ?? 0) > 0 && (eneRanks.atk ?? 0) > 0) ||
              ((eneRanks.defTurns ?? 0) > 0 && (eneRanks.def ?? 0) > 0) ||
              ((eneRanks.spdTurns ?? 0) > 0 && (eneRanks.spd ?? 0) > 0)
            if (hasBuff && (enePokemon.confusion ?? 0) <= 0) {
              enePokemon.confusion = Math.floor(Math.random() * 3) + 1
              await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 혼란에 빠졌다!`)
            }
          }
          if (moveInfo?.effect?.drain && damage > 0 && myPokemon.hp > (freshData[`${mySlot}_entry`][myActiveIdx].hp)) {
            await log(logsRef, "", "heal_self", { slot: mySlot, hp: myPokemon.hp, maxHp: myPokemon.maxHp ?? myPokemon.hp })
          }
          if (moveInfo?.rank) {
            const rankMsgs = applyRankChanges(moveInfo.rank, myPokemon, enePokemon, null)
            for (const msg of rankMsgs) await log(logsRef, msg)
          }
          if (moveInfo?.hyperBeam) { myPokemon.hyperBeamState = true }
          if (moveInfo?.heavyHammer) { myPokemon.heavyHammerCooldown = true }
          if (moveInfo?.effect?.recoil && damage > 0) {
            const recoilDmg = Math.max(1, Math.floor(damage * moveInfo.effect.recoil))
            myPokemon.hp = Math.max(0, myPokemon.hp - recoilDmg)
            await hitSelfLog()
            await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} 반동으로 ${recoilDmg} 데미지를 입었다!`)
          }
          if (!moveInfo?.lastResort) myPokemon.usedMoves = [...new Set([...(myPokemon.usedMoves ?? []), moveData.name])]

          // ★ wrap 적용 (명중 후, 상대 살아있을 때만)
          if (moveInfo?.wrap && enePokemon.hp > 0 && !enePokemon.wrapState) {
            const wrapTurns = Math.floor(Math.random() * 2) + 4
            enePokemon.wrapState = { turnsLeft: wrapTurns, moveName: moveData.name, attackerSlot: mySlot }
            await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 꼼짝 못하게 됐다!`)
          }

          // ★ 김밥말이: 교체봉인 없는 틱뎀만
if (moveInfo?.tickDmg && enePokemon.hp > 0 && !enePokemon.tickDmgState) {
  const tickTurns = Math.floor(Math.random() * 2) + 4
  enePokemon.tickDmgState = { turnsLeft: tickTurns, moveName: moveData.name }
  await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 칭칭 감겼다!`)
}

          if (enePokemon.hp <= 0) await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 쓰러졌다!`, "faint")

            // 마지막일침: 상대 기절 시 공격 3랭크 상승
          if (moveInfo?.lastSting && enePokemon.hp <= 0) {
            const rankMsgs = applyRankChanges({ atk: 3, turns: 2 }, myPokemon, enePokemon, null)
            for (const msg of rankMsgs) await log(logsRef, msg)
          }
        }
      }
    }

    const myHpBefore = freshData[`${mySlot}_entry`][myActiveIdx].hp
    if (myPokemon.hp < myHpBefore) revengeUpdate[`comeback_ready_${enemySlot}`] = true
    else revengeUpdate[`comeback_ready_${enemySlot}`] = false
    revengeUpdate[`comeback_ready_${mySlot}`] = false

    if (moveInfo?.uTurn && enePokemon.hp > 0) {
      const didHit = `last_damage_taken_${enemySlot}` in revengeUpdate
      const canSwitch = myEntry.filter((p, i) => i !== myActiveIdx && p.hp > 0).length > 0
      if (canSwitch && didHit) {
        sanitizeEntries()
        await safeUpdate(roomRef, {
          [`${mySlot}_entry`]: myEntry,
          [`${enemySlot}_entry`]: enemyEntry,
          current_turn: mySlot,
          turn_count: nextTurnCount,
          [`force_switch_${mySlot}`]: true,
          ...revengeUpdate
        })
        return res.status(200).json({ ok: true })
      }
    }

    await finishTurn(revengeUpdate)
    return res.status(200).json({ ok: true })

  } catch (e) {
    console.error(e)
    return res.status(500).json({ error: e.message })
  }
}