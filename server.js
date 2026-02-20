const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

let players = {};
let bots = {};
const TOTAL_CARS = 10;

let zones = { red: { x: 350, z: 0 }, blue: { x: -350, z: 0 } };

// Equidistant Zone Math
function rotateZones() {
    const angle = Math.random() * Math.PI * 2;
    const distance = 350; // Exact distance from center
    zones.red = { x: Math.cos(angle) * distance, z: Math.sin(angle) * distance };
    zones.blue = { x: -Math.cos(angle) * distance, z: -Math.sin(angle) * distance };
    io.emit('zonesUpdate', zones);
}
setInterval(rotateZones, 4 * 60 * 1000); // 4 minutes
setInterval(() => { io.emit('zonesUpdate', zones); }, 1000); // Heartbeat

function updateBots() {
    const playerCount = Object.keys(players).length;
    const botsNeeded = Math.max(0, TOTAL_CARS - playerCount);
    while (Object.keys(bots).length > botsNeeded) {
        const id = Object.keys(bots)[0];
        delete bots[id]; io.emit('botRemoved', id);
    }
    while (Object.keys(bots).length < botsNeeded) {
        const id = 'bot_' + Math.random().toString(36).substr(2, 9);
        const team = Math.random() > 0.5 ? 'red' : 'blue';
        bots[id] = {
            x: (Math.random() - 0.5) * 600,
            z: (Math.random() - 0.5) * 600,
            rot: Math.random() * Math.PI * 2,
            team: team,
            speed: 0.4 + (Math.random() * 0.2) // Bots are faster now too
        };
    }
}

// Bot AI Loop
setInterval(() => {
    Object.keys(bots).forEach(id => {
        const bot = bots[id];
        const target = zones[bot.team];
        if (!target) return;

        const dx = target.x - bot.x;
        const dz = target.z - bot.z;
        const dist = Math.sqrt(dx*dx + dz*dz);
        
        if (dist > 15) {
            const targetRot = Math.atan2(dx, dz);
            let diff = targetRot - bot.rot;
            while (diff < -Math.PI) diff += Math.PI * 2;
            while (diff > Math.PI) diff -= Math.PI * 2;
            bot.rot += diff * 0.1; // Turn towards zone
            bot.x += Math.sin(bot.rot) * bot.speed;
            bot.z += Math.cos(bot.rot) * bot.speed;
        }
    });
    io.emit('botUpdate', bots);
}, 50);

io.on('connection', (socket) => {
    const team = Math.random() > 0.5 ? 'red' : 'blue';
    players[socket.id] = { x: 0, z: 0, rot: 0, team: team };
    updateBots();
    
    socket.emit('currentPlayers', players);
    socket.emit('zonesUpdate', zones);
    socket.broadcast.emit('newPlayer', { id: socket.id, team: team });

    socket.on('playerMovement', (data) => {
        if (players[socket.id]) {
            players[socket.id].x = data.x; players[socket.id].z = data.z; players[socket.id].rot = data.rot;
            socket.broadcast.emit('playerMoved', { id: socket.id, info: players[socket.id] });
        }
    });

    socket.on('chatMessage', (msg) => io.emit('chatMessage', { id: socket.id, msg }));
    socket.on('disconnect', () => { delete players[socket.id]; updateBots(); io.emit('playerDisconnected', socket.id); });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log('SERVER REPAIRED AND ONLINE'));
