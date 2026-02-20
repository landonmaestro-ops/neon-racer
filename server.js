const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

let players = {};
let bots = {};
const TOTAL_CARS = 10;

// Define your buildings here so zones avoid them {x, z, radius}
const buildings = [
    { x: 100, z: 100, r: 30 },
    { x: -150, z: -50, r: 40 },
    { x: 0, z: 250, r: 35 }
];

let zones = { red: { x: 350, z: 0 }, blue: { x: -350, z: 0 } };

function isOverBuilding(x, z) {
    return buildings.some(b => {
        const dist = Math.sqrt((x - b.x) ** 2 + (z - b.z) ** 2);
        return dist < (b.r + 20); // 20 is buffer for zone size
    });
}

function rotateZones() {
    const distance = 350;
    let rx, rz, bx, bz, angle;
    let foundSafeSpot = false;
    let attempts = 0;

    while (!foundSafeSpot && attempts < 100) {
        angle = Math.random() * Math.PI * 2;
        rx = Math.cos(angle) * distance;
        rz = Math.sin(angle) * distance;
        bx = -Math.cos(angle) * distance;
        bz = -Math.sin(angle) * distance;

        if (!isOverBuilding(rx, rz) && !isOverBuilding(bx, bz)) {
            foundSafeSpot = true;
        }
        attempts++;
    }

    zones.red = { x: rx, z: rz };
    zones.blue = { x: bx, z: bz };
    io.emit('zonesUpdate', zones);
}

setInterval(rotateZones, 4 * 60 * 1000); 
setInterval(() => { io.emit('zonesUpdate', zones); }, 1000);

function updateBots() {
    const playerCount = Object.keys(players).length;
    const botsNeeded = Math.max(0, TOTAL_CARS - playerCount);
    
    // Remove excess bots
    const currentBotIds = Object.keys(bots);
    if (currentBotIds.length > botsNeeded) {
        for (let i = 0; i < (currentBotIds.length - botsNeeded); i++) {
            const id = currentBotIds[i];
            delete bots[id];
            io.emit('botRemoved', id);
        }
    }

    // Add missing bots
    while (Object.keys(bots).length < botsNeeded) {
        const id = 'bot_' + Math.random().toString(36).substr(2, 9);
        bots[id] = {
            x: (Math.random() - 0.5) * 600,
            z: (Math.random() - 0.5) * 600,
            rot: Math.random() * Math.PI * 2,
            team: Math.random() > 0.5 ? 'red' : 'blue',
            speed: 0.4 + (Math.random() * 0.2)
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
            bot.rot += diff * 0.1;
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
            players[socket.id].x = data.x; 
            players[socket.id].z = data.z; 
            players[socket.id].rot = data.rot;
            socket.broadcast.emit('playerMoved', { id: socket.id, info: players[socket.id] });
        }
    });

    socket.on('disconnect', () => { 
        delete players[socket.id]; 
        updateBots(); 
        io.emit('playerDisconnected', socket.id); 
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log('SERVER ONLINE: 10 CARS ACTIVE'));
