// js/mail.js

import { auth, db } from "./firebase.js"
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js"
import {
  doc, getDoc, updateDoc, setDoc,
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

// ══════════════════════════════════════════════════════
//  상태
// ══════════════════════════════════════════════════════
let myUid  = null
let myData = null

let currentGiftMailItem = null

// ══════════════════════════════════════════════════════
//  유틸
// ══════════════════════════════════════════════════════
function showToast(msg, duration = 2500) {
  const t = document.getElementById("toast")
  t.innerText = msg
  t.classList.add("show")
  setTimeout(() => t.classList.remove("show"), duration)
}

// ══════════════════════════════════════════════════════
//  모달 닫기
// ══════════════════════════════════════════════════════
window.closeNoteModal = function() {
  document.getElementById("modal-note-view").classList.remove("open")
}
window.closeGiftModal = function() {
  document.getElementById("modal-gift-view").classList.remove("open")
  currentGiftMailItem = null
}
window.closeLetterModal = function() {
  document.getElementById("modal-letter-view").classList.remove("open")
}

// ══════════════════════════════════════════════════════
//  메일함 렌더
// ══════════════════════════════════════════════════════
async function renderMail() {
  const snap = await getDoc(doc(db, "users", myUid))
  myData = snap.data()
  const inbox  = myData?.inbox ?? []
  const listEl = document.getElementById("mail-list")

  if (inbox.length === 0) {
    listEl.innerHTML = '<p class="empty-msg">메일함이 비어있어.</p>'
    return
  }

  listEl.innerHTML = '<div class="mail-box" id="mail-box"></div>'
  const boxEl = document.getElementById("mail-box")

  const sorted = inbox
    .map((item, i) => ({ item, i }))
    .sort((a, b) => (b.item.at ?? 0) - (a.item.at ?? 0))

  sorted.forEach(({ item, i }) => {
    const div  = document.createElement("div")
    const date = item.at
      ? new Date(item.at).toLocaleString("ko-KR", {
          month:"numeric", day:"numeric", hour:"2-digit", minute:"2-digit"
        })
      : ""

    if (item.type === "note") {
      div.className = `note-item ${item.read ? "read" : "unread"}`
      div.innerHTML = `📨 익명의 쪽지 · ${date}`
      div.addEventListener("click", () => openNoteModal(item, i))

    } else if (item.type === "letter") {
      div.className = `note-item ${item.read ? "read" : "unread"}`
      div.innerHTML = `✉️ <strong>${item.fromName ?? "익명"}</strong>의 편지: ${item.title ?? "(제목 없음)"} · ${date}`
      div.addEventListener("click", () => openLetterModal(item, i))

    } else if (item.type === "ring_request") {
      div.className = `note-item ${item.read ? "read" : "unread"}`
      div.innerHTML = `💍 <strong>${item.fromNickname}</strong>${josa(item.fromNickname, "이가")} 우정반지를 보냈어! · ${date}`
      div.addEventListener("click", () => openRingRequestModal(item, i))

    } else if (item.type === "gift") {
      const gItem = item.item ?? {}
      let label   = "📦 알 수 없는 아이템"
      if (gItem.type === "ingredient") {
        label = `🧂 ${gItem.name}`
      } else if (gItem.type === "poppin") {
        const color = POPPIN_COLOR[gItem.pType] ?? "#aaa"
        label = `🧁 <span style="color:${color};">${gItem.name}</span>`
      } else if (gItem.type === "title_ticket") {
        label = `📃 ${gItem.name}`
      }
      div.className = `note-item ${item.read ? "read" : "unread"}`
      div.innerHTML =
        `🎁 <strong>${item.fromNickname}</strong>${josa(item.fromNickname, "이가")} 선물을 보냈어: ${label} · ${date}`
      div.addEventListener("click", () => openGiftViewModal(item, i))

    } else {
      div.innerHTML = `📩 알 수 없는 메일 · ${date}`
    }

    boxEl.appendChild(div)
  })
}

// ══════════════════════════════════════════════════════
//  우정반지 요청 모달
// ══════════════════════════════════════════════════════
let currentRingMailItem = null

function openRingRequestModal(item, index) {
  currentRingMailItem = item
  document.getElementById("ring-req-from").innerText =
    `💍 ${item.fromNickname}${josa(item.fromNickname, "이가")} 우정반지를 보냈어!`
  document.getElementById("modal-ring-request").classList.add("open")
  if (!item.read) markRead(item, "ring_request")
}

window.closeRingRequestModal = function() {
  document.getElementById("modal-ring-request").classList.remove("open")
  currentRingMailItem = null
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
    const oldRing = senderInv.find(
      i => i.type === "friendship_ring" && i.withUid === myUid && i.status === "pending"
    )
    if (oldRing) {
      const newRing = { ...oldRing, status: "accepted" }
      await updateDoc(doc(db, "users", mailItem.fromUid), { inventory: arrayRemove(oldRing) })
      await updateDoc(doc(db, "users", mailItem.fromUid), { inventory: arrayUnion(newRing) })
    }
    showToast(`💍 ${mailItem.fromNickname}${josa(mailItem.fromNickname, "과와")}의 우정반지를 수락했어!`)
    closeRingRequestModal()
    await renderMail()
  } catch(e) {
    console.error(e)
    showToast("수락 실패... 다시 해봐")
  }
}

