import { db } from "./_firebase.js"

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

    // 트랜잭션으로 레디 처리 + 게임 시작을 한 번에
    const result = await db.runTransaction(async (t) => {
      const snap = await t.get(roomRef)
      const room = snap.data()
      if (!room) throw new Error("방 없음")
      if (room.game_started) return { alreadyStarted: true }

      // 내 레디 필드 세팅
      const readyField = mySlot === "player1" ? "player1_ready" : "player2_ready"
      const update = { [readyField]: true }

      // 상대방도 레디됐는지 확인
      const otherReady = mySlot === "player1" ? room.player2_ready : room.player1_ready

      if (otherReady) {
        // 둘 다 레디! 게임 시작 준비
        return { bothReady: true, room, update }
      } else {
        // 나만 레디
        t.update(roomRef, update)
        return { bothReady: false }
      }
    })

    if (result.alreadyStarted) {
      return res.status(200).json({ ok: true, started: true })
    }

    if (!result.bothReady) {
      return res.status(200).json({ ok: true, waiting: true })
    }

    // 둘 다 레디됐으면 두 플레이어 entry 읽어서 한 번에 game_started
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

    await roomRef.update({
      player1_ready: true,
      player2_ready: true,
      p1_entry: p1Entry,
      p2_entry: p2Entry,
      p1_active_idx: 0,
      p2_active_idx: 0,
      game_started: true
    })

    return res.status(200).json({ ok: true, started: true })

  } catch (e) {
    console.error(e)
    return res.status(500).json({ error: e.message })
  }
}