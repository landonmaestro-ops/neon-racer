const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingInterval: 1000,
  pingTimeout: 5000
});

app.use(express.static(path.join(__dirname, 'public')));

// --- GAME CONFIGURATION ---
const TICK_RATE = 60;
const WORLD_SIZE = 100;
const PLAYER_SPEED = 12;
const GRAVITY = 30;
const JUMP_FORCE = 10;
const SLIDE_BOOST = 1.5;
const FRICTION_GROUND = 0.85;
const FRICTION_AIR = 0.98;
const BOT_COUNT = 8; // Reduced for performance
const ROUND_DURATION = 90;
const LOBBY_DURATION = 5; // VERY SHORT for testing

const CLASSES = {
  ASSAULT: { hp: 100, speed: 1.0, fireRate: 150, damage: 25, spread: 0.02, color: 0xff6600, projectileSpeed: 150 },
  SNIPER: { hp: 80, speed: 0.85, fireRate: 1200, damage: 100, spread: 0.0, color: 0x00ff00, projectileSpeed: 200 },
  SMG: { hp: 90, speed: 1.1, fireRate: 80, damage: 15, spread: 0.05, color: 0x00ffff, projectileSpeed: 140 },
  SHOTGUN: { hp: 110, speed: 0.95, fireRate: 800, damage: 15, spread: 0.1, color: 0xff00ff, projectileSpeed: 120 }
};

let gameState = 'LOBBY';
let roundTime = LOBBY_DURATION;
let players = {};
let bots = {};
let projectiles = [];
let killFeed = [];

const botNames = [
  'ShadowSlayer', 'FrostByte', 'VenomWolf', 'Phantom', 'NeonReaper',
  'CyberPulse', 'BlazeKnight', 'ThunderFury', 'NovaRanger', 'IronWraith',
  'ShadowByte', 'CrimsonFate', 'QuantumNinja', 'Vortex', 'StealthHawk',
  'EchoRogue', 'DarkNemesis', 'TitanSlayer', 'GhostRider', 'MysticSpecter'
];

// --- PROJECTILE SYSTEM ---
class Projectile {
  constructor(id, origin, direction, speed, damage, ownerId, ownerName) {
    this.id = id;
    this.position = { ...origin };
    this.velocity = {
      x: direction.x * speed,
      y: direction.y * speed,
      z: direction.z * speed
    };
    this.damage = damage;
    this.ownerId = ownerId;
    this.ownerName = ownerName;
    this.active = true;
    this.life = 3.0;
  }

  update(delta) {
    this.life -= delta;
    if (this.life <= 0) {
      this.active = false;
      return;
    }

    this.position.x += this.velocity.x * delta;
    this.position.y += this.velocity.y * delta;
    this.position.z += this.velocity.z * delta;

    if (Math.abs(this.position.x) > WORLD_SIZE || 
        Math.abs(this.position.z) > WORLD_SIZE ||
        this.position.y < 0) {
      this.active = false;
    }
  }

  checkHit(targetPos) {
    const dx = this.position.x - targetPos.x;
    const dy = this.position.y - (targetPos.y + 0.9);
    const dz = this.position.z - targetPos.z;
    const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
    
    if (dist < 0.8) {
      if (dy > 0.4) return 'head';
      if (dy < -0.2) return 'limb';
      return 'body';
    }
    return null;
  }
}

// --- BOT AI ---
class BotAI {
  constructor(id, name) {
    this.id = id;
    this.name = name;
    this.classType = Object.keys(CLASSES)[Math.floor(Math.random() * 4)];
    const config = CLASSES[this.classType];
    this.hp = config.hp;
    this.maxHp = config.hp;
    this.position = {
      x: (Math.random() - 0.5) * WORLD_SIZE * 0.8,
      y: 2,
      z: (Math.random() - 0.5) * WORLD_SIZE * 0.8
    };
    this.velocity = { x: 0, y: 0, z: 0 };
    this.quaternion = { x: 0, y: 0, z: 0, w: 1 };
    this.grounded = true;
    this.sliding = false;
    this.lastShot = 0;
    this.target = null;
    this.yaw = Math.random() * Math.PI * 2;
    this.pitch = 0;
    this.kills = 0;
    this.alive = true;
    this.walkCycle = 0;
  }

  update(delta, allPlayers) {
    if (!this.alive) return;

    // Find nearest target
    let nearest = null;
    let nearestDist = Infinity;
    
    for (const id in allPlayers) {
      const p = allPlayers[id];
      if (p.id !== this.id && p.alive) {
        const dist = Math.hypot(p.position.x - this.position.x, p.position.z - this.position.z);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearest = p;
        }
      }
    }

