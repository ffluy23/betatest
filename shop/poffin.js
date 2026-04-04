// ══════════════════════════════════════════════════════
//  FIREBASE
// ══════════════════════════════════════════════════════
import { auth, db } from "../js/firebase.js"
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js"
import {
  doc, getDoc, updateDoc, arrayUnion, arrayRemove
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js"

// ══════════════════════════════════════════════════════
//  BERRY DATA 
// ══════════════════════════════════════════════════════
  const BASE = 'https://scary-fuchsia-lfntira4xr.edgeone.app/'
  const BERRIES = [
    { id:'cheri',  img: "../img/cheriberry.png",  name:'버치열매', spicy:+1,dry:0, sweet:0, bitter:0, sour:-1 },
    { id:'chesto', img: "../img/chestoberry.png", name:'유루열매', spicy:-1,dry:+1,sweet:0, bitter:0, sour:0  },
    { id:'pecha',  img: "../img/pechaberry.png",  name:'복슝열매', spicy:0, dry:-1,sweet:+1,bitter:0, sour:0  },
    { id:'rawst',  img: "../img/rawstberry.png",  name:'복분열매', spicy:0, dry:0, sweet:-1,bitter:+1,sour:0  },
    { id:'aspear', img: "../img/aspearberry.png", name:'배리열매', spicy:0, dry:0, sweet:0, bitter:-1,sour:+1 },
    { id:'leppa',  img: "../img/leppaberry.png",  name:'과사열매', spicy:+1,dry:-1,sweet:0, bitter:0, sour:0  },
    { id:'figy',   img: "../img/figyberry.png",   name:'무화열매', spicy:+1,dry:0, sweet:0, bitter:0, sour:-1 },
    { id:'wiki',   img: "../img/wikiberry.png",   name:'위키열매', spicy:-1,dry:+1,sweet:0, bitter:0, sour:0  },
    { id:'mago',   img: "../img/magoberry.png",   name:'마고열매', spicy:0, dry:-1,sweet:+1,bitter:0, sour:0  },
    { id:'aguav',  img: "../img/aguavberry.png",  name:'아바열매', spicy:0, dry:0, sweet:-1,bitter:+1,sour:0  },
    { id:'iapapa', img: "../img/iapapaberry.png", name:'파야열매', spicy:0, dry:0, sweet:0, bitter:-1,sour:+1 },
    { id:'razz',   img: "../img/razzberry.png",   name:'라즈열매', spicy:0, dry:+1,sweet:0, bitter:0, sour:-1 },
    { id:'bluk',   img: "../img/blukberry.png",   name:'블리열매', spicy:-1,dry:0, sweet:+1,bitter:0, sour:0  },
    { id:'wepear', img: "../img/wepearberry.png", name:'서배열매', spicy:0, dry:0, sweet:-1,bitter:0, sour:+1 },
  ]

// 열매 이미지 캐시
const IMG_CACHE = {}
BERRIES.forEach(b => {
  const img = new Image()
  img.src = b.img
  IMG_CACHE[b.id] = img
})

// 조미료 이미지
const SEASONING_IMGS = {
  '좋은 조미료':   'https://ugly-scarlet-hx2bncwvha.edgeone.app/조미료.png',
  '이상한 조미료': 'https://enchanting-ivory-wj6hmb7lhu.edgeone.app/이상한%20조미료.png',
}
const SEASONING_IMG_CACHE = {}
Object.entries(SEASONING_IMGS).forEach(([key, src]) => {
  const img = new Image(); img.src = src
  SEASONING_IMG_CACHE[key] = img
})

// ══════════════════════════════════════════════════════
//  POPPIN TYPES
// ══════════════════════════════════════════════════════
const POPPIN_TYPES = {
  perfect: { name:'완벽한 포핀',  emoji:'✨🧁', img:'https://minimal-cyan-zx2lbreiav.edgeone.app/완벽한%20포핀.png',   color:'#FFD700', desc:'맛의 조화가 완벽한 신비한 포핀. 사람도 포켓몬도 모두가 완벽하다고 칭할 맛이야.' },
  sweet:   { name:'단맛 포핀',    emoji:'🩷🧁', img:'https://bumpy-harlequin-usxnltlenr.edgeone.app/단%20맛%20포핀.png',  color:'#FF8FB1', desc:'달콤한 분홍색 포핀. 환상적인 달콤한 맛이 나~' },
  spicy:   { name:'매운맛 포핀',  emoji:'🔴🧁', img:'https://judicial-tan-vxbrbtc2z0.edgeone.app/매운%20맛%20포핀.png',  color:'#FF4500', desc:'한 입 먹으면 입에 불이 날 정도로 매운 붉은 포핀!' },
  dry:     { name:'떫은맛 포핀',  emoji:'🔵🧁', img:'https://yodelling-magenta-yi2sbzc67s.edgeone.app/떫은%20맛%20포핀.png', color:'#6B9FFF', desc:'덜 익은 열매처럼 입 안이 텁텁한 푸른 포핀.' },
  bitter:  { name:'쓴맛 포핀',    emoji:'💚🧁', img:'https://deep-salmon-jb1eoknzvo.edgeone.app/쓴%20맛%20포핀.png',    color:'#4CAF50', desc:'인상이 찌푸려질 만큼 쓴 초록 포핀...' },
  sour:    { name:'신맛 포핀',    emoji:'💛🧁', img:'https://royal-amethyst-qqy94k9zx6.edgeone.app/신%20맛%20포핀.png',  color:'#CC9900', desc:'정신이 번쩍 들 정도로 신 노란 포핀!' },
  mild:    { name:'순한맛 포핀',  emoji:'🌟🧁', img:'https://fancy-cyan-ua9d86wyae.edgeone.app/순한%20맛%20포핀.png',    color:'#C87000', desc:'어린 포켓몬도 먹을 수 있는 황금빛 포핀.' },
  burnt:   { name:'타버린 포핀',  emoji:'🖤🧁', img:'https://modest-scarlet-jay6lxx6ff.edgeone.app/타버린%20포핀.png',   color:'#666',    desc:'까맣게 타버린 포핀. 먹을 수는 있을까…?' },
  bad:     { name:'맛없는 포핀',  emoji:'🩶🧁', img:'https://normal-crimson-jrceuvwifc.edgeone.app/맛%20없는%20포핀.png', color:'#999',    desc:'오묘하게 이상한 맛이 나는 회색빛 포핀.' },
}

// 포핀 이미지 캐시
const POPPIN_IMG_CACHE = {}
Object.entries(POPPIN_TYPES).forEach(([key, val]) => {
  const img = new Image()
  img.src = val.img
  POPPIN_IMG_CACHE[key] = img
})

// ══════════════════════════════════════════════════════
//  CANVAS / RESIZE
// ══════════════════════════════════════════════════════
const canvas  = document.getElementById('gameCanvas')
const ctx     = canvas.getContext('2d')
const wrapper = document.getElementById('gameWrapper')
let CW, CH, POT_CX, POT_CY, POT_RX, POT_RY, SCALE

function resize() {
  CW = wrapper.clientWidth
  CH = wrapper.clientHeight
  canvas.width  = CW
  canvas.height = CH
  SCALE   = Math.min(CW / 700, CH / 600)
  POT_CX  = CW / 2
  POT_CY  = CH * 0.52
  POT_RX  = 175 * SCALE
  POT_RY  = 136 * SCALE
}
resize()
window.addEventListener('resize', resize)

// ══════════════════════════════════════════════════════
//  UI REFS
// ══════════════════════════════════════════════════════
const timerValEl     = document.getElementById('timerVal')
const phaseNameEl    = document.getElementById('phaseName')
const stirHintDir    = document.getElementById('stirHintDir')
const stirSpeedBar   = document.getElementById('stirSpeedBar')
const stirSpeedFill  = document.getElementById('stirSpeedFill')
const rhythmWrap     = document.getElementById('rhythmWrap')
const rhythmZoneEl   = document.getElementById('rhythmZone')
const rhythmCursorEl = document.getElementById('rhythmCursor')
const tapBtn         = document.getElementById('tapBtn')
const scoreScreen    = document.getElementById('scoreScreen')
const splashScreen   = document.getElementById('splashScreen')
const ingScreen      = document.getElementById('ingredientScreen')
const feedbackEl     = document.getElementById('feedback')

// ══════════════════════════════════════════════════════
//  AUTH STATE
// ══════════════════════════════════════════════════════
let myUid  = null
let myData = null
let inventoryItems = []   // type==='ingredient' 인 것들
let usedSeasoning  = null
let seasoningChosen = false
let goodSeasoningUsed = false
let badSeasoningUsed  = false

onAuthStateChanged(auth, async user => {
  if (!user) {
    document.getElementById('loginStatus').textContent = '(로그인하면 인벤토리에 저장돼)'
    return
  }
  myUid = user.uid
  const snap = await getDoc(doc(db, 'users', myUid))
  myData = snap.data()
  loadInventoryItems()
})

function loadInventoryItems() {
  const inv = myData?.inventory ?? []
  inventoryItems = inv
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.type === 'ingredient')
}

