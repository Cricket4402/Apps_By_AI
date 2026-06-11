const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const timerEl = document.getElementById('timer');
const formulaEl = document.getElementById('formula');
const xValueEl = document.getElementById('x-value');
const fxValueEl = document.getElementById('fx-value');
const healthDisplayEl = document.getElementById('health-display');
const expDisplayEl = document.getElementById('exp-display');
const levelupModal = document.getElementById('levelup-modal');
const upgradeOptionsEl = document.getElementById('upgrade-options');
const gameoverModal = document.getElementById('gameover-modal');
const gameoverStatsEl = document.getElementById('gameover-stats');

const WORLD_MIN = -5000;
const WORLD_MAX = 5000;
const GRID_STEP = 100;
const LABEL_STEP = 50;
const BEAM_LENGTH = 900;
const BEAM_WIDTH = 6;

const keys = { w: false, a: false, s: false, d: false };
let mouseScreen = { x: 0, y: 0 };
let mouseWorld = { x: 0, y: 0 };
let mouseDown = false;

let gameState = 'playing';
let elapsedTime = 0;
let lastTime = 0;

const camera = { x: 0, y: 0 };

const damageFn = { coefficient: 1, exponent: 1, x: 4, hasFY: false, n: 2 };

const player = {
  x: 0,
  y: 0,
  radius: 12,
  speed: 250,
  maxHealth: 100,
  health: 100,
  fireCooldown: 0,
  baseFireRate: 0.25,
  hasBeam: false,
};

let expGainBonus = 0;
let fireRateBonus = 0;

const debug = {
  menuOpen: false,
  freezeAll: false,
  freezeEnemies: false,
  invincible: false,
  spawnOverride: null,
};

function getEffectiveFireRate() {
  return player.baseFireRate / (1 + fireRateBonus / 100);
}

function getXPFromEnemy(enemy) {
  return Math.round(enemy.maxHealth * (1 + expGainBonus / 100));
}

let projectiles = [];
let enemies = [];
let spawnTimer = 0;
let spawnInterval = 1.5;

let level = 1;
let xp = 0;
let xpToNext = 100;

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

function worldToScreen(wx, wy) {
  return {
    x: wx - camera.x + canvas.width / 2,
    y: wy - camera.y + canvas.height / 2,
  };
}

function screenToWorld(sx, sy) {
  return {
    x: sx + camera.x - canvas.width / 2,
    y: sy + camera.y - canvas.height / 2,
  };
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function evalFY() {
  return Math.pow(damageFn.n, damageFn.x);
}

function evalDamage() {
  const base = damageFn.hasFY ? evalFY() : damageFn.x;
  return damageFn.coefficient * Math.pow(base, damageFn.exponent);
}

function formatNumber(value) {
  return Number.isInteger(value) ? value : value.toFixed(2);
}

function formatFormula() {
  const { coefficient, exponent } = damageFn;
  let base = '';
  if (exponent === 1) {
    base = 'x';
  } else {
    const superscripts = { 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
    base = superscripts[exponent] ? `x${superscripts[exponent]}` : `x^${exponent}`;
  }
  if (coefficient === 1) return base;
  return `${coefficient}${base}`;
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function lineCircleCollision(x1, y1, x2, y2, cx, cy, radius, lineWidth) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const dist = Math.sqrt((cx - x1) ** 2 + (cy - y1) ** 2);
    return dist <= radius + lineWidth / 2;
  }
  let t = ((cx - x1) * dx + (cy - y1) * dy) / lenSq;
  t = clamp(t, 0, 1);
  const nearestX = x1 + t * dx;
  const nearestY = y1 + t * dy;
  const dist = Math.sqrt((cx - nearestX) ** 2 + (cy - nearestY) ** 2);
  return dist <= radius + lineWidth / 2;
}

function getBeamEndpoint() {
  const dx = mouseWorld.x - player.x;
  const dy = mouseWorld.y - player.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist === 0) {
    return { x: player.x + BEAM_LENGTH, y: player.y };
  }
  return {
    x: player.x + (dx / dist) * BEAM_LENGTH,
    y: player.y + (dy / dist) * BEAM_LENGTH,
  };
}

