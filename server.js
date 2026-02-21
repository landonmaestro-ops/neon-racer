const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();

// Create HTTP server first
const server = http.createServer(app);

// Get port from environment (Render sets this) or default to 3000
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0'; // Bind to all interfaces

// Attach Socket.IO to server BEFORE anything else
const io = new Server(server, {
  pingInterval: 1000,
  pingTimeout: 5000,
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: false
  },
  transports: ['websocket', 'polling']
});

// NOW serve static files (after Socket.IO is attached)
app.use(express.static(path.join(__dirname, 'public')));

// Health check endpoint for Render
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', players: Object.keys(players).length });
});

// --- GAME CONFIGURATION ---
const TICK_RATE = 60;
const WORLD_SIZE = 100;
const PLAYER_SPEED = 12;
const GRAVITY = 30;
const JUMP_FORCE = 10;
const SLIDE_BOOST = 1.5;
const FRICTION_GROUND = 0.85;
const FRICTION_AIR = 0.98;
const BOT_COUNT = 19;
const ROUND_DURATION = 120;
const LOBBY_DURATION = 60;

// Classes
const CLASSES = {
  ASSAULT: { hp: 100, speed: 1.0, fireRate: 150, damage: 25, recoil: 0.5, spread: 0.02, color: 0xff6600 },
  SNIPER: { hp: 80, speed: 0.85, fireRate: 1200, damage: 100, recoil: 2.0, spread: 0.0, color: 0x00ff00 },
  SMG: { hp: 90, speed: 1.1, fireRate: 80, damage: 15, recoil: 0.3, spread: 0.05, color: 0x00ffff },
  SHOTGUN: { hp: 110, speed: 0.95, fireRate: 800, damage: 15, recoil: 1.5, spread: 0.1, pellets: 8, color: 0xff00ff }
};

// Game State
let gameState = 'LOBBY';
let roundTime = LOBBY_DURATION;
let players = {};
let bots = {};
let killFeed = [];
let leaderboard = [];

// Bot names
const botNames = [
  'ShadowStriker', 'PhantomShot', 'CyberHunter', 'NeonKiller', 'VoidWalker',
  'SteelEagle', 'GhostRecon', 'BlazeRunner', 'NightHawk', 'IronFist',
  'ThunderBolt', 'SilentDeath', 'RapidFire', 'HeadHunter', 'SniperWolf',
  'ViperStrike', 'CobraKai', 'DragonSlayer', 'TitanFall', 'xX_DarkSlayer_Xx',
  'NoScope360', 'ProGamer2024', 'StealthNinja', 'MegaKill', 'UltraInstinct'
];

// --- BOT AI SYSTEM ---
class BotAI {
  constructor(id, name) {
    this.id = id;
    this.name = name;
    this.isBot = true;
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
    this.crouching = false;
    this.lastShot = 0;
    this.target = null;
    this.state = 'WANDER';
    this.wanderTarget = this.getRandomPoint();
    this.yaw = Math.random() * Math.PI * 2;
    this.pitch = 0;
    this.kills = 0;
    this.alive = true;
    this.respawnTimer = 0;
  }

  getRandomPoint() {
    return {
      x: (Math.random() - 0.5) * WORLD_SIZE * 0.8,
      z: (Math.random() - 0.5) * WORLD_SIZE * 0.8
    };
  }

  update(delta, allPlayers) {
    if (!this.alive) {
      this.respawnTimer -= delta;
      if (this.respawnTimer <= 0) {
        this.respawn();
      }
      return;
    }

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

    if (this.target && nearestDist < 40) {
      if (nearestDist < 20) {
        this.state = 'ATTACK';
      } else {
        this.state = 'CHASE';
      }
    } else {
      this.state = 'WANDER';
    }

    switch (this.state) {
      case 'WANDER':
        this.wander(delta);
        break;
      case 'CHASE':
        this.chase(delta);
        break;
      case 'ATTACK':
        this.attack(delta);
        break;
    }

    this.updatePhysics(delta);
  }

  respawn() {
    this.alive = true;
    this.hp = this.maxHp;
    this.position = {
      x: (Math.random() - 0.5) * WORLD_SIZE * 0.8,
      y: 10,
      z: (Math.random() - 0.5) * WORLD_SIZE * 0.8
    };
    this.velocity = { x: 0, y: 0, z: 0 };
  }

