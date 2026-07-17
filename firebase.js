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
const USER_GENERATION_COLLECTION = 'userGenerations';
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
    userGeneration: 0,
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
    userGeneration: Math.max(0, Number(data.userGeneration || 0) || 0),
    updatedAt: Math.max(0, Number(data.updatedAt || data.lastResetAt || 0) || 0),
    lastResetAt: Math.max(0, Number(data.lastResetAt || 0) || 0),
    lastResetBy: String(data.lastResetBy || '').trim().slice(0, 80)
  };
}

function buildDefaultUserGeneration() {
  return { generation: 0, updatedAt: 0, updatedBy: '' };
}

function normalizeUserGeneration(data) {
  const fallback = buildDefaultUserGeneration();
  if (!data || typeof data !== 'object') return fallback;
  return {
    generation: Math.max(0, Number(data.generation || 0) || 0),
    updatedAt: Math.max(0, Number(data.updatedAt || 0) || 0),
    updatedBy: String(data.updatedBy || '').trim().slice(0, 80)
  };
}

function normalizeCloudTombstones(map) {
  const out = {};
  if (!map || typeof map !== 'object') return out;
  Object.keys(map).forEach((id) => {
    const timestamp = Number(map[id]) || 0;
    if (timestamp > 0) out[String(id)] = timestamp;
  });
  return out;
}

