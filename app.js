const $ = (id) => document.getElementById(id);
const CIRC = 515.22;
const SUBJECTS = ['Physics', 'Chemistry', 'Maths'];
const STORAGE_KEY = 'jee_pomodoro_flow_v4';

const els = {
  menuBtn: $('menuBtn'),
  aboutBtn: $('aboutBtn'),
  drawer: $('drawer'),
  drawerBackdrop: $('drawerBackdrop'),
  closeDrawerBtn: $('closeDrawerBtn'),
  backupBtn: $('backupBtn'),
  clearDataBtn: $('clearDataBtn'),
  timerPage: $('timerPage'),
  analyticsPage: $('analyticsPage'),
  appTitle: $('appTitle'),
  heroTitle: $('heroTitle'),
  statusPill: $('statusPill'),
  sessionMini: $('sessionMini'),
  timer: $('timer'),
  modeLabel: $('modeLabel'),
  progressRing: $('progressRing'),
  startPauseBtn: $('startPauseBtn'),
  skipBtn: $('skipBtn'),
  resetBtn: $('resetBtn'),
  logBtn: $('logBtn'),
  todayFocus: $('todayFocus'),
  todayQuestions: $('todayQuestions'),
  todaySessions: $('todaySessions'),
  todayBreakdown: $('todayBreakdown'),
  sessionModal: $('sessionModal'),
  closeModalBtn: $('closeModalBtn'),
  cancelLogBtn: $('cancelLogBtn'),
  saveLogBtn: $('saveLogBtn'),
  questionInput: $('questionInput'),
  noteInput: $('noteInput'),
  subjectChips: document.querySelectorAll('#subjectChips .chip'),
  toast: $('toast'),
  todaySessions: $('todaySessions'),
  todayQuestions: $('todayQuestions'),
  todayFocus: $('todayFocus'),
  totalHours: $('totalHours'),
  totalQuestions: $('totalQuestions'),
  topSubject: $('topSubject'),
  currentStreak: $('currentStreak'),
  analyticsTitle: $('analyticsTitle'),
  periodLabel: $('periodLabel'),
  periodChips: $('periodChips'),
  graphArea: $('graphArea'),
  analyticsDetail: $('analyticsDetail'),
  analyticsSubline: $('analyticsSubline'),
  achMadeBy: $('achMadeBy'),
  achJee: $('achJee'),
  achEnayat: $('achEnayat'),
};

const defaultState = {
  focus: 25,
  shortBreak: 5,
  longBreak: 15,
  roundsBeforeLong: 4,
  autoStart: false,
  sound: true,
  pulse: true,
  currentMode: 'focus',
  cycleCount: 1,
  running: false,
  remaining: 25 * 60,
  total: 25 * 60,
  timerCheckpoint: null,
  records: [],
  page: 'timer',
  analyticsView: 'weekly',
  analyticsSelections: { weekly: -1, monthly: -1 },
  titleTapCount: 0,
  lastSubject: 'Physics',
  pendingSession: null,
  streak: 0,
  lastDate: null,
  aboutPulseShown: false,
  achievements: { madeBy: true, jee: true, enayat: false }
};

let state = loadState();
let interval = null;
let wakeLock = null;
let audioCtx = null;
let timerPerfStamp = 0;
let currentSubject = state.lastSubject || 'Physics';
let currentAnalytics = null;
let currentAnalyticsDetail = null;
let titleTapTimer = null;

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(defaultState);
    const parsed = JSON.parse(raw);
    return { ...structuredClone(defaultState), ...parsed };
  } catch {
    return structuredClone(defaultState);
  }
}
function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function fmt(sec) {
  sec = Math.max(0, Math.round(sec));
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
}
function minutesToHuman(mins) {
  if (!mins) return '0m';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}
function dkey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}
function parseDateKey(key) {
  const [y, m, d] = String(key || '').split('-').map(Number);
  if (!y || !m || !d) return new Date(NaN);
  return new Date(y, m - 1, d);
}
function addDays(date, days) {
  const out = new Date(date);
  out.setDate(out.getDate() + days);
  return out;
}
function startOfToday() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function formatHoursLabel(mins) { return minutesToHuman(mins); }
function bucketStats(records) {
  const totalMinutes = records.reduce((a, r) => a + (Number(r.minutes) || 0), 0);
  const questions = records.reduce((a, r) => a + (Number(r.questions) || 0), 0);
  const bySubject = SUBJECTS.reduce((acc, s) => {
    acc[s] = records.filter(r => r.subject === s).reduce((a, r) => a + (Number(r.minutes) || 0), 0);
    return acc;
  }, {});
  return { totalMinutes, questions, bySubject };
}
function startOfMonth(date = new Date()) { return new Date(date.getFullYear(), date.getMonth(), 1); }
function endOfMonth(date = new Date()) { return new Date(date.getFullYear(), date.getMonth() + 1, 0); }

function getRecords() { return Array.isArray(state.records) ? state.records : []; }