    for (const id in bots) {
      const b = bots[id];
      if (b.id !== this.id && b.alive) {
        const dist = Math.hypot(b.position.x - this.position.x, b.position.z - this.position.z);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearest = b;
        }
      }
    }

    this.target = nearest;

    if (this.target && nearestDist < 30) {
      const dx = this.target.position.x - this.position.x;
      const dz = this.target.position.z - this.position.z;
      this.yaw = Math.atan2(dx, dz);
      
      if (nearestDist > 10) {
        // Chase
        const speed = CLASSES[this.classType].speed * PLAYER_SPEED * 0.5;
        this.velocity.x += Math.sin(this.yaw) * speed * delta;
        this.velocity.z += Math.cos(this.yaw) * speed * delta;
        this.walkCycle += delta * 6;
      }
      
      // Shoot
      const now = Date.now();
      const config = CLASSES[this.classType];
      if (now - this.lastShot > config.fireRate) {
        this.lastShot = now;
        this.shoot();
      }
    } else {
      // Wander
      this.walkCycle += delta * 2;
    }

    this.updatePhysics(delta);
  }

  shoot() {
    const config = CLASSES[this.classType];
    const origin = {
      x: this.position.x,
      y: this.position.y + 1.5,
      z: this.position.z
    };
    
    const dir = {
      x: Math.sin(this.yaw) * Math.cos(this.pitch),
      y: Math.sin(this.pitch),
      z: Math.cos(this.yaw) * Math.cos(this.pitch)
    };

    dir.x += (Math.random() - 0.5) * config.spread;
    dir.y += (Math.random() - 0.5) * config.spread;
    dir.z += (Math.random() - 0.5) * config.spread;

    const len = Math.sqrt(dir.x*dir.x + dir.y*dir.y + dir.z*dir.z);
    dir.x /= len; dir.y /= len; dir.z /= len;

    const projId = `proj_bot_${this.id}_${Date.now()}`;
    projectiles.push(new Projectile(projId, origin, dir, config.projectileSpeed, config.damage, this.id, this.name));
    
    io.emit('botFire', { origin, direction: dir });
  }

  updatePhysics(delta) {
    if (!this.grounded) this.velocity.y -= GRAVITY * delta;

    this.position.x += this.velocity.x * delta;
    this.position.y += this.velocity.y * delta;
    this.position.z += this.velocity.z * delta;

    if (this.position.y <= 2) {
      this.position.y = 2;
      this.velocity.y = 0;
      this.grounded = true;
      this.velocity.x *= FRICTION_GROUND;
      this.velocity.z *= FRICTION_GROUND;
    } else {
      this.grounded = false;
      this.velocity.x *= FRICTION_AIR;
      this.velocity.z *= FRICTION_AIR;
    }

    this.position.x = Math.max(-WORLD_SIZE, Math.min(WORLD_SIZE, this.position.x));
    this.position.z = Math.max(-WORLD_SIZE, Math.min(WORLD_SIZE, this.position.z));

    const cy = Math.cos(this.yaw * 0.5);
    const sy = Math.sin(this.yaw * 0.5);
    const cp = Math.cos(this.pitch * 0.5);
    const sp = Math.sin(this.pitch * 0.5);
    
    this.quaternion.w = cy * cp;
    this.quaternion.x = sy * sp;
    this.quaternion.y = sy * cp;
    this.quaternion.z = cy * sp;
  }
}

function initBots() {
  bots = {};
  for (let i = 0; i < BOT_COUNT; i++) {
    bots[`bot_${i}`] = new BotAI(`bot_${i}`, botNames[i % botNames.length]);
  }
}

function startRound() {
  gameState = 'PLAYING';
  roundTime = ROUND_DURATION;
  
  for (const id in players) {
    const p = players[id];
    const config = CLASSES[p.classType];
    p.hp = config.hp;
    p.maxHp = config.hp;
    p.alive = true; // CRITICAL: Set to TRUE
    p.kills = 0;
    p.position = {
      x: (Math.random() - 0.5) * WORLD_SIZE * 0.8,
      y: 10,
      z: (Math.random() - 0.5) * WORLD_SIZE * 0.8
    };
    p.velocity = { x: 0, y: 0, z: 0 };
  }

  initBots();
  projectiles = [];
  killFeed = [];
  
  io.emit('roundStart', { duration: ROUND_DURATION });
  addKillFeed('ROUND STARTED - FIGHT!');
}

function endRound() {
  gameState = 'ENDED';
  roundTime = LOBBY_DURATION;
  
  const allCombatants = [
    ...Object.values(players).map(p => ({ name: p.name, kills: p.kills, alive: p.alive })),
    ...Object.values(bots).map(b => ({ name: b.name, kills: b.kills, alive: b.alive }))
  ].sort((a, b) => b.kills - a.kills);
  
  io.emit('roundEnd', { leaderboard: allCombatants, winner: allCombatants[0] });
  
  for (const id in players) {
    players[id].alive = false;
  }
}

