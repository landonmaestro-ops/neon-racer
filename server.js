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
  }
});

app.use(express.static(path.join(__dirname, 'public')));

// Game Constants
const MAX_PLAYERS = 20;
const MAP_SIZE = 200;
const STORM_SHRINK_RATE = 0.5;
const STORM_DAMAGE = 5;
const ROUND_WAIT_TIME = 60000; // 60 seconds
const BOT_NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Ghost', 'Hunter', 'Iron', 'Joker', 'Killer', 'Lion', 'Maverick', 'Ninja', 'Omega', 'Phantom', 'Quake', 'Raptor', 'Shadow', 'Titan'];

// Weapon Definitions
const WEAPONS = {
  assault: {
    name: 'Assault Rifle',
    damage: 25,
    fireRate: 150,
    maxAmmo: 30,
    reloadTime: 2000,
    range: 100,
    spread: 0.02
  },
  machine: {
    name: 'Machine Gun',
    damage: 15,
    fireRate: 80,
    maxAmmo: 100,
    reloadTime: 3000,
    range: 80,
    spread: 0.04
  },
  shotgun: {
    name: 'Shotgun',
    damage: 80,
    fireRate: 800,
    maxAmmo: 8,
    reloadTime: 2500,
    range: 40,
    pellets: 5,
    spread: 0.08
  },
  sniper: {
    name: 'Sniper Rifle',
    damage: 100,
    fireRate: 1200,
    maxAmmo: 5,
    reloadTime: 3000,
    range: 200,
    spread: 0.005
  }
};

class GameState {
  constructor() {
    this.players = new Map();
    this.bots = new Map();
    this.bullets = [];
    this.stormRadius = MAP_SIZE;
    this.stormCenter = { x: 0, z: 0 };
    this.gamePhase = 'lobby'; // lobby, playing, ending
    this.roundStartTime = null;
    this.roundEndTime = null;
    this.winner = null;
    this.spectators = new Map();
  }

  reset() {
    this.players.forEach(player => {
      player.hp = 100;
      player.x = (Math.random() - 0.5) * MAP_SIZE * 0.8;
      player.z = (Math.random() - 0.5) * MAP_SIZE * 0.8;
      player.y = 2;
      player.kills = 0;
      player.weapon = 'assault';
      player.ammo = WEAPONS.assault.maxAmmo;
      player.isAlive = true;
      player.lastShot = 0;
      player.reloading = false;
    });
    
    this.bots.clear();
    this.bullets = [];
    this.stormRadius = MAP_SIZE;
    this.stormCenter = { x: 0, z: 0 };
    this.winner = null;
  }

  spawnBots(count) {
    const weapons = Object.keys(WEAPONS);
    for (let i = 0; i < count; i++) {
      const botId = `bot_${i}_${Date.now()}`;
      const weapon = weapons[Math.floor(Math.random() * weapons.length)];
      const bot = {
        id: botId,
        isBot: true,
        name: BOT_NAMES[i % BOT_NAMES.length],
        x: (Math.random() - 0.5) * MAP_SIZE * 0.8,
        y: 2,
        z: (Math.random() - 0.5) * MAP_SIZE * 0.8,
        rotation: Math.random() * Math.PI * 2,
        hp: 100,
        weapon: weapon,
        ammo: WEAPONS[weapon].maxAmmo,
        kills: 0,
        isAlive: true,
        lastShot: 0,
        reloading: false,
        target: null,
        lastUpdate: Date.now(),
        color: Math.random() * 0xffffff
      };
      this.bots.set(botId, bot);
    }
  }

  startRound() {
    this.reset();
    const botCount = MAX_PLAYERS - this.players.size;
    if (botCount > 0) {
      this.spawnBots(botCount);
    }
    this.gamePhase = 'playing';
    this.roundStartTime = Date.now();
    this.stormRadius = MAP_SIZE;
  }

  endRound(winner) {
    this.gamePhase = 'ending';
    this.winner = winner;
    this.roundEndTime = Date.now();
    
    setTimeout(() => {
      this.gamePhase = 'lobby';
      io.emit('roundEnded', { winner: winner ? winner.name : 'No one' });
    }, 5000);
  }