// ══════════════════════════════════════════════════════
//  GAME STATE
// ══════════════════════════════════════════════════════
let phase = 'splash'
let selectedBerries = []
let berryScore = 0, stirScore = 0, fireScore = 0
let finalPoppinType = null

// ── Stir ──
const STIR_TIME = 25
let stirTimeLeft = STIR_TIME
let stirGoodTime = 0, stirBadTime = 0
let burnLevel = 0, overflowLevel = 0
let mouseX, mouseY
let prevStirAngle = null, angularVelocity = 0
let bubbles = [], ripples = [], splatParticles = []
let requiredDir = 1, dirChangeTimer = 0, dirChangePeriod = 6

// ── Fire ──
const FIRE_BEATS = 10
let cursor = 0, cursorDir = 1
let beatResult = [], beatIndex = 0
let firePhaseTime = 0, firePhaseBeats = []
let hitCooldown = 0, fireReady = false

let lastTime = 0
let doughColor = { r:255, g:210, b:180 }

// ══════════════════════════════════════════════════════
//  DRAWING — 배경 (주방 타일 느낌)
// ══════════════════════════════════════════════════════
function drawBackground(c, w, h) {
  // 따뜻한 크림 주방 벽
  const g = c.createLinearGradient(0, 0, 0, h)
  g.addColorStop(0, '#FFF5E6')
  g.addColorStop(0.7, '#FFE8C8')
  g.addColorStop(1,   '#F5D5A0')
  c.fillStyle = g
  c.fillRect(0, 0, w, h)

  // 벽 타일 패턴
  const tileW = Math.round(w / 8)
  const tileH = Math.round(tileW * 0.9)
  c.strokeStyle = 'rgba(200,160,100,0.25)'
  c.lineWidth = 1
  for (let row = 0; row * tileH < h * 0.75; row++) {
    for (let col = 0; col * tileW < w; col++) {
      const ox = (row % 2 === 0) ? 0 : tileW / 2
      c.strokeRect(col * tileW + ox, row * tileH, tileW, tileH)
    }
  }

  // 카운터탑
  const counterY = h * 0.78
  const cg = c.createLinearGradient(0, counterY, 0, h)
  cg.addColorStop(0, '#D4956A')
  cg.addColorStop(1, '#B87040')
  c.fillStyle = cg
  c.fillRect(0, counterY, w, h - counterY)

  // 카운터 하이라이트
  c.fillStyle = 'rgba(255,220,160,0.4)'
  c.fillRect(0, counterY, w, 4)

  // 카운터 타일 라인
  c.strokeStyle = 'rgba(100,50,10,0.2)'
  c.lineWidth = 1
  const ctW = w / 6
  for (let i = 0; i < 7; i++) {
    c.beginPath(); c.moveTo(i * ctW, counterY); c.lineTo(i * ctW, h); c.stroke()
  }
}

function drawFlame(c, cx, cy, ry, sc, intensity) {
  if (intensity <= 0) return
  const baseY = cy + ry + 16 * sc
  const cnt   = 3 + Math.floor(intensity * 3)
  for (let i = 0; i < cnt; i++) {
    const ox = (i - cnt / 2) * 20 * sc
    const h  = (18 + intensity * 32 + Math.sin(Date.now() / 140 + i) * 5) * sc
    const g  = c.createRadialGradient(cx + ox, baseY, 0, cx + ox, baseY - h / 2, h)
    g.addColorStop(0,   'rgba(255,230,80,0.95)')
    g.addColorStop(0.4, 'rgba(255,140,30,0.8)')
    g.addColorStop(1,   'rgba(255,60,0,0)')
    c.beginPath()
    c.ellipse(cx + ox, baseY, 10 * sc, h, 0, 0, Math.PI * 2)
    c.fillStyle = g
    c.fill()
  }
}

