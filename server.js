const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const path = require('path');

// Serve files from the 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

const players = {};

io.on('connection', (socket) => {
    console.log('A player connected: ' + socket.id);

    // Create new player entry
    players[socket.id] = { x: 0, z: 0, rot: 0, color: 0x00ffff };

    // Tell all players about the new person
    socket.emit('currentPlayers', players);
    socket.broadcast.emit('newPlayer', { id: socket.id, info: players[socket.id] });

    // Handle Movement
    socket.on('playerMovement', (data) => {
        if (players[socket.id]) {
            players[socket.id].x = data.x;
            players[socket.id].z = data.z;
            players[socket.id].rot = data.rot;
            socket.broadcast.emit('playerMoved', { id: socket.id, info: players[socket.id] });
        }
    });

    // Handle Chat Messages
    socket.on('chatMessage', (msg) => {
        io.emit('chatMessage', { id: socket.id, msg: msg });
    });

    // Handle Disconnect
    socket.on('disconnect', () => {
        console.log('Player disconnected: ' + socket.id);
        delete players[socket.id];
        io.emit('playerDisconnected', socket.id);
    });
});

// Use Render's port or default to 3000
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log('--- SERVER ACTIVE ---');
    console.log('Running on Port: ' + PORT);
});
