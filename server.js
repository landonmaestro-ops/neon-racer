const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  pingInterval: 1000,
  pingTimeout: 5000
});

app.use(express.static(path.join(__dirname, 'public')));

// --- GAME CONFIGURATION ---
const TICK_RATE = 60; // Server logic updates per second
const WORLD_SIZE = 200;
const PLAYER_SPEED = 8;
const GRAVITY = 30;
const JUMP_FORCE = 10;
const SLIDE_BOOST = 1.5;
const FRICTION_GROUND = 0.9;
const FRICTION_AIR = 0.98;

// Classes
const CLASSES = {
  ASSAULT: { hp: 100, speed: 1.0, fireRate: 100, damage: 25, recoil: 0.5, spread: 0.02 },
  SNIPER: { hp: 80, speed: 0.85, fireRate: 1200, damage: 100, recoil: 2.0, spread: 0.0 },
  SMG: { hp: 90, speed: 1.1, fireRate: 60, damage: 15, recoil: 0.3, spread: 0.05 },
  SHOTGUN: { hp: 110, speed: 0.95, fireRate: 800, damage: 15, recoil: 1.5, spread: 0.1, pellets: 8 }
};

// Game State
const players = {};
const projectiles = []; // For visual tracers (hitscan logic)
const hardpoint = {
  active: true,
  x: 0, y: 2, z: 0,
  radius: 10,
  controllingTeam: null,
  progress: { red: 0, blue: 0 }
};

// --- PHYSICS ENGINE ---
function updatePhysics(player, delta) {
  // Apply Gravity
  if (!player.grounded) {
    player.velocity.y -= GRAVITY * delta;
  }

  // Apply Velocity
  player.position.x += player.velocity.x * delta;
  player.position.y += player.velocity.y * delta;
  player.position.z += player.velocity.z * delta;

  // Ground Collision
  if (player.position.y <= 2) { // 2 is player height/2
    player.position.y = 2;
    player.velocity.y = 0;
    player.grounded = true;
    
    // Friction
    const friction = player.sliding ? 0.95 : FRICTION_GROUND;
    player.velocity.x *= friction;
    player.velocity.z *= friction;

    // Slide logic: if moving slow, stop sliding
    if (player.sliding && Math.abs(player.velocity.x) + Math.abs(player.velocity.z) < 1) {
      player.sliding = false;
    }
  } else {
    player.grounded = false;
    // Air resistance
    player.velocity.x *= FRICTION_AIR;
    player.velocity.z *= FRICTION_AIR;
  }

  // Map Boundaries
  player.position.x = Math.max(-WORLD_SIZE, Math.min(WORLD_SIZE, player.position.x));
  player.position.z = Math.max(-WORLD_SIZE, Math.min(WORLD_SIZE, player.position.z));
}

// --- GAME LOOP ---
setInterval(() => {
  const now = Date.now();
  
  // Update Players
  for (const id in players) {
    const p = players[id];
    updatePhysics(p, 1 / TICK_RATE);

    // Hardpoint Logic
    const dist = Math.hypot(p.position.x - hardpoint.x, p.position.z - hardpoint.z);
    if (dist < hardpoint.radius) {
      if (hardpoint.controllingTeam === null || hardpoint.controllingTeam === p.team) {
        hardpoint.controllingTeam = p.team;
        hardpoint.progress[p.team] = Math.min(100, hardpoint.progress[p.team] + 0.1);
      }
    }
  }

  // Broadcast World State (Delta compression simplified)
  io.emit('worldUpdate', {
    players: Object.values(players).map(p => ({
      id: p.id,
      x: p.position.x, y: p.position.y, z: p.position.z,
      qx: p.quaternion.x, qy: p.quaternion.y, qz: p.quaternion.z, qw: p.quaternion.w,
      team: p.team,
      classType: p.classType,
      sliding: p.sliding,
      hp: p.hp
    })),
    hardpoint: hardpoint,
    time: now
  });

}, 1000 / TICK_RATE);

