const $ = (id) => document.getElementById(id);
const CIRC = 515.22;
const SUBJECTS = ['Physics', 'Chemistry', 'Maths'];
const STORAGE_KEY = 'jee_pomodoro_flow_v4';
const RECORDS_KEY = 'jee_pomodoro_flow_v4_records';
const PROFILE_KEY = 'jee_pomodoro_flow_v4_profile';
const DAY_MS = 86400000;
const CLOUD_SYNC_ENABLED = true;
const CLOUD_QUEUE_KEY = 'jee_pomodoro_flow_v4_cloud_queue';
const DEVICE_ID_KEY = 'jee_pomodoro_flow_v4_device_id';
const CLOUD_CLIENT_ID_KEY = DEVICE_ID_KEY; // backward compatibility
const CLOUD_SYNC_DEBOUNCE_MS = 2500;
const CLOUD_SYNC_RETRY_BASE_MS = 2000;
const CLOUD_SYNC_RETRY_MAX_MS = 60000;

const els = {
  menuBtn: $('menuBtn'),
  aboutBtn: $('aboutBtn'),
  profileModal: $('profileModal'),
  profileInput: $('profileInput'),
  profileSaveBtn: $('profileSaveBtn'),
  profileName: $('profileName'),
  leaderboardList: $('leaderboardList'),
  leaderboardUpdatedAt: $('leaderboardUpdatedAt'),
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
  analyticsSessionModal: $('analyticsSessionModal'),
  analyticsSessionDate: $('analyticsSessionDate'),
  analyticsSessionTime: $('analyticsSessionTime'),
  analyticsSessionQuestions: $('analyticsSessionQuestions'),
  analyticsSessionCount: $('analyticsSessionCount'),
  analyticsSubjectQuestions: $('analyticsSubjectQuestions'),
  closeAnalyticsSessionBtn: $('closeAnalyticsSessionBtn'),
  closeAnalyticsSessionFooterBtn: $('closeAnalyticsSessionFooterBtn'),
  deleteAnalyticsSessionBtn: $('deleteAnalyticsSessionBtn'),
  toast: $('toast'),
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
  updatedAt: 0,
  aboutPulseShown: false,
  profile: { name: '', createdAt: 0, updatedAt: 0 },
  achievements: { madeBy: true, jee: true, enayat: false }
};

let state = loadState();
let interval = null;
let wakeLock = null;
let audioCtx = null;
let timerPerfStamp = 0;
let currentSubject = state.lastSubject || 'Physics';
let currentAnalyticsDetail = null;
let currentAnalyticsSession = null;
let titleTapTimer = null;
let savingSession = false;
let cloudSyncReady = null;
let cloudSyncQueued = false;
let cloudSyncTimer = null;
let cloudRetryTimer = null;
let cloudSyncInFlight = false;
let cloudSyncRequested = false;
let cloudLastAppliedAt = 0;
let cloudQueue = null;
let deviceId = null;
let leaderboardRows = [];
let profileModalBusy = false;
let profileHydrationStarted = false;

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return cloneDefaultState();
    const parsed = JSON.parse(raw);
    const storedRecords = loadStoredRecords();
    const next = {
      ...cloneDefaultState(),
      ...parsed,
      records: storedRecords !== null ? storedRecords : parsed.records
    };
    cloudLastAppliedAt = Number(parsed.updatedAt || 0) || 0;
    return normalizeState(next);
  } catch {
    return cloneDefaultState();
  }
}
function loadProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return cloneDefaultState().profile;
    const parsed = JSON.parse(raw);
    return normalizeProfile(parsed);
  } catch {
    return normalizeProfile(null);
  }
}
function saveState(options = {}) {
  try {
    state.updatedAt = Date.now();
    persistLocalState();
    queueCloudSync(options);
    return true;
  } catch (error) {
    logCloud('error', 'Local storage save failed.', error);
    showToast('Storage is full or unavailable. Export a backup soon.');
    return false;
  }
}
function normalizeProfile(profile) {
  const fallback = { name: '', createdAt: 0, updatedAt: 0 };
  if (!profile || typeof profile !== 'object') return fallback;
  return {
    name: String(profile.name || '').trim().slice(0, 40),
    createdAt: Number(profile.createdAt || 0) || 0,
    updatedAt: Number(profile.updatedAt || 0) || 0
  };
}
function saveProfile(profile) {
  try {
    state.profile = normalizeProfile(profile);
    if (!state.profile.createdAt) state.profile.createdAt = Date.now();
    state.profile.updatedAt = Date.now();
    localStorage.setItem(PROFILE_KEY, JSON.stringify(state.profile));
    state.updatedAt = Date.now();
    persistLocalState();
    queueCloudSync({ reason: 'profile-change', immediate: true });
    return true;
  } catch (error) {
    logCloud('error', 'Profile save failed.', error);
    showToast('Could not save your name.');
    return false;
  }
}

