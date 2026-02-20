const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static('./public'));

const players = {};

io.on('connection', (socket) => {
    console.log('Player connected: ' + socket.id);
    players[socket.id] = { x: 0, z: 0, rot: 0, color: 0x00ffff };
    
    socket.emit('currentPlayers', players);
    socket.broadcast.emit('newPlayer', { id: socket.id, info: players[socket.id] });

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
        io.emit('playerDisconnected', socket.id);
    });
});

http.listen(3000, () => {
    console.log('--- SERVER ACTIVE ---');
    console.log('Go to: http://localhost:3000');
});