const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Habilitar parseo de JSON en peticiones POST/PUT
app.use(express.json());

// Servir archivos estáticos del frontend
app.use(express.static(path.join(__dirname, 'public')));

// Servir archivos estáticos de las canciones (videos, audios, pictos, etc.)
app.use('/songs', express.static(path.join(__dirname, 'MAPS-HIGHHD')));

// Ruta de API para obtener el catálogo de canciones
app.get('/api/songs', (req, res) => {
  try {
    const mapsDir = path.join(__dirname, 'MAPS-HIGHHD');
    if (!fs.existsSync(mapsDir)) {
      return res.status(404).json({ error: 'Directorio MAPS-HIGHHD no encontrado' });
    }

    const files = fs.readdirSync(mapsDir);
    const songs = [];

    for (const file of files) {
      const songDir = path.join(mapsDir, file);
      
      // Validar si es un directorio y contiene songdesc.json
      try {
        const stat = fs.statSync(songDir);
        if (!stat.isDirectory()) continue;
      } catch (e) {
        continue;
      }

      const id = file;
      const descPath = path.join(songDir, 'songdesc.json');

      if (fs.existsSync(descPath)) {
        try {
          const desc = JSON.parse(fs.readFileSync(descPath, 'utf8'));
          
          // Buscar dinámicamente los nombres de archivos multimedia en la carpeta 'media'
          const mediaDir = path.join(songDir, 'media');
          let videoFile = '';
          let audioFile = '';
          let previewFile = '';

          if (fs.existsSync(mediaDir)) {
            const filesInMedia = fs.readdirSync(mediaDir);
            videoFile = filesInMedia.find(f => f.endsWith('.webm') && f !== 'preview.webm') || '';
            previewFile = filesInMedia.find(f => f === 'preview.webm') || videoFile;
            audioFile = filesInMedia.find(f => f.endsWith('.ogg')) || '';
          }

          const coaches = [];
          if (fs.existsSync(path.join(songDir, 'menuart'))) {
            const menuFiles = fs.readdirSync(path.join(songDir, 'menuart'));
            for (let i = 1; i <= (desc.numCoach || 1); i++) {
              const coachFile = `coach${String(i).padStart(2, '0')}.png`;
              if (menuFiles.includes(coachFile)) {
                coaches.push(`/songs/${id}/menuart/${coachFile}`);
              }
            }
          }

          let videoStartTime = 0;
          const musictrackPath = path.join(songDir, 'musictrack.json');
          if (fs.existsSync(musictrackPath)) {
            try {
              const mt = JSON.parse(fs.readFileSync(musictrackPath, 'utf8'));
              videoStartTime = mt.videoStartTime || 0;
            } catch (e) {}
          }

          songs.push({
            id,
            title: desc.title || id,
            artist: desc.artist || 'Desconocido',
            credits: desc.credits || '',
            jdVersion: desc.jdVersion || 'Desconocido',
            numCoach: desc.numCoach || 1,
            difficulty: desc.difficulty || 1,
            coverPath: `/songs/${id}/menuart/cover.png`,
            bkgPath: `/songs/${id}/menuart/bkg.png`,
            titlePath: `/songs/${id}/menuart/title.png`,
            coaches,
            previewUrl: previewFile ? `/songs/${id}/media/${previewFile}` : '',
            videoUrl: videoFile ? `/songs/${id}/media/${videoFile}` : '',
            audioUrl: audioFile ? `/songs/${id}/media/${audioFile}` : '',
            videoStartTime
          });
        } catch (err) {
          console.error(`Error procesando canción ${id}:`, err);
        }
      }
    }

    // Ordenar alfabéticamente por título de la canción
    songs.sort((a, b) => a.title.localeCompare(b.title));

    res.json(songs);
  } catch (error) {
    console.error('Error al obtener canciones:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// Ruta para cargar el archivo timeline.json de una canción
app.get('/api/songs/:id/timeline', (req, res) => {
  const songId = req.params.id;
  const timelinePath = path.join(__dirname, 'MAPS-HIGHHD', songId, 'timeline.json');
  
  if (fs.existsSync(timelinePath)) {
    res.sendFile(timelinePath);
  } else {
    res.status(404).json({ error: 'timeline.json no encontrado para esta canción' });
  }
});

// ==========================================
// API DE PERFILES (DANCE CARDS) - SQLITE
// ==========================================

// Obtener todos los perfiles
app.get('/api/profiles', (req, res) => {
  db.all('SELECT * FROM profiles ORDER BY name ASC', (err, rows) => {
    if (err) {
      console.error('Error al obtener perfiles:', err);
      return res.status(500).json({ error: 'Error al obtener perfiles' });
    }
    res.json(rows);
  });
});

// Crear un nuevo perfil
app.post('/api/profiles', (req, res) => {
  const { name, avatar } = req.body;
  if (!name || !avatar) {
    return res.status(400).json({ error: 'Nombre y avatar requeridos' });
  }
  db.run(
    'INSERT INTO profiles (name, avatar, is_active) VALUES (?, ?, 0)',
    [name, avatar],
    function(err) {
      if (err) {
        console.error('Error al crear perfil:', err);
        return res.status(500).json({ error: 'Error al crear perfil' });
      }
      res.json({ id: this.lastID, name, avatar, is_active: 0 });
    }
  );
});

// Modificar un perfil
app.put('/api/profiles/:id', (req, res) => {
  const { name, avatar } = req.body;
  const { id } = req.params;
  if (!name || !avatar) {
    return res.status(400).json({ error: 'Nombre y avatar requeridos' });
  }
  db.run(
    'UPDATE profiles SET name = ?, avatar = ? WHERE id = ?',
    [name, avatar, id],
    function(err) {
      if (err) {
        console.error('Error al actualizar perfil:', err);
        return res.status(500).json({ error: 'Error al actualizar perfil' });
      }
      res.json({ id: parseInt(id), name, avatar });
    }
  );
});

// Activar un perfil específico (desactivando los otros)
app.put('/api/profiles/:id/activate', (req, res) => {
  const { id } = req.params;
  db.serialize(() => {
    db.run('UPDATE profiles SET is_active = 0', (err) => {
      if (err) {
        console.error('Error al desactivar perfiles:', err);
        return res.status(500).json({ error: 'Error al activar perfil' });
      }
      db.run('UPDATE profiles SET is_active = 1 WHERE id = ?', [id], (updateErr) => {
        if (updateErr) {
          console.error('Error al activar perfil:', updateErr);
          return res.status(500).json({ error: 'Error al activar perfil' });
        }
        db.all('SELECT * FROM profiles ORDER BY name ASC', (fetchErr, rows) => {
          if (fetchErr) {
            return res.status(500).json({ error: 'Error al obtener perfiles' });
          }
          res.json(rows);
        });
      });
    });
  });
});

// Eliminar un perfil
app.delete('/api/profiles/:id', (req, res) => {
  const { id } = req.params;
  // No permitir eliminar el único perfil activo si es el último
  db.get('SELECT COUNT(*) as count FROM profiles', (countErr, countRow) => {
    if (countErr) {
      return res.status(500).json({ error: 'Error al eliminar' });
    }
    if (countRow.count <= 1) {
      return res.status(400).json({ error: 'No puedes eliminar el único perfil existente' });
    }
    db.get('SELECT is_active FROM profiles WHERE id = ?', [id], (activeErr, activeRow) => {
      if (activeErr) return res.status(500).json({ error: 'Error al eliminar' });
      
      db.run('DELETE FROM profiles WHERE id = ?', [id], function(deleteErr) {
        if (deleteErr) {
          console.error('Error al eliminar perfil:', deleteErr);
          return res.status(500).json({ error: 'Error al eliminar perfil' });
        }
        // Si el perfil eliminado era el activo, activar otro perfil disponible
        if (activeRow && activeRow.is_active === 1) {
          db.run('UPDATE profiles SET is_active = 1 WHERE id = (SELECT id FROM profiles LIMIT 1)', (updateErr) => {
            db.all('SELECT * FROM profiles ORDER BY name ASC', (fetchErr, rows) => {
              res.json(rows);
            });
          });
        } else {
          db.all('SELECT * FROM profiles ORDER BY name ASC', (fetchErr, rows) => {
            res.json(rows);
          });
        }
      });
    });
  });
});

// Capturar todo el resto de peticiones para servir index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Servidor de Just Dance corriendo en http://localhost:${PORT}`);
});
