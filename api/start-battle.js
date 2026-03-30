import { db } from "./_firebase.js"

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
    const logsRef = roomRef.collection("logs")

    // 트랜잭션으로 딱 한 번만 실행
    const result = await db.runTransaction(async (t) => {
      const snap = await t.get(roomRef)
      const data = snap.data()
      if (!data) throw new Error("방 없음")
      if (data.intro_done) return { skip: true }  // 이미 처리됨
      if (!data.game_started) return { skip: true }
      return { skip: false, data }
    })

    if (result.skip) return res.status(200).json({ ok: true, skipped: true })

    const data = result.data
    const p1Name = data.player1_name
    const p2Name = data.player2_name
    const p1First = data.p1_entry?.[0]
    const p2First = data.p2_entry?.[0]
    const firstPokemonName = data.first_pokemon_name

    // 인트로 끝난 후 배틀 로그 + 선공 다이스 로그 씀
    let ts = Date.now()
    const batch = db.batch()
    const logs = [
      { text: `${p1Name}${josa(p1Name, "과와")} ${p2Name}의 승부가 시작됐다!`, type: "normal", ts: ts++ },
      { text: `${p1Name}${josa(p1Name, "은는")} ${p1First?.name}${josa(p1First?.name, "을를")} 내보냈다!`, type: "normal", ts: ts++ },
      { text: `${p2Name}${josa(p2Name, "은는")} ${p2First?.name}${josa(p2First?.name, "을를")} 내보냈다!`, type: "normal", ts: ts++ },
      // 선공 다이스 로그 — 클라이언트가 이걸 보고 양쪽 주사위 애니메이션 실행
      { text: "", type: "intro_dice", ts: ts++ },
      { text: `${firstPokemonName}의 선공!`, type: "normal", ts: ts++ },
    ]
    for (const log of logs) {
      batch.set(logsRef.doc(), log)
    }
    await batch.commit()

    // intro_done: true 세팅
    await roomRef.update({ intro_done: true })

    return res.status(200).json({ ok: true })

  } catch (e) {
    console.error(e)
    return res.status(500).json({ error: e.message })
  }
}