// --- SOCKET HANDLING ---
io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  socket.on('joinGame', (data) => {
    const team = Math.random() > 0.5 ? 'red' : 'blue';
    const classConfig = CLASSES[data.classType || 'ASSAULT'];
    
    players[socket.id] = {
      id: socket.id,
      name: data.name || 'Soldier',
      team: team,
      classType: data.classType || 'ASSAULT',
      hp: classConfig.hp,
      maxHp: classConfig.hp,
      position: { x: (Math.random() - 0.5) * 50, y: 10, z: (Math.random() - 0.5) * 50 },
      velocity: { x: 0, y: 0, z: 0 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
      grounded: false,
      sliding: false,
      crouching: false,
      lastShot: 0,
      inputs: { w: false, a: false, s: false, d: false, space: false, crouch: false, mouseX: 0, mouseY: 0 }
    };
    
    socket.emit('init', { id: socket.id, team, hardpoint });
    io.emit('killFeed', { msg: `${players[socket.id].name} joined the ${team} team.` });
  });

  // Client Input Handling (Authoritative Movement)
  socket.on('input', (inputs) => {
    if (!players[socket.id]) return;
    const p = players[socket.id];
    const config = CLASSES[p.classType];

    // Rotation (Server stores it, but client is source of truth for aiming usually. 
    // For strict auth, we clamp look speed. Here we trust client for look, auth for move)
    p.quaternion = inputs.quaternion;

    // Movement Vector relative to look direction
    const speed = config.speed * PLAYER_SPEED * (p.sliding ? 1.5 : 1.0) * (p.crouching ? 0.6 : 1.0);
    
    // Calculate forward/right vectors based on Y-rotation
    // Simplified vector math for server
    const yaw = inputs.yaw; 
    const forwardX = Math.sin(yaw);
    const forwardZ = Math.cos(yaw);
    const rightX = Math.sin(yaw + Math.PI / 2);
    const rightZ = Math.cos(yaw + Math.PI / 2);

    let moveX = 0;
    let moveZ = 0;

    if (inputs.keys.w) { moveX += forwardX; moveZ += forwardZ; }
    if (inputs.keys.s) { moveX -= forwardX; moveZ -= forwardZ; }
    if (inputs.keys.a) { moveX -= rightX; moveZ -= rightZ; }
    if (inputs.keys.d) { moveX += rightX; moveZ += rightZ; }

    // Normalize
    const len = Math.hypot(moveX, moveZ);
    if (len > 0) {
      moveX /= len;
      moveZ /= len;
    }

    // Slide Hop Physics
    if (inputs.keys.crouch && !p.crouching && p.grounded && len > 0.1) {
      // Initiate Slide
      p.sliding = true;
      p.velocity.x += moveX * SLIDE_BOOST * 5;
      p.velocity.z += moveZ * SLIDE_BOOST * 5;
    }
    
    p.crouching = inputs.keys.crouch;

    if (p.grounded && !p.sliding) {
      p.velocity.x += moveX * speed * 0.2; // Acceleration
      p.velocity.z += moveZ * speed * 0.2;
    }

    // Jump / Slide Hop
    if (inputs.keys.space && p.grounded) {
      p.velocity.y = JUMP_FORCE;
      p.grounded = false;
      
      // Slide Hop Momentum Conservation
      if (p.sliding) {
        p.velocity.x *= 1.2;
        p.velocity.z *= 1.2;
        p.sliding = false; // Exit slide on jump
      }
    }
  });

  // Hitscan Shooting
  socket.on('shoot', (data) => {
    const p = players[socket.id];
    if (!p) return;
    const now = Date.now();
    const config = CLASSES[p.classType];

    if (now - p.lastShot < config.fireRate) return;
    p.lastShot = now;

    // Raycast Logic (Simplified)
    const origin = data.origin;
    const direction = data.direction;
    
    // Broadcast tracer for visual effect
    io.emit('tracer', { origin, direction, team: p.team });

    // Check hits against all other players
    for (const id in players) {
      if (id === socket.id) continue;
      const target = players[id];
      if (target.team === p.team) continue; // No friendly fire

      // Simple distance-to-line check for hit detection
      // In a real app, use a proper physics engine like Cannon.js on server
      const hit = checkHitscanCollision(origin, direction, target.position);
      
      if (hit) {
        let damage = config.damage;
        if (hit === 'head') damage *= 2.5;
        if (hit === 'limb') damage *= 0.7;

        target.hp -= damage;
        
        // Kill
        if (target.hp <= 0) {
          io.emit('killFeed', { msg: `${p.name} eliminated ${target.name}` });
          target.hp = target.maxHp;
          target.position = { x: (Math.random() - 0.5) * 50, y: 10, z: (Math.random() - 0.5) * 50 };
          target.velocity = { x: 0, y: 0, z: 0 };
        } else {
          socket.emit('hitMarker');
        }
      }
    }
  });

  socket.on('disconnect', () => {
    delete players[socket.id];
    io.emit('killFeed', { msg: `A player disconnected.` });
  });
});

// Simple Hitscan Math (Sphere vs Ray)
function checkHitscanCollision(origin, dir, targetPos) {
  // Player hitbox approx radius 1.5, height 4
  const dx = targetPos.x - origin.x;
  const dy = targetPos.y - origin.y;
  const dz = targetPos.z - origin.z;
  
  const dot = dx * dir.x + dy * dir.y + dz * dir.z;
  if (dot < 0) return false; // Behind shooter

  const closestX = origin.x + dir.x * dot;
  const closestY = origin.y + dir.y * dot;
  const closestZ = origin.z + dir.z * dot;

  const dist = Math.hypot(closestX - targetPos.x, closestY - targetPos.y, closestZ - targetPos.z);
  
  if (dist < 1.5) {
    if (closestY > targetPos.y + 1.5) return 'head';
    if (closestY < targetPos.y - 1.0) return 'limb';
    return 'body';
  }
  return false;
}

server.listen(3000, () => {
  console.log('Server listening on *:3000');
});
