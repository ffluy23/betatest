// ursalunaflip/ursaluna.js

import { auth, db } from "../js/firebase.js"
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js"
import {
  doc, getDoc, updateDoc, increment
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js"

// ══════════════════════════════════════════════════════
//  상수
// ══════════════════════════════════════════════════════
const BET_AMOUNT  = 100   // 1게임 배팅
const GRID        = 5     // 5×5
const MAX_ROUND   = 9     // 총 라운드 수

// 라운드 → 배수 (1라운드=2×, 2라운드=3×, ... 9라운드=10×)
const ROUND_MULT = [2, 3, 4, 5, 6, 7, 8, 9, 10]

// 라운드별 보드 설정 (다투곰 수, 2 개수, 3 개수)
// 라운드가 올라갈수록 다투곰 증가 + 고배수 카드 증가
const ROUND_CONFIG = [
  //  round 1         2         3         4         5
  { bears:3, twos:3, threes:1 },
  { bears:4, twos:3, threes:2 },
  { bears:4, twos:2, threes:3 },
  { bears:5, twos:3, threes:2 },
  { bears:5, twos:2, threes:3 },
  //  round 6         7         8         9
  { bears:6, twos:2, threes:3 },
  { bears:6, twos:1, threes:4 },
  { bears:7, twos:2, threes:3 },
  { bears:8, twos:1, threes:3 },
]

// ══════════════════════════════════════════════════════
//  상태
// ══════════════════════════════════════════════════════
let myUid    = null
let myCoins  = 0

let round        = 1    // 현재 라운드 (1~9)
let board        = []   // 5×5
let flipped      = []   // 5×5 boolean
let gameActive   = false
let remainBonus  = 0    // 남은 2,3 개수

// 현재 게임에서 모은 "잠정 ZP" (STOP 해야 확정)
let pendingZP    = 0

// ══════════════════════════════════════════════════════
//  Firebase
// ══════════════════════════════════════════════════════
onAuthStateChanged(auth, async user => {
  if (!user) { location.href = "../index.html"; return }
  myUid = user.uid
  const snap = await getDoc(doc(db, "users", myUid))
  myCoins = snap.data()?.coins ?? 0
  updateZpDisplay()
  initGame()
})

// ══════════════════════════════════════════════════════
//  게임 초기화 (처음 or 리셋)
// ══════════════════════════════════════════════════════
function initGame() {
  round     = 1
  pendingZP = 0
  startRound()
}

window.resetToStart = function() {
  hideAllOverlays()
  initGame()
}

// ══════════════════════════════════════════════════════
//  라운드 시작
// ══════════════════════════════════════════════════════
async function startRound() {
  // 1라운드 시작 시에만 배팅 차감
  if (round === 1) {
    if (myCoins < BET_AMOUNT) {
      showToast("ZP가 부족해! (최소 100ZP 필요)")
      return
    }
    try {
      await updateDoc(doc(db, "users", myUid), { coins: increment(-BET_AMOUNT) })
      myCoins -= BET_AMOUNT
      updateZpDisplay()
    } catch(e) {
      showToast("오류 발생! 다시 시도해봐")
      return
    }
  }

  const cfg = ROUND_CONFIG[round - 1]
  board       = buildBoard(cfg)
  flipped     = Array.from({ length: GRID }, () => Array(GRID).fill(false))
  gameActive  = true
  remainBonus = board.flat().filter(v => v >= 2).length

  hideAllOverlays()
  renderRoundTrack()
  renderBoard()
  updateStatusBar()
  setMessage(`🎮 라운드 ${round} / ${MAX_ROUND} — 배수 ×${ROUND_MULT[round-1]} 목표!`)
}

// ══════════════════════════════════════════════════════
//  보드 생성
// ══════════════════════════════════════════════════════
function buildBoard({ bears, twos, threes }) {
  const total = GRID * GRID
  const vals  = []
  for (let i = 0; i < bears;  i++) vals.push(0)
  for (let i = 0; i < threes; i++) vals.push(3)
  for (let i = 0; i < twos;   i++) vals.push(2)
  while (vals.length < total) vals.push(1)

  // Fisher-Yates 셔플
  for (let i = vals.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [vals[i], vals[j]] = [vals[j], vals[i]]
  }

  const b = []
  for (let r = 0; r < GRID; r++) b.push(vals.slice(r * GRID, r * GRID + GRID))
  return b
}

// ══════════════════════════════════════════════════════
//  라운드 트랙 렌더
// ══════════════════════════════════════════════════════
function renderRoundTrack() {
  const el = document.getElementById("round-steps")
  el.innerHTML = ""
  for (let i = 1; i <= MAX_ROUND; i++) {
    const step = document.createElement("div")
    step.className = "round-step"
    if (i < round)  step.classList.add("done")
    if (i === round) step.classList.add("current")

    step.innerHTML = `
      <div class="round-step-dot">${i < round ? "✓" : i}</div>
      <div class="round-step-mult">×${ROUND_MULT[i-1]}</div>
    `
    el.appendChild(step)
  }
  document.getElementById("round-display").innerText = `${round}/${MAX_ROUND}`
}

// ══════════════════════════════════════════════════════
//  보드 렌더
// ══════════════════════════════════════════════════════
function renderBoard() {
  const grid = document.getElementById("board-grid")
  grid.innerHTML = ""

  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) grid.appendChild(makeCardEl(r, c))
    grid.appendChild(makeRowHintEl(r))
  }
  for (let c = 0; c < GRID; c++) grid.appendChild(makeColHintEl(c))
  const corner = document.createElement("div")
  corner.className = "corner-cell"
  grid.appendChild(corner)
}

