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
    const logsRef = roomRef.collection("logs")

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

    const p1Name = room.player1_name
    const p2Name = room.player2_name

    // 인트로 로그 배치 쓰기
    let ts = Date.now()
    const batch = db.batch()
    const logs = [
      { text: `${p1Name}${josa(p1Name, "과와")} ${p2Name}의 승부가 시작됐다!`, type: "normal", ts: ts++ },
      { text: "", type: "intro_wait", ts: ts++ }, // 클라이언트가 3초 대기 + intro_done 세팅
      { text: `${p1Name}${josa(p1Name, "은는")} ${p1Entry[0].name}${josa(p1Entry[0].name, "을를")} 내보냈다!`, type: "normal", ts: ts++ },
      { text: `${p2Name}${josa(p2Name, "은는")} ${p2Entry[0].name}${josa(p2Entry[0].name, "을를")} 내보냈다!`, type: "normal", ts: ts++ },
      { text: `${firstPokemonName}의 선공!`, type: "normal", ts: ts++ },
    ]
    for (const log of logs) {
      batch.set(logsRef.doc(), log)
    }
    await batch.commit()

    // intro_done은 false — 클라이언트 인트로 끝나고 나서 true로 바꿈
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
      intro_done: false  // 인트로 끝나고 클라이언트가 true로 세팅
    })

    return res.status(200).json({ ok: true, started: true })

  } catch (e) {
    console.error(e)
    return res.status(500).json({ error: e.message })
  }
}