  updateStorm() {
    if (this.gamePhase !== 'playing') return;
    
    const elapsed = (Date.now() - this.roundStartTime) / 1000;
    const targetRadius = Math.max(20, MAP_SIZE - (elapsed * STORM_SHRINK_RATE));
    this.stormRadius = Math.max(targetRadius, this.stormRadius - 0.1);
    
    // Move storm center slightly
    this.stormCenter.x += (Math.random() - 0.5) * 0.5;
    this.stormCenter.z += (Math.random() - 0.5) * 0.5;
  }

  checkStormDamage() {
    if (this.gamePhase !== 'playing') return;
    
    const checkEntity = (entity) => {
      if (!entity.isAlive) return;
      const dx = entity.x - this.stormCenter.x;
      const dz = entity.z - this.stormCenter.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      
      if (dist > this.stormRadius) {
        entity.hp -= STORM_DAMAGE;
        if (entity.hp <= 0) {
          this.killPlayer(entity, { name: 'The Storm', isBot: true });
        }
      }
    };

    this.players.forEach(checkEntity);
    this.bots.forEach(checkEntity);
  }

  killPlayer(victim, killer) {
    victim.isAlive = false;
    victim.deathTime = Date.now();
    
    if (killer && killer !== victim) {
      killer.kills++;
    }
    
    io.emit('playerKilled', {
      victim: victim.name || victim.id,
      killer: killer ? (killer.name || killer.id) : 'Unknown',
      weapon: killer ? killer.weapon : 'storm'
    });

    this.checkWinCondition();
  }

  checkWinCondition() {
    const alivePlayers = Array.from(this.players.values()).filter(p => p.isAlive);
    const aliveBots = Array.from(this.bots.values()).filter(b => b.isAlive);
    const totalAlive = alivePlayers.length + aliveBots.length;

    if (totalAlive === 1) {
      const winner = alivePlayers[0] || aliveBots[0];
      this.endRound(winner);
    } else if (totalAlive === 0) {
      this.endRound(null);
    }
  }

