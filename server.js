const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Create io first so it's available everywhere
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ['websocket', 'polling'] // Ensure compatibility
});

app.use(express.static(path.join(__dirname, 'public')));

const MAX_PLAYERS = 20;
const MAP_SIZE = 200;
const STORM_SHRINK_RATE = 0.3; // Reduced from 0.5
const STORM_DAMAGE = 2; // Reduced from 5
const ROUND_WAIT_TIME = 60000;
const BOT_NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Ghost', 'Hunter', 'Iron', 'Joker', 'Killer', 'Lion', 'Maverick', 'Ninja', 'Omega', 'Phantom', 'Quake', 'Raptor', 'Shadow', 'Titan'];

const WEAPONS = {
  assault: { name: 'Assault Rifle', damage: 25, fireRate: 150, maxAmmo: 30, reloadTime: 2000, range: 100, spread: 0.02 },
  machine: { name: 'Machine Gun', damage: 15, fireRate: 80, maxAmmo: 100, reloadTime: 3000, range: 80, spread: 0.04 },
  shotgun: { name: 'Shotgun', damage: 80, fireRate: 800, maxAmmo: 8, reloadTime: 2500, range: 40, pellets: 5, spread: 0.08 },
  sniper: { name: 'Sniper Rifle', damage: 100, fireRate: 1200, maxAmmo: 5, reloadTime: 3000, range: 200, spread: 0.005 }
};

class GameState {
  constructor(ioInstance) {
    this.io = ioInstance; // Store io reference
    this.players = new Map();
    this.bots = new Map();
    this.bullets = [];
    this.stormRadius = MAP_SIZE;
    this.stormCenter = { x: 0, z: 0 };
    this.gamePhase = 'lobby';
    this.roundStartTime = null;
    this.winner = null;
    this.spectators = new Map();
    this.lobbyTimer = null;
  }

