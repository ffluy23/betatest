import { db } from "./_firebase.js"
import { moves } from "./moves.js"
import { applyRapidSpin } from "./field.js"
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
function defaultRanks(pokemon) {
  if (!pokemon) return { atk: 0, atkTurns: 0, def: 0, defTurns: 0, spd: 0, spdTurns: 0 }
  return {
    atk: pokemon.attack ?? 3, atkTurns: 0,
    def: pokemon.defense ?? 3, defTurns: 0,
    spd: pokemon.speed ?? 3, spdTurns: 0
  }
}

function getActiveRank(pokemon, key) {
  const r = pokemon.ranks ?? {}
  const statKey = key === "atk" ? "attack" : key === "def" ? "defense" : "speed"
  const base = pokemon[statKey] ?? 3
  if ((r[`${key}Turns`] ?? 0) > 0) {
    return (r[key] ?? base) - base
  }
  return 0
}

function resetRankStack(pokemon) {
  pokemon.lastRankMove = null; pokemon.rankStack = 0
  if (pokemon.ranks) {
    pokemon.ranks.atk = pokemon.attack ?? 3; pokemon.ranks.atkTurns = 0
    pokemon.ranks.def = pokemon.defense ?? 3; pokemon.ranks.defTurns = 0
    pokemon.ranks.spd = pokemon.speed ?? 3;   pokemon.ranks.spdTurns = 0
  }
}

function clearRankStack(pokemon) {
  pokemon.lastRankMove = null; pokemon.rankStack = 0
}

function tickMyRanks(pokemon) {
  if (!pokemon.ranks) return []
  const r = pokemon.ranks, msgs = []
  if (r.atkTurns > 0) { r.atkTurns--; if (!r.atkTurns) { r.atk = pokemon.attack ?? 3; msgs.push(`${pokemon.name}의 공격이 원래대로 돌아왔다!`) } }
  if (r.defTurns > 0) { r.defTurns--; if (!r.defTurns) { r.def = pokemon.defense ?? 3; msgs.push(`${pokemon.name}의 방어가 원래대로 돌아왔다!`) } }
  if (r.spdTurns > 0) { r.spdTurns--; if (!r.spdTurns) { r.spd = pokemon.speed ?? 3;   msgs.push(`${pokemon.name}의 스피드가 원래대로 돌아왔다!`) } }
  return msgs
}

