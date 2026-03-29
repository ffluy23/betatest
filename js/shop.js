// js/shop.js

import { auth, db } from "./firebase.js"
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js"
import {
  doc, getDoc, updateDoc, setDoc, collection,
  query, where, getDocs, arrayUnion, arrayRemove, increment
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js"

// ══════════════════════════════════════════════════════
//  칭호 풀 & 확률
// ══════════════════════════════════════════════════════

// S급 (합계 2%)
const TITLES_S = [
  { name: "제니스 아카데미 1짱", rate: 0.01 },
  { name: "정복자",              rate: 0.01 },
]

// A급 (합계 8%)
const TITLES_A = [
  { name: "마스터 트레이너", rate: 0.02 },
  { name: "심판자",          rate: 0.02 },
  { name: "영웅",            rate: 0.02 },
  { name: "엘리트 트레이너", rate: 0.02 },
]

// B급 (합계 5%)
const TITLES_B = [
  { name: "달인",   rate: 0.025 },
  { name: "마스터", rate: 0.025 },
]

// 일반 (나머지 85% 균등 분배)
const TITLES_NORMAL = [
  "반바지 꼬마", "곤충채집 소년", "강태공", "연구원", "새 조련사",
  "신사", "포켓몬 매니아", "태권왕", "초능력자", "갬블러",
  "맹수 조련사", "빈 집 전문털이범", "폭주족", "빡빡이", "화가",
  "애호가클럽", "경찰관", "기타리스트", "무당", "사물놀이꾼",
  "자칭 선생님", "수행자", "도련님", "아기씨", "아로마 아가씨",
  "오컬트마니아", "포켓몬 컬렉터", "곤충마니아", "드래곤 조련사",
  "무서운 아저씨", "무서운 아가씨", "마담", "작업원", "베테랑 트레이너",
  "메이드", "아이돌", "예술가", "웨이터", "웨이트리스", "포켓몬놀이",
  "피에로", "댄서", "파일럿", "메르헨 소녀", "무슈", "배드가이",
  "배드걸", "스카이 트레이너", "스쿨보이", "스쿨걸", "오너",
  "요리사", "집사", "스포츠소년", "스포츠소녀", "슈퍼맨", "포켓센 아가씨",
  "모델", "마스터 도장 문하생", "비즈니스 파트너", "의료팀",
  "체육관 트레이너", "학생", "바보", "깜찍이", "핫삼을 닮았삼!",
  "야생마", "배틀광", "인터넷 고인물", "포핀 장수", "뉴비",
  "천사", "악마", "필멸자", "말썽꾼", "외계인", "폼잡기",
  "먹고자",
]

const GRADE_LABEL = { S: "✨ S급", A: "🌟 A급", B: "⭐ B급", N: "일반" }
const GRADE_COLOR = { S: "#FFD700", A: "#FF8C00", B: "#88AAFF", N: "#555" }

/** 가중 랜덤 뽑기 → { name, grade } */
function drawTitle() {
  const rarePool = [
    ...TITLES_S.map(t => ({ ...t, grade: "S" })),
    ...TITLES_A.map(t => ({ ...t, grade: "A" })),
    ...TITLES_B.map(t => ({ ...t, grade: "B" })),
  ]
  const rareTotal   = rarePool.reduce((acc, t) => acc + t.rate, 0) // 0.15
  const normalRate  = (1 - rareTotal) / TITLES_NORMAL.length

  const pool = [
    ...rarePool,
    ...TITLES_NORMAL.map(name => ({ name, rate: normalRate, grade: "N" })),
  ]

  const rand = Math.random()
  let cum = 0
  for (const entry of pool) {
    cum += entry.rate
    if (rand < cum) return { name: entry.name, grade: entry.grade }
  }
  return { name: TITLES_NORMAL[0], grade: "N" }
}

/** 칭호 이름으로 등급 조회 */
function getTitleGrade(name) {
  if (!name) return null
  if (TITLES_S.some(t => t.name === name)) return "S"
  if (TITLES_A.some(t => t.name === name)) return "A"
  if (TITLES_B.some(t => t.name === name)) return "B"
  return "N"
}

// ══════════════════════════════════════════════════════
//  조사 유틸
// ══════════════════════════════════════════════════════
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

// ══════════════════════════════════════════════════════
//  포핀 색상
// ══════════════════════════════════════════════════════
const POPPIN_COLOR = {
  perfect: '#FFD700', sweet: '#FF8FB1', spicy: '#FF4500',
  dry: '#6B9FFF', bitter: '#4CAF50', sour: '#FFE44A',
  mild: '#F5C842', burnt: '#888888', bad: '#AAAAAA'
}

// ══════════════════════════════════════════════════════
//  상태
// ══════════════════════════════════════════════════════
let myUid  = null
let myData = null

let foundUserUid      = null
let foundUserNickname = null

let giftTargetObj     = null
let giftFoundUid      = null
let giftFoundNickname = null

// ══════════════════════════════════════════════════════
//  탭 전환
// ══════════════════════════════════════════════════════
window.switchTab = function(tab, btnEl) {
  document.querySelectorAll(".tab-content").forEach(el => el.classList.remove("active"))
  document.querySelectorAll(".tab-btn").forEach(el => el.classList.remove("active"))
  document.getElementById(`tab-${tab}`).classList.add("active")
  btnEl.classList.add("active")
  if (tab === "inventory") renderInventory()
  if (tab === "title")     renderTitle()
}

// ══════════════════════════════════════════════════════
//  유틸
// ══════════════════════════════════════════════════════
function showToast(msg, duration = 2500) {
  const t = document.getElementById("toast")
  t.innerText = msg
  t.classList.add("show")
  setTimeout(() => t.classList.remove("show"), duration)
}

function updateCoinDisplay() {
  document.getElementById("user-coins").innerText =
    `💰 ZP: ${(myData?.coins ?? 0).toLocaleString()}`
}

async function spendCoins(amount) {
  const current = myData?.coins ?? 0
  if (current < amount) { showToast("ZP가 부족해!"); return false }
  await updateDoc(doc(db, "users", myUid), { coins: increment(-amount) })
  myData.coins = current - amount
  updateCoinDisplay()
  return true
}

// ══════════════════════════════════════════════════════
//  일반 모달 열기/닫기
// ══════════════════════════════════════════════════════
window.openModal = function(type) {
  if (type === "title") {
    document.getElementById("gacha-result").className = ""
    document.getElementById("gacha-result").innerText = ""
    document.getElementById("gacha-btn").disabled = false
  }
  if (type === "ring") {
    document.getElementById("ring-result").innerText = ""
    document.getElementById("ring-search").value = ""
    document.getElementById("ring-confirm-btn").disabled = true
    foundUserUid = null; foundUserNickname = null
  }
  if (type === "note") {
    document.getElementById("note-result").innerText = ""
    document.getElementById("note-search").value = ""
    document.getElementById("note-text").value = ""
    document.getElementById("note-confirm-btn").disabled = true
    foundUserUid = null; foundUserNickname = null
  }
  document.getElementById(`modal-${type}`).classList.add("open")
}

window.closeModal = function(type) {
  document.getElementById(`modal-${type}`).classList.remove("open")
}

// ══════════════════════════════════════════════════════
//  유저 검색 (우정반지 / 쪽지 공용)
// ══════════════════════════════════════════════════════
window.searchUser = async function(type) {
  const inputId      = type === "ring" ? "ring-search"      : "note-search"
  const resultId     = type === "ring" ? "ring-result"      : "note-result"
  const confirmBtnId = type === "ring" ? "ring-confirm-btn" : "note-confirm-btn"
  const nickname = document.getElementById(inputId).value.trim()
  if (!nickname) { showToast("이름을 입력해줘!"); return }

  const q    = query(collection(db, "users"), where("nickname", "==", nickname))
  const snap = await getDocs(q)
  const resultEl = document.getElementById(resultId)

  if (snap.empty) {
    resultEl.innerText = "그런 사람은 아카데미에 없어..."
    document.getElementById(confirmBtnId).disabled = true
    foundUserUid = null; foundUserNickname = null
    return
  }
  const found = snap.docs[0]
  if (found.id === myUid) {
    resultEl.innerText = "자기 자신에게는 보낼 수 없어!"
    document.getElementById(confirmBtnId).disabled = true
    foundUserUid = null; foundUserNickname = null
    return
  }
  foundUserUid      = found.id
  foundUserNickname = found.data().nickname
  resultEl.innerText = `✅ ${foundUserNickname} 찾았어!`
  document.getElementById(confirmBtnId).disabled = false
}

// ══════════════════════════════════════════════════════
//  구매: 우정반지
// ══════════════════════════════════════════════════════
window.buyRing = async function() {
  if (!foundUserUid) return
  const ok = await spendCoins(2500)
  if (!ok) return

  const now = Date.now()
  const myRingItem = {
    type: "friendship_ring",
    withUid: foundUserUid,
    withNickname: foundUserNickname,
    status: "pending",
    at: now
  }
  const request = { fromUid: myUid, fromNickname: myData.nickname, at: now }

  const inboxRingItem = {
    type: "ring_request",
    fromUid: myUid,
    fromNickname: myData.nickname,
    at: now,
    read: false,
  }

  await updateDoc(doc(db, "users", myUid), { inventory: arrayUnion(myRingItem) })
  await setDoc(doc(db, "users", foundUserUid), {
    ringRequests: arrayUnion(request),
    inbox: arrayUnion(inboxRingItem),
  }, { merge: true })

  showToast(`💍 ${foundUserNickname}에게 우정반지를 보냈어! 상대방의 수락을 기다려봐.`)
  closeModal("ring")
}

// ══════════════════════════════════════════════════════
//  구매: 랜덤 칭호 (등급제 + 누적 + 중복 시 50ZP 반환)
// ══════════════════════════════════════════════════════
window.buyTitle = async function() {
  const ok = await spendCoins(500)
  if (!ok) return

  document.getElementById("gacha-btn").disabled = true

  const { name: picked, grade } = drawTitle()

  // 현재 보유 칭호 목록 확인
  const snap        = await getDoc(doc(db, "users", myUid))
  const ownedTitles = snap.data()?.titles ?? []
  const isDuplicate = ownedTitles.includes(picked)

  const updates = {}

  if (isDuplicate) {
    // 중복 → 50ZP 반환, 칭호 목록 변경 없음
    await updateDoc(doc(db, "users", myUid), { coins: increment(50) })
    myData.coins = (myData.coins ?? 0) + 50
    updateCoinDisplay()
  } else {
    // 신규 → titles 배열에 추가, activeTitle이 없으면 자동 장착
    updates.titles = arrayUnion(picked)
    if (!snap.data()?.activeTitle) updates.activeTitle = picked
    await updateDoc(doc(db, "users", myUid), updates)
    myData.titles     = [...ownedTitles, picked]
    myData.activeTitle = snap.data()?.activeTitle || picked
  }

  // 결과 표시
  const resultEl   = document.getElementById("gacha-result")
  const gradeColor = GRADE_COLOR[grade]
  const gradeLabel = GRADE_LABEL[grade]
  const isRare     = grade !== "N"

  resultEl.className = "show"

  if (isDuplicate) {
    resultEl.innerHTML = `
      ${isRare
        ? `<div style="font-size:11px;font-weight:bold;color:${gradeColor};letter-spacing:1px;margin-bottom:4px;">${gradeLabel}</div>`
        : ""}
      <div style="font-size:17px;font-weight:bold;color:${gradeColor};">[${picked}]</div>
      <div style="font-size:13px;color:#e07b00;margin-top:8px;font-weight:bold;">이미 보유 중! 💰 50ZP 반환</div>
    `
  } else {
    resultEl.innerHTML = `
      ${isRare
        ? `<div style="font-size:11px;font-weight:bold;color:${gradeColor};letter-spacing:1px;margin-bottom:4px;">${gradeLabel}</div>`
        : ""}
      <div style="font-size:17px;font-weight:bold;color:${gradeColor};">[${picked}]</div>
      <div style="font-size:13px;color:#555;margin-top:6px;">새 칭호 획득!</div>
      ${grade === "S" ? `<div style="font-size:22px;margin-top:4px;">🎊</div>`
      : grade === "A" ? `<div style="font-size:22px;margin-top:4px;">🎉</div>`
      : grade === "B" ? `<div style="font-size:22px;margin-top:4px;">✨</div>`
      : ""}
    `
  }
}

// ══════════════════════════════════════════════════════
//  구매: 익명 쪽지
// ══════════════════════════════════════════════════════
window.buyNote = async function() {
  if (!foundUserUid) return
  const text = document.getElementById("note-text").value.trim()
  if (!text) { showToast("쪽지 내용을 입력해줘!"); return }

  const ok = await spendCoins(300)
  if (!ok) return

  const noteItem = { type: "note", text, at: Date.now(), read: false }
  await setDoc(doc(db, "users", foundUserUid), { inbox: arrayUnion(noteItem) }, { merge: true })

  showToast(`📨 ${foundUserNickname}에게 쪽지${josa("쪽지", "을를")} 보냈어!`)
  closeModal("note")
}

// ══════════════════════════════════════════════════════
//  구매: 랜덤 요리 재료
// ══════════════════════════════════════════════════════
window.buyIngredient = async function() {
  const ok = await spendCoins(200)
  if (!ok) return

  const isGood = Math.random() < 0.7
  const name   = isGood ? "좋은 조미료" : "이상한 조미료"
  const item   = { type: "ingredient", name, at: Date.now() }
  await updateDoc(doc(db, "users", myUid), { inventory: arrayUnion(item) })

  closeModal("ingredient")
  showToast(isGood ? `🧂 ${name}${josa(name, "을를")} 획득!` : `🫙 ${name}${josa(name, "을를")} 획득... (어째서)`)
}

// ══════════════════════════════════════════════════════
//  가방 렌더
// ══════════════════════════════════════════════════════
async function renderInventory() {
  const snap  = await getDoc(doc(db, "users", myUid))
  const items = snap.data()?.inventory ?? []
  const el    = document.getElementById("inventory-list")

  if (items.length === 0) { el.innerHTML = "<p>가방이 비어있어.</p>"; return }

  el.innerHTML = ""
  const sorted = items
    .map((item, originalIndex) => ({ item, originalIndex }))
    .sort((a, b) => (b.item.at ?? 0) - (a.item.at ?? 0))

  sorted.forEach(({ item, originalIndex }) => {
    const div  = document.createElement("div")
    const date = item.at
      ? new Date(item.at).toLocaleString("ko-KR", {
          month:"numeric", day:"numeric", hour:"2-digit", minute:"2-digit"
        })
      : ""

    if (item.type === "friendship_ring") {
      const statusText = item.status === "pending"
        ? ` <span style="color:#aaa;font-size:12px;">(수락 대기 중)</span>`
        : ""
      div.innerHTML = `💍 우정반지 — <strong>${item.withNickname}</strong>${josa(item.withNickname, "과와")}${statusText} · ${date}`

    } else if (item.type === "ingredient") {
      div.className = "inv-item-giftable"
      div.innerHTML = `
        🧂 ${item.name} · ${date}
        <span style="font-size:11px;color:#bbb;margin-left:6px;">탭해서 선물</span>
      `
      div.addEventListener("click", () => openGiftModal(item, originalIndex))

    } else if (item.type === "poppin") {
      const color   = POPPIN_COLOR[item.pType] ?? "#aaa"
      const imgHtml = item.img
        ? `<img src="${item.img}" alt="${item.name}"
             style="width:28px;height:28px;object-fit:contain;vertical-align:middle;image-rendering:pixelated;">`
        : `<span style="font-size:15px;">🧁</span>`
      div.className = "inv-item-giftable"
      div.innerHTML = `
        ${imgHtml}
        <strong style="color:${color};">${item.name}</strong>
        <span style="color:#999;font-size:12px;"> · ${date}</span>
        <span style="font-size:11px;color:#bbb;margin-left:6px;">탭해서 선물</span>
      `
      div.addEventListener("click", () => openGiftModal(item, originalIndex))

    } else {
      div.innerHTML = `📦 ${item.type} · ${date}`
    }

    el.appendChild(div)
  })
}

// ══════════════════════════════════════════════════════
//  칭호 탭 렌더 (누적 목록 + 장착 전환)
// ══════════════════════════════════════════════════════
async function renderTitle() {
  const snap        = await getDoc(doc(db, "users", myUid))
  const active      = snap.data()?.activeTitle ?? null
  const ownedTitles = snap.data()?.titles ?? []
  const el          = document.getElementById("title-display")

  if (ownedTitles.length === 0) {
    el.innerHTML = "<p>아직 칭호가 없어. 매점에서 뽑아봐!</p>"
    return
  }

  // 현재 장착 중 칭호 표시
  let headerHtml = ""
  if (active) {
    const grade      = getTitleGrade(active)
    const gradeColor = GRADE_COLOR[grade]
    const gradeLabel = GRADE_LABEL[grade]
    const isRare     = grade !== "N"
    headerHtml = `
      <div style="margin-bottom:16px;padding:10px 12px;background:#f9f9f9;border-radius:8px;">
        <span style="font-size:12px;color:#999;">장착 중</span><br>
        ${isRare ? `<span style="font-size:11px;font-weight:bold;color:${gradeColor};">${gradeLabel} </span>` : ""}
        <strong style="color:${gradeColor};">[${active}]</strong>
      </div>
    `
  }

  // 보유 칭호 목록 (알파벳/가나다 정렬은 뽑은 순 유지)
  const listHtml = ownedTitles.map(title => {
    const grade      = getTitleGrade(title)
    const gradeColor = GRADE_COLOR[grade]
    const gradeLabel = GRADE_LABEL[grade]
    const isRare     = grade !== "N"
    const isActive   = title === active

    return `
      <div class="title-item ${isActive ? "title-active" : ""}"
           onclick="equipTitle('${title.replace(/'/g, "\\'")}')">
        <span>
          ${isRare ? `<span style="font-size:11px;font-weight:bold;color:${gradeColor};margin-right:3px;">${gradeLabel}</span>` : ""}
          <span style="color:${gradeColor};font-weight:${isRare ? "bold" : "normal"};">[${title}]</span>
        </span>
        ${isActive
          ? `<span class="title-equipped-badge">장착 중</span>`
          : `<span class="title-equip-btn">장착</span>`
        }
      </div>
    `
  }).join("")

  el.innerHTML = headerHtml + `<div class="title-list">${listHtml}</div>`
}

// ══════════════════════════════════════════════════════
//  칭호 장착
// ══════════════════════════════════════════════════════
window.equipTitle = async function(title) {
  try {
    await updateDoc(doc(db, "users", myUid), { activeTitle: title })
    myData.activeTitle = title
    showToast(`[${title}] 칭호를 장착했어!`)
    renderTitle()
  } catch(e) {
    console.error(e)
    showToast("칭호 장착 실패... 다시 해봐")
  }
}

// ══════════════════════════════════════════════════════
//  선물 모달
// ══════════════════════════════════════════════════════
window.openGiftModal = function(item, originalIndex) {
  giftTargetObj     = item
  giftFoundUid      = null
  giftFoundNickname = null

  let itemHtml = ""
  if (item.type === "ingredient") {
    itemHtml = `<p>🧂 <strong>${item.name}</strong></p>`
  } else if (item.type === "poppin") {
    const color   = POPPIN_COLOR[item.pType] ?? "#aaa"
    const imgHtml = item.img
      ? `<img src="${item.img}" alt="${item.name}"
           style="width:40px;height:40px;object-fit:contain;vertical-align:middle;image-rendering:pixelated;">`
      : "🧁"
    itemHtml = `<p>${imgHtml} <strong style="color:${color};">${item.name}</strong></p>`
  }

  document.getElementById("gift-item-info").innerHTML = itemHtml
  document.getElementById("gift-search").value = ""
  document.getElementById("gift-result").innerText = ""
  document.getElementById("gift-confirm-btn").disabled = true
  document.getElementById("modal-gift").classList.add("open")
}

window.closeGiftModal = function() {
  document.getElementById("modal-gift").classList.remove("open")
}

window.searchGiftUser = async function() {
  const nickname = document.getElementById("gift-search").value.trim()
  if (!nickname) { showToast("이름을 입력해줘!"); return }

  const q    = query(collection(db, "users"), where("nickname", "==", nickname))
  const snap = await getDocs(q)
  const resultEl = document.getElementById("gift-result")

  if (snap.empty) {
    resultEl.innerText = "그런 사람은 아카데미에 없어..."
    document.getElementById("gift-confirm-btn").disabled = true
    giftFoundUid = null; giftFoundNickname = null
    return
  }
  const found = snap.docs[0]
  if (found.id === myUid) {
    resultEl.innerText = "자기 자신에게는 보낼 수 없어!"
    document.getElementById("gift-confirm-btn").disabled = true
    giftFoundUid = null; giftFoundNickname = null
    return
  }
  giftFoundUid      = found.id
  giftFoundNickname = found.data().nickname
  resultEl.innerText = `✅ ${giftFoundNickname} 찾았어!`
  document.getElementById("gift-confirm-btn").disabled = false
}

window.sendGift = async function() {
  if (!giftFoundUid || !giftTargetObj) return

  const giftPayload = {
    type:         "gift",
    item:         giftTargetObj,
    fromNickname: myData.nickname ?? "익명",
    at:           Date.now(),
    read:         false,
  }

  try {
    await setDoc(
      doc(db, "users", giftFoundUid),
      { inbox: arrayUnion(giftPayload) },
      { merge: true }
    )
    await updateDoc(doc(db, "users", myUid), { inventory: arrayRemove(giftTargetObj) })

    showToast(`🎁 ${giftFoundNickname}에게 선물${josa("선물", "을를")} 보냈어!`)
    closeGiftModal()
    renderInventory()
  } catch(e) {
    console.error(e)
    showToast("선물 전송 실패... 다시 해봐")
  }
}

// ══════════════════════════════════════════════════════
//  초기 로드
// ══════════════════════════════════════════════════════
onAuthStateChanged(auth, async user => {
  if (!user) { location.href = "../index.html"; return }
  myUid = user.uid
  const snap = await getDoc(doc(db, "users", myUid))
  myData = snap.data()
  updateCoinDisplay()
})