function drawBowl(c, cx, cy, rx, ry, sc, burn, selBerries) {
  // 그림자
  c.save()
  c.shadowColor = 'rgba(100,50,0,0.35)'
  c.shadowBlur  = 20 * sc
  c.shadowOffsetY = 12 * sc

  // 그릇 외부 — 흰색 도자기
  const pg = c.createLinearGradient(cx - rx, 0, cx + rx, 0)
  pg.addColorStop(0,   '#D8C8B8')
  pg.addColorStop(0.35,'#F8F0E8')
  pg.addColorStop(0.65,'#F0E8DC')
  pg.addColorStop(1,   '#C8B8A8')
  c.fillStyle = pg
  c.beginPath()
  c.ellipse(cx, cy, rx + 8 * sc, ry + 15 * sc, 0, 0, Math.PI * 2)
  c.fill()
  c.restore()

  // 내부 반죽
  c.save()
  c.beginPath()
  c.ellipse(cx, cy - 6 * sc, rx - 10 * sc, ry - 14 * sc, 0, 0, Math.PI * 2)
  c.clip()

  const br = Math.round(doughColor.r - burn * 90)
  const bg = Math.round(doughColor.g - burn * 100)
  const bb = Math.round(doughColor.b - burn * 80)
  c.fillStyle = `rgb(${Math.max(20,br)},${Math.max(10,bg)},${Math.max(10,bb)})`
  c.fillRect(cx - rx, cy - ry - 12 * sc, rx * 2, ry * 2 + 12 * sc)

  // 반죽 광택
  c.globalAlpha = 0.15 + 0.08 * Math.sin(Date.now() / 1400)
  for (let i = 0; i < 3; i++) {
    const swX = cx + Math.cos(Date.now() / 1700 + i * 2.1) * 46 * sc
    const swY = cy - 6 * sc + Math.sin(Date.now() / 1700 + i * 2.1) * 22 * sc
    const sg = c.createRadialGradient(swX, swY, 0, swX, swY, 50 * sc)
    sg.addColorStop(0, 'rgba(255,255,255,0.9)')
    sg.addColorStop(1, 'rgba(255,255,255,0)')
    c.fillStyle = sg
    c.beginPath(); c.arc(swX, swY, 50 * sc, 0, Math.PI * 2); c.fill()
  }
  c.globalAlpha = 1

  // 열매 이미지 둥둥
  if (selBerries.length > 0) {
    const berries = selBerries.map(id => BERRIES.find(b => b.id === id)).filter(Boolean)
    const imgSize = 24 * sc
    berries.forEach((b, i) => {
      const angle = (i / berries.length) * Math.PI * 2 + Date.now() / 2200
      const er  = rx * 0.42
      const ex  = cx + Math.cos(angle) * er
      const ey  = cy - 6 * sc + Math.sin(angle) * er * 0.5
      const img = IMG_CACHE[b.id]
      if (img && img.complete) {
        c.globalAlpha = 0.85
        c.drawImage(img, ex - imgSize / 2, ey - imgSize / 2, imgSize, imgSize)
        c.globalAlpha = 1
      }
    })
  }

  // 기포
  for (const b of bubbles) {
    c.globalAlpha = b.a
    c.beginPath(); c.arc(b.x, b.y, b.r, 0, Math.PI * 2)
    c.strokeStyle = `rgba(255,220,160,${b.a})`; c.lineWidth = 1.5; c.stroke()
    c.globalAlpha = 1
  }
  for (const rp of ripples) {
    c.globalAlpha = rp.a
    c.beginPath(); c.ellipse(rp.x, rp.y, rp.rx, rp.ry, 0, 0, Math.PI * 2)
    c.strokeStyle = `rgba(255,200,120,${rp.a})`; c.lineWidth = 1.5; c.stroke()
    c.globalAlpha = 1
  }

  // 탄 오버레이
  if (burn > 0) {
    c.fillStyle = `rgba(20,10,0,${burn * 0.65})`
    c.fillRect(cx - rx, cy - ry - 12 * sc, rx * 2, ry * 2 + 12 * sc)
  }
  c.restore()

  // 그릇 림 — 파란 줄무늬 도자기 느낌
  const rim = c.createLinearGradient(0, cy - ry - 8 * sc, 0, cy - ry + 10 * sc)
  rim.addColorStop(0,   '#E8E0D4')
  rim.addColorStop(0.5, '#FFFFFF')
  rim.addColorStop(1,   '#C0B8A8')
  c.beginPath()
  c.ellipse(cx, cy - ry + 2 * sc, rx + 2 * sc, 17 * sc, 0, 0, Math.PI * 2)
  c.fillStyle = rim; c.fill()

  // 파란 줄 장식
  c.strokeStyle = '#7BAFD4'; c.lineWidth = 2 * sc
  c.beginPath()
  c.ellipse(cx, cy - ry + 2 * sc, rx - 2 * sc, 13 * sc, 0, 0, Math.PI * 2)
  c.stroke()

  // 손잡이 (꽃 모양)
  for (const side of [-1, 1]) {
    const hx = cx + side * (rx + 7 * sc)
    const hy = cy
    c.beginPath()
    c.ellipse(hx, hy, 18 * sc, 12 * sc, 0, 0, Math.PI * 2)
    const hg = c.createLinearGradient(0, hy - 12 * sc, 0, hy + 12 * sc)
    hg.addColorStop(0, '#F0EAE0')
    hg.addColorStop(1, '#D8D0C0')
    c.fillStyle = hg; c.fill()
    // 줄 장식
    c.strokeStyle = '#7BAFD4'; c.lineWidth = 1.5 * sc
    c.beginPath()
    c.ellipse(hx, hy, 14 * sc, 8 * sc, 0, 0, Math.PI * 2)
    c.stroke()
  }
}

function drawWhisk(c, cx, cy, sc) {
  if (phase !== 'stir') return
  if (!mouseX) return
  const dx    = mouseX - cx
  const dy    = mouseY - (cy - 6 * sc)
  const angle = Math.atan2(dy, dx)
  const dist  = Math.min(Math.hypot(dx, dy), POT_RX - 22 * sc)
  const wx    = cx + Math.cos(angle) * dist
  const wy    = cy - 6 * sc + Math.sin(angle) * dist

  c.save()
  c.translate(wx, wy - 30 * sc)
  c.rotate(angle + Math.PI / 2)

  // 핸들 — 나무 느낌
  const hg = c.createLinearGradient(-3 * sc, 0, 3 * sc, 0)
  hg.addColorStop(0, '#C8844A')
  hg.addColorStop(0.5, '#E8A868')
  hg.addColorStop(1, '#A86030')
  c.fillStyle = hg
  c.beginPath(); c.roundRect(-3 * sc, 0, 6 * sc, 46 * sc, 3 * sc); c.fill()

  // 거품기 원
  c.strokeStyle = '#C8844A'; c.lineWidth = 2 * sc
  for (let i = 0; i < 3; i++) {
    const oy = 46 * sc + i * 7 * sc
    c.beginPath()
    c.ellipse(0, oy + 4 * sc, (4 + i * 2) * sc, 5 * sc, 0, 0, Math.PI * 2)
    c.stroke()
  }
  c.restore()
}