function circleCollision(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  return dist < a.radius + b.radius;
}

function getViewportBounds() {
  const halfW = canvas.width / 2;
  const halfH = canvas.height / 2;
  return {
    left: camera.x - halfW,
    right: camera.x + halfW,
    top: camera.y - halfH,
    bottom: camera.y + halfH,
  };
}

function drawGraph() {
  const vp = getViewportBounds();

  ctx.fillStyle = '#F5F5F0';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const startX = Math.max(WORLD_MIN, Math.floor(vp.left / GRID_STEP) * GRID_STEP);
  const endX = Math.min(WORLD_MAX, Math.ceil(vp.right / GRID_STEP) * GRID_STEP);
  const startY = Math.max(WORLD_MIN, Math.floor(vp.top / GRID_STEP) * GRID_STEP);
  const endY = Math.min(WORLD_MAX, Math.ceil(vp.bottom / GRID_STEP) * GRID_STEP);

  ctx.strokeStyle = '#B8B8B0';
  ctx.lineWidth = 1;

  for (let wx = startX; wx <= endX; wx += GRID_STEP) {
    if (wx === 0) continue;
    const top = worldToScreen(wx, vp.top);
    const bottom = worldToScreen(wx, vp.bottom);
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    ctx.lineTo(bottom.x, bottom.y);
    ctx.stroke();
  }

  for (let wy = startY; wy <= endY; wy += GRID_STEP) {
    if (wy === 0) continue;
    const left = worldToScreen(vp.left, wy);
    const right = worldToScreen(vp.right, wy);
    ctx.beginPath();
    ctx.moveTo(left.x, left.y);
    ctx.lineTo(right.x, right.y);
    ctx.stroke();
  }

  if (0 >= startX && 0 <= endX) {
    ctx.strokeStyle = '#888888';
    ctx.lineWidth = 2;
    const top = worldToScreen(0, vp.top);
    const bottom = worldToScreen(0, vp.bottom);
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    ctx.lineTo(bottom.x, bottom.y);
    ctx.stroke();
  }

  if (0 >= startY && 0 <= endY) {
    ctx.strokeStyle = '#888888';
    ctx.lineWidth = 2;
    const left = worldToScreen(vp.left, 0);
    const right = worldToScreen(vp.right, 0);
    ctx.beginPath();
    ctx.moveTo(left.x, left.y);
    ctx.lineTo(right.x, right.y);
    ctx.stroke();
  }

  ctx.fillStyle = '#888';
  ctx.font = '11px Segoe UI, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  const labelStartX = Math.max(WORLD_MIN, Math.floor(vp.left / LABEL_STEP) * LABEL_STEP);
  const labelEndX = Math.min(WORLD_MAX, Math.ceil(vp.right / LABEL_STEP) * LABEL_STEP);
  for (let wx = labelStartX; wx <= labelEndX; wx += LABEL_STEP) {
    if (wx === 0) continue;
    const pos = worldToScreen(wx, 0);
    if (pos.x >= 0 && pos.x <= canvas.width) {
      ctx.fillText(String(wx), pos.x, pos.y + 4);
    }
  }

  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const labelStartY = Math.max(WORLD_MIN, Math.floor(vp.top / LABEL_STEP) * LABEL_STEP);
  const labelEndY = Math.min(WORLD_MAX, Math.ceil(vp.bottom / LABEL_STEP) * LABEL_STEP);
  for (let wy = labelStartY; wy <= labelEndY; wy += LABEL_STEP) {
    if (wy === 0) continue;
    const pos = worldToScreen(0, wy);
    if (pos.y >= 0 && pos.y <= canvas.height) {
      ctx.fillText(String(wy), pos.x - 6, pos.y);
    }
  }
}