function mergeCloudRecords(localRecords, remoteRecords, tombstones) {
  const seen = new Set();
  const merged = [];
  [...(Array.isArray(localRecords) ? localRecords : []), ...(Array.isArray(remoteRecords) ? remoteRecords : [])].forEach((record) => {
    const id = String(record && record.id || '');
    if (!id || seen.has(id) || tombstones[id]) return;
    seen.add(id);
    merged.push(record);
  });
  return merged.slice(0, 1000);
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

export async function refreshCloudGeneration(identityName = '') {
  try {
    const { firestoreMod, db } = await loadFirebaseSdk();
    const ref = firestoreMod.doc(db, METADATA_COLLECTION, SYNC_CONFIG_DOC_ID);
    const stateDocId = resolveStateDocId(identityName);
    const userGenerationRef = firestoreMod.doc(db, USER_GENERATION_COLLECTION, stateDocId);
    const [snap, userGenerationSnap] = await Promise.all([
      firestoreMod.getDoc(ref),
      firestoreMod.getDoc(userGenerationRef)
    ]);
    const global = snap.exists() ? { ...normalizeGenerationConfig(snap.data() || {}), exists: true } : { ...buildDefaultGenerationConfig(), exists: false };
    const user = userGenerationSnap.exists() ? normalizeUserGeneration(userGenerationSnap.data() || {}) : buildDefaultUserGeneration();
    return { ...global, userGeneration: user.generation };
  } catch (error) {
    firebaseStatus.lastError = toErrorMessage(error);
    logCloud('error', 'Cloud generation read failed.', error);
    return { ...buildDefaultGenerationConfig(), exists: false };
  }
}

export async function pullCloudState(identityName) {
  try {
    const { firestoreMod, db } = await loadFirebaseSdk();
    const stateDocId = resolveStateDocId(identityName);
    const ref = firestoreMod.doc(db, CLOUD_COLLECTION, stateDocId);
    const userGenerationRef = firestoreMod.doc(db, USER_GENERATION_COLLECTION, stateDocId);
    const [snap, userGenerationSnap] = await Promise.all([
      firestoreMod.getDoc(ref),
      firestoreMod.getDoc(userGenerationRef)
    ]);
    const userGeneration = userGenerationSnap.exists()
      ? normalizeUserGeneration(userGenerationSnap.data() || {})
      : buildDefaultUserGeneration();
    if (!snap.exists()) {
      return {
        state: null,
        updatedAt: userGeneration.updatedAt,
        userGeneration: userGeneration.generation,
        exists: false
      };
    }
    const data = snap.data() || {};
    const state = data.state || null;
    if (!state || typeof state !== 'object') return null;
    const updatedAt = Number(data.updatedAt || state.updatedAt || 0) || 0;
    return {
      state,
      updatedAt,
      clientId: String(data.clientId || ''),
      userGeneration: Math.max(userGeneration.generation, Number(data.userGeneration || 0) || 0),
      exists: true
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
    const stateDocId = resolveStateDocId(options.identityName);
    const ref = firestoreMod.doc(db, CLOUD_COLLECTION, stateDocId);
    const userGenerationRef = firestoreMod.doc(db, USER_GENERATION_COLLECTION, stateDocId);
    const configRef = firestoreMod.doc(db, METADATA_COLLECTION, SYNC_CONFIG_DOC_ID);
    const clientId = String(options.clientId || '');
    const expectedGeneration = Math.max(0, Number(options?.generation?.stateGeneration || 0) || 0);
    const expectedUserGeneration = Math.max(0, Number(options?.generation?.userGeneration || 0) || 0);
    const localUpdatedAt = Number(state && state.updatedAt) || Date.now();
    const snapshot = { ...(state || {}), updatedAt: localUpdatedAt };

    const result = await firestoreMod.runTransaction(db, async (transaction) => {
      const configSnap = await transaction.get(configRef);
      const currentGeneration = configSnap.exists() ? normalizeGenerationConfig(configSnap.data() || {}) : buildDefaultGenerationConfig();
      const userGenerationSnap = await transaction.get(userGenerationRef);
      const currentUserGeneration = userGenerationSnap.exists()
        ? normalizeUserGeneration(userGenerationSnap.data() || {})
        : buildDefaultUserGeneration();
      if (Number(currentGeneration.stateGeneration || 0) !== expectedGeneration) {
        return {
          ok: false,
          reason: 'generation-mismatch',
          currentGeneration: { ...currentGeneration, userGeneration: currentUserGeneration.generation },
          expectedGeneration
        };
      }
      if (currentUserGeneration.generation !== expectedUserGeneration) {
        return {
          ok: false,
          reason: 'generation-mismatch',
          scope: 'user',
          currentGeneration: { ...currentGeneration, userGeneration: currentUserGeneration.generation },
          expectedGeneration: expectedUserGeneration
        };
      }

      const snap = await transaction.get(ref);
      const current = snap.exists() ? snap.data() : null;
      const remoteUpdatedAt = Number(current && (current.updatedAt || current.state?.updatedAt)) || 0;
      const remoteClientId = String(current && current.clientId || '');
      const remoteState = current && current.state && typeof current.state === 'object' ? current.state : null;
      const localRecordsUpdatedAt = Number(snapshot.recordsUpdatedAt || 0) || 0;
      const remoteRecordsUpdatedAt = Number(remoteState && (remoteState.recordsUpdatedAt || (Array.isArray(remoteState.records) && remoteState.records.length ? remoteState.updatedAt : 0))) || 0;

      // A newer UI/settings blob is not allowed to outrank a newer record
      // edit. If the remote record generation is newer, let the client merge
      // the remote snapshot. Otherwise write a merged record projection below.
      if (remoteUpdatedAt > localUpdatedAt && localRecordsUpdatedAt <= remoteRecordsUpdatedAt) {
        return {
          ok: false,
          stale: true,
          remoteUpdatedAt,
          remoteClientId,
          remoteState,
          remoteUserGeneration: Number(current && current.userGeneration || currentUserGeneration.generation) || 0,
          currentGeneration: { ...currentGeneration, userGeneration: currentUserGeneration.generation }
        };
      }

      if (remoteUpdatedAt === localUpdatedAt && remoteClientId && clientId && remoteClientId === clientId && localRecordsUpdatedAt <= remoteRecordsUpdatedAt) {
        return {
          ok: true,
          duplicate: true,
          updatedAt: remoteUpdatedAt,
          currentGeneration: { ...currentGeneration, userGeneration: currentUserGeneration.generation }
        };
      }

      const localTombstones = normalizeCloudTombstones(snapshot.deletedRecordIds);
      const remoteTombstones = normalizeCloudTombstones(remoteState && remoteState.deletedRecordIds);
      const mergedTombstones = { ...remoteTombstones, ...localTombstones };
      Object.keys(remoteTombstones).forEach((id) => {
        mergedTombstones[id] = Math.max(remoteTombstones[id] || 0, localTombstones[id] || 0);
      });
      const baseState = remoteUpdatedAt > localUpdatedAt && remoteState ? remoteState : snapshot;
      const mergedSnapshot = {
        ...baseState,
        records: mergeCloudRecords(snapshot.records, remoteState && remoteState.records, mergedTombstones),
        deletedRecordIds: mergedTombstones,
        recordsUpdatedAt: Math.max(localRecordsUpdatedAt, remoteRecordsUpdatedAt),
        updatedAt: Math.max(localUpdatedAt, remoteUpdatedAt)
      };
      const writeUpdatedAt = Number(mergedSnapshot.updatedAt || localUpdatedAt) || localUpdatedAt;

      transaction.set(ref, {
        app: APP_NAME,
        clientId,
        updatedAt: writeUpdatedAt,
        generation: Number(currentGeneration.stateGeneration || 0) || 0,
        userGeneration: currentUserGeneration.generation,
        generationUpdatedAt: Number(currentGeneration.updatedAt || 0) || 0,
        state: mergedSnapshot
      }, { merge: false });

      return { ok: true, updatedAt: writeUpdatedAt, currentGeneration: { ...currentGeneration, userGeneration: currentUserGeneration.generation } };
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
    const userGenerationRef = firestoreMod.doc(db, USER_GENERATION_COLLECTION, docId);
    const configRef = firestoreMod.doc(db, METADATA_COLLECTION, SYNC_CONFIG_DOC_ID);
    // Daily & weekly projections ride on the same leaderboard doc. They are a
    // projection of the authoritative record set, just like the all-time
    // totals — a row belongs to today's board iff its dailyKey matches today,
    // so boards roll over at midnight / Monday with zero scheduled work.
    // Older docs that pre-date these fields simply keep working: they just
    // won't surface in the daily/weekly boards until their owner re-syncs.
    const periods = options.periods || {};
    const payload = {
      clientId: String(options.clientId || ''),
      name: String(profile && profile.name || 'Student').trim().slice(0, 40) || 'Student',
      totalMinutes: Math.max(0, Math.round(Number(stats && stats.totalMinutes) || 0)),
      totalQuestions: Math.max(0, Math.round(Number(stats && stats.totalQuestions) || 0)),
      dailyKey: String(periods.dailyKey || ''),
      dailyMinutes: Math.max(0, Math.round(Number(periods.dailyMinutes) || 0)),
      dailyQuestions: Math.max(0, Math.round(Number(periods.dailyQuestions) || 0)),
      weekKey: String(periods.weekKey || ''),
      weeklyMinutes: Math.max(0, Math.round(Number(periods.weeklyMinutes) || 0)),
      weeklyQuestions: Math.max(0, Math.round(Number(periods.weeklyQuestions) || 0)),
      updatedAt: Number(options.updatedAt || Date.now()) || Date.now(),
      recordsUpdatedAt: Math.max(0, Number(options.recordsUpdatedAt || 0) || 0),
      app: APP_NAME
    };

    const expectedGeneration = Math.max(0, Number(options?.generation?.leaderboardGeneration || 0) || 0);
    const expectedUserGeneration = Math.max(0, Number(options?.generation?.userGeneration || 0) || 0);

    const result = await firestoreMod.runTransaction(db, async (transaction) => {
      const configSnap = await transaction.get(configRef);
      const currentGeneration = configSnap.exists() ? normalizeGenerationConfig(configSnap.data() || {}) : buildDefaultGenerationConfig();
      const userGenerationSnap = await transaction.get(userGenerationRef);
      const currentUserGeneration = userGenerationSnap.exists()
        ? normalizeUserGeneration(userGenerationSnap.data() || {})
        : buildDefaultUserGeneration();
      if (Number(currentGeneration.leaderboardGeneration || 0) !== expectedGeneration) {
        return {
          ok: false,
          reason: 'generation-mismatch',
          currentGeneration: { ...currentGeneration, userGeneration: currentUserGeneration.generation },
          expectedGeneration
        };
      }
      if (currentUserGeneration.generation !== expectedUserGeneration) {
        return {
          ok: false,
          reason: 'generation-mismatch',
          scope: 'user',
          currentGeneration: { ...currentGeneration, userGeneration: currentUserGeneration.generation },
          expectedGeneration: expectedUserGeneration
        };
      }

      const snap = await transaction.get(ref);
      const current = snap.exists() ? snap.data() : null;
      const currentRow = current ? {
        totalMinutes: Math.max(0, Math.round(Number(current.totalMinutes) || 0)),
        totalQuestions: Math.max(0, Math.round(Number(current.totalQuestions) || 0)),
        updatedAt: Number(current.updatedAt || 0) || 0,
        recordsUpdatedAt: Number(current.recordsUpdatedAt || 0) || 0
      } : null;

      // The leaderboard row is a projection of the authoritative record set.
      // Compare only the record generation, never the totals: a valid delete
      // is allowed to lower both totals or remove the row entirely.
      if (currentRow && currentRow.recordsUpdatedAt >= payload.recordsUpdatedAt) {
        return {
          ok: true,
          skipped: true,
          reason: 'cloud-record-generation-is-newer',
          currentGeneration,
          currentRow
        };
      }

      if (payload.totalMinutes === 0 && payload.totalQuestions === 0) {
        transaction.delete(ref);
      } else {
        transaction.set(ref, {
          ...payload,
          generation: Number(currentGeneration.leaderboardGeneration || 0) || 0,
          userGeneration: currentUserGeneration.generation,
          generationUpdatedAt: Number(currentGeneration.updatedAt || 0) || 0
        }, { merge: false });
      }

      return {
        ok: true,
        deleted: payload.totalMinutes === 0 && payload.totalQuestions === 0,
        payload,
        currentGeneration: { ...currentGeneration, userGeneration: currentUserGeneration.generation }
      };
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

    if (result && result.reason === 'cloud-record-generation-is-newer') {
      return result;
    }

    return { ok: false, reason: 'unknown' };
  } catch (error) {
    firebaseStatus.lastError = toErrorMessage(error);
    logCloud('error', 'Leaderboard write failed.', error);
    return { ok: false, error: toErrorMessage(error) };
  }
}

// Hard-delete one user's state through the same transaction that advances its
// generation. A device holding an older queue can therefore never recreate
// the deleted state or leaderboard row.
export async function adminDeleteUserState(identityName) {
  try {
    const docId = resolveNameDocId(identityName);
    if (!docId) return { ok: false, reason: 'missing-name' };
    const { firestoreMod, db } = await loadFirebaseSdk();
    const stateRef = firestoreMod.doc(db, CLOUD_COLLECTION, docId);
    const leaderboardRef = firestoreMod.doc(db, LEADERBOARD_COLLECTION, docId);
    const generationRef = firestoreMod.doc(db, USER_GENERATION_COLLECTION, docId);
    const result = await firestoreMod.runTransaction(db, async (transaction) => {
      const generationSnap = await transaction.get(generationRef);
      const current = generationSnap.exists()
        ? normalizeUserGeneration(generationSnap.data() || {})
        : buildDefaultUserGeneration();
      const next = {
        generation: current.generation + 1,
        updatedAt: Date.now(),
        updatedBy: 'admin-user-delete'
      };
      transaction.set(generationRef, next, { merge: false });
      transaction.delete(stateRef);
      transaction.delete(leaderboardRef);
      return next;
    });
    firebaseStatus.lastError = null;
    firebaseStatus.lastSuccessAt = Date.now();
    return { ok: true, generation: result };
  } catch (error) {
    firebaseStatus.lastError = toErrorMessage(error);
    logCloud('error', 'User hard delete failed.', error);
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
        dailyKey: String(data.dailyKey || ''),
        dailyMinutes: Math.max(0, Math.round(Number(data.dailyMinutes) || 0)),
        dailyQuestions: Math.max(0, Math.round(Number(data.dailyQuestions) || 0)),
        weekKey: String(data.weekKey || ''),
        weeklyMinutes: Math.max(0, Math.round(Number(data.weeklyMinutes) || 0)),
        weeklyQuestions: Math.max(0, Math.round(Number(data.weeklyQuestions) || 0)),
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
