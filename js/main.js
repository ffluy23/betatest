//js/main.js

import { auth, db } from "./firebase.js"
import {
  signInWithEmailAndPassword,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js"
import {
  doc, updateDoc,
  collection, getDocs, orderBy, query, limit
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js"

const loginBtn = document.getElementById("loginBtn")
if (loginBtn) {
  loginBtn.onclick = async () => {
    const email    = document.getElementById("email").value
    const password = document.getElementById("password").value
    try {
      await signInWithEmailAndPassword(auth, email, password)
      location.href = "main.html"
    } catch (error) {
      alert("아이디 또는 비밀번호를 확인해주세요!")
    }
  }
}

window.enterRoom = async function(roomNumber) {
  const user = auth.currentUser
  await updateDoc(doc(db, "users", user.uid), { room: roomNumber })
  location.href = `pages/battleroom${roomNumber}.html`
}

// ── 게임 기록 불러오기
// battleroom1~3 각 방의 games 컬렉션에서 최근 20개씩 불러옴
async function loadGameLogs() {
  const list   = document.getElementById("game-log-list")
  const empty  = document.getElementById("game-log-empty")
  const rooms  = ["battleroom1", "battleroom2", "battleroom3"]
  const allGames = []

  for (const roomId of rooms) {
    try {
      const gamesRef = collection(db, "rooms", roomId, "games")
      const q = query(gamesRef, orderBy("createdAt", "desc"), limit(20))
      const snap = await getDocs(q)
      snap.forEach(d => {
        allGames.push({ roomId, gameId: d.id, ...d.data() })
      })
    } catch (e) {
      // 해당 방에 games 없으면 스킵
    }
  }

  // createdAt 내림차순 정렬
  allGames.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))

  if (allGames.length === 0) {
    if (empty) empty.innerText = "게임 기록 없음"
    return
  }

  list.innerHTML = ""

  allGames.forEach(game => {
    const p1     = game.p1 ?? "???"
    const p2     = game.p2 ?? "???"
    const date   = game.createdAt
      ? new Date(game.createdAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
      : ""
    const winner = game.winner ?? null

    const item = document.createElement("div")
    item.className = "game-log-item"
    item.innerHTML = `
      <span class="game-log-vs">${p1} vs ${p2}${winner ? `　<span style="color:#fbb917;font-size:11px;">🏆 ${winner}</span>` : ""}</span>
      <span class="game-log-meta">${game.roomId} · ${date}</span>
    `
    item.onclick = () => openLogModal(game)
    list.appendChild(item)
  })
}

// ── 로그 모달 열기
function openLogModal(game) {
  const modal  = document.getElementById("log-modal")
  const title  = document.getElementById("log-modal-title")
  const body   = document.getElementById("log-modal-body")

  const p1 = game.p1 ?? "???"
  const p2 = game.p2 ?? "???"
  title.innerText = `${p1} vs ${p2}`
  body.innerHTML  = ""

  const logs = (game.logs ?? []).slice().sort((a, b) => a.ts - b.ts)
  if (logs.length === 0) {
    body.innerHTML = "<p style='color:#555'>로그 없음</p>"
  } else {
    logs.forEach(l => {
      const p = document.createElement("p")
      p.textContent = l.text
      body.appendChild(p)
    })
  }

  modal.classList.add("open")
}

// ── 모달 닫기
const closeBtn  = document.getElementById("log-modal-close")
const logModal  = document.getElementById("log-modal")
if (closeBtn)  closeBtn.onclick = () => logModal.classList.remove("open")
if (logModal)  logModal.onclick = (e) => { if (e.target === e.currentTarget) e.currentTarget.classList.remove("open") }

// ── 로그인 상태 확인 후 로드
onAuthStateChanged(auth, user => {
  if (user) loadGameLogs()
})
