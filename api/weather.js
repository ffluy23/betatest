// weather.js
// 날씨 시스템 — 싱글 배틀용
// Firestore 필드: weather (string|null), weatherTurns (int)

import { josa } from "./effecthandler.js"

// ────────────────────────────────────────────
//  날씨 시작 처리
//  - 즉시 교체(덮어쓰기)
//  - 모래바람: 바위 타입 방어 +2 (weatherDefBoost 플래그)
//  - 이전 날씨가 모래바람이었으면 방어 부스트 먼저 제거
// ────────────────────────────────────────────
export function startWeather(newWeather, turns, prevWeather, allPokemon) {
  const msgs = []

  // 이전 날씨가 모래바람이었으면 방어 부스트 제거
  if (prevWeather === "모래바람" && newWeather !== "모래바람") {
    for (const p of allPokemon) {
      if (p && p.weatherDefBoost && p.hp > 0) {
        const base = p.defense ?? 3
        if (p.ranks) {
          p.ranks.def = Math.max(base, (p.ranks.def ?? base) - 2)
          p.ranks.defTurns = 0
        }
        p.weatherDefBoost = false
      }
    }
  }

  // 새 날씨 시작 로그
  const firstLog = {
    "쾌청":     "햇살이 강해졌다!",
    "비":       "비가 내리기 시작했다!",
    "모래바람": "모래바람이 불기 시작했다!",
    "싸라기눈": "싸라기눈이 내리기 시작했다!",
  }[newWeather] ?? `${newWeather} 날씨가 시작됐다!`
  msgs.push(firstLog)

  // 모래바람: 바위 타입 방어 +2
  if (newWeather === "모래바람") {
    for (const p of allPokemon) {
      if (!p || p.hp <= 0) continue
      const types = Array.isArray(p.type) ? p.type : [p.type]
      if (types.includes("바위") && !p.weatherDefBoost) {
        const base = p.defense ?? 3
        if (!p.ranks) p.ranks = { atk: p.attack ?? 3, atkTurns: 0, def: base, defTurns: 0, spd: p.speed ?? 3, spdTurns: 0 }
        const prev = (p.ranks.defTurns ?? 0) > 0 ? (p.ranks.def ?? base) : base
        p.ranks.def = Math.min(base + 3, prev + 2)  // MAX_DEF_BONUS = 3
        p.ranks.defTurns = 999  // 날씨 지속 중 유지
        p.weatherDefBoost = true
        msgs.push(`모래바람으로 ${p.name}${josa(p.name, "의")} 방어가 올랐다!`)
      }
    }
  }

  return { msgs, weather: newWeather, weatherTurns: turns }
}

// ────────────────────────────────────────────
//  날씨 지속 로그 (isSecondToAct 블록, EOT 시점)
// ────────────────────────────────────────────
export function getWeatherLog(weather) {
  return {
    "쾌청":     "햇살이 강하다",
    "비":       "비가 계속 내리고 있다",
    "모래바람": "모래바람이 계속 불고 있다",
    "싸라기눈": "싸라기눈이 계속 내리고 있다",
  }[weather] ?? null
}

// ────────────────────────────────────────────
//  날씨 EOT 데미지 (모래바람 / 싸라기눈)
//  반환: { msgs: string[], hitLogs: [{slot, hp, maxHp}], anyFainted: bool }
//
//  hitLogs는 use-move.js에서 log() 호출에 사용
//  순서: myPokemon(p1 활성) → enePokemon(p2 활성)
// ────────────────────────────────────────────
export function applyWeatherDamage(weather, myPokemon, mySlot, enePokemon, enemySlot) {
  const msgs = []
  const hitLogs = []
  let anyFainted = false

  if (weather !== "모래바람" && weather !== "싸라기눈") {
    return { msgs, hitLogs, anyFainted }
  }

  const immune = weather === "모래바람"
    ? ["바위", "땅", "강철"]
    : ["얼음"]

  const damageLabel = weather === "모래바람"
    ? "모래바람이"
    : "싸라기눈이"

  for (const [pokemon, slot] of [[myPokemon, mySlot], [enePokemon, enemySlot]]) {
    if (!pokemon || pokemon.hp <= 0) continue
    const types = Array.isArray(pokemon.type) ? pokemon.type : [pokemon.type]
    if (types.some(t => immune.includes(t))) continue

    const dmg = Math.max(1, Math.floor((pokemon.maxHp ?? pokemon.hp) / 16))
    pokemon.hp = Math.max(0, pokemon.hp - dmg)
    msgs.push(`${damageLabel} ${pokemon.name}${josa(pokemon.name, "을를")} 덮쳤다!`)
    hitLogs.push({ slot, hp: pokemon.hp, maxHp: pokemon.maxHp ?? pokemon.hp })
    if (pokemon.hp <= 0) {
      msgs.push(`${pokemon.name}${josa(pokemon.name, "은는")} 쓰러졌다!`)
      anyFainted = true
    }
  }

  return { msgs, hitLogs, anyFainted }
}

