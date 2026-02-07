/**
 * Enemy behavior table.
 *
 * Each mob selects one of these behaviors via its `ai` field in MobRegistry.
 * The behaviors themselves are stateless steering functions — they read/write
 * only ephemeral state on the enemy object and never touch global state.
 *
 * Many behaviors rely on `_baseVel`, `_aiTime`, etc., which are transient
 * fields stamped at spawn or initialized lazily during movement.
 */

import { resolveMobConfig } from './MobRegistry.js';
import { EnemyProjectileWeaponController } from '../weapons/controllers/enemy/EnemyProjectileWeaponController.js';

/**
 * Ensures that every enemy has a stable "base velocity" to reference.
 * This is key for patterns like flyStraight/flySine which must maintain
 * direction independent of per-frame input.
 */
function ensureBaseVelocity(enemy) {
  // If the enemy is missing or has a precomputed base velocity, return it.
  if (!enemy) return { x: 0, y: 0 };
  if (enemy._baseVel && (Number.isFinite(enemy._baseVel.x) || Number.isFinite(enemy._baseVel.y))) {
    return enemy._baseVel;
  }

  // Otherwise, derive it from current body velocity (first frame of movement).
  const bodyVel = enemy.body?.velocity;
  const baseVel = {
    x: Number.isFinite(bodyVel?.x) ? bodyVel.x : 0,
    y: Number.isFinite(bodyVel?.y) ? bodyVel.y : 0,
  };

  // Cache it for the remainder of the enemy's life.
  enemy._baseVel = baseVel;
  return baseVel;
}

/**
 * Cleanly returns an enemy to its pool if it leaves the camera view by a margin.
 * Used primarily for formations and projectiles that travel off-screen.
 */
function releaseIfOffscreen(enemy, scene, margin = 64) {
  if (!enemy?.active || !scene) return false;

  const mapRuntime = scene.mapRuntime;
  // Bounded maps use world bounds instead of camera view for despawn logic.
  if (mapRuntime?.isBounded?.()) {
    const bounds = mapRuntime.getWorldBounds?.();
    if (!bounds) return false;
    const expand = Number.isFinite(enemy._waveMargin) ? enemy._waveMargin : margin;
    const left = bounds.left - expand;
    const right = bounds.right + expand;
    const top = bounds.top - expand;
    const bottom = bounds.bottom + expand;
    if (enemy.x < left || enemy.x > right || enemy.y < top || enemy.y > bottom) {
      scene.enemyPools?.release?.(enemy);
      return true;
    }
    return false;
  }

  const camera = scene.cameras?.main;
  const view = camera?.worldView;
  if (!view) return false;

  // Allow a wider despawn margin if explicitly configured.
  const expand = Number.isFinite(enemy._waveMargin) ? enemy._waveMargin : margin;

  // Expanded bounds check.
  const left = view.x - expand;
  const right = view.x + view.width + expand;
  const top = view.y - expand;
  const bottom = view.y + view.height + expand;

  // If enemy has traveled beyond the allowable pad, despawn it via pool release.
  if (enemy.x < left || enemy.x > right || enemy.y < top || enemy.y > bottom) {
    scene.enemyPools?.release?.(enemy);
    return true;
  }
  return false;
}



function resolveEnemyAiParams(enemy) {
  const mobConfig = resolveMobConfig(enemy?.mobKey);
  return {
    ...(mobConfig?.aiParams ?? {}),
    ...(enemy?.aiParams ?? {}),
  };
}

function resolveEnemyBodySize(enemy) {
  const body = enemy?.body;
  const bodyWidth = Number.isFinite(body?.width) ? body.width : Number(enemy?.width) || 0;
  const bodyHeight = Number.isFinite(body?.height) ? body.height : Number(enemy?.height) || 0;
  return Math.max(bodyWidth, bodyHeight);
}

export function resolveBoundedNavPair(scene, enemy, { sizeThreshold = 28 } = {}) {
  if (!scene?.mapRuntime?.isBounded?.()) return { nav: null, flow: null, sizeClass: 'none' };

  const size = resolveEnemyBodySize(enemy);
  const wantsBig = Number.isFinite(size) && size >= sizeThreshold;
  const navSmall = scene?.navGridSmall ?? scene?.navGrid ?? null;
  const flowSmall = scene?.flowFieldSmall ?? scene?.flowField ?? null;
  const navBig = scene?.navGridBig ?? null;
  const flowBig = scene?.flowFieldBig ?? null;

  if (wantsBig && navBig && flowBig) {
    return { nav: navBig, flow: flowBig, sizeClass: 'big' };
  }

  if (navSmall && flowSmall) {
    return { nav: navSmall, flow: flowSmall, sizeClass: 'small' };
  }

  if (navBig && flowBig) {
    return { nav: navBig, flow: flowBig, sizeClass: 'big' };
  }

  return { nav: null, flow: null, sizeClass: 'none' };
}

