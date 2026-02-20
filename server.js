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
const zones = { red: { x: 120, z: 0 }, blue: { x: -120, z: 0 } };

function updateBots() {
    const pIds = Object.keys(players);
    const botsNeeded = Math.max(0, TOTAL_CARS - pIds.length);
    
    // Clear dead bots and sync
    Object.keys(bots).forEach(id => { if(!bots[id]) { delete bots[id]; io.emit('botRemoved', id); } });

    let redCount = pIds.filter(id => players[id].team === 'red').length;
    let blueCount = pIds.filter(id => players[id].team === 'blue').length;

    for (let i = 0; i < botsNeeded; i++) {
        const id = 'bot_' + Math.random().toString(36).substr(2, 5);
        if (bots[id]) continue; 
        const team = (redCount <= blueCount) ? 'red' : 'blue';
        if (team === 'red') redCount++; else blueCount++;
        
        bots[id] = { 
            x: (Math.random()-0.5)*200, 
            z: (Math.random()-0.5)*200, 
            rot: 0, 
            team, 
            health: 2, 
            role: (i % 2 === 0) ? 'striker' : 'defender' 
        };
    }
}

// BOT ENGINE - Forced Movement
setInterval(() => {
    Object.keys(bots).forEach(id => {
        const bot = bots[id];
        let target = zones[bot.team];
        let closestEnemy = null;
        let minDist = 1000;

        // Find nearest enemy (Player or Bot)
        const enemies = [...Object.entries(players), ...Object.entries(bots)].filter(([eid, e]) => e.team !== bot.team);
        enemies.forEach(([eid, e]) => {
            const d = Math.sqrt((e.x - bot.x)**2 + (e.z - bot.z)**2);
            if (d < minDist) { minDist = d; closestEnemy = e; }
        });

        // Striker Logic: Aggressive chasing
        if (bot.role === 'striker' && closestEnemy && minDist < 250) {
            target = { x: closestEnemy.x, z: closestEnemy.z };
        }

        // Calculation & Movement
        const dx = target.x - bot.x;
        const dz = target.z - bot.z;
        const targetRot = Math.atan2(dx, dz);
        
        // Smooth rotation
        let diff = targetRot - bot.rot;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        bot.rot += diff * 0.1;

        bot.x += Math.sin(bot.rot) * 0.75;
        bot.z += Math.cos(bot.rot) * 0.75;

        // Shooting logic
        if (closestEnemy && minDist < 80 && Math.random() < 0.05) {
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
                const ang = Math.random() * Math.PI * 2;
                target.x = Math.cos(ang) * 50; target.z = Math.sin(ang) * 50;
                target.health = 2;
                io.emit('explosion', { x: data.x, z: data.z, color: target.team === 'red' ? 0xff0000 : 0x0066ff });
                if (data.type === 'player') io.emit('playerReset', { id: data.id, x: target.x, z: target.z });
            }
        }
    });

    socket.on('disconnect', () => { delete players[socket.id]; updateBots(); io.emit('playerDisconnected', socket.id); });
});

http.listen(3000, () => console.log('BOTS ENGAGED'));
