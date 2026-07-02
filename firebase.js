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
const DEVICE_ID_KEY = 'jee_pomodoro_flow_v4_device_id';
const CLOUD_DOC_ID_KEY = DEVICE_ID_KEY; // backward compatibility
const LEADERBOARD_SCHEMA_VERSION = 2;

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

function getDeviceId() {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY) || localStorage.getItem(CLOUD_DOC_ID_KEY);
    if (!id) {
      id = (window.crypto && window.crypto.randomUUID)
        ? window.crypto.randomUUID()
        : `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    }
    localStorage.setItem(DEVICE_ID_KEY, id);
    localStorage.setItem(CLOUD_DOC_ID_KEY, id);
    return id;
  } catch {
    return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
}

function getCloudDocId() {
  return getDeviceId();
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

export async function pullCloudState() {
  try {
    const { firestoreMod, db } = await loadFirebaseSdk();
    const ref = firestoreMod.doc(db, CLOUD_COLLECTION, getCloudDocId());
    const snap = await firestoreMod.getDoc(ref);
    if (!snap.exists()) return null;
    const data = snap.data() || {};
    const state = data.state || null;
    if (!state || typeof state !== 'object') return null;
    const updatedAt = Number(data.updatedAt || state.updatedAt || 0) || 0;
    return {
      state,
      updatedAt,
      deviceId: String(data.deviceId || data.clientId || ''),
      clientId: String(data.clientId || ''),
    };
  } catch (error) {
    firebaseStatus.lastError = toErrorMessage(error);
    logCloud('error', 'Firestore read failed.', error);
    return null;
  }
}

export async function pushCloudState(state, options = {}) {
  try {
    const { firestoreMod, db } = await loadFirebaseSdk();
    const ref = firestoreMod.doc(db, CLOUD_COLLECTION, getCloudDocId());
    const deviceId = String(options.deviceId || options.clientId || '');
    const localUpdatedAt = Number(state && state.updatedAt) || Date.now();
    const snapshot = { ...(state || {}), updatedAt: localUpdatedAt };

    const result = await firestoreMod.runTransaction(db, async (transaction) => {
      const snap = await transaction.get(ref);
      const current = snap.exists() ? snap.data() : null;
      const remoteUpdatedAt = Number(current && (current.updatedAt || current.state?.updatedAt)) || 0;
      const remoteDeviceId = String(current && (current.deviceId || current.clientId) || '');

      if (remoteUpdatedAt > localUpdatedAt) {
        return {
          ok: false,
          stale: true,
          remoteUpdatedAt,
          remoteDeviceId,
          remoteState: current && current.state ? current.state : null
        };
      }

      if (remoteUpdatedAt === localUpdatedAt && remoteDeviceId && deviceId && remoteDeviceId === deviceId) {
        return { ok: true, duplicate: true, updatedAt: remoteUpdatedAt };
      }

      transaction.set(ref, {
        app: APP_NAME,
        deviceId,
        clientId: deviceId,
        updatedAt: localUpdatedAt,
        state: snapshot
      }, { merge: false });

      return { ok: true, updatedAt: localUpdatedAt };
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

    return { ok: false, reason: 'unknown' };
  } catch (error) {
    firebaseStatus.lastError = toErrorMessage(error);
    logCloud('error', 'Firestore write failed.', error);
    return { ok: false, error: toErrorMessage(error) };
  }
}

export async function pushLeaderboardStats(profile, stats, options = {}) {
  try {
    const { firestoreMod, db } = await loadFirebaseSdk();
    const ref = firestoreMod.doc(db, LEADERBOARD_COLLECTION, getCloudDocId());
    const payload = {
      schemaVersion: LEADERBOARD_SCHEMA_VERSION,
      deviceId: String(options.deviceId || options.clientId || ''),
      clientId: String(options.deviceId || options.clientId || ''),
      name: String(profile && profile.name || 'Student').trim().slice(0, 40) || 'Student',
      totalMinutes: Math.max(0, Math.round(Number(stats && stats.totalMinutes) || 0)),
      totalQuestions: Math.max(0, Math.round(Number(stats && stats.totalQuestions) || 0)),
      updatedAt: Number(options.updatedAt || Date.now()) || Date.now(),
      app: APP_NAME
    };
    await firestoreMod.setDoc(ref, payload, { merge: false });
    return { ok: true, payload };
  } catch (error) {
    firebaseStatus.lastError = toErrorMessage(error);
    logCloud('error', 'Leaderboard write failed.', error);
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
      if (Number(data.schemaVersion || 0) !== LEADERBOARD_SCHEMA_VERSION) return;
      rows.push({
        deviceId: String(data.deviceId || data.clientId || docSnap.id || ''),
        clientId: String(data.clientId || ''),
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
      deviceId: String(data.deviceId || data.clientId || ''),
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
      deviceId: String(options.deviceId || options.clientId || ''),
      clientId: String(options.deviceId || options.clientId || ''),
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