function isBoundedNavReady(scene, enemy) {
  const { nav, flow } = resolveBoundedNavPair(scene, enemy);
  return Boolean(nav && flow);
}

function isClearLineOfSightTiles(navGrid, x0, y0, x1, y1) {
  let dx = Math.abs(x1 - x0);
  let dy = Math.abs(y1 - y0);
  let sx = x0 < x1 ? 1 : -1;
  let sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  let x = x0;
  let y = y0;

  if (!navGrid.inBounds(x, y) || !navGrid.isWalkable(x, y)) return false;

  while (!(x === x1 && y === y1)) {
    const e2 = err * 2;

    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }

    if (!navGrid.inBounds(x, y) || !navGrid.isWalkable(x, y)) return false;
  }

  return true;
}

function updateBoundedLosCache(enemy, scene, nav, fromTile, toTile) {
  const now = scene?.time?.now ?? 0;
  const losState = enemy._ffLos ?? (enemy._ffLos = { nextAt: 0, clear: false, lastPTx: null, lastPTy: null });

  if (now >= losState.nextAt || losState.lastPTx !== toTile.tx || losState.lastPTy !== toTile.ty) {
    losState.nextAt = now + 250 + (enemy._ffLosJitter ?? (enemy._ffLosJitter = ((enemy._id ?? 0) * 13) % 120));
    losState.lastPTx = toTile.tx;
    losState.lastPTy = toTile.ty;
    losState.clear = isClearLineOfSightTiles(nav, fromTile.tx, fromTile.ty, toTile.tx, toTile.ty);
  }

  return losState.clear;
}

function steerToWorldPointBounded(enemy, scene, targetX, targetY, opts = {}) {
  const { nav, flow } = resolveBoundedNavPair(scene, enemy);

  if (!isBoundedNavReady(scene, enemy) || !enemy || !Number.isFinite(targetX) || !Number.isFinite(targetY)) {
    return false;
  }

  const speed = Number.isFinite(opts.speed) ? Number(opts.speed) : Number(enemy.speed || 60);
  const stopDist = Number.isFinite(opts.stopDist) ? Number(opts.stopDist) : 6;
  const directSight = opts.directSight !== false;

  const body = enemy.body;

  // Use physics body center for nav sampling / movement math.
  const ex = body?.center?.x ?? enemy.x;
  const ey = body?.center?.y ?? enemy.y;

  const eTile = nav.worldToTile(ex, ey);
  const tTile = nav.worldToTile(targetX, targetY);

  // If enemy is standing in a nav-blocked cell, immediately escape to nearest walkable.
  if (nav.inBounds(eTile.tx, eTile.ty) && !nav.isWalkable(eTile.tx, eTile.ty)) {
    const esc = nav.findNearestWalkableTile(eTile.tx, eTile.ty, 6);
    if (esc) {
      const wp = nav.tileToWorldCenter(esc.tx, esc.ty);
      const dx = wp.x - ex;
      const dy = wp.y - ey;
      const d = Math.hypot(dx, dy) || 1;

      enemy.setVelocity((dx / d) * speed, (dy / d) * speed);
      enemy.setFlipX(dx < 0);
      return true;
    }

    enemy.setVelocity(0, 0);
    return true;
  }

  if (!nav.inBounds(eTile.tx, eTile.ty)) {
    enemy.setVelocity(0, 0);
    return true;
  }

  const toTargetX = targetX - ex;
  const toTargetY = targetY - ey;
  const directDist = Math.hypot(toTargetX, toTargetY) || 1;

  // Only true hard stop.
  if (directDist <= stopDist) {
    enemy.setVelocity(0, 0);
    return true;
  }

  // Direct LOS chase if allowed.
  if (
    directSight &&
    nav.inBounds(tTile.tx, tTile.ty) &&
    updateBoundedLosCache(enemy, scene, nav, eTile, tTile)
  ) {
    let vx = (toTargetX / directDist) * speed;
    let vy = (toTargetY / directDist) * speed;

    if (body?.blocked) {
      if (vx < 0 && body.blocked.left) vx = 0;
      if (vx > 0 && body.blocked.right) vx = 0;
      if (vy < 0 && body.blocked.up) vy = 0;
      if (vy > 0 && body.blocked.down) vy = 0;
    }

    if (vx !== 0 || vy !== 0) {
      enemy.setVelocity(vx, vy);
      enemy.setFlipX(vx < 0);
      return true;
    }
  }

  const i = nav.idx(eTile.tx, eTile.ty);
  let d = flow?.dir?.[i] ?? 0;

  const dirToStep = (dir) => {
    if (dir === 1) return { dx: 0, dy: -1 };
    if (dir === 2) return { dx: 1, dy: 0 };
    if (dir === 3) return { dx: 0, dy: 1 };
    if (dir === 4) return { dx: -1, dy: 0 };
    if (dir === 5) return { dx: 1, dy: -1 };
    if (dir === 6) return { dx: 1, dy: 1 };
    if (dir === 7) return { dx: -1, dy: 1 };
    if (dir === 8) return { dx: -1, dy: -1 };
    return { dx: 0, dy: 0 };
  };

  const pickBestNeighborDir = (preferCardinals = false) => {
    const distArr = flow?.dist;
    if (!distArr) return 0;

    const here = distArr[i];
    if (here < 0) return 0;

    let bestDir = 0;
    let bestDist = here;

    const tx = eTile.tx;
    const ty = eTile.ty;

    const consider = (nx, ny, dirCode) => {
      if (!nav.inBounds(nx, ny) || !nav.isWalkable(nx, ny)) return;
      const ni = nav.idx(nx, ny);
      const nd = distArr[ni];
      if (nd >= 0 && nd < bestDist) {
        bestDist = nd;
        bestDir = dirCode;
      }
    };

    consider(tx, ty - 1, 1);
    consider(tx + 1, ty, 2);
    consider(tx, ty + 1, 3);
    consider(tx - 1, ty, 4);

    if (!preferCardinals) {
      consider(tx + 1, ty - 1, 5);
      consider(tx + 1, ty + 1, 6);
      consider(tx - 1, ty + 1, 7);
      consider(tx - 1, ty - 1, 8);
    }

    return bestDir;
  };

  if (!d) {
    d = pickBestNeighborDir(false);
    if (!d) {
      enemy.setVelocity(0, 0);
      return true;
    }
  }

  let step = dirToStep(d);
  let nextTx = eTile.tx + step.dx;
  let nextTy = eTile.ty + step.dy;

  if (!nav.inBounds(nextTx, nextTy) || !nav.isWalkable(nextTx, nextTy)) {
    const best = pickBestNeighborDir(true) || pickBestNeighborDir(false);
    if (!best) {
      enemy.setVelocity(0, 0);
      return true;
    }
    step = dirToStep(best);
  }

  const mag = Math.hypot(step.dx, step.dy) || 1;
  let vx = (step.dx / mag) * speed;
  let vy = (step.dy / mag) * speed;

  if (body?.blocked) {
    if (vx < 0 && body.blocked.left) vx = 0;
    if (vx > 0 && body.blocked.right) vx = 0;
    if (vy < 0 && body.blocked.up) vy = 0;
    if (vy > 0 && body.blocked.down) vy = 0;
  }

  if (vx === 0 && vy === 0) {
    const bl = body?.blocked;

    const tryCard = (dx, dy, blocked) => {
      if (blocked) return null;
      const nx = eTile.tx + dx;
      const ny = eTile.ty + dy;
      if (!nav.inBounds(nx, ny) || !nav.isWalkable(nx, ny)) return null;
      return { dx, dy };
    };

    const s =
      tryCard(0, -1, bl?.up) ||
      tryCard(1, 0, bl?.right) ||
      tryCard(0, 1, bl?.down) ||
      tryCard(-1, 0, bl?.left);

    if (s) {
      vx = s.dx * speed;
      vy = s.dy * speed;
    }
  }

  if (vx === 0 && vy === 0) {
    enemy.setVelocity(0, 0);
    return true;
  }

  enemy.setVelocity(vx, vy);
  enemy.setFlipX(vx < 0);
  return true;
}