function drawStirHUD(c, cx, cy, ry, sc) {
  if (phase !== 'stir') return
  const speed   = Math.abs(angularVelocity)
  const goodMin = 1.2, goodMax = 5.5
  const actualDir = angularVelocity > 0 ? 1 : -1
  const dirOk  = speed > goodMin && actualDir === requiredDir

  let hint = '천천히 저어줘 🥄', hintColor = '#EEE4BB'
  if      (speed > goodMax) { hint = '너무 빨라! 넘친다구 💦'; hintColor = '#AD3029' }
  else if (dirOk)           { hint = '딱 좋아!';            hintColor = '#7A9445' }

  c.font      = `bold ${Math.round(14 * sc)}px 'M PLUS Rounded 1c',sans-serif`
  c.fillStyle = hintColor
  c.textAlign = 'center'
  c.fillText(hint, cx, cy + ry + 44 * sc)

  // 탄 바
  const bx = 12, by = CH * 0.14, bw = 16 * sc, bh = CH * 0.28
  c.fillStyle = 'rgba(80,40,0,0.3)'
  c.beginPath(); c.roundRect(bx, by, bw, bh, 5); c.fill()
  if (burnLevel > 0) {
    const burnH = burnLevel * bh
    const bg2 = c.createLinearGradient(0, by + bh, 0, by)
    bg2.addColorStop(0, '#AD3029'); bg2.addColorStop(0.5,'#FF8800'); bg2.addColorStop(1,'#FFD700')
    c.fillStyle = bg2
    c.beginPath(); c.roundRect(bx, by + bh - burnH, bw, burnH, 5); c.fill()
  }
  c.font = `${Math.round(10 * sc)}px serif`
  c.fillStyle = '#CC5500'; c.textAlign = 'center'
  c.fillText('🔥', bx + bw / 2, by - 4)
  c.fillText('탐',  bx + bw / 2, by + bh + 12)
}

function drawSplatParticles(c) {
  for (const p of splatParticles) {
    c.globalAlpha = p.a
    c.fillStyle   = p.color
    c.beginPath(); c.arc(p.x, p.y, p.r, 0, Math.PI * 2); c.fill()
    c.globalAlpha = 1
  }
}

// ══════════════════════════════════════════════════════
//  PARTICLES
// ══════════════════════════════════════════════════════
function spawnSplash() {
  const angle = Math.random() * Math.PI * 2
  const sp    = 100 + Math.random() * 170
  splatParticles.push({
    x: POT_CX + Math.cos(angle) * (POT_RX - 20 * SCALE),
    y: POT_CY - 6 * SCALE + Math.sin(angle) * (POT_RY - 16 * SCALE) * 0.55,
    vx: Math.cos(angle) * sp, vy: Math.sin(angle) * sp - 55,
    r: (3 + Math.random() * 5) * SCALE,
    color: `hsl(${30 + Math.random() * 20},80%,55%)`, a: 1,
  })
}
function spawnBubble() {
  bubbles.push({
    x: POT_CX + (Math.random() - 0.5) * (POT_RX - 22 * SCALE) * 1.4,
    y: POT_CY  + (Math.random() - 0.5) * (POT_RY - 16 * SCALE) * 0.55,
    r: (2 + Math.random() * 4) * SCALE,
    speed: (15 + Math.random() * 28) * SCALE,
    a: 0.6 + Math.random() * 0.4,
  })
}
function spawnRipple() {
  ripples.push({
    x: POT_CX + (Math.random() - 0.5) * 60 * SCALE,
    y: POT_CY - 6 * SCALE + (Math.random() - 0.5) * 28 * SCALE,
    rx: 4 * SCALE, ry: 3 * SCALE, a: 0.8,
  })
}

// ══════════════════════════════════════════════════════
//  FLAVOR CALC
// ══════════════════════════════════════════════════════
function calcFlavorProfile(berryIds) {
  const p = { spicy:0, dry:0, sweet:0, bitter:0, sour:0 }
  for (const id of berryIds) {
    const b = BERRIES.find(x => x.id === id)
    if (!b) continue
    for (const k of Object.keys(p)) p[k] += b[k] ?? 0
  }
  for (const k of Object.keys(p)) p[k] = Math.max(0, p[k])
  return p
}

function flavorToDoughColor(berryIds) {
  if (berryIds.length === 0) return { r:255, g:220, b:170 }
  const p = calcFlavorProfile(berryIds)
  const max = Math.max(...Object.values(p), 0.01)
  return {
    r: Math.min(255, Math.max(160, Math.round((p.spicy/max)*255 + (p.sweet/max)*240 + (p.sour/max)*210))),
    g: Math.min(230, Math.max(80,  Math.round((p.sour/max)*200  + (p.bitter/max)*150 + (p.sweet/max)*160))),
    b: Math.min(235, Math.max(80,  Math.round((p.dry/max)*200   + (p.sweet/max)*180 + (p.sour/max)*100))),
  }
}

function determinePoppinType(berryIds, stirScore, fireScore, hasBadSeasoning) {
  if (burnLevel >= 0.65 || (hasBadSeasoning && Math.random() < 0.45)) {
    return hasBadSeasoning && Math.random() < 0.5 ? 'bad' : 'burnt'
  }
  if (hasBadSeasoning && Math.random() < 0.4) {
    return ['bad','burnt','spicy','bitter'][Math.floor(Math.random() * 4)]
  }
  const profile = calcFlavorProfile(berryIds)
  const total   = Object.values(profile).reduce((a, b) => a + b, 0)
  if (total === 0) return (stirScore * 0.5 + fireScore * 0.5) >= 75 ? 'mild' : 'bad'

  const maxVal  = Math.max(...Object.values(profile))
  const winners = Object.entries(profile).filter(([,v]) => v === maxVal)
  const gameScore = stirScore * 0.5 + fireScore * 0.5

  if (winners.length >= 2 && maxVal >= 2 && gameScore >= 80) return 'perfect'
  if (winners.length >= 3 && gameScore >= 65)                return 'perfect'
  if (gameScore < 25) return 'bad'
  return winners[0][0]
}