function drawHealthBar(screenX, screenY, entityRadius, health, maxHealth, showMax, xp, xpToNextLevel) {
  const barWidth = 50;
  const barHeight = 8;
  const barX = screenX - barWidth / 2;
  const barY = screenY - entityRadius - 22;
  const pct = clamp(health / maxHealth, 0, 1);

  ctx.fillStyle = '#333';
  ctx.fillRect(barX, barY, barWidth, barHeight);

  const r = Math.round(255 * (1 - pct));
  const g = Math.round(200 * pct);
  ctx.fillStyle = `rgb(${r}, ${g}, 60)`;
  ctx.fillRect(barX, barY, barWidth * pct, barHeight);

  ctx.strokeStyle = '#555';
  ctx.lineWidth = 1;
  ctx.strokeRect(barX, barY, barWidth, barHeight);

  ctx.fillStyle = '#222';
  ctx.font = '12px Segoe UI, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  const label = showMax ? `${Math.ceil(health)} / ${maxHealth}` : `${Math.ceil(health)}`;
  ctx.fillText(label, screenX, barY - 2);

  if (showMax && xpToNextLevel !== undefined) {
    const expBarHeight = 4;
    const expBarY = barY + barHeight + 3;
    const expPct = clamp(xp / xpToNextLevel, 0, 1);

    ctx.fillStyle = '#333';
    ctx.fillRect(barX, expBarY, barWidth, expBarHeight);
    ctx.fillStyle = '#9333EA';
    ctx.fillRect(barX, expBarY, barWidth * expPct, expBarHeight);
    ctx.strokeStyle = '#555';
    ctx.strokeRect(barX, expBarY, barWidth, expBarHeight);
  }
}

function drawPlayer() {
  const pos = worldToScreen(player.x, player.y);

  ctx.beginPath();
  ctx.arc(pos.x, pos.y, player.radius, 0, Math.PI * 2);
  ctx.fillStyle = '#2563EB';
  ctx.fill();
  ctx.strokeStyle = '#1E40AF';
  ctx.lineWidth = 2;
  ctx.stroke();

  drawHealthBar(pos.x, pos.y, player.radius, player.health, player.maxHealth, true, xp, xpToNext);
}

function drawBeam() {
  if (!player.hasBeam || !mouseDown || gameState !== 'playing') return;

  const start = worldToScreen(player.x, player.y);
  const endWorld = getBeamEndpoint();
  const end = worldToScreen(endWorld.x, endWorld.y);

  ctx.strokeStyle = 'rgba(245, 158, 11, 0.85)';
  ctx.lineWidth = BEAM_WIDTH;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
}

function drawEnemies() {
  for (const enemy of enemies) {
    const pos = worldToScreen(enemy.x, enemy.y);

    ctx.beginPath();
    ctx.arc(pos.x, pos.y, enemy.radius, 0, Math.PI * 2);
    ctx.fillStyle = '#DC2626';
    ctx.fill();
    ctx.strokeStyle = '#991B1B';
    ctx.lineWidth = 2;
    ctx.stroke();

    drawHealthBar(pos.x, pos.y, enemy.radius, enemy.health, enemy.maxHealth, false);
  }
}

function drawProjectiles() {
  for (const p of projectiles) {
    const pos = worldToScreen(p.x, p.y);
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, p.radius, 0, Math.PI * 2);
    ctx.fillStyle = '#F59E0B';
    ctx.fill();
  }
}

function updateHUD() {
  timerEl.textContent = formatTime(elapsedTime);
  if (damageFn.hasFY) {
    formulaEl.textContent = `f(x) = f(y) = ${damageFn.n}^x`;
    xValueEl.textContent = `f(y) = ${formatNumber(evalFY())}`;
  } else {
    formulaEl.textContent = `f(x) = ${formatFormula()}`;
    xValueEl.textContent = `x = ${damageFn.x}`;
  }
  fxValueEl.textContent = `f(x) = ${formatNumber(evalDamage())}`;
  healthDisplayEl.textContent = `HP: ${Math.ceil(player.health)} / ${player.maxHealth}`;
  expDisplayEl.textContent = `EXP: ${xp} / ${xpToNext}`;
}

