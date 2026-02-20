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

const buildings = [
    { x: 60, z: 60, w: 40, d: 40, h: 50 },
    { x: -80, z: -30, w: 50, d: 30, h: 80 },
    { x: 30, z: -120, w: 30, d: 60, h: 40 },
    { x: 120, z: 90, w: 40, d: 40, h: 60 }
];

let zones = { red: { x: 120, z: 0 }, blue: { x: -120, z: 0 } };

function updateBots() {
    const pIds = Object.keys(players);
    const botsNeeded = Math.max(0, TOTAL_CARS - pIds.length);
    
    // Clear old bots
    Object.keys(bots).forEach(id => { delete bots[id]; io.emit('botRemoved', id); });

    let redCount = pIds.filter(id => players[id].team === 'red').length;
    let blueCount = pIds.filter(id => players[id].team === 'blue').length;

    for (let i = 0; i < botsNeeded; i++) {
        const id = 'bot_' + Math.random().toString(36).substr(2, 5);
        const team = (redCount <= blueCount) ? 'red' : 'blue';
        if (team === 'red') redCount++; else blueCount++;
        
        bots[id] = { 
            x: (Math.random()-0.5)*100, 
            z: (Math.random()-0.5)*100, 
            rot: 0, 
            team, 
            health: 2, 
            role: (i % 2 === 0) ? 'striker' : 'defender' 
        };
    }
}

// Global Bot AI Loop
setInterval(() => {
    Object.keys(bots).forEach(id => {
        const bot = bots[id];
        let target = zones[bot.team];
        let closestEnemy = null;
        let minDist = Infinity;

        const enemies = [...Object.entries(players), ...Object.entries(bots)].filter(([eid, e]) => e.team !== bot.team);
        enemies.forEach(([eid, e]) => {
            const d = Math.sqrt((e.x - bot.x)**2 + (e.z - bot.z)**2);
            if (d < minDist) { minDist = d; closestEnemy = e; }
        });

        // AI Logic: Half hunt, half hold zone
        if (bot.role === 'striker' && closestEnemy && minDist < 200) {
            target = { x: closestEnemy.x, z: closestEnemy.z };
        }

        const dx = target.x - bot.x, dz = target.z - bot.z;
        bot.rot = Math.atan2(dx, dz);
        bot.x += Math.sin(bot.rot) * 0.7;
        bot.z += Math.cos(bot.rot) * 0.7;

        if (closestEnemy && minDist < 60 && Math.random() < 0.03) {
            io.emit('projectileSpawned', { x: bot.x, z: bot.z, rot: bot.rot, owner: id, team: bot.team });
        }
    });
    io.emit('botUpdate', bots);
}, 50);

// Score logic
setInterval(() => {
    let rCount = 0, bCount = 0;
    [...Object.values(players), ...Object.values(bots)].forEach(c => {
        const z = zones[c.team];
        if (Math.sqrt((c.x-z.x)**2 + (c.z-z.z)**2) < 20) {
            if (c.team === 'red') rCount++; else bCount++;
        }
    });
    if (rCount > bCount) scores.red++; else if (bCount > rCount) scores.blue++;
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

    socket.on('shoot', (p) => io.emit('projectileSpawned', p));

    socket.on('hit', (data) => {
        let target = data.type === 'player' ? players[data.id] : bots[data.id];
        if (target) {
            target.health -= 1;
            io.emit('healthUpdate', { id: data.id, health: target.health });
            if (target.health <= 0) {
                // Fixed Respawn: Random circle offset
                const ang = Math.random() * Math.PI * 2;
                target.x = Math.cos(ang) * 40; target.z = Math.sin(ang) * 40;
                target.health = 2;
                io.emit('explosion', { x: data.x, z: data.z, color: target.team === 'red' ? 0xff0000 : 0x0066ff });
                if (data.type === 'player') io.emit('playerReset', { id: data.id, x: target.x, z: target.z });
            }
        }
    });

    socket.on('disconnect', () => { delete players[socket.id]; updateBots(); io.emit('playerDisconnected', socket.id); });
});

http.listen(3000, () => console.log('SERVER READY'));