// ══════════════════════════════════════════════════════
//  INGREDIENT SCREEN
// ══════════════════════════════════════════════════════
const ingCanvas = document.getElementById('ingCanvas')
const ingCtx    = ingCanvas.getContext('2d')
let ingFlyers   = []

function buildIngredientShelf() {
  // 열매 선반
  const shelf = document.getElementById('ingShelfInner')
  shelf.innerHTML = ''
  BERRIES.forEach(b => {
    const btn = document.createElement('div')
    btn.className = 'ing-btn'
    btn.id = 'ing-' + b.id
    btn.innerHTML = `
      <img class="ing-img" src="${b.img}" alt="${b.name}" draggable="false">
      <span class="ing-name">${b.name}</span>
    `
    btn.addEventListener('click',    () => tapBerry(b.id, btn))
    btn.addEventListener('touchend', e  => { e.preventDefault(); tapBerry(b.id, btn) }, { passive: false })
    shelf.appendChild(btn)
  })

  // 조미료 선반
  buildSeasoningShelf()
}

function buildSeasoningShelf() {
  const area = document.getElementById('seasoningShelfInner')
  if (!area) return
  area.innerHTML = ''

  if (inventoryItems.length === 0) {
    area.innerHTML = '<span class="no-seasoning">조미료 없음</span>'
    seasoningChosen = true
    return
  }

  seasoningChosen = false
  inventoryItems.forEach(({ item, index }) => {
    const btn = document.createElement('div')
    btn.className = 'seasoning-btn'
    btn.id = 'seasoning-' + index
    const imgSrc = SEASONING_IMGS[item.name] ?? ''
    btn.innerHTML = `
      <img class="seasoning-img" src="${imgSrc}" alt="${item.name}" draggable="false">
      <span class="seasoning-name">${item.name}</span>
    `
    btn.addEventListener('click',    () => selectSeasoning(item, index, btn))
    btn.addEventListener('touchend', e  => { e.preventDefault(); selectSeasoning(item, index, btn) }, { passive: false })
    area.appendChild(btn)
  })
}

function selectSeasoning(item, index, btn) {
  // 이미 선택된 거 다시 누르면 해제
  if (usedSeasoning && usedSeasoning.index === index) {
    usedSeasoning = null
    goodSeasoningUsed = false
    badSeasoningUsed  = false
    document.querySelectorAll('.seasoning-btn').forEach(b => b.classList.remove('selected'))
    seasoningChosen = false
    return
  }
  usedSeasoning     = { item, index }
  goodSeasoningUsed = item.name === '좋은 조미료'
  badSeasoningUsed  = item.name === '이상한 조미료'
  document.querySelectorAll('.seasoning-btn').forEach(b => b.classList.remove('selected'))
  btn.classList.add('selected')
  seasoningChosen = true
}

function tapBerry(id, btn) {
  if (selectedBerries.includes(id)) return
  if (selectedBerries.length >= 3)  return

  const rect  = btn.getBoundingClientRect()
  const wRect = wrapper.getBoundingClientRect()
  const startX = rect.left - wRect.left + rect.width / 2
  const startY = rect.top  - wRect.top  + rect.height / 2

  const icRect = ingCanvas.getBoundingClientRect()
  ingFlyers.push({ id, startX, startY, t: 0, done: false })
  btn.classList.add('in-flight')
  updateIngUI()
}

function updateIngUI() {
  BERRIES.forEach(b => {
    const btn    = document.getElementById('ing-' + b.id)
    if (!btn) return
    const used   = selectedBerries.includes(b.id)
    const flight = ingFlyers.some(f => f.id === b.id && !f.done)
    btn.classList.toggle('used',      used)
    btn.classList.toggle('in-flight', flight && !used)
    btn.classList.toggle('disabled',  !used && !flight && selectedBerries.length >= 3)
  })

  for (let i = 0; i < 3; i++) {
    const slot  = document.getElementById('slot' + i)
    const bid   = selectedBerries[i]
    const berry = bid ? BERRIES.find(x => x.id === bid) : null
    if (berry) {
      slot.className = 'slot filled'
      slot.innerHTML = `
        <img class="slot-img" src="${berry.img}" alt="${berry.name}" draggable="false">
        <span class="slot-name">${berry.name}</span>
        <span class="slot-remove">✕</span>
      `
      slot.querySelector('.slot-remove').addEventListener('click', e => {
        e.stopPropagation(); removeBerry(bid)
      })
    } else {
      slot.className = 'slot'
      slot.innerHTML = `<span class="slot-empty">?</span>`
    }
  }

  document.getElementById('ingCount').textContent = ` (${selectedBerries.length}/3)`
  doughColor = flavorToDoughColor(selectedBerries)

  const confirmBtn = document.getElementById('confirmIngBtn')
  confirmBtn.disabled = selectedBerries.length === 0
  confirmBtn.textContent = selectedBerries.length === 0
    ? '열매 고르기'
    : `반죽 시작! (${selectedBerries.length}개) →`
}

function removeBerry(id) {
  const idx = selectedBerries.indexOf(id)
  if (idx >= 0) selectedBerries.splice(idx, 1)
  updateIngUI()
}

