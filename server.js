const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

let players = {};
let bots = {};
const TOTAL_CARS = 10;

function updateBots() {
    const playerCount = Object.keys(players).length;
    const botsNeeded = Math.max(0, TOTAL_CARS - playerCount);
    
    // Remove extra bots if players joined
    while (Object.keys(bots).length > botsNeeded) {
        const firstBotId = Object.keys(bots)[0];
        delete bots[firstBotId];
        io.emit('botRemoved', firstBotId);
    }

    // Add bots until we hit the target
    while (Object.keys(bots).length < botsNeeded) {
        const id = 'bot_' + Math.random().toString(36).substr(2, 9);
        const neonColors = [0xff00ff, 0x00ff00, 0xffff00, 0xff0000, 0x00ffff, 0xffa500];
        bots[id] = {
            x: (Math.random() - 0.5) * 800,
            z: (Math.random() - 0.5) * 800,
            rot: Math.random() * Math.PI * 2,
            color: neonColors[Math.floor(Math.random() * neonColors.length)],
            speed: 0.15 + Math.random() * 0.25
        };
    }
}

// Bot Brains: Move and Turn
setInterval(() => {
    Object.keys(bots).forEach(id => {
        const bot = bots[id];
        bot.x += Math.sin(bot.rot) * bot.speed;
        bot.z += Math.cos(bot.rot) * bot.speed;
        if (Math.random() > 0.98) bot.rot += (Math.random() - 0.5) * 2;
        if (Math.abs(bot.x) > 450 || Math.abs(bot.z) > 450) bot.rot += Math.PI; // Bounce off edges
    });
    io.emit('botUpdate', bots);
}, 100);

io.on('connection', (socket) => {
    players[socket.id] = { x: 0, z: 0, rot: 0 };
    updateBots();
    
    socket.emit('currentPlayers', players);
    socket.emit('botUpdate', bots);
    socket.broadcast.emit('newPlayer', { id: socket.id });

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
http.listen(PORT, () => console.log('SERVER ONLINE'));