function applyRankChanges(r, self, target, moveName) {
  if (!r) return []
  const msgs = []
  const roll = r.chance !== undefined ? Math.random() < r.chance : true
  if (!roll) return []

  const getStat = (p, key) => p[key === "atk" ? "attack" : key === "def" ? "defense" : "speed"] ?? 3
  const getR = (p, key) => {
    const rr = p.ranks ?? {}
    return (rr[`${key}Turns`] ?? 0) > 0 ? (rr[key] ?? getStat(p, key)) : getStat(p, key)
  }

  const selfR   = { atk: getR(self, "atk"),   atkTurns: (self.ranks ?? {}).atkTurns ?? 0,
                    def: getR(self, "def"),   defTurns: (self.ranks ?? {}).defTurns ?? 0,
                    spd: getR(self, "spd"),   spdTurns: (self.ranks ?? {}).spdTurns ?? 0 }
  const targetR = { atk: getR(target, "atk"), atkTurns: (target.ranks ?? {}).atkTurns ?? 0,
                    def: getR(target, "def"), defTurns: (target.ranks ?? {}).defTurns ?? 0,
                    spd: getR(target, "spd"), spdTurns: (target.ranks ?? {}).spdTurns ?? 0 }

  const isSameMove = moveName && self.lastRankMove === moveName
  const stack = self.rankStack ?? 0
  if (moveName) {
    if (!isSameMove) { self.lastRankMove = moveName; self.rankStack = 1 }
    else if (stack >= 2) {
      selfR.atk = getStat(self, "atk"); selfR.atkTurns = 0
      selfR.def = getStat(self, "def"); selfR.defTurns = 0
      selfR.spd = getStat(self, "spd"); selfR.spdTurns = 0
      self.rankStack = 1
    }
    else { self.rankStack = stack + 1 }
  }

  const MIN_ATK = 1, MIN_DEF = 1, MIN_SPD = 1
  const MAX_ATK_BONUS = 4, MAX_DEF_BONUS = 3, MAX_SPD_BONUS = 5

  if (r.atk !== undefined) {
    const base = getStat(self, "atk")
    if (r.atk > 0) { const p = selfR.atk; selfR.atk = Math.min(base + MAX_ATK_BONUS, selfR.atk + r.atk); selfR.atkTurns = r.turns ?? 2; msgs.push(`${self.name}의 공격이 ${selfR.atk - p} 상승했다!`) }
    else if (r.atk < 0) { if (selfR.atk <= MIN_ATK) msgs.push(`${self.name}의 공격은 더 이상 내려가지 않는다!`); else { const p = selfR.atk; selfR.atk = Math.max(MIN_ATK, selfR.atk + r.atk); selfR.atkTurns = r.turns ?? 2; msgs.push(`${self.name}의 공격이 ${p - selfR.atk} 하락했다!`) } }
  }
  if (r.def !== undefined) {
    const base = getStat(self, "def")
    if (r.def > 0) { const p = selfR.def; selfR.def = Math.min(base + MAX_DEF_BONUS, selfR.def + r.def); selfR.defTurns = r.turns ?? 2; msgs.push(`${self.name}의 방어가 ${selfR.def - p} 상승했다!`) }
    else if (r.def < 0) { if (selfR.def <= MIN_DEF) msgs.push(`${self.name}의 방어는 더 이상 내려가지 않는다!`); else { const p = selfR.def; selfR.def = Math.max(MIN_DEF, selfR.def + r.def); selfR.defTurns = r.turns ?? 2; msgs.push(`${self.name}의 방어가 ${p - selfR.def} 하락했다!`) } }
  }
  if (r.spd !== undefined) {
    const base = getStat(self, "spd")
    if (r.spd > 0) { const p = selfR.spd; selfR.spd = Math.min(base + MAX_SPD_BONUS, selfR.spd + r.spd); selfR.spdTurns = r.turns ?? 2; msgs.push(`${self.name}의 스피드가 ${selfR.spd - p} 상승했다!`) }
    else if (r.spd < 0) { if (selfR.spd <= MIN_SPD) msgs.push(`${self.name}의 스피드는 더 이상 내려가지 않는다!`); else { const p = selfR.spd; selfR.spd = Math.max(MIN_SPD, selfR.spd + r.spd); selfR.spdTurns = r.turns ?? 2; msgs.push(`${self.name}의 스피드가 ${p - selfR.spd} 하락했다!`) } }
  }
  if (r.targetAtk !== undefined) {
    const base = getStat(target, "atk")
    if (r.targetAtk < 0) { if (targetR.atk <= MIN_ATK) msgs.push(`${target.name}의 공격은 더 이상 내려가지 않는다!`); else { const p = targetR.atk; targetR.atk = Math.max(MIN_ATK, targetR.atk + r.targetAtk); targetR.atkTurns = r.turns ?? 2; msgs.push(`${target.name}의 공격이 ${p - targetR.atk} 하락했다!`) } }
    else if (r.targetAtk > 0) { const p = targetR.atk; targetR.atk = Math.min(base + MAX_ATK_BONUS, targetR.atk + r.targetAtk); targetR.atkTurns = r.turns ?? 2; msgs.push(`${target.name}의 공격이 ${targetR.atk - p} 상승했다!`) }
  }
  if (r.targetDef !== undefined) {
    const base = getStat(target, "def")
    if (r.targetDef < 0) { if (targetR.def <= MIN_DEF) msgs.push(`${target.name}의 방어는 더 이상 내려가지 않는다!`); else { const p = targetR.def; targetR.def = Math.max(MIN_DEF, targetR.def + r.targetDef); targetR.defTurns = r.turns ?? 2; msgs.push(`${target.name}의 방어가 ${p - targetR.def} 하락했다!`) } }
    else if (r.targetDef > 0) { const p = targetR.def; targetR.def = Math.min(base + MAX_DEF_BONUS, targetR.def + r.targetDef); targetR.defTurns = r.turns ?? 2; msgs.push(`${target.name}의 방어가 ${targetR.def - p} 상승했다!`) }
  }
  if (r.targetSpd !== undefined) {
    const base = getStat(target, "spd")
    if (r.targetSpd < 0) { if (targetR.spd <= MIN_SPD) msgs.push(`${target.name}의 스피드는 더 이상 내려가지 않는다!`); else { const p = targetR.spd; targetR.spd = Math.max(MIN_SPD, targetR.spd + r.targetSpd); targetR.spdTurns = r.turns ?? 2; msgs.push(`${target.name}의 스피드가 ${p - targetR.spd} 하락했다!`) } }
    else if (r.targetSpd > 0) { const p = targetR.spd; targetR.spd = Math.min(base + MAX_SPD_BONUS, targetR.spd + r.targetSpd); targetR.spdTurns = r.turns ?? 2; msgs.push(`${target.name}의 스피드가 ${targetR.spd - p} 상승했다!`) }
  }
  self.ranks = selfR; target.ranks = targetR
  return msgs
}