function ingLoop(ts) {
  if (phase !== 'ingredient') return

  const icW = ingCanvas.width
  const icH = ingCanvas.height
  const sc  = Math.min(icW / 700, icH / 400)
  const cx  = icW / 2
  const cy  = icH * 0.5
  const rx  = 165 * sc
  const ry  = 128 * sc

  ingCtx.clearRect(0, 0, icW, icH)
  drawBackground(ingCtx, icW, icH)
  drawFlame(ingCtx, cx, cy, ry, sc, 0.4)
  drawBowl(ingCtx, cx, cy, rx, ry, sc, 0, selectedBerries)

  const dt = 1 / 60
  const wRect  = wrapper.getBoundingClientRect()
  const icRect = ingCanvas.getBoundingClientRect()

  for (const f of ingFlyers) {
    if (f.done) continue
    f.t = Math.min(f.t + dt * 2.4, 1)

    const sx = f.startX - (icRect.left - wRect.left)
    const sy = f.startY - (icRect.top  - wRect.top)
    const dx = cx, dy = cy
    const mx = (sx + dx) / 2
    const my = Math.min(sy, dy) - icH * 0.18

    const tt = f.t
    const bx = (1-tt)*(1-tt)*sx + 2*(1-tt)*tt*mx + tt*tt*dx
    const by = (1-tt)*(1-tt)*sy + 2*(1-tt)*tt*my + tt*tt*dy

    const berry = BERRIES.find(x => x.id === f.id)
    if (berry) {
      const imgSize = 28 * sc
      const img = IMG_CACHE[f.id]
      if (img && img.complete) {
        ingCtx.globalAlpha = 1 - f.t * 0.35
        ingCtx.drawImage(img, bx - imgSize/2, by - imgSize/2, imgSize, imgSize)
        ingCtx.globalAlpha = 1
      }
    }

    if (f.t >= 1 && !f.done) {
      f.done = true
      selectedBerries.push(f.id)
      updateIngUI()
      spawnSparkleAt(
        icRect.left - wRect.left + cx * (icRect.width  / icW),
        icRect.top  - wRect.top  + cy * (icRect.height / icH)
      )
    }
  }
  ingFlyers = ingFlyers.filter(f => !f.done)
  requestAnimationFrame(ingLoop)
}

function spawnSparkleAt(x, y) {
  const emojis = ['✨','⭐','🌟','💫']
  for (let i = 0; i < 4; i++) {
    const el = document.createElement('div')
    el.className = 'sparkle'
    el.textContent = emojis[Math.floor(Math.random() * emojis.length)]
    el.style.left = (x + (Math.random() - 0.5) * 50) + 'px'
    el.style.top  = (y + (Math.random() - 0.5) * 30) + 'px'
    el.style.fontSize = (12 + Math.random() * 10) + 'px'
    wrapper.appendChild(el)
    setTimeout(() => el.remove(), 1000)
  }
}

function resizeIngCanvas() {
  const area = document.getElementById('ingPotArea')
  ingCanvas.width  = area.clientWidth
  ingCanvas.height = area.clientHeight
}

function showIngredientScreen() {
  phase = 'ingredient'
  phaseNameEl.textContent = '🫐 열매'
  timerValEl.textContent  = '--'
  selectedBerries = []
  ingFlyers = []
  usedSeasoning = null
  goodSeasoningUsed = false
  badSeasoningUsed  = false
  // 조미료 없으면 바로 true
  seasoningChosen = inventoryItems.length === 0 || !myUid

  buildIngredientShelf()
  updateIngUI()
  ingScreen.style.display    = 'flex'
  splashScreen.style.display = 'none'
  scoreScreen.style.display  = 'none'

  requestAnimationFrame(() => {
    resizeIngCanvas()
    requestAnimationFrame(ingLoop)
  })
}

document.getElementById('confirmIngBtn').addEventListener('click', () => {
  if (!seasoningChosen) {
    // 조미료 선택 안 하면 안 넣는 걸로 처리
    seasoningChosen = true
  }
  ingScreen.style.display = 'none'
  startStirPhase()
})


function startStirPhase() {
  phase = 'stir'
  phaseNameEl.textContent = '🥄 반죽'
  stirTimeLeft = STIR_TIME
  stirGoodTime = 0; stirBadTime = 0
  burnLevel = 0; overflowLevel = 0
  bubbles = []; ripples = []; splatParticles = []
  prevStirAngle = null; angularVelocity = 0
  dirChangeTimer = 0; dirChangePeriod = 6
  requiredDir = Math.random() < 0.5 ? 1 : -1
  updateDirHint()
  mouseX = CW / 2; mouseY = CH / 2
  stirSpeedBar.style.display = 'flex'
  stirHintDir.style.display  = 'block'
  showFeedback('빙글빙글 반죽해봐! 🥄', '#8C5B32')
}
 
function updateDirHint() {
  if (requiredDir === 1) {
    stirHintDir.textContent = '→ 시계방향!'
    stirHintDir.style.color = '#7A9445'
  } else {
    stirHintDir.textContent = '← 반시계방향!'
    stirHintDir.style.color = '#4488CC'
  }
}

function updateStir(dt) {
  const dx   = mouseX - POT_CX
  const dy   = mouseY - (POT_CY - 6 * SCALE)
  const dist = Math.hypot(dx, dy)

  if (dist < 26 * SCALE) {
    prevStirAngle = null
  } else {
    const angle = Math.atan2(dy, dx)
    if (prevStirAngle !== null) {
      let dA = angle - prevStirAngle
      while (dA >  Math.PI) dA -= Math.PI * 2
      while (dA < -Math.PI) dA += Math.PI * 2
      angularVelocity = dA / dt
    }
    prevStirAngle = angle
  }

  const speed     = Math.abs(angularVelocity)
  const actualDir = angularVelocity > 0 ? 1 : -1
  const goodMin   = 1.2, goodMax = 5.5
  const dirOk     = speed > goodMin && actualDir === requiredDir

  if (speed > goodMax) {
    overflowLevel = Math.min(1, overflowLevel + dt * 0.16)
    burnLevel     = Math.max(0, burnLevel    - dt * 0.04)
    stirBadTime  += dt
    if (Math.random() < 0.4) spawnSplash()
  } else if (speed > goodMin) {
    if (dirOk) {
      stirGoodTime  += dt
      burnLevel      = Math.max(0, burnLevel    - dt * 0.12)
      overflowLevel  = Math.max(0, overflowLevel - dt * 0.08)
      if (Math.random() < 0.14) spawnRipple()
      if (Math.random() < 0.04) spawnBubble()
    } else {
      burnLevel   = Math.min(1, burnLevel + dt * 0.03)
      stirBadTime += dt * 0.4
    }
  } else {
    burnLevel     = Math.min(1, burnLevel    + dt * 0.065)
    overflowLevel = Math.max(0, overflowLevel - dt * 0.04)
    stirBadTime  += dt * 0.55
  }
  if (Math.random() < 0.03) spawnBubble()

  dirChangeTimer += dt
  if (dirChangeTimer >= dirChangePeriod) {
    dirChangeTimer  = 0
    dirChangePeriod = 4 + Math.random() * 4
    requiredDir    *= -1
    updateDirHint()
  }

  for (const b of bubbles)  { b.y -= b.speed * dt; b.a -= dt * 0.8 }
  bubbles = bubbles.filter(b => b.a > 0)
  for (const r of ripples)  { r.rx += dt * 34 * SCALE; r.ry += dt * 20 * SCALE; r.a -= dt * 1.5 }
  ripples = ripples.filter(r => r.a > 0)
  for (const p of splatParticles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 380 * dt; p.a -= dt * 1.4 }
  splatParticles = splatParticles.filter(p => p.a > 0)

  const speedNorm = Math.min(speed / (goodMax * 1.3), 1)
  stirSpeedFill.style.height = (speedNorm * 100) + '%'
  stirSpeedFill.style.background = speed > goodMax
    ? 'linear-gradient(to top,#AD3029,#FF6600)'
    : speed > goodMin
    ? 'linear-gradient(to top,#44BB44,#88EE44)'
    : 'linear-gradient(to top,#FFAA00,#FFD700)'

  stirTimeLeft -= dt
  timerValEl.textContent = Math.max(0, Math.ceil(stirTimeLeft)) + 's'
  if (stirTimeLeft <= 0) endStirPhase()
}

