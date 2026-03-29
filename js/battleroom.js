// battleroom.js

import { auth, db } from "./firebase.js"
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js"
import { doc, getDoc, updateDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js"

const roomRef = doc(db, "rooms", ROOM_ID)
let myUid = null
let myNickname = null
let myDisplayName = null  // 칭호 포함 이름

// mySlot은 onSnapshot마다 Firestore 기준으로 재계산
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

  // 칭호 포함 표시 이름 계산
  const activeTitle = userData?.activeTitle ?? null
  myDisplayName = activeTitle ? `[${activeTitle}] ${myNickname}` : myNickname

  const userRoomNum = userData?.room
  const userRoomId = userRoomNum ? `battleroom${userRoomNum}` : null

  // 재접속 체크
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

  // 이미 이 방에 있는 경우
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

    document.getElementById("player1").innerText = "Player1: " + (room.player1_name ?? "대기...")
    document.getElementById("player2").innerText = "Player2: " + (room.player2_name ?? "대기...")

    renderSpectators(room)
    renderSwapRequest(room, mySlot)
    updateButtonsBySlot(room, mySlot)

    // entry 복사 + game_started
    if (room.player1_ready && room.player2_ready && !room.game_started) {
      if (mySlot === "player1" || mySlot === "player2") {
        const firestoreSlot = mySlot === "player1" ? "p1" : "p2"
        const userSnap = await getDoc(doc(db, "users", myUid))
        const myEntry = userSnap.data()?.entry ?? []
        const myEntryWithMax = myEntry.map(pkmn => ({ ...pkmn, maxHp: pkmn.hp }))

        await updateDoc(roomRef, {
          [`${firestoreSlot}_entry`]: myEntryWithMax,
          [`${firestoreSlot}_active_idx`]: 0,
        })

        if (mySlot === "player1") {
          await updateDoc(roomRef, { game_started: true })
        }
      }
    }

    // 게임 시작 시 전원 이동
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

function updateButtonsBySlot(room, mySlot) {
  const isPlayer    = mySlot === "player1" || mySlot === "player2"
  const isSpectator = mySlot === "spectator"

  const readyBtn = document.getElementById("readyBtn")
  const swapBtn  = document.getElementById("swapBtn")
  const leaveBtn = document.getElementById("leaveBtn")

  if (readyBtn) readyBtn.style.display = isPlayer    ? "inline-block" : "none"
  if (swapBtn)  swapBtn.style.display  = isSpectator ? "inline-block" : "none"
  if (leaveBtn) leaveBtn.disabled = isPlayer && !!room.game_started
}

function renderSpectators(room) {
  const el = document.getElementById("spectator-list")
  if (!el) return
  const names = room.spectator_names ?? []
  el.innerText = names.length > 0 ? "관전자: " + names.join(", ") : "관전자 없음"
}

function renderSwapRequest(room, mySlot) {
  const req = room.swap_request
  const el  = document.getElementById("swap-request-display")
  if (!el) return

  if (!req) { el.innerHTML = ""; return }

  const isTargetPlayer =
    (req.toSlot === "player1" && mySlot === "player1") ||
    (req.toSlot === "player2" && mySlot === "player2")

  if (isTargetPlayer && req.from !== myUid) {
    el.innerHTML = `
      <p>${req.fromName}님이 자리 교체를 요청했습니다.</p>
      <button onclick="window.acceptSwap()">수락</button>
      <button onclick="window.rejectSwap()">거절</button>
    `
  } else if (req.from === myUid) {
    el.innerHTML = `<p>${req.toSlot === "player1" ? "Player1" : "Player2"}에게 교체 요청 중...</p>`
  } else {
    el.innerHTML = ""
  }
}

async function requestSwap(targetSlot) {
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

window.acceptSwap = async function() {
  const roomSnap = await getDoc(roomRef)
  const room = roomSnap.data()
  const req = room.swap_request
  if (!req) return

  const mySlot = calcMySlot(room)
  const spectators = room.spectators ?? []
  const spectatorNames = room.spectator_names ?? []

  await updateDoc(roomRef, {
    [`${req.toSlot}_uid`]:  req.from,
    [`${req.toSlot}_name`]: req.fromName,
    spectators:      [...spectators.filter(u => u !== req.from), myUid],
    spectator_names: [...spectatorNames.filter(n => n !== req.fromName), myDisplayName],
    swap_request: null
  })
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
    if (mySlot === "player1") await updateDoc(roomRef, { player1_ready: true })
    if (mySlot === "player2") await updateDoc(roomRef, { player2_ready: true })
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

  const swapBtn = document.getElementById("swapBtn")
  if (swapBtn) {
    swapBtn.onclick = async () => {
      const roomSnap = await getDoc(roomRef)
      const room = roomSnap.data()
      if (!room.player1_uid) {
        await requestSwap("player1")
      } else if (!room.player2_uid) {
        await requestSwap("player2")
      } else {
        const target = confirm("Player1 자리 요청? (취소 시 Player2)") ? "player1" : "player2"
        await requestSwap(target)
      }
    }
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