function calcHit(attacker, moveInfo, defender) {
  if (Math.random() * 100 >= (moveInfo.accuracy ?? 100)) return { hit: false, hitType: "missed" }
  if (defender.flyState?.flying && moveInfo.type !== "전기" && !moveInfo.twister) return { hit: false, hitType: "evaded" }
  if (defender.digState?.digging && moveInfo.type !== "땅") return { hit: false, hitType: "evaded" }
  if (moveInfo.alwaysHit || moveInfo.skipEvasion) return { hit: true, hitType: "hit" }
  const as = Math.max(1, (attacker.speed ?? 3) - getStatusSpdPenalty(attacker))
  const ds = Math.max(1, (defender.speed ?? 3) - getStatusSpdPenalty(defender))
  const defSpdBase = defender.speed ?? 3
  const defSpdRank = (defender.ranks ?? {})
  const defSpdBonus = (defSpdRank.spdTurns ?? 0) > 0
    ? Math.min(5, Math.max(-5, (defSpdRank.spd ?? defSpdBase) - defSpdBase))
    : 0
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

function calcAssistPower(pokemon) {
  const r = pokemon.ranks ?? {}
  const getStat = (key) => pokemon[key === "atk" ? "attack" : key === "def" ? "defense" : "speed"] ?? 3
  const base = { atk: getStat("atk"), def: getStat("def"), spd: getStat("spd") }
  const atkBonus = (r.atkTurns ?? 0) > 0 ? Math.max(0, (r.atk ?? base.atk) - base.atk) : 0
  const defBonus = (r.defTurns ?? 0) > 0 ? Math.max(0, (r.def ?? base.def) - base.def) : 0
  const spdBonus = (r.spdTurns ?? 0) > 0 ? Math.max(0, (r.spd ?? base.spd) - base.spd) : 0
  const total = atkBonus + defBonus + spdBonus
  if (total <= 1) return 30
  if (total <= 3) return 40
  return 50
}

// ★ weather 인수 추가 — 쾌청/비 배율 적용
function calcDamage(attacker, moveName, defender, atkRankBonus = 0, defRankBonus = 0, powerOverride = null, atkStatOverride = null, weather = null) {
  const move = moves[moveName]
  if (!move) return { damage: 0, multiplier: 1, stab: false, dice: 0, critical: false }
  const dice = rollD10()
  const defTypes = Array.isArray(defender.type) ? defender.type : [defender.type]
  let multiplier = 1
for (const dt of defTypes) multiplier *= getTypeMultiplier(move.type, dt)
if (multiplier === 0) return { damage: 0, multiplier: 0, stab: false, dice, critical: false }
multiplier = Math.round(multiplier * 10) / 10  //
  const atkTypes = Array.isArray(attacker.type) ? attacker.type : [attacker.type]
  const stab = atkTypes.includes(move.type)
  const power = powerOverride ?? (move.power ?? 40)
  const atkStat = atkStatOverride ?? (attacker.attack ?? 3)
  const base = power + atkStat * 4 + dice
  const raw = Math.floor(base * multiplier * (stab ? 1.3 : 1))
  const afterAtk = Math.max(0, raw + atkRankBonus)
  const afterDef = Math.max(0, afterAtk - (defender.defense ?? 3) * 5)
  const baseDmg = Math.max(0, afterDef - defRankBonus * 3)
  const lightScreenActive = (defender.lightScreenTurns ?? 0) > 0
  const breakBarrier = move.breakBarrier ?? false
  const screenMult = (lightScreenActive && !breakBarrier) ? 0.75 : 1.0
  const flyLightningMult = (defender.flyState?.flying && move.type === "전기") ? 1.2 : 1.0
  const twisterFlyMult = (move.twister && defender.flyState?.flying) ? 1.2 : 1.0
  const digEarthquakeMult = (defender.digState?.digging && move.type === "땅") ? 1.2 : 1.0
  // ★ 날씨 배율
  const weatherMult = getWeatherDamageMult(weather, move.type)
  const critRate = Math.min(100, atkStat * 2 + (move.highCrit ? 3 : 0))
  const critical = Math.random() * 100 < critRate
  const finalDmg = Math.floor(baseDmg * screenMult * flyLightningMult * twisterFlyMult * digEarthquakeMult * weatherMult)
  return { damage: critical ? Math.floor(finalDmg * 1.5) : finalDmg, multiplier, stab, dice, critical }
}

function calcRolloutDamage(moveName, defender, power) {
  const move = moves[moveName]
  if (!move) return 0
  const defTypes = Array.isArray(defender.type) ? defender.type : [defender.type]
  let multiplier = 1
  for (const dt of defTypes) multiplier *= getTypeMultiplier(move.type, dt)
  return Math.floor(power * multiplier)
}

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

    // ★ 현재 날씨
    const currentWeather = freshData.weather ?? null
    const currentWeatherTurns = freshData.weatherTurns ?? 0

    // ★ 후공 판정 — first_slot 기준으로 고정
    const firstSlot = freshData.first_slot ?? "p1"
    const isSecondToAct = mySlot !== firstSlot

    const myEntry = freshData[`${mySlot}_entry`].map(p => {
      const base = defaultRanks(p)
      const r = p.ranks ?? {}
      return { ...p, moves: (p.moves ?? []).map(m => ({ ...m })), ranks: {
        atk: r.atkTurns > 0 ? r.atk : base.atk, atkTurns: r.atkTurns ?? 0,
        def: r.defTurns > 0 ? r.def : base.def, defTurns: r.defTurns ?? 0,
        spd: r.spdTurns > 0 ? r.spd : base.spd, spdTurns: r.spdTurns ?? 0,
      }}
    })
    const enemyEntry = freshData[`${enemySlot}_entry`].map(p => {
      const base = defaultRanks(p)
      const r = p.ranks ?? {}
      return { ...p, ranks: {
        atk: r.atkTurns > 0 ? r.atk : base.atk, atkTurns: r.atkTurns ?? 0,
        def: r.defTurns > 0 ? r.def : base.def, defTurns: r.defTurns ?? 0,
        spd: r.spdTurns > 0 ? r.spd : base.spd, spdTurns: r.spdTurns ?? 0,
      }}
    })
    const myPokemon = myEntry[myActiveIdx]
    const enePokemon = enemyEntry[eneActiveIdx]

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

    // ── 참기 중 자동 처리
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

    // ── 공중날기 2턴째 자동 처리
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
          const { damage, multiplier, critical } = calcDamage(myPokemon, flyMoveName, enePokemon, atkRankFly, defRankEneFly, null, null, currentWeather)
          if (multiplier === 0) {
            await log(logsRef, `${enePokemon.name}에게는 효과가 없다…`)
          } else {
            enePokemon.hp = Math.max(0, enePokemon.hp - damage)
            if (enePokemon.hp <= 0 && enePokemon.enduring) { enePokemon.hp = 1; enePokemon.enduring = false }
            await log(logsRef, "", "hit", { defender: enemySlot, hp: enePokemon.hp, maxHp: enePokemon.maxHp ?? enePokemon.hp })
            if (multiplier > 1) await log(logsRef, "효과가 굉장했다!")
            if (multiplier < 1) await log(logsRef, "효과가 별로인 듯하다…")
            if (critical) await log(logsRef, "급소에 맞았다!", "critical")
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

    // ── 구멍파기 2턴째 자동 처리
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
          const { damage, multiplier, critical } = calcDamage(myPokemon, digMoveName, enePokemon, atkRankDig, defRankEneDig, null, null, currentWeather)
          if (multiplier === 0) {
            await log(logsRef, `${enePokemon.name}에게는 효과가 없다…`)
          } else {
            enePokemon.hp = Math.max(0, enePokemon.hp - damage)
            if (enePokemon.hp <= 0 && enePokemon.enduring) { enePokemon.hp = 1; enePokemon.enduring = false }
            await log(logsRef, "", "hit", { defender: enemySlot, hp: enePokemon.hp, maxHp: enePokemon.maxHp ?? enePokemon.hp })
            if (multiplier > 1) await log(logsRef, "효과가 굉장했다!")
            if (multiplier < 1) await log(logsRef, "효과가 별로인 듯하다…")
            if (critical) await log(logsRef, "급소에 맞았다!", "critical")
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
    const recordDmg = (slot, dmg) => { revengeUpdate[`last_damage_taken_${slot}`] = dmg }

    // 희망사항 회복
    const hpBefore = myPokemon.hp
    const wishMsgs = tickVolatiles(myPokemon)
    for (const msg of wishMsgs) await log(logsRef, msg)
    if (myPokemon.hp > hpBefore) {
      await log(logsRef, "", "heal_self", { slot: mySlot, hp: myPokemon.hp, maxHp: myPokemon.maxHp ?? myPokemon.hp })
    }

    // 빛의 장막 턴 감소
    if ((myPokemon.lightScreenTurns ?? 0) > 0) {
      myPokemon.lightScreenTurns--
      if (!myPokemon.lightScreenTurns) {
        await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "의")} 빛의 장막이 사라졌다!`)
      }
    }
    if ((enePokemon.lightScreenTurns ?? 0) > 0) {
      enePokemon.lightScreenTurns--
      if (!enePokemon.lightScreenTurns) {
        await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "의")} 빛의 장막이 사라졌다!`)
      }
    }

    // 행동 불능 체크
    const preAction = checkPreActionStatus(myPokemon)
    for (const msg of preAction.msgs) await log(logsRef, msg)
    if (preAction.blocked) {
      resetRankStack(myPokemon)
      myPokemon.rollState = { active: false, turn: 0 }
      myPokemon.flyState = null
      myPokemon.digState = null
      if ((myPokemon.defendTurns ?? 0) > 0) { myPokemon.defendTurns--; if (!myPokemon.defendTurns) myPokemon.defending = false }
      await safeUpdate(roomRef, { [`${mySlot}_entry`]: myEntry, current_turn: enemySlot, turn_count: nextTurnCount })
      return res.status(200).json({ ok: true })
    }

    // 혼란 체크
    const confResult = checkConfusion(myPokemon)
    for (const msg of confResult.msgs) await log(logsRef, msg)
    if (confResult.selfHit) {
      resetRankStack(myPokemon)
      myPokemon.rollState = { active: false, turn: 0 }
      myPokemon.flyState = null
      myPokemon.digState = null
      await hitSelfLog()
      if (isAllFainted(myEntry)) {
        await safeUpdate(roomRef, { [`${mySlot}_entry`]: myEntry, turn_count: nextTurnCount, game_over: true, winner: enemyName, current_turn: null })
        await log(logsRef, `${enemyName}의 승리!`, "win")
      } else {
        await safeUpdate(roomRef, { [`${mySlot}_entry`]: myEntry, current_turn: enemySlot, turn_count: nextTurnCount })
      }
      return res.status(200).json({ ok: true })
    }

    myPokemon.moves[moveIdx] = { ...moveData, pp: moveData.pp - 1 }
    myPokemon.lastUsedMove = moveData.name
    await log(logsRef, `${myPokemon.name}의 ${moveData.name}!`)

    const diceRoll = rollD10()
    await log(logsRef, "", "dice", { slot: mySlot, roll: diceRoll })


    // ══════════════════════════════════════════════════
    //  finishTurn: 모든 행동 종료 후 공통 처리 (EOT 포함)
    // ══════════════════════════════════════════════════
    async function finishTurn(revengeUpdate = {}) {
      const expiredMsgs = tickMyRanks(myPokemon)
      clearRankStack(myPokemon)

      const nextTurn = nextTurnCount

      // ★ EOT는 후공 행동 완료 시에만 1번 발동
      if (isSecondToAct) {
        // ── 사슬묶기 턴 감소
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

        // ── 씨뿌리기 EOT
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

        // ── 독/화상 EOT
        const eotHpBefore = { my: myPokemon.hp, ene: enePokemon.hp }
        const { msgs: eotMsgs, anyFainted } = applyEndOfTurnDamage([[myPokemon], [enePokemon]])
        for (const msg of eotMsgs) await log(logsRef, msg)
        if (myPokemon.hp !== eotHpBefore.my)
          await log(logsRef, "", "hit_self", { slot: mySlot, hp: myPokemon.hp, maxHp: myPokemon.maxHp ?? myPokemon.hp })
        if (enePokemon.hp !== eotHpBefore.ene)
          await log(logsRef, "", "hit", { defender: enemySlot, hp: enePokemon.hp, maxHp: enePokemon.maxHp ?? enePokemon.hp })

        // ── 날씨 EOT
        const weatherForEot = revengeUpdate.weather !== undefined ? revengeUpdate.weather : currentWeather
        if (weatherForEot) {
          // 지속 로그
          const weatherLog = getWeatherLog(weatherForEot)
          if (weatherLog) await log(logsRef, weatherLog)

          // 데미지 (모래바람 / 싸라기눈)
          const { msgs: wMsgs, hitLogs, anyFainted: wFainted } =
            applyWeatherDamage(weatherForEot, myPokemon, mySlot, enePokemon, enemySlot)
          for (let i = 0; i < wMsgs.length; i++) {
            await log(logsRef, wMsgs[i])
            if (hitLogs[i]) {
              const hl = hitLogs[i]
              const isMySlot = hl.slot === mySlot
              await log(logsRef, "", isMySlot ? "hit_self" : "hit",
                isMySlot
                  ? { slot: hl.slot, hp: hl.hp, maxHp: hl.maxHp }
                  : { defender: hl.slot, hp: hl.hp, maxHp: hl.maxHp })
            }
          }

          // 날씨 턴 감소
          const weatherTurnsForTick = revengeUpdate.weatherTurns !== undefined
            ? revengeUpdate.weatherTurns
            : currentWeatherTurns
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

        if (anyFainted) {
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
        // 선공 행동 완료 → EOT 스킵, sanitize만
        sanitizeEntries()
      }

      for (const msg of expiredMsgs) await log(logsRef, msg)

      const myFainted = myPokemon.hp <= 0
      const eneFainted = enePokemon.hp <= 0
      if (myFainted) { myPokemon.bideState = null; myPokemon.rollState = { active: false, turn: 0 }; myPokemon.flyState = null; myPokemon.digState = null }
      if (eneFainted) { enePokemon.bideState = null; enePokemon.rollState = { active: false, turn: 0 }; enePokemon.flyState = null; enePokemon.digState = null }
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
        await safeUpdate(roomRef, { [`${mySlot}_entry`]: myEntry, [`${enemySlot}_entry`]: enemyEntry, current_turn: enemySlot, turn_count: nextTurn, ...revengeUpdate })
      } else {
        await safeUpdate(roomRef, { [`${mySlot}_entry`]: myEntry, [`${enemySlot}_entry`]: enemyEntry, current_turn: enemySlot, turn_count: nextTurn, ...revengeUpdate })
      }
    }

    // ══════════════════════════════════════════════════
    //  특수 기술 처리
    // ══════════════════════════════════════════════════

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

    if (moveInfo?.roar) {
      const candidates = enemyEntry.map((p, i) => ({ p, i })).filter(({ p, i }) => i !== eneActiveIdx && p.hp > 0)
      if (candidates.length === 0) {
        await log(logsRef, `그러나 ${enePokemon.name}에게는 맞지 않았다!`)
      } else {
        const chosen = candidates[Math.floor(Math.random() * candidates.length)]
        await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 물러났다!`)
        await log(logsRef, `${chosen.p.name}${josa(chosen.p.name, "이가")} 나왔다!`)
        chosen.p.seeded = false
        await safeUpdate(roomRef, { [`${mySlot}_entry`]: myEntry, [`${enemySlot}_entry`]: enemyEntry, [`${enemySlot}_active_idx`]: chosen.i, current_turn: enemySlot, turn_count: nextTurnCount })
        return res.status(200).json({ ok: true })
      }
      await finishTurn({})
      return res.status(200).json({ ok: true })
    }

    if (moveInfo?.amulet) {
      myPokemon.amuletTurns = 3
      await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} 신비의 부적으로 몸을 감쌌다!`)
      await finishTurn({})
      return res.status(200).json({ ok: true })
    }

    if (moveInfo?.wish) {
      myPokemon.wishTurns = 2
      await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} 희망사항을 빌었다!`)
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

      // ── 구르기
    if (moveInfo?.rollout) {
      const rollState = myPokemon.rollState ?? { active: false, turn: 0 }
      const rollTurn = rollState.active ? rollState.turn + 1 : 1
      const rollPower = rollTurn === 1 ? 30 : rollTurn === 2 ? 60 : 120
      const { hit, hitType } = calcHit(myPokemon, moveInfo, enePokemon)
      if (!hit) {
        await log(logsRef, hitType === "evaded" ? `${enePokemon.name}에게는 맞지 않았다!` : `그러나 ${myPokemon.name}의 공격은 빗나갔다!`, hitType === "evaded" ? "evade" : "normal")
        myPokemon.rollState = { active: false, turn: 0 }
      } else {
        const wasDefending = enePokemon.defending ?? false
        enePokemon.defending = false; enePokemon.defendTurns = 0
        if (wasDefending) {
          await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 방어했다!`)
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

   // ── 역린 / 꽃잎댄스 / 소란피기
    // ── 역린 / 꽃잎댄스 / 소란피기
    if (moveInfo?.outrage) {
      const atkRankOut = getActiveRank(myPokemon, "atk")   // ← 이름 변경
  const defRankEneOut = getActiveRank(enePokemon, "def") // ← 이름 변경
  const outrageUpdate = {}  // ← revengeUpdate → outrageUpdate
      const wasDefendingOutrage = enePokemon.defending ?? false
      enePokemon.defending = false; enePokemon.defendTurns = 0

      const outrageInfo = moveInfo.outrage
      const state = myPokemon.outrageState
      const isFirst = !state?.active

      const maxTurn = isFirst
        ? Math.floor(Math.random() * (outrageInfo.maxTurn - outrageInfo.minTurn + 1)) + outrageInfo.minTurn
        : state.maxTurn
      const currentTurn = isFirst ? 1 : state.turn
      const power = outrageInfo.powers[Math.min(currentTurn - 1, outrageInfo.powers.length - 1)]
      const isLastTurn = currentTurn >= maxTurn

      await log(logsRef, "", "attack", { attacker: mySlot })
      const { hit, hitType } = calcHit(myPokemon, moveInfo, enePokemon)
      if (!hit) {
        if (hitType === "evaded") await log(logsRef, `${enePokemon.name}에게는 맞지 않았다!`, "evade")
        else await log(logsRef, `그러나 ${myPokemon.name}의 공격은 빗나갔다!`)
      } else if (wasDefendingOutrage) {
        await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 방어했다!`)
      } else {
        const { damage, multiplier, critical } = calcDamage(myPokemon, moveData.name, enePokemon, atkRankOut, defRankEneOut, power, null, currentWeather)
        if (multiplier === 0) {
          await log(logsRef, `${enePokemon.name}에게는 효과가 없다…`)
        } else {
          enePokemon.hp = Math.max(0, enePokemon.hp - damage)
          if (enePokemon.hp <= 0 && enePokemon.enduring) { enePokemon.hp = 1; enePokemon.enduring = false }
          await hitLog(enemySlot, enePokemon)
             outrageUpdate[`last_damage_taken_${enemySlot}`] = damage
          recordDmg(enemySlot, damage)
          if (multiplier > 1) await log(logsRef, "효과가 굉장했다!")
          if (multiplier < 1) await log(logsRef, "효과가 별로인 듯하다…")
          if (critical) await log(logsRef, "급소에 맞았다!", "critical")
          if (enePokemon.hp <= 0) await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 쓰러졌다!`, "faint")
        }
      }

      if (isLastTurn) {
        myPokemon.outrageState = null
        if (outrageInfo.confusion && (myPokemon.confusion ?? 0) <= 0) {
          myPokemon.confusion = Math.floor(Math.random() * 3) + 1
          await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} 난동을 부린 뒤 혼란에 빠졌다!`)
        }
      } else {
        myPokemon.outrageState = { active: true, turn: currentTurn + 1, maxTurn, moveName: moveData.name }
        if (outrageInfo.confusion) {
          await log(logsRef, `${myPokemon.name}의 ${moveData.name}!`)
        } else {
          await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} 소란을 피우고 있다!`)
        }
      }

      await finishTurn(outrageUpdate)
      return res.status(200).json({ ok: true })
    }

    if (moveInfo?.leechSeed) {
      const eneTypes = Array.isArray(enePokemon.type) ? enePokemon.type : [enePokemon.type]
      const wasDefendingForSeed = enePokemon.defending ?? false
      enePokemon.defending = false; enePokemon.defendTurns = 0
      if (wasDefendingForSeed) {
        await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 방어했다!`)
      } else if (eneTypes.includes("풀")) {
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
      const heal = Math.max(1, Math.floor((enePokemon.maxHp ?? enePokemon.hp) * 0.12))
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
        const wasDefendingFO = enePokemon.defending ?? false
        enePokemon.defending = false; enePokemon.defendTurns = 0
        if (wasDefendingFO) {
          await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 방어했다!`)
        } else {
          const { damage, multiplier, critical } = calcDamage(myPokemon, moveData.name, enePokemon, atkRankFO, defRankFO, null, null, currentWeather)
          if (multiplier === 0) {
            await log(logsRef, `${enePokemon.name}에게는 효과가 없다…`)
          } else {
            enePokemon.hp = Math.max(0, enePokemon.hp - damage)
            if (enePokemon.hp <= 0 && enePokemon.enduring) { enePokemon.hp = 1; enePokemon.enduring = false }
            await log(logsRef, "", "hit", { defender: enemySlot, hp: enePokemon.hp, maxHp: enePokemon.maxHp ?? enePokemon.hp })
            if (multiplier > 1) await log(logsRef, "효과가 굉장했다!")
            if (multiplier < 1) await log(logsRef, "효과가 별로인 듯하다…")
            if (critical) await log(logsRef, "급소에 맞았다!", "critical")
            if (enePokemon.hp > 0) {
              enePokemon.flinch = true
              await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 풀이 죽었다!`)
            }
            if (enePokemon.hp <= 0) await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 쓰러졌다!`, "faint")
          }
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
        if (p.ranks) {
          p.ranks.atk = p.attack ?? 3; p.ranks.atkTurns = 0
          p.ranks.def = p.defense ?? 3; p.ranks.defTurns = 0
          p.ranks.spd = p.speed ?? 3;   p.ranks.spdTurns = 0
        }
        p.lastRankMove = null; p.rankStack = 0
        // ★ 모래바람 방어 부스트도 제거
        p.weatherDefBoost = false
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
      const statusMsgs = applyStatus(enePokemon, moveInfo.effect.status, currentWeather)
for (const msg of statusMsgs) await log(logsRef, msg)
    }
  }
  await finishTurn({})
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
      // ★ 날씨 기술 처리 (applyWeatherEffect 대체)
      // ── 필드 기술 (스텔스록 / 독압정)