function shoot() {
  if (player.hasBeam) return;
  if (player.fireCooldown > 0) return;

  const dx = mouseWorld.x - player.x;
  const dy = mouseWorld.y - player.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist === 0) return;

  const speed = 500;
  projectiles.push({
    x: player.x,
    y: player.y,
    vx: (dx / dist) * speed,
    vy: (dy / dist) * speed,
    radius: 5,
    lifetime: 2,
  });

  player.fireCooldown = getEffectiveFireRate();
}

function getEnemyHealth() {
  const minute = Math.floor(elapsedTime / 60);
  return Math.max(1, Math.round(20 * Math.pow(1.4, minute)));
}

function spawnEnemy() {
  if (enemies.length >= 15) return;

  const edge = randomInt(0, 3);
  let sx, sy;

  switch (edge) {
    case 0:
      sx = randomInt(0, canvas.width);
      sy = 0;
      break;
    case 1:
      sx = canvas.width;
      sy = randomInt(0, canvas.height);
      break;
    case 2:
      sx = randomInt(0, canvas.width);
      sy = canvas.height;
      break;
    default:
      sx = 0;
      sy = randomInt(0, canvas.height);
  }

  const world = screenToWorld(sx, sy);
  const health = getEnemyHealth();

  enemies.push({
    x: clamp(world.x, WORLD_MIN, WORLD_MAX),
    y: clamp(world.y, WORLD_MIN, WORLD_MAX),
    radius: 14,
    speed: 120,
    health,
    maxHealth: health,
  });
}

function awardXP(amount) {
  xp += amount;
  while (xp >= xpToNext) {
    xp -= xpToNext;
    level++;
    xpToNext = level * 100;
    showLevelUp();
  }
}

function killEnemy(index) {
  const enemy = enemies[index];
  awardXP(getXPFromEnemy(enemy));
  enemies.splice(index, 1);
}

const BEAM_UPGRADE = {
  id: 'beam',
  special: true,
  label: () => 'Beam Weapon — continuous f(x) DPS',
  apply: () => {
    player.hasBeam = true;
  },
};

const UPGRADE_TYPES = [
  {
    id: 'maxHealth',
    label: () => 'Max Health +25',
    apply: () => {
      player.maxHealth += 25;
      player.health += 25;
    },
  },
  {
    id: 'speed',
    label: () => 'Movement Speed +15%',
    apply: () => {
      player.speed *= 1.15;
    },
  },
  {
    id: 'xFlat',
    label: () => 'x + ?',
    apply: (data) => {
      damageFn.x += data.amount;
    },
  },
  {
    id: 'coefficient',
    label: () => `Coefficient +1 (now ${damageFn.coefficient + 1}x)`,
    apply: () => {
      damageFn.coefficient += 1;
    },
  },
  {
    id: 'exponent',
    label: () => {
      const next = damageFn.exponent + 1;
      const superscripts = { 2: '²', 3: '³', 4: '⁴', 5: '⁵' };
      const expStr = superscripts[next] ? `x${superscripts[next]}` : `x^${next}`;
      return `Exponent +1 (now ${expStr})`;
    },
    apply: () => {
      damageFn.exponent += 1;
    },
  },
  {
    id: 'expGain',
    label: () => 'EXP Gain +20%',
    apply: () => {
      expGainBonus += 20;
    },
  },
  {
    id: 'fireRate',
    label: () => 'Fire Rate +15%',
    apply: () => {
      fireRateBonus += 15;
    },
  },
  {
    id: 'unlockFY',
    gold: true,
    label: () => 'Unlock f(y) — f(x) = f(y), f(y) = n^x',
    apply: () => {
      damageFn.hasFY = true;
      damageFn.n = 2;
    },
  },
  {
    id: 'increaseN',
    label: () => `Increase n +1 (now ${damageFn.n + 1})`,
    apply: () => {
      damageFn.n += 1;
    },
  },
];

