const path = require('node:path');
const express = require('express');
const { loadGameData } = require('./lib/gameData');

const PORT = process.env.PORT || 3000;
const gameData = loadGameData();

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.render('index'));
app.get('/api/game-data', (req, res) => res.json(gameData));

app.listen(PORT, () => {
  console.log(`Game running at http://localhost:${PORT}`);
});