if (moveInfo?.field) {
  const fieldKey = `${moveInfo.field}_${enemySlot}`  // 상대 진영에 설치
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

  // ── 달빛
      if (moveInfo?.effect?.moonlight) {
        const enemyActive = enemyEntry[eneActiveIdx]
        const isUproar = enemyActive?.outrageState?.active &&
                         moves[enemyActive.outrageState.moveName]?.outrage?.confusion === false
        const healRate = currentWeather === "쾌청" ? 0.25
                       : (currentWeather === "비" || currentWeather === "모래바람" ||
                          currentWeather === "싸라기눈" || isUproar) ? 0.18
                       : 0.22
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
        const healRate = moveInfo.effect.heal ?? 0.5
        const heal = Math.max(1, Math.floor((myPokemon.maxHp ?? myPokemon.hp) * healRate))
        myPokemon.hp = Math.min(myPokemon.maxHp ?? myPokemon.hp, myPokemon.hp + heal)
        await log(logsRef, "", "heal_self", { slot: mySlot, hp: myPokemon.hp, maxHp: myPokemon.maxHp ?? myPokemon.hp })
        await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} HP를 회복했다! (+${heal})`)
        const types = Array.isArray(myPokemon.type) ? [...myPokemon.type] : [myPokemon.type]
        myPokemon._origType = myPokemon.type
        if (types.length === 1) {
          myPokemon.type = ["노말"]
        } else {
          myPokemon.type = types.filter(t => t !== "비행")
          if (myPokemon.type.length === 0) myPokemon.type = ["노말"]
        }
        myPokemon.roostTurns = 1
        await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} 땅에 내려앉아 비행 타입이 사라졌다!`)
        await finishTurn({})
        return res.status(200).json({ ok: true })
      }
      // ★ 성장 기술 — 쾌청 시 공격 랭크 보정
      let rankToApply = r
      if (moveData.name === "성장" && r) {
        rankToApply = { ...r, atk: getSunnyGrowthBonus(currentWeather) }
      }
      const rankMsgs = applyRankChanges(rankToApply, myPokemon, enePokemon, moveData.name)
      for (const msg of rankMsgs) await log(logsRef, msg)
      if (moveInfo?.effect?.heal) {
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
      enePokemon.defending = false; enePokemon.defendTurns = 0
      await finishTurn({})
      return res.status(200).json({ ok: true })
    }

    // ── power > 0 공격 기술
    resetRankStack(myPokemon)
    myPokemon.lastDefendMove = null; myPokemon.defendStack = 0

    const atkRank = getActiveRank(myPokemon, "atk")
    const defRankEne = getActiveRank(enePokemon, "def")
    const wasDefending = enePokemon.defending ?? false
    enePokemon.defending = false; enePokemon.defendTurns = 0

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
        if (hitType === "evaded") { await log(logsRef, `${enePokemon.name}에게는 맞지 않았다!`, "evade") }
        else { await log(logsRef, `그러나 ${myPokemon.name}의 공격은 빗나갔다!`) }
      } else if (wasDefending) {
        await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 방어했다!`)
      } else {
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
      if (wasDefending) {
        await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 방어했다!`)
      } else {
        const { hit, hitType } = calcHit(myPokemon, moveInfo, enePokemon)
        if (!hit) {
          if (hitType === "evaded") { await log(logsRef, `${enePokemon.name}에게는 맞지 않았다!`, "evade") }
          else { await log(logsRef, `그러나 ${myPokemon.name}의 공격은 빗나갔다!`) }
        } else {
          const { damage, multiplier, critical } = calcDamage(myPokemon, moveData.name, enePokemon, atkRank, defRankEne, null, null, currentWeather)
          if (multiplier === 0) {
            await log(logsRef, `${enePokemon.name}에게는 효과가 없다…`)
          } else {
            enePokemon.hp = Math.max(0, enePokemon.hp - damage)
            await hitLog(enemySlot, enePokemon)
            if (multiplier > 1) await log(logsRef, "효과가 굉장했다!")
            if (multiplier < 1) await log(logsRef, "효과가 별로인 듯하다…")
            if (critical) await log(logsRef, "급소에 맞았다!", "critical")
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
      }
      await finishTurn(revengeUpdate)
      return res.status(200).json({ ok: true })
    }

    // ── 일반 공격 기술
    if (wasDefending) {
      await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 방어했다!`)
      if (moveInfo?.jumpKick) {
        const selfDmg = Math.max(1, Math.floor((myPokemon.maxHp ?? myPokemon.hp) * 0.25))
        myPokemon.hp = Math.max(0, myPokemon.hp - selfDmg)
        await hitSelfLog()
        await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} 반동으로 ${selfDmg} 데미지를 입었다!`)
      }
    } else {
      const patchedMoveInfo = patchMoveForWeather(currentWeather, moveData.name, moveInfo)
      const { hit, hitType } = calcHit(myPokemon, patchedMoveInfo, enePokemon)
      if (!hit) {
        if (hitType === "evaded") { await log(logsRef, `${enePokemon.name}에게는 맞지 않았다!`, "evade") }
        else { await log(logsRef, `그러나 ${myPokemon.name}의 공격은 빗나갔다!`) }
        if (moveInfo?.jumpKick) {
          const selfDmg = Math.max(1, Math.floor((myPokemon.maxHp ?? myPokemon.hp) * 0.25))
          myPokemon.hp = Math.max(0, myPokemon.hp - selfDmg)
          await hitSelfLog()
          await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} 반동으로 ${selfDmg} 데미지를 입었다!`)
        }
      } else {
        const atkStatOverride = moveInfo?.trickster ? (enePokemon.attack ?? 3) : null
        const revengeReady = freshData[`revenge_ready_${mySlot}`] ?? false
        const powerOverride_revenge = (moveInfo?.revenge && revengeReady) ? 70 : null
        const comebackReady = freshData[`comeback_ready_${mySlot}`] ?? false
        const comebackMult = (moveInfo?.comeback && comebackReady) ? 1.2 : 1.0
        const sickMult = (moveInfo?.sickPower && enePokemon.status) ? 1.2 : 1.0
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

        const { damage: rawDmg, multiplier, critical } = calcDamage(myPokemon, moveData.name, enePokemon, atkRank, defRankEne, powerOverride, atkStatOverride, currentWeather)
        const tricksterMult = moveInfo?.trickster ? 0.7 : 1.0
        const damage = counterDamage ?? Math.floor(rawDmg * comebackMult * sickMult * gutsMult * revivedMult * tricksterMult * finisherMult)

        if (multiplier === 0) {
          await log(logsRef, `${enePokemon.name}에게는 효과가 없다…`)
        } else {
          enePokemon.hp = Math.max(0, enePokemon.hp - damage)
          if (enePokemon.hp <= 0 && enePokemon.enduring) {
            enePokemon.hp = 1
            enePokemon.enduring = false
          }
          await hitLog(enemySlot, enePokemon)
          recordDmg(enemySlot, damage)
          if (enePokemon.bideState) {
            enePokemon.bideState.damage = (enePokemon.bideState.damage ?? 0) + damage
          }
          if (multiplier > 1) await log(logsRef, "효과가 굉장했다!")
          if (multiplier < 1) await log(logsRef, "효과가 별로인 듯하다…")
          if (critical) await log(logsRef, "급소에 맞았다!", "critical")

          if (moveInfo?.breakBarrier && (enePokemon.lightScreenTurns ?? 0) > 0) {
            enePokemon.lightScreenTurns = 0
            await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "의")} 빛의 장막이 깨졌다!`)
          }
          if (moveInfo?.rapidSpin && myPokemon.seeded) {
            myPokemon.seeded = false
            await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} 씨뿌리기가 풀렸다!`)
          }
          const { msgs: spinMsgs, fieldUpdate: spinFieldUpdate } = applyRapidSpin(mySlot, freshData)
          for (const msg of spinMsgs) await log(logsRef, msg)
          if (Object.keys(spinFieldUpdate).length > 0) Object.assign(revengeUpdate, spinFieldUpdate)

          if (moveInfo?.clearSmog) {
            enePokemon.ranks = defaultRanks()
            await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "의")} 능력 변화가 원래대로 돌아왔다!`)
          }
          const effectMsgs = applyMoveEffect(moveInfo?.effect ?? null, myPokemon, enePokemon, damage, currentWeather)
          for (const msg of effectMsgs) await log(logsRef, msg)
          if (moveInfo?.effect?.drain && damage > 0 && myPokemon.hp > (freshData[`${mySlot}_entry`][myActiveIdx].hp)) {
            await log(logsRef, "", "heal_self", { slot: mySlot, hp: myPokemon.hp, maxHp: myPokemon.maxHp ?? myPokemon.hp })
          }
          if (moveInfo?.rank) {
            const rankMsgs = applyRankChanges(moveInfo.rank, myPokemon, enePokemon, null)
            for (const msg of rankMsgs) await log(logsRef, msg)
          }
          if (moveInfo?.effect?.recoil && damage > 0) {
            const recoilDmg = Math.max(1, Math.floor(damage * moveInfo.effect.recoil))
            myPokemon.hp = Math.max(0, myPokemon.hp - recoilDmg)
            await hitSelfLog()
            await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} 반동으로 ${recoilDmg} 데미지를 입었다!`)
          }
          if (!moveInfo?.lastResort) myPokemon.usedMoves = [...new Set([...(myPokemon.usedMoves ?? []), moveData.name])]
          if (enePokemon.hp <= 0) await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 쓰러졌다!`, "faint")
        }
      }
    }

    const myHpBefore = freshData[`${mySlot}_entry`][myActiveIdx].hp
    if (myPokemon.hp < myHpBefore) revengeUpdate[`comeback_ready_${enemySlot}`] = true
    else revengeUpdate[`comeback_ready_${enemySlot}`] = false
    revengeUpdate[`comeback_ready_${mySlot}`] = false

    // ★ 유턴: 데미지 후 강제 교체
    if (moveInfo?.uTurn && enePokemon.hp > 0) {
      const canSwitch = myEntry.filter((p, i) => i !== myActiveIdx && p.hp > 0).length > 0
      if (canSwitch) {
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

    if (moveInfo?.hyperBeam) {
  myPokemon.hyperBeamState = true
}

   await finishTurn(revengeUpdate)
    return res.status(200).json({ ok: true })

  } catch (e) {
    console.error(e)
    return res.status(500).json({ error: e.message })
  }
}