function makeCardEl(r, c) {
  const div = document.createElement("div")
  div.className = "card"
  div.id = `card-${r}-${c}`
  if (flipped[r][c]) div.classList.add("flipped")

  const val = board[r][c]
  const content = val === 0 ? "🐻" : String(val)
  div.innerHTML = `
    <div class="card-inner">
      <div class="card-back"></div>
      <div class="card-front val-${val}">${content}</div>
    </div>
  `
  if (!flipped[r][c] && gameActive) {
    div.addEventListener("click", () => flipCard(r, c))
  }
  return div
}

function makeRowHintEl(r) {
  const sum   = board[r].reduce((a, v) => a + v, 0)
  const bears = board[r].filter(v => v === 0).length
  const div   = document.createElement("div")
  div.className = "hint-cell"
  div.innerHTML = `<span class="hint-sum">합 ${sum}</span><span class="hint-bear">🐻 ${bears}</span>`
  return div
}

function makeColHintEl(c) {
  const col   = board.map(row => row[c])
  const sum   = col.reduce((a, v) => a + v, 0)
  const bears = col.filter(v => v === 0).length
  const div   = document.createElement("div")
  div.className = "hint-cell"
  div.innerHTML = `<span class="hint-sum">합 ${sum}</span><span class="hint-bear">🐻 ${bears}</span>`
  return div
}

// ══════════════════════════════════════════════════════
//  카드 뒤집기
// ══════════════════════════════════════════════════════
async function flipCard(r, c) {
  if (!gameActive || flipped[r][c]) return
  flipped[r][c] = true

  const val    = board[r][c]
  const cardEl = document.getElementById(`card-${r}-${c}`)
  cardEl.classList.add("flipped")

  if (val === 0) {
    // ── 다투곰 ──
    cardEl.classList.add("bear-revealed")
    gameActive = false
    revealAll()
    await handleBearHit()

  } else {
    // ── 숫자 ──
    if (val >= 2) {
      remainBonus--
      cardEl.classList.add("found-bonus")
    }
    updateStatusBar()

    if (remainBonus === 0) {
      // 라운드 클리어
      gameActive = false
      revealAll()
      await handleRoundClear()
    } else {
      const thisRoundZP = ROUND_MULT[round - 1] * BET_AMOUNT
      setMessage(val >= 2
        ? `✨ ${val} 발견! 이 라운드 클리어 시 +${thisRoundZP.toLocaleString()}ZP`
        : `1... 이 라운드 클리어 시 +${thisRoundZP.toLocaleString()}ZP`)
    }
  }
}

// ══════════════════════════════════════════════════════
//  다투곰 히트 → 누적 ZP 소멸
// ══════════════════════════════════════════════════════
async function handleBearHit() {
  // pendingZP는 실제로 Firestore에 저장 안 된 상태 → 그냥 버리면 됨
  // 단, 배팅금은 이미 차감됐으므로 추가 차감 없음
  const lost = pendingZP
  pendingZP = 0

  setTimeout(() => {
    document.getElementById("bear-sub").innerText =
      lost > 0
        ? `다투곰에게 걸렸어!\n이번 게임에서 모으던 ${lost.toLocaleString()}ZP가 전부 사라졌어...`
        : `다투곰에게 걸렸어!\n배팅한 ${BET_AMOUNT}ZP도 날아갔어...`
    document.getElementById("overlay-bear").style.display = "flex"
  }, 600)
}

