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
  pingDrone
};
