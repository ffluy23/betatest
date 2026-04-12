import { db } from "./_firebase.js"
import { applyFieldEffects } from "./field.js"

function josa(word, type) {
  if (!word) return type === "은는" ? "은" : type === "이가" ? "이" : type === "을를" ? "을" : type === "과와" ? "과" : "으로"
  const code = word.charCodeAt(word.length - 1)
  if (code < 0xAC00 || code > 0xD7A3) {
    return type === "은는" ? "은" : type === "이가" ? "이" : type === "을를" ? "을" : type === "과와" ? "과" : "으로"
  }
  const hasFinal = (code - 0xAC00) % 28 !== 0
  if (type === "은는") return hasFinal ? "은" : "는"
  if (type === "이가") return hasFinal ? "이" : "가"
  if (type === "을를") return hasFinal ? "을" : "를"
  if (type === "과와") return hasFinal ? "과" : "와"
  if (type === "으로") return hasFinal ? "으로" : "로"
  return ""
}

function defaultRanks() {
  return { atk: 0, atkTurns: 0, def: 0, defTurns: 0, spd: 0, spdTurns: 0 }
}

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

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")
  if (req.method === "OPTIONS") return res.status(200).end()
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })

  try {
    const { roomId, mySlot, newIdx } = req.body
    if (!roomId || !mySlot || newIdx === undefined) {
      return res.status(400).json({ error: "필수 파라미터 누락" })
    }

    const roomRef = db.collection("rooms").doc(roomId)
    const logsRef = roomRef.collection("logs")
    const snap = await roomRef.get()
    const data = snap.data()
    if (!data) return res.status(404).json({ error: "방 없음" })
    if (data.current_turn !== mySlot) return res.status(400).json({ error: "지금 네 턴이 아님" })

    const enemySlot = mySlot === "p1" ? "p2" : "p1"
    const myEntry = data[`${mySlot}_entry`].map(p => ({
      ...p,
      ranks: { ...defaultRanks(), ...(p.ranks ?? {}) }
    }))
    const myPokemon = myEntry[data[`${mySlot}_active_idx`]]
    const newPokemon = myEntry[newIdx]

    if (!newPokemon || newPokemon.hp <= 0) {
      return res.status(400).json({ error: "교체 불가" })
    }

    // 랭크 초기화
    myPokemon.lastRankMove = null
    myPokemon.rankStack = 0
    if (myPokemon.ranks) {
      myPokemon.ranks.atk = 0; myPokemon.ranks.atkTurns = 0
      myPokemon.ranks.def = 0; myPokemon.ranks.defTurns = 0
      myPokemon.ranks.spd = 0; myPokemon.ranks.spdTurns = 0
    }

    // 구르기 초기화
    myPokemon.rollState = { active: false, turn: 0 }

    // 참기 취소
    myPokemon.bideState = null

    // 풀죽음 해제
    myPokemon.flinch = false

    // 씨뿌리기: 교체 나간 포켓몬 seeded 해제
    myPokemon.seeded = false

    // 새로 나온 포켓몬 seeded 해제
    newPokemon.seeded = false

    const myName = mySlot === "p1" ? data.player1_name : data.player2_name
    const enemyName = enemySlot === "p1" ? data.player1_name : data.player2_name
    const prev = myPokemon.name
    const next = newPokemon.name
    const nextTurnCount = (data.turn_count ?? 1) + 1
    let ts = Date.now()

    await logsRef.add({ text: `돌아와, ${prev}!`, type: "normal", ts: ts++ })
    await logsRef.add({
      text: `${myName}${josa(myName, "은는")} ${next}${josa(next, "을를")} 내보냈다!`,
      type: "switch",
      slot: mySlot,
      hp: newPokemon.hp,
      maxHp: newPokemon.maxHp ?? newPokemon.hp,
      ts: ts++
    })

    // ── 필드 효과 (스텔스록 / 독압정)
    const { msgs: fieldMsgs, hitLogs, statusMsgs, fieldUpdate } =
      applyFieldEffects(newPokemon, mySlot, data)

    for (const msg of fieldMsgs) {
      await logsRef.add({ text: msg, type: "normal", ts: ts++ })
    }
    for (const hl of hitLogs) {
      await logsRef.add({
        text: "", type: "hit",
        defender: hl.slot, hp: hl.hp, maxHp: hl.maxHp,
        ts: ts++
      })
    }
    for (const msg of statusMsgs) {
      await logsRef.add({ text: msg, type: "normal", ts: ts++ })
    }
    
        if (newPokemon.healOnSwitchIn && newPokemon.hp > 0) {
      const healAmount = Math.max(1, Math.floor((newPokemon.maxHp ?? newPokemon.hp) * 0.22))
newPokemon.hp = Math.min(newPokemon.maxHp ?? newPokemon.hp, newPokemon.hp + healAmount)
      newPokemon.status = null
      newPokemon.healOnSwitchIn = false
      await logsRef.add({ text: `${newPokemon.name}${josa(newPokemon.name, "은는")} 치유소원으로 HP와 상태이상이 회복됐다!`, type: "normal", ts: ts++ })
      await logsRef.add({ text: "", type: "heal", slot: mySlot, hp: newPokemon.hp, maxHp: newPokemon.maxHp ?? newPokemon.hp, ts: ts++ })
    }
    
    const fainted = newPokemon.hp <= 0
    const allFainted = myEntry.every(p => p.hp <= 0)

    const updateData = {
      [`${mySlot}_entry`]: sanitizeForFirestore(myEntry),
      [`${mySlot}_active_idx`]: newIdx,
      current_turn: enemySlot,
      turn_count: nextTurnCount,
      [`force_switch_${mySlot}`]: false,  // ★ 유턴 강제교체 플래그 리셋
      ...fieldUpdate,
      // 스텔스록으로 새 포켓몬이 쓰러진 경우 다시 강제교체
      ...(fainted && !allFainted ? { [`force_switch_${mySlot}`]: true, current_turn: mySlot } : {}),
      ...(allFainted ? { game_over: true, winner: enemyName, current_turn: null } : {})
    }

    await roomRef.update(updateData)

    if (allFainted) {
      await logsRef.add({ text: `${enemyName}의 승리!`, type: "win", ts: ts++ })
    }

    return res.status(200).json({ ok: true })

  } catch (e) {
    console.error(e)
    return res.status(500).json({ error: e.message })
  }
}