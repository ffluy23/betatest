import { db } from "./_firebase.js"

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")

  if (req.method === "OPTIONS") return res.status(200).end()
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })

  try {
    const { roomId } = req.body
    if (!roomId) return res.status(400).json({ error: "roomId 없음" })

    const roomRef = db.collection("rooms").doc(roomId)

    // 트랜잭션으로 딱 한 번만 실행되게
    await db.runTransaction(async (t) => {
      const snap = await t.get(roomRef)
      const data = snap.data()

      if (!data) throw new Error("방 없음")
      if (!data.p1_entry || !data.p2_entry) throw new Error("엔트리 없음")

      // 이미 실행됐으면 스킵
      if (data.first_slot) throw new Error("already_init")

      const p1 = data.p1_entry[0]
      const p2 = data.p2_entry[0]

      const r1 = Math.floor(Math.random() * 10) + 1
      const r2 = Math.floor(Math.random() * 10) + 1
      const fs = (p1.speed ?? 3) + r1 >= (p2.speed ?? 3) + r2 ? "p1" : "p2"

      t.update(roomRef, {
        first_slot: fs,
        first_pokemon_name: fs === "p1" ? p1.name : p2.name,
        p1_dice: r1,
        p2_dice: r2
      })
    })

    return res.status(200).json({ ok: true })

  } catch (e) {
    if (e.message === "already_init") return res.status(200).json({ ok: true, skipped: true })
    console.error(e)
    return res.status(500).json({ error: e.message })
  }
}