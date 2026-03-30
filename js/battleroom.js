// battleroom.js

import { auth, db } from "./firebase.js"
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js"
import { doc, getDoc, updateDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js"

const API = "https://betatest-ten.vercel.app"
const roomRef = doc(db, "rooms", ROOM_ID)
let myUid = null
let myNickname = null
let myDisplayName = null

function calcMySlot(room) {
  if (!room || !myUid) return null
  if (room.player1_uid === myUid) return "player1"
  if (room.player2_uid === myUid) return "player2"
  if ((room.spectators ?? []).includes(myUid)) return "spectator"
  return null
}

onAuthStateChanged(auth, async (user) => {
  if (!user) return
  myUid = user.uid

  const userSnap = await getDoc(doc(db, "users", myUid))
  const userData = userSnap.data()
  myNickname = userData.nickname

  const activeTitle = userData?.activeTitle ?? null
  myDisplayName = activeTitle ? `[${activeTitle}] ${myNickname}` : myNickname

  const userRoomNum = userData?.room
  const userRoomId = userRoomNum ? `battleroom${userRoomNum}` : null

  if (userRoomId && userRoomId !== ROOM_ID) {
    const activeRoomSnap = await getDoc(doc(db, "rooms", userRoomId))
    const activeRoom = activeRoomSnap.data()
    if (activeRoom?.game_started) {
      const isPlayer = activeRoom.player1_uid === myUid || activeRoom.player2_uid === myUid
      if (isPlayer) {
        alert(`현재 battleroom${userRoomNum}에서 게임 중입니다. 해당 방으로 이동합니다.`)
        location.href = `../games/battleroom${userRoomNum}.html`
        return
      }
    }
  }

  await joinRoom()
  listenRoom()
  setupButtons()
})

async function joinRoom() {
  const roomSnap = await getDoc(roomRef)
  const room = roomSnap.data()

  if (calcMySlot(room)) return

  if (room.game_started) {
    await joinAsSpectator(room)
    return
  }

  if (!room.player1_uid) {
    await updateDoc(roomRef, { player1_uid: myUid, player1_name: myDisplayName })
  } else if (!room.player2_uid) {
    await updateDoc(roomRef, { player2_uid: myUid, player2_name: myDisplayName })
  } else {
    await joinAsSpectator(room)
  }
}

async function joinAsSpectator(room) {
  const spectators = room.spectators ?? []
  if (spectators.includes(myUid)) return
  await updateDoc(roomRef, {
    spectators: [...spectators, myUid],
    spectator_names: [...(room.spectator_names ?? []), myDisplayName]
  })
}

function listenRoom() {
  onSnapshot(roomRef, async (snap) => {
    const room = snap.data()
    if (!room) return

    const mySlot = calcMySlot(room)

    renderPlayerList(room, mySlot)
    renderSpectatorList(room, mySlot)
    renderSwapRequest(room, mySlot)
    updateButtonsBySlot(room, mySlot)

    if (room.game_started && mySlot) {
      const roomNumber = ROOM_ID.replace("battleroom", "")
      if (mySlot === "spectator") {
        location.href = `../games/battleroom${roomNumber}.html?spectator=true`
      } else {
        location.href = `../games/battleroom${roomNumber}.html`
      }
    }
  })
}

// 플레이어 목록 렌더링 — 교체 요청 버튼 포함
function renderPlayerList(room, mySlot) {
  const p1El = document.getElementById("player1")
  const p2El = document.getElementById("player2")

  const isSpectator = mySlot === "spectator"
  const isPlayer1 = mySlot === "player1"
  const isPlayer2 = mySlot === "player2"

  if (p1El) {
    const name = room.player1_name ?? "대기..."
    // 관전자 → player1에게 교체 요청 버튼
    // player2 → player1에게 교체 요청 버튼
    // player1 본인은 버튼 없음
    const showBtn = (isSpectator || isPlayer2) && room.player1_uid
    p1El.innerHTML = `<span>Player1: ${name}</span>${showBtn ? `<button onclick="window.requestSwapTo('player1')" style="margin-left:8px;font-size:11px;padding:2px 8px;">교체 요청</button>` : ""}`
  }

  if (p2El) {
    const name = room.player2_name ?? "대기..."
    const showBtn = (isSpectator || isPlayer1) && room.player2_uid
    p2El.innerHTML = `<span>Player2: ${name}</span>${showBtn ? `<button onclick="window.requestSwapTo('player2')" style="margin-left:8px;font-size:11px;padding:2px 8px;">교체 요청</button>` : ""}`
  }
}

// 관전자 목록 렌더링 — 플레이어가 관전자에게 교체 요청 버튼 포함
function renderSpectatorList(room, mySlot) {
  const el = document.getElementById("spectator-list")
  if (!el) return

  const spectators = room.spectators ?? []
  const spectatorNames = room.spectator_names ?? []
  const isPlayer = mySlot === "player1" || mySlot === "player2"

  if (spectators.length === 0) {
    el.innerHTML = "관전자 없음"
    return
  }

  if (!isPlayer) {
    // 관전자/플레이어 아닌 경우 그냥 이름만
    el.innerText = "관전자: " + spectatorNames.join(", ")
    return
  }

  // 플레이어는 관전자 옆에 "교체 요청" 버튼
  el.innerHTML = "관전자: " + spectators.map((uid, i) => {
    const name = spectatorNames[i] ?? "???"
    return `<span>${name} <button onclick="window.requestSwapToSpectator('${uid}', '${name}')" style="font-size:11px;padding:2px 6px;">교체 요청</button></span>`
  }).join(", ")
}

function updateButtonsBySlot(room, mySlot) {
  const isPlayer    = mySlot === "player1" || mySlot === "player2"
  const isSpectator = mySlot === "spectator"

  const readyBtn = document.getElementById("readyBtn")
  const leaveBtn = document.getElementById("leaveBtn")

  if (readyBtn) readyBtn.style.display = isPlayer ? "inline-block" : "none"
  if (leaveBtn) leaveBtn.disabled = isPlayer && !!room.game_started
}

function renderSwapRequest(room, mySlot) {
  const req = room.swap_request
  const el  = document.getElementById("swap-request-display")
  if (!el) return

  if (!req) { el.innerHTML = ""; return }

  // 요청 대상인지 확인
  const isTarget =
    (req.toSlot === "player1" && mySlot === "player1") ||
    (req.toSlot === "player2" && mySlot === "player2") ||
    (req.toUid === myUid)  // 특정 uid 대상인 경우 (관전자 → 플레이어 교체)

  if (isTarget && req.from !== myUid) {
    el.innerHTML = `
      <p>${req.fromName}님이 자리 교체를 요청했습니다.</p>
      <button onclick="window.acceptSwap()">수락</button>
      <button onclick="window.rejectSwap()">거절</button>
    `
  } else if (req.from === myUid) {
    const target = req.toUid ? req.toName : (req.toSlot === "player1" ? "Player1" : "Player2")
    el.innerHTML = `<p>${target}에게 교체 요청 중...</p>`
  } else {
    el.innerHTML = ""
  }
}

// 관전자 → 플레이어 슬롯 교체 요청
window.requestSwapTo = async function(targetSlot) {
  const roomSnap = await getDoc(roomRef)
  const room = roomSnap.data()

  if (!room[`${targetSlot}_uid`]) {
    await promoteToPlayer(targetSlot)
    return
  }

  await updateDoc(roomRef, {
    swap_request: { from: myUid, fromName: myDisplayName, toSlot: targetSlot }
  })
}

// 플레이어 → 특정 관전자 교체 요청
window.requestSwapToSpectator = async function(targetUid, targetName) {
  await updateDoc(roomRef, {
    swap_request: { from: myUid, fromName: myDisplayName, toUid: targetUid, toName: targetName }
  })
}

window.acceptSwap = async function() {
  const roomSnap = await getDoc(roomRef)
  const room = roomSnap.data()
  const req = room.swap_request
  if (!req) return

  const mySlot = calcMySlot(room)
  const spectators = room.spectators ?? []
  const spectatorNames = room.spectator_names ?? []

  if (req.toUid) {
    // 플레이어 → 관전자 교체: 플레이어(나)가 관전자로, 요청자가 플레이어로
    // 내 현재 슬롯을 요청자에게 넘김
    await updateDoc(roomRef, {
      [`${mySlot}_uid`]:  req.from,
      [`${mySlot}_name`]: req.fromName,
      spectators:      [...spectators.filter(u => u !== req.from), myUid],
      spectator_names: [...spectatorNames.filter(n => n !== req.fromName), myDisplayName],
      swap_request: null
    })
  } else {
    // 관전자 → 플레이어 교체: 기존 방식
    await updateDoc(roomRef, {
      [`${req.toSlot}_uid`]:  req.from,
      [`${req.toSlot}_name`]: req.fromName,
      spectators:      [...spectators.filter(u => u !== req.from), myUid],
      spectator_names: [...spectatorNames.filter(n => n !== req.fromName), myDisplayName],
      swap_request: null
    })
  }
}

window.rejectSwap = async function() {
  await updateDoc(roomRef, { swap_request: null })
}

async function promoteToPlayer(targetSlot) {
  const roomSnap = await getDoc(roomRef)
  const room = roomSnap.data()
  const spectators = room.spectators ?? []
  const spectatorNames = room.spectator_names ?? []

  await updateDoc(roomRef, {
    [`${targetSlot}_uid`]:  myUid,
    [`${targetSlot}_name`]: myDisplayName,
    spectators:      spectators.filter(u => u !== myUid),
    spectator_names: spectatorNames.filter(n => n !== myDisplayName)
  })
}

function setupButtons() {
  document.getElementById("readyBtn").onclick = async () => {
    const roomSnap = await getDoc(roomRef)
    const mySlot = calcMySlot(roomSnap.data())
    if (mySlot !== "player1" && mySlot !== "player2") return

    const btn = document.getElementById("readyBtn")
    if (btn) { btn.disabled = true; btn.innerText = "대기 중..." }

    try {
      await fetch(`${API}/api/ready`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId: ROOM_ID, myUid, mySlot })
      })
    } catch (e) {
      console.error("레디 실패:", e)
      if (btn) { btn.disabled = false; btn.innerText = "레디" }
    }
  }

  document.getElementById("leaveBtn").onclick = async () => {
    const roomSnap = await getDoc(roomRef)
    const room = roomSnap.data()
    const mySlot = calcMySlot(room)
    const isPlayer = mySlot === "player1" || mySlot === "player2"

    if (isPlayer && room.game_started) {
      alert("도망칠 수 없다!")
      return
    }
    await leaveRoom(mySlot, room)
  }
}

async function leaveRoom(mySlot, room) {
  if (mySlot === "player1" || mySlot === "player2") {
    const spectators     = room.spectators ?? []
    const spectatorNames = room.spectator_names ?? []

    if (spectators.length > 0) {
      const randIdx = Math.floor(Math.random() * spectators.length)
      await updateDoc(roomRef, {
        [`${mySlot}_uid`]:   spectators[randIdx],
        [`${mySlot}_name`]:  spectatorNames[randIdx],
        [`${mySlot}_ready`]: false,
        spectators:      spectators.filter((_, i) => i !== randIdx),
        spectator_names: spectatorNames.filter((_, i) => i !== randIdx)
      })
    } else {
      await updateDoc(roomRef, {
        [`${mySlot}_uid`]:   null,
        [`${mySlot}_name`]:  null,
        [`${mySlot}_ready`]: false
      })
    }
  } else {
    await updateDoc(roomRef, {
      spectators:      (room.spectators ?? []).filter(u => u !== myUid),
      spectator_names: (room.spectator_names ?? []).filter(n => n !== myDisplayName)
    })
  }

  location.href = "../main.html"
}