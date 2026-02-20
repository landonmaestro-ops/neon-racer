const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

let players = {};
let bots = {};
const TOTAL_CARS = 10;
const MAP_SIZE = 400;
let scores = { red: 0, blue: 0 };
let zoneTimer = 240;

const buildings = [
    { x: 60, z: 60, w: 40, d: 40, h: 50 },
    { x: -80, z: -30, w: 50, d: 30, h: 80 },
    { x: 30, z: -120, w: 30, d: 60, h: 40 },
    { x: 120, z: 90, w: 40, d: 40, h: 60 }
];

let zones = { red: { x: 150, z: 0 }, blue: { x: -150, z: 0 } };

function isOverBuilding(x, z) {
    return buildings.some(b => x > b.x - (b.w/2 + 15) && x < b.x + (b.w/2 + 15) && z > b.z - (b.d/2 + 15) && z < b.z + (b.d/2 + 15));
}

function rotateZones() {
    const distance = 150;
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

function updateBots() {
    const pIds = Object.keys(players);
    const botsNeeded = Math.max(0, TOTAL_CARS - pIds.length);
    Object.keys(bots).forEach(id => { delete bots[id]; io.emit('botRemoved', id); });

    let redTotal = pIds.filter(id => players[id].team === 'red').length;
    let blueTotal = pIds.filter(id => players[id].team === 'blue').length;

    for (let i = 0; i < botsNeeded; i++) {
        const id = 'bot_' + Math.random().toString(36).substr(2, 5);
        const team = (redTotal <= blueTotal) ? 'red' : 'blue';
        if (team === 'red') redTotal++; else blueTotal++;
        
        // 50/50 Role Split: half are "strikers" (hunt), half are "defenders" (zones)
        const role = (i % 2 === 0) ? 'striker' : 'defender';
        
        bots[id] = { 
            x: (Math.random()-0.5)*200, 
            z: (Math.random()-0.5)*200, 
            rot: 0, 
            team, 
            health: 2, 
            speed: 0.75, 
            lastShot: 0,
            role: role
        };
    }
}

setInterval(() => {
    Object.keys(bots).forEach(id => {
        const bot = bots[id];
        let targetPos = zones[bot.team];
        let closestEnemy = null;
        let minDist = Infinity;

        const enemies = [...Object.entries(players), ...Object.entries(bots)].filter(([eid, e]) => e.team !== bot.team);
        
        enemies.forEach(([eid, e]) => {
            const d = Math.sqrt((e.x - bot.x)**2 + (e.z - bot.z)**2);
            if (d < minDist) { minDist = d; closestEnemy = e; }
        });

        // Split AI Logic
        if (bot.role === 'striker' && closestEnemy && minDist < 250) {
            targetPos = { x: closestEnemy.x, z: closestEnemy.z };
            bot.speed = minDist > 40 ? 1.3 : 0.8; // Nitro chasing
        } else {
            // Defenders go to zone, but shoot if enemies get close
            targetPos = zones[bot.team];
            bot.speed = 0.75;
        }

        const dx = targetPos.x - bot.x, dz = targetPos.z - bot.z;
        const targetRot = Math.atan2(dx, dz);
        let diff = targetRot - bot.rot;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        bot.rot += diff * 0.1;
        bot.x += Math.sin(bot.rot) * bot.speed;
        bot.z += Math.cos(bot.rot) * bot.speed;

        // Combat
        const now = Date.now();
        if (closestEnemy && minDist < 70 && now - bot.lastShot > 2500) {
            io.emit('projectileSpawned', { x: bot.x, z: bot.z, rot: Math.atan2(closestEnemy.x - bot.x, closestEnemy.z - bot.z), owner: id, team: bot.team });
            bot.lastShot = now;
        }
    });
    io.emit('botUpdate', bots);
}, 50);

setInterval(() => {
    let rIn = 0, bIn = 0;
    [...Object.values(players), ...Object.values(bots)].forEach(c => {
        const z = zones[c.team];
        if (Math.sqrt((c.x-z.x)**2 + (c.z-z.z)**2) < 15) {
            if (c.team === 'red') rIn++; else bIn++;
        }
    });
    if (rIn > bIn) scores.red++; else if (bIn > rIn) scores.blue++;
    io.emit('scoreUpdate', scores);
}, 1000);

io.on('connection', (socket) => {
    const reds = Object.values(players).filter(p => p.team === 'red').length;
    const blues = Object.values(players).filter(p => p.team === 'blue').length;
    players[socket.id] = { x: 0, z: 0, rot: 0, team: reds <= blues ? 'red' : 'blue', health: 2 };
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
                // Fixed Stuck Respawn: Move away from center slightly so they don't stack
                t.x = (Math.random()-0.5) * 40; 
                t.z = (Math.random()-0.5) * 40; 
                t.health = 2;
                io.emit('explosion', { x: data.impactX, z: data.impactZ, color: t.team === 'red' ? 0xff0000 : 0x0066ff });
                if (data.type === 'player') io.emit('playerReset', { id: data.id, x: t.x, z: t.z });
            }
            io.emit('healthUpdate', { id: data.id, health: t.health, type: data.type });
        }
    });

    socket.on('disconnect', () => { delete players[socket.id]; updateBots(); io.emit('playerDisconnected', socket.id); });
});

http.listen(3000, () => console.log('BATTLE READY'));