function addKillFeed(msg) {
  killFeed.unshift({ msg, time: Date.now() });
  if (killFeed.length > 5) killFeed.pop();
  io.emit('killFeed', { msg });
}

function updatePlayerPhysics(player, delta) {
  if (!player.alive) return;
  
  if (!player.grounded) player.velocity.y -= GRAVITY * delta;

  player.position.x += player.velocity.x * delta;
  player.position.y += player.velocity.y * delta;
  player.position.z += player.velocity.z * delta;

  if (player.position.y <= 2) {
    player.position.y = 2;
    player.velocity.y = 0;
    player.grounded = true;
    const friction = player.sliding ? 0.95 : FRICTION_GROUND;
    player.velocity.x *= friction;
    player.velocity.z *= friction;
    if (player.sliding && Math.abs(player.velocity.x) + Math.abs(player.velocity.z) < 1) player.sliding = false;
  } else {
    player.grounded = false;
    player.velocity.x *= FRICTION_AIR;
    player.velocity.z *= FRICTION_AIR;
  }

  player.position.x = Math.max(-WORLD_SIZE, Math.min(WORLD_SIZE, player.position.x));
  player.position.z = Math.max(-WORLD_SIZE, Math.min(WORLD_SIZE, player.position.z));
}

// --- GAME LOOP ---
setInterval(() => {
  const delta = 1 / TICK_RATE;
  
  if (gameState === 'LOBBY' || gameState === 'ENDED') {
    roundTime -= delta;
    if (roundTime <= 0) startRound();
  } else if (gameState === 'PLAYING') {
    roundTime -= delta;
    
    const alivePlayers = Object.values(players).filter(p => p.alive).length;
    const aliveBots = Object.values(bots).filter(b => b.alive).length;
    
    if (roundTime <= 0 || (alivePlayers + aliveBots <= 1 && alivePlayers > 0)) {
      endRound();
    }
  }

  for (const id in bots) bots[id].update(delta, players);
  for (const id in players) updatePlayerPhysics(players[id], delta);

  // Update projectiles
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const proj = projectiles[i];
    proj.update(delta);
    
    if (!proj.active) {
      projectiles.splice(i, 1);
      continue;
    }
    
    // Check hits on players
    for (const id in players) {
      const p = players[id];
      if (p.id === proj.ownerId || !p.alive) continue;
      
      const hit = proj.checkHit(p.position);
      if (hit) {
        let damage = proj.damage;
        if (hit === 'head') damage *= 2.5;
        if (hit === 'limb') damage *= 0.7;
        
        p.hp -= damage;
        proj.active = false;
        
        if (players[proj.ownerId]) {
          io.to(proj.ownerId).emit('hitMarker', { kill: p.hp <= 0 });
        }
        
        if (p.hp <= 0) {
          p.alive = false;
          const shooter = players[proj.ownerId] || bots[proj.ownerId];
          if (shooter) shooter.kills++;
          addKillFeed(`${proj.ownerName} eliminated ${p.name}`);
        }
        break;
      }
    }
    
    if (!proj.active) {
      projectiles.splice(i, 1);
      continue;
    }
    
    // Check hits on bots
    for (const id in bots) {
      const b = bots[id];
      if (b.id === proj.ownerId || !b.alive) continue;
      
      const hit = proj.checkHit(b.position);
      if (hit) {
        let damage = proj.damage;
        if (hit === 'head') damage *= 2.5;
        if (hit === 'limb') damage *= 0.7;
        
        b.hp -= damage;
        proj.active = false;
        
        if (b.hp <= 0) {
          b.alive = false;
          const shooter = players[proj.ownerId] || bots[proj.ownerId];
          if (shooter) shooter.kills++;
          addKillFeed(`${proj.ownerName} eliminated ${b.name}`);
        }
        break;
      }
    }
    
    if (!proj.active) projectiles.splice(i, 1);
  }

  io.emit('worldUpdate', {
    state: gameState,
    time: Math.ceil(roundTime),
    players: Object.values(players).map(p => ({
      id: p.id, x: p.position.x, y: p.position.y, z: p.position.z,
      qx: p.quaternion.x, qy: p.quaternion.y, qz: p.quaternion.z, qw: p.quaternion.w,
      classType: p.classType, sliding: p.sliding, hp: p.hp, maxHp: p.maxHp,
      alive: p.alive, kills: p.kills, name: p.name
    })),
    bots: Object.values(bots).map(b => ({
      id: b.id, x: b.position.x, y: b.position.y, z: b.position.z,
      qx: b.quaternion.x, qy: b.quaternion.y, qz: b.quaternion.z, qw: b.quaternion.w,
      classType: b.classType, sliding: b.sliding, hp: b.hp, alive: b.alive,
      kills: b.kills, name: b.name, walkCycle: b.walkCycle
    })),
    projectiles: projectiles.map(p => ({ id: p.id, x: p.position.x, y: p.position.y, z: p.position.z })),
    killFeed: killFeed.slice(0, 5)
  });

}, 1000 / TICK_RATE);