  wander(delta) {
    const dx = this.wanderTarget.x - this.position.x;
    const dz = this.wanderTarget.z - this.position.z;
    const dist = Math.hypot(dx, dz);

    if (dist < 5) {
      this.wanderTarget = this.getRandomPoint();
    }

    this.yaw = Math.atan2(dx, dz);
    this.moveForward(delta);
    
    if (Math.random() < 0.01 && this.grounded) {
      this.jump();
    }
  }

  chase(delta) {
    if (!this.target) return;
    const dx = this.target.position.x - this.position.x;
    const dz = this.target.position.z - this.position.z;
    this.yaw = Math.atan2(dx, dz);
    this.moveForward(delta);
    
    if (Math.random() < 0.03 && this.grounded) {
      this.sliding = true;
      this.jump();
    }
  }

  attack(delta) {
    if (!this.target) return;
    const dx = this.target.position.x - this.position.x;
    const dy = this.target.position.y - this.position.y;
    const dz = this.target.position.z - this.position.z;
    const dist = Math.hypot(dx, dz);
    
    this.yaw = Math.atan2(dx, dz);
    this.pitch = -Math.atan2(dy - 1.5, dist);

    const strafeDir = Math.sin(Date.now() * 0.002) > 0 ? 1 : -1;
    this.velocity.x += Math.cos(this.yaw + Math.PI/2) * strafeDir * 3 * delta;
    this.velocity.z += Math.sin(this.yaw + Math.PI/2) * strafeDir * 3 * delta;

    const now = Date.now();
    const config = CLASSES[this.classType];
    if (now - this.lastShot > config.fireRate) {
      this.lastShot = now;
      this.shoot();
    }
  }

  moveForward(delta) {
    const config = CLASSES[this.classType];
    const speed = config.speed * PLAYER_SPEED * 0.6;
    this.velocity.x += Math.sin(this.yaw) * speed * delta;
    this.velocity.z += Math.cos(this.yaw) * speed * delta;
  }

  jump() {
    if (this.grounded) {
      this.velocity.y = JUMP_FORCE;
      this.grounded = false;
    }
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

    this.checkHitscan(origin, dir);
    
    io.emit('tracer', { 
      origin, 
      direction: dir, 
      id: this.id,
      isBot: true
    });
  }

  checkHitscan(origin, dir) {
    const config = CLASSES[this.classType];
    
    for (const id in players) {
      const p = players[id];
      if (p.id === this.id || !p.alive) continue;
      
      const hit = this.raycastHit(origin, dir, p.position);
      if (hit) {
        let damage = config.damage;
        if (hit === 'head') damage *= 2.5;
        if (hit === 'limb') damage *= 0.7;
        
        p.hp -= damage;
        if (p.hp <= 0) {
          this.kills++;
          p.alive = false;
          p.deathTime = Date.now();
          addKillFeed(`${this.name} eliminated ${p.name}`);
        }
      }
    }

    for (const id in bots) {
      const b = bots[id];
      if (b.id === this.id || !b.alive) continue;
      
      const hit = this.raycastHit(origin, dir, b.position);
      if (hit) {
        let damage = config.damage;
        if (hit === 'head') damage *= 2.5;
        if (hit === 'limb') damage *= 0.7;
        
        b.hp -= damage;
        if (b.hp <= 0) {
          this.kills++;
          b.alive = false;
          b.respawnTimer = 3;
          addKillFeed(`${this.name} eliminated ${b.name}`);
        }
      }
    }
  }