function loadStoredRecords() {
  try {
    const raw = localStorage.getItem(RECORDS_KEY);
    if (raw == null) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function saveStoredRecords(records) {
  try {
    localStorage.setItem(RECORDS_KEY, JSON.stringify(Array.isArray(records) ? records : []));
    return true;
  } catch (error) {
    logCloud('warn', 'Could not persist study records separately.', error);
    return false;
  }
}

function persistLocalState() {
  try {
    const { records, ...persistedState } = state;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persistedState));
    saveStoredRecords(records);
    return true;
  } catch (error) {
    logCloud('error', 'Local state persistence failed.', error);
    return false;
  }
}
function cloneDefaultState() {
  return typeof structuredClone === 'function'
    ? structuredClone(defaultState)
    : JSON.parse(JSON.stringify(defaultState));
}
function getCloudSafeState() {
  const snapshot = cloneDefaultState();
  Object.assign(snapshot, state);
  snapshot.timerCheckpoint = state.timerCheckpoint ? { ...state.timerCheckpoint } : null;
  snapshot.pendingSession = state.pendingSession ? { ...state.pendingSession } : null;
  snapshot.records = getRecords().map(record => ({ ...record }));
  snapshot.analyticsSelections = { ...(state.analyticsSelections || { weekly: -1, monthly: -1 }) };
  snapshot.achievements = { ...(state.achievements || cloneDefaultState().achievements) };
  snapshot.updatedAt = state.updatedAt || Date.now();
  snapshot.syncVersion = 1;
  return snapshot;
}
function logCloud(level, message, details) {
  const prefix = '[Pomodoro cloud]';
  if (details !== undefined) console[level](prefix, message, details);
  else console[level](prefix, message);
}
function getDeviceId() {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY) || localStorage.getItem(CLOUD_CLIENT_ID_KEY);
    if (!id) {
      id = (window.crypto && window.crypto.randomUUID)
        ? window.crypto.randomUUID()
        : `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    }
    localStorage.setItem(DEVICE_ID_KEY, id);
    localStorage.setItem(CLOUD_CLIENT_ID_KEY, id);
    return id;
  } catch {
    return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
}
function normalizeCloudQueue(queue) {
  if (!queue || typeof queue !== 'object' || !queue.state) return null;
  return {
    state: normalizeState({ ...cloneDefaultState(), ...queue.state }),
    queuedAt: Number(queue.queuedAt || 0) || Date.now(),
    attempts: Math.max(0, Number.parseInt(queue.attempts, 10) || 0),
    nextAttemptAt: Math.max(0, Number(queue.nextAttemptAt || 0) || 0),
    lastError: String(queue.lastError || ''),
    reason: String(queue.reason || 'state-change')
  };
}
function loadCloudQueue() {
  try {
    const raw = localStorage.getItem(CLOUD_QUEUE_KEY);
    return raw ? normalizeCloudQueue(JSON.parse(raw)) : null;
  } catch (error) {
    logCloud('warn', 'Could not read the local cloud queue.', error);
    return null;
  }
}
function persistCloudQueue() {
  try {
    if (cloudQueue && cloudQueue.state) {
      localStorage.setItem(CLOUD_QUEUE_KEY, JSON.stringify(cloudQueue));
    } else {
      localStorage.removeItem(CLOUD_QUEUE_KEY);
    }
    return true;
  } catch (error) {
    logCloud('warn', 'Could not persist the local cloud queue.', error);
    return false;
  }
}
function clearCloudQueue() {
  cloudQueue = null;
  cloudSyncQueued = false;
  clearTimeout(cloudSyncTimer);
  cloudSyncTimer = null;
  clearTimeout(cloudRetryTimer);
  cloudRetryTimer = null;
  persistCloudQueue();
}
function scheduleCloudRetry(attempts, reason, errorMessage) {
  const delay = Math.min(CLOUD_SYNC_RETRY_MAX_MS, CLOUD_SYNC_RETRY_BASE_MS * (2 ** Math.max(0, attempts - 1)));
  if (cloudQueue) {
    cloudQueue.attempts = attempts;
    cloudQueue.nextAttemptAt = Date.now() + delay;
    cloudQueue.lastError = errorMessage || reason || 'Cloud sync failed';
    persistCloudQueue();
  }
  clearTimeout(cloudRetryTimer);
  cloudRetryTimer = setTimeout(() => {
    void flushCloudSync({ force: true, reason: reason || 'retry' });
  }, delay);
  logCloud('warn', `Cloud sync retry scheduled in ${Math.round(delay / 1000)}s.`, { attempts, reason, errorMessage });
}
function queueCloudSync(options = {}) {
  if (!CLOUD_SYNC_ENABLED) return;
  cloudQueue = {
    state: getCloudSafeState(),
    queuedAt: Date.now(),
    attempts: cloudQueue ? cloudQueue.attempts : 0,
    nextAttemptAt: 0,
    lastError: '',
    reason: options.reason || 'state-change'
  };
  persistCloudQueue();
  clearTimeout(cloudSyncTimer);
  clearTimeout(cloudRetryTimer);
  if (cloudSyncInFlight) cloudSyncRequested = true;
  cloudSyncQueued = true;
  cloudSyncTimer = setTimeout(() => {
    cloudSyncQueued = false;
    void flushCloudSync({ force: Boolean(options.immediate), reason: options.reason || 'state-change' });
  }, options.immediate ? 0 : CLOUD_SYNC_DEBOUNCE_MS);
}
async function ensureCloudSync() {
  if (!CLOUD_SYNC_ENABLED) return null;
  if (!cloudSyncReady) {
    cloudSyncReady = import('./firebase.js').catch((error) => {
      logCloud('error', 'Failed to load Firebase helper.', error);
      cloudSyncReady = null;
      return null;
    });
  }
  return cloudSyncReady;
}
async function hydrateProfileFromCloud() {
  if (profileHydrationStarted) return state.profile;
  profileHydrationStarted = true;
  const localProfile = normalizeProfile(state.profile || loadProfile());
  if (localProfile.name) return localProfile;
  const mod = await ensureCloudSync();
  if (!mod || typeof mod.pullDeviceProfile !== 'function') return localProfile;
  const remoteProfile = await mod.pullDeviceProfile();
  const normalizedRemote = normalizeProfile(remoteProfile);
  if (!normalizedRemote.name) return localProfile;
  state.profile = normalizedRemote;
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(state.profile));
    persistLocalState();
  } catch {}
  if (els.profileName) els.profileName.textContent = normalizedRemote.name;
  if (els.profileModal) closeProfileModal(true);
  render({ skipSave: true });
  return normalizedRemote;
}
async function pushCloudStateNow(reason = 'state-change') {
  const mod = await ensureCloudSync();
  if (!mod || typeof mod.pushCloudState !== 'function') return { ok: false, reason: 'firebase-unavailable' };
  const snapshot = cloudQueue && cloudQueue.state ? cloudQueue.state : getCloudSafeState();
  const result = await mod.pushCloudState(snapshot, { deviceId, reason });
  if (result && result.ok) {
    cloudLastAppliedAt = Number(snapshot.updatedAt || Date.now()) || Date.now();
  }
  return result || { ok: false, reason: 'unknown' };
}
function getStudyTotals() {
  const recs = getRecords();
  return {
    totalMinutes: recs.reduce((a, r) => a + (Number(r.minutes) || 0), 0),
    totalQuestions: recs.reduce((a, r) => a + (Number(r.questions) || 0), 0)
  };
}
async function syncLeaderboardNow(reason = 'state-change') {
  const mod = await ensureCloudSync();
  if (!mod || typeof mod.pushLeaderboardStats !== 'function') return false;
  const profile = normalizeProfile(state.profile || loadProfile());
  if (!profile.name) return false;
  const stats = getStudyTotals();
  const result = await mod.pushLeaderboardStats(profile, stats, {
    deviceId,
    updatedAt: state.updatedAt || Date.now(),
    reason
  });
  return Boolean(result && result.ok);
}
async function refreshLeaderboard(options = {}) {
  const mod = await ensureCloudSync();
  if (!mod || typeof mod.pullLeaderboardStats !== 'function') return leaderboardRows;
  if (!options.force && navigator.onLine === false) return leaderboardRows;
  try {
    leaderboardRows = await mod.pullLeaderboardStats(50);
    renderLeaderboard();
    return leaderboardRows;
  } catch (error) {
    logCloud('error', 'Leaderboard refresh failed.', error);
    return leaderboardRows;
  }
}

function applyCloudSnapshot(remoteState, remoteUpdatedAt, source = 'remote') {
  if (!remoteState || typeof remoteState !== 'object') return false;
  const currentUpdatedAt = Number(state.updatedAt || 0) || 0;
  const nextUpdatedAt = Number(remoteUpdatedAt || remoteState.updatedAt || 0) || 0;
  if (nextUpdatedAt <= currentUpdatedAt) return false;

  const localProfile = normalizeProfile(state.profile || loadProfile());
  const localRecords = Array.isArray(getRecords()) ? getRecords().map(record => ({ ...record })) : [];
  const nextState = normalizeState({ ...cloneDefaultState(), ...remoteState });

  // Preserve a real local profile if the cloud snapshot is an older/legacy payload
  // that does not include a usable name yet.
  const remoteProfile = normalizeProfile(remoteState.profile || null);
  if (localProfile.name && !remoteProfile.name) {
    nextState.profile = localProfile;
  }

  // Keep local records only when the remote snapshot has none. This avoids a
  // stale or partial cloud write from wiping study history after a refresh.
  if (localRecords.length && (!Array.isArray(remoteState.records) || remoteState.records.length === 0)) {
    nextState.records = localRecords.map(normalizeRecord).filter(Boolean);
  }

  state = nextState;
  state.updatedAt = nextUpdatedAt;
  cloudLastAppliedAt = nextUpdatedAt;
  try {
    persistLocalState();
  } catch (error) {
    logCloud('error', `Failed to persist remote ${source} state locally.`, error);
  }
  if (cloudQueue && Number(cloudQueue.state?.updatedAt || 0) <= nextUpdatedAt) {
    clearCloudQueue();
  }
  return true;
}

async function pullCloudStateIfNewer(options = {}) {
  const mod = await ensureCloudSync();
  if (!mod || typeof mod.pullCloudState !== 'function') return false;
  if (!options.force && navigator.onLine === false) return false;
  const remote = await mod.pullCloudState();
  if (!remote || !remote.state) return false;
  const remoteUpdatedAt = Number(remote.updatedAt || remote.state.updatedAt || 0) || 0;
  const localUpdatedAt = Number(state.updatedAt || 0) || 0;
  const queuedUpdatedAt = Number(cloudQueue?.state?.updatedAt || 0) || 0;
  if (remoteUpdatedAt <= Math.max(cloudLastAppliedAt, localUpdatedAt)) return false;
  if (queuedUpdatedAt > remoteUpdatedAt) {
    logCloud('info', 'Keeping queued local state because it is newer than the cloud snapshot.', {
      queuedUpdatedAt,
      remoteUpdatedAt
    });
    return false;
  }
  const changed = applyCloudSnapshot(remote.state, remoteUpdatedAt, 'pull');
  if (changed) {
    logCloud('info', 'Applied newer cloud state locally.', {
      remoteUpdatedAt,
      localUpdatedAt
    });
  }
  return changed;
}
async function flushCloudSync(options = {}) {
  if (!CLOUD_SYNC_ENABLED) return false;
  if (cloudSyncInFlight) {
    cloudSyncRequested = true;
    return false;
  }
  if (!cloudQueue || !cloudQueue.state) {
    if (options.force) return pullCloudStateIfNewer({ force: true, reason: options.reason || 'flush' });
    return false;
  }

  const now = Date.now();
  if (!options.force && cloudQueue.nextAttemptAt && cloudQueue.nextAttemptAt > now) {
    clearTimeout(cloudRetryTimer);
    cloudRetryTimer = setTimeout(() => {
      void flushCloudSync({ force: true, reason: options.reason || 'retry' });
    }, cloudQueue.nextAttemptAt - now);
    return false;
  }

  if (!options.force && navigator.onLine === false) {
    logCloud('warn', 'Offline. Cloud sync deferred.', { reason: options.reason || 'state-change' });
    scheduleCloudRetry((cloudQueue.attempts || 0) + 1, options.reason || 'offline', 'Navigator reports offline');
    return false;
  }

  cloudSyncInFlight = true;
  clearTimeout(cloudSyncTimer);
  cloudSyncTimer = null;
  const queueAtStart = cloudQueue;

  try {
    const result = await pushCloudStateNow(options.reason || 'state-change');
    if (result && result.ok) {
      logCloud('info', 'Cloud sync completed.', { reason: options.reason || 'state-change', updatedAt: cloudLastAppliedAt });
      if (cloudQueue === queueAtStart) {
        clearCloudQueue();
      }
      void syncLeaderboardNow(options.reason || 'state-change');
      void refreshLeaderboard({ force: true });
      return true;
    }

    if (result && result.stale) {
      const applied = applyCloudSnapshot(result.remoteState, result.remoteUpdatedAt, 'stale-cloud');
      if (applied) {
        logCloud('warn', 'Cloud state won the conflict and was applied locally.', result);
      }
      const currentQueuedUpdatedAt = Number(cloudQueue?.state?.updatedAt || 0) || 0;
      if (cloudQueue === queueAtStart || currentQueuedUpdatedAt <= Number(result.remoteUpdatedAt || 0)) {
        clearCloudQueue();
      }
      void refreshLeaderboard({ force: true });
      return Boolean(applied);
    }

    if (cloudQueue) {
      const attempts = (cloudQueue.attempts || 0) + 1;
      scheduleCloudRetry(attempts, options.reason || 'sync-failed', result && (result.error || result.reason));
    }
    return false;
  } catch (error) {
    logCloud('error', 'Unexpected cloud sync failure.', error);
    if (cloudQueue) {
      const attempts = (cloudQueue.attempts || 0) + 1;
      scheduleCloudRetry(attempts, options.reason || 'sync-failed', error && error.message);
    }
    return false;
  } finally {
    cloudSyncInFlight = false;
    if (cloudSyncRequested) {
      cloudSyncRequested = false;
      queueCloudSync({ reason: 'follow-up', immediate: true });
    }
  }
}
async function reconcileCloudState(options = {}) {
  if (!CLOUD_SYNC_ENABLED) return false;
  let changed = false;
  if (cloudQueue && cloudQueue.state) {
    changed = Boolean(await flushCloudSync({ force: Boolean(options.force || navigator.onLine !== false), reason: options.reason || 'reconcile' })) || changed;
  }
  changed = Boolean(await pullCloudStateIfNewer({ force: true, reason: options.reason || 'reconcile' })) || changed;
  return changed;
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
function isDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && !Number.isNaN(parseDateKey(value).getTime());
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
function startOfWeek(date = new Date()) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const mondayOffset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - mondayOffset);
  return d;
}
function formatDateRange(start, end) {
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  const startLabel = start.toLocaleDateString([], sameMonth ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric' });
  const endLabel = end.toLocaleDateString([], sameMonth ? { day: 'numeric' } : { month: 'short', day: 'numeric' });
  return `${startLabel}-${endLabel}`;
}
function getNiceTickStep(maxMinutes) {
  const target = Math.max(15, Math.ceil(Math.max(1, maxMinutes) / 4));
  const steps = [15, 30, 60, 90, 120, 180, 240, 360, 480, 720];
  return steps.find(step => step >= target) || Math.ceil(target / 720) * 720;
}
function bucketStats(records) {
  const totalMinutes = records.reduce((a, r) => a + (Number(r.minutes) || 0), 0);
  const questions = records.reduce((a, r) => a + (Number(r.questions) || 0), 0);
  const bySubject = SUBJECTS.reduce((acc, s) => {
    acc[s] = records.filter(r => r.subject === s).reduce((a, r) => a + (Number(r.minutes) || 0), 0);
    return acc;
  }, {});
  const questionsBySubject = SUBJECTS.reduce((acc, s) => {
    acc[s] = records.filter(r => r.subject === s).reduce((a, r) => a + (Number(r.questions) || 0), 0);
    return acc;
  }, {});
  return { totalMinutes, questions, bySubject, questionsBySubject };
}
function startOfMonth(date = new Date()) { return new Date(date.getFullYear(), date.getMonth(), 1); }
function endOfMonth(date = new Date()) { return new Date(date.getFullYear(), date.getMonth() + 1, 0); }

function safeSubject(subject) {
  return SUBJECTS.includes(subject) ? subject : 'Physics';
}

function normalizeRecord(record) {
  if (!record || typeof record !== 'object') return null;
  const date = isDateKey(record.date) ? record.date : dkey(new Date());
  const minutes = Math.max(1, Math.min(24 * 60, Math.round(Number(record.minutes) || 0)));
  return {
    id: String(record.id || `${Date.now()}_${Math.random().toString(16).slice(2)}`),
    date,
    at: String(record.at || ''),
    subject: safeSubject(record.subject),
    questions: Math.max(0, Math.min(9999, Number.parseInt(record.questions, 10) || 0)),
    note: String(record.note || '').trim().slice(0, 60),
    minutes,
    mode: record.mode === 'focus' ? 'focus' : 'focus'
  };
}

function normalizeState(nextState) {
  const normalized = { ...cloneDefaultState(), ...(nextState && typeof nextState === 'object' ? nextState : {}) };
  normalized.currentMode = ['focus', 'short', 'long'].includes(normalized.currentMode) ? normalized.currentMode : 'focus';
  normalized.analyticsView = normalized.analyticsView === 'monthly' ? 'monthly' : 'weekly';
  normalized.page = normalized.page === 'analytics' ? 'analytics' : 'timer';
  normalized.lastSubject = safeSubject(normalized.lastSubject);
  normalized.analyticsSelections = {
    weekly: Number.isFinite(normalized.analyticsSelections?.weekly) ? normalized.analyticsSelections.weekly : -1,
    monthly: Number.isFinite(normalized.analyticsSelections?.monthly) ? normalized.analyticsSelections.monthly : -1
  };
  normalized.achievements = { ...cloneDefaultState().achievements, ...(normalized.achievements || {}) };
  normalized.profile = normalizeProfile(normalized.profile || loadProfile());
  const seenRecordIds = new Set();
  normalized.records = Array.isArray(normalized.records)
    ? normalized.records
      .map(normalizeRecord)
      .filter(record => {
        if (!record || seenRecordIds.has(record.id)) return false;
        seenRecordIds.add(record.id);
        return true;
      })
      .slice(0, 1000)
    : [];
  normalized.cycleCount = Math.max(1, Math.min(999, Number.parseInt(normalized.cycleCount, 10) || 1));
  normalized.running = Boolean(normalized.running);
  normalized.pendingSession = normalizePendingSession(normalized.pendingSession);
  normalized.timerCheckpoint = normalizeTimerCheckpoint(normalized.timerCheckpoint);
  return normalized;
}

function normalizePendingSession(session) {
  if (!session || typeof session !== 'object') return null;
  return {
    minutes: Math.max(1, Math.min(24 * 60, Math.round(Number(session.minutes) || 25))),
    nextMode: ['short', 'long'].includes(session.nextMode) ? session.nextMode : 'short',
    sessionDate: isDateKey(session.sessionDate) ? session.sessionDate : dkey(new Date()),
    roundCompleted: Math.max(1, Number.parseInt(session.roundCompleted, 10) || 1)
  };
}

function normalizeTimerCheckpoint(checkpoint) {
  if (!checkpoint || typeof checkpoint !== 'object' || typeof checkpoint.wallClock !== 'number') return null;
  return {
    wallClock: checkpoint.wallClock,
    remaining: Math.max(0, Number(checkpoint.remaining) || 0),
    total: Math.max(1, Number(checkpoint.total) || 1),
    mode: ['focus', 'short', 'long'].includes(checkpoint.mode) ? checkpoint.mode : 'focus',
    cycleCount: Math.max(1, Number.parseInt(checkpoint.cycleCount, 10) || 1)
  };
}

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
function nextBreakModeForRound(round = state.cycleCount) {
  return round % state.roundsBeforeLong === 0 ? 'long' : 'short';
}
function advanceCycleAfterFocus(round = state.cycleCount) {
  state.cycleCount = round % state.roundsBeforeLong === 0 ? 1 : round + 1;
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
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
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

  const { bySubject, questionsBySubject } = bucketStats(recs);
  els.todayBreakdown.innerHTML = SUBJECTS.map(s => `
    <div class="mini-line"><span>${s}</span><strong>${minutesToHuman(bySubject[s] || 0)} · ${questionsBySubject[s] || 0} q</strong></div>
  `).join('');

  const todayQuestions = questions;
  const enayatUnlocked = todayQuestions >= 100;
  state.achievements.enayat = enayatUnlocked;
  els.achEnayat.classList.toggle('unlocked', enayatUnlocked);
  els.achEnayat.classList.toggle('locked', !enayatUnlocked);
  if (enayatUnlocked) els.achEnayat.textContent = "Enayat's Challenge";
  else els.achEnayat.textContent = "Enayat's Challenge";

  state.streak = computeCurrentStreak(getRecords());
}
function addRecord({subject, questions, note, minutes, date}) {
  const safeQuestions = Math.max(0, Number.parseInt(questions, 10) || 0);
  const safeMinutes = Math.max(1, Number(minutes) || state.focus);
  const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : dkey(new Date());
  const record = {
    id: (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : `${Date.now()}_${Math.random().toString(16).slice(2)}`,
    date: safeDate,
    at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    subject: safeSubject(subject),
    questions: safeQuestions,
    note: String(note || '').trim(),
    minutes: safeMinutes,
    mode: 'focus'
  };
  const recs = getRecords();
  const previousRecords = recs.slice();
  recs.unshift(record);
  state.records = recs.slice(0, 1000);
  state.lastSubject = record.subject;
  currentSubject = record.subject;
  if (!saveState({ immediate: true, reason: 'record-added' })) {
    state.records = previousRecords;
    throw new Error('Storage unavailable');
  }
  updateAchievements();
  if (state.page === 'analytics') renderAnalytics();
  void syncLeaderboardNow('record-added');
  void refreshLeaderboard();
}
function getRecordsForDate(dateKey) {
  return getRecords().filter(r => r.date === dateKey);
}
function deleteRecordsForDate(dateKey) {
  const nextRecords = getRecords().filter(r => r.date !== dateKey);
  if (nextRecords.length === getRecords().length) return false;
  state.records = nextRecords;
  state.streak = computeCurrentStreak(nextRecords);
  if (currentAnalyticsDetail && currentAnalyticsDetail.date === dateKey) currentAnalyticsDetail = null;
  if (currentAnalyticsSession && currentAnalyticsSession.date === dateKey) currentAnalyticsSession = null;
  saveState({ immediate: true, reason: 'record-deleted' });
  updateAchievements();
  void syncLeaderboardNow('record-deleted');
  void refreshLeaderboard();
  return true;
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
  const currentWeekStart = startOfWeek(startOfToday());
  const dates = recs.map(r => parseDateKey(r.date)).filter(d => !Number.isNaN(d.getTime())).sort((a, b) => a - b);
  const firstWeekStart = dates.length ? startOfWeek(dates[0]) : currentWeekStart;
  const today = startOfToday();
  const weekCount = Math.max(1, Math.floor((currentWeekStart - firstWeekStart) / (DAY_MS * 7)) + 1);
  const weeks = [];
  for (let i = 0; i < weekCount; i++) {
    const start = addDays(firstWeekStart, i * 7);
    const end = addDays(start, 6);
    const records = recs.filter(r => {
      const d = parseDateKey(r.date);
      return !Number.isNaN(d.getTime()) && d >= start && d <= end;
    });
    weeks.push({ label: formatDateRange(start, end), start, end, records, isCurrent: today >= start && today <= end });
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
    const { totalMinutes, questions, bySubject, questionsBySubject } = bucketStats(dayRecords);
    days.push({
      key,
      short: d.toLocaleDateString([], { weekday: 'short' }),
      label: d.toLocaleDateString([], { month: 'short', day: 'numeric' }),
      totalMinutes,
      questions,
      bySubject,
      questionsBySubject
    });
  }
  return days;
}
function makeMonthRows(bucket) {
  const rows = [];
  const monthEnd = bucket.end instanceof Date ? bucket.end : endOfMonth();
  const monthStart = bucket.start instanceof Date ? bucket.start : startOfMonth();
  const monthDays = monthEnd.getDate();
  for (let day = 1; day <= monthDays; day++) {
    const d = new Date(monthStart.getFullYear(), monthStart.getMonth(), day);
    const key = dkey(d);
    const dayRecords = bucket.records.filter(r => r.date === key);
    const { totalMinutes, questions, bySubject, questionsBySubject } = bucketStats(dayRecords);
    rows.push({
      key,
      short: String(day),
      label: d.toLocaleDateString([], { month: 'short', day: 'numeric' }),
      totalMinutes,
      questions,
      bySubject,
      questionsBySubject
    });
  }
  return rows;
}
function render(options = {}) {
  const running = state.running;
  els.timer.textContent = fmt(state.remaining);
  els.modeLabel.textContent = modeName(state.currentMode);
  els.sessionMini.textContent = state.currentMode === 'focus'
    ? `Round ${state.cycleCount} of ${state.roundsBeforeLong}`
    : modeName(state.currentMode);
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
  if (!options.skipSave) saveState();
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

  state.currentMode = state.timerCheckpoint.mode || state.currentMode;
  state.cycleCount = state.timerCheckpoint.cycleCount || state.cycleCount;
  state.total = Math.max(1, Number(state.timerCheckpoint.total) || state.total);
  const elapsedWall = Math.floor((Date.now() - state.timerCheckpoint.wallClock) / 1000);
  if (elapsedWall > 0) {
    state.remaining = Math.max(0, (Number(state.timerCheckpoint.remaining) || state.remaining) - elapsedWall);
    state.timerCheckpoint.wallClock = Date.now();
    state.timerCheckpoint.remaining = state.remaining;
  } else if (elapsedWall < 0) {
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
    const completedRound = state.cycleCount;
    state.pendingSession = {
      minutes: state.focus,
      nextMode: nextBreakModeForRound(completedRound),
      sessionDate: dkey(new Date()),
      roundCompleted: completedRound
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
  clearInterval(interval);
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
function openSessionModal() {
  els.sessionModal.classList.remove('hidden');
  els.sessionModal.setAttribute('aria-hidden', 'false');
  els.questionInput.value = '';
  els.noteInput.value = '';
  currentSubject = safeSubject(state.lastSubject);
  els.subjectChips.forEach(btn => {
    const active = btn.dataset.subject === currentSubject;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
  els.questionInput.focus();
}
function closeSessionModal() {
  els.sessionModal.classList.add('hidden');
  els.sessionModal.setAttribute('aria-hidden', 'true');
}
function savePendingSession() {
  if (!state.pendingSession || savingSession) return;
  savingSession = true;
  els.saveLogBtn.disabled = true;
  const questions = Math.max(0, Number.parseInt(els.questionInput.value, 10) || 0);
  const note = els.noteInput.value || '';
  const subject = currentSubject || 'Physics';
  let saved = false;

  try {
    const completedRound = state.pendingSession.roundCompleted || state.cycleCount;
    addRecord({
      subject,
      questions,
      note,
      minutes: state.pendingSession.minutes || state.focus,
      date: state.pendingSession.sessionDate || dkey(new Date())
    });
    advanceCycleAfterFocus(completedRound);
    saved = true;
    showToast(subject === 'Physics' ? 'Physics logged' : `${subject} saved`);
  } catch (err) {
    console.error('Save failed:', err);
    showToast('Save failed - session kept locally');
  } finally {
    savingSession = false;
    els.saveLogBtn.disabled = false;
    if (saved) {
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
      saveState({ immediate: true, reason: 'session-saved' });
      render();
      void syncLeaderboardNow('session-saved');
      void refreshLeaderboard();
      if (state.autoStart) setTimeout(() => startTimer(), 300);
      else els.statusPill.textContent = 'Break ready';
    }
  }
}
function dismissSessionModal() {
  closeSessionModal();
  render();
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
  const split = SUBJECTS.map(s => {
    const subjectQuestions = detail.questionsBySubject ? detail.questionsBySubject[s] || 0 : 0;
    return `<div class="mini-line"><span>${s}</span><strong>${minutesToHuman(detail.bySubject[s] || 0)} · ${subjectQuestions} q</strong></div>`;
  }).join('');
  const period = detail.kind || 'Day';
  const extra = detail.range ? ` - ${detail.range}` : '';
  els.analyticsDetail.innerHTML = `
    <div><strong>${period}: ${detail.label}${extra}</strong></div>
    <div class="muted">${minutesToHuman(detail.totalMinutes)} - ${detail.questions} questions</div>
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
    date: row.key,
    label: row.label,
    kind: 'Day',
    totalMinutes: row.totalMinutes,
    questions: row.questions,
    bySubject: row.bySubject,
    questionsBySubject: row.questionsBySubject,
    range: row.range || ''
  };

  renderAnalytics();
  openAnalyticsSessionModal(row);
}

