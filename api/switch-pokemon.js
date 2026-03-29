import { db } from "./_firebase.js"

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
    const snap = await roomRef.get()
    const data = snap.data()

    if (!data) return res.status(404).json({ error: "방 없음" })
    if (data.current_turn !== mySlot) return res.status(400).json({ error: "지금 네 턴이 아님" })

    const enemySlot = mySlot === "p1" ? "p2" : "p1"
    const myEntry = data[`${mySlot}_entry`].map(p => ({
      ...p,
      ranks: { atk: 0, atkTurns: 0, def: 0, defTurns: 0, spd: 0, spdTurns: 0, ...(p.ranks ?? {}) }
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

    const myName = mySlot === "p1" ? data.player1_name : data.player2_name
    const prev = myPokemon.name
    const next = newPokemon.name
    const nextTurnCount = (data.turn_count ?? 1) + 1

    // 로그 추가
    const logsRef = db.collection("rooms").doc(roomId).collection("logs")
    const base = Date.now()
    await logsRef.add({ text: `돌아와, ${prev}!`, ts: base })
    await logsRef.add({ text: `${myName}은(는) ${next}을(를) 내보냈다!`, ts: base + 1 })

    await roomRef.update({
      [`${mySlot}_entry`]: myEntry,
      [`${mySlot}_active_idx`]: newIdx,
      current_turn: enemySlot,
      turn_count: nextTurnCount
    })

    return res.status(200).json({ ok: true })

  } catch (e) {
    console.error(e)
    return res.status(500).json({ error: e.message })
  }
}