  updateBots() {
    if (this.gamePhase !== 'playing') return;

    const now = Date.now();
    const allTargets = [
      ...Array.from(this.players.values()).filter(p => p.isAlive),
      ...Array.from(this.bots.values()).filter(b => b.isAlive)
    ];

    this.bots.forEach(bot => {
      if (!bot.isAlive) return;
      if (now - bot.lastUpdate < 100) return; // Update every 100ms
      
      bot.lastUpdate = now;

      // Find nearest target
      let nearest = null;
      let nearestDist = Infinity;
      
      allTargets.forEach(target => {
        if (target.id === bot.id) return;
        const dx = target.x - bot.x;
        const dz = target.z - bot.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < nearestDist && dist < WEAPONS[bot.weapon].range) {
          nearestDist = dist;
          nearest = target;
        }
      });

      if (nearest) {
        bot.target = nearest;
        // Look at target
        bot.rotation = Math.atan2(nearest.x - bot.x, nearest.z - bot.z);
        
        // Move towards target if too far
        if (nearestDist > 20) {
          const speed = 0.15;
          bot.x += Math.sin(bot.rotation) * speed;
          bot.z += Math.cos(bot.rotation) * speed;
        }

        // Shoot if in range and has ammo
        const weapon = WEAPONS[bot.weapon];
        if (now - bot.lastShot > weapon.fireRate && bot.ammo > 0 && !bot.reloading) {
          this.shoot(bot);
          bot.lastShot = now;
          bot.ammo--;
          
          if (bot.ammo <= 0) {
            this.reload(bot);
          }
        }
      } else {
        // Random movement
        bot.rotation += (Math.random() - 0.5) * 0.2;
        bot.x += Math.sin(bot.rotation) * 0.1;
        bot.z += Math.cos(bot.rotation) * 0.1;
      }

      // Keep in bounds
      bot.x = Math.max(-MAP_SIZE/2, Math.min(MAP_SIZE/2, bot.x));
      bot.z = Math.max(-MAP_SIZE/2, Math.min(MAP_SIZE/2, bot.z));
    });
  }

  shoot(shooter) {
    const weapon = WEAPONS[shooter.weapon];
    const now = Date.now();
    
    const bullet = {
      id: Math.random().toString(36),
      owner: shooter.id,
      x: shooter.x,
      y: shooter.y + 1,
      z: shooter.z,
      rotation: shooter.rotation,
      damage: weapon.damage,
      speed: 2,
      range: weapon.range,
      distance: 0,
      pellets: weapon.pellets || 1,
      spread: weapon.spread || 0
    };

    if (bullet.pellets > 1) {
      // Shotgun spread
      for (let i = 0; i < bullet.pellets; i++) {
        const spreadX = (Math.random() - 0.5) * bullet.spread;
        const spreadY = (Math.random() - 0.5) * bullet.spread;
        this.bullets.push({
          ...bullet,
          id: `${bullet.id}_${i}`,
          rotation: bullet.rotation + spreadX,
          yOffset: spreadY
        });
      }
    } else {
      // Single bullet with slight spread
      const spread = (Math.random() - 0.5) * weapon.spread;
      bullet.rotation += spread;
      this.bullets.push(bullet);
    }
  }

  reload(player) {
    if (player.reloading) return;
    const weapon = WEAPONS[player.weapon];
    player.reloading = true;
    
    setTimeout(() => {
      player.ammo = weapon.maxAmmo;
      player.reloading = false;
    }, weapon.reloadTime);
  }

  updateBullets() {
    const now = Date.now();
    
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const bullet = this.bullets[i];
      const dx = Math.sin(bullet.rotation) * bullet.speed;
      const dz = Math.cos(bullet.rotation) * bullet.speed;
      
      bullet.x += dx;
      bullet.z += dz;
      bullet.distance += bullet.speed;

      // Check collisions
      let hit = false;
      
      // Check players
      for (const player of this.players.values()) {
        if (!player.isAlive || player.id === bullet.owner) continue;
        const dist = Math.sqrt((bullet.x - player.x) ** 2 + (bullet.z - player.z) ** 2);
        if (dist < 2) {
          player.hp -= bullet.damage;
          hit = true;
          if (player.hp <= 0) {
            const killer = this.players.get(bullet.owner) || this.bots.get(bullet.owner);
            this.killPlayer(player, killer);
          }
          break;
        }
      }

      // Check bots
      if (!hit) {
        for (const bot of this.bots.values()) {
          if (!bot.isAlive || bot.id === bullet.owner) continue;
          const dist = Math.sqrt((bullet.x - bot.x) ** 2 + (bullet.z - bot.z) ** 2);
          if (dist < 2) {
            bot.hp -= bullet.damage;
            hit = true;
            if (bot.hp <= 0) {
              const killer = this.players.get(bullet.owner) || this.bots.get(bullet.owner);
              this.killPlayer(bot, killer);
            }
            break;
          }
        }
      }

      // Remove if hit or out of range
      if (hit || bullet.distance > bullet.range) {
        this.bullets.splice(i, 1);
      }
    }
  }

  getLeaderboard() {
    const allPlayers = [
      ...Array.from(this.players.values()).map(p => ({...p, isBot: false})),
      ...Array.from(this.bots.values()).map(b => ({...b, isBot: true}))
    ];
    
    return allPlayers
      .sort((a, b) => {
        if (a.isAlive !== b.isAlive) return a.isAlive ? -1 : 1;
        return b.kills - a.kills;
      })
      .map(p => ({
        name: p.name || p.id,
        kills: p.kills,
        isAlive: p.isAlive,
        isBot: p.isBot
      }));
  }

  getStateForPlayer(playerId) {
    return {
      players: Array.from(this.players.values()).map(p => ({
        id: p.id,
        x: p.x,
        y: p.y,
        z: p.z,
        rotation: p.rotation,
        hp: p.hp,
        maxHp: 100,
        weapon: p.weapon,
        ammo: p.ammo,
        maxAmmo: WEAPONS[p.weapon].maxAmmo,
        reloading: p.reloading,
        kills: p.kills,
        isAlive: p.isAlive,
        isBot: false,
        color: p.color
      })),
      bots: Array.from(this.bots.values()).map(b => ({
        id: b.id,
        x: b.x,
        y: b.y,
        z: b.z,
        rotation: b.rotation,
        hp: b.hp,
        weapon: b.weapon,
        isAlive: b.isAlive,
        isBot: true,
        color: b.color
      })),
      bullets: this.bullets,
      storm: {
        radius: this.stormRadius,
        center: this.stormCenter
      },
      gamePhase: this.gamePhase,
      leaderboard: this.getLeaderboard(),
      yourId: playerId,
      winner: this.winner ? (this.winner.name || this.winner.id) : null
    };
  }
}