function endStirPhase() {
  stirSpeedBar.style.display = 'none'
  stirHintDir.style.display  = 'none'

  let ratio = stirGoodTime / STIR_TIME
  if (goodSeasoningUsed) ratio = Math.max(ratio, 0.70)

  const burnP = burnLevel * 0.45
  const ofP   = overflowLevel * 0.3
  stirScore = Math.round(ratio * 100 * (1 - burnP) * (1 - ofP))
  stirScore = Math.max(0, Math.min(100, stirScore))

  let msg, color
  if (burnLevel >= 0.6)        { msg = '타버렸어! 🔥'; color = '#AD3029' }
  else if (overflowLevel >= 0.6){ msg = '넘쳤어! 💦'; color = '#A9B6C4' }
  else if (stirScore >= 70)    { msg = '완벽해!';   color = '#7A9445' }
  else                         { msg = '그럭저럭...';     color = '#CC8800' }

  showFeedback(msg, color)
  setTimeout(() => startFirePhase(), 1800)
}


function startFirePhase() {
  phase = 'fire'
  phaseNameEl.textContent = '🔥 불조절'
  firePhaseTime = 0; beatIndex = 0; beatResult = []
  cursor = 0; cursorDir = 1; hitCooldown = 0; fireReady = false

  stirSpeedBar.style.display = 'none'
  stirHintDir.style.display  = 'none'

  firePhaseBeats = []
  for (let i = 0; i < FIRE_BEATS; i++) {
    firePhaseBeats.push({
      time:      2.0 + i * 2.0,
      zoneStart: 0.22 + Math.random() * 0.38,
      zoneWidth: 0.14 + Math.random() * 0.12,
      speed:     0.007 + Math.random() * 0.008,
    })
  }

  rhythmZoneEl.style.left   = '0%'
  rhythmZoneEl.style.width  = '0%'
  rhythmCursorEl.style.left = '0%'
  rhythmWrap.style.display = 'flex'
  tapBtn.style.display     = 'flex'
  timerValEl.textContent   = `1/${FIRE_BEATS}`

  showFeedback('타이밍을 맞춰봐! 🔥', '#8C5B32')
  setTimeout(() => { fireReady = true }, 1000)
}

function updateFire(dt) {
  firePhaseTime += dt
  if (!fireReady) return

  if (beatIndex < firePhaseBeats.length) {
    const beat = firePhaseBeats[beatIndex]

    if (firePhaseTime >= beat.time - 1.0) {
      rhythmZoneEl.style.left  = (beat.zoneStart * 100) + '%'
      rhythmZoneEl.style.width = (beat.zoneWidth  * 100) + '%'
    } else {
      rhythmZoneEl.style.left  = '0%'
      rhythmZoneEl.style.width = '0%'
    }

    cursor += cursorDir * beat.speed * dt * 60
    if (cursor >= 1) { cursor = 1; cursorDir = -1 }
    if (cursor <= 0) { cursor = 0; cursorDir =  1 }
    rhythmCursorEl.style.left = `calc(${cursor * 100}% - 3.5px)`
    timerValEl.textContent = `${beatIndex + 1}/${FIRE_BEATS}`

    if (firePhaseTime > beat.time + 2.5) {
      beatResult.push('miss')
      showBeatFeedback('MISS 💨', '#AD3029')
      beatIndex++; hitCooldown = 0
    }
  } else {
    endFirePhase()
  }
  if (hitCooldown > 0) hitCooldown -= dt
}

function onTap() {
  if (phase !== 'fire' || !fireReady || hitCooldown > 0) return
  if (beatIndex >= firePhaseBeats.length) return
  const beat = firePhaseBeats[beatIndex]
  if (firePhaseTime < beat.time - 0.5) return

  const inZone     = cursor >= beat.zoneStart && cursor <= beat.zoneStart + beat.zoneWidth
  const centerDist = inZone
    ? Math.abs(cursor - (beat.zoneStart + beat.zoneWidth / 2)) / (beat.zoneWidth / 2) : 1

  if (inZone) {
    if (centerDist < 0.3) { beatResult.push('perfect'); showBeatFeedback('PERFECT! ✨', '#ECBD35') }
    else                  { beatResult.push('good');    showBeatFeedback('GOOD!',    '#7A9445') }
  } else {
    beatResult.push('miss'); showBeatFeedback('MISS', '#AD3029')
  }
  beatIndex++; hitCooldown = 0.4
}

function endFirePhase() {
  if (phase !== 'fire') return   
  phase = 'ending'
  rhythmWrap.style.display = 'none'
  tapBtn.style.display     = 'none'
  let pts = 0
  for (const r of beatResult) { if (r === 'perfect') pts += 10; else if (r === 'good') pts += 6 }
  fireScore = Math.round((pts / (FIRE_BEATS * 10)) * 100)
  if (goodSeasoningUsed) fireScore = Math.max(fireScore, 60)
  setTimeout(() => showResult(), 600)
}


