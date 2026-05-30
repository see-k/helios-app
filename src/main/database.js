/* ── SQLite Database Layer ── */
const Database = require('better-sqlite3');
const path = require('path');
const { app } = require('electron');

let db;

function getDbPath() {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'helios-fleet.db');
}

function initDatabase() {
  db = new Database(getDbPath());

  // Enable WAL mode for better performance
  db.pragma('journal_mode = WAL');

  // Create drones table
  db.exec(`
    CREATE TABLE IF NOT EXISTS drones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      hostname TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'offline',
      drone_type TEXT NOT NULL DEFAULT 'quadcopter',
      model TEXT DEFAULT '',
      serial_number TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      last_ping TEXT DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Create flights table — persistent post-flight history & replay
  db.exec(`
    CREATE TABLE IF NOT EXISTS flights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drone_name TEXT NOT NULL DEFAULT '',
      drone_id TEXT NOT NULL DEFAULT '',
      mission_start TEXT DEFAULT NULL,
      mission_end TEXT DEFAULT NULL,
      mission_status TEXT NOT NULL DEFAULT 'complete',
      duration_ms INTEGER NOT NULL DEFAULT 0,
      distance_m REAL NOT NULL DEFAULT 0,
      max_altitude REAL NOT NULL DEFAULT 0,
      battery_used INTEGER NOT NULL DEFAULT 0,
      waypoints_total INTEGER NOT NULL DEFAULT 0,
      data TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  return db;
}

function getDb() {
  if (!db) initDatabase();
  return db;
}

/* ── CRUD Operations ── */

function getAllDrones() {
  return getDb().prepare('SELECT * FROM drones ORDER BY created_at DESC').all();
}

function getDroneById(id) {
  return getDb().prepare('SELECT * FROM drones WHERE id = ?').get(id);
}

function addDrone({ name, hostname, status, drone_type, model, serial_number, notes }) {
  const stmt = getDb().prepare(`
    INSERT INTO drones (name, hostname, status, drone_type, model, serial_number, notes)
    VALUES (@name, @hostname, @status, @drone_type, @model, @serial_number, @notes)
  `);
  const result = stmt.run({
    name: name || '',
    hostname: hostname || '',
    status: status || 'offline',
    drone_type: drone_type || 'quadcopter',
    model: model || '',
    serial_number: serial_number || '',
    notes: notes || ''
  });
  return getDroneById(result.lastInsertRowid);
}

function updateDrone(id, fields) {
  const allowed = ['name', 'hostname', 'status', 'drone_type', 'model', 'serial_number', 'notes'];
  const updates = [];
  const values = {};

  for (const key of allowed) {
    if (fields[key] !== undefined) {
      updates.push(`${key} = @${key}`);
      values[key] = fields[key];
    }
  }

  if (updates.length === 0) return getDroneById(id);

  values.id = id;
  updates.push("updated_at = datetime('now')");

  getDb().prepare(`UPDATE drones SET ${updates.join(', ')} WHERE id = @id`).run(values);
  return getDroneById(id);
}

function deleteDrone(id) {
  return getDb().prepare('DELETE FROM drones WHERE id = ?').run(id);
}

function pingDrone(id) {
  getDb().prepare("UPDATE drones SET last_ping = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(id);
  return getDroneById(id);
}

/* ── Flight History Operations ── */

function saveFlight(flightData) {
  const fd = flightData || {};
  const stmt = getDb().prepare(`
    INSERT INTO flights (
      drone_name, drone_id, mission_start, mission_end, mission_status,
      duration_ms, distance_m, max_altitude, battery_used, waypoints_total, data
    ) VALUES (
      @drone_name, @drone_id, @mission_start, @mission_end, @mission_status,
      @duration_ms, @distance_m, @max_altitude, @battery_used, @waypoints_total, @data
    )
  `);
  const batteryUsed = (fd.batteryStart ?? 100) - (fd.batteryEnd ?? 100);
  const result = stmt.run({
    drone_name: fd.droneModel || '',
    drone_id: String(fd.droneId ?? ''),
    mission_start: fd.missionStart || null,
    mission_end: fd.missionEnd || null,
    mission_status: fd.missionStatus || 'complete',
    duration_ms: Math.round(fd.durationMs || 0),
    distance_m: fd.totalDistanceM || 0,
    max_altitude: fd.maxAltitude || 0,
    battery_used: Math.round(batteryUsed),
    waypoints_total: fd.waypointsTotal || 0,
    data: JSON.stringify(fd)
  });
  return getFlightById(result.lastInsertRowid);
}

function getAllFlights() {
  const rows = getDb()
    .prepare('SELECT id, drone_name, drone_id, mission_start, mission_end, mission_status, duration_ms, distance_m, max_altitude, battery_used, waypoints_total, created_at FROM flights ORDER BY datetime(created_at) DESC')
    .all();
  return rows;
}

function getFlightById(id) {
  const row = getDb().prepare('SELECT * FROM flights WHERE id = ?').get(id);
  if (!row) return null;
  let data = {};
  try { data = JSON.parse(row.data || '{}'); } catch { data = {}; }
  return { ...row, data };
}

function deleteFlight(id) {
  return getDb().prepare('DELETE FROM flights WHERE id = ?').run(id);
}

function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = {
  initDatabase,
  closeDatabase,
  getAllDrones,
  getDroneById,
  addDrone,
  updateDrone,
  deleteDrone,
  pingDrone,
  saveFlight,
  getAllFlights,
  getFlightById,
  deleteFlight
};
