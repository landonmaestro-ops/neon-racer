const socket = io();

let scene, camera, renderer;
let playerMesh, weaponMesh;
let otherPlayers = new Map();
let otherBots = new Map();
let bullets = [];
let particles = [];
let gameState = null;
let myId = null;
let weapons = {};
let mapSize = 200;
let gamePhase = 'lobby';

const keys = {};
let isPointerLocked = false;

const playerSpeed = 0.3;
const jumpSpeed = 0.5;
let velocityY = 0;
const gravity = 0.02;

function init() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87CEEB);
  scene.fog = new THREE.Fog(0x87CEEB, 20, 150);

  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.y = 3;

  renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('gameCanvas'), antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(50, 100, 50);
  dirLight.castShadow = true;
  dirLight.shadow.camera.left = -100;
  dirLight.shadow.camera.right = 100;
  dirLight.shadow.camera.top = 100;
  dirLight.shadow.camera.bottom = -100;
  scene.add(dirLight);

  const groundGeometry = new THREE.PlaneGeometry(mapSize * 2, mapSize * 2);
  const groundMaterial = new THREE.MeshLambertMaterial({ color: 0x3d5c3d });
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(mapSize * 2, 40, 0x000000, 0x000000);
  grid.material.opacity = 0.2;
  grid.material.transparent = true;
  scene.add(grid);

  const stormGeometry = new THREE.RingGeometry(1, 1, 64);
  const stormMaterial = new THREE.MeshBasicMaterial({ 
    color: 0x800080, 
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.3
  });
  window.stormMesh = new THREE.Mesh(stormGeometry, stormMaterial);
  window.stormMesh.rotation.x = -Math.PI / 2;
  window.stormMesh.position.y = 0.5;
  scene.add(window.stormMesh);

  const playerGeometry = new THREE.CapsuleGeometry(1, 4, 4, 8);
  const playerMaterial = new THREE.MeshLambertMaterial({ color: 0x4ecdc4 });
  playerMesh = new THREE.Mesh(playerGeometry, playerMaterial);
  playerMesh.castShadow = true;
  playerMesh.visible = false;
  scene.add(playerMesh);

  const weaponGeom = new THREE.BoxGeometry(0.3, 0.3, 1);
  const weaponMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
  weaponMesh = new THREE.Mesh(weaponGeom, weaponMat);
  weaponMesh.position.set(0.5, -0.5, -1);
  camera.add(weaponMesh);

  createWeaponModels();

  window.addEventListener('resize', onWindowResize);
  setupControls();
  
  animate();
}

function createWeaponModels() {
  window.weaponModels = {
    assault: createAssaultRifle(),
    machine: createMachineGun(),
    shotgun: createShotgun(),
    sniper: createSniperRifle()
  };
}

function createAssaultRifle() {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.15, 0.2, 0.8),
    new THREE.MeshLambertMaterial({ color: 0x2c3e50 })
  );
  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.03, 0.4),
    new THREE.MeshLambertMaterial({ color: 0x1a1a1a })
  );
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = -0.6;
  group.add(body, barrel);
  return group;
}

function createMachineGun() {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 0.25, 0.9),
    new THREE.MeshLambertMaterial({ color: 0x8b4513 })
  );
  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, 0.5),
    new THREE.MeshLambertMaterial({ color: 0x1a1a1a })
  );
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = -0.7;
  const mag = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.4, 0.2),
    new THREE.MeshLambertMaterial({ color: 0x1a1a1a })
  );
  mag.position.y = -0.3;
  group.add(body, barrel, mag);
  return group;
}

function createShotgun() {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.22, 0.6),
    new THREE.MeshLambertMaterial({ color: 0x654321 })
  );
  const barrels = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 0.5),
    new THREE.MeshLambertMaterial({ color: 0x1a1a1a })
  );
  barrels.rotation.x = Math.PI / 2;
  barrels.position.z = -0.55;
  group.add(body, barrels);
  return group;
}

