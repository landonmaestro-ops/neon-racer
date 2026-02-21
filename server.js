const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
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
const MAX_PLAYERS = 20;
const BOT_COUNT = 15;
const ROUND_DURATION = 120; // seconds
const LOBBY_DURATION = 10; // seconds - SHORTENED for quick start

// Classes
const CLASSES = {
  ASSAULT: { hp: 100, speed: 1.0, fireRate: 150, damage: 25, recoil: 0.5, spread: 0.02, color: 0xff6600, projectileSpeed: 150 },
  SNIPER: { hp: 80, speed: 0.85, fireRate: 1200, damage: 100, recoil: 2.0, spread: 0.0, color: 0x00ff00, projectileSpeed: 200 },
  SMG: { hp: 90, speed: 1.1, fireRate: 80, damage: 15, recoil: 0.3, spread: 0.05, color: 0x00ffff, projectileSpeed: 140 },
  SHOTGUN: { hp: 110, speed: 0.95, fireRate: 800, damage: 15, recoil: 1.5, spread: 0.1, pellets: 8, color: 0xff00ff, projectileSpeed: 120 }
};

// Game State
let gameState = 'LOBBY'; // LOBBY, PLAYING, ENDED
let roundTime = LOBBY_DURATION;
let players = {};
let bots = {};
let projectiles = [];
let killFeed = [];
let leaderboard = [];

// Creative realistic gaming names (no "Bot" in them)
const botNames = [
  'xXShadowSlayerXx', 'FrostByte', 'VenomWolf', 'PhantomStriker', 'NeonReaper',
  'CyberPulse', 'BlazeKnight', 'ThunderFury', 'NovaRanger', 'IronWraith',
  'ShadowByte', 'CrimsonFate', 'QuantumNinja', 'VortexRider', 'StealthHawk',
  'EchoRogue', 'DarkNemesis', 'Frostbite', 'TitanSlayer', 'GhostRider',
  'MysticSpecter', 'SolarSentinel', 'ApexHunter', 'VoidWalker', 'Zenith',
  'EmberStorm', 'Chrono', 'NebulaKnight', 'ZeroCrypt', 'AstralDrift',
  'ChaosVector', 'PhantomCore', 'ViperZen', 'Blitz', 'WarpRider',
  'AlphaBane', 'VoltageX', 'CrimsonReaper', 'SpectralHunter', 'NeonViper',
  'DarkNova', 'ThunderBolt', 'Eclipse', 'OrionFalcon', 'Avalanche',
  'QuantumQuake', 'EmberEnigma', 'VoidVanguard', 'LunarLegend', 'Inferno',
  'xXSniperWolfXx', 'PixelPhantom', 'CodeBlazer', 'NeoVortex', 'PlasmaWolf',
  'CyberDagger', 'TitanSpecter', 'InfernoZero', 'EchoRogue', 'StormAegis',
  'FrostKnight', 'QuantumEdge', 'VenomStrike', 'AeroHunter', 'BladeChronos',
  'LunarSniper', 'StealthFury', 'IronPulse', 'ZeroCrypt', 'AstralDrift',
  'ChaosVector', 'BlitzOverdrive', 'PhantomCore', 'ViperZen', 'ShadowPyre',
  'NebulaAssassin', 'LunarRogue', 'FrostTitan', 'EmberWarden', 'CyberAssault',
  'NeonFury', 'ShadowCrusader', 'IronRider', 'FireGuardian', 'StormPhoenix',
  'FrostWarden', 'VoidBlade', 'CrystalFury', 'FlamePaladin', 'TitanSorcerer',
  'StarMage', 'EmberDragon', 'SteelWarden', 'SavageAssault', 'ThunderCrusader',
  'IronSaber', 'StormWarden', 'PhoenixWraith', 'ShadowFury', 'TitanKnight'
];

// --- PROJECTILE SYSTEM ---
class Projectile {
  constructor(id, origin, direction, speed, damage, ownerId, ownerName, isBot = false) {
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
    this.isBot = isBot;
    this.active = true;
    this.life = 5.0; // 5 seconds max life
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

    // Check bounds
    if (Math.abs(this.position.x) > WORLD_SIZE || 
        Math.abs(this.position.z) > WORLD_SIZE ||
        this.position.y < 0 || this.position.y > 100) {
      this.active = false;
    }
  }