async function showResult() {
  if (phase === 'result') return 
  phase = 'result'

  const pType = determinePoppinType(selectedBerries, stirScore, fireScore, badSeasoningUsed)
  finalPoppinType = POPPIN_TYPES[pType] ?? POPPIN_TYPES['bad']

  const berryWeighted = calcBerryScore()
  const stirWeighted  = Math.round(stirScore * 0.4)
  const fireWeighted  = Math.round(fireScore * 0.3)
  const total         = berryWeighted + stirWeighted + fireWeighted

  document.getElementById('poppinDisplay').innerHTML =
    `<img src="${finalPoppinType.img}" alt="${finalPoppinType.name}" class="poppin-result-img">`
  document.getElementById('poppinName').textContent    = finalPoppinType.name
  document.getElementById('poppinDesc').textContent    = finalPoppinType.desc
  document.getElementById('sc0').textContent = berryWeighted + '점 / 30'
  document.getElementById('sc1').textContent = stirWeighted  + '점 / 40'
  document.getElementById('sc2').textContent = fireWeighted  + '점 / 30'
  document.getElementById('totalScore').textContent = total + '점 / 100'
  document.getElementById('saveStatus').textContent  = '저장 중...'
  scoreScreen.style.display = 'flex'

  await savePoppinToInventory(pType, finalPoppinType.name)

  if (usedSeasoning && myUid) {
    try {
      const inv = myData?.inventory ?? []
      const itemToRemove = inv[usedSeasoning.index]
      if (itemToRemove) {
        await updateDoc(doc(db, 'users', myUid), { inventory: arrayRemove(itemToRemove) })
      }
    } catch(e) { console.warn('조미료 제거 실패', e) }
  }
}

function calcBerryScore() {
  const p     = calcFlavorProfile(selectedBerries)
  const total = Object.values(p).reduce((a, b) => a + b, 0)
  return Math.min(30, total * 7 + selectedBerries.length * 3)
}

async function savePoppinToInventory(pType, pName) {
  if (!myUid) {
    document.getElementById('saveStatus').textContent = '(로그인하면 저장돼!)'
    return
  }
  try {
    const item = {
      type:    'poppin',
      name:    pName    ?? '포핀',
      pType:   pType    ?? 'bad',
      emoji:   finalPoppinType?.emoji ?? '🧁',
      berries: selectedBerries.filter(Boolean),
      at:      Date.now(),
    }
    // undefined 필드 제거
    Object.keys(item).forEach(k => { if (item[k] === undefined) delete item[k] })
    console.log('저장할 item:', item)
    await updateDoc(doc(db, 'users', myUid), { inventory: arrayUnion(item) })
    document.getElementById('saveStatus').textContent = '가방에 저장됐다!'
  } catch(e) {
    console.error('저장 실패:', e)
    document.getElementById('saveStatus').textContent = '저장 실패...'
  }
}

function showFeedback(text, color) {
  feedbackEl.textContent = text; feedbackEl.style.color = color
  feedbackEl.style.opacity = '1'
  setTimeout(() => { feedbackEl.style.opacity = '0' }, 1500)
}
let bfTimer = null
function showBeatFeedback(text, color) {
  feedbackEl.textContent = text; feedbackEl.style.color = color
  feedbackEl.style.opacity = '1'
  if (bfTimer) clearTimeout(bfTimer)
  bfTimer = setTimeout(() => { feedbackEl.style.opacity = '0' }, 700)
}


let flameIntensity = 0.4

function gameLoop(ts) {
  const dt = Math.min((ts - lastTime) / 1000, 0.05)
  lastTime = ts
  ctx.clearRect(0, 0, CW, CH)
  drawBackground(ctx, CW, CH)

  if      (phase === 'stir')   flameIntensity = 0.3 + burnLevel * 0.55
  else if (phase === 'fire')   flameIntensity = 0.2 + cursor * 0.75
  else                         flameIntensity = 0.35

  drawFlame(ctx, POT_CX, POT_CY, POT_RY, SCALE, flameIntensity)
  drawBowl(ctx, POT_CX, POT_CY, POT_RX, POT_RY, SCALE, burnLevel, selectedBerries)
  drawSplatParticles(ctx)
  drawWhisk(ctx, POT_CX, POT_CY, SCALE)
  drawStirHUD(ctx, POT_CX, POT_CY, POT_RY, SCALE)

  if (phase === 'stir') updateStir(dt)
  if (phase === 'fire') updateFire(dt)

  requestAnimationFrame(gameLoop)
}


function getCanvasPos(e) {
  const rect   = canvas.getBoundingClientRect()
  const scaleX = CW / rect.width, scaleY = CH / rect.height
  if (e.touches && e.touches.length > 0) {
    return { x:(e.touches[0].clientX-rect.left)*scaleX, y:(e.touches[0].clientY-rect.top)*scaleY }
  }
  return { x:(e.clientX-rect.left)*scaleX, y:(e.clientY-rect.top)*scaleY }
}

canvas.addEventListener('touchstart', e => {
  if (phase === 'stir') { const p = getCanvasPos(e); mouseX = p.x; mouseY = p.y; prevStirAngle = null }
}, { passive: true })
canvas.addEventListener('touchmove', e => {
  e.preventDefault()
  if (phase === 'stir') { const p = getCanvasPos(e); mouseX = p.x; mouseY = p.y }
}, { passive: false })
canvas.addEventListener('touchend', () => {
  if (phase === 'stir') prevStirAngle = null
}, { passive: true })
canvas.addEventListener('mousemove', e => {
  const p = getCanvasPos(e); mouseX = p.x; mouseY = p.y
})

tapBtn.addEventListener('touchstart', e => { e.preventDefault(); onTap() }, { passive: false })
tapBtn.addEventListener('click', onTap)
document.addEventListener('keydown', e => { if (e.code === 'Space') { e.preventDefault(); onTap() } })


function initGame() {
  stirScore = 0; fireScore = 0; berryScore = 0
  selectedBerries = []; finalPoppinType = null
}

document.getElementById('startBtn').addEventListener('click', () => {
  splashScreen.style.display = 'none'
  initGame()
  lastTime = performance.now()
  requestAnimationFrame(ts => { lastTime = ts; gameLoop(ts) })
  showIngredientScreen()
})

document.getElementById('restartBtn').addEventListener('click', () => {
  scoreScreen.style.display = 'none'
  if (myUid) loadInventoryItems()
  initGame()
  showIngredientScreen()
})


function splashLoop(ts) {
  if (phase !== 'splash') return
  ctx.clearRect(0, 0, CW, CH)
  drawBackground(ctx, CW, CH)
  drawFlame(ctx, POT_CX, POT_CY, POT_RY, SCALE, 0.4)
  drawBowl(ctx, POT_CX, POT_CY, POT_RX, POT_RY, SCALE, 0, [])
  if (Math.random() < 0.04) spawnBubble()
  for (const b of bubbles) { b.y -= b.speed * 0.016; b.a -= 0.016 * 0.8 }
  lastTime = ts
  requestAnimationFrame(splashLoop)
}
requestAnimationFrame(splashLoop)