function createSniperRifle() {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.18, 1.2),
    new THREE.MeshLambertMaterial({ color: 0x2f4f4f })
  );
  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.02, 0.8),
    new THREE.MeshLambertMaterial({ color: 0x1a1a1a })
  );
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = -1;
  const scope = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.03, 0.3),
    new THREE.MeshLambertMaterial({ color: 0x000000 })
  );
  scope.rotation.x = Math.PI / 2;
  scope.position.y = 0.15;
  scope.position.z = -0.3;
  group.add(body, barrel, scope);
  return group;
}

function setupControls() {
  document.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    
    // Only allow weapon switching during playing phase
    if (gamePhase === 'playing') {
      if (e.code === 'KeyR') {
        socket.emit('reload');
      }
      
      if (e.code === 'Digit1') {
        e.preventDefault();
        socket.emit('weaponChange', 'assault');
        showWeaponNotification('Assault Rifle');
      }
      if (e.code === 'Digit2') {
        e.preventDefault();
        socket.emit('weaponChange', 'machine');
        showWeaponNotification('Machine Gun');
      }
      if (e.code === 'Digit3') {
        e.preventDefault();
        socket.emit('weaponChange', 'shotgun');
        showWeaponNotification('Shotgun');
      }
      if (e.code === 'Digit4') {
        e.preventDefault();
        socket.emit('weaponChange', 'sniper');
        showWeaponNotification('Sniper Rifle');
      }
    }
    
    if (e.code === 'Space' && playerMesh.position.y <= 2.1) {
      velocityY = jumpSpeed;
    }
  });

  document.addEventListener('keyup', (e) => {
    keys[e.code] = false;
  });

  document.addEventListener('mousemove', (e) => {
    if (isPointerLocked) {
      camera.rotation.y -= e.movementX * 0.002;
      camera.rotation.x -= e.movementY * 0.002;
      camera.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, camera.rotation.x));
    }
  });

  document.addEventListener('mousedown', (e) => {
    if (isPointerLocked && e.button === 0 && gamePhase === 'playing') {
      socket.emit('shoot');
      createMuzzleFlash();
    }
  });

  document.addEventListener('click', () => {
    if (!isPointerLocked && gamePhase === 'playing') {
      document.body.requestPointerLock();
    }
  });

  document.addEventListener('pointerlockchange', () => {
    isPointerLocked = document.pointerLockElement === document.body;
  });
}

function showWeaponNotification(weaponName) {
  const notif = document.createElement('div');
  notif.style.cssText = `
    position: absolute;
    bottom: 100px;
    right: 30px;
    background: rgba(0,0,0,0.8);
    color: #4ecdc4;
    padding: 10px 20px;
    border-radius: 5px;
    font-weight: bold;
    z-index: 1000;
    animation: fadeIn 0.3s;
  `;
  notif.textContent = weaponName;
  document.body.appendChild(notif);
  
  setTimeout(() => {
    notif.style.animation = 'fadeOut 0.3s';
    setTimeout(() => notif.remove(), 300);
  }, 1000);
}

function createMuzzleFlash() {
  const flash = new THREE.PointLight(0xffaa00, 2, 5);
  flash.position.set(0, 0, -2);
  camera.add(flash);
  
  setTimeout(() => {
    camera.remove(flash);
  }, 50);

  camera.rotation.x += 0.02;
}

function createBullet(startPos, rotation, isEnemy = false) {
  const geometry = new THREE.SphereGeometry(0.1, 8, 8);
  const material = new THREE.MeshBasicMaterial({ 
    color: isEnemy ? 0xff0000 : 0xffff00 
  });
  const bullet = new THREE.Mesh(geometry, material);
  
  bullet.position.copy(startPos);
  bullet.rotation.y = rotation;
  
  scene.add(bullet);
  bullets.push({ mesh: bullet, rotation: rotation, life: 100 });
}

function createExplosion(position, color = 0xff6600) {
  for (let i = 0; i < 10; i++) {
    const geometry = new THREE.BoxGeometry(0.1, 0.1, 0.1);
    const material = new THREE.MeshBasicMaterial({ color: color });
    const particle = new THREE.Mesh(geometry, material);
    
    particle.position.copy(position);
    particle.velocity = new THREE.Vector3(
      (Math.random() - 0.5) * 0.5,
      Math.random() * 0.5,
      (Math.random() - 0.5) * 0.5
    );
    
    scene.add(particle);
    particles.push({ mesh: particle, life: 30 });
  }
}