const game = new GameState();

// Socket.io handling
io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);
  
  // Check if game is full
  if (game.players.size >= MAX_PLAYERS && game.gamePhase === 'playing') {
    socket.emit('gameFull');
    game.spectators.set(socket.id, { id: socket.id, socket });
    socket.emit('spectatorMode', game.getLeaderboard());
    return;
  }

  // Create player
  const player = {
    id: socket.id,
    socket: socket,
    name: `Player ${socket.id.substr(0, 5)}`,
    x: (Math.random() - 0.5) * MAP_SIZE * 0.8,
    y: 2,
    z: (Math.random() - 0.5) * MAP_SIZE * 0.8,
    rotation: 0,
    hp: 100,
    weapon: 'assault',
    ammo: WEAPONS.assault.maxAmmo,
    kills: 0,
    isAlive: true,
    lastShot: 0,
    reloading: false,
    color: Math.random() * 0xffffff
  };

  game.players.set(socket.id, player);

  // Send current game state
  socket.emit('init', {
    playerId: socket.id,
    gamePhase: game.gamePhase,
    weapons: WEAPONS,
    mapSize: MAP_SIZE
  });

  // If in lobby, check if we should start
  if (game.gamePhase === 'lobby') {
    const playerCount = game.players.size;
    socket.emit('lobbyUpdate', {
      players: playerCount,
      maxPlayers: MAX_PLAYERS,
      timeUntilStart: Math.max(0, ROUND_WAIT_TIME - (Date.now() - (game.roundStartTime || Date.now())))
    });
    
    if (!game.roundStartTime) {
      game.roundStartTime = Date.now();
      setTimeout(() => {
        if (game.gamePhase === 'lobby') {
          game.startRound();
          io.emit('gameStart');
        }
      }, ROUND_WAIT_TIME);
    }
  } else if (game.gamePhase === 'playing') {
    socket.emit('spectatorMode', game.getLeaderboard());
  }

  // Handle player input
  socket.on('move', (data) => {
    if (!player.isAlive || game.gamePhase !== 'playing') return;
    
    player.x = Math.max(-MAP_SIZE/2, Math.min(MAP_SIZE/2, data.x));
    player.z = Math.max(-MAP_SIZE/2, Math.min(MAP_SIZE/2, data.z));
    player.rotation = data.rotation;
    player.y = data.y || 2;
  });

  socket.on('shoot', () => {
    if (!player.isAlive || game.gamePhase !== 'playing') return;
    
    const weapon = WEAPONS[player.weapon];
    const now = Date.now();
    
    if (now - player.lastShot > weapon.fireRate && player.ammo > 0 && !player.reloading) {
      game.shoot(player);
      player.lastShot = now;
      player.ammo--;
      
      if (player.ammo <= 0) {
        game.reload(player);
      }
    }
  });

  socket.on('reload', () => {
    if (!player.isAlive || game.gamePhase !== 'playing') return;
    game.reload(player);
  });

  socket.on('weaponChange', (weapon) => {
    if (WEAPONS[weapon] && !player.reloading) {
      player.weapon = weapon;
      player.ammo = WEAPONS[weapon].maxAmmo;
    }
  });

  socket.on('setName', (name) => {
    player.name = name || player.name;
  });

  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
    game.players.delete(socket.id);
    game.spectators.delete(socket.id);
    
    if (game.gamePhase === 'playing' && player.isAlive) {
      game.killPlayer(player, null);
    }
  });
});

// Game loop
setInterval(() => {
  game.updateStorm();
  game.checkStormDamage();
  game.updateBots();
  game.updateBullets();

  // Send updates to all clients
  const state = game.getStateForPlayer();
  
  game.players.forEach((player, id) => {
    player.socket.emit('gameState', game.getStateForPlayer(id));
  });

  game.spectators.forEach((spec) => {
    spec.socket.emit('spectatorUpdate', game.getLeaderboard());
  });
}, 1000 / 30); // 30 FPS

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