// --- SOCKET HANDLING ---
io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);
  socket.emit('lobbyMode', { timeUntilStart: roundTime, gameState });

  socket.on('joinGame', (data) => {
    const classConfig = CLASSES[data.classType || 'ASSAULT'];
    
    players[socket.id] = {
      id: socket.id,
      name: data.name || `Player_${socket.id.substr(0, 4)}`,
      classType: data.classType || 'ASSAULT',
      hp: classConfig.hp,
      maxHp: classConfig.hp,
      position: { 
        x: (Math.random() - 0.5) * WORLD_SIZE * 0.8, 
        y: 10, 
        z: (Math.random() - 0.5) * WORLD_SIZE * 0.8 
      },
      velocity: { x: 0, y: 0, z: 0 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
      grounded: false,
      sliding: false,
      crouching: false,
      lastShot: 0,
      alive: false, // Start as not alive until round starts
      kills: 0,
      inputs: {}
    };
    
    socket.emit('joined', { id: socket.id });
    addKillFeed(`${players[socket.id].name} joined`);
  });

  socket.on('input', (inputs) => {
    if (!players[socket.id] || !players[socket.id].alive || gameState !== 'PLAYING') return;
    
    const p = players[socket.id];
    const config = CLASSES[p.classType];
    
    p.quaternion = inputs.quaternion;
    
    const speed = config.speed * PLAYER_SPEED * (p.sliding ? 1.5 : 1.0) * (p.crouching ? 0.6 : 1.0);
    
    const yaw = inputs.yaw;
    const forwardX = Math.sin(yaw);
    const forwardZ = Math.cos(yaw);
    const rightX = Math.sin(yaw + Math.PI / 2);
    const rightZ = Math.cos(yaw + Math.PI / 2);

    let moveX = 0, moveZ = 0;
    if (inputs.keys.w) { moveX += forwardX; moveZ += forwardZ; }
    if (inputs.keys.s) { moveX -= forwardX; moveZ -= forwardZ; }
    if (inputs.keys.a) { moveX -= rightX; moveZ -= rightZ; }
    if (inputs.keys.d) { moveX += rightX; moveZ += rightZ; }

    const len = Math.hypot(moveX, moveZ);
    if (len > 0) { moveX /= len; moveZ /= len; }

    if (inputs.keys.crouch && !p.crouching && p.grounded && len > 0.1) {
      p.sliding = true;
      p.velocity.x += moveX * SLIDE_BOOST * 8;
      p.velocity.z += moveZ * SLIDE_BOOST * 8;
    }
    
    p.crouching = inputs.keys.crouch;

    if (p.grounded && !p.sliding) {
      p.velocity.x += moveX * speed * 0.3;
      p.velocity.z += moveZ * speed * 0.3;
    }

    if (inputs.keys.space && p.grounded) {
      p.velocity.y = JUMP_FORCE;
      p.grounded = false;
      if (p.sliding) {
        p.velocity.x *= 1.3;
        p.velocity.z *= 1.3;
        p.sliding = false;
      }
    }
  });

  socket.on('shoot', (data) => {
    if (!players[socket.id] || !players[socket.id].alive || gameState !== 'PLAYING') return;
    
    const p = players[socket.id];
    const now = Date.now();
    const config = CLASSES[p.classType];

    if (now - p.lastShot < config.fireRate) return;
    p.lastShot = now;

    const origin = data.origin;
    const dir = data.direction;
    
    const dirLen = Math.sqrt(dir.x*dir.x + dir.y*dir.y + dir.z*dir.z);
    const normalizedDir = {
      x: dir.x / dirLen,
      y: dir.y / dirLen,
      z: dir.z / dirLen
    };
    
    const projId = `proj_${socket.id}_${now}`;
    projectiles.push(new Projectile(projId, origin, normalizedDir, config.projectileSpeed, config.damage, socket.id, p.name));
    
    io.emit('playerFire', { playerId: socket.id, origin, direction: normalizedDir });
  });

  socket.on('disconnect', () => {
    if (players[socket.id]) {
      addKillFeed(`${players[socket.id].name} left`);
      delete players[socket.id];
    }
  });
});

initBots();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on *:${PORT}`);
});
