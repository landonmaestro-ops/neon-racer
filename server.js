const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

let players = {};
let bots = {};
const TOTAL_CARS = 10;
let scores = { red: 0, blue: 0 };
let zoneTimer = 240;

const buildings = [
    { x: 100, z: 100, w: 40, d: 40, h: 50 },
    { x: -150, z: -50, w: 50, d: 30, h: 80 },
    { x: 50, z: -200, w: 30, d: 60, h: 40 },
    { x: 200, z: 150, w: 40, d: 40, h: 60 }
];

let zones = { red: { x: 350, z: 0 }, blue: { x: -350, z: 0 } };

function rotateZones() {
    const distance = 350;
    let rx, rz, bx, bz, found = false;
    while (!found) {
        let a = Math.random() * Math.PI * 2;
        rx = Math.cos(a) * distance; rz = Math.sin(a) * distance;
        bx = -Math.cos(a) * distance; bz = -Math.sin(a) * distance;
        if (!isOverBuilding(rx, rz) && !isOverBuilding(bx, bz)) found = true;
    }
    zones.red = { x: rx, z: rz }; zones.blue = { x: bx, z: bz };
    io.emit('zonesUpdate', zones);
}

function isOverBuilding(x, z) {
    return buildings.some(b => x > b.x-b.w/2-20 && x < b.x+b.w/2+20 && z > b.z-b.d/2-20 && z < b.z+b.d/2+20);
}

setInterval(() => {
    zoneTimer--;
    if (zoneTimer <= 0) { rotateZones(); zoneTimer = 240; }
    io.emit('timerUpdate', zoneTimer);
}, 1000);

// Scoring & Team Balancing
function updateBots() {
    const pIds = Object.keys(players);
    const botsNeeded = Math.max(0, TOTAL_CARS - pIds.length);
    
    // Clear bots to re-balance teams
    const bIds = Object.keys(bots);
    bIds.forEach(id => { delete bots[id]; io.emit('botRemoved', id); });

    let redCount = pIds.filter(id => players[id].team === 'red').length;
    let blueCount = pIds.filter(id => players[id].team === 'blue').length;

    for (let i = 0; i < botsNeeded; i++) {
        const id = 'bot_' + Math.random().toString(36).substr(2, 5);
        const team = (redCount <= blueCount) ? 'red' : 'blue';
        if (team === 'red') redCount++; else blueCount++;
        
        bots[id] = { x: (Math.random()-0.5)*400, z: (Math.random()-0.5)*400, rot: 0, team, health: 2, speed: 0.7 };
    }
}

io.on('connection', (socket) => {
    const pCount = Object.keys(players).length;
    const team = (pCount % 2 === 0) ? 'red' : 'blue';
    players[socket.id] = { x: 0, z: 0, rot: 0, team, health: 2 };
    updateBots();
    
    socket.emit('currentPlayers', players);
    socket.emit('zonesUpdate', zones);

    socket.on('playerMovement', (data) => {
        if (players[socket.id]) {
            players[socket.id].x = data.x; players[socket.id].z = data.z; players[socket.id].rot = data.rot;
            socket.broadcast.emit('playerMoved', { id: socket.id, info: players[socket.id] });
        }
    });

    socket.on('shoot', (p) => socket.broadcast.emit('projectileSpawned', p));

    socket.on('hit', (data) => {
        let t = data.type === 'player' ? players[data.id] : bots[data.id];
        if (t && t.team !== data.attackerTeam) {
            t.health -= 1;
            if (t.health <= 0) {
                t.x = 0; t.z = 0; t.health = 2;
                io.emit('explosion', { x: data.impactX, z: data.impactZ, color: t.team === 'red' ? 0xff0000 : 0x0066ff });
                if (data.type === 'player') io.emit('playerReset', { id: data.id });
            }
            io.emit('healthUpdate', { id: data.id, health: t.health, type: data.type });
        }
    });

    socket.on('disconnect', () => { delete players[socket.id]; updateBots(); io.emit('playerDisconnected', socket.id); });
});

http.listen(3000, () => console.log('SERVER READY'));
