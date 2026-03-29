import { auth, db } from "./firebase.js"
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js"
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js"

async function loadProfile(user) {
  const snap = await getDoc(doc(db, "users", user.uid))
  if (!snap.exists()) return

  const data = snap.data()

  document.getElementById("nickname").textContent = `Name: ${data?.nickname ?? ""}`;
  document.getElementById("coins").textContent = `💰 ZP: ${data.coins ?? 0}`

  const gallery = document.getElementById("gallery")
  const entries = Array.isArray(data.entry) ? data.entry : []

  entries.forEach(e => {
    const url = e?.portrait ?? ""
    if (!url) return
    const img = document.createElement("img")
    img.src = url
    img.alt = "포트레이트"
    gallery.appendChild(img)
  })
}

onAuthStateChanged(auth, user => {
  if (user) loadProfile(user)
  else location.href = "../index.html"
})