function getUpgradePool() {
  return UPGRADE_TYPES.filter((upgrade) => {
    if (upgrade.id === 'unlockFY' && damageFn.hasFY) return false;
    if (upgrade.id === 'increaseN' && !damageFn.hasFY) return false;
    return true;
  });
}

function pickUpgrades(count, pool = getUpgradePool()) {
  const available = [...pool];
  const picks = [];
  for (let i = 0; i < count && available.length > 0; i++) {
    const idx = randomInt(0, available.length - 1);
    picks.push(available.splice(idx, 1)[0]);
  }
  return picks;
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(0, i);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function showLevelUp() {
  gameState = 'levelup';
  let upgrades;

  if (level === 5 && !player.hasBeam) {
    upgrades = pickUpgrades(2, getUpgradePool());
    upgrades.push(BEAM_UPGRADE);
    shuffleArray(upgrades);
  } else {
    upgrades = pickUpgrades(3);
  }

  upgradeOptionsEl.innerHTML = '';

  for (const upgrade of upgrades) {
    const btn = document.createElement('button');
    let btnClass = 'upgrade-btn';
    if (upgrade.special) btnClass += ' special';
    else if (upgrade.gold) btnClass += ' gold';
    btn.className = btnClass;
    let extraData = null;

    if (upgrade.id === 'xFlat') {
      const amount = randomInt(2, 5);
      btn.textContent = `x + ${amount}`;
      extraData = { amount };
    } else {
      btn.textContent = upgrade.label();
    }

    btn.addEventListener('click', () => {
      upgrade.apply(extraData);
      levelupModal.classList.add('hidden');
      gameState = 'playing';
    });
    upgradeOptionsEl.appendChild(btn);
  }

  levelupModal.classList.remove('hidden');
}

function updatePlayer(dt) {
  let dx = 0;
  let dy = 0;
  if (keys.w) dy -= 1;
  if (keys.s) dy += 1;
  if (keys.a) dx -= 1;
  if (keys.d) dx += 1;

  if (dx !== 0 || dy !== 0) {
    const len = Math.sqrt(dx * dx + dy * dy);
    dx /= len;
    dy /= len;
    player.x += dx * player.speed * dt;
    player.y += dy * player.speed * dt;
  }

  player.x = clamp(player.x, WORLD_MIN, WORLD_MAX);
  player.y = clamp(player.y, WORLD_MIN, WORLD_MAX);

  if (player.fireCooldown > 0) {
    player.fireCooldown -= dt;
  }

  if (mouseDown) {
    shoot();
  }
}

function updateBeam(dt) {
  if (!player.hasBeam || !mouseDown) return;

  const end = getBeamEndpoint();
  const dps = evalDamage();

  for (let i = enemies.length - 1; i >= 0; i--) {
    const enemy = enemies[i];
    if (lineCircleCollision(player.x, player.y, end.x, end.y, enemy.x, enemy.y, enemy.radius, BEAM_WIDTH)) {
      enemy.health -= dps * dt;
      if (enemy.health <= 0) {
        killEnemy(i);
      }
    }
  }
}

function updateProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.lifetime -= dt;

    if (
      p.lifetime <= 0 ||
      p.x < WORLD_MIN || p.x > WORLD_MAX ||
      p.y < WORLD_MIN || p.y > WORLD_MAX
    ) {
      projectiles.splice(i, 1);
      continue;
    }

    for (let j = enemies.length - 1; j >= 0; j--) {
      if (circleCollision(p, enemies[j])) {
        const dmg = Math.round(evalDamage());
        enemies[j].health -= dmg;
        projectiles.splice(i, 1);

        if (enemies[j].health <= 0) {
          killEnemy(j);
        }
        break;
      }
    }
  }
}

