const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Servir archivos estáticos del frontend
app.use(express.static(path.join(__dirname, 'public')));

// Servir archivos estáticos de las canciones (videos, audios, pictos, etc.)
app.use('/songs', express.static(path.join(__dirname, 'MAPS-HIGHHD')));

// Ruta de API para obtener el catálogo de canciones
app.get('/api/songs', (req, res) => {
  try {
    const playlistsPath = path.join(__dirname, 'MAPS-HIGHHD', 'playlists.json');
    if (!fs.existsSync(playlistsPath)) {
      return res.status(404).json({ error: 'playlists.json no encontrado' });
    }

    const playlistsData = JSON.parse(fs.readFileSync(playlistsPath, 'utf8'));
    const mapsList = playlistsData.playlistCluster[0].maps;

    const songs = [];

    for (const item of mapsList) {
      const id = item.name;
      const songDir = path.join(__dirname, 'MAPS-HIGHHD', id);
      const descPath = path.join(songDir, 'songdesc.json');

      if (fs.existsSync(songDir) && fs.existsSync(descPath)) {
        try {
          const desc = JSON.parse(fs.readFileSync(descPath, 'utf8'));
          
          // Buscar dinámicamente los nombres de archivos multimedia en la carpeta 'media'
          const mediaDir = path.join(songDir, 'media');
          let videoFile = '';
          let audioFile = '';
          let previewFile = '';

          if (fs.existsSync(mediaDir)) {
            const files = fs.readdirSync(mediaDir);
            videoFile = files.find(f => f.endsWith('.webm') && f !== 'preview.webm') || '';
            previewFile = files.find(f => f === 'preview.webm') || videoFile;
            audioFile = files.find(f => f.endsWith('.ogg')) || '';
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

// Capturar todo el resto de peticiones para servir index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Servidor de Just Dance corriendo en http://localhost:${PORT}`);
});
