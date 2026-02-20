const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

const players = {};
const bots = {};
const TOTAL_CARS = 10;

// Function to maintain 10 total cars
function updateBots() {
    const playerCount = Object.keys(players).length;
    const botsNeeded = Math.max(0, TOTAL_CARS - playerCount);
    const currentBotCount = Object.keys(bots).length;

    if (currentBotCount < botsNeeded) {
        // Add a bot
        const id = 'bot_' + Math.random().toString(36).substr(2, 9);
        bots[id] = {
            x: (Math.random() - 0.5) * 800,
            z: (Math.random() - 0.5) * 800,
            rot: Math.random() * Math.PI * 2,
            color: 0xff0000, // Bots are Red-ish
            speed: 0.1 + Math.random() * 0.2
        };
    } else if (currentBotCount > botsNeeded) {
        // Remove a bot
        const firstBotId = Object.keys(bots)[0];
        delete bots[firstBotId];
        io.emit('botRemoved', firstBotId);
    }
}

// Move bots aimlessly
setInterval(() => {
    Object.keys(bots).forEach(id => {
        const bot = bots[id];
        bot.x += Math.sin(bot.rot) * bot.speed;
        bot.z += Math.cos(bot.rot) * bot.speed;
        // Randomly turn bots
        if (Math.random() > 0.98) bot.rot += (Math.random() - 0.5) * 2;
        // Wrap around boundary
        if (Math.abs(bot.x) > 500) bot.x *= -0.9;
        if (Math.abs(bot.z) > 500) bot.z *= -0.9;
    });
    io.emit('botUpdate', bots);
}, 100);

io.on('connection', (socket) => {
    players[socket.id] = { x: 0, z: 0, rot: 0, color: 0x00ffff };
    updateBots();
    
    socket.emit('currentPlayers', players);
    socket.emit('botUpdate', bots);
    socket.broadcast.emit('newPlayer', { id: socket.id, info: players[socket.id] });

    socket.on('playerMovement', (data) => {
        if (players[socket.id]) {
            players[socket.id].x = data.x;
            players[socket.id].z = data.z;
            players[socket.id].rot = data.rot;
            socket.broadcast.emit('playerMoved', { id: socket.id, info: players[socket.id] });
        }
    });

    socket.on('chatMessage', (msg) => {
        io.emit('chatMessage', { id: socket.id, msg: msg });
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        updateBots();
        io.emit('playerDisconnected', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log('--- SERVER ACTIVE ---'));