function updateEnemies(dt) {
  for (const enemy of enemies) {
    const dx = player.x - enemy.x;
    const dy = player.y - enemy.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 0) {
      enemy.x += (dx / dist) * enemy.speed * dt;
      enemy.y += (dy / dist) * enemy.speed * dt;
    }

    if (circleCollision(player, enemy) && !debug.invincible) {
      player.health -= 10 * dt;
    }
  }

  if (player.health <= 0) {
    player.health = 0;
    gameState = 'gameover';
    gameoverStatsEl.textContent = `Time: ${formatTime(elapsedTime)} | Level: ${level}`;
    gameoverModal.classList.remove('hidden');
  }
}

function updateSpawner(dt) {
  spawnTimer += dt;
  const interval = debug.spawnOverride !== null ? debug.spawnOverride : spawnInterval;
  if (spawnTimer >= interval) {
    spawnTimer = 0;
    spawnEnemy();
    if (debug.spawnOverride === null) {
      spawnInterval = Math.max(0.6, 1.5 - elapsedTime * 0.005);
    }
  }
}

function update(dt) {
  mouseWorld = screenToWorld(mouseScreen.x, mouseScreen.y);
  camera.x = player.x;
  camera.y = player.y;

  if (debug.freezeAll) {
    return;
  }

  updatePlayer(dt);
  updateBeam(dt);
  updateProjectiles(dt);

  if (!debug.freezeEnemies) {
    updateEnemies(dt);
    updateSpawner(dt);
  }

  elapsedTime += dt;
}

function render() {
  drawGraph();
  drawEnemies();
  drawProjectiles();
  drawBeam();
  drawPlayer();
  updateHUD();
}

function loop(timestamp) {
  const dt = Math.min((timestamp - lastTime) / 1000, 0.05);
  lastTime = timestamp;

  if (gameState === 'playing') {
    update(dt);
  }

  render();
  requestAnimationFrame(loop);
}

function resetGame() {
  gameState = 'playing';
  elapsedTime = 0;
  lastTime = performance.now();

  damageFn.coefficient = 1;
  damageFn.exponent = 1;
  damageFn.x = 4;
  damageFn.hasFY = false;
  damageFn.n = 2;

  expGainBonus = 0;
  fireRateBonus = 0;

  player.x = 0;
  player.y = 0;
  player.speed = 250;
  player.maxHealth = 100;
  player.health = 100;
  player.fireCooldown = 0;
  player.baseFireRate = 0.25;
  player.hasBeam = false;

  debug.freezeAll = false;
  debug.freezeEnemies = false;
  debug.invincible = false;
  debug.spawnOverride = null;
  syncDebugUI();

  projectiles = [];
  enemies = [];
  spawnTimer = 0;
  spawnInterval = 1.5;

  level = 1;
  xp = 0;
  xpToNext = 100;

  camera.x = 0;
  camera.y = 0;

  levelupModal.classList.add('hidden');
  gameoverModal.classList.add('hidden');
}

window.addEventListener('resize', resizeCanvas);

window.addEventListener('keydown', (e) => {
  if (e.key === '=' && !(e.target instanceof HTMLInputElement)) {
    toggleDebugMenu();
    return;
  }

  const key = e.key.toLowerCase();
  if (key === 'w') keys.w = true;
  if (key === 'a') keys.a = true;
  if (key === 's') keys.s = true;
  if (key === 'd') keys.d = true;

  if (key === 'r' && gameState === 'gameover') {
    resetGame();
  }
});

window.addEventListener('keyup', (e) => {
  const key = e.key.toLowerCase();
  if (key === 'w') keys.w = false;
  if (key === 'a') keys.a = false;
  if (key === 's') keys.s = false;
  if (key === 'd') keys.d = false;
});

canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  mouseScreen.x = e.clientX - rect.left;
  mouseScreen.y = e.clientY - rect.top;
});

canvas.addEventListener('mousedown', (e) => {
  if (e.button === 0 && gameState === 'playing') {
    mouseDown = true;
    shoot();
  }
});

