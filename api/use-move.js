import { db } from "./_firebase.js"
import { moves } from "./moves.js"
import { getTypeMultiplier } from "./typeChart.js"
import {
  josa,
  applyMoveEffect, checkPreActionStatus, checkConfusion,
  applyEndOfTurnDamage, applyWeatherEffect, tickVolatiles,
  getStatusSpdPenalty
} from "./effecthandler.js"

function rollD10() { return Math.floor(Math.random() * 10) + 1 }
function isAllFainted(entry) { return entry.every(p => p.hp <= 0) }
function defaultRanks() { return { atk: 0, atkTurns: 0, def: 0, defTurns: 0, spd: 0, spdTurns: 0 } }

function getActiveRank(pokemon, key) {
  const r = pokemon.ranks ?? {}
  return (r[`${key}Turns`] ?? 0) > 0 ? (r[key] ?? 0) : 0
}

function resetRankStack(pokemon) {
  pokemon.lastRankMove = null
  pokemon.rankStack = 0
  if (pokemon.ranks) {
    pokemon.ranks.atk = 0; pokemon.ranks.atkTurns = 0
    pokemon.ranks.def = 0; pokemon.ranks.defTurns = 0
    pokemon.ranks.spd = 0; pokemon.ranks.spdTurns = 0
  }
}

function clearRankStack(pokemon) {
  pokemon.lastRankMove = null
  pokemon.rankStack = 0
}

function tickMyRanks(pokemon) {
  if (!pokemon.ranks) return []
  const r = pokemon.ranks, msgs = []
  if (r.atkTurns > 0) { r.atkTurns--; if (!r.atkTurns) { r.atk = 0; msgs.push(`${pokemon.name}의 공격 랭크가 원래대로 돌아왔다!`) } }
  if (r.defTurns > 0) { r.defTurns--; if (!r.defTurns) { r.def = 0; msgs.push(`${pokemon.name}의 방어 랭크가 원래대로 돌아왔다!`) } }
  if (r.spdTurns > 0) { r.spdTurns--; if (!r.spdTurns) { r.spd = 0; msgs.push(`${pokemon.name}의 스피드 랭크가 원래대로 돌아왔다!`) } }
  return msgs
}