function createPlayerMesh(id, color, isBot = false) {
  const group = new THREE.Group();
  
  const bodyGeom = new THREE.CapsuleGeometry(1, 3, 4, 8);
  const bodyMat = new THREE.MeshLambertMaterial({ color: color || 0x4ecdc4 });
  const body = new THREE.Mesh(bodyGeom, bodyMat);
  body.position.y = 2;
  body.castShadow = true;
  group.add(body);
  
  const headGeom = new THREE.SphereGeometry(0.8, 16, 16);
  const headMat = new THREE.MeshLambertMaterial({ color: 0xffdbac });
  const head = new THREE.Mesh(headGeom, headMat);
  head.position.y = 4.2;
  head.castShadow = true;
  group.add(head);
  
  const armGeom = new THREE.CylinderGeometry(0.3, 0.3, 2);
  const armMat = new THREE.MeshLambertMaterial({ color: color || 0x4ecdc4 });
  
  const leftArm = new THREE.Mesh(armGeom, armMat);
  leftArm.position.set(-1.2, 3, 0);
  leftArm.rotation.z = 0.3;
  group.add(leftArm);
  
  const rightArm = new THREE.Mesh(armGeom, armMat);
  rightArm.position.set(1.2, 3, 0.5);
  rightArm.rotation.z = -0.3;
  rightArm.rotation.x = -0.5;
  group.add(rightArm);
  
  const legGeom = new THREE.CylinderGeometry(0.35, 0.35, 2.5);
  const legMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
  
  const leftLeg = new THREE.Mesh(legGeom, legMat);
  leftLeg.position.set(-0.5, 1.25, 0);
  group.add(leftLeg);
  
  const rightLeg = new THREE.Mesh(legGeom, legMat);
  rightLeg.position.set(0.5, 1.25, 0);
  group.add(rightLeg);
  
  const weaponHolder = new THREE.Group();
  weaponHolder.position.set(1.2, 3, 1);
  weaponHolder.name = 'weapon';
  group.add(weaponHolder);
  
  if (isBot) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = 'white';
    ctx.font = 'bold 32px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(id.split('_')[0], 128, 40);
    
    const texture = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({ map: texture });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.position.y = 5.5;
    sprite.scale.set(4, 1, 1);
    group.add(sprite);
  }
  
  return group;
}

function updatePlayerMesh(mesh, data) {
  mesh.position.set(data.x, data.y, data.z);
  mesh.rotation.y = data.rotation;
  
  const weaponHolder = mesh.getObjectByName('weapon');
  if (weaponHolder && window.weaponModels[data.weapon]) {
    weaponHolder.clear();
    const weapon = window.weaponModels[data.weapon].clone();
    weapon.rotation.y = Math.PI / 2;
    weaponHolder.add(weapon);
  }
  
  const body = mesh.children[0];
  if (body) {
    const healthRatio = data.hp / 100;
    body.material.color.setHSL(0.3 * healthRatio, 1, 0.5);
  }
}

function updateLocalPlayer() {
  if (gamePhase !== 'playing') return;
  
  const direction = new THREE.Vector3();
  const rotation = camera.rotation.y;
  
  if (keys['KeyW']) {
    direction.z -= Math.cos(rotation);
    direction.x -= Math.sin(rotation);
  }
  if (keys['KeyS']) {
    direction.z += Math.cos(rotation);
    direction.x += Math.sin(rotation);
  }
  if (keys['KeyA']) {
    direction.x -= Math.cos(rotation);
    direction.z += Math.sin(rotation);
  }
  if (keys['KeyD']) {
    direction.x += Math.cos(rotation);
    direction.z -= Math.sin(rotation);
  }
  
  direction.normalize();
  direction.multiplyScalar(playerSpeed);
  
  camera.position.x += direction.x;
  camera.position.z += direction.z;
  
  velocityY -= gravity;
  camera.position.y += velocityY;
  
  if (camera.position.y < 2) {
    camera.position.y = 2;
    velocityY = 0;
  }
  
  playerMesh.position.copy(camera.position);
  playerMesh.rotation.y = camera.rotation.y;
  
  socket.emit('move', {
    x: camera.position.x,
    y: camera.position.y,
    z: camera.position.z,
    rotation: camera.rotation.y
  });
}