  reset() {
    this.players.forEach(player => {
      player.hp = 100;
      player.x = (Math.random() - 0.5) * MAP_SIZE * 0.8;
      player.z = (Math.random() - 0.5) * MAP_SIZE * 0.8;
      player.y = 2;
      player.kills = 0;
      player.ammo = WEAPONS[player.weapon].maxAmmo;
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
      const botId = `bot_${i}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
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
    const botCount = Math.max(0, MAX_PLAYERS - this.players.size);
    if (botCount > 0) {
      this.spawnBots(botCount);
    }
    this.gamePhase = 'playing';
    this.roundStartTime = Date.now();
    this.stormRadius = MAP_SIZE;
    this.io.emit('gameStart'); // Use this.io instead of global io
  }

  endRound(winner) {
    this.gamePhase = 'ending';
    this.winner = winner;
    setTimeout(() => {
      this.gamePhase = 'lobby';
      this.roundStartTime = null;
      this.winner = null;
      this.io.emit('roundEnded', { winner: winner ? winner.name : 'No one' });
    }, 5000);
  }

  updateStorm() {
    if (this.gamePhase !== 'playing') return;
    const elapsed = (Date.now() - this.roundStartTime) / 1000;
    const targetRadius = Math.max(20, MAP_SIZE - (elapsed * STORM_SHRINK_RATE));
    this.stormRadius = Math.max(targetRadius, this.stormRadius - 0.1);
    
    // Keep storm center in bounds
    this.stormCenter.x = Math.max(-50, Math.min(50, this.stormCenter.x + (Math.random() - 0.5) * 0.5));
    this.stormCenter.z = Math.max(-50, Math.min(50, this.stormCenter.z + (Math.random() - 0.5) * 0.5));
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
          this.killPlayer(entity, { name: 'The Storm', isBot: true, id: 'storm' });
        }
      }
    };

    this.players.forEach(checkEntity);
    this.bots.forEach(checkEntity);
  }

  killPlayer(victim, killer) {
    if (!victim.isAlive) return; // Prevent double kills
    victim.isAlive = false;
    victim.deathTime = Date.now();
    
    if (killer && killer !== victim && killer.id !== 'storm') {
      killer.kills++;
    }
    
    this.io.emit('playerKilled', {
      victim: victim.name || victim.id,
      killer: killer ? (killer.name || killer.id) : 'Unknown',
      weapon: killer && killer.weapon ? killer.weapon : 'storm'
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
      if (now - bot.lastUpdate < 100) return;
      bot.lastUpdate = now;

      let nearest = null;
      let nearestDist = Infinity;
      
      allTargets.forEach(target => {
        if (target.id === bot.id) return;
        const dx = target.x - bot.x;
        const dz = target.z - bot.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearest = target;
        }
      });

      if (nearest && nearestDist < WEAPONS[bot.weapon].range) {
        bot.target = nearest;
        bot.rotation = Math.atan2(nearest.x - bot.x, nearest.z - bot.z);
        
        if (nearestDist > 15) {
          const speed = 0.12;
          bot.x += Math.sin(bot.rotation) * speed;
          bot.z += Math.cos(bot.rotation) * speed;
        }

        const weapon = WEAPONS[bot.weapon];
        if (now - bot.lastShot > weapon.fireRate && bot.ammo > 0 && !bot.reloading) {
          this.shoot(bot);
          bot.lastShot = now;
          bot.ammo--;
          if (bot.ammo <= 0) this.reload(bot);
        }
      } else {
        // Wander randomly
        bot.rotation += (Math.random() - 0.5) * 0.3;
        bot.x += Math.sin(bot.rotation) * 0.08;
        bot.z += Math.cos(bot.rotation) * 0.08;
      }

      // Keep in bounds
      bot.x = Math.max(-MAP_SIZE/2, Math.min(MAP_SIZE/2, bot.x));
      bot.z = Math.max(-MAP_SIZE/2, Math.min(MAP_SIZE/2, bot.z));
    });
  }

  shoot(shooter) {
    const weapon = WEAPONS[shooter.weapon];
    const bullet = {
      id: Math.random().toString(36),
      owner: shooter.id,
      x: shooter.x,
      y: shooter.y + 1,
      z: shooter.z,
      rotation: shooter.rotation,
      damage: weapon.damage,
      speed: 1.5,
      range: weapon.range,
      distance: 0,
      pellets: weapon.pellets || 1,
      spread: weapon.spread || 0
    };

    if (bullet.pellets > 1) {
      for (let i = 0; i < bullet.pellets; i++) {
        const spreadX = (Math.random() - 0.5) * bullet.spread;
        this.bullets.push({
          ...bullet,
          id: `${bullet.id}_${i}`,
          rotation: bullet.rotation + spreadX
        });
      }
    } else {
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
      if (this.players.has(player.id) || this.bots.has(player.id)) {
        player.ammo = weapon.maxAmmo;
        player.reloading = false;
      }
    }, weapon.reloadTime);
  }

  updateBullets() {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const bullet = this.bullets[i];
      const dx = Math.sin(bullet.rotation) * bullet.speed;
      const dz = Math.cos(bullet.rotation) * bullet.speed;
      
      bullet.x += dx;
      bullet.z += dz;
      bullet.distance += bullet.speed;

      // Remove if out of range
      if (bullet.distance > bullet.range) {
        this.bullets.splice(i, 1);
        continue;
      }

      let hit = false;
      
      // Check players
      for (const player of this.players.values()) {
        if (!player.isAlive || player.id === bullet.owner) continue;
        const dist = Math.sqrt((bullet.x - player.x) ** 2 + (bullet.z - player.z) ** 2);
        if (dist < 2.5) {
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
          if (dist < 2.5) {
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

      if (hit) {
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

  startLobbyTimer() {
    if (this.lobbyTimer) return;
    if (!this.roundStartTime) this.roundStartTime = Date.now();
    
    this.lobbyTimer = setInterval(() => {
      if (this.gamePhase !== 'lobby') {
        clearInterval(this.lobbyTimer);
        this.lobbyTimer = null;
        return;
      }
      
      const timeLeft = Math.max(0, ROUND_WAIT_TIME - (Date.now() - this.roundStartTime));
      
      this.io.emit('lobbyUpdate', {
        players: this.players.size,
        maxPlayers: MAX_PLAYERS,
        timeUntilStart: timeLeft
      });
      
      if (timeLeft <= 0) {
        clearInterval(this.lobbyTimer);
        this.lobbyTimer = null;
        this.startRound();
      }
    }, 1000);
  }
}

// Pass io to GameState
const game = new GameState(io);

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);
  
  if (game.players.size >= MAX_PLAYERS && game.gamePhase === 'playing') {
    socket.emit('gameFull');
    game.spectators.set(socket.id, { id: socket.id, socket });
    socket.emit('spectatorMode', game.getLeaderboard());
    return;
  }

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

  socket.emit('init', {
    playerId: socket.id,
    gamePhase: game.gamePhase,
    weapons: WEAPONS,
    mapSize: MAP_SIZE
  });

  if (game.gamePhase === 'lobby') {
    socket.emit('lobbyUpdate', {
      players: game.players.size,
      maxPlayers: MAX_PLAYERS,
      timeUntilStart: game.roundStartTime ? Math.max(0, ROUND_WAIT_TIME - (Date.now() - game.roundStartTime)) : ROUND_WAIT_TIME
    });
    
    if (!game.lobbyTimer) {
      game.startLobbyTimer();
    }
  } else if (game.gamePhase === 'playing') {
    socket.emit('spectatorMode', game.getLeaderboard());
  }

  socket.on('move', (data) => {
    if (!player.isAlive || game.gamePhase !== 'playing') return;
    
    // Validate inputs
    if (typeof data.x !== 'number' || typeof data.z !== 'number') return;
    
    player.x = Math.max(-MAP_SIZE/2, Math.min(MAP_SIZE/2, data.x));
    player.z = Math.max(-MAP_SIZE/2, Math.min(MAP_SIZE/2, data.z));
    player.rotation = data.rotation || 0;
    player.y = Math.max(2, Math.min(10, data.y || 2));
  });

  socket.on('shoot', () => {
    if (!player.isAlive || game.gamePhase !== 'playing') return;
    const weapon = WEAPONS[player.weapon];
    const now = Date.now();
    
    if (now - player.lastShot > weapon.fireRate && player.ammo > 0 && !player.reloading) {
      game.shoot(player);
      player.lastShot = now;
      player.ammo--;
      if (player.ammo <= 0) game.reload(player);
    }
  });

  socket.on('reload', () => {
    if (!player.isAlive || game.gamePhase !== 'playing') return;
    game.reload(player);
  });

  socket.on('weaponChange', (weapon) => {
    if (!WEAPONS[weapon]) return;
    if (player.reloading) return;
    
    player.weapon = weapon;
    player.ammo = WEAPONS[weapon].maxAmmo;
    player.reloading = false; // Cancel reload on switch
    socket.emit('weaponSelected', weapon);
  });

  socket.on('setName', (name) => {
    if (typeof name === 'string' && name.length > 0 && name.length < 20) {
      player.name = name;
    }
  });

  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
    game.players.delete(socket.id);
    game.spectators.delete(socket.id);
    
    if (game.gamePhase === 'playing' && player.isAlive) {
      game.killPlayer(player, null);
    }
    
    if (game.players.size === 0 && game.gamePhase === 'lobby') {
      if (game.lobbyTimer) {
        clearInterval(this.lobbyTimer);
        game.lobbyTimer = null;
        game.roundStartTime = null;
      }
    }
  });
});

// Game loop at 20 FPS (reduced from 30 for performance)
setInterval(() => {
  game.updateStorm();
  game.checkStormDamage();
  game.updateBots();
  game.updateBullets();

  game.players.forEach((player, id) => {
    if (player.socket.connected) {
      player.socket.emit('gameState', game.getStateForPlayer(id));
    }
  });

  game.spectators.forEach((spec) => {
    if (spec.socket.connected) {
      spec.socket.emit('spectatorUpdate', game.getLeaderboard());
    }
  });
}, 1000 / 20);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
