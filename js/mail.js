import { auth, db } from "./firebase.js"
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js"
import {
  doc, getDoc, updateDoc,
  arrayUnion, arrayRemove
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js"

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
//  상수
// ══════════════════════════════════════════════════════
const POPPIN_COLOR = {
  perfect: '#FFD700', sweet: '#FF8FB1', spicy: '#FF4500',
  dry: '#6B9FFF', bitter: '#4CAF50', sour: '#FFE44A',
  mild: '#F5C842', burnt: '#888888', bad: '#AAAAAA', poppin: '#FFB6C1'
}

// 메일 타입별 아이콘 & 아이콘 클래스
const MAIL_META = {
  note:         { icon: '📨', cls: 'type-note'   },
  letter:       { icon: '✉️',  cls: 'type-letter' },
  ring_request: { icon: '💍', cls: 'type-ring'   },
  gift:         { icon: '🎁', cls: 'type-gift'   },
}

// ══════════════════════════════════════════════════════
//  상태
// ══════════════════════════════════════════════════════
let myUid  = null
let myData = null
let currentRingMailItem = null
let currentGiftMailItem = null

// ══════════════════════════════════════════════════════
//  토스트
// ══════════════════════════════════════════════════════
function showToast(msg, duration = 2500) {
  const t = document.getElementById("toast")
  t.innerText = msg
  t.classList.add("show")
  setTimeout(() => t.classList.remove("show"), duration)
}

// ══════════════════════════════════════════════════════
//  날짜 포맷
// ══════════════════════════════════════════════════════
function formatDate(ts, short = true) {
  if (!ts) return ""
  return new Date(ts).toLocaleString("ko-KR", short
    ? { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }
    : undefined
  )
}

// ══════════════════════════════════════════════════════
//  모달 닫기
// ══════════════════════════════════════════════════════
window.closeNoteModal   = () => document.getElementById("modal-note-view").classList.remove("open")
window.closeLetterModal = () => document.getElementById("modal-letter-view").classList.remove("open")
window.closeGiftModal   = () => {
  document.getElementById("modal-gift-view").classList.remove("open")
  currentGiftMailItem = null
}

// 오버레이 클릭으로 닫기
document.querySelectorAll(".modal-overlay").forEach(el => {
  el.addEventListener("click", e => { if (e.target === el) el.classList.remove("open") })
})

// ══════════════════════════════════════════════════════
//  메일함 렌더
// ══════════════════════════════════════════════════════
async function renderMail() {
  const snap = await getDoc(doc(db, "users", myUid))
  myData = snap.data()
  const inbox  = myData?.inbox ?? []
  const listEl = document.getElementById("mail-list")

  // 안읽음 카운트 & 서브타이틀 업데이트
  const unreadCount = inbox.filter(i => !i.read).length
  const subtitleEl  = document.getElementById("mail-subtitle")
  const countEl     = document.getElementById("unread-count")

  if (subtitleEl) subtitleEl.textContent = `총 ${inbox.length}개${unreadCount > 0 ? ` · 안읽음 ${unreadCount}개` : ''}`
  if (countEl) {
    if (unreadCount > 0) { countEl.textContent = unreadCount; countEl.style.display = '' }
    else                 { countEl.style.display = 'none' }
  }

  if (inbox.length === 0) {
    listEl.innerHTML = `
      <div class="mail-empty">
        <div class="mail-empty-icon">📭</div>
        <div class="mail-empty-text">메일함이 비어있어요.</div>
      </div>`
    return
  }

  listEl.innerHTML = ""

  const sorted = inbox
    .map((item, i) => ({ item, i }))
    .sort((a, b) => (b.item.at ?? 0) - (a.item.at ?? 0))

  sorted.forEach(({ item }) => {
    const meta = MAIL_META[item.type] ?? { icon: '📩', cls: '' }
    const date = formatDate(item.at)

    let titleHtml = ""
    if (item.type === "note") {
      titleHtml = "익명의 쪽지"
    } else if (item.type === "letter") {
      titleHtml = `<strong>${item.fromName ?? "익명"}</strong>의 편지 — ${item.title ?? "(제목 없음)"}`
    } else if (item.type === "ring_request") {
      titleHtml = `<strong>${item.fromNickname}</strong>${josa(item.fromNickname, "이가")} 우정반지를 보냈어요`
    } else if (item.type === "gift") {
      const gItem = item.item ?? {}
      let giftLabel = "알 수 없는 아이템"
      if (gItem.type === "ingredient")   giftLabel = `🧂 ${gItem.name}`
      else if (gItem.type === "poppin")  giftLabel = `🧁 ${gItem.name}`
      else if (gItem.type === "title_ticket") giftLabel = `📃 ${gItem.name}`
      titleHtml = `<strong>${item.fromNickname}</strong>의 선물 — ${giftLabel}`
    } else {
      titleHtml = "알 수 없는 메일"
    }

    const div = document.createElement("div")
    div.className = `mail-item ${item.read ? "read" : "unread"}`
    div.innerHTML = `
      <div class="mail-icon ${meta.cls}">${meta.icon}</div>
      <div class="mail-item-body">
        <div class="mail-item-title">${titleHtml}</div>
        <div class="mail-item-meta">${date}</div>
      </div>
      <span class="mail-arrow">›</span>
    `

    if (item.type === "note")         div.addEventListener("click", () => openNoteModal(item))
    else if (item.type === "letter")  div.addEventListener("click", () => openLetterModal(item))
    else if (item.type === "ring_request") div.addEventListener("click", () => openRingRequestModal(item))
    else if (item.type === "gift")    div.addEventListener("click", () => openGiftViewModal(item))

    listEl.appendChild(div)
  })
}

// ══════════════════════════════════════════════════════
//  읽음 처리
// ══════════════════════════════════════════════════════
async function markRead(item) {
  if (item.read) return
  const updated = { ...item, read: true }
  try {
    await updateDoc(doc(db, "users", myUid), { inbox: arrayRemove(item) })
    await updateDoc(doc(db, "users", myUid), { inbox: arrayUnion(updated) })
    item.read = true
  } catch(e) {
    console.warn("읽음 처리 실패", e)
  }
}

// ══════════════════════════════════════════════════════
//  쪽지 모달
// ══════════════════════════════════════════════════════
function openNoteModal(item) {
  document.getElementById("note-view-text").innerText = item.text ?? "(내용 없음)"
  document.getElementById("note-view-date").innerText = formatDate(item.at, false)
  document.getElementById("modal-note-view").classList.add("open")
  markRead(item)
}

// ══════════════════════════════════════════════════════
//  편지 모달
// ══════════════════════════════════════════════════════
function openLetterModal(item) {
  document.getElementById("letter-view-from").innerText  = `보낸 사람: ${item.fromName ?? "익명"}`
  document.getElementById("letter-view-title").innerText = item.title ?? "(제목 없음)"
  document.getElementById("letter-view-text").innerText  = item.text  ?? "(내용 없음)"
  document.getElementById("letter-view-date").innerText  = formatDate(item.at, false)
  document.getElementById("modal-letter-view").classList.add("open")
  markRead(item)
}

// ══════════════════════════════════════════════════════
//  우정반지 모달
// ══════════════════════════════════════════════════════
function openRingRequestModal(item) {
  currentRingMailItem = item
  document.getElementById("ring-req-from").innerText =
    `${item.fromNickname}${josa(item.fromNickname, "이가")} 우정반지를 보냈어요!`
  document.getElementById("modal-ring-request").classList.add("open")
  markRead(item)
}

window.acceptRing = async function() {
  if (!currentRingMailItem) return
  const mailItem = currentRingMailItem
  try {
    const ringItem = {
      type: "friendship_ring",
      withUid: mailItem.fromUid,
      withNickname: mailItem.fromNickname,
      status: "accepted",
      at: Date.now(),
    }
    await updateDoc(doc(db, "users", myUid), { inventory: arrayUnion(ringItem) })
    await updateDoc(doc(db, "users", myUid), { inbox: arrayRemove(mailItem) })

    const senderSnap = await getDoc(doc(db, "users", mailItem.fromUid))
    const senderInv  = senderSnap.data()?.inventory ?? []
    const oldRing    = senderInv.find(
      i => i.type === "friendship_ring" && i.withUid === myUid && i.status === "pending"
    )
    if (oldRing) {
      const newRing = { ...oldRing, status: "accepted" }
      await updateDoc(doc(db, "users", mailItem.fromUid), { inventory: arrayRemove(oldRing) })
      await updateDoc(doc(db, "users", mailItem.fromUid), { inventory: arrayUnion(newRing) })
    }

    showToast(`💍 ${mailItem.fromNickname}${josa(mailItem.fromNickname, "과와")}의 우정반지를 수락했어요!`)
    document.getElementById("modal-ring-request").classList.remove("open")
    currentRingMailItem = null
    await renderMail()
  } catch(e) {
    console.error(e)
    showToast("수락 실패... 다시 시도해 주세요")
  }
}

window.rejectRing = async function() {
  if (!currentRingMailItem) return
  const mailItem = currentRingMailItem
  try {
    await updateDoc(doc(db, "users", myUid), { inbox: arrayRemove(mailItem) })
    showToast("반지 요청을 거절했어요.")
    document.getElementById("modal-ring-request").classList.remove("open")
    currentRingMailItem = null
    await renderMail()
  } catch(e) {
    console.error(e)
    showToast("처리 실패...")
  }
}

// ══════════════════════════════════════════════════════
//  선물 모달
// ══════════════════════════════════════════════════════
function openGiftViewModal(item) {
  currentGiftMailItem = item
  const gItem = item.item ?? {}

  let infoHtml = `
    <p style="font-size:13px;color:var(--text-sub);margin-bottom:12px;">
      <strong>${item.fromNickname}</strong>${josa(item.fromNickname, "이가")} 선물을 보냈어요!
    </p>
  `

  if (gItem.type === "ingredient") {
    infoHtml += `<p style="font-size:20px;margin:0 0 4px;">🧂</p>
                 <p style="font-size:16px;font-weight:700;color:var(--text-main);margin:0;">${gItem.name}</p>`

  } else if (gItem.type === "poppin") {
    const color   = POPPIN_COLOR[gItem.pType] ?? "#aaa"
    const imgHtml = gItem.img
      ? `<img src="${gItem.img}" alt="${gItem.name}"
           style="width:72px;height:72px;object-fit:contain;image-rendering:pixelated;display:block;margin:0 auto 10px;">`
      : `<div style="font-size:48px;margin-bottom:10px;">🧁</div>`
    infoHtml += `${imgHtml}
      <p style="font-size:16px;font-weight:700;color:${color};margin:0;">${gItem.name}</p>`

  } else if (gItem.type === "title_ticket") {
    infoHtml += `
      <p style="font-size:20px;margin:0 0 6px;">📃</p>
      <p style="font-size:16px;font-weight:700;color:#7c5cfc;margin:0 0 6px;">${gItem.name}</p>
      <p style="font-size:12px;color:var(--text-sub);line-height:1.6;margin:0;">
        원하는 칭호를 하나 선택할 수 있어요.<br>커스텀 칭호도 가능해요.
      </p>`
  }

  if (item.message?.trim()) {
    infoHtml += `
      <div style="
        margin-top:14px; padding:10px 14px;
        background:var(--white); border:1px solid var(--gray-200);
        border-radius:var(--radius-sm); font-size:13px;
        line-height:1.7; color:var(--text-main);
        white-space:pre-wrap; word-break:break-all; text-align:left;
      ">${item.message}</div>`
  }

  document.getElementById("gift-view-info").innerHTML = infoHtml
  document.getElementById("modal-gift-view").classList.add("open")
  markRead(item)
}

window.acceptGift = async function() {
  if (!currentGiftMailItem) return
  const mailItem = currentGiftMailItem
  try {
    await updateDoc(doc(db, "users", myUid), { inventory: arrayUnion(mailItem.item) })
    await updateDoc(doc(db, "users", myUid), { inbox: arrayRemove(mailItem) })
    showToast("🎁 선물을 가방에 넣었어요!")
    closeGiftModal()
    await renderMail()
  } catch(e) {
    console.error(e)
    showToast("수락 실패... 다시 시도해 주세요")
  }
}

window.rejectGift = async function() {
  if (!currentGiftMailItem) return
  const mailItem = currentGiftMailItem
  try {
    await updateDoc(doc(db, "users", myUid), { inbox: arrayRemove(mailItem) })
    showToast("선물을 거절했어요.")
    closeGiftModal()
    await renderMail()
  } catch(e) {
    console.error(e)
    showToast("처리 실패...")
  }
}

// ══════════════════════════════════════════════════════
//  초기 로드
// ══════════════════════════════════════════════════════
onAuthStateChanged(auth, async user => {
  if (!user) { location.href = "../index.html"; return }
  myUid = user.uid
  await renderMail()
})