canvas.addEventListener('mouseup', (e) => {
  if (e.button === 0) mouseDown = false;
});

canvas.addEventListener('mouseleave', () => {
  mouseDown = false;
});

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

const debugPanel = document.getElementById('debug-panel');
const debugCloseBtn = document.getElementById('debug-close');
const debugFreezeAll = document.getElementById('debug-freeze-all');
const debugFreezeEnemies = document.getElementById('debug-freeze-enemies');
const debugInvincible = document.getElementById('debug-invincible');
const debugSpawnRate = document.getElementById('debug-spawn-rate');
const debugApplySpawn = document.getElementById('debug-apply-spawn');
const debugHealth = document.getElementById('debug-health');
const debugMaxHealth = document.getElementById('debug-max-health');
const debugSpeed = document.getElementById('debug-speed');
const debugX = document.getElementById('debug-x');
const debugCoefficient = document.getElementById('debug-coefficient');
const debugExponent = document.getElementById('debug-exponent');
const debugFireRate = document.getElementById('debug-fire-rate');
const debugApplyStats = document.getElementById('debug-apply-stats');

function syncDebugUI() {
  debugFreezeAll.checked = debug.freezeAll;
  debugFreezeEnemies.checked = debug.freezeEnemies;
  debugInvincible.checked = debug.invincible;
  debugSpawnRate.value = debug.spawnOverride !== null ? debug.spawnOverride : spawnInterval;
  debugHealth.value = Math.ceil(player.health);
  debugMaxHealth.value = player.maxHealth;
  debugSpeed.value = Math.round(player.speed);
  debugX.value = damageFn.x;
  debugCoefficient.value = damageFn.coefficient;
  debugExponent.value = damageFn.exponent;
  debugFireRate.value = player.baseFireRate;
}

function toggleDebugMenu() {
  debug.menuOpen = !debug.menuOpen;
  debugPanel.classList.toggle('hidden', !debug.menuOpen);
  if (debug.menuOpen) {
    syncDebugUI();
  }
}

debugCloseBtn.addEventListener('click', toggleDebugMenu);

debugFreezeAll.addEventListener('change', () => {
  debug.freezeAll = debugFreezeAll.checked;
});

debugFreezeEnemies.addEventListener('change', () => {
  debug.freezeEnemies = debugFreezeEnemies.checked;
});

debugInvincible.addEventListener('change', () => {
  debug.invincible = debugInvincible.checked;
});

debugApplySpawn.addEventListener('click', () => {
  const val = parseFloat(debugSpawnRate.value);
  if (!Number.isNaN(val) && val > 0) {
    debug.spawnOverride = val;
    spawnTimer = 0;
  }
});

debugApplyStats.addEventListener('click', () => {
  const health = parseFloat(debugHealth.value);
  const maxHealth = parseFloat(debugMaxHealth.value);
  const speed = parseFloat(debugSpeed.value);
  const xVal = parseFloat(debugX.value);
  const coefficient = parseFloat(debugCoefficient.value);
  const exponent = parseFloat(debugExponent.value);
  const fireRate = parseFloat(debugFireRate.value);

  if (!Number.isNaN(maxHealth) && maxHealth > 0) player.maxHealth = maxHealth;
  if (!Number.isNaN(health) && health > 0) player.health = Math.min(health, player.maxHealth);
  if (!Number.isNaN(speed) && speed > 0) player.speed = speed;
  if (!Number.isNaN(xVal) && xVal > 0) damageFn.x = xVal;
  if (!Number.isNaN(coefficient) && coefficient > 0) damageFn.coefficient = coefficient;
  if (!Number.isNaN(exponent) && exponent > 0) damageFn.exponent = exponent;
  if (!Number.isNaN(fireRate) && fireRate > 0) player.baseFireRate = fireRate;
});

resizeCanvas();
resetGame();
requestAnimationFrame(loop);