  checkHit(targetPos, targetHeight = 1.8) {
    // Simple sphere collision for body
    const dx = this.position.x - targetPos.x;
    const dy = this.position.y - (targetPos.y + targetHeight / 2);
    const dz = this.position.z - targetPos.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    
    if (dist < 0.8) {
      // Determine hit location
      if (dy > 0.5) return 'head';
      if (dy < -0.3) return 'limb';
      return 'body';
    }
    return null;
  }
}

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
    this.state = 'WANDER'; // WANDER, CHASE, ATTACK, FLEE
    this.wanderTarget = this.getRandomPoint();
    this.yaw = Math.random() * Math.PI * 2;
    this.pitch = 0;
    this.kills = 0;
    this.alive = true;
    
    // Animation state for humanoid movement
    this.animTime = 0;
    this.walkCycle = 0;
  }

  getRandomPoint() {
    return {
      x: (Math.random() - 0.5) * WORLD_SIZE * 0.8,
      z: (Math.random() - 0.5) * WORLD_SIZE * 0.8
    };
  }

  update(delta, allPlayers) {
    if (!this.alive) return;

    this.animTime += delta;
    
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

    // Also check other bots
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

    // AI State Machine
    if (this.target && nearestDist < 40) {
      if (nearestDist < 20) {
        this.state = 'ATTACK';
      } else {
        this.state = 'CHASE';
      }
    } else {
      this.state = 'WANDER';
    }

    // Execute behavior
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

    // Physics
    this.updatePhysics(delta);
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
    this.walkCycle += delta * 5;
  }

  chase(delta) {
    if (!this.target) return;
    const dx = this.target.position.x - this.position.x;
    const dz = this.target.position.z - this.position.z;
    this.yaw = Math.atan2(dx, dz);
    this.moveForward(delta);
    this.walkCycle += delta * 8;
    
    // Slide hop occasionally
    if (Math.random() < 0.02 && this.grounded) {
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
    this.pitch = -Math.atan2(dy, dist);

    // Strafe around target
    const strafeDir = Math.sin(Date.now() * 0.003) > 0 ? 1 : -1;
    this.velocity.x += Math.cos(this.yaw + Math.PI/2) * strafeDir * 2 * delta;
    this.velocity.z += Math.sin(this.yaw + Math.PI/2) * strafeDir * 2 * delta;
    this.walkCycle += delta * 6;

    // Shoot
    const now = Date.now();
    const config = CLASSES[this.classType];
    if (now - this.lastShot > config.fireRate) {
      this.lastShot = now;
      this.shoot();
    }
  }

  moveForward(delta) {
    const config = CLASSES[this.classType];
    const speed = config.speed * PLAYER_SPEED * 0.5;
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

    // Add spread
    dir.x += (Math.random() - 0.5) * config.spread;
    dir.y += (Math.random() - 0.5) * config.spread;
    dir.z += (Math.random() - 0.5) * config.spread;

    // Normalize
    const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
    dir.x /= len;
    dir.y /= len;
    dir.z /= len;

    // Create projectile
    const projId = `proj_bot_${this.id}_${Date.now()}`;
    const proj = new Projectile(
      projId,
      origin,
      dir,
      config.projectileSpeed,
      config.damage,
      this.id,
      this.name,
      true
    );
    projectiles.push(proj);

    // Broadcast fire event
    io.emit('botFire', {
      botId: this.id,
      origin,
      direction: dir,
      classType: this.classType
    });
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
    } else {
      this.grounded = false;
      this.velocity.x *= FRICTION_AIR;
      this.velocity.z *= FRICTION_AIR;
    }

    this.position.x = Math.max(-WORLD_SIZE, Math.min(WORLD_SIZE, this.position.x));
    this.position.z = Math.max(-WORLD_SIZE, Math.min(WORLD_SIZE, this.position.z));

    // Update quaternion from yaw/pitch
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

// --- GAME MANAGEMENT ---

function initBots() {
  bots = {};
  for (let i = 0; i < BOT_COUNT; i++) {
    const id = `bot_${i}`;
    bots[id] = new BotAI(id, botNames[i % botNames.length]);
  }
}

function startRound() {
  gameState = 'PLAYING';
  roundTime = ROUND_DURATION;
  
  // Reset players
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

  // Reset bots
  initBots();
  
  // Clear projectiles
  projectiles = [];
  
  killFeed = [];
  io.emit('roundStart', { duration: ROUND_DURATION });
  addKillFeed('ROUND STARTED - FIGHT!');
}

function endRound() {
  gameState = 'ENDED';
  roundTime = LOBBY_DURATION;
  
  // Clear projectiles
  projectiles = [];
  
  // Calculate leaderboard - hide bot status
  const allCombatants = [
    ...Object.values(players).map(p => ({ name: p.name, kills: p.kills, alive: p.alive, isBot: false })),
    ...Object.values(bots).map(b => ({ name: b.name, kills: b.kills, alive: b.alive, isBot: false })) // Hide bot status
  ];
  
  allCombatants.sort((a, b) => {
    if (a.alive && !b.alive) return -1;
    if (!a.alive && b.alive) return 1;
    return b.kills - a.kills;
  });
  
  leaderboard = allCombatants;
  io.emit('roundEnd', { leaderboard, winner: allCombatants[0] });
  addKillFeed(`ROUND ENDED - Winner: ${allCombatants[0].name}`);
  
  // Reset players to lobby state
  for (const id in players) {
    players[id].alive = false;
  }
}

function addKillFeed(msg) {
  killFeed.unshift({ msg, time: Date.now() });
  if (killFeed.length > 10) killFeed.pop();
  io.emit('killFeed', { msg });
}

// --- PHYSICS ENGINE ---
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

// --- GAME LOOP ---
setInterval(() => {
  const delta = 1 / TICK_RATE;
  
  // Timer management
  if (gameState === 'LOBBY' || gameState === 'ENDED') {
    roundTime -= delta;
    if (roundTime <= 0) {
      startRound();
    }
  } else if (gameState === 'PLAYING') {
    roundTime -= delta;
    
    // Check win condition (last man standing or time up)
    const alivePlayers = Object.values(players).filter(p => p.alive).length;
    const aliveBots = Object.values(bots).filter(b => b.alive).length;
    
    if (roundTime <= 0 || (alivePlayers + aliveBots <= 1)) {
      endRound();
    }
  }

  // Update Bots
  for (const id in bots) {
    bots[id].update(delta, players);
  }

  // Update Players
  for (const id in players) {
    updatePlayerPhysics(players[id], delta);
  }

  // Update Projectiles
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
        
        // Notify shooter
        const shooter = players[proj.ownerId] || bots[proj.ownerId];
        if (shooter && players[proj.ownerId]) {
          io.to(proj.ownerId).emit('hitMarker', { kill: p.hp <= 0 });
        }
        
        if (p.hp <= 0) {
          p.alive = false;
          shooter.kills++;
          addKillFeed(`${proj.ownerName} eliminated ${p.name}`);
        }
        break;
      }
    }
    
    // Check hits on bots
    if (proj.active) {
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
    }
    
    if (!proj.active) {
      projectiles.splice(i, 1);
    }
  }

  // Broadcast World State
  const gameData = {
    state: gameState,
    time: Math.ceil(roundTime),
    players: Object.values(players).map(p => ({
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
    })),
    bots: Object.values(bots).map(b => ({
      id: b.id,
      x: b.position.x, y: b.position.y, z: b.position.z,
      qx: b.quaternion.x, qy: b.quaternion.y, qz: b.quaternion.z, qw: b.quaternion.w,
      classType: b.classType,
      sliding: b.sliding,
      hp: b.hp,
      alive: b.alive,
      kills: b.kills,
      name: b.name,
      walkCycle: b.walkCycle,
      animTime: b.animTime
    })),
    projectiles: projectiles.map(p => ({
      id: p.id,
      x: p.position.x,
      y: p.position.y,
      z: p.position.z,
      vx: p.velocity.x,
      vy: p.velocity.y,
      vz: p.velocity.z
    })),
    killFeed: killFeed.slice(0, 5)
  };
  
  io.emit('worldUpdate', gameData);

}, 1000 / TICK_RATE);

