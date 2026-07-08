const firebaseConfig = {
  apiKey: "AIzaSyDAMT7tP7zqKfu4KNaJiSOS36HzfppevtQ",
  authDomain: "pomodoro-clock-sukirat.firebaseapp.com",
  projectId: "pomodoro-clock-sukirat",
  storageBucket: "pomodoro-clock-sukirat.firebasestorage.app",
  messagingSenderId: "1056426903761",
  appId: "1:1056426903761:web:ef9a16ac94b4f50f685df0",
  measurementId: "G-LGR3QF37QE"
};

const APP_NAME = 'jee-pomodoro-flow';
const CLOUD_COLLECTION = 'pwaState';
const DEVICE_PROFILE_COLLECTION = 'deviceProfiles';
const LEADERBOARD_COLLECTION = 'leaderboardUsers';
const METADATA_COLLECTION = 'metadata';
const SYNC_CONFIG_DOC_ID = 'config';
const CLOUD_DOC_ID_KEY = 'jee_pomodoro_flow_v4_cloud_id';

let firebasePromise = null;
const firebaseStatus = {
  initialized: false,
  persistenceEnabled: false,
  lastError: null,
  lastSuccessAt: 0
};

function logCloud(level, message, details) {
  const prefix = '[Pomodoro cloud]';
  if (details !== undefined) console[level](prefix, message, details);
  else console[level](prefix, message);
}

function toErrorMessage(error) {
  return error && error.message ? error.message : String(error || 'Unknown Firebase error');
}

