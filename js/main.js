import { auth, db } from './firebase.js';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  doc,
  getDoc,
  updateDoc,
  collection,
  getDocs,
  orderBy,
  query,
  limit
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

/* ══════════════════════════════════════
   인증 상태 감지 — 프로필 / 로그인 폼
══════════════════════════════════════ */
onAuthStateChanged(auth, async (user) => {
  if (user) {
    // Firestore에서 프로필 정보 가져오기
    const userSnap = await getDoc(doc(db, 'users', user.uid));
    const userData = userSnap.exists() ? userSnap.data() : {};

    const nickname    = userData.nickname    || '학생';
    const activeTitle = userData.activeTitle || '칭호 없음';
    const coins       = userData.coins       ?? 0;

    // ── 홈페이지 login-container
    const loginContainer = document.getElementById('login-container');
    if (loginContainer) {
      loginContainer.innerHTML = `
        <div class="profile-card">
          <div class="profile-avatar">
            <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 512 512">
              <path d="M0 0h512v512H0z" fill="none"/>
              <path fill="#8eb998" d="M256 48C141.31 48 48 141.31 48 256s93.31 208 208 208s208-93.31 208-208S370.69 48 256 48m2 96a72 72 0 1 1-72 72a72 72 0 0 1 72-72m-2 288a175.55 175.55 0 0 1-129.18-56.6C135.66 329.62 215.06 320 256 320s120.34 9.62 129.18 55.39A175.52 175.52 0 0 1 256 432"/>
            </svg>
          </div>
          <div class="profile-info">
            <div class="profile-name">${nickname}</div>
            <div class="profile-title">${activeTitle}</div>
            <div class="profile-coins">
              <span class="coin-icon">🪙</span>
              <span>${coins.toLocaleString()} 코인</span>
            </div>
          </div>
          <button class="logout-btn" id="logout-btn">로그아웃</button>
        </div>
      `;
      document.getElementById('logout-btn').addEventListener('click', () => signOut(auth));
    }

    // ── 게임 기록 (battle 페이지 등에서 사용)
    loadGameLogs();

  } else {
    // ── 홈페이지 로그인 폼
    const loginContainer = document.getElementById('login-container');
    if (loginContainer) {
      loginContainer.innerHTML = `
        <div class="login-form">
          <div class="login-title">로그인</div>
          <input type="email" id="login-email" placeholder="이메일" />
          <input type="password" id="login-password" placeholder="비밀번호" />
          <button class="login-btn" id="login-btn">로그인</button>
          <div id="login-error" class="login-error"></div>
        </div>
      `;
      document.getElementById('login-btn').addEventListener('click', async () => {
        const email    = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        const errEl    = document.getElementById('login-error');
        try {
          await signInWithEmailAndPassword(auth, email, password);
        } catch {
          errEl.textContent = '이메일 또는 비밀번호가 올바르지 않습니다.';
        }
      });
    }

    // ── 별도 로그인 페이지 (loginBtn ID 사용)
    const loginBtn = document.getElementById('loginBtn');
    if (loginBtn) {
      loginBtn.onclick = async () => {
        const email    = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        try {
          await signInWithEmailAndPassword(auth, email, password);
          location.href = 'main.html';
        } catch {
          alert('아이디 또는 비밀번호를 확인해주세요!');
        }
      };
    }
  }
});

/* ══════════════════════════════════════
   배틀룸 입장
══════════════════════════════════════ */
window.enterRoom = async function(roomNumber) {
  const user = auth.currentUser;
  await updateDoc(doc(db, 'users', user.uid), { room: roomNumber });
  location.href = `pages/battleroom${roomNumber}.html`;
};