// ────────────────────────────────────────────
//  날씨 턴 감소
//  반환: { expired: bool, weatherTurns: int }
// ────────────────────────────────────────────
export function tickWeather(weatherTurns) {
  const next = (weatherTurns ?? 0) - 1
  return { expired: next <= 0, weatherTurns: Math.max(0, next) }
}

// ────────────────────────────────────────────
//  날씨 종료 처리
//  - 모래바람 방어 부스트 제거
// ────────────────────────────────────────────
export function endWeather(prevWeather, allPokemon) {
  const msgs = []
  if (prevWeather === "모래바람") {
    for (const p of allPokemon) {
      if (p && p.weatherDefBoost) {
        const base = p.defense ?? 3
        if (p.ranks) {
          p.ranks.def = Math.max(base, (p.ranks.def ?? base) - 2)
          p.ranks.defTurns = 0
        }
        p.weatherDefBoost = false
      }
    }
  }
  const endLog = {
    "쾌청":     "햇살이 약해졌다",
    "비":       "비가 그쳤다",
    "모래바람": "모래바람이 가라앉았다",
    "싸라기눈": "싸라기눈이 그쳤다",
  }[prevWeather]
  if (endLog) msgs.push(endLog)
  return { msgs, weather: null, weatherTurns: 0 }
}

// ────────────────────────────────────────────
//  calcDamage에서 사용할 날씨 배율
// ────────────────────────────────────────────
export function getWeatherDamageMult(weather, moveType) {
  if (!weather || !moveType) return 1.0
  if (weather === "쾌청") {
    if (moveType === "불") return 1.2
    if (moveType === "물") return 0.8
  }
  if (weather === "비") {
    if (moveType === "물") return 1.2
    if (moveType === "불") return 0.8
  }
  return 1.0
}

// ────────────────────────────────────────────
//  쾌청: 성장 공격 랭크 보정값 반환
//  use-move.js에서 applyRankChanges 호출 전에 rank.atk 덮어쓰기용
// ────────────────────────────────────────────
export function getSunnyGrowthBonus(weather) {
  return weather === "쾌청" ? 2 : 1
}

// ────────────────────────────────────────────
//  쾌청: 번개 명중률 50%, 비: 번개 alwaysHit
//  calcHit 직전에 moveInfo를 패치하는 용도
// ────────────────────────────────────────────
export function patchMoveForWeather(weather, moveName, moveInfo) {
  if (!moveInfo) return moveInfo
  if (moveName === "번개") {
    if (weather === "비") return { ...moveInfo, alwaysHit: true, accuracy: 100 }
    if (weather === "쾌청") return { ...moveInfo, alwaysHit: false, accuracy: 50 }
  }
  if (moveName === "눈보라") {
    if (weather === "싸라기눈") return { ...moveInfo, alwaysHit: true, accuracy: 100 }
  }
  return moveInfo
}

// ────────────────────────────────────────────
//  쾌청: 얼음 상태이상 면역 체크
//  applyStatus 전에 호출
// ────────────────────────────────────────────
export function isFrozenImmuneByWeather(weather, status) {
  return weather === "쾌청" && status === "얼음"
}