function openAnalyticsSessionModal(row) {
  if (!row) return;
  const sessions = getRecordsForDate(row.key);
  currentAnalyticsSession = {
    date: row.key,
    label: row.label,
    totalMinutes: row.totalMinutes,
    questions: row.questions,
    sessions
  };
  if (els.analyticsSessionDate) els.analyticsSessionDate.textContent = row.label;
  if (els.analyticsSessionTime) els.analyticsSessionTime.textContent = minutesToHuman(row.totalMinutes);
  if (els.analyticsSessionQuestions) els.analyticsSessionQuestions.textContent = String(row.questions);
  if (els.analyticsSessionCount) els.analyticsSessionCount.textContent = String(sessions.length);
  if (els.analyticsSubjectQuestions) {
    const subjectStats = bucketStats(sessions);
    els.analyticsSubjectQuestions.innerHTML = SUBJECTS.map(subject => `
      <div class="mini-line"><span>${subject}</span><strong>${subjectStats.questionsBySubject[subject] || 0} q</strong></div>
    `).join('');
  }
  if (els.analyticsSessionModal) {
    els.analyticsSessionModal.classList.remove('hidden');
    els.analyticsSessionModal.setAttribute('aria-hidden', 'false');
  }
}

function closeAnalyticsSessionModal() {
  if (!els.analyticsSessionModal) return;
  els.analyticsSessionModal.classList.add('hidden');
  els.analyticsSessionModal.setAttribute('aria-hidden', 'true');
}

