import { db } from "./_firebase.js"

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")

  if (req.method === "OPTIONS") return res.status(200).end()
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" })

  try {
    const { roomId, mySlot, myUid } = req.body
    if (!roomId || !mySlot || !myUid) {
      return res.status(400).json({ error: "필수 파라미터 누락" })
    }

    const roomRef = db.collection("rooms").doc(roomId)
    const snap = await roomRef.get()
    const data = snap.data()

    if (!data) return res.status(404).json({ error: "방 없음" })
    if (data.current_turn !== mySlot) return res.status(400).json({ error: "지금 네 턴이 아님" })

    return res.status(200).json({ ok: true, data })

  } catch (e) {
    console.error(e)
    return res.status(500).json({ error: e.message })
  }
}