function applyRankChanges(r, self, target, moveName) {
  if (!r) return []
  const msgs = []
  const roll = r.chance !== undefined ? Math.random() < r.chance : true
  if (!roll) return []
  const selfR = { ...defaultRanks(), ...(self.ranks ?? {}) }
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
  const ds = Math.max(1, (defender.speed ?? 3) - getStatusSpdPenalty(defender))
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
  const raw = Math.floor(base * multiplier * (stab ? 1.3 : 1))
  const afterAtk = Math.max(0, raw + Math.max(-raw, atkRank))
  const afterDef = Math.max(0, afterAtk - (defender.defense ?? 3) * 5)
  const baseDmg = Math.max(0, afterDef - Math.min(3, Math.max(0, defRank)) * 3)
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

let logTs = Date.now()
function nextTs() { return logTs++ }

async function log(logsRef, text, type = "normal", meta = {}) {
  await logsRef.add({ text, type, ts: nextTs(), ...meta })
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

    const myEntry = freshData[`${mySlot}_entry`].map(p => ({ ...p, moves: (p.moves ?? []).map(m => ({ ...m })), ranks: { ...defaultRanks(), ...(p.ranks ?? {}) } }))
    const enemyEntry = freshData[`${enemySlot}_entry`].map(p => ({ ...p, ranks: { ...defaultRanks(), ...(p.ranks ?? {}) } }))
    const myPokemon = myEntry[myActiveIdx]
    const enePokemon = enemyEntry[eneActiveIdx]

    if (myPokemon.hp <= 0) return res.status(400).json({ error: "포켓몬 기절" })
    const moveData = myPokemon.moves[moveIdx]
    if (!moveData || moveData.pp <= 0) return res.status(400).json({ error: "PP 없음" })

    const myName = mySlot === "p1" ? freshData.player1_name : freshData.player2_name
    const enemyName = enemySlot === "p1" ? freshData.player1_name : freshData.player2_name
    const nextTurnCount = (freshData.turn_count ?? 1) + 1
    const moveInfo = moves[moveData.name]

    // HP 정보 포함한 hit 로그 헬퍼
    const hitLog = (defender, pokemon) => log(logsRef, "", "hit", {
      defender,
      hp: pokemon.hp,
      maxHp: pokemon.maxHp ?? pokemon.hp
    })
    const hitSelfLog = () => log(logsRef, "", "hit_self", {
      hp: myPokemon.hp,
      maxHp: myPokemon.maxHp ?? myPokemon.hp
    })

    // 희망사항 회복
    const wishMsgs = tickVolatiles(myPokemon)
    for (const msg of wishMsgs) await log(logsRef, msg)

    // 행동 불능 체크
    const preAction = checkPreActionStatus(myPokemon)
    for (const msg of preAction.msgs) await log(logsRef, msg)
    if (preAction.blocked) {
      resetRankStack(myPokemon)
      if ((myPokemon.defendTurns ?? 0) > 0) { myPokemon.defendTurns--; if (!myPokemon.defendTurns) myPokemon.defending = false }
      await roomRef.update({ [`${mySlot}_entry`]: myEntry, current_turn: enemySlot, turn_count: nextTurnCount })
      return res.status(200).json({ ok: true })
    }

    // 혼란 체크
    const confResult = checkConfusion(myPokemon)
    for (const msg of confResult.msgs) await log(logsRef, msg)
    if (confResult.selfHit) {
      resetRankStack(myPokemon)
      await hitSelfLog()
      if (isAllFainted(myEntry)) {
        await roomRef.update({ [`${mySlot}_entry`]: myEntry, turn_count: nextTurnCount, game_over: true, winner: enemyName, current_turn: null })
        await log(logsRef, `${enemyName}의 승리!`, "win")
      } else {
        await roomRef.update({ [`${mySlot}_entry`]: myEntry, current_turn: enemySlot, turn_count: nextTurnCount })
      }
      return res.status(200).json({ ok: true })
    }

    myPokemon.moves[moveIdx] = { ...moveData, pp: moveData.pp - 1 }
    await log(logsRef, `${myPokemon.name}의 ${moveData.name}!`)

    const diceRoll = rollD10()
    await log(logsRef, "", "dice", { slot: mySlot, roll: diceRoll })

    // ── 방어
    if (moveInfo?.defend) {
      const prevDefend = myPokemon.lastDefendMove === "방어"
      const stack = myPokemon.defendStack ?? 0
      let chance = 1.0
      if (prevDefend && stack >= 1) chance = stack >= 2 ? 0.25 : 0.5
      if (Math.random() < chance) {
        myPokemon.defending = true; myPokemon.defendTurns = 2
        myPokemon.lastDefendMove = "방어"; myPokemon.defendStack = prevDefend ? Math.min(2, stack + 1) : 1
        await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} 방어 태세에 들어갔다!`)
      } else {
        myPokemon.lastDefendMove = null; myPokemon.defendStack = 0
        await log(logsRef, `그러나 방어에 실패했다!`)
      }
      await roomRef.update({ [`${mySlot}_entry`]: myEntry, [`${enemySlot}_entry`]: enemyEntry, current_turn: enemySlot, turn_count: nextTurnCount })
      return res.status(200).json({ ok: true })
    }

    // ── 울부짖기
    if (moveInfo?.roar) {
      const candidates = enemyEntry.map((p, i) => ({ p, i })).filter(({ p, i }) => i !== eneActiveIdx && p.hp > 0)
      if (candidates.length === 0) {
        await log(logsRef, `그러나 ${enePokemon.name}에게는 맞지 않았다!`)
        await roomRef.update({ [`${mySlot}_entry`]: myEntry, [`${enemySlot}_entry`]: enemyEntry, current_turn: enemySlot, turn_count: nextTurnCount })
        return res.status(200).json({ ok: true })
      }
      const chosen = candidates[Math.floor(Math.random() * candidates.length)]
      await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 물러났다!`)
      await log(logsRef, `${chosen.p.name}${josa(chosen.p.name, "이가")} 나왔다!`)
      await roomRef.update({ [`${mySlot}_entry`]: myEntry, [`${enemySlot}_entry`]: enemyEntry, [`${enemySlot}_active_idx`]: chosen.i, current_turn: enemySlot, turn_count: nextTurnCount })
      return res.status(200).json({ ok: true })
    }

    // ── 신비의부적
    if (moveInfo?.amulet) {
      myPokemon.amuletTurns = 3
      await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} 신비의 부적으로 몸을 감쌌다!`)
      await roomRef.update({ [`${mySlot}_entry`]: myEntry, [`${enemySlot}_entry`]: enemyEntry, current_turn: enemySlot, turn_count: nextTurnCount })
      return res.status(200).json({ ok: true })
    }

    // ── 희망사항
    if (moveInfo?.wish) {
      myPokemon.wishTurns = 2
      await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} 희망사항을 빌었다!`)
      await roomRef.update({ [`${mySlot}_entry`]: myEntry, [`${enemySlot}_entry`]: enemyEntry, current_turn: enemySlot, turn_count: nextTurnCount })
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
      } else if (enePokemon.defending) {
        await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 방어했다!`)
        myPokemon.rollState = { active: false, turn: 0 }
      } else {
        await log(logsRef, "", "attack")
        const dmg = calcRolloutDamage(moveData.name, enePokemon, rollPower)
        enePokemon.hp = Math.max(0, enePokemon.hp - dmg)
        await hitLog(enemySlot, enePokemon)
        await log(logsRef, `구르기 ${rollTurn}번째 (${rollPower} 데미지)!`)
        if (enePokemon.hp <= 0) await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 쓰러졌다!`, "faint")
        myPokemon.rollState = rollTurn >= 3 ? { active: false, turn: 0 } : { active: true, turn: rollTurn }
      }
      const expMsgs = tickMyRanks(myPokemon); clearRankStack(myPokemon)
      for (const msg of expMsgs) await log(logsRef, msg)
      if (isAllFainted(enemyEntry)) {
        await roomRef.update({ [`${mySlot}_entry`]: myEntry, [`${enemySlot}_entry`]: enemyEntry, turn_count: nextTurnCount, game_over: true, winner: myName, current_turn: null })
        await log(logsRef, `${myName}의 승리!`, "win")
      } else {
        await roomRef.update({ [`${mySlot}_entry`]: myEntry, [`${enemySlot}_entry`]: enemyEntry, current_turn: enemySlot, turn_count: nextTurnCount })
      }
      return res.status(200).json({ ok: true })
    }

    // ── power: 0 랭크/효과 기술
    if (!moveInfo?.power) {
      const r = moveInfo?.rank
      const targetsEnemy = (r && (r.targetAtk !== undefined || r.targetDef !== undefined || r.targetSpd !== undefined)) || moveInfo?.targetSelf === false
      if (targetsEnemy) {
        const { hit, hitType } = calcHit(myPokemon, moveInfo, enePokemon)
        if (!hit) {
          await log(logsRef, hitType === "evaded" ? `${enePokemon.name}에게는 맞지 않았다!` : `그러나 ${myPokemon.name}의 공격은 빗나갔다!`, hitType === "evaded" ? "evade" : "normal")
          await roomRef.update({ [`${mySlot}_entry`]: myEntry, [`${enemySlot}_entry`]: enemyEntry, current_turn: enemySlot, turn_count: nextTurnCount })
          return res.status(200).json({ ok: true })
        }
      } else {
        if (!moveInfo?.alwaysHit && Math.random() * 100 >= (moveInfo?.accuracy ?? 100)) {
          await log(logsRef, `그러나 ${myPokemon.name}의 기술은 실패했다!`)
          await roomRef.update({ [`${mySlot}_entry`]: myEntry, [`${enemySlot}_entry`]: enemyEntry, current_turn: enemySlot, turn_count: nextTurnCount })
          return res.status(200).json({ ok: true })
        }
      }
      if (moveInfo?.clearSmog) {
        enePokemon.ranks = defaultRanks()
        await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "의")} 능력 변화가 원래대로 돌아왔다!`)
      }
      const rankMsgs = applyRankChanges(r, myPokemon, enePokemon, moveData.name)
      for (const msg of rankMsgs) await log(logsRef, msg)
      const rankEffectMsgs = applyMoveEffect(moveInfo?.effect, myPokemon, enePokemon, 0)
      for (const msg of rankEffectMsgs) await log(logsRef, msg)
      enePokemon.defending = false; enePokemon.defendTurns = 0
      await roomRef.update({ [`${mySlot}_entry`]: myEntry, [`${enemySlot}_entry`]: enemyEntry, current_turn: enemySlot, turn_count: nextTurnCount })
      return res.status(200).json({ ok: true })
    }

    // ── power > 0 공격 기술
    resetRankStack(myPokemon)
    myPokemon.lastDefendMove = null; myPokemon.defendStack = 0
    const atkRank = getActiveRank(myPokemon, "atk")
    const defRankEne = getActiveRank(enePokemon, "def")
    const wasDefending = enePokemon.defending ?? false
    enePokemon.defending = false; enePokemon.defendTurns = 0

    await log(logsRef, "", "attack")

    if (wasDefending) {
      await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 방어했다!`)
      if (moveInfo?.jumpKick) {
        const selfDmg = Math.max(1, Math.floor((myPokemon.maxHp ?? myPokemon.hp) * 0.25))
        myPokemon.hp = Math.max(0, myPokemon.hp - selfDmg)
        await hitSelfLog()
        await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} 반동으로 ${selfDmg} 데미지를 입었다!`)
      }
    } else {
      const { hit, hitType } = calcHit(myPokemon, moveInfo, enePokemon)
      if (!hit) {
        if (hitType === "evaded") {
          await log(logsRef, `${enePokemon.name}에게는 맞지 않았다!`, "evade")
        } else {
          await log(logsRef, `그러나 ${myPokemon.name}의 공격은 빗나갔다!`)
        }
        if (moveInfo?.jumpKick) {
          const selfDmg = Math.max(1, Math.floor((myPokemon.maxHp ?? myPokemon.hp) * 0.25))
          myPokemon.hp = Math.max(0, myPokemon.hp - selfDmg)
          await hitSelfLog()
          await log(logsRef, `${myPokemon.name}${josa(myPokemon.name, "은는")} 반동으로 ${selfDmg} 데미지를 입었다!`)
        }
      } else {
        const revengeReady = freshData[`revenge_ready_${mySlot}`] ?? false
        const powerOverride = (moveInfo?.revenge && revengeReady) ? 70 : null
        const { damage, multiplier, critical } = calcDamage(myPokemon, moveData.name, enePokemon, atkRank, defRankEne, powerOverride)
        if (multiplier === 0) {
          await log(logsRef, `${enePokemon.name}에게는 효과가 없다…`)
        } else {
          enePokemon.hp = Math.max(0, enePokemon.hp - damage)
          await hitLog(enemySlot, enePokemon)
          if (multiplier > 1) await log(logsRef, "효과가 굉장했다!")
          if (multiplier < 1) await log(logsRef, "효과가 별로인 듯하다…")
          if (critical) await log(logsRef, "급소에 맞았다!", "critical")
          if (moveInfo?.clearSmog) {
            enePokemon.ranks = defaultRanks()
            await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "의")} 능력 변화가 원래대로 돌아왔다!`)
          }
          const effectMsgs = applyMoveEffect(moveInfo?.effect, myPokemon, enePokemon, damage)
          for (const msg of effectMsgs) await log(logsRef, msg)
          if (moveInfo?.rank) {
            const rankMsgs = applyRankChanges(moveInfo.rank, myPokemon, enePokemon, null)
            for (const msg of rankMsgs) await log(logsRef, msg)
          }
          if (!moveInfo?.lastResort) myPokemon.usedMoves = [...new Set([...(myPokemon.usedMoves ?? []), moveData.name])]
          if (enePokemon.hp <= 0) await log(logsRef, `${enePokemon.name}${josa(enePokemon.name, "은는")} 쓰러졌다!`, "faint")
        }
      }
    }

    const weatherResult = applyWeatherEffect(moveInfo?.effect)
    if (weatherResult.weather) for (const msg of weatherResult.msgs) await log(logsRef, msg)

    const expiredMsgs = tickMyRanks(myPokemon)
    clearRankStack(myPokemon)

    const revengeUpdate = {}
    if (moveInfo?.revenge) revengeUpdate[`revenge_ready_${mySlot}`] = false

    const nextTurn = nextTurnCount
    if (nextTurn % 2 === 0) {
      const { msgs: eotMsgs, anyFainted } = applyEndOfTurnDamage([myEntry, enemyEntry])
      for (const msg of eotMsgs) await log(logsRef, msg)
      if (anyFainted) {
        const enemyFainted = isAllFainted(enemyEntry), myFainted = isAllFainted(myEntry)
        if (!enemyFainted && anyFainted) revengeUpdate[`revenge_ready_${enemySlot}`] = true
        if (enemyFainted) {
          await roomRef.update({ [`${mySlot}_entry`]: myEntry, [`${enemySlot}_entry`]: enemyEntry, turn_count: nextTurn, game_over: true, winner: myName, current_turn: null, ...revengeUpdate, ...(weatherResult.weather ? { weather: weatherResult.weather } : {}) })
          await log(logsRef, `${myName}의 승리!`, "win")
          return res.status(200).json({ ok: true })
        } else if (myFainted) {
          await roomRef.update({ [`${mySlot}_entry`]: myEntry, [`${enemySlot}_entry`]: enemyEntry, turn_count: nextTurn, game_over: true, winner: enemyName, current_turn: null, ...revengeUpdate, ...(weatherResult.weather ? { weather: weatherResult.weather } : {}) })
          await log(logsRef, `${enemyName}의 승리!`, "win")
          return res.status(200).json({ ok: true })
        }
      }
    }

    for (const msg of expiredMsgs) await log(logsRef, msg)

    if (enePokemon.hp <= 0) revengeUpdate[`revenge_ready_${enemySlot}`] = false
    if (myPokemon.hp <= 0) revengeUpdate[`revenge_ready_${enemySlot}`] = true

    if (isAllFainted(enemyEntry)) {
      await roomRef.update({ [`${mySlot}_entry`]: myEntry, [`${enemySlot}_entry`]: enemyEntry, turn_count: nextTurn, game_over: true, winner: myName, current_turn: null, ...revengeUpdate, ...(weatherResult.weather ? { weather: weatherResult.weather } : {}) })
      await log(logsRef, `${myName}의 승리!`, "win")
    } else if (isAllFainted(myEntry)) {
      await roomRef.update({ [`${mySlot}_entry`]: myEntry, [`${enemySlot}_entry`]: enemyEntry, turn_count: nextTurn, game_over: true, winner: enemyName, current_turn: null, ...revengeUpdate, ...(weatherResult.weather ? { weather: weatherResult.weather } : {}) })
      await log(logsRef, `${enemyName}의 승리!`, "win")
    } else {
      await roomRef.update({ [`${mySlot}_entry`]: myEntry, [`${enemySlot}_entry`]: enemyEntry, current_turn: enemySlot, turn_count: nextTurn, ...revengeUpdate, ...(weatherResult.weather ? { weather: weatherResult.weather } : {}) })
    }

    return res.status(200).json({ ok: true })

  } catch (e) {
    console.error(e)
    return res.status(500).json({ error: e.message })
  }
}