function updateBullets() {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.mesh.position.x += Math.sin(b.rotation) * 2;
    b.mesh.position.z += Math.cos(b.rotation) * 2;
    b.life--;
    
    if (b.life <= 0) {
      scene.remove(b.mesh);
      bullets.splice(i, 1);
    }
  }
}

function updateParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.mesh.position.add(p.mesh.velocity);
    p.mesh.velocity.y -= 0.02;
    p.mesh.rotation.x += 0.1;
    p.mesh.rotation.y += 0.1;
    p.life--;
    
    if (p.life <= 0) {
      scene.remove(p.mesh);
      particles.splice(i, 1);
    }
  }
}

function updateStorm(stormData) {
  if (!window.stormMesh || !stormData) return;
  
  const radius = stormData.radius;
  window.stormMesh.scale.set(radius, radius, 1);
  window.stormMesh.position.x = stormData.center.x;
  window.stormMesh.position.z = stormData.center.z;
  
  const dx = camera.position.x - stormData.center.x;
  const dz = camera.position.z - stormData.center.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  
  const warning = document.getElementById('storm-warning');
  if (dist > radius) {
    warning.classList.remove('hidden');
  } else {
    warning.classList.add('hidden');
  }
}

function updateUI(data) {
  const self = data.players.find(p => p.id === myId);
  if (!self) return;
  
  const healthFill = document.getElementById('health-fill');
  const healthText = document.getElementById('health-text');
  healthFill.style.width = `${self.hp}%`;
  healthText.textContent = `${Math.max(0, self.hp)}/100`;
  
  document.getElementById('current-ammo').textContent = self.ammo;
  document.getElementById('max-ammo').textContent = self.maxAmmo;
  
  const reloadInd = document.getElementById('reload-indicator');
  if (self.reloading) {
    reloadInd.classList.remove('hidden');
  } else {
    reloadInd.classList.add('hidden');
  }
  
  const weaponNames = {
    assault: 'Assault Rifle',
    machine: 'Machine Gun',
    shotgun: 'Shotgun',
    sniper: 'Sniper Rifle'
  };
  document.getElementById('weapon-display').textContent = weaponNames[self.weapon];
  
  const lbList = document.getElementById('leaderboard-list');
  lbList.innerHTML = '';
  
  data.leaderboard.forEach((entry, index) => {
    const div = document.createElement('div');
    div.className = `leaderboard-entry ${entry.isAlive ? 'alive' : 'dead'} ${entry.name === self.name ? 'me' : ''}`;
    div.innerHTML = `
      <span>${index + 1}. ${entry.name} ${entry.isBot ? '(BOT)' : ''}</span>
      <span>${entry.kills} kills</span>
    `;
    lbList.appendChild(div);
  });
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
  requestAnimationFrame(animate);
  
  updateLocalPlayer();
  updateBullets();
  updateParticles();
  
  renderer.render(scene, camera);
}

// Socket events
socket.on('init', (data) => {
  myId = data.playerId;
  weapons = data.weapons;
  mapSize = data.mapSize;
  gamePhase = data.gamePhase;
  
  if (data.gamePhase === 'lobby') {
    document.getElementById('lobby').classList.remove('hidden');
    document.getElementById('hud').classList.add('hidden');
  }
  
  init();
});

socket.on('lobbyUpdate', (data) => {
  document.getElementById('playerCount').textContent = `Players: ${data.players}/${data.maxPlayers}`;
  const seconds = Math.ceil(data.timeUntilStart / 1000);
  document.getElementById('countdown').textContent = `Starting in: ${seconds}s`;
});