// ══════════════════════════════════════════════════════
//  라운드 클리어
// ══════════════════════════════════════════════════════
async function handleRoundClear() {
  const earned = ROUND_MULT[round - 1] * BET_AMOUNT
  // pendingZP는 "이 게임에서 모은 잠정 ZP" = 이번 라운드 획득분
  // (이전 라운드에서 GO를 선택했다면 pendingZP는 계속 쌓이지 않고
  //  항상 "가장 최근 클리어 라운드 배수 × 배팅" 으로 갱신)
  pendingZP = earned

  const isLast = round === MAX_ROUND

  if (isLast) {
    // 9라운드 퍼펙트 → 자동 획득
    await confirmStop()
    setTimeout(() => {
      document.getElementById("perfect-sub").innerText =
        `10배 × ${BET_AMOUNT}ZP = +${earned.toLocaleString()}ZP 획득!\n진짜 대단해!`
      document.getElementById("overlay-perfect").style.display = "flex"
    }, 400)
    return
  }

  // GO / STOP 선택
  const nextMult = ROUND_MULT[round]
  document.getElementById("clear-title").innerText  = `라운드 ${round} 클리어! 🎉`
  document.getElementById("clear-sub").innerText    =
    `배수 ×${ROUND_MULT[round-1]} 달성!\n지금 받으면 +${earned.toLocaleString()}ZP`
  document.getElementById("stop-zp-text").innerText = `+${earned.toLocaleString()}ZP 확정`
  document.getElementById("go-mult-text").innerText = `다음 ×${nextMult}`

  // 마지막 라운드 직전은 GO 버튼 안 보임
  document.getElementById("go-btn").style.display = "flex"
  document.getElementById("go-warning").style.display = "block"

  setTimeout(() => {
    document.getElementById("overlay-clear").style.display = "flex"
  }, 400)
}

// ══════════════════════════════════════════════════════
//  GO 선택
// ══════════════════════════════════════════════════════
window.chooseGo = function() {
  document.getElementById("overlay-clear").style.display = "none"
  round++
  // pendingZP 유지 (GO 선택하면 아직 Firestore 미저장)
  startRound()
}

// ══════════════════════════════════════════════════════
//  STOP 선택
// ══════════════════════════════════════════════════════
window.chooseStop = async function() {
  document.getElementById("overlay-clear").style.display = "none"
  await confirmStop()
  const earned = pendingZP
  document.getElementById("stop-sub").innerText =
    `+${earned.toLocaleString()}ZP를 안전하게 챙겼어!\n(라운드 ${round} × ×${ROUND_MULT[round-1]} × ${BET_AMOUNT}ZP)`
  document.getElementById("overlay-stop").style.display = "flex"
  pendingZP = 0
}

// ══════════════════════════════════════════════════════
//  ZP 확정 저장
// ══════════════════════════════════════════════════════
async function confirmStop() {
  if (pendingZP <= 0) return
  try {
    await updateDoc(doc(db, "users", myUid), { coins: increment(pendingZP) })
    myCoins += pendingZP
    updateZpDisplay()
  } catch(e) {
    showToast("ZP 저장 오류!")
  }
}

// ══════════════════════════════════════════════════════
//  전체 공개
// ══════════════════════════════════════════════════════
function revealAll() {
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      const el = document.getElementById(`card-${r}-${c}`)
      if (el && !flipped[r][c]) el.classList.add("flipped")
    }
  }
}

// ══════════════════════════════════════════════════════
//  UI 헬퍼
// ══════════════════════════════════════════════════════
function updateZpDisplay() {
  document.getElementById("zp-display").innerText = myCoins.toLocaleString()
}

function updateStatusBar() {
  const cfg = ROUND_CONFIG[round - 1]
  document.getElementById("round-mult-display").innerText = `×${ROUND_MULT[round-1]}`
  document.getElementById("earn-display").innerText       = `+${(ROUND_MULT[round-1] * BET_AMOUNT).toLocaleString()}`
  document.getElementById("danger-display").innerText     = `🐻 ${cfg.bears}마리`
}

function setMessage(msg) {
  document.getElementById("message-box").innerHTML = `<p>${msg}</p>`
}

function hideAllOverlays() {
  ["overlay-bear","overlay-clear","overlay-perfect","overlay-stop"].forEach(id => {
    document.getElementById(id).style.display = "none"
  })
}

function showToast(msg, duration = 2500) {
  const t = document.getElementById("toast")
  t.innerText = msg
  t.classList.add("show")
  setTimeout(() => t.classList.remove("show"), duration)
}