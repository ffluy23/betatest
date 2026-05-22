import { auth, db } from "./firebase.js"
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js"
import {
  doc, getDoc, collection, getDocs,
  setDoc, arrayUnion
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js"

// ══════════════════════════════════════════════════════
//  상태
// ══════════════════════════════════════════════════════
let myUid  = null
let myData = null

let apRecipients = []
let apIsAll      = false
let apMailType   = "letter"

// ══════════════════════════════════════════════════════
//  토스트
// ══════════════════════════════════════════════════════
function showToast(msg, duration = 2500) {
  const t = document.getElementById("toast")
  if (!t) return
  t.innerText = msg
  t.classList.add("show")
  setTimeout(() => t.classList.remove("show"), duration)
}

// ══════════════════════════════════════════════════════
//  프로필 로드
// ══════════════════════════════════════════════════════
async function loadProfile(user) {
  const snap = await getDoc(doc(db, "users", user.uid))
  if (!snap.exists()) return
  myUid  = user.uid
  myData = snap.data()

  // 닉네임
  const nickEl = document.getElementById("nickname")
  if (nickEl) nickEl.textContent = myData?.nickname ?? "—"

  // 칭호
  const titleEl = document.getElementById("active-title")
  if (titleEl) titleEl.textContent = myData?.activeTitle ?? "칭호 없음"

  // ZP
  const coinsEl = document.getElementById("coins")
  if (coinsEl) coinsEl.textContent = `${(myData?.coins ?? 0).toLocaleString()} ZP`

  // 갤러리
  const gallery = document.getElementById("gallery")
  const entries = Array.isArray(myData.entry) ? myData.entry : []
  if (gallery) {
    if (entries.length === 0) {
      gallery.innerHTML = '<div class="gallery-empty">등록된 엔트리가 없어요.</div>'
    } else {
      entries.forEach(e => {
        const url = e?.portrait ?? ""
        if (!url) return
        const img = document.createElement("img")
        img.src = url
        img.alt = "포트레이트"
        gallery.appendChild(img)
      })
    }
  }

  // 관리자 패널
  if (myData?.role === "admin") {
    const panel = document.getElementById("admin-panel")
    if (panel) panel.style.display = "block"
  }
}

// ══════════════════════════════════════════════════════
//  관리자: 전체 발송 토글
// ══════════════════════════════════════════════════════
window.apToggleAll = function(cb) {
  apIsAll = cb.checked
  const input  = document.getElementById("ap-recv")
  const addBtn = input.nextElementSibling
  input.disabled  = apIsAll
  addBtn.disabled = apIsAll

  if (apIsAll) {
    apRecipients = []
    document.getElementById("ap-tags").innerHTML =
      '<span style="font-size:13px;color:var(--green-dark);">✅ 전체 유저에게 발송</span>'
  } else {
    apRenderTags()
  }
}

// ══════════════════════════════════════════════════════
//  관리자: 수신자 추가
// ══════════════════════════════════════════════════════
window.apAdd = async function() {
  const nickname = document.getElementById("ap-recv").value.trim()
  if (!nickname) { showToast("닉네임을 입력해주세요!"); return }

  const allSnap = await getDocs(collection(db, "users"))
  const found   = allSnap.docs.find(d => d.data().nickname === nickname)

  if (!found)                                     { showToast("그런 유저는 없어요!"); return }
  if (found.id === myUid)                         { showToast("자기 자신은 안 돼요!"); return }
  if (apRecipients.find(r => r.uid === found.id)) { showToast("이미 추가됐어요!"); return }

  apRecipients.push({ uid: found.id, nickname: found.data().nickname })
  document.getElementById("ap-recv").value = ""
  apRenderTags()
}

function apRenderTags() {
  const el = document.getElementById("ap-tags")
  if (apRecipients.length === 0) {
    el.innerHTML = '<span style="color:var(--gray-400);font-size:13px;">수신자를 추가해주세요</span>'
    return
  }
  el.innerHTML = apRecipients.map(r => `
    <span class="ap-tag">
      ${r.nickname}
      <button onclick="apRemove('${r.uid}')">×</button>
    </span>
  `).join("")
}

window.apRemove = function(uid) {
  apRecipients = apRecipients.filter(r => r.uid !== uid)
  apRenderTags()
}

// ══════════════════════════════════════════════════════
//  관리자: 탭 전환
// ══════════════════════════════════════════════════════
window.apSwitch = function(type) {
  apMailType = type
  const showLetter = (type === "letter" || type === "both")
  const showItem   = (type === "item"   || type === "both")
  document.getElementById("ap-form-letter").style.display = showLetter ? "" : "none"
  document.getElementById("ap-form-item").style.display   = showItem   ? "" : "none"
  ;["letter", "item", "both"].forEach(t => {
    document.getElementById(`ap-tab-${t}`).className =
      "ap-tab" + (t === type ? " on" : "")
  })
  const titleRow = document.getElementById("ap-title-row")
  if (titleRow) titleRow.style.display = (type === "both") ? "none" : ""
}

// ══════════════════════════════════════════════════════
//  관리자: 아이템 셀렉트 변경
// ══════════════════════════════════════════════════════
window.apItemChange = function() {
  const val    = document.getElementById("ap-item-type").value
  const custom = document.getElementById("ap-custom")
  const showInput = ["custom_ingredient", "custom_etc", "custom_poppin"].includes(val)
  custom.style.display = showInput ? "" : "none"
  if (!showInput) custom.value = ""
  custom.placeholder = val === "custom_poppin" ? "포핀 이름 입력" : "아이템 이름 입력"
}

// ══════════════════════════════════════════════════════
//  아이템 객체 생성 헬퍼
// ══════════════════════════════════════════════════════
function buildGItem(now) {
  const val = document.getElementById("ap-item-type").value

  if (val === "ingredient_good") return { type: "ingredient", name: "좋은 조미료", at: now }
  if (val === "ingredient_bad")  return { type: "ingredient", name: "이상한 조미료", at: now }
  if (val === "title_ticket")    return { type: "title_ticket", name: "칭호 선택권[진짜 자유]", at: now }

  const name = document.getElementById("ap-custom").value.trim()
  if (!name) return null

  if (val === "custom_poppin") return { type: "poppin", pType: "poppin", name, emoji: "🧁", at: now }
  return { type: "ingredient", name, at: now }
}

// ══════════════════════════════════════════════════════
//  관리자: 발송
// ══════════════════════════════════════════════════════
window.apSend = async function() {
  const resultEl = document.getElementById("ap-result")
  const sendBtn  = document.getElementById("ap-send")
  resultEl.innerText = "발송 중..."
  sendBtn.disabled   = true

  // 수신자 결정
  let targets = []
  if (apIsAll) {
    const allSnap = await getDocs(collection(db, "users"))
    targets = allSnap.docs
      .filter(d => d.id !== myUid)
      .map(d => ({ uid: d.id, nickname: d.data().nickname ?? "" }))
  } else {
    if (apRecipients.length === 0) {
      showToast("수신자를 선택해주세요!")
      resultEl.innerText = ""; sendBtn.disabled = false; return
    }
    targets = apRecipients
  }

  const now    = Date.now()
  const sender = myData?.nickname ?? "운영자"
  let mailItem = null

  if (apMailType === "letter") {
    const title = document.getElementById("ap-title").value.trim()
    const text  = document.getElementById("ap-body").value.trim()
    if (!title || !text) {
      showToast("제목이랑 내용을 입력해주세요!")
      resultEl.innerText = ""; sendBtn.disabled = false; return
    }
    mailItem = { type: "letter", fromName: sender, title, text, at: now, read: false }

  } else if (apMailType === "item") {
    const gItem = buildGItem(now)
    if (!gItem) {
      showToast("아이템 이름을 입력해주세요!")
      resultEl.innerText = ""; sendBtn.disabled = false; return
    }
    mailItem = { type: "gift", item: gItem, fromNickname: sender, at: now, read: false }

  } else {
    // both
    const text  = document.getElementById("ap-body").value.trim()
    const gItem = buildGItem(now)
    if (!gItem) {
      showToast("아이템 이름을 입력해주세요!")
      resultEl.innerText = ""; sendBtn.disabled = false; return
    }
    mailItem = { type: "gift", item: gItem, fromNickname: sender, message: text, at: now, read: false }
  }

  try {
    await Promise.all(
      targets.map(t =>
        setDoc(doc(db, "users", t.uid), { inbox: arrayUnion(mailItem) }, { merge: true })
      )
    )
    resultEl.innerText = `✅ ${targets.length}명 발송 완료!`
    showToast(`📮 ${targets.length}명에게 발송했어요!`)

    // 폼 초기화
    document.getElementById("ap-title").value             = ""
    document.getElementById("ap-body").value              = ""
    document.getElementById("ap-custom").value            = ""
    document.getElementById("ap-custom").style.display    = "none"
    document.getElementById("ap-item-type").selectedIndex = 0
    apRecipients = []; apIsAll = false
    document.getElementById("ap-all").checked              = false
    document.getElementById("ap-recv").disabled            = false
    document.getElementById("ap-recv").nextElementSibling.disabled = false
    apRenderTags()

  } catch (e) {
    console.error(e)
    resultEl.innerText = "❌ 발송 실패"
    showToast("발송 실패!")
  }

  sendBtn.disabled = false
}

// ══════════════════════════════════════════════════════
//  초기 로드
// ══════════════════════════════════════════════════════
onAuthStateChanged(auth, user => {
  if (user) loadProfile(user)
  else location.href = "../index.html"
})