socket.on('gameStart', () => {
  gamePhase = 'playing';
  document.getElementById('lobby').classList.add('hidden');
  document.getElementById('spectator').classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');
  
  // Request pointer lock after a short delay to ensure DOM is ready
  setTimeout(() => {
    document.body.requestPointerLock();
  }, 100);
});

socket.on('gameState', (data) => {
  gameState = data;
  gamePhase = data.gamePhase;
  
  // Update other players
  data.players.forEach(p => {
    if (p.id === myId) {
      updateUI(data);
      return;
    }
    
    if (!otherPlayers.has(p.id)) {
      const mesh = createPlayerMesh(p.id, p.color, false);
      scene.add(mesh);
      otherPlayers.set(p.id, mesh);
    }
    
    const mesh = otherPlayers.get(p.id);
    if (p.isAlive) {
      updatePlayerMesh(mesh, p);
      mesh.visible = true;
    } else {
      mesh.visible = false;
    }
  });
  
  // Update bots
  data.bots.forEach(b => {
    if (!otherBots.has(b.id)) {
      const mesh = createPlayerMesh(b.name, b.color, true);
      scene.add(mesh);
      otherBots.set(b.id, mesh);
    }
    
    const mesh = otherBots.get(b.id);
    if (b.isAlive) {
      updatePlayerMesh(mesh, b);
      mesh.visible = true;
    } else {
      mesh.visible = false;
    }
  });
  
  // Update bullets
  data.bullets.forEach(b => {
    if (!bullets.find(bl => bl.id === b.id)) {
      const pos = new THREE.Vector3(b.x, b.y, b.z);
      createBullet(pos, b.rotation, b.owner !== myId);
    }
  });
  
  updateStorm(data.storm);
  
  const self = data.players.find(p => p.id === myId);
  if (self && !self.isAlive) {
    document.exitPointerLock();
    document.getElementById('hud').classList.add('hidden');
    document.getElementById('spectator').classList.remove('hidden');
  }
});

socket.on('playerKilled', (data) => {
  const feed = document.getElementById('kill-feed');
  const entry = document.createElement('div');
  entry.className = 'kill-entry';
  entry.textContent = `${data.killer} eliminated ${data.victim}`;
  feed.appendChild(entry);
  
  setTimeout(() => entry.remove(), 5000);
  
  createExplosion(new THREE.Vector3(
    (Math.random() - 0.5) * 20,
    2,
    (Math.random() - 0.5) * 20
  ));
});

socket.on('spectatorMode', (leaderboard) => {
  document.getElementById('lobby').classList.add('hidden');
  document.getElementById('hud').classList.add('hidden');
  document.getElementById('spectator').classList.remove('hidden');
  
  const list = document.getElementById('spec-leaderboard-list');
  list.innerHTML = '';
  leaderboard.forEach((entry, index) => {
    const div = document.createElement('div');
    div.className = `leaderboard-entry ${entry.isAlive ? 'alive' : 'dead'}`;
    div.innerHTML = `
      <span>${index + 1}. ${entry.name} ${entry.isBot ? '(BOT)' : ''}</span>
      <span>${entry.kills} kills</span>
    `;
    list.appendChild(div);
  });
});

socket.on('spectatorUpdate', (leaderboard) => {
  const list = document.getElementById('spec-leaderboard-list');
  list.innerHTML = '';
  leaderboard.forEach((entry, index) => {
    const div = document.createElement('div');
    div.className = `leaderboard-entry ${entry.isAlive ? 'alive' : 'dead'}`;
    div.innerHTML = `
      <span>${index + 1}. ${entry.name} ${entry.isBot ? '(BOT)' : ''}</span>
      <span>${entry.kills} kills</span>
    `;
    list.appendChild(div);
  });
});

socket.on('roundEnded', (data) => {
  gamePhase = 'ending';
  document.getElementById('hud').classList.add('hidden');
  document.getElementById('spectator').classList.add('hidden');
  document.getElementById('gameOver').classList.remove('hidden');
  document.getElementById('winner-text').textContent = `Winner: ${data.winner}!`;
});

socket.on('gameFull', () => {
  alert('Game is full! You will join as spectator.');
});