window.rejectRing = async function() {
  if (!currentRingMailItem) return
  const mailItem = currentRingMailItem
  try {
    await updateDoc(doc(db, "users", myUid), { inbox: arrayRemove(mailItem) })
    showToast("반지 요청을 거절했어.")
    closeRingRequestModal()
    await renderMail()
  } catch(e) {
    console.error(e)
    showToast("처리 실패...")
  }
}

// ══════════════════════════════════════════════════════
//  쪽지 모달
// ══════════════════════════════════════════════════════
function openNoteModal(item, index) {
  document.getElementById("note-view-text").innerText = item.text ?? "(내용 없음)"
  document.getElementById("note-view-date").innerText = item.at
    ? new Date(item.at).toLocaleString("ko-KR")
    : ""
  document.getElementById("modal-note-view").classList.add("open")
  if (!item.read) markRead(item, "note")
}

// ══════════════════════════════════════════════════════
//  일반 편지 모달
// ══════════════════════════════════════════════════════
function openLetterModal(item, index) {
  document.getElementById("letter-view-from").innerText  = `보낸 사람: ${item.fromName ?? "익명"}`
  document.getElementById("letter-view-title").innerText = item.title ?? "(제목 없음)"
  document.getElementById("letter-view-text").innerText  = item.text  ?? "(내용 없음)"
  document.getElementById("letter-view-date").innerText  = item.at
    ? new Date(item.at).toLocaleString("ko-KR")
    : ""
  document.getElementById("modal-letter-view").classList.add("open")
  if (!item.read) markRead(item, "letter")
}

// ══════════════════════════════════════════════════════
//  선물 보기 모달
// ══════════════════════════════════════════════════════
function openGiftViewModal(item, index) {
  currentGiftMailItem = item

  const gItem = item.item ?? {}

  let infoHtml = `
    <p style="font-size:13px;color:#666;margin-bottom:10px;">
      <strong>${item.fromNickname}</strong>${josa(item.fromNickname, "이가")} 선물을 보냈어!
    </p>
  `

  if (gItem.type === "ingredient") {
    infoHtml += `<p style="font-size:16px;margin:0 0 8px;">🧂 <strong>${gItem.name}</strong></p>`

  } else if (gItem.type === "poppin") {
    const color   = POPPIN_COLOR[gItem.pType] ?? "#aaa"
    const imgHtml = gItem.img
      ? `<img src="${gItem.img}" alt="${gItem.name}"
           style="width:64px;height:64px;object-fit:contain;image-rendering:pixelated;
                  display:block;margin:0 auto 8px;">`
      : `<div style="font-size:40px;text-align:center;margin-bottom:8px;">🧁</div>`
    infoHtml += `
      ${imgHtml}
      <p style="font-size:16px;margin:0 0 8px;font-weight:bold;color:${color};">${gItem.name}</p>
    `

  } else if (gItem.type === "title_ticket") {
    infoHtml += `
      <p style="font-size:16px;margin:0 0 8px;">
        📃 <strong style="color:#7c5cfc;">${gItem.name}</strong>
      </p>
      <p style="font-size:12px;color:#999;margin:0;line-height:1.6;">
        원하는 칭호를 하나 선택할 수 있다. 커스텀 칭호도 가능하다.<br>소넷 선생님께 들고가보자.
      </p>
    `
  }

  // 메시지 (있을 때만 표시)
  if (item.message && item.message.trim()) {
    infoHtml += `
      <div style="
        margin-top:10px;
        padding:10px 12px;
        background:#f9f9f9;
        border-radius:6px;
        font-size:14px;
        line-height:1.6;
        color:#444;
        white-space:pre-wrap;
        word-break:break-all;
        text-align:left;
      ">${item.message}</div>
    `
  }

  document.getElementById("gift-view-info").innerHTML = infoHtml
  document.getElementById("modal-gift-view").classList.add("open")

  if (!item.read) markRead(item, "gift")
}

// ══════════════════════════════════════════════════════
//  읽음 처리
// ══════════════════════════════════════════════════════
async function markRead(item, type) {
  if (item.read) return

  const updated = { ...item, read: true }
  try {
    await updateDoc(doc(db, "users", myUid), { inbox: arrayRemove(item) })
    await updateDoc(doc(db, "users", myUid), { inbox: arrayUnion(updated) })

    const inbox = myData?.inbox ?? []
    const idx = inbox.findIndex(x => x.at === item.at && x.type === item.type)
    if (idx >= 0 && myData.inbox) {
      myData.inbox[idx] = updated
    }

    item.read = true

  } catch(e) {
    console.warn("읽음 처리 실패", e)
  }
}

// ══════════════════════════════════════════════════════
//  선물 수락
// ══════════════════════════════════════════════════════
window.acceptGift = async function() {
  if (!currentGiftMailItem) return
  const mailItem = currentGiftMailItem
  const gItem    = mailItem.item

  try {
    await updateDoc(doc(db, "users", myUid), { inventory: arrayUnion(gItem) })
    await updateDoc(doc(db, "users", myUid), { inbox: arrayRemove(mailItem) })
    showToast("🎁 선물을 가방에 넣었어!")
    closeGiftModal()
    await renderMail()
  } catch(e) {
    console.error(e)
    showToast("수락 실패... 다시 해봐")
  }
}

// ══════════════════════════════════════════════════════
//  선물 거절
// ══════════════════════════════════════════════════════
window.rejectGift = async function() {
  if (!currentGiftMailItem) return
  const mailItem = currentGiftMailItem

  try {
    await updateDoc(doc(db, "users", myUid), { inbox: arrayRemove(mailItem) })
    showToast("선물을 거절했어.")
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