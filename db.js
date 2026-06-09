const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'database.db');
const db = new sqlite3.Database(dbPath);

// Inicializar la base de datos
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      avatar TEXT NOT NULL,
      is_active INTEGER DEFAULT 0
    )
  `);

  // Insertar un perfil inicial por defecto si la tabla está vacía
  db.get('SELECT COUNT(*) as count FROM profiles', (err, row) => {
    if (err) {
      console.error('Error al verificar perfiles:', err);
      return;
    }
    if (row && row.count === 0) {
      db.run(
        "INSERT INTO profiles (name, avatar, is_active) VALUES ('Player 1', '/assets/avatars/avatar_01.png', 1)",
        (insertErr) => {
          if (insertErr) {
            console.error('Error al insertar perfil inicial:', insertErr);
          } else {
            console.log('Base de datos inicializada: Perfil por defecto creado.');
          }
        }
      );
    } else {
      console.log('Base de datos inicializada: Los perfiles ya existen.');
    }
  });
});

module.exports = db;