/* ══════════════════════════════════════
   게임 기록 불러오기
   (battleroom1~3 각 방의 games 컬렉션, 최근 20개씩)
══════════════════════════════════════ */
async function loadGameLogs() {
  const list  = document.getElementById('game-log-list');
  const empty = document.getElementById('game-log-empty');
  if (!list) return; // 해당 요소 없는 페이지면 스킵

  const rooms     = ['battleroom1', 'battleroom2', 'battleroom3'];
  const allGames  = [];

  for (const roomId of rooms) {
    try {
      const q    = query(collection(db, 'rooms', roomId, 'games'), orderBy('createdAt', 'desc'), limit(20));
      const snap = await getDocs(q);
      snap.forEach(d => allGames.push({ roomId, gameId: d.id, ...d.data() }));
    } catch {
      // 해당 방에 games 없으면 스킵
    }
  }

  // createdAt 내림차순 정렬
  allGames.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

  if (allGames.length === 0) {
    if (empty) empty.innerText = '게임 기록 없음';
    return;
  }

  list.innerHTML = '';

  allGames.forEach(game => {
    const p1     = game.p1 ?? '???';
    const p2     = game.p2 ?? '???';
    const winner = game.winner ?? null;
    const date   = game.createdAt
      ? new Date(game.createdAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      : '';

    const item = document.createElement('div');
    item.className = 'game-log-item';
    item.innerHTML = `
      <span class="game-log-vs">${p1} vs ${p2}${winner ? `　<span style="color:#fbb917;font-size:11px;">🏆 ${winner}</span>` : ''}</span>
      <span class="game-log-meta">${game.roomId} · ${date}</span>
    `;
    item.onclick = () => openLogModal(game);
    list.appendChild(item);
  });
}

/* ══════════════════════════════════════
   게임 로그 모달
══════════════════════════════════════ */
function openLogModal(game) {
  const modal = document.getElementById('log-modal');
  const title = document.getElementById('log-modal-title');
  const body  = document.getElementById('log-modal-body');
  if (!modal || !title || !body) return;

  title.innerText = `${game.p1 ?? '???'} vs ${game.p2 ?? '???'}`;
  body.innerHTML  = '';

  const logs = (game.logs ?? []).slice().sort((a, b) => a.ts - b.ts);
  if (logs.length === 0) {
    body.innerHTML = "<p style='color:#555'>로그 없음</p>";
  } else {
    logs.forEach(l => {
      const p = document.createElement('p');
      p.textContent = l.text;
      body.appendChild(p);
    });
  }

  modal.classList.add('open');
}

// 모달 닫기
const closeBtn = document.getElementById('log-modal-close');
const logModal = document.getElementById('log-modal');
if (closeBtn) closeBtn.onclick = () => logModal.classList.remove('open');
if (logModal) logModal.onclick = (e) => { if (e.target === e.currentTarget) e.currentTarget.classList.remove('open'); };

/* ══════════════════════════════════════
   달력 렌더링
══════════════════════════════════════ */
function renderCalendar() {
  const container = document.getElementById('calendar');
  if (!container) return;

  const now      = new Date();
  const year     = now.getFullYear();
  const month    = now.getMonth();
  const today    = now.getDate();
  const firstDay = new Date(year, month, 1).getDay();
  const lastDate = new Date(year, month + 1, 0).getDate();

  const monthNames = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
  const dayNames   = ['일','월','화','수','목','금','토'];

  let html = `
    <div class="calendar-header">
      <span class="cal-year">${year}년</span>
      <span class="cal-month">${monthNames[month]}</span>
    </div>
    <div class="calendar-grid">
  `;

  dayNames.forEach((d, i) => {
    const cls = i === 0 ? 'day-name sunday' : i === 6 ? 'day-name saturday' : 'day-name';
    html += `<div class="${cls}">${d}</div>`;
  });

  for (let i = 0; i < firstDay; i++) html += `<div class="cal-day empty"></div>`;

  for (let d = 1; d <= lastDate; d++) {
    const dow = (firstDay + d - 1) % 7;
    let cls = 'cal-day';
    if (d === today) cls += ' today';
    if (dow === 0)   cls += ' sunday';
    if (dow === 6)   cls += ' saturday';
    html += `<div class="${cls}">${d}</div>`;
  }

  html += `</div>`;
  container.innerHTML = html;
}

/* ══════════════════════════════════════
   급식 렌더링
══════════════════════════════════════ */
function renderMeal() {
  const container = document.getElementById('meal-container');
  if (!container) return;

  const MEAL_MENU = [
    '흑미밥',
    '콩나물국(5)',
    '돈육삼겹보쌈(5.6.10.13)',
    '상추+쌈장(5.6)',
    '매실양념무말랭이',
    '보쌈김치(9)',
    '친환경과일(13)',
  ];

  container.innerHTML = `
    <div class="meal-type">중식</div>
    <ul class="meal-list">
      ${MEAL_MENU.map(d => `<li>${d}</li>`).join('')}
    </ul>
  `;
}

/* ══════════════════════════════════════
   검색창 포커스 효과 (데스크탑 전용)
══════════════════════════════════════ */
function initSearch() {
  const searchWrap  = document.getElementById('search-wrap');
  const searchInput = document.getElementById('search-input');
  if (!searchInput || !searchWrap) return;
  if (window.innerWidth > 768) {
    searchInput.addEventListener('focus', () => searchWrap.classList.add('focused'));
    searchInput.addEventListener('blur',  () => searchWrap.classList.remove('focused'));
  }
}

/* ══════════════════════════════════════
   초기화
══════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  renderCalendar();
  renderMeal();
  initSearch();
});