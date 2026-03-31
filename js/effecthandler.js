// effecthandler.js

export function statusName(status) {
  const map = { poison: "독", burn: "화상", paralysis: "마비", frozen: "얼음" }
  return map[status] ?? status
}

export function josa(word, type) {
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

export function applyStatus(pokemon, status) {
  if (pokemon.status) return []
  if (pokemon.hp <= 0) return []
  // 신비의부적: 상태이상 무효
  if ((pokemon.amuletTurns ?? 0) > 0) return [`${pokemon.name}${josa(pokemon.name, "은는")} 신비의 부적으로 상태이상을 막았다!`]
  // 타입 면역
  const types = Array.isArray(pokemon.type) ? pokemon.type : [pokemon.type]
  if (status === "poison" && (types.includes("독") || types.includes("강철")))
    return [`${pokemon.name}${josa(pokemon.name, "은는")} 독에 걸리지 않는다!`]
  if (status === "burn" && types.includes("불"))
    return [`${pokemon.name}${josa(pokemon.name, "은는")} 화상에 걸리지 않는다!`]
  if (status === "frozen" && types.includes("얼음"))
    return [`${pokemon.name}${josa(pokemon.name, "은는")} 얼음에 걸리지 않는다!`]
  pokemon.status = status
  return [`${pokemon.name}${josa(pokemon.name, "은는")} ${statusName(status)} 상태가 됐다!`]
}

export function applyVolatile(pokemon, volatile) {
  if (pokemon.hp <= 0) return []
  if (volatile === "혼란") {
    if ((pokemon.confusion ?? 0) > 0) return []
    pokemon.confusion = Math.floor(Math.random() * 3) + 1
    return [`${pokemon.name}${josa(pokemon.name, "은는")} 혼란에 빠졌다!`]
  }
  if (volatile === "풀죽음") {
    if (pokemon.flinch) return []
    pokemon.flinch = true
    return [`${pokemon.name}${josa(pokemon.name, "은는")} 풀이 죽었다!`]
  }
  return []
}

export function applyMoveEffect(moveEffect, attacker, defender, damage = 0) {
  if (!moveEffect) return []
  const msgs = []

  // 흡수
  if (moveEffect.drain) {
    const heal = Math.floor(damage * moveEffect.drain)
    if (heal > 0) {
      attacker.hp = Math.min(attacker.maxHp ?? attacker.hp, attacker.hp + heal)
      msgs.push(`${attacker.name}${josa(attacker.name, "은는")} 체력을 흡수했다! (+${heal})`)
    }
    return msgs
  }

  // HP 회복 (태만함 / HP회복)
  if (moveEffect.heal) {
    const heal = Math.max(1, Math.floor((attacker.maxHp ?? attacker.hp) * moveEffect.heal))
    attacker.hp = Math.min(attacker.maxHp ?? attacker.hp, attacker.hp + heal)
    msgs.push(`${attacker.name}${josa(attacker.name, "은는")} HP를 회복했다! (+${heal})`)
    return msgs
  }

  if (defender.hp <= 0) return []

  // 불꽃세례: 얼음 해제
  if (moveEffect.thawEnemy && defender.status === "frozen") {
    defender.status = null
    msgs.push(`${defender.name}${josa(defender.name, "은는")} 얼음 상태에서 회복됐다!`)
  }

  // 상태이상 부여
  if (moveEffect.status && Math.random() < moveEffect.chance) {
    msgs.push(...applyStatus(defender, moveEffect.status))
  }

  // 상태변화 부여
  if (moveEffect.volatile && Math.random() < moveEffect.chance) {
    msgs.push(...applyVolatile(defender, moveEffect.volatile))
  }

  return msgs
}

export function checkPreActionStatus(pokemon) {
  const msgs = []
  if (pokemon.flinch) {
    pokemon.flinch = false
    msgs.push(`${pokemon.name}${josa(pokemon.name, "은는")} 풀이 죽어서 움직일 수 없다!`)
    return { blocked: true, msgs, statusCleared: false }
  }
  if (pokemon.status === "paralysis") {
    if (Math.random() < 0.25) {
      msgs.push(`${pokemon.name}${josa(pokemon.name, "은는")} 몸이 저려서 움직일 수 없다!`)
      return { blocked: true, msgs, statusCleared: false }
    }
  }
  if (pokemon.status === "frozen") {
    if (Math.random() < 0.20) {
      pokemon.status = null
      msgs.push(`${pokemon.name}${josa(pokemon.name, "은는")} 얼음 상태에서 회복됐다!`)
      return { blocked: false, msgs, statusCleared: true }
    } else {
      msgs.push(`${pokemon.name}${josa(pokemon.name, "은는")} 꽁꽁 얼어서 움직일 수 없다!`)
      return { blocked: true, msgs, statusCleared: false }
    }
  }
  return { blocked: false, msgs, statusCleared: false }
}

export function checkConfusion(pokemon) {
  if ((pokemon.confusion ?? 0) <= 0) {
    pokemon.confusion = 0
    return { selfHit: false, damage: 0, msgs: [], fainted: false }
  }
  pokemon.confusion--
  if (pokemon.confusion <= 0) {
    pokemon.confusion = 0
    return { selfHit: false, damage: 0, msgs: [], fainted: false }
  }
  if (Math.random() < 1 / 3) {
    const damage = (pokemon.attack ?? 3) * 2
    pokemon.hp = Math.max(0, pokemon.hp - damage)
    const msgs = [`${pokemon.name}${josa(pokemon.name, "은는")} 영문도 모른 채 자신을 공격했다! (${damage} 데미지)`]
    const fainted = pokemon.hp <= 0
    if (fainted) msgs.push(`${pokemon.name}${josa(pokemon.name, "은는")} 쓰러졌다!`)
    return { selfHit: true, damage, msgs, fainted }
  }
  return { selfHit: false, damage: 0, msgs: [], fainted: false }
}

// 턴 시작 시 각종 volatile 턴 수 감소
export function tickVolatiles(pokemon) {
  const msgs = []
  // 신비의부적
  if ((pokemon.amuletTurns ?? 0) > 0) {
    pokemon.amuletTurns--
    if (!pokemon.amuletTurns) msgs.push(`${pokemon.name}${josa(pokemon.name, "의")} 신비의 부적 효과가 사라졌다!`)
  }
  // 날개쉬기: 비행 타입 복원
  if ((pokemon.roostTurns ?? 0) > 0) {
    pokemon.roostTurns--
    if (!pokemon.roostTurns && pokemon._origType) {
      pokemon.type = pokemon._origType
      pokemon._origType = undefined
    }
  }
  // 방어 턴 수
  if ((pokemon.defendTurns ?? 0) > 0) {
    pokemon.defendTurns--
    if (!pokemon.defendTurns) pokemon.defending = false
  }
  // 희망사항 회복
  if ((pokemon.wishTurns ?? 0) > 0) {
    pokemon.wishTurns--
    if (!pokemon.wishTurns) {
      const heal = Math.max(1, Math.floor((pokemon.maxHp ?? pokemon.hp) * 0.12))
      pokemon.hp = Math.min(pokemon.maxHp ?? pokemon.hp, pokemon.hp + heal)
      msgs.push(`${pokemon.name}${josa(pokemon.name, "은는")} 희망사항으로 HP를 회복했다! (+${heal})`)
    }
  }
  return msgs
}

// 씨뿌리기 EOT: seeder entry 배열에서 회복
// entries[0] = 씨 심은 쪽, entries[1] = 씨 당한 쪽
export function applyLeechSeed(seederEntry, seederActiveIdx, seededEntry, seededActiveIdx) {
  const seeder = seederEntry[seederActiveIdx]
  const seeded = seededEntry[seededActiveIdx]
  if (!seeded || !seeded.seeded) return []
  if (seeded.hp <= 0) return []
  const dmg = Math.max(1, Math.floor((seeded.maxHp ?? seeded.hp) * 0.1))
  seeded.hp = Math.max(0, seeded.hp - dmg)
  if (seeder && seeder.hp > 0) {
    seeder.hp = Math.min(seeder.maxHp ?? seeder.hp, seeder.hp + dmg)
  }
  const msgs = [`씨뿌리기가 ${seeded.name}${josa(seeded.name, "의")} 체력을 빼앗는다!`]
  if (seeded.hp <= 0) msgs.push(`${seeded.name}${josa(seeded.name, "은는")} 쓰러졌다!`)
  return msgs
}

export function applyEndOfTurnDamage(entries) {
  const msgs = []
  let anyFainted = false
  for (const entry of entries) {
    for (const pkmn of entry) {
      if (pkmn.hp <= 0) continue
      if (pkmn.status !== "poison" && pkmn.status !== "burn") continue
      const dmg = Math.max(1, Math.floor((pkmn.maxHp ?? pkmn.hp) / 16))
      pkmn.hp = Math.max(0, pkmn.hp - dmg)
      msgs.push(`${pkmn.name}${josa(pkmn.name, "은는")} ${statusName(pkmn.status)} 때문에 ${dmg} 데미지를 입었다!`)
      if (pkmn.hp <= 0) { msgs.push(`${pkmn.name}${josa(pkmn.name, "은는")} 쓰러졌다!`); anyFainted = true }
    }
  }
  return { msgs, anyFainted }
}

export function applyWeatherEffect(moveEffect) {
  if (!moveEffect?.weather) return { weather: null, msgs: [] }
  return { weather: moveEffect.weather, msgs: [`날씨가 ${moveEffect.weather}(으)로 바뀌었다!`] }
}

export function getStatusSpdPenalty(pokemon) {
  if (pokemon.status === "paralysis") return 1
  if (pokemon.status === "frozen") return 3
  return 0
}