// --- SOCKET HANDLING ---
io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  // Always show menu first, not spectator mode
  socket.emit('lobbyMode', { timeUntilStart: roundTime, gameState });

  socket.on('joinGame', (data) => {
    // Allow joining even if game is playing - they'll wait for next round in lobby
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
      alive: false, // Not alive until round starts
      kills: 0,
      inputs: {}
    };
    
    socket.emit('joined', { id: socket.id });
    addKillFeed(`${players[socket.id].name} joined the lobby`);
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

    // Slide initiation
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

    // Jump / Slide Hop
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
    
    // Normalize direction
    const dirLen = Math.sqrt(direction.x * direction.x + direction.y * direction.y + direction.z * direction.z);
    const dir = {
      x: direction.x / dirLen,
      y: direction.y / dirLen,
      z: direction.z / dirLen
    };
    
    // Create projectile
    const projId = `proj_${socket.id}_${now}`;
    const proj = new Projectile(
      projId,
      origin,
      dir,
      config.projectileSpeed,
      config.damage,
      socket.id,
      p.name,
      false
    );
    projectiles.push(proj);

    // Broadcast fire event
    io.emit('playerFire', {
      playerId: socket.id,
      origin,
      direction: dir,
      classType: p.classType
    });
  });

  socket.on('disconnect', () => {
    if (players[socket.id]) {
      addKillFeed(`${players[socket.id].name} disconnected`);
      delete players[socket.id];
    }
  });
});

// Initialize bots for first round
initBots();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on *:${PORT}`);
});