  raycastHit(origin, dir, targetPos) {
    const dx = targetPos.x - origin.x;
    const dy = targetPos.y - origin.y;
    const dz = targetPos.z - origin.z;
    
    const dot = dx * dir.x + dy * dir.y + dz * dir.z;
    if (dot < 0) return false;

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

  updatePhysics(delta) {
    if (!this.grounded) {
      this.velocity.y -= GRAVITY * delta;
    }

    this.position.x += this.velocity.x * delta;
    this.position.y += this.velocity.y * delta;
    this.position.z += this.velocity.z * delta;

    if (this.position.y <= 2) {
      this.position.y = 2;
      this.velocity.y = 0;
      this.grounded = true;
      this.velocity.x *= FRICTION_GROUND;
      this.velocity.z *= FRICTION_GROUND;
      this.sliding = false;
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
    const id = `p_${Math.random().toString(36).substr(2, 9)}`;
    bots[id] = new BotAI(id, botNames[i % botNames.length]);
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
    p.alive = true;
    p.kills = 0;
    p.position = {
      x: (Math.random() - 0.5) * WORLD_SIZE * 0.8,
      y: 10,
      z: (Math.random() - 0.5) * WORLD_SIZE * 0.8
    };
    p.velocity = { x: 0, y: 0, z: 0 };
  }

  initBots();
  
  killFeed = [];
  io.emit('roundStart', { duration: ROUND_DURATION });
  addKillFeed('ROUND STARTED - FIGHT!');
}

function endRound() {
  gameState = 'ENDED';
  roundTime = LOBBY_DURATION;
  
  const allCombatants = [
    ...Object.values(players).map(p => ({ 
      id: p.id,
      name: p.name, 
      kills: p.kills, 
      alive: p.alive, 
      isBot: false 
    })),
    ...Object.values(bots).map(b => ({ 
      id: b.id,
      name: b.name, 
      kills: b.kills, 
      alive: b.alive, 
      isBot: true 
    }))
  ];
  
  allCombatants.sort((a, b) => {
    if (a.alive && !b.alive) return -1;
    if (!a.alive && b.alive) return 1;
    return b.kills - a.kills;
  });
  
  leaderboard = allCombatants;
  io.emit('roundEnd', { leaderboard, winner: allCombatants[0] });
  addKillFeed(`ROUND ENDED - Winner: ${allCombatants[0].name}`);
}

function addKillFeed(msg) {
  killFeed.unshift({ msg, time: Date.now() });
  if (killFeed.length > 8) killFeed.pop();
  io.emit('killFeed', { msg });
}

function updatePlayerPhysics(player, delta) {
  if (!player.alive) return;
  
  if (!player.grounded) {
    player.velocity.y -= GRAVITY * delta;
  }

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

    if (player.sliding && Math.abs(player.velocity.x) + Math.abs(player.velocity.z) < 1) {
      player.sliding = false;
    }
  } else {
    player.grounded = false;
    player.velocity.x *= FRICTION_AIR;
    player.velocity.z *= FRICTION_AIR;
  }

  player.position.x = Math.max(-WORLD_SIZE, Math.min(WORLD_SIZE, player.position.x));
  player.position.z = Math.max(-WORLD_SIZE, Math.min(WORLD_SIZE, player.position.z));
}

setInterval(() => {
  const delta = 1 / TICK_RATE;
  
  if (gameState === 'LOBBY' || gameState === 'ENDED') {
    roundTime -= delta;
    if (roundTime <= 0) {
      startRound();
    }
  } else if (gameState === 'PLAYING') {
    roundTime -= delta;
    if (roundTime <= 0) {
      endRound();
    }
  }

  for (const id in bots) {
    bots[id].update(delta, players);
  }

  for (const id in players) {
    updatePlayerPhysics(players[id], delta);
  }

  const allEntities = [];
  
  for (const id in players) {
    const p = players[id];
    allEntities.push({
      id: p.id,
      x: p.position.x, y: p.position.y, z: p.position.z,
      qx: p.quaternion.x, qy: p.quaternion.y, qz: p.quaternion.z, qw: p.quaternion.w,
      classType: p.classType,
      sliding: p.sliding,
      hp: p.hp,
      maxHp: p.maxHp,
      alive: p.alive,
      kills: p.kills,
      name: p.name
    });
  }
  
  for (const id in bots) {
    const b = bots[id];
    allEntities.push({
      id: b.id,
      x: b.position.x, y: b.position.y, z: b.position.z,
      qx: b.quaternion.x, qy: b.quaternion.y, qz: b.quaternion.z, qw: b.quaternion.w,
      classType: b.classType,
      sliding: b.sliding,
      hp: b.hp,
      maxHp: b.maxHp,
      alive: b.alive,
      kills: b.kills,
      name: b.name
    });
  }

  io.emit('worldUpdate', {
    state: gameState,
    time: Math.ceil(roundTime),
    entities: allEntities,
    killFeed: killFeed.slice(0, 5)
  });

}, 1000 / TICK_RATE);

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  if (gameState === 'PLAYING') {
    socket.emit('spectatorMode', { 
      message: 'Game in progress. You are spectating.',
      timeRemaining: roundTime
    });
  } else {
    socket.emit('lobbyMode', { timeUntilStart: roundTime });
  }