function getCloudDocId() {
  try {
    let id = localStorage.getItem(CLOUD_DOC_ID_KEY);
    if (!id) {
      id = (window.crypto && window.crypto.randomUUID)
        ? window.crypto.randomUUID()
        : `${Date.now()}_${Math.random().toString(16).slice(2)}`;
      localStorage.setItem(CLOUD_DOC_ID_KEY, id);
    }
    return id;
  } catch {
    return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
}

// Turns a display name into a stable, name-based Firestore doc id, e.g.
// "Sukirat Singh" -> "name-sukirat-singh". This is what lets the app find
// the SAME cloud record again after a name is re-entered, even if this
// device's local storage (and its old random id) was wiped.
function slugifyName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

// Resolves the Firestore doc id for a person's synced state. Falls back to
// the random per-device id only when no name is known yet (pre-onboarding).
function resolveStateDocId(identityName) {
  const slug = slugifyName(identityName);
  return slug ? `name-${slug}` : getCloudDocId();
}

// Resolves the Firestore doc id for a leaderboard row. Always name-based —
// a leaderboard row without a name makes no sense, so this returns null
// rather than silently falling back to a random per-device id (which was
// the cause of duplicate/orphaned leaderboard rows).
function resolveNameDocId(name) {
  const slug = slugifyName(name);
  return slug ? `name-${slug}` : null;
}

function buildDefaultGenerationConfig() {
  return {
    stateGeneration: 0,
    leaderboardGeneration: 0,
    updatedAt: 0,
    lastResetAt: 0,
    lastResetBy: ''
  };
}

function normalizeGenerationConfig(data) {
  const fallback = buildDefaultGenerationConfig();
  if (!data || typeof data !== 'object') return fallback;
  return {
    stateGeneration: Math.max(0, Number(data.stateGeneration || 0) || 0),
    leaderboardGeneration: Math.max(0, Number(data.leaderboardGeneration || 0) || 0),
    updatedAt: Math.max(0, Number(data.updatedAt || data.lastResetAt || 0) || 0),
    lastResetAt: Math.max(0, Number(data.lastResetAt || 0) || 0),
    lastResetBy: String(data.lastResetBy || '').trim().slice(0, 80)
  };
}

async function loadFirebaseSdk() {
  if (!firebasePromise) {
    firebasePromise = Promise.all([
      import('https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js')
    ]).then(([appMod, firestoreMod]) => {
      const app = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(firebaseConfig, APP_NAME);
      const db = firestoreMod.getFirestore(app);
      firebaseStatus.initialized = true;
      firebaseStatus.lastError = null;
      logCloud('info', 'Firebase initialized.');

      const enablePersistence = firestoreMod.enableMultiTabIndexedDbPersistence || firestoreMod.enableIndexedDbPersistence;
      if (typeof enablePersistence === 'function') {
        Promise.resolve(enablePersistence(db))
          .then(() => {
            firebaseStatus.persistenceEnabled = true;
            logCloud('info', 'Firestore offline persistence enabled.');
          })
          .catch((error) => {
            firebaseStatus.persistenceEnabled = false;
            firebaseStatus.lastError = toErrorMessage(error);
            logCloud('warn', 'Firestore offline persistence unavailable; using app-level queue.', error);
          });
      }

      return { firestoreMod, db };
    }).catch((error) => {
      firebaseStatus.initialized = false;
      firebaseStatus.lastError = toErrorMessage(error);
      logCloud('error', 'Firebase initialization failed.', error);
      firebasePromise = null;
      throw error;
    });
  }
  return firebasePromise;
}

export function getCloudStatus() {
  return { ...firebaseStatus };
}

export async function refreshCloudGeneration() {
  try {
    const { firestoreMod, db } = await loadFirebaseSdk();
    const ref = firestoreMod.doc(db, METADATA_COLLECTION, SYNC_CONFIG_DOC_ID);
    const snap = await firestoreMod.getDoc(ref);
    if (!snap.exists()) return { ...buildDefaultGenerationConfig(), exists: false };
    return { ...normalizeGenerationConfig(snap.data() || {}), exists: true };
  } catch (error) {
    firebaseStatus.lastError = toErrorMessage(error);
    logCloud('error', 'Cloud generation read failed.', error);
    return { ...buildDefaultGenerationConfig(), exists: false };
  }
}

export async function pullCloudState(identityName) {
  try {
    const { firestoreMod, db } = await loadFirebaseSdk();
    const ref = firestoreMod.doc(db, CLOUD_COLLECTION, resolveStateDocId(identityName));
    const snap = await firestoreMod.getDoc(ref);
    if (!snap.exists()) return null;
    const data = snap.data() || {};
    const state = data.state || null;
    if (!state || typeof state !== 'object') return null;
    const updatedAt = Number(data.updatedAt || state.updatedAt || 0) || 0;
    return {
      state,
      updatedAt,
      clientId: String(data.clientId || ''),
    };
  } catch (error) {
    firebaseStatus.lastError = toErrorMessage(error);
    logCloud('error', 'Firestore read failed.', error);
    return null;
  }
}

function compareLeaderboardRows(left, right) {
  const a = {
    totalMinutes: Math.max(0, Math.round(Number(left && left.totalMinutes) || 0)),
    totalQuestions: Math.max(0, Math.round(Number(left && left.totalQuestions) || 0)),
    updatedAt: Math.max(0, Number(left && left.updatedAt) || 0)
  };
  const b = {
    totalMinutes: Math.max(0, Math.round(Number(right && right.totalMinutes) || 0)),
    totalQuestions: Math.max(0, Math.round(Number(right && right.totalQuestions) || 0)),
    updatedAt: Math.max(0, Number(right && right.updatedAt) || 0)
  };
  if (a.totalMinutes !== b.totalMinutes) return a.totalMinutes - b.totalMinutes;
  if (a.totalQuestions !== b.totalQuestions) return a.totalQuestions - b.totalQuestions;
  return a.updatedAt - b.updatedAt;
}

export async function pushCloudState(state, options = {}) {
  try {
    const { firestoreMod, db } = await loadFirebaseSdk();
    const ref = firestoreMod.doc(db, CLOUD_COLLECTION, resolveStateDocId(options.identityName));
    const configRef = firestoreMod.doc(db, METADATA_COLLECTION, SYNC_CONFIG_DOC_ID);
    const clientId = String(options.clientId || '');
    const expectedGeneration = Math.max(0, Number(options?.generation?.stateGeneration || 0) || 0);
    const localUpdatedAt = Number(state && state.updatedAt) || Date.now();
    const snapshot = { ...(state || {}), updatedAt: localUpdatedAt };

    const result = await firestoreMod.runTransaction(db, async (transaction) => {
      const configSnap = await transaction.get(configRef);
      const currentGeneration = configSnap.exists() ? normalizeGenerationConfig(configSnap.data() || {}) : buildDefaultGenerationConfig();
      if (Number(currentGeneration.stateGeneration || 0) !== expectedGeneration) {
        return {
          ok: false,
          reason: 'generation-mismatch',
          currentGeneration,
          expectedGeneration
        };
      }

      const snap = await transaction.get(ref);
      const current = snap.exists() ? snap.data() : null;
      const remoteUpdatedAt = Number(current && (current.updatedAt || current.state?.updatedAt)) || 0;
      const remoteClientId = String(current && current.clientId || '');

      if (remoteUpdatedAt > localUpdatedAt) {
        return {
          ok: false,
          stale: true,
          remoteUpdatedAt,
          remoteClientId,
          remoteState: current && current.state ? current.state : null,
          currentGeneration
        };
      }

      if (remoteUpdatedAt === localUpdatedAt && remoteClientId && clientId && remoteClientId === clientId) {
        return { ok: true, duplicate: true, updatedAt: remoteUpdatedAt, currentGeneration };
      }

      transaction.set(ref, {
        app: APP_NAME,
        clientId,
        updatedAt: localUpdatedAt,
        generation: Number(currentGeneration.stateGeneration || 0) || 0,
        generationUpdatedAt: Number(currentGeneration.updatedAt || 0) || 0,
        state: snapshot
      }, { merge: false });

      return { ok: true, updatedAt: localUpdatedAt, currentGeneration };
    });

    if (result && result.ok) {
      firebaseStatus.lastError = null;
      firebaseStatus.lastSuccessAt = Date.now();
      return result;
    }

    if (result && result.stale) {
      logCloud('warn', 'Skipped cloud write because remote state is newer.', result);
      return result;
    }

    if (result && result.reason === 'generation-mismatch') {
      logCloud('warn', 'Skipped cloud write because cloud generation changed.', result);
      return result;
    }

    return { ok: false, reason: 'unknown' };
  } catch (error) {
    firebaseStatus.lastError = toErrorMessage(error);
    logCloud('error', 'Firestore write failed.', error);
    return { ok: false, error: toErrorMessage(error) };
  }
}

export async function pushLeaderboardStats(profile, stats, options = {}) {
  try {
    const docId = resolveNameDocId(profile && profile.name);
    if (!docId) return { ok: false, reason: 'missing-name' };
    const { firestoreMod, db } = await loadFirebaseSdk();
    const ref = firestoreMod.doc(db, LEADERBOARD_COLLECTION, docId);
    const configRef = firestoreMod.doc(db, METADATA_COLLECTION, SYNC_CONFIG_DOC_ID);
    const payload = {
      clientId: String(options.clientId || ''),
      name: String(profile && profile.name || 'Student').trim().slice(0, 40) || 'Student',
      totalMinutes: Math.max(0, Math.round(Number(stats && stats.totalMinutes) || 0)),
      totalQuestions: Math.max(0, Math.round(Number(stats && stats.totalQuestions) || 0)),
      updatedAt: Number(options.updatedAt || Date.now()) || Date.now(),
      app: APP_NAME
    };
    if (payload.totalMinutes === 0 && payload.totalQuestions === 0) {
      return { ok: false, reason: 'no-data' };
    }

    const expectedGeneration = Math.max(0, Number(options?.generation?.leaderboardGeneration || 0) || 0);

    const result = await firestoreMod.runTransaction(db, async (transaction) => {
      const configSnap = await transaction.get(configRef);
      const currentGeneration = configSnap.exists() ? normalizeGenerationConfig(configSnap.data() || {}) : buildDefaultGenerationConfig();
      if (Number(currentGeneration.leaderboardGeneration || 0) !== expectedGeneration) {
        return {
          ok: false,
          reason: 'generation-mismatch',
          currentGeneration,
          expectedGeneration
        };
      }

      const snap = await transaction.get(ref);
      const current = snap.exists() ? snap.data() : null;
      const currentRow = current ? {
        totalMinutes: Math.max(0, Math.round(Number(current.totalMinutes) || 0)),
        totalQuestions: Math.max(0, Math.round(Number(current.totalQuestions) || 0)),
        updatedAt: Number(current.updatedAt || 0) || 0
      } : null;

      if (currentRow && compareLeaderboardRows(currentRow, payload) >= 0) {
        return {
          ok: true,
          skipped: true,
          reason: 'cloud-has-more',
          currentGeneration,
          currentRow
        };
      }

      transaction.set(ref, {
        ...payload,
        generation: Number(currentGeneration.leaderboardGeneration || 0) || 0,
        generationUpdatedAt: Number(currentGeneration.updatedAt || 0) || 0
      }, { merge: false });

      return { ok: true, payload, currentGeneration };
    });

    if (result && result.ok) {
      firebaseStatus.lastError = null;
      firebaseStatus.lastSuccessAt = Date.now();
      return result;
    }

    if (result && result.reason === 'generation-mismatch') {
      logCloud('warn', 'Leaderboard write skipped because cloud generation changed.', result);
      return result;
    }

    if (result && result.reason === 'cloud-has-more') {
      return result;
    }

    return { ok: false, reason: 'unknown' };
  } catch (error) {
    firebaseStatus.lastError = toErrorMessage(error);
    logCloud('error', 'Leaderboard write failed.', error);
    return { ok: false, error: toErrorMessage(error) };
  }
}

export async function adminWipeLeaderboardAndState() {
  try {
    const { firestoreMod, db } = await loadFirebaseSdk();
    const configRef = firestoreMod.doc(db, METADATA_COLLECTION, SYNC_CONFIG_DOC_ID);
    const currentSnap = await firestoreMod.getDoc(configRef);
    const current = currentSnap.exists() ? normalizeGenerationConfig(currentSnap.data() || {}) : buildDefaultGenerationConfig();
    const nextGeneration = {
      stateGeneration: Number(current.stateGeneration || 0) + 1,
      leaderboardGeneration: Number(current.leaderboardGeneration || 0) + 1,
      updatedAt: Date.now(),
      lastResetAt: Date.now(),
      lastResetBy: 'admin-wipe'
    };

    await firestoreMod.setDoc(configRef, nextGeneration, { merge: false });

    const [leaderboardSnap, stateSnap] = await Promise.all([
      firestoreMod.getDocs(firestoreMod.collection(db, LEADERBOARD_COLLECTION)),
      firestoreMod.getDocs(firestoreMod.collection(db, CLOUD_COLLECTION))
    ]);

    const batch = firestoreMod.writeBatch(db);
    leaderboardSnap.forEach((d) => batch.delete(d.ref));
    stateSnap.forEach((d) => batch.delete(d.ref));
    await batch.commit();

    firebaseStatus.lastError = null;
    firebaseStatus.lastSuccessAt = Date.now();
    return { ok: true, generation: nextGeneration };
  } catch (error) {
    firebaseStatus.lastError = toErrorMessage(error);
    logCloud('error', 'Admin wipe failed.', error);
    return { ok: false, error: toErrorMessage(error) };
  }
}

export async function pullLeaderboardStats(limit = 50) {
  try {
    const { firestoreMod, db } = await loadFirebaseSdk();
    const col = firestoreMod.collection(db, LEADERBOARD_COLLECTION);
    const snap = await firestoreMod.getDocs(col);
    const rows = [];
    snap.forEach((docSnap) => {
      const data = docSnap.data() || {};
      rows.push({
        clientId: String(data.clientId || docSnap.id || ''),
        name: String(data.name || 'Student').trim() || 'Student',
        totalMinutes: Math.max(0, Math.round(Number(data.totalMinutes) || 0)),
        totalQuestions: Math.max(0, Math.round(Number(data.totalQuestions) || 0)),
        updatedAt: Number(data.updatedAt || 0) || 0
      });
    });
    rows.sort((a, b) => {
      if (b.totalMinutes !== a.totalMinutes) return b.totalMinutes - a.totalMinutes;
      if (b.totalQuestions !== a.totalQuestions) return b.totalQuestions - a.totalQuestions;
      return b.updatedAt - a.updatedAt;
    });
    return rows.slice(0, Math.max(1, Math.min(100, Number(limit) || 50)));
  } catch (error) {
    firebaseStatus.lastError = toErrorMessage(error);
    logCloud('error', 'Leaderboard read failed.', error);
    return [];
  }
}

export async function pullDeviceProfile() {
  try {
    const { firestoreMod, db } = await loadFirebaseSdk();
    const ref = firestoreMod.doc(db, DEVICE_PROFILE_COLLECTION, getCloudDocId());
    const snap = await firestoreMod.getDoc(ref);
    if (!snap.exists()) return null;
    const data = snap.data() || {};
    return {
      name: String(data.name || '').trim().slice(0, 40),
      createdAt: Number(data.createdAt || 0) || 0,
      updatedAt: Number(data.updatedAt || 0) || 0,
      clientId: String(data.clientId || '')
    };
  } catch (error) {
    firebaseStatus.lastError = toErrorMessage(error);
    logCloud('error', 'Device profile read failed.', error);
    return null;
  }
}

export async function pushDeviceProfile(profile, options = {}) {
  try {
    const { firestoreMod, db } = await loadFirebaseSdk();
    const ref = firestoreMod.doc(db, DEVICE_PROFILE_COLLECTION, getCloudDocId());
    const payload = {
      clientId: String(options.clientId || ''),
      name: String(profile && profile.name || '').trim().slice(0, 40),
      createdAt: Number(profile && profile.createdAt || Date.now()) || Date.now(),
      updatedAt: Number(profile && profile.updatedAt || Date.now()) || Date.now(),
      app: APP_NAME
    };
    await firestoreMod.setDoc(ref, payload, { merge: false });
    return { ok: true, payload };
  } catch (error) {
    firebaseStatus.lastError = toErrorMessage(error);
    logCloud('error', 'Device profile write failed.', error);
    return { ok: false, error: toErrorMessage(error) };
  }
}
