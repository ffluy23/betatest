import { db } from "./_firebase.js"

function rollD10() { return Math.floor(Math.random() * 10) + 1 }

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")
  if (req.method === "OPTIONS") return res.status(200).end()
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })

  try {
    const { roomId, myUid, mySlot } = req.body
    if (!roomId || !myUid || !mySlot) return res.status(400).json({ error: "필수 파라미터 누락" })
    if (mySlot !== "player1" && mySlot !== "player2") return res.status(400).json({ error: "잘못된 슬롯" })

    const roomRef = db.collection("rooms").doc(roomId)

    const result = await db.runTransaction(async (t) => {
      const snap = await t.get(roomRef)
      const room = snap.data()
      if (!room) throw new Error("방 없음")
      if (room.game_started) return { alreadyStarted: true }

      const readyField = mySlot === "player1" ? "player1_ready" : "player2_ready"
      const otherReady = mySlot === "player1" ? room.player2_ready : room.player1_ready

      if (otherReady) {
        return { bothReady: true, room }
      } else {
        t.update(roomRef, { [readyField]: true })
        return { bothReady: false }
      }
    })

    if (result.alreadyStarted) return res.status(200).json({ ok: true, started: true })
    if (!result.bothReady) return res.status(200).json({ ok: true, waiting: true })

    const room = result.room
    const p1Uid = room.player1_uid
    const p2Uid = room.player2_uid
    if (!p1Uid || !p2Uid) return res.status(400).json({ error: "플레이어 uid 없음" })

    const [p1Snap, p2Snap] = await Promise.all([
      db.collection("users").doc(p1Uid).get(),
      db.collection("users").doc(p2Uid).get()
    ])
    const p1Entry = (p1Snap.data()?.entry ?? []).map(p => ({ ...p, maxHp: p.hp }))
    const p2Entry = (p2Snap.data()?.entry ?? []).map(p => ({ ...p, maxHp: p.hp }))

    if (p1Entry.length === 0 || p2Entry.length === 0) {
      return res.status(400).json({ error: "엔트리가 비어있음" })
    }

    const r1 = rollD10()
    const r2 = rollD10()
    const p1Speed = p1Entry[0]?.speed ?? 3
    const p2Speed = p2Entry[0]?.speed ?? 3
    const firstSlot = p1Speed + r1 >= p2Speed + r2 ? "p1" : "p2"
    const firstPokemonName = firstSlot === "p1" ? p1Entry[0].name : p2Entry[0].name

    // 게임 시작 세팅 — 로그는 아직 안 씀, intro_done은 false
    // 클라이언트 인트로 끝나면 /api/start-battle 호출해서 로그 씀
    await roomRef.update({
      player1_ready: true,
      player2_ready: true,
      p1_entry: p1Entry,
      p2_entry: p2Entry,
      p1_active_idx: 0,
      p2_active_idx: 0,
      game_started: true,
      first_slot: firstSlot,
      first_pokemon_name: firstPokemonName,
      p1_dice: r1,
      p2_dice: r2,
      current_turn: firstSlot,
      turn_count: 1,
      intro_done: false
    })

    return res.status(200).json({ ok: true, started: true })

  } catch (e) {
    console.error(e)
    return res.status(500).json({ error: e.message })
  }
}