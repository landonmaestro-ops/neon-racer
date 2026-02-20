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
    { x: 60, z: 60, w: 40, d: 40, h: 50 },
    { x: -80, z: -30, w: 50, d: 30, h: 80 },
    { x: 30, z: -120, w: 30, d: 60, h: 40 },
    { x: 120, z: 90, w: 40, d: 40, h: 60 }
];

let zones = { red: { x: 150, z: 0 }, blue: { x: -150, z: 0 } };

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
        bots[id] = { x: (Math.random()-0.5)*100, z: (Math.random()-0.5)*100, rot: 0, team, health: 2, role: (i % 2 === 0) ? 'striker' : 'defender' };
    }
}

// Bot Brain
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

        if (bot.role === 'striker' && closestEnemy && minDist < 200) {
            targetPos = { x: closestEnemy.x, z: closestEnemy.z };
            bot.speed = minDist > 40 ? 1.2 : 0.7;
        } else {
            targetPos = zones[bot.team];
            bot.speed = 0.7;
        }

        const dx = targetPos.x - bot.x, dz = targetPos.z - bot.z;
        bot.rot = Math.atan2(dx, dz);
        bot.x += Math.sin(bot.rot) * bot.speed;
        bot.z += Math.cos(bot.rot) * bot.speed;

        if (closestEnemy && minDist < 60 && Math.random() < 0.05) {
            io.emit('projectileSpawned', { x: bot.x, z: bot.z, rot: bot.rot, owner: id, team: bot.team });
        }
    });
    io.emit('botUpdate', bots);
}, 50);

io.on('connection', (socket) => {
    const reds = Object.values(players).filter(p => p.team === 'red').length;
    const blues = Object.values(players).filter(p => p.team === 'blue').length;
    players[socket.id] = { x: 0, z: 0, rot: 0, team: reds <= blues ? 'red' : 'blue', health: 2 };
    updateBots();
    
    socket.on('playerMovement', (data) => {
        if (players[socket.id]) {
            players[socket.id].x = data.x; players[socket.id].z = data.z; players[socket.id].rot = data.rot;
            socket.broadcast.emit('playerMoved', { id: socket.id, info: players[socket.id] });
        }
    });

    socket.on('shoot', (p) => socket.broadcast.emit('projectileSpawned', p));

    socket.on('hit', (data) => {
        let t = data.type === 'player' ? players[data.id] : bots[data.id];
        if (t) {
            t.health -= 1;
            io.emit('healthUpdate', { id: data.id, health: t.health, type: data.type });
            if (t.health <= 0) {
                const ang = Math.random() * Math.PI * 2;
                const dist = 30 + Math.random() * 20;
                t.x = Math.cos(ang) * dist; t.z = Math.sin(ang) * dist;
                t.health = 2;
                io.emit('explosion', { x: data.impactX, z: data.impactZ, color: t.team === 'red' ? 0xff0000 : 0x0066ff });
                if (data.type === 'player') io.emit('playerReset', { id: data.id, x: t.x, z: t.z });
            }
        }
    });

    socket.on('disconnect', () => { delete players[socket.id]; updateBots(); io.emit('playerDisconnected', socket.id); });
});

http.listen(3000, () => console.log('ARENA RUNNING'));