function computeCurrentStreak(records = getRecords()) {
  if (!records.length) return 0;
  const dayKeys = new Set(records.map(r => r.date));
  const today = startOfToday();
  const checks = [0, 1]; // today, yesterday if today has no data
  for (const offset of checks) {
    let cursor = new Date(today);
    cursor.setDate(cursor.getDate() - offset);
    let count = 0;
    for (let i = 0; i < 366; i++) {
      const key = dkey(cursor);
      if (!dayKeys.has(key)) break;
      count += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    if (count) return count;
  }
  return 0;
}
function secondsForMode(mode) {
  if (mode === 'focus') return state.focus * 60;
  if (mode === 'short') return state.shortBreak * 60;
  return state.longBreak * 60;
}
function modeName(mode) {
  return mode === 'focus' ? 'Focus' : mode === 'short' ? 'Short break' : 'Long break';
}
function subjectColorClass(subject) {
  return subject === 'Physics' ? 'phy' : subject === 'Chemistry' ? 'chem' : 'math';
}
function showToast(msg, ms = 2200) {
  els.toast.textContent = msg;
  els.toast.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => els.toast.classList.add('hidden'), ms);
}
function openDrawer() {
  els.drawer.classList.remove('hidden');
  els.drawerBackdrop.classList.remove('hidden');
}
function closeDrawer() {
  els.drawer.classList.add('hidden');
  els.drawerBackdrop.classList.add('hidden');
}
function setPage(page) {
  state.page = page;
  els.timerPage.classList.toggle('active', page === 'timer');
  els.analyticsPage.classList.toggle('active', page === 'analytics');
  document.querySelectorAll('.drawer-item[data-page]').forEach(btn => btn.classList.toggle('active', btn.dataset.page === page));
  saveState();
  closeDrawer();
  render();
}
function openModal() {
  els.sessionModal.classList.remove('hidden');
}
function closeModal() {
  els.sessionModal.classList.add('hidden');
}
function renderTimerOnly() {
  els.timer.textContent = fmt(state.remaining);
  const pct = 1 - (state.remaining / state.total);
  els.progressRing.style.strokeDashoffset = String(CIRC * (1 - pct));
  document.title = `${fmt(state.remaining)} • ${modeName(state.currentMode)}`;
}
function updateTodaySummary() {
  const today = dkey(new Date());
  const recs = getRecords().filter(r => r.date === today);
  const focus = recs.reduce((a, r) => a + (Number(r.minutes) || 0), 0);
  const questions = recs.reduce((a, r) => a + (Number(r.questions) || 0), 0);
  els.todayFocus.textContent = minutesToHuman(focus);
  els.todayQuestions.textContent = questions;
  els.todaySessions.textContent = recs.length;

  const subjectTotals = SUBJECTS.map(s => [s, recs.filter(r => r.subject === s).reduce((a, r) => a + (Number(r.minutes) || 0), 0)]);
  els.todayBreakdown.innerHTML = subjectTotals.map(([s, mins]) => `
    <div class="mini-line"><span>${s}</span><strong>${minutesToHuman(mins)}</strong></div>
  `).join('');

  const todayQuestions = questions;
  const enayatUnlocked = todayQuestions >= 100;
  state.achievements.enayat = enayatUnlocked;
  els.achEnayat.classList.toggle('unlocked', enayatUnlocked);
  els.achEnayat.classList.toggle('locked', !enayatUnlocked);
  if (enayatUnlocked) els.achEnayat.textContent = "Enayat's Challenge";
  else els.achEnayat.textContent = "Enayat's Challenge";

  state.streak = computeCurrentStreak(recs);
}
function addRecord({subject, questions, note, minutes, date}) {
  const safeQuestions = Math.max(0, Number.parseInt(questions, 10) || 0);
  const safeMinutes = Math.max(1, Number(minutes) || state.focus);
  const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : dkey(new Date());
  const record = {
    id: (crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(16).slice(2)}`,
    date: safeDate,
    at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    subject: SUBJECTS.includes(subject) ? subject : 'Other',
    questions: safeQuestions,
    note: String(note || '').trim(),
    minutes: safeMinutes,
    mode: 'focus'
  };
  const recs = getRecords();
  recs.unshift(record);
  state.records = recs.slice(0, 1000);
  state.lastSubject = record.subject;
  currentSubject = record.subject;
  saveState();
  updateAchievements();
  if (state.page === 'analytics') renderAnalytics();
}
function updateAchievements() {
  const recs = getRecords();
  const today = dkey(new Date());
  const todayRecs = recs.filter(r => r.date === today);
  const todayQuestions = todayRecs.reduce((a, r) => a + (Number(r.questions) || 0), 0);
  const enayatUnlocked = todayQuestions >= 100;
  state.achievements.enayat = enayatUnlocked;
  els.achEnayat.classList.toggle('unlocked', enayatUnlocked);
  els.achEnayat.classList.toggle('locked', !enayatUnlocked);
}
function buildWeeklyBuckets() {
  const recs = getRecords().filter(r => {
    const d = parseDateKey(r.date);
    return !Number.isNaN(d.getTime());
  });
  if (!recs.length) {
    const end = startOfToday();
    const start = addDays(end, -6);
    return [{ label: 'Week 1', start, end, records: [] }];
  }

  const dates = recs.map(r => parseDateKey(r.date)).filter(d => !Number.isNaN(d.getTime())).sort((a, b) => a - b);
  const first = dates[0];
  const today = startOfToday();
  const diffDays = Math.max(0, Math.floor((today - first) / 86400000));
  const weekCount = Math.max(1, Math.ceil((diffDays + 1) / 7));
  const weeks = [];
  for (let i = 0; i < weekCount; i++) {
    const start = addDays(first, i * 7);
    const end = addDays(start, 6);
    const records = recs.filter(r => {
      const d = parseDateKey(r.date);
      return !Number.isNaN(d.getTime()) && d >= start && d <= end;
    });
    weeks.push({ label: `Week ${i + 1}`, start, end, records });
  }
  return weeks;
}
function buildMonthBuckets() {
  const today = new Date();
  const monthStart = startOfMonth(today);
  const monthEnd = endOfMonth(today);
  const records = getRecords().filter(r => {
    const d = parseDateKey(r.date);
    return d >= monthStart && d <= monthEnd;
  });
  return [{
    label: today.toLocaleDateString([], { month: 'long', year: 'numeric' }),
    start: monthStart,
    end: monthEnd,
    records
  }];
}
function makeDayRows(bucket) {
  const days = [];
  const start = new Date(bucket.start);
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = dkey(d);
    const dayRecords = bucket.records.filter(r => r.date === key);
    const { totalMinutes, questions, bySubject } = bucketStats(dayRecords);
    days.push({
      key,
      short: d.toLocaleDateString([], { weekday: 'short' }),
      label: d.toLocaleDateString([], { month: 'short', day: 'numeric' }),
      totalMinutes,
      questions,
      bySubject
    });
  }
  return days;
}
function makeMonthRows(bucket) {
  const rows = [];
  const monthEnd = bucket.end instanceof Date ? bucket.end : endOfMonth();
  const monthStart = bucket.start instanceof Date ? bucket.start : startOfMonth();
  const monthDays = monthEnd.getDate();
  const boundaries = [7, 14, 21, monthDays];
  let startDay = 1;
  for (let i = 0; i < 4; i++) {
    const segStart = new Date(monthStart.getFullYear(), monthStart.getMonth(), startDay);
    const segEnd = new Date(monthStart.getFullYear(), monthStart.getMonth(), boundaries[i]);
    const records = bucket.records.filter(r => {
      const d = parseDateKey(r.date);
      return !Number.isNaN(d.getTime()) && d >= segStart && d <= segEnd;
    });
    const { totalMinutes, questions, bySubject } = bucketStats(records);
    rows.push({
      key: `${dkey(segStart)}-${dkey(segEnd)}`,
      short: `W${i + 1}`,
      label: `Week ${i + 1}`,
      range: `${segStart.getDate()}–${segEnd.getDate()}`,
      totalMinutes,
      questions,
      bySubject
    });
    startDay = boundaries[i] + 1;
  }
  return rows;
}
function render() {
  const running = state.running;
  els.timer.textContent = fmt(state.remaining);
  els.modeLabel.textContent = modeName(state.currentMode);
  els.sessionMini.textContent = state.currentMode === 'focus'
    ? `Round ${state.cycleCount} of ${state.roundsBeforeLong}`
    : `${modeName(state.currentMode)} break`;
  els.startPauseBtn.textContent = running ? 'Pause' : 'Start';
  els.statusPill.textContent = running ? 'Locked in' : (
    state.pendingSession ? 'Log session' :
    (state.currentMode !== 'focus' && state.remaining === state.total ? 'Break ready' :
      (state.remaining === state.total ? 'Ready to lock in' : 'Paused'))
  );
  const pct = 1 - (state.remaining / state.total || 1);
  els.progressRing.style.strokeDashoffset = String(CIRC * (1 - clamp(pct, 0, 1)));
  document.body.style.boxShadow = state.pulse ? 'inset 0 0 100px rgba(124,58,237,0.08)' : 'none';

  updateTodaySummary();
  updateStats();
  renderTimerOnly();
  if (state.page === 'analytics') renderAnalytics();
  else renderAchievements();
  saveState();
}
function requestWakeLock() {
  return (async () => {
    try {
      if ('wakeLock' in navigator && !wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      }
    } catch {}
  })();
}
function releaseWakeLock() {
  return (async () => {
    try {
      if (wakeLock) {
        await wakeLock.release();
        wakeLock = null;
      }
    } catch {}
  })();
}

function saveTimerCheckpoint() {
  if (state.running) {
    state.timerCheckpoint = {
      wallClock: Date.now(),
      remaining: state.remaining,
      total: state.total,
      mode: state.currentMode,
      cycleCount: state.cycleCount
    };
  } else {
    state.timerCheckpoint = null;
  }
}

function restoreTimerFromCheckpoint() {
  if (!state.running) return false;
  if (!state.timerCheckpoint || typeof state.timerCheckpoint.wallClock !== 'number') {
    timerPerfStamp = performance.now();
    if (!interval) interval = setInterval(tick, 1000);
    return false;
  }

  const elapsedWall = Math.floor((Date.now() - state.timerCheckpoint.wallClock) / 1000);
  if (elapsedWall > 0) {
    state.remaining = Math.max(0, (Number(state.timerCheckpoint.remaining) || state.remaining) - elapsedWall);
    state.timerCheckpoint.wallClock = Date.now();
    state.timerCheckpoint.remaining = state.remaining;
  }

  timerPerfStamp = performance.now();
  if (!interval) interval = setInterval(tick, 1000);

  if (state.remaining <= 0) {
    completeTimerCycle();
    return true;
  }
  return false;
}

function completeTimerCycle() {
  const finishedMode = state.currentMode;
  celebrate(finishedMode);
  clearInterval(interval);
  interval = null;
  state.running = false;
  timerPerfStamp = 0;
  state.timerCheckpoint = null;
  releaseWakeLock();

  if (finishedMode === 'focus') {
    state.pendingSession = {
      minutes: state.focus,
      nextMode: state.cycleCount % state.roundsBeforeLong === 0 ? 'long' : 'short',
      sessionDate: dkey(new Date())
    };
    state.currentMode = state.pendingSession.nextMode;
    state.total = secondsForMode(state.currentMode);
    state.remaining = state.total;
    openSessionModal();
    render();
    saveState();
  } else {
    state.currentMode = 'focus';
    state.remaining = secondsForMode('focus');
    state.total = state.remaining;
    releaseWakeLock();
    render();
    saveState();
    if (state.autoStart) setTimeout(() => startTimer(), 450);
  }
}
function beep(freq = 880, duration = 0.14) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = freq;
    osc.type = 'sine';
    gain.gain.value = 0.0001;
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    const now = audioCtx.currentTime;
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.start(now);
    osc.stop(now + duration + 0.05);
  } catch {}
}
function celebrate(mode) {
  if (state.sound) beep(mode === 'focus' ? 880 : 660, 0.18);
  if (navigator.vibrate) navigator.vibrate([60, 40, 60]);
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(mode === 'focus' ? 'Focus complete' : 'Break over', {
      body: mode === 'focus' ? 'Log the subject and questions.' : 'Back to work.'
    });
  }
}
function startTimer() {
  if (state.running || state.pendingSession) return;
  state.running = true;
  timerPerfStamp = performance.now();
  saveTimerCheckpoint();
  els.statusPill.textContent = 'Locked in';
  els.startPauseBtn.textContent = 'Pause';
  tick();
  interval = setInterval(tick, 1000);
  requestWakeLock();
  saveState();
}
function pauseTimer() {
  state.running = false;
  timerPerfStamp = 0;
  state.timerCheckpoint = null;
  clearInterval(interval);
  interval = null;
  releaseWakeLock();
  saveState();
  render();
}
function setFocusMode() {
  state.currentMode = 'focus';
  state.total = secondsForMode('focus');
  state.remaining = state.total;
  timerPerfStamp = 0;
  state.timerCheckpoint = null;
}
function setBreakMode() {
  const nextIsLong = state.cycleCount % state.roundsBeforeLong === 0;
  state.currentMode = nextIsLong ? 'long' : 'short';
  state.total = secondsForMode(state.currentMode);
  state.remaining = state.total;
  timerPerfStamp = 0;
  state.timerCheckpoint = null;
  if (!nextIsLong) state.cycleCount += 1;
}
function openSessionModal() {
  els.sessionModal.classList.remove('hidden');
  els.questionInput.value = '';
  els.noteInput.value = '';
  currentSubject = state.lastSubject || 'Physics';
  els.subjectChips.forEach(btn => btn.classList.toggle('active', btn.dataset.subject === currentSubject));
  els.questionInput.focus();
}
function closeSessionModal() {
  els.sessionModal.classList.add('hidden');
}
function finishFocusBlock() {
  state.running = false;
  timerPerfStamp = 0;
  state.timerCheckpoint = null;
  clearInterval(interval);
  interval = null;
  state.pendingSession = {
    minutes: state.focus,
    nextMode: state.cycleCount % state.roundsBeforeLong === 0 ? 'long' : 'short',
    sessionDate: dkey(new Date())
  };
  state.currentMode = state.pendingSession.nextMode;
  state.total = secondsForMode(state.currentMode);
  state.remaining = state.total;
  openSessionModal();
  render();
  saveState();
}
function finishBreak() {
  state.running = false;
  timerPerfStamp = 0;
  state.timerCheckpoint = null;
  clearInterval(interval);
  interval = null;
  setFocusMode();
  if (state.autoStart) setTimeout(() => startTimer(), 500);
  else els.statusPill.textContent = 'Break complete';
  releaseWakeLock();
  render();
}
function savePendingSession(useZeroQuestions = false) {
  if (!state.pendingSession) return;
  const questions = useZeroQuestions ? 0 : Math.max(0, Number.parseInt(els.questionInput.value, 10) || 0);
  const note = els.noteInput.value || '';
  const subject = currentSubject || 'Physics';

  try {
    addRecord({
      subject,
      questions,
      note,
      minutes: state.pendingSession.minutes || state.focus,
      date: state.pendingSession.sessionDate || dkey(new Date())
    });
    showToast(subject === 'Physics' ? 'Physics logged' : `${subject} saved`);
  } catch (err) {
    console.error('Save failed:', err);
    showToast('Save failed — session kept locally');
  } finally {
    const nextMode = state.pendingSession.nextMode || 'short';
    state.pendingSession = null;
    closeSessionModal();
    state.currentMode = nextMode;
    state.total = secondsForMode(nextMode);
    state.remaining = state.total;
    state.lastSubject = subject;
    state.running = false;
    timerPerfStamp = 0;
    state.timerCheckpoint = null;
    clearInterval(interval);
    interval = null;
    saveState();
    render();
    if (state.autoStart) setTimeout(() => startTimer(), 300);
    else els.statusPill.textContent = 'Break ready';
  }
}
function getAnalyticsIndex(view, bucketCount) {
  if (!state.analyticsSelections || typeof state.analyticsSelections !== 'object') {
    state.analyticsSelections = { weekly: -1, monthly: -1 };
  }
  const raw = state.analyticsSelections[view];
  const idx = typeof raw === 'number' ? raw : -1;
  return clamp(idx < 0 ? bucketCount - 1 : idx, 0, bucketCount - 1);
}
function setAnalyticsIndex(view, index) {
  if (!state.analyticsSelections || typeof state.analyticsSelections !== 'object') {
    state.analyticsSelections = { weekly: -1, monthly: -1 };
  }
  state.analyticsSelections[view] = index;
}

function renderAnalyticsDetail(detail, view) {
  if (!els.analyticsDetail) return;
  if (!detail) {
    els.analyticsDetail.innerHTML = '<div><strong>Tap a bar to inspect it.</strong></div><div class="muted">You will see hours, questions, and subject split here.</div>';
    return;
  }
  const split = SUBJECTS.map(s => `<div class="mini-line"><span>${s}</span><strong>${minutesToHuman(detail.bySubject[s] || 0)}</strong></div>`).join('');
  const period = view === 'weekly' ? 'Day' : 'Week';
  const extra = detail.range ? ` • ${detail.range}` : '';
  els.analyticsDetail.innerHTML = `
    <div><strong>${period}: ${detail.label}${extra}</strong></div>
    <div class="muted">${minutesToHuman(detail.totalMinutes)} • ${detail.questions} questions</div>
    <div class="detail-split">${split}</div>
  `;
}

function setAnalyticsDetailFromClick(view, index) {
  const buckets = view === 'monthly' ? buildMonthBuckets() : buildWeeklyBuckets();
  const selectedIndex = getAnalyticsIndex(view, buckets.length);
  const selected = buckets[selectedIndex] || buckets[buckets.length - 1];
  if (!selected) return;

  const rows = view === 'weekly' ? makeDayRows(selected) : makeMonthRows(selected);
  const row = rows[index];
  if (!row) return;

  currentAnalyticsDetail = {
    view,
    index,
    label: row.label,
    totalMinutes: row.totalMinutes,
    questions: row.questions,
    bySubject: row.bySubject,
    range: row.range || ''
  };

  renderAnalytics();
}
function renderPeriodButtons() {
  const view = state.analyticsView === 'monthly' ? 'monthly' : 'weekly';
  const buckets = view === 'weekly' ? buildWeeklyBuckets() : buildMonthBuckets();
  if (!buckets.length) return;
  if (view === 'monthly') {
    els.periodChips.innerHTML = `<button class="chip active" data-period="0">This Month</button>`;
    return;
  }
  const currentIndex = getAnalyticsIndex(view, buckets.length);
  setAnalyticsIndex(view, currentIndex);
  els.periodChips.innerHTML = buckets.map((b, idx) => `<button class="chip ${idx === currentIndex ? 'active' : ''}" data-period="${idx}">${b.label}</button>`).join('');
  els.periodChips.querySelectorAll('[data-period]').forEach(btn => btn.addEventListener('click', () => {
    setAnalyticsIndex(view, Number(btn.dataset.period));
    saveState();
    currentAnalyticsDetail = null;
    renderAnalytics();
  }));
}
function renderAnalytics() {
  const weeklyBuckets = buildWeeklyBuckets();
  const monthlyBuckets = buildMonthBuckets();
  const view = state.analyticsView === 'monthly' ? 'monthly' : 'weekly';
  const buckets = view === 'weekly' ? weeklyBuckets : monthlyBuckets;
  const selectedIndex = getAnalyticsIndex(view, buckets.length);
  setAnalyticsIndex(view, selectedIndex);
  const selected = buckets[selectedIndex] || buckets[buckets.length - 1];
  currentAnalytics = { weeklyBuckets, monthlyBuckets, selected, selectedIndex, view };

  els.analyticsTitle.textContent = view === 'weekly' ? 'Weekly view' : 'Monthly view';
  els.analyticsSubline.textContent = view === 'weekly' ? 'Current week day-wise' : 'Current month week-wise';
  els.periodLabel.textContent = selected ? selected.label : (view === 'weekly' ? 'Week 1' : 'This Month');
  renderPeriodButtons();

  if (!selected) {
    els.graphArea.innerHTML = '<div class="footer-note">No data yet.</div>';
    renderAnalyticsDetail(null, view);
    return;
  }

  const chartRows = view === 'weekly' ? makeDayRows(selected) : makeMonthRows(selected);
  const maxTotal = Math.max(1, ...chartRows.map(d => d.totalMinutes));
  const tickStep = maxTotal <= 90 ? 30 : 60;
  const maxTick = Math.max(tickStep, Math.ceil(maxTotal / tickStep) * tickStep);
  const axisTicks = [];
  for (let t = maxTick; t >= 0; t -= tickStep) axisTicks.push(t);

  els.graphArea.innerHTML = `
    <div class="analytics-chart">
      <div class="chart-axis">
        ${axisTicks.map(min => `<div>${minutesToHuman(min)}</div>`).join('')}
      </div>
      <div class="chart-body">
        <div class="chart-grid">
          ${axisTicks.map(() => '<div class="grid-line"></div>').join('')}
        </div>
        <div class="chart-bars">
          ${chartRows.map((row, idx) => {
            const total = row.totalMinutes;
            const height = Math.max(10, Math.round((total / maxTick) * 190));
            const segments = SUBJECTS.filter(s => row.bySubject[s] > 0).map(sub => {
              const segH = Math.max(6, Math.round((row.bySubject[sub] / Math.max(total, 1)) * height));
              return `<div class="segment ${subjectColorClass(sub)}" style="height:${segH}px" title="${sub}: ${row.bySubject[sub]}m"></div>`;
            }).join('');
            const active = currentAnalyticsDetail && currentAnalyticsDetail.index === idx && currentAnalyticsDetail.view === view ? 'selected' : '';
            return `
              <div class="day-col ${active}" data-chart-index="${idx}" data-chart-view="${view}">
                <div class="bar-wrap">
                  <button type="button" class="bar ${active}" data-chart-index="${idx}" data-chart-view="${view}" style="height:${height}px" title="${row.label} • ${minutesToHuman(total)} • ${row.questions}q">
                    <div class="bar-total">${total ? minutesToHuman(total) : '0m'}</div>
                    ${segments || '<div class="segment" style="height:100%;background:rgba(148,163,184,.16)"></div>'}
                  </button>
                </div>
                <div class="day-name">${row.short}</div>
                <div class="day-qs">${row.questions} q</div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    </div>
  `;

  const selectedDetail = currentAnalyticsDetail && currentAnalyticsDetail.view === view
    ? {
        label: currentAnalyticsDetail.label,
        totalMinutes: currentAnalyticsDetail.totalMinutes,
        questions: currentAnalyticsDetail.questions,
        bySubject: currentAnalyticsDetail.bySubject,
        range: currentAnalyticsDetail.range
      }
    : {
        label: selected.label,
        totalMinutes: chartRows.reduce((a, r) => a + r.totalMinutes, 0),
        questions: chartRows.reduce((a, r) => a + r.questions, 0),
        bySubject: SUBJECTS.reduce((acc, s) => {
          acc[s] = chartRows.reduce((a, r) => a + (r.bySubject[s] || 0), 0);
          return acc;
        }, {})
      };

  renderAnalyticsDetail(selectedDetail, view);

  els.graphArea.querySelectorAll('.bar[data-chart-index]').forEach(node => {
    node.addEventListener('click', () => setAnalyticsDetailFromClick(view, Number(node.dataset.chartIndex)));
  });

  updateStats();
  renderAchievements();
}
function handleTitleTap() {
  state.titleTapCount = (state.titleTapCount || 0) + 1;
  clearTimeout(titleTapTimer);
  titleTapTimer = setTimeout(() => { state.titleTapCount = 0; saveState(); }, 1400);
  if (state.titleTapCount >= 7) {
    state.titleTapCount = 0;
    showToast('Made with ❤️ by Sukirat');
    els.appTitle.textContent = 'Made with ❤️ by Sukirat';
    setTimeout(() => { els.appTitle.textContent = 'JEE Pomodoro Flow'; }, 2800);
    saveState();
  }
}
function maybeUnlockHiddenEggs() {
  const today = dkey(new Date());
  const todayQuestions = getRecords().filter(r => r.date === today).reduce((a, r) => a + (Number(r.questions) || 0), 0);
  if (todayQuestions >= 100) {
    els.achEnayat.textContent = "Enayat's Challenge";
    els.achEnayat.classList.add('unlocked');
  }
}
function renderAchievements() {
  els.achMadeBy.textContent = 'Made by Sukirat';
  els.achJee.textContent = 'JEE mode: on';
  els.achMadeBy.classList.add('unlocked');
  els.achJee.classList.add('unlocked');
  const todayQuestions = getRecords().filter(r => r.date === dkey(new Date())).reduce((a, r) => a + (Number(r.questions) || 0), 0);
  const unlocked = todayQuestions >= 100;
  els.achEnayat.textContent = unlocked ? "Enayat's Challenge" : "Enayat's Challenge (100 q/day)";
  els.achEnayat.classList.toggle('unlocked', unlocked);
  els.achEnayat.classList.toggle('locked', !unlocked);
}
function updateStats() {
  const recs = getRecords();
  const totalMinutes = recs.reduce((a, r) => a + (Number(r.minutes) || 0), 0);
  const totalQuestions = recs.reduce((a, r) => a + (Number(r.questions) || 0), 0);
  const subjectTotals = SUBJECTS.map(s => [s, recs.filter(r => r.subject === s).reduce((a, r) => a + (Number(r.minutes) || 0), 0)]);
  const top = subjectTotals.sort((a, b) => b[1] - a[1])[0]?.[0] || '—';
  els.totalHours.textContent = minutesToHuman(totalMinutes);
  els.totalQuestions.textContent = totalQuestions;
  els.topSubject.textContent = top;
  els.currentStreak.textContent = computeCurrentStreak(recs);
}
function exportBackup() {
  const blob = new Blob([JSON.stringify({ state, records: getRecords() }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `jee-flow-backup-${dkey(new Date())}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
function clearLocalData() {
  if (!confirm('Clear all local study data on this device?')) return;
  state.records = [];
  state.streak = 0;
  state.lastDate = null;
  state.analyticsSelections = { weekly: -1, monthly: -1 };
  state.pendingSession = null;
  state.running = false;
  state.timerCheckpoint = null;
  timerPerfStamp = 0;
  clearInterval(interval);
  interval = null;
  releaseWakeLock();
  saveState();
  render();
  showToast('Local data cleared');
}
function setAnalyticsView(view) {
  state.analyticsView = view === 'monthly' ? 'monthly' : 'weekly';
  currentAnalyticsDetail = null;
  if (!state.analyticsSelections || typeof state.analyticsSelections !== 'object') {
    state.analyticsSelections = { weekly: -1, monthly: -1 };
  }
  saveState();
  document.querySelectorAll('.tab[data-analytics-view]').forEach(btn => btn.classList.toggle('active', btn.dataset.analyticsView === state.analyticsView));
  renderAnalytics();
}
function sanitizeNumbers() {
  state.focus = Math.max(10, Math.min(90, Number(state.focus) || 25));
  state.shortBreak = Math.max(3, Math.min(30, Number(state.shortBreak) || 5));
  state.longBreak = Math.max(5, Math.min(45, Number(state.longBreak) || 15));
  state.roundsBeforeLong = Math.max(2, Math.min(8, Number(state.roundsBeforeLong) || 4));
}
function init() {
  if (!Array.isArray(state.records)) state.records = [];
  if (!state.analyticsSelections || typeof state.analyticsSelections !== 'object') state.analyticsSelections = { weekly: -1, monthly: -1 };
  if (typeof state.analyticsSelections.weekly !== 'number') state.analyticsSelections.weekly = -1;
  if (typeof state.analyticsSelections.monthly !== 'number') state.analyticsSelections.monthly = -1;
  sanitizeNumbers();
  if (!state.total) state.total = secondsForMode(state.currentMode);
  if (!state.remaining) state.remaining = state.total;
  if (state.page !== 'analytics') state.page = 'timer';

  els.timerPage.classList.add('active');
  document.querySelectorAll('.drawer-item[data-page]').forEach(btn => btn.classList.toggle('active', btn.dataset.page === state.page));
  els.analyticsPage.classList.toggle('active', state.page === 'analytics');
  document.querySelectorAll('.tab[data-analytics-view]').forEach(btn => btn.classList.toggle('active', btn.dataset.analyticsView === (state.analyticsView || 'weekly')));

  currentSubject = state.lastSubject || 'Physics';
  currentAnalyticsDetail = null;
  render();

  if (state.running) {
    if (!restoreTimerFromCheckpoint()) {
      timerPerfStamp = performance.now();
      clearInterval(interval);
      interval = setInterval(tick, 1000);
    }
  }

  maybeUnlockHiddenEggs();

  setInterval(() => {
    if (state.running) renderTimerOnly();
  }, 1000);

  window.addEventListener('beforeunload', () => {
    saveTimerCheckpoint();
    saveState();
  });

  window.addEventListener('pagehide', () => {
    saveTimerCheckpoint();
    saveState();
    releaseWakeLock();
  });

  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      saveTimerCheckpoint();
      saveState();
      return;
    }
    if (document.visibilityState === 'visible' && state.running) {
      requestWakeLock();
      if (!restoreTimerFromCheckpoint()) {
        tick();
      }
    }
  });

  window.addEventListener('pageshow', () => {
    if (state.running) {
      requestWakeLock();
      if (!restoreTimerFromCheckpoint()) {
        tick();
      }
    }
  });
}

els.menuBtn.addEventListener('click', openDrawer);
els.aboutBtn.addEventListener('click', openDrawer);
els.closeDrawerBtn.addEventListener('click', closeDrawer);
els.drawerBackdrop.addEventListener('click', closeDrawer);
els.drawer.querySelectorAll('.drawer-item[data-page]').forEach(btn => btn.addEventListener('click', () => setPage(btn.dataset.page)));
els.backupBtn.addEventListener('click', exportBackup);
els.clearDataBtn.addEventListener('click', clearLocalData);

els.appTitle.addEventListener('click', handleTitleTap);
els.heroTitle.addEventListener('click', handleTitleTap);
els.heroTitle.addEventListener('touchstart', () => {
  clearTimeout(titleTapTimer);
  titleTapTimer = setTimeout(() => { state.titleTapCount = 0; }, 1400);
});

els.startPauseBtn.addEventListener('click', () => {
  if (state.pendingSession) return;
  state.running ? pauseTimer() : startTimer();
});
els.skipBtn.addEventListener('click', () => {
  if (state.running) pauseTimer();
  if (state.pendingSession) {
    state.pendingSession = null;
    closeModal();
    state.currentMode = 'focus';
    state.remaining = state.focus * 60;
    state.total = state.remaining;
    timerPerfStamp = 0;
    state.timerCheckpoint = null;
    render();
    return;
  }
  if (state.currentMode === 'focus') {
    const nextIsLong = state.cycleCount % state.roundsBeforeLong === 0;
    state.currentMode = nextIsLong ? 'long' : 'short';
    state.remaining = secondsForMode(state.currentMode);
    state.total = state.remaining;
    if (!nextIsLong) state.cycleCount += 1;
  } else {
    state.currentMode = 'focus';
    state.remaining = secondsForMode('focus');
    state.total = state.remaining;
  }
  state.running = false;
  state.timerCheckpoint = null;
  render();
});
els.resetBtn.addEventListener('click', () => {
  pauseTimer();
  state.currentMode = 'focus';
  state.cycleCount = 1;
  state.pendingSession = null;
  timerPerfStamp = 0;
  state.remaining = secondsForMode('focus');
  state.total = state.remaining;
  closeModal();
  render();
});
els.logBtn.addEventListener('click', () => {
  if (state.running) pauseTimer();
  state.pendingSession = { minutes: state.focus, nextMode: state.cycleCount % state.roundsBeforeLong === 0 ? 'long' : 'short' };
  state.currentMode = state.pendingSession.nextMode;
  state.total = secondsForMode(state.currentMode);
  state.remaining = state.total;
  openSessionModal();
  render();
});

els.closeModalBtn.addEventListener('click', () => savePendingSession(true));
els.cancelLogBtn.addEventListener('click', () => savePendingSession(true));
els.saveLogBtn.addEventListener('click', () => savePendingSession(false));
els.sessionModal.addEventListener('click', (e) => {
  if (e.target === els.sessionModal) savePendingSession(true);
});

els.subjectChips.forEach(btn => btn.addEventListener('click', () => {
  els.subjectChips.forEach(x => x.classList.remove('active'));
  btn.classList.add('active');
  currentSubject = btn.dataset.subject;
}));

document.querySelectorAll('.tab[data-analytics-view]').forEach(btn => {
  btn.addEventListener('click', () => setAnalyticsView(btn.dataset.analyticsView));
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeDrawer();
    if (!els.sessionModal.classList.contains('hidden')) savePendingSession(true);
  }
});

function cleanupAndRefresh() {
  sanitizeNumbers();
  updateTodaySummary();
  updateStats();
  updateAchievements();
  if (state.page === 'analytics') renderAnalytics();
  else renderTimerOnly();
  saveState();
}
init();
cleanupAndRefresh();

// Timer core loop.
function tick() {
  if (!state.running) return;

  const now = performance.now();
  const last = timerPerfStamp || now;
  const elapsed = Math.floor((now - last) / 1000);

  if (elapsed > 0) {
    state.remaining -= elapsed;
    timerPerfStamp = last + (elapsed * 1000);
  } else if (!timerPerfStamp) {
    timerPerfStamp = now;
  }

  if (state.remaining <= 0) {
    completeTimerCycle();
    return;
  }

  saveTimerCheckpoint();
  renderTimerOnly();
  saveState();
}