function steerToPlayerBounded(enemy, player, scene, opts = {}) {
  if (!enemy || !player) return false;
  return steerToWorldPointBounded(enemy, scene, player.x, player.y, opts);
}


/**
 * Behavior dispatcher: each entry is a function applied once per frame to
 * all active enemies in EnemyBehaviorSystem.update().
 */
export const ENEMY_BEHAVIORS = {

    seekPlayerBoundedFlow: (enemy, player, scene, dt = 0) => {
    if (!isBoundedNavReady(scene, enemy)) {
      return ENEMY_BEHAVIORS.seekPlayer(enemy, player, scene, dt);
    }

    const speed = enemy.speed || 60;
    steerToPlayerBounded(enemy, player, scene, {
  speed,
  stopDist: 18,
  arriveDist: 6,
  directSight: true,

  // add these
  debugStops: true,
  debugThrottleMs: 0, // no throttle while debugging
});

  },


  /**
   * Direct "seek the player" homing.
   * Very strong behavior (no inertia or smoothing).
   */
  seekPlayer: (enemy, player, _scene, _dt) => {
    const dx = player.x - enemy.x;
    const dy = player.y - enemy.y;
    const dist = Math.hypot(dx, dy) || 1;

    // --- Arrival radius (prevents pile-on jitter) -------------------
    // Tune this to ~ (heroRadius + enemyRadius)
    const STOP_DIST = 18;

    if (dist <= STOP_DIST) {
      enemy.setVelocity(0, 0);
      return;
    }

    const speed = enemy.speed || 60;
    enemy.setVelocity((dx / dist) * speed, (dy / dist) * speed);
    enemy.setFlipX(dx < 0); // left/right for single-direction sheets
  },

  /**
   * Legion formation member: steers toward its assigned slot on a moving ring.
   */
  legionMember: (enemy, player, scene, dt = 0) => {
    // Defensive guards: fall back to seek behavior when context is missing.
    if (!enemy || !player || !scene) return;

    const formations = scene.legionFormations;
    if (!formations || !enemy._formationId) {
      return ENEMY_BEHAVIORS.seekPlayer(enemy, player, scene, dt);
    }

    // Resolve the shared formation state; missing state means the ring collapsed.
    const formation = formations.get(enemy._formationId);
    if (!formation) {
      return ENEMY_BEHAVIORS.seekPlayer(enemy, player, scene, dt);
    }

    const now = scene.time?.now ?? 0;
    const dtSeconds = Math.max(0, (dt || 0) / 1000);

    // --- Update formation center / rotation / radius ONCE per frame ---
    if (formation.lastUpdatedAt !== now) {
      formation.lastUpdatedAt = now;

      // Move the entire ring toward the player at a shared speed.
      const dxF = player.x - formation.cx;
      const dyF = player.y - formation.cy;
      const distF = Math.hypot(dxF, dyF) || 1;
      const move = formation.moveSpeed ?? 40;

      if (distF > 1 && dtSeconds > 0) {
        formation.cx += (dxF / distF) * move * dtSeconds;
        formation.cy += (dyF / distF) * move * dtSeconds;
      }

      // Apply continuous angular rotation to every member's slot.
      const angSpeed = formation.angularSpeed ?? 0;
      formation.angularOffset = (formation.angularOffset ?? 0) + angSpeed * dtSeconds;

      // Optionally shrink the ring radius over time (tightening the formation).
      const shrink = formation.shrinkPerSecond ?? 0;
      if (shrink > 0) {
        formation.radius = Math.max(40, formation.radius - shrink * dtSeconds);
      }
    }

    // Cache formation center and compute a reasonable speed to move the enemy.
    const cx = formation.cx;
    const cy = formation.cy;
    const speed = Number.isFinite(enemy.speed)
      ? enemy.speed
      : Number.isFinite(formation.moveSpeed)
        ? formation.moveSpeed
        : 60;

    // Slot angle + slot radius define the ideal target location for this member.
    const baseAngle = enemy._formationAngle ?? 0;
    const slotAngle = baseAngle + (formation.angularOffset ?? 0);
    const slotRadius = enemy._formationRadius ?? formation.radius;
    const slotX = cx + Math.cos(slotAngle) * slotRadius;
    const slotY = cy + Math.sin(slotAngle) * slotRadius;

    // Player vector is used as a gentle "move inward" component.
    const playerDx = player.x - enemy.x;
    const playerDy = player.y - enemy.y;
    const playerDist = Math.hypot(playerDx, playerDy);
    const separationRadius = Number.isFinite(formation.separationRadius) ? formation.separationRadius : 28;
    const separationStrength = Number.isFinite(formation.separationStrength) ? formation.separationStrength : 1;
    const maxSeparationChecks = Number.isFinite(formation.maxSeparationChecks) ? formation.maxSeparationChecks : 14;
    const radialGain = Number.isFinite(formation.radialGain) ? formation.radialGain : 0.03;

    // --- Separation: repel nearby legion members to avoid stacking ---
    let sepX = 0;
    let sepY = 0;
    let checked = 0;
    if (formation.members && maxSeparationChecks > 0 && separationRadius > 0) {
      for (const other of formation.members) {
        if (checked >= maxSeparationChecks) break;
        if (!other?.active || other === enemy) continue;
        checked += 1;

        const dx = enemy.x - other.x;
        const dy = enemy.y - other.y;
        const dist = Math.hypot(dx, dy);
        if (!dist || dist >= separationRadius) continue;

        const falloff = (separationRadius - dist) / separationRadius;
        sepX += (dx / dist) * falloff;
        sepY += (dy / dist) * falloff;
      }
    }

    // --- Build the steering direction as a blend of influences ---
    let dirX = 0;
    let dirY = 0;

    // Slight pull toward the player keeps the ring moving as a group.
    if (playerDist > 0.001) {
      dirX += playerDx / playerDist;
      dirY += playerDy / playerDist;
    }

    // Radial correction keeps the member near its assigned ring radius.
    const relX = enemy.x - cx;
    const relY = enemy.y - cy;
    const curRadius = Math.hypot(relX, relY);
    const radialUnitX = curRadius > 0.001 ? relX / curRadius : 0;
    const radialUnitY = curRadius > 0.001 ? relY / curRadius : 0;
    const radialError = slotRadius - curRadius;

    const maxRadial = 0.6;
    const radialContribution = Math.max(
      -maxRadial,
      Math.min(maxRadial, radialError * radialGain)
    );
    dirX += radialUnitX * radialContribution;
    dirY += radialUnitY * radialContribution;

    // Tangential drift encourages rotation in sync with the formation.
    const angSpeed = formation.angularSpeed ?? 0;
    if (Math.abs(angSpeed) > 0.0001) {
      const sign = Math.sign(angSpeed);
      const tangentX = -radialUnitY * sign;
      const tangentY = radialUnitX * sign;
      const tangentialGain = 0.4;
      dirX += tangentX * tangentialGain;
      dirY += tangentY * tangentialGain;
    }

    // Separation force is clamped to avoid overpowering the main steering.
    const sepMag = Math.hypot(sepX, sepY);
    if (sepMag > 0.001) {
      const maxSeparation = 0.5;
      const separationContribution = Math.min(maxSeparation, separationStrength);
      dirX += (sepX / sepMag) * separationContribution;
      dirY += (sepY / sepMag) * separationContribution;
    }

    // Normalize and scale to final speed for smooth motion.
    const dirMag = Math.hypot(dirX, dirY);
    if (enemy._useBoundedMovement && isBoundedNavReady(scene, enemy)) {
      steerToWorldPointBounded(enemy, scene, slotX, slotY, { speed, stopDist: 10, arriveDist: 6, directSight: true });
      enemy.setFlipX((slotX - enemy.x) < 0);
    } else if (dirMag > 0.001) {
      const scale = speed / dirMag;
      enemy.setVelocity(dirX * scale, dirY * scale);
      enemy.setFlipX(dirX < 0);
    } else {
      enemy.setVelocity(0, 0);
      enemy.setFlipX(false);
    }
  },

  /**
   * Move in a fixed, straight-line direction.
   * Used for waves that sweep across the screen without tracking the player.
   */
  flyStraight: (enemy, _player, scene) => {
    const base = ensureBaseVelocity(enemy);
    enemy.setVelocity(base.x, base.y);
    releaseIfOffscreen(enemy, scene);
  },

  /**
   * Same as flyStraight, but adds a side-to-side sine wobble.
   * Creates serpentine / diving formations with lightweight math.
   */
  flySine: (enemy, _player, scene, dt = 0) => {
    const base = ensureBaseVelocity(enemy);
    const baseMag = Math.hypot(base.x, base.y);

    // If we don't have movement, behave like straight-line.
    if (baseMag <= 0.001) {
      enemy.setVelocity(base.x, base.y);
      releaseIfOffscreen(enemy, scene);
      return;
    }

    // Compute perpendicular unit vector to base direction.
    const perpX = -base.y / baseMag;
    const perpY =  base.x / baseMag;

    // Wobble amplitude + frequency (defaults scale with speed).
    const amplitude = Number.isFinite(enemy._waveAmplitude)
      ? enemy._waveAmplitude
      : Math.min(60, baseMag * 0.45);

    const frequency = Number.isFinite(enemy._waveFrequency)
      ? enemy._waveFrequency
      : 0.0045;

    // Phase accumulator.
    enemy._aiTime = (enemy._aiTime ?? 0) + (dt || 0);
    const wobble = Math.sin(enemy._aiTime * frequency) * amplitude;

    // Combine forward movement + lateral wobble.
    const vx = base.x + perpX * wobble;
    const vy = base.y + perpY * wobble;

    enemy.setVelocity(vx, vy);
    releaseIfOffscreen(enemy, scene);
  },

  /**
   * Classic boss orbiting pattern with ranged attacks.
   * Used by evilwizard_boss.
   */
  circlePlayer: (enemy, player, scene, dt = 0) => {
    if (!enemy || !player || enemy._isDying) return;

    const mobConfig = resolveMobConfig(enemy.mobKey);
    const params = resolveEnemyAiParams(enemy);

    const radius = Number.isFinite(params.orbitRadius) ? params.orbitRadius : 320;
    const angularSpeed = Number.isFinite(params.angularSpeed) ? params.angularSpeed : 1.2;

    const dtSeconds = Math.max(0, (dt ?? 0) / 1000);

    // Initialize angular offset if missing.
    if (!Number.isFinite(enemy._theta)) {
      enemy._theta = Math.atan2(enemy.y - player.y, enemy.x - player.x);
    }

    // Orbit progress.
    enemy._theta += angularSpeed * dtSeconds;

    // Compute destination on orbit circle and steer toward it.
    const desiredX = player.x + Math.cos(enemy._theta) * radius;
    const desiredY = player.y + Math.sin(enemy._theta) * radius;
    const dx = desiredX - enemy.x;
    const dy = desiredY - enemy.y;
    const dist = Math.hypot(dx, dy);

    const moveSpeed = mobConfig?.stats?.speed ?? enemy.speed ?? 0;
    if (enemy._useBoundedMovement && isBoundedNavReady(scene)) {
      steerToWorldPointBounded(enemy, scene, desiredX, desiredY, { speed: moveSpeed, stopDist: 1, arriveDist: 1, directSight: true });
    } else if (dist > 1) enemy.setVelocity((dx / dist) * moveSpeed, (dy / dist) * moveSpeed);
    else enemy.setVelocity(0, 0);

    // Maintain movement animation except during attack.
    const animSet = mobConfig?.animationKeys ?? {};
    const moveAnim = animSet.move ?? animSet.idle ?? mobConfig?.defaultAnim;
    if (!enemy._isAttacking && moveAnim && enemy.anims?.animationManager?.exists?.(moveAnim)) {
      if (enemy.anims?.currentAnim?.key !== moveAnim) enemy.play(moveAnim, true);
    }

    const now = scene?.time?.now ?? 0;

    if (!enemy._rangedWeapon && scene?.enemyProjectiles) {
      enemy._rangedWeapon = new EnemyProjectileWeaponController(scene, enemy, {
        weaponKey: params.projectileWeaponKey ?? null,
        overrides: params.projectileOverrides ?? null,
        cooldownMs: Number.isFinite(params.attackCooldownMs) ? params.attackCooldownMs : 3000,
        initialDelayMs: Number.isFinite(params.initialAttackDelayMs) ? params.initialAttackDelayMs : undefined,
        range: Number.isFinite(params.attackRange) ? params.attackRange : Infinity,
        salvo: Number.isFinite(params.salvo) ? params.salvo : 1,
        spreadDeg: Number.isFinite(params.spreadDeg) ? params.spreadDeg : 0,
        aimMode: 'atTarget'
      });
    }

    if (enemy._rangedWeapon) {
      const fired = enemy._rangedWeapon.tryFireAt(player, now);

      // Optional attack animation override when a shot is emitted.
      if (fired) {
        const attackAnim = animSet.attack;
        if (attackAnim && enemy.anims?.animationManager?.exists?.(attackAnim)) {
          enemy._isAttacking = true;
          enemy.play(attackAnim, true);
          enemy.once(`animationcomplete-${attackAnim}`, () => {
            enemy._isAttacking = false;
            if (!enemy._isDying && moveAnim && enemy.anims?.animationManager?.exists?.(moveAnim)) {
              enemy.play(moveAnim, true);
            }
          });
        }
      }
    }
  },


  /**
   * Melee-based boss AI used for werewolf_boss.
   * Seeks player → stops in melee range → plays attack animation → deals damage.
   */
  seekAndMelee: (enemy, player, scene, dt = 0) => {
    if (!enemy || !player || enemy._isDying) return;

    const mobConfig = resolveMobConfig(enemy.mobKey);
    const params = resolveEnemyAiParams(enemy);

    // Param-based tuning knobs.
    const meleeRange = Number.isFinite(params.meleeRange) ? params.meleeRange : 48;

    // 🔑 Damage now prefers AI override, then mob stats.damage, then fallback
    const statsDamage = Number.isFinite(mobConfig?.stats?.damage) ? mobConfig.stats.damage : null;
    const meleeDamage =
      Number.isFinite(params.meleeDamage) ? params.meleeDamage :
      statsDamage != null ? statsDamage :
      2;

    const attackCooldown = Number.isFinite(params.attackCooldownMs) ? params.attackCooldownMs : 1200;
    const windupMs = Number.isFinite(params.windupMs) ? params.windupMs : 0;
    const lungeSpeed = Number.isFinite(params.lungeSpeed) ? params.lungeSpeed : 0;

    const animSet = mobConfig?.animationKeys ?? {};
    const moveAnim = animSet.move ?? animSet.idle ?? mobConfig?.defaultAnim;
    const idleAnim = animSet.idle ?? moveAnim ?? mobConfig?.defaultAnim;

    const dx = player.x - enemy.x;
    const dy = player.y - enemy.y;
    const dist = Math.hypot(dx, dy);
    const now = scene?.time?.now ?? 0;

    // Helper to safely revert to movement animation.
    /**
     * Restore the movement animation if the boss is not attacking.
     */
    const ensureMoveAnim = () => {
      if (moveAnim && enemy.anims?.animationManager?.exists?.(moveAnim) && enemy.anims?.currentAnim?.key !== moveAnim) {
        enemy.play(moveAnim, true);
      }
    };

    /**
     * Snap back to idle animation while in melee range or waiting to attack.
     */
    const ensureIdleAnim = () => {
      if (idleAnim && enemy.anims?.animationManager?.exists?.(idleAnim) && enemy.anims?.currentAnim?.key !== idleAnim) {
        enemy.play(idleAnim, true);
      }
    };

    // If already mid-attack, do nothing until the attack resolves.
    if (enemy._isAttacking) return;

    // Initialize attack cooldown timer.
    if (!Number.isFinite(enemy._bossNextAttack)) enemy._bossNextAttack = now;

    const speed = mobConfig?.stats?.speed ?? enemy.speed ?? 0;

    // If outside melee range → chase player.
    if (dist > meleeRange) {
      const denom = dist || 1;
      if (enemy._useBoundedMovement && isBoundedNavReady(scene)) {
        steerToPlayerBounded(enemy, player, scene, { speed, stopDist: meleeRange, arriveDist: 6, directSight: true });
      } else {
        enemy.setVelocity((dx / denom) * speed, (dy / denom) * speed);
      }
      enemy.setFlipX(dx < 0);
      ensureMoveAnim();
      return;
    }

    // In melee range → stop + stand idle.
    enemy.setVelocity(0, 0);
    enemy.setFlipX(dx < 0);
    ensureIdleAnim();

    // Still recovering from prior attack → wait.
    if (now < (enemy._bossNextAttack ?? 0)) return;

    // Begin attack sequence.
    enemy._isAttacking = true;
    enemy._attackDealt = false;
    enemy._bossNextAttack = now + attackCooldown;

    const attackAnim = animSet.attack;
    const hasAttackAnim = attackAnim && enemy.anims?.animationManager?.exists?.(attackAnim);

    if (hasAttackAnim) enemy.play(attackAnim, true);

    /**
     * End the melee attack sequence and return to normal movement/idle state.
     */
    const finishAttack = () => {
      if (!enemy.active) return;
      enemy._isAttacking = false;
      enemy._attackDealt = false;
      enemy.body?.setVelocity(0, 0);

      if (!enemy._isDying) {
        if (moveAnim && enemy.anims?.animationManager?.exists?.(moveAnim)) enemy.play(moveAnim, true);
        else if (idleAnim && enemy.anims?.animationManager?.exists?.(idleAnim)) enemy.play(idleAnim, true);
      }
    };

    if (hasAttackAnim) enemy.once(`animationcomplete-${attackAnim}`, finishAttack);
    else scene?.time?.delayedCall?.(Math.max(200, windupMs + 80), finishAttack);

    // Optional lunge motion during attack windup.
    if (lungeSpeed > 0 && dist > 0) {
      const denom = dist || 1;
      enemy.setVelocity((dx / denom) * lungeSpeed, (dy / denom) * lungeSpeed);

      const lungeDuration = windupMs > 0 ? windupMs : 140;
      scene?.time?.delayedCall?.(lungeDuration, () => {
        if (!enemy.active || !enemy._isAttacking) return;
        enemy.body?.setVelocity(0, 0);
      });
    }

    // Actual damage: uses meleeDamage derived from stats / params
    /**
     * Apply the melee hit once per swing so damage doesn't double-apply.
     */
    const applyDamage = () => {
      if (!enemy.active || enemy._attackDealt || !enemy._isAttacking) return;
      enemy._attackDealt = true;

      const tookDamage = scene?.hero?.health?.damage?.(meleeDamage);
      if (tookDamage) scene.cameras?.main?.shake?.(120, 0.006);
    };

    if (windupMs > 0) scene?.time?.delayedCall?.(windupMs, applyDamage);
    else applyDamage();
  },

  /**
   * Ranged chaser:
   *  - Repeatedly APPROACHES the player for a configurable duration,
   *  - Then HOLDS at a comfortable distance (no hugging),
   *  - Fires projectiles at the player using EnemyProjectileWeaponController.
   *
   * aiParams knobs:
   *  - approachDurationMs: how long to stay in "approach" before switching to "hold" (default 1200 ms)
   *  - holdDistance: distance at which we stop walking toward the player (default 96)
   *  - resumeDistance: distance at which we start approaching again after holding (default 128)
   *  - attackCooldownMs, initialAttackDelayMs, attackRange, salvo, spreadDeg
   *  - projectileWeaponKey, projectileOverrides
   */
  seekAndFire: (enemy, player, scene, dt = 0) => {
    if (!enemy || !player || enemy._isDying) return;

    const mobConfig = resolveMobConfig(enemy.mobKey);
    const params = resolveEnemyAiParams(enemy);

    const animSet = mobConfig?.animationKeys ?? {};
    const moveAnim = animSet.move ?? animSet.idle ?? mobConfig?.defaultAnim;
    const idleAnim = animSet.idle ?? moveAnim ?? mobConfig?.defaultAnim;

    const dx = player.x - enemy.x;
    const dy = player.y - enemy.y;
    const dist = Math.hypot(dx, dy);

    const speed = mobConfig?.stats?.speed ?? enemy.speed ?? 0;
    const now = scene?.time?.now ?? 0;

    // Tunable knobs
    const approachDurationMs = Number.isFinite(params.approachDurationMs) ? params.approachDurationMs : 1200;
    const holdDistance      = Number.isFinite(params.holdDistance)      ? params.holdDistance      : 96;
    const resumeDistance    = Number.isFinite(params.resumeDistance)    ? params.resumeDistance    : 128;

    // --------- Phase state: "approach" vs "hold" ----------
    if (!enemy._seekFirePhase) {
      enemy._seekFirePhase = 'approach';
      enemy._seekFirePhaseTimeMs = 0;
    }

    enemy._seekFirePhaseTimeMs = (enemy._seekFirePhaseTimeMs ?? 0) + (dt || 0);

    // Phase transitions
    if (enemy._seekFirePhase === 'approach') {
      // If we've been approaching long enough OR we're already in hold distance, switch to hold
      if (enemy._seekFirePhaseTimeMs >= approachDurationMs || dist <= holdDistance) {
        enemy._seekFirePhase = 'hold';
        enemy._seekFirePhaseTimeMs = 0;
      }
    } else if (enemy._seekFirePhase === 'hold') {
      // If the player runs away far enough, chase again
      if (dist >= resumeDistance) {
        enemy._seekFirePhase = 'approach';
        enemy._seekFirePhaseTimeMs = 0;
      }
    }

    const phase = enemy._seekFirePhase;

    // --------- Movement + animations (respect attack state) ----------
    /**
     * Ensure movement animation plays while the ranged enemy is approaching.
     */
    const ensureMoveAnim = () => {
      if (enemy._isAttacking) return;
      if (moveAnim && enemy.anims?.animationManager?.exists?.(moveAnim) && enemy.anims?.currentAnim?.key !== moveAnim) {
        enemy.play(moveAnim, true);
      }
    };

    /**
     * Keep the idle animation running while the ranged enemy is holding distance.
     */
    const ensureIdleAnim = () => {
      if (enemy._isAttacking) return;
      if (idleAnim && enemy.anims?.animationManager?.exists?.(idleAnim) && enemy.anims?.currentAnim?.key !== idleAnim) {
        enemy.play(idleAnim, true);
      }
    };

    if (phase === 'approach' && dist > holdDistance && speed > 0) {
      const denom = dist || 1;
      if (enemy._useBoundedMovement && isBoundedNavReady(scene)) {
        steerToPlayerBounded(enemy, player, scene, { speed, stopDist: holdDistance, arriveDist: 6, directSight: true });
      } else {
        enemy.setVelocity((dx / denom) * speed, (dy / denom) * speed);
      }
      enemy.setFlipX(dx < 0);
      ensureMoveAnim();
    } else {
      // Either in "hold" phase or already within comfort radius
      enemy.setVelocity(0, 0);
      enemy.setFlipX(dx < 0);
      ensureIdleAnim();
    }

    // --------- Ranged weapon setup + firing ----------
    if (!enemy._rangedWeapon && scene?.enemyProjectiles) {
      enemy._rangedWeapon = new EnemyProjectileWeaponController(scene, enemy, {
        weaponKey: params.projectileWeaponKey ?? null,
        overrides: params.projectileOverrides ?? null,
        cooldownMs: Number.isFinite(params.attackCooldownMs) ? params.attackCooldownMs : 2200,
        initialDelayMs: Number.isFinite(params.initialAttackDelayMs) ? params.initialAttackDelayMs : undefined,
        range: Number.isFinite(params.attackRange) ? params.attackRange : Infinity,
        salvo: Number.isFinite(params.salvo) ? params.salvo : 1,
        spreadDeg: Number.isFinite(params.spreadDeg) ? params.spreadDeg : 0,
        aimMode: 'atTarget'
      });
    }

    if (!enemy._rangedWeapon) return;

    const fired = enemy._rangedWeapon.tryFireAt(player, now);

    // Optional attack animation hook when a shot is actually emitted
    if (fired) {
      const attackAnim = animSet.attack;
      if (attackAnim && enemy.anims?.animationManager?.exists?.(attackAnim)) {
        enemy._isAttacking = true;
        enemy.play(attackAnim, true);
        enemy.once(`animationcomplete-${attackAnim}`, () => {
          enemy._isAttacking = false;
          // Go back to appropriate movement/idle anim based on current phase
          if (enemy._isDying) return;
          if (enemy._seekFirePhase === 'approach') ensureMoveAnim();
          else ensureIdleAnim();
        });
      }
    }
  },

  seekAndMeleeBounded: (enemy, player, scene, dt = 0) => {
    enemy._useBoundedMovement = true;
    try {
      return ENEMY_BEHAVIORS.seekAndMelee(enemy, player, scene, dt);
    } finally {
      enemy._useBoundedMovement = false;
    }
  },

  seekAndFireBounded: (enemy, player, scene, dt = 0) => {
    enemy._useBoundedMovement = true;
    try {
      return ENEMY_BEHAVIORS.seekAndFire(enemy, player, scene, dt);
    } finally {
      enemy._useBoundedMovement = false;
    }
  },

  circlePlayerBounded: (enemy, player, scene, dt = 0) => {
    enemy._useBoundedMovement = true;
    try {
      return ENEMY_BEHAVIORS.circlePlayer(enemy, player, scene, dt);
    } finally {
      enemy._useBoundedMovement = false;
    }
  },

  legionMemberBounded: (enemy, player, scene, dt = 0) => {
    enemy._useBoundedMovement = true;
    try {
      return ENEMY_BEHAVIORS.legionMember(enemy, player, scene, dt);
    } finally {
      enemy._useBoundedMovement = false;
    }
  },

  // Flying wave movers intentionally remain unchanged on bounded maps: they are
  // authored as non-nav patterns that can cross the arena independent of flow fields.
};
