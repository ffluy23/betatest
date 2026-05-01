import {
  collection, addDoc, onSnapshot, query, orderBy, where
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js"

function formatMessage(text) {
  return text.replace(/\((.+?)\)/g, '<span class="chat-action">($1)</span>')
}

function appendMessage(container, nickname, text) {
  const div = document.createElement("div")
  div.className = "chat-message"
  div.innerHTML = `<span class="chat-nick">${nickname}:</span> ${formatMessage(text)}`
  container.appendChild(div)
  container.scrollTop = container.scrollHeight
}

function subscribeChannel(db, ROOM_ID, gameStartedAt, rendered, container) {
  const ref = collection(db, "rooms", ROOM_ID, "chat_spectator")
  const q = gameStartedAt > 0
    ? query(ref, orderBy("ts"), where("ts", ">=", gameStartedAt))
    : query(ref, orderBy("ts"))
  onSnapshot(q, snap => {
    snap.docs.forEach(d => {
      if (rendered.has(d.id)) return
      rendered.add(d.id)
      const { nickname, text } = d.data()
      appendMessage(container, nickname, text)
    })
  })
}

window.initSingleChat = function({ db, ROOM_ID, myUid, isSpectator, gameStartedAt = 0 }) {
  if (!isSpectator) return

  const section = document.getElementById("spectator-chat-section")
  if (section) section.style.display = "block"

  const container = document.getElementById("spectator-chat-messages")
  if (container) subscribeChannel(db, ROOM_ID, gameStartedAt, new Set(), container)

  async function sendChat() {
    const input = document.getElementById("spectator-chat-input")
    if (!input) return
    const text = input.value.trim()
    if (!text) return
    const nickname = window.__myDisplayName ?? myUid.slice(0, 6)
    const ref = collection(db, "rooms", ROOM_ID, "chat_spectator")
    await addDoc(ref, { uid: myUid, nickname, text, ts: Date.now() })
    input.value = ""
  }

  const sendBtn = document.getElementById("spectator-chat-send-btn")
  if (sendBtn) sendBtn.onclick = sendChat
  const inputEl = document.getElementById("spectator-chat-input")
  if (inputEl) inputEl.addEventListener("keypress", e => { if (e.key === "Enter") sendChat() })
}