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

function isOverBuilding(x, z) {
    return buildings.some(b => x > b.x - (b.w/2 + 20) && x < b.x + (b.w/2 + 20) && z > b.z - (b.d/2 + 20) && z < b.z + (b.d/2 + 20));
}

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

setInterval(() => {
    zoneTimer--;
    if (zoneTimer <= 0) { rotateZones(); zoneTimer = 240; }
    io.emit('timerUpdate', zoneTimer);
}, 1000);

// Strict Team Balancing & Bot Refill
function updateBots() {
    const pIds = Object.keys(players);
    const botsNeeded = Math.max(0, TOTAL_CARS - pIds.length);
    
    // Clear current bots to re-calc team balance properly
    Object.keys(bots).forEach(id => { delete bots[id]; io.emit('botRemoved', id); });

    let redTotal = pIds.filter(id => players[id].team === 'red').length;
    let blueTotal = pIds.filter(id => players[id].team === 'blue').length;

    for (let i = 0; i < botsNeeded; i++) {
        const id = 'bot_' + Math.random().toString(36).substr(2, 5);
        const team = (redTotal <= blueTotal) ? 'red' : 'blue';
        if (team === 'red') redTotal++; else blueTotal++;
        
        bots[id] = { 
            x: (Math.random()-0.5)*400, 
            z: (Math.random()-0.5)*400, 
            rot: 0, 
            team: team, 
            health: 2, 
            speed: 0.7,
            lastShot: 0 
        };
    }
}

// Bot AI: Movement + Combat
setInterval(() => {
    Object.keys(bots).forEach(id => {
        const bot = bots[id];
        const targetZone = zones[bot.team];
        if (!targetZone) return;

        // Movement
        const dx = targetZone.x - bot.x;
        const dz = targetZone.z - bot.z;
        const targetRot = Math.atan2(dx, dz);
        let diff = targetRot - bot.rot;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        bot.rot += diff * 0.1;
        bot.x += Math.sin(bot.rot) * bot.speed;
        bot.z += Math.cos(bot.rot) * bot.speed;

        // Combat Logic: Scan for enemies
        const now = Date.now();
        if (now - bot.lastShot > 3000) { // Shoot every 3 seconds if enemy near
            const enemies = [...Object.entries(players), ...Object.entries(bots)].filter(([eid, e]) => e.team !== bot.team);
            for (let [eid, e] of enemies) {
                const dist = Math.sqrt((e.x - bot.x)**2 + (e.z - bot.z)**2);
                if (dist < 40) {
                    const shootRot = Math.atan2(e.x - bot.x, e.z - bot.z);
                    io.emit('projectileSpawned', { x: bot.x, z: bot.z, rot: shootRot, owner: id, team: bot.team });
                    bot.lastShot = now;
                    break; 
                }
            }
        }
    });
    io.emit('botUpdate', bots);
}, 50);

// Scoring
setInterval(() => {
    let rIn = 0, bIn = 0;
    const all = [...Object.values(players), ...Object.values(bots)];
    all.forEach(c => {
        const z = zones[c.team];
        if (Math.sqrt((c.x-z.x)**2 + (c.z-z.z)**2) < 15) {
            if (c.team === 'red') rIn++; else bIn++;
        }
    });
    if (rIn > bIn) scores.red++; else if (bIn > rIn) scores.blue++;
    io.emit('scoreUpdate', scores);
}, 1000);

io.on('connection', (socket) => {
    // Balanced join logic
    const reds = Object.values(players).filter(p => p.team === 'red').length;
    const blues = Object.values(players).filter(p => p.team === 'blue').length;
    const team = (reds <= blues) ? 'red' : 'blue';
    
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

http.listen(3000, () => console.log('SERVER READY - 5VS5 ACTIVE'));
