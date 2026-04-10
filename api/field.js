// field.js
// 필드 기술 처리 — 스텔스록 / 독압정
// Firestore 필드:
//   stealth_rock_p1 / stealth_rock_p2 (bool)
//   toxic_spikes_p1 / toxic_spikes_p2 (bool)

import { josa } from "./effecthandler.js"
import { getTypeMultiplier } from "./typeChart.js"

// ────────────────────────────────────────────
//  스텔스록 데미지 계산
//  바위 타입 상성에 따라 비율 결정
// ────────────────────────────────────────────
function getStealthRockRate(pokemon) {
  const types = Array.isArray(pokemon.type) ? pokemon.type : [pokemon.type]
  let mult = 1
  for (const t of types) mult *= getTypeMultiplier("바위", t)
  // 소수점 반올림 (0.96→1 등)
  mult = Math.round(mult * 10) / 10

  if (mult <= 0)   return 0        // 무효 타입 (없긴 하지만 안전장치)
  if (mult <= 0.6) return 1 / 32   // 0.8*0.8
  if (mult <= 0.9) return 1 / 27   // 0.8
  if (mult <= 1.1) return 1 / 20   // 1배 (0.96 포함)
  if (mult <= 1.3) return 1 / 16   // 1.2
  return 1 / 10                    // 1.2*1.2
}

// ────────────────────────────────────────────
//  교체 출전 시 필드 효과 적용
//  반환: { msgs, hitLogs, statusMsgs, fieldUpdate }
//    hitLogs: [{slot, hp, maxHp}] — use-move/switch에서 log() 호출용
//    fieldUpdate: Firestore에 반영할 필드 변경 (독 타입이 독압정 제거 시 등)
// ────────────────────────────────────────────
export function applyFieldEffects(pokemon, slot, roomData) {
  const msgs = []
  const hitLogs = []
  const statusMsgs = []
  const fieldUpdate = {}

  const srKey = `stealth_rock_${slot}`
  const tsKey = `toxic_spikes_${slot}`

  // ── 스텔스록
  if (roomData[srKey]) {
    const rate = getStealthRockRate(pokemon)
    const dmg = Math.max(1, Math.floor((pokemon.maxHp ?? pokemon.hp) * rate))
    pokemon.hp = Math.max(0, pokemon.hp - dmg)
    msgs.push(`뾰족한 돌이 ${pokemon.name}${josa(pokemon.name, "을를")} 덮쳤다!`)
    hitLogs.push({ slot, hp: pokemon.hp, maxHp: pokemon.maxHp ?? pokemon.hp })
    if (pokemon.hp <= 0) msgs.push(`${pokemon.name}${josa(pokemon.name, "은는")} 쓰러졌다!`)
  }

  // ── 독압정 (HP가 남아있을 때만)
  if (roomData[tsKey] && pokemon.hp > 0) {
    const types = Array.isArray(pokemon.type) ? pokemon.type : [pokemon.type]
    if (types.includes("독") || types.includes("강철")) {
      // 독/강철 타입 → 독압정 제거
      msgs.push(`${pokemon.name}${josa(pokemon.name, "이가")} 독압정을 흡수했다!`)
      fieldUpdate[tsKey] = false
    } else if (!pokemon.status) {
      // 다른 타입 → 독 부여
      pokemon.status = "독"
      statusMsgs.push(`${pokemon.name}${josa(pokemon.name, "은는")} 독압정 때문에 독 상태가 됐다!`)
    }
  }

  return { msgs, hitLogs, statusMsgs, fieldUpdate }
}

// ────────────────────────────────────────────
//  고속스핀 — 자기 진영 필드 제거
//  반환: { msgs, fieldUpdate }
// ────────────────────────────────────────────
export function applyRapidSpin(slot, roomData) {
  const msgs = []
  const fieldUpdate = {}

  const srKey = `stealth_rock_${slot}`
  const tsKey = `toxic_spikes_${slot}`

  if (roomData[srKey]) {
    fieldUpdate[srKey] = false
    msgs.push(`${slot === "p1" ? "아군" : "상대"} 진영의 스텔스록이 사라졌다!`)
  }
  if (roomData[tsKey]) {
    fieldUpdate[tsKey] = false
    msgs.push(`${slot === "p1" ? "아군" : "상대"} 진영의 독압정이 사라졌다!`)
  }

  return { msgs, fieldUpdate }
}