  socket.on('joinGame', (data) => {
    console.log('Join game requested by:', socket.id, 'Data:', data);
    
    if (gameState === 'PLAYING') {
      socket.emit('error', { msg: 'Game in progress. Spectate until next round.' });
      return;
    }

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
      alive: false,
      kills: 0
    };
    
    socket.emit('joined', { id: socket.id, name: players[socket.id].name });
    addKillFeed(`${players[socket.id].name} joined the lobby`);
  });

  socket.on('input', (inputs) => {
    if (!players[socket.id] || !players[socket.id].alive || gameState !== 'PLAYING') return;
    
    const p = players[socket.id];
    const config = CLASSES[p.classType];
    
    p.quaternion = inputs.quaternion;
    
    const speed = config.speed * PLAYER_SPEED * (p.sliding ? 1.5 : 1.0) * (inputs.keys.crouch ? 0.6 : 1.0);
    
    const forwardX = Math.sin(inputs.yaw);
    const forwardZ = Math.cos(inputs.yaw);
    const rightX = Math.sin(inputs.yaw + Math.PI / 2);
    const rightZ = Math.cos(inputs.yaw + Math.PI / 2);

    let moveX = 0;
    let moveZ = 0;

    if (inputs.keys.w) { moveX += forwardX; moveZ += forwardZ; }
    if (inputs.keys.s) { moveX -= forwardX; moveZ -= forwardZ; }
    if (inputs.keys.a) { moveX -= rightX; moveZ -= rightZ; }
    if (inputs.keys.d) { moveX += rightX; moveZ += rightZ; }

    const len = Math.hypot(moveX, moveZ);
    if (len > 0) {
      moveX /= len;
      moveZ /= len;
    }

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
    const direction = data.direction;
    
    io.emit('tracer', { origin, direction, id: p.id });

    for (const id in players) {
      if (id === socket.id) continue;
      const target = players[id];
      if (!target.alive) continue;

      const hit = checkHitscanCollision(origin, direction, target.position);
      if (hit) {
        let damage = config.damage;
        if (hit === 'head') damage *= 2.5;
        if (hit === 'limb') damage *= 0.7;

        target.hp -= damage;
        
        if (target.hp <= 0) {
          target.alive = false;
          target.deathTime = Date.now();
          p.kills++;
          addKillFeed(`${p.name} eliminated ${target.name}`);
          socket.emit('hitMarker', { kill: true });
        } else {
          socket.emit('hitMarker', { kill: false });
        }
      }
    }

    for (const id in bots) {
      const target = bots[id];
      if (!target.alive) continue;

      const hit = checkHitscanCollision(origin, direction, target.position);
      if (hit) {
        let damage = config.damage;
        if (hit === 'head') damage *= 2.5;
        if (hit === 'limb') damage *= 0.7;

        target.hp -= damage;
        
        if (target.hp <= 0) {
          target.alive = false;
          target.respawnTimer = 3;
          p.kills++;
          addKillFeed(`${p.name} eliminated ${target.name}`);
          socket.emit('hitMarker', { kill: true });
        } else {
          socket.emit('hitMarker', { kill: false });
        }
      }
    }
  });

  socket.on('disconnect', () => {
    if (players[socket.id]) {
      addKillFeed(`${players[socket.id].name} disconnected`);
      delete players[socket.id];
    }
  });
});

function checkHitscanCollision(origin, dir, targetPos) {
  const dx = targetPos.x - origin.x;
  const dy = targetPos.y - origin.y;
  const dz = targetPos.z - origin.z;
  
  const dot = dx * dir.x + dy * dir.y + dz * dir.z;
  if (dot < 0) return false;

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

initBots();

// START SERVER - Use HOST and PORT for Render compatibility
server.listen(PORT, HOST, () => {
  console.log(`Server listening on http://${HOST}:${PORT}`);
  console.log(`Socket.IO client available at: /socket.io/socket.io.js`);
});