function handleAnalyticsSessionDelete() {
  if (!currentAnalyticsSession) return;
  const { date, label, sessions } = currentAnalyticsSession;
  const count = sessions.length;
  const plural = count === 1 ? 'session' : 'sessions';
  if (!confirm(`Delete ${count} ${plural} for ${label}? This cannot be undone.`)) return;
  if (!deleteRecordsForDate(date)) {
    showToast('No matching session found');
    closeAnalyticsSessionModal();
    render();
    return;
  }
  showToast(`${label} deleted`);
  closeAnalyticsSessionModal();
  currentAnalyticsDetail = null;
  currentAnalyticsSession = null;
  render();
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
  els.analyticsTitle.textContent = view === 'weekly' ? 'Weekly view' : 'Monthly view';
  els.analyticsSubline.textContent = view === 'weekly' ? 'Monday-Sunday day-wise' : 'Current month day-wise';
  els.periodLabel.textContent = selected ? selected.label : (view === 'weekly' ? 'Week 1' : 'This Month');
  renderPeriodButtons();

  if (!selected) {
    els.graphArea.innerHTML = '<div class="footer-note">No data yet.</div>';
    renderAnalyticsDetail(null, view);
    return;
  }

  const chartRows = view === 'weekly' ? makeDayRows(selected) : makeMonthRows(selected);
  const maxTotal = Math.max(1, ...chartRows.map(d => d.totalMinutes));
  const tickStep = getNiceTickStep(maxTotal);
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
            const heightPct = total ? clamp((total / maxTick) * 100, 2, 100) : 0;
            const segments = SUBJECTS.filter(s => row.bySubject[s] > 0).map(sub => {
              const segPct = (row.bySubject[sub] / Math.max(total, 1)) * 100;
              return `<div class="segment ${subjectColorClass(sub)}" style="height:${segPct}%" title="${sub}: ${row.bySubject[sub]}m"></div>`;
            }).join('');
            const active = currentAnalyticsDetail && currentAnalyticsDetail.index === idx && currentAnalyticsDetail.view === view ? 'selected' : '';
            return `
              <div class="day-col ${active}" data-chart-index="${idx}" data-chart-view="${view}" role="button" tabindex="0" aria-label="${row.label}: ${minutesToHuman(total)}, ${row.questions} questions">
                <div class="bar-wrap">
                  <div class="bar ${active} ${total ? '' : 'empty'}" style="height:${heightPct}%" title="${row.label} - ${minutesToHuman(total)} - ${row.questions}q">
                    <div class="bar-total">${total ? minutesToHuman(total) : '0m'}</div>
                    ${segments || '<div class="segment" style="height:100%;background:rgba(148,163,184,.16)"></div>'}
                  </div>
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
        kind: currentAnalyticsDetail.kind,
        totalMinutes: currentAnalyticsDetail.totalMinutes,
        questions: currentAnalyticsDetail.questions,
        bySubject: currentAnalyticsDetail.bySubject,
        questionsBySubject: currentAnalyticsDetail.questionsBySubject,
        range: currentAnalyticsDetail.range
      }
    : {
        label: selected.label,
        kind: view === 'weekly' ? 'Week' : 'Month',
        totalMinutes: chartRows.reduce((a, r) => a + r.totalMinutes, 0),
        questions: chartRows.reduce((a, r) => a + r.questions, 0),
        bySubject: SUBJECTS.reduce((acc, s) => {
          acc[s] = chartRows.reduce((a, r) => a + (r.bySubject[s] || 0), 0);
          return acc;
        }, {}),
        questionsBySubject: SUBJECTS.reduce((acc, s) => {
          acc[s] = chartRows.reduce((a, r) => a + (r.questionsBySubject?.[s] || 0), 0);
          return acc;
        }, {})
      };

  renderAnalyticsDetail(selectedDetail, view);

  els.graphArea.querySelectorAll('.day-col[data-chart-index]').forEach(node => {
    const selectBar = () => setAnalyticsDetailFromClick(view, Number(node.dataset.chartIndex));
    node.addEventListener('click', selectBar);
    node.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectBar();
      }
    });
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
function renderLeaderboard() {
  if (!els.leaderboardList) return;
  if (!leaderboardRows.length) {
    els.leaderboardList.innerHTML = '<div class="mini-line"><span>No leaderboard data yet</span><strong>0h</strong></div>';
    if (els.leaderboardUpdatedAt) els.leaderboardUpdatedAt.textContent = 'Live';
    return;
  }
  els.leaderboardList.innerHTML = leaderboardRows.map((row, index) => {
    const name = escapeHtml(String(row.name || 'Student').trim() || 'Student');
    const hours = minutesToHuman(Math.round(Number(row.totalMinutes) || 0));
    const questions = Number(row.totalQuestions) || 0;
    return `<div class="mini-line"><span>${index + 1}. ${name}</span><strong>${hours} · ${questions} q</strong></div>`;
  }).join('');
  if (els.leaderboardUpdatedAt) {
    els.leaderboardUpdatedAt.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }
}
function openProfileModal() {
  if (!els.profileModal) return;
  els.profileModal.classList.remove('hidden');
  els.profileModal.setAttribute('aria-hidden', 'false');
  els.profileInput.value = (state.profile && state.profile.name) || '';
  setTimeout(() => els.profileInput.focus(), 50);
}
function closeProfileModal(force = false) {
  if (!els.profileModal) return;
  const profile = normalizeProfile(state.profile || loadProfile());
  if (!force && !profile.name) {
    showToast('Enter your name to continue');
    setTimeout(() => els.profileInput.focus(), 50);
    return;
  }
  els.profileModal.classList.add('hidden');
  els.profileModal.setAttribute('aria-hidden', 'true');
}
function ensureProfile() {
  const profile = normalizeProfile(state.profile || loadProfile());
  state.profile = profile;
  if (els.profileName) els.profileName.textContent = profile.name || 'Guest';
  if (!profile.name) {
    void hydrateProfileFromCloud().then((hydrated) => {
      if (normalizedProfileHasName(hydrated)) return;
      openProfileModal();
    });
  }
  return profile;
}
function normalizedProfileHasName(profile) {
  return Boolean(normalizeProfile(profile).name);
}
async function saveProfileFromInput() {
  if (profileModalBusy) return;
  profileModalBusy = true;
  els.profileSaveBtn.disabled = true;
  try {
    const name = String(els.profileInput.value || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    if (!name) {
      showToast('Enter a name to continue');
      return;
    }
    const ok = saveProfile({ name, createdAt: state.profile?.createdAt || Date.now(), updatedAt: Date.now() });
    if (!ok) return;
    if (els.profileName) els.profileName.textContent = name;
    closeProfileModal(true);
    render();
    const mod = await ensureCloudSync();
    if (mod && typeof mod.pushDeviceProfile === 'function') {
      await mod.pushDeviceProfile(state.profile, { deviceId });
    }
    await syncLeaderboardNow('profile');
    await refreshLeaderboard({ force: true });
    showToast(`Welcome, ${name}`);
  } finally {
    profileModalBusy = false;
    els.profileSaveBtn.disabled = false;
  }
}
function updateStats() {
  const recs = getRecords();
  const totalMinutes = recs.reduce((a, r) => a + (Number(r.minutes) || 0), 0);
  const totalQuestions = recs.reduce((a, r) => a + (Number(r.questions) || 0), 0);
  const subjectTotals = SUBJECTS.map(s => [s, recs.filter(r => r.subject === s).reduce((a, r) => a + (Number(r.minutes) || 0), 0)]);
  const topPair = subjectTotals.sort((a, b) => b[1] - a[1])[0];
  const top = topPair && topPair[1] > 0 ? topPair[0] : '—';
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
  leaderboardRows = [];
  state.running = false;
  state.timerCheckpoint = null;
  timerPerfStamp = 0;
  clearInterval(interval);
  interval = null;
  releaseWakeLock();
  saveState({ immediate: true, reason: 'local-data-cleared' });
  render();
  showToast('Local data cleared');
  void refreshLeaderboard({ force: true });
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

deviceId = getDeviceId();
cloudQueue = loadCloudQueue();

function init() {
  state = normalizeState(state);
  state.profile = normalizeProfile(state.profile || loadProfile());
  if (!Array.isArray(state.records)) state.records = [];
  if (!state.analyticsSelections || typeof state.analyticsSelections !== 'object') state.analyticsSelections = { weekly: -1, monthly: -1 };
  if (typeof state.analyticsSelections.weekly !== 'number') state.analyticsSelections.weekly = -1;
  if (typeof state.analyticsSelections.monthly !== 'number') state.analyticsSelections.monthly = -1;
  sanitizeNumbers();
  if (!state.total) state.total = secondsForMode(state.currentMode);
  if (!state.remaining) state.remaining = state.total;
  if (state.page !== 'analytics') state.page = 'timer';
  if (state.pendingSession) state.running = false;
  state.remaining = clamp(Number(state.remaining) || state.total, 0, state.total || secondsForMode(state.currentMode));
  state.total = Math.max(1, Number(state.total) || secondsForMode(state.currentMode));

  els.timerPage.classList.toggle('active', state.page === 'timer');
  document.querySelectorAll('.drawer-item[data-page]').forEach(btn => btn.classList.toggle('active', btn.dataset.page === state.page));
  els.analyticsPage.classList.toggle('active', state.page === 'analytics');
  document.querySelectorAll('.tab[data-analytics-view]').forEach(btn => btn.classList.toggle('active', btn.dataset.analyticsView === (state.analyticsView || 'weekly')));

  currentSubject = safeSubject(state.lastSubject);
  currentAnalyticsDetail = null;
  closeSessionModal();
  if (els.profileName) els.profileName.textContent = state.profile.name || 'Guest';
  ensureProfile();
  render();

  if (state.running) {
    if (!restoreTimerFromCheckpoint()) {
      timerPerfStamp = performance.now();
      clearInterval(interval);
      interval = setInterval(tick, 1000);
    }
  }

  maybeUnlockHiddenEggs();
  renderLeaderboard();
  void refreshLeaderboard({ force: true });
  if (state.profile.name) {
    void syncLeaderboardNow('startup');
  } else {
    void hydrateProfileFromCloud();
  }

  setInterval(() => {
    if (state.running) renderTimerOnly();
  }, 1000);

  setInterval(() => {
    cleanupAndRefresh();
  }, 60000);

  setInterval(() => {
    if (cloudQueue) void flushCloudSync({ reason: 'periodic-retry' });
  }, 15000);

  window.addEventListener('beforeunload', () => {
    saveTimerCheckpoint();
    saveState({ immediate: true, reason: 'beforeunload' });
  });

  window.addEventListener('pagehide', () => {
    saveTimerCheckpoint();
    saveState({ immediate: true, reason: 'pagehide' });
    releaseWakeLock();
  });

  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      saveTimerCheckpoint();
      saveState({ immediate: true, reason: 'hidden' });
      return;
    }
    if (document.visibilityState === 'visible' && state.running) {
      requestWakeLock();
      if (!restoreTimerFromCheckpoint()) {
        tick();
      }
      void reconcileCloudState({ reason: 'visible', force: true }).then((changed) => {
        if (!changed) return;
        currentSubject = safeSubject(state.lastSubject);
        render({ skipSave: true });
      });
    }
  });

  window.addEventListener('pageshow', () => {
    if (state.running) {
      requestWakeLock();
      if (!restoreTimerFromCheckpoint()) {
        tick();
      }
    }
    void reconcileCloudState({ reason: 'pageshow', force: true }).then((changed) => {
      if (!changed) return;
      currentSubject = safeSubject(state.lastSubject);
      render({ skipSave: true });
    });
  });

  window.addEventListener('online', () => {
    void reconcileCloudState({ reason: 'online', force: true }).then((changed) => {
      if (!changed) return;
      currentSubject = safeSubject(state.lastSubject);
      render({ skipSave: true });
    });
  });
}

els.menuBtn.addEventListener('click', openDrawer);
els.aboutBtn.addEventListener('click', openDrawer);
if (els.profileSaveBtn) els.profileSaveBtn.addEventListener('click', saveProfileFromInput);
if (els.profileInput) {
  els.profileInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveProfileFromInput();
    if (e.key === 'Escape') closeProfileModal();
  });
}
if (els.profileModal) {
  els.profileModal.addEventListener('click', (e) => {
    if (e.target === els.profileModal) closeProfileModal();
  });
}
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
    advanceCycleAfterFocus(state.pendingSession.roundCompleted || state.cycleCount);
    state.pendingSession = null;
    closeSessionModal();
    state.currentMode = 'focus';
    state.remaining = state.focus * 60;
    state.total = state.remaining;
    timerPerfStamp = 0;
    state.timerCheckpoint = null;
    render();
    return;
  }
  if (state.currentMode === 'focus') {
    const completedRound = state.cycleCount;
    const nextMode = nextBreakModeForRound(completedRound);
    state.currentMode = nextMode;
    state.remaining = secondsForMode(state.currentMode);
    state.total = state.remaining;
    advanceCycleAfterFocus(completedRound);
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
  closeSessionModal();
  render();
});
els.logBtn.addEventListener('click', () => {
  if (state.pendingSession) {
    openSessionModal();
    return;
  }
  const wasFocus = state.currentMode === 'focus';
  const completedRound = state.cycleCount;
  const elapsedFocusMinutes = wasFocus
    ? (state.remaining < state.total ? Math.max(1, Math.round((state.total - state.remaining) / 60)) : state.focus)
    : state.focus;
  if (state.running) pauseTimer();
  state.pendingSession = {
    minutes: elapsedFocusMinutes,
    nextMode: nextBreakModeForRound(completedRound),
    sessionDate: dkey(new Date()),
    roundCompleted: completedRound
  };
  state.currentMode = state.pendingSession.nextMode;
  state.total = secondsForMode(state.currentMode);
  state.remaining = state.total;
  openSessionModal();
  render();
});

els.closeModalBtn.addEventListener('click', dismissSessionModal);
els.cancelLogBtn.addEventListener('click', dismissSessionModal);
els.saveLogBtn.addEventListener('click', savePendingSession);
els.sessionModal.addEventListener('click', (e) => {
  if (e.target === els.sessionModal) dismissSessionModal();
});
if (els.analyticsSessionModal) {
  els.analyticsSessionModal.addEventListener('click', (e) => {
    if (e.target === els.analyticsSessionModal) closeAnalyticsSessionModal();
  });
}

els.subjectChips.forEach(btn => btn.addEventListener('click', () => {
  els.subjectChips.forEach(x => {
    x.classList.remove('active');
    x.setAttribute('aria-pressed', 'false');
  });
  btn.classList.add('active');
  btn.setAttribute('aria-pressed', 'true');
  currentSubject = btn.dataset.subject;
}));

document.querySelectorAll('.tab[data-analytics-view]').forEach(btn => {
  btn.addEventListener('click', () => setAnalyticsView(btn.dataset.analyticsView));
});
if (els.closeAnalyticsSessionBtn) els.closeAnalyticsSessionBtn.addEventListener('click', closeAnalyticsSessionModal);
if (els.closeAnalyticsSessionFooterBtn) els.closeAnalyticsSessionFooterBtn.addEventListener('click', closeAnalyticsSessionModal);
if (els.deleteAnalyticsSessionBtn) els.deleteAnalyticsSessionBtn.addEventListener('click', handleAnalyticsSessionDelete);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeDrawer();
    if (!els.sessionModal.classList.contains('hidden')) dismissSessionModal();
    if (els.analyticsSessionModal && !els.analyticsSessionModal.classList.contains('hidden')) closeAnalyticsSessionModal();
  }
});

function cleanupAndRefresh(options = {}) {
  sanitizeNumbers();
  updateTodaySummary();
  updateStats();
  updateAchievements();
  if (state.page === 'analytics') renderAnalytics();
  else renderTimerOnly();
  if (!options.skipSave) saveState();
}
init();
cleanupAndRefresh({ skipSave: true });
void reconcileCloudState({ reason: 'startup', force: navigator.onLine !== false }).then((changed) => {
  if (!changed) return;
  currentSubject = safeSubject(state.lastSubject);
  render({ skipSave: true });
});

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
