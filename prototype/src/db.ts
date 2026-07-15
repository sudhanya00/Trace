import * as SQLite from 'expo-sqlite';

// One shared connection. expo-sqlite caches connections per database name,
// so the headless background task and the UI resolve to the same handle.
export const db = SQLite.openDatabaseSync('trace_prototype.db');

db.execSync(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at INTEGER NOT NULL,
    ended_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS fixes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    ts INTEGER NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    accuracy REAL,
    altitude REAL,
    speed REAL,
    battery REAL
  );
  CREATE INDEX IF NOT EXISTS idx_fixes_session ON fixes(session_id, ts);

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER,
    ts INTEGER NOT NULL,
    type TEXT NOT NULL,
    detail TEXT
  );
`);

export type Session = { id: number; started_at: number; ended_at: number | null };

export type Fix = {
  id: number;
  session_id: number;
  ts: number;
  lat: number;
  lng: number;
  accuracy: number | null;
  altitude: number | null;
  speed: number | null;
  battery: number | null;
};

export function activeSession(): Session | null {
  return db.getFirstSync<Session>(
    'SELECT * FROM sessions WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1'
  );
}

export function startSession(): Session {
  const now = Date.now();
  const r = db.runSync('INSERT INTO sessions (started_at) VALUES (?)', [now]);
  return { id: Number(r.lastInsertRowId), started_at: now, ended_at: null };
}

export function endSession(id: number) {
  db.runSync('UPDATE sessions SET ended_at = ? WHERE id = ?', [Date.now(), id]);
}

export function logEvent(type: string, detail?: string, sessionId?: number) {
  db.runSync('INSERT INTO events (session_id, ts, type, detail) VALUES (?, ?, ?, ?)', [
    sessionId ?? activeSession()?.id ?? null,
    Date.now(),
    type,
    detail ?? null,
  ]);
}

export function insertFixes(
  sessionId: number,
  rows: Array<{
    ts: number;
    lat: number;
    lng: number;
    accuracy?: number | null;
    altitude?: number | null;
    speed?: number | null;
  }>,
  battery: number | null
) {
  db.withTransactionSync(() => {
    for (const f of rows) {
      db.runSync(
        `INSERT INTO fixes (session_id, ts, lat, lng, accuracy, altitude, speed, battery)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [sessionId, f.ts, f.lat, f.lng, f.accuracy ?? null, f.altitude ?? null, f.speed ?? null, battery]
      );
    }
  });
}

export type SessionStats = {
  fixCount: number;
  firstTs: number | null;
  lastTs: number | null;
  lastAccuracy: number | null;
  firstBattery: number | null;
  lastBattery: number | null;
  gapCount: number; // intervals > 60s between consecutive fixes
  longestGapS: number;
};

export function sessionStats(sessionId: number): SessionStats {
  const base = db.getFirstSync<{
    fixCount: number;
    firstTs: number | null;
    lastTs: number | null;
  }>('SELECT COUNT(*) AS fixCount, MIN(ts) AS firstTs, MAX(ts) AS lastTs FROM fixes WHERE session_id = ?', [
    sessionId,
  ]);
  const last = db.getFirstSync<{ accuracy: number | null; battery: number | null }>(
    'SELECT accuracy, battery FROM fixes WHERE session_id = ? ORDER BY ts DESC LIMIT 1',
    [sessionId]
  );
  const first = db.getFirstSync<{ battery: number | null }>(
    'SELECT battery FROM fixes WHERE session_id = ? ORDER BY ts ASC LIMIT 1',
    [sessionId]
  );
  const gaps = db.getFirstSync<{ gapCount: number; longestMs: number | null }>(
    `SELECT COUNT(*) AS gapCount, MAX(d) AS longestMs FROM (
       SELECT ts - LAG(ts) OVER (ORDER BY ts) AS d
       FROM fixes WHERE session_id = ?
     ) WHERE d > 60000`,
    [sessionId]
  );
  return {
    fixCount: base?.fixCount ?? 0,
    firstTs: base?.firstTs ?? null,
    lastTs: base?.lastTs ?? null,
    lastAccuracy: last?.accuracy ?? null,
    firstBattery: first?.battery ?? null,
    lastBattery: last?.battery ?? null,
    gapCount: gaps?.gapCount ?? 0,
    longestGapS: gaps?.longestMs ? Math.round(gaps.longestMs / 1000) : 0,
  };
}

export function allSessions(): Session[] {
  return db.getAllSync<Session>('SELECT * FROM sessions ORDER BY id DESC');
}

export function sessionFixes(sessionId: number): Fix[] {
  return db.getAllSync<Fix>('SELECT * FROM fixes WHERE session_id = ? ORDER BY ts', [sessionId]);
}

export function sessionEvents(sessionId: number) {
  return db.getAllSync<{ id: number; ts: number; type: string; detail: string | null }>(
    'SELECT id, ts, type, detail FROM events WHERE session_id = ? OR session_id IS NULL ORDER BY ts',
    [sessionId]
  );
}

export function deleteSession(sessionId: number) {
  db.withTransactionSync(() => {
    db.runSync('DELETE FROM fixes WHERE session_id = ?', [sessionId]);
    db.runSync('DELETE FROM events WHERE session_id = ?', [sessionId]);
    db.runSync('DELETE FROM sessions WHERE id = ?', [sessionId]);
  });
}
