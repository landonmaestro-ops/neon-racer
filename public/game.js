// Wait for DOM to be fully loaded
document.addEventListener('DOMContentLoaded', () => {
  initGame();
});

let socket;
let scene, camera, renderer;
let playerMesh;
let otherPlayers = new Map();
let otherBots = new Map();
let bullets = [];
let gameState = null;
let myId = null;
let weapons = {};
let mapSize = 200;
let gamePhase = 'lobby';
let selectedWeapon = 'assault';
let isInitialized = false;

const keys = {};
let isPointerLocked = false;
const playerSpeed = 0.3;
const jumpSpeed = 0.5;
let velocityY = 0;
const gravity = 0.02;

function initGame() {
  // Initialize socket with error handling
  try {
    socket = io({
      transports: ['websocket', 'polling'],
      timeout: 10000
    });
    
    socket.on('connect_error', (err) => {
      console.log('Connection error:', err);
      showError('Failed to connect to server. Retrying...');
    });
    
    socket.on('connect', () => {
      console.log('Connected to server');
      hideError();
    });
    
    setupSocketListeners();
  } catch (e) {
    console.error('Socket initialization failed:', e);
    showError('Failed to initialize game. Please refresh.');
    return;
  }
  
  initThreeJS();
  setupUI();
}

function showError(msg) {
  let errorDiv = document.getElementById('error-message');
  if (!errorDiv) {
    errorDiv = document.createElement('div');
    errorDiv.id = 'error-message';
    errorDiv.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: #ff6b6b;
      color: white;
      padding: 15px 30px;
      border-radius: 5px;
      z-index: 9999;
      font-weight: bold;
    `;
    document.body.appendChild(errorDiv);
  }
  errorDiv.textContent = msg;
  errorDiv.style.display = 'block';
}

function hideError() {
  const errorDiv = document.getElementById('error-message');
  if (errorDiv) errorDiv.style.display = 'none';
}

function initThreeJS() {
  try {
    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB);
    
    // Camera with proper rotation order to prevent gimbal lock
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.rotation.order = 'YXZ'; // Prevent gimbal lock
    camera.position.set(0, 3, 0);
    
    // Renderer
    const canvas = document.getElementById('gameCanvas');
    if (!canvas) {
      console.error('Canvas not found!');
      return;
    }
    
    renderer = new THREE.WebGLRenderer({ 
      canvas: canvas, 
      antialias: true,
      alpha: false
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Limit pixel ratio for performance
    renderer.setClearColor(0x87CEEB, 1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    
    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(50, 100, 50);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 500;
    dirLight.shadow.camera.left = -100;
    dirLight.shadow.camera.right = 100;
    dirLight.shadow.camera.top = 100;
    dirLight.shadow.camera.bottom = -100;
    scene.add(dirLight);
    
    // Ground
    const groundGeometry = new THREE.PlaneGeometry(mapSize * 2, mapSize * 2);
    const groundMaterial = new THREE.MeshLambertMaterial({ color: 0x3d5c3d });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
    
    // Grid helper
    const grid = new THREE.GridHelper(mapSize * 2, 40, 0x000000, 0x444444);
    grid.material.opacity = 0.2;
    grid.material.transparent = true;
    scene.add(grid);
    
    // Storm visualization
    const stormGeometry = new THREE.RingGeometry(1, 1, 64);
    const stormMaterial = new THREE.MeshBasicMaterial({ 
      color: 0x800080, 
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.3
    });
    const stormMesh = new THREE.Mesh(stormGeometry, stormMaterial);
    stormMesh.rotation.x = -Math.PI / 2;
    stormMesh.position.y = 0.5;
    scene.add(stormMesh);
    window.stormMesh = stormMesh;
    
    // Player mesh (invisible in first person, used for shadows)
    const playerGeometry = new THREE.CapsuleGeometry(1, 4, 4, 8);
    const playerMaterial = new THREE.MeshLambertMaterial({ color: 0x4ecdc4 });
    playerMesh = new THREE.Mesh(playerGeometry, playerMaterial);
    playerMesh.castShadow = true;
    playerMesh.visible = false;
    scene.add(playerMesh);
    
    isInitialized = true;
    animate();
    
  } catch (e) {
    console.error('Three.js initialization failed:', e);
    showError('Failed to initialize 3D graphics. WebGL may not be supported.');
  }
}

function setupUI() {
  // Weapon selection
  document.querySelectorAll('.weapon-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent pointer lock request
      const weapon = btn.dataset.weapon;
      if (!weapon) return;
      
      selectedWeapon = weapon;
      
      // Update UI
      document.querySelectorAll('.weapon-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      
      const weaponNames = {
        assault: 'Assault Rifle',
        machine: 'Machine Gun',
        shotgun: 'Shotgun',
        sniper: 'Sniper Rifle'
      };
      
      const display = document.getElementById('selected-weapon');
      if (display) {
        display.textContent = `Selected: ${weaponNames[weapon]}`;
      }
      
      // Send to server
      if (socket && socket.connected) {
        socket.emit('weaponChange', weapon);
      }
    });
  });
  
  // Keyboard controls
  document.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    
    if (gamePhase === 'playing') {
      if (e.code === 'KeyR') {
        e.preventDefault();
        socket.emit('reload');
      }
      if (e.code === 'Digit1') changeWeapon('assault');
      if (e.code === 'Digit2') changeWeapon('machine');
      if (e.code === 'Digit3') changeWeapon('shotgun');
      if (e.code === 'Digit4') changeWeapon('sniper');
    }
    
    if (e.code === 'Space') {
      e.preventDefault();
      if (playerMesh && playerMesh.position.y <= 2.1) {
        velocityY = jumpSpeed;
      }
    }
  });
  
  document.addEventListener('keyup', (e) => {
    keys[e.code] = false;
  });
  
  // Mouse look
  document.addEventListener('mousemove', (e) => {
    if (!isPointerLocked || !camera) return;
    
    camera.rotation.y -= e.movementX * 0.002;
    camera.rotation.x -= e.movementY * 0.002;
    camera.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, camera.rotation.x));
  });
  
  // Shoot
  document.addEventListener('mousedown', (e) => {
    if (!isPointerLocked || e.button !== 0 || gamePhase !== 'playing') return;
    if (socket && socket.connected) {
      socket.emit('shoot');
    }
  });
  
  // Pointer lock
  document.addEventListener('click', (e) => {
    if (isPointerLocked || gamePhase !== 'playing') return;
    if (e.target.tagName === 'BUTTON' || e.target.closest('button')) return;
    
    document.body.requestPointerLock();
  });
  
  document.addEventListener('pointerlockchange', () => {
    isPointerLocked = document.pointerLockElement === document.body;
    if (!isPointerLocked && gamePhase === 'playing') {
      // Optional: Pause game or show pause menu
    }
  });
  
  // Window resize
  window.addEventListener('resize', () => {
    if (!camera || !renderer) return;
    
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

function changeWeapon(weapon) {
  if (!socket || !socket.connected) return;
  
  const weaponNames = {
    assault: 'Assault Rifle',
    machine: 'Machine Gun',
    shotgun: 'Shotgun',
    sniper: 'Sniper Rifle'
  };
  
  socket.emit('weaponChange', weapon);
  showNotification(weaponNames[weapon]);
}

function showNotification(text) {
  const notif = document.createElement('div');
  notif.style.cssText = `
    position: fixed;
    bottom: 100px;
    right: 30px;
    background: rgba(0,0,0,0.8);
    color: #4ecdc4;
    padding: 10px 20px;
    border-radius: 5px;
    font-weight: bold;
    z-index: 1000;
    animation: fadeIn 0.3s;
    pointer-events: none;
  `;
  notif.textContent = text;
  document.body.appendChild(notif);
  
  setTimeout(() => {
    notif.style.animation = 'fadeOut 0.3s';
    setTimeout(() => notif.remove(), 300);
  }, 1500);
}

function createPlayerMesh(id, color, isBot = false) {
  const group = new THREE.Group();
  
  // Body
  const bodyGeom = new THREE.CapsuleGeometry(1, 3, 4, 8);
  const bodyMat = new THREE.MeshLambertMaterial({ color: color || 0x4ecdc4 });
  const body = new THREE.Mesh(bodyGeom, bodyMat);
  body.position.y = 2;
  body.castShadow = true;
  group.add(body);
  
  // Head
  const headGeom = new THREE.SphereGeometry(0.8, 16, 16);
  const headMat = new THREE.MeshLambertMaterial({ color: 0xffdbac });
  const head = new THREE.Mesh(headGeom, headMat);
  head.position.y = 4.2;
  group.add(head);
  
  // Arms
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
  
  // Legs
  const legGeom = new THREE.CylinderGeometry(0.35, 0.35, 2.5);
  const legMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
  
  const leftLeg = new THREE.Mesh(legGeom, legMat);
  leftLeg.position.set(-0.5, 1.25, 0);
  group.add(leftLeg);
  
  const rightLeg = new THREE.Mesh(legGeom, legMat);
  rightLeg.position.set(0.5, 1.25, 0);
  group.add(rightLeg);
  
  // Name tag for bots
  if (isBot) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = 'white';
    ctx.font = 'bold 24px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(id.split('_')[0] || id, 128, 40);
    
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
  if (!mesh || !data) return;
  
  mesh.position.set(data.x, data.y, data.z);
  mesh.rotation.y = data.rotation;
  
  // Update color based on health
  const body = mesh.children[0];
  if (body && body.material) {
    const healthRatio = Math.max(0, Math.min(1, data.hp / 100));
    body.material.color.setHSL(0.3 * healthRatio, 1, 0.5);
  }
}

function updateLocalPlayer() {
  if (gamePhase !== 'playing' || !camera || !playerMesh) return;
  
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
  
  // Gravity
  velocityY -= gravity;
  camera.position.y += velocityY;
  
  // Ground collision
  if (camera.position.y < 2) {
    camera.position.y = 2;
    velocityY = 0;
  }
  
  // Update player mesh for shadows
  playerMesh.position.copy(camera.position);
  playerMesh.rotation.y = camera.rotation.y;
  
  // Send to server (throttle to 20Hz)
  if (socket && socket.connected && Math.random() < 0.33) { // ~20Hz at 60fps
    socket.emit('move', {
      x: camera.position.x,
      y: camera.position.y,
      z: camera.position.z,
      rotation: camera.rotation.y
    });
  }
}

function updateStorm(stormData) {
  if (!window.stormMesh || !stormData || !camera) return;
  
  const radius = stormData.radius;
  window.stormMesh.scale.set(radius, radius, 1);
  window.stormMesh.position.x = stormData.center.x;
  window.stormMesh.position.z = stormData.center.z;
  
  // Check if player is in storm
  const dx = camera.position.x - stormData.center.x;
  const dz = camera.position.z - stormData.center.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  
  const warning = document.getElementById('storm-warning');
  if (warning) {
    if (dist > radius && gamePhase === 'playing') {
      warning.classList.remove('hidden');
    } else {
      warning.classList.add('hidden');
    }
  }
}

function updateUI(data) {
  if (!data || !data.players) return;
  
  const self = data.players.find(p => p.id === myId);
  if (!self) return;
  
  // Health
  const healthFill = document.getElementById('health-fill');
  const healthText = document.getElementById('health-text');
  if (healthFill) healthFill.style.width = `${Math.max(0, self.hp)}%`;
  if (healthText) healthText.textContent = `${Math.max(0, Math.floor(self.hp))}/100`;
  
  // Ammo
  const currentAmmo = document.getElementById('current-ammo');
  const maxAmmo = document.getElementById('max-ammo');
  if (currentAmmo) currentAmmo.textContent = self.ammo;
  if (maxAmmo) maxAmmo.textContent = self.maxAmmo;
  
  // Reload indicator
  const reloadInd = document.getElementById('reload-indicator');
  if (reloadInd) {
    if (self.reloading) {
      reloadInd.classList.remove('hidden');
    } else {
      reloadInd.classList.add('hidden');
    }
  }
  
  // Weapon name
  const weaponDisplay = document.getElementById('weapon-display');
  if (weaponDisplay) {
    const weaponNames = {
      assault: 'Assault Rifle',
      machine: 'Machine Gun',
      shotgun: 'Shotgun',
      sniper: 'Sniper Rifle'
    };
    weaponDisplay.textContent = weaponNames[self.weapon] || self.weapon;
  }
  
  // Leaderboard
  const lbList = document.getElementById('leaderboard-list');
  if (lbList && data.leaderboard) {
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
}

function animate() {
  requestAnimationFrame(animate);
  
  if (!isInitialized) return;
  
  updateLocalPlayer();
  
  // Render
  if (renderer && scene && camera) {
    renderer.render(scene, camera);
  }
}

function setupSocketListeners() {
  socket.on('init', (data) => {
    myId = data.playerId;
    weapons = data.weapons;
    mapSize = data.mapSize;
    gamePhase = data.gamePhase;
    
    // Show/hide screens
    const lobby = document.getElementById('lobby');
    const hud = document.getElementById('hud');
    
    if (lobby && hud) {
      if (data.gamePhase === 'lobby') {
        lobby.classList.remove('hidden');
        hud.classList.add('hidden');
      } else {
        lobby.classList.add('hidden');
      }
    }
    
    // Send initial weapon
    socket.emit('weaponChange', selectedWeapon);
  });
  
  socket.on('lobbyUpdate', (data) => {
    const playerCount = document.getElementById('playerCount');
    const countdown = document.getElementById('countdown');
    
    if (playerCount) {
      playerCount.textContent = `Players: ${data.players}/${data.maxPlayers}`;
    }
    if (countdown) {
      const seconds = Math.ceil(data.timeUntilStart / 1000);
      countdown.textContent = `Starting in: ${seconds}s`;
    }
  });
  
  socket.on('gameStart', () => {
    gamePhase = 'playing';
    
    const lobby = document.getElementById('lobby');
    const spectator = document.getElementById('spectator');
    const hud = document.getElementById('hud');
    
    if (lobby) lobby.classList.add('hidden');
    if (spectator) spectator.classList.add('hidden');
    if (hud) hud.classList.remove('hidden');
    
    // Reset camera
    if (camera) {
      camera.position.y = 3;
      velocityY = 0;
    }
    
    // Request pointer lock
    setTimeout(() => {
      document.body.requestPointerLock();
    }, 500);
  });
  
  socket.on('gameState', (data) => {
    gameState = data;
    gamePhase = data.gamePhase;
    
    // Update other players
    if (data.players) {
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
        if (mesh) {
          if (p.isAlive) {
            updatePlayerMesh(mesh, p);
            mesh.visible = true;
          } else {
            mesh.visible = false;
          }
        }
      });
    }
    
    // Update bots
    if (data.bots) {
      data.bots.forEach(b => {
        if (!otherBots.has(b.id)) {
          const mesh = createPlayerMesh(b.name || b.id, b.color, true);
          scene.add(mesh);
          otherBots.set(b.id, mesh);
        }
        
        const mesh = otherBots.get(b.id);
        if (mesh) {
          if (b.isAlive) {
            updatePlayerMesh(mesh, b);
            mesh.visible = true;
          } else {
            mesh.visible = false;
          }
        }
      });
    }
    
    // Update storm
    if (data.storm) {
      updateStorm(data.storm);
    }
    
    // Check if dead
    if (data.players) {
      const self = data.players.find(p => p.id === myId);
      if (self && !self.isAlive) {
        document.exitPointerLock();
        const hud = document.getElementById('hud');
        const spectator = document.getElementById('spectator');
        if (hud) hud.classList.add('hidden');
        if (spectator) spectator.classList.remove('hidden');
      }
    }
  });
  
  socket.on('playerKilled', (data) => {
    const feed = document.getElementById('kill-feed');
    if (!feed) return;
    
    const entry = document.createElement('div');
    entry.className = 'kill-entry';
    entry.textContent = `${data.killer} eliminated ${data.victim}`;
    feed.appendChild(entry);
    
    // Remove after 5 seconds
    setTimeout(() => {
      if (entry.parentNode === feed) {
        feed.removeChild(entry);
      }
    }, 5000);
  });
  
  socket.on('spectatorMode', (leaderboard) => {
    const lobby = document.getElementById('lobby');
    const hud = document.getElementById('hud');
    const spectator = document.getElementById('spectator');
    
    if (lobby) lobby.classList.add('hidden');
    if (hud) hud.classList.add('hidden');
    if (spectator) spectator.classList.remove('hidden');
    
    updateSpectatorLeaderboard(leaderboard);
  });
  
  socket.on('spectatorUpdate', (leaderboard) => {
    updateSpectatorLeaderboard(leaderboard);
  });
  
  socket.on('roundEnded', (data) => {
    gamePhase = 'ending';
    
    const hud = document.getElementById('hud');
    const spectator = document.getElementById('spectator');
    const gameOver = document.getElementById('gameOver');
    const winnerText = document.getElementById('winner-text');
    
    if (hud) hud.classList.add('hidden');
    if (spectator) spectator.classList.add('hidden');
    if (gameOver) gameOver.classList.remove('hidden');
    if (winnerText) winnerText.textContent = `Winner: ${data.winner}!`;
    
    // Clean up meshes
    otherPlayers.forEach(mesh => scene.remove(mesh));
    otherPlayers.clear();
    otherBots.forEach(mesh => scene.remove(mesh));
    otherBots.clear();
  });
  
  socket.on('weaponSelected', (weapon) => {
    selectedWeapon = weapon;
  });
  
  socket.on('gameFull', () => {
    alert('Game is full! You will join as spectator.');
  });
  
  socket.on('disconnect', () => {
    showError('Disconnected from server. Please refresh the page.');
  });
}

function updateSpectatorLeaderboard(leaderboard) {
  const list = document.getElementById('spec-leaderboard-list');
  if (!list || !leaderboard) return;
  
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
}
