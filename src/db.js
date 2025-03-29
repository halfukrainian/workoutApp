const Database = require('better-sqlite3');
const path = require('path');

// Path to the SQLite database file
const dbPath = path.join(__dirname, 'workout.db');
const db = new Database(dbPath);