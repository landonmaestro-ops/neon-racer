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

function updateBots() {
    const pIds = Object.keys(players);
    const botsNeeded = Math.max(0, TOTAL_CARS - pIds.length);
    let rCount = pIds.filter(id => players[id].team === 'red').length;
    let bCount = pIds.filter(id => players[id].team === 'blue').length;

    for (let i = 0; i < botsNeeded; i++) {
        const id = 'bot_' + Math.random().toString(36).substr(2, 5);
        if (bots[id]) continue;
        const team = (rCount <= bCount) ? 'red' : 'blue';
        if (team === 'red') rCount++; else bCount++;
        bots[id] = { 
            x: (Math.random()-0.5)*300, 
            z: (Math.random()-0.5)*300, 
            rot: 0, 
            team, 
            health: 3,
            waypoint: { x: (Math.random()-0.5)*200, z: (Math.random()-0.5)*200 },
            state: 'patrol'
        };
    }
}

// BOT ENGINE - Human-like Searching
setInterval(() => {
    Object.keys(bots).forEach(id => {
        const bot = bots[id];
        let closest = null; 
        let minDist = 400; // Sight range

        const enemies = [...Object.entries(players), ...Object.entries(bots)].filter(([eid, e]) => e.team !== bot.team);
        
        enemies.forEach(([eid, e]) => {
            const d = Math.sqrt((e.x - bot.x)**2 + (e.z - bot.z)**2);
            if (d < minDist) { minDist = d; closest = e; }
        });

        let tx, tz, moveSpeed;

        if (closest) {
            // TARGET ACQUIRED
            bot.state = 'chase';
            bot.lastKnownPos = { x: closest.x, z: closest.z };
            tx = closest.x; tz = closest.z;
            moveSpeed = 0.9; // Fast chase
        } else if (bot.lastKnownPos) {
            // SEARCH LAST KNOWN POSITION
            bot.state = 'investigate';
            tx = bot.lastKnownPos.x; tz = bot.lastKnownPos.z;
            moveSpeed = 0.7;
            if (Math.sqrt((bot.x - tx)**2 + (bot.z - tz)**2) < 10) {
                bot.lastKnownPos = null; // Position cleared, go back to patrol
            }
        } else {
            // PATROL RANDOM WAYPOINTS
            bot.state = 'patrol';
            tx = bot.waypoint.x; tz = bot.waypoint.z;
            moveSpeed = 0.5; // Cruising
            if (Math.sqrt((bot.x - tx)**2 + (bot.z - tz)**2) < 15) {
                bot.waypoint = { x: (Math.random()-0.5)*300, z: (Math.random()-0.5)*300 };
            }
        }

        // Steer & Move
        let targetRot = Math.atan2(tx - bot.x, tz - bot.z);
        let diff = targetRot - bot.rot;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        bot.rot += diff * 0.07;

        bot.x += Math.sin(bot.rot) * moveSpeed;
        bot.z += Math.cos(bot.rot) * moveSpeed;

        if (closest && minDist < 120 && Math.random() < 0.04) {
            io.emit('projectileSpawned', { x: bot.x, z: bot.z, rot: bot.rot, owner: id, team: bot.team });
        }
    });
    io.emit('botUpdate', bots);
}, 50);

// Rest of server code (io.on connection, hit logic, etc.) remains same as previous TDM version
io.on('connection', (socket) => {
    const r = Object.values(players).filter(p => p.team === 'red').length;
    const b = Object.values(players).filter(p => p.team === 'blue').length;
    players[socket.id] = { x: 0, z: 0, rot: 0, team: r <= b ? 'red' : 'blue', health: 3 };
    updateBots();
    socket.emit('init', { id: socket.id, team: players[socket.id].team });

    socket.on('playerMovement', (d) => { if(players[socket.id]) { Object.assign(players[socket.id], d); socket.broadcast.emit('playerMoved', {id: socket.id, x:d.x, z:d.z, rot:d.rot}); }});
    socket.on('shoot', (p) => io.emit('projectileSpawned', p));
    socket.on('hit', (data) => {
        let t = data.type === 'player' ? players[data.id] : bots[data.id];
        if (t) {
            t.health--;
            io.emit('healthUpdate', { id: data.id, health: t.health });
            if (t.health <= 0) {
                if (data.attackerTeam === 'red') scores.red++; else scores.blue++;
                t.health = 3; t.x = (Math.random()-0.5)*150; t.z = (Math.random()-0.5)*150;
                io.emit('scoreUpdate', scores);
                io.emit('explosion', { x: data.x, z: data.z });
                if (data.type === 'player') io.emit('playerReset', { id: data.id, x: t.x, z: t.z });
            }
        }
    });
    socket.on('disconnect', () => { delete players[socket.id]; updateBots(); });
});
http.listen(3000);
