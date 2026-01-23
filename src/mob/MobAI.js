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

/**
 * Behavior dispatcher: each entry is a function applied once per frame to
 * all active enemies in EnemyBehaviorSystem.update().
 */
export const ENEMY_BEHAVIORS = {

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
    if (!enemy || !player || !scene) return;

    const formations = scene.legionFormations;
    if (!formations || !enemy._formationId) {
      return ENEMY_BEHAVIORS.seekPlayer(enemy, player, scene, dt);
    }

    const formation = formations.get(enemy._formationId);
    if (!formation) {
      return ENEMY_BEHAVIORS.seekPlayer(enemy, player, scene, dt);
    }

    const now = scene.time?.now ?? 0;
    const dtSeconds = Math.max(0, (dt || 0) / 1000);

    // --- Update formation center / rotation / radius ONCE per frame ---
    if (formation.lastUpdatedAt !== now) {
      formation.lastUpdatedAt = now;

      const dxF = player.x - formation.cx;
      const dyF = player.y - formation.cy;
      const distF = Math.hypot(dxF, dyF) || 1;
      const move = formation.moveSpeed ?? 40;

      if (distF > 1 && dtSeconds > 0) {
        formation.cx += (dxF / distF) * move * dtSeconds;
        formation.cy += (dyF / distF) * move * dtSeconds;
      }

      const angSpeed = formation.angularSpeed ?? 0;
      formation.angularOffset = (formation.angularOffset ?? 0) + angSpeed * dtSeconds;

      const shrink = formation.shrinkPerSecond ?? 0;
      if (shrink > 0) {
        formation.radius = Math.max(40, formation.radius - shrink * dtSeconds);
      }
    }

    const cx = formation.cx;
    const cy = formation.cy;
    const speed = Number.isFinite(enemy.speed)
      ? enemy.speed
      : Number.isFinite(formation.moveSpeed)
        ? formation.moveSpeed
        : 60;

    const baseAngle = enemy._formationAngle ?? 0;
    const slotAngle = baseAngle + (formation.angularOffset ?? 0);
    const slotRadius = enemy._formationRadius ?? formation.radius;

    const playerDx = player.x - enemy.x;
    const playerDy = player.y - enemy.y;
    const playerDist = Math.hypot(playerDx, playerDy);
    const separationRadius = Number.isFinite(formation.separationRadius) ? formation.separationRadius : 28;
    const separationStrength = Number.isFinite(formation.separationStrength) ? formation.separationStrength : 1;
    const maxSeparationChecks = Number.isFinite(formation.maxSeparationChecks) ? formation.maxSeparationChecks : 14;
    const radialGain = Number.isFinite(formation.radialGain) ? formation.radialGain : 0.03;

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

    let dirX = 0;
    let dirY = 0;

    if (playerDist > 0.001) {
      dirX += playerDx / playerDist;
      dirY += playerDy / playerDist;
    }

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

    const angSpeed = formation.angularSpeed ?? 0;
    if (Math.abs(angSpeed) > 0.0001) {
      const sign = Math.sign(angSpeed);
      const tangentX = -radialUnitY * sign;
      const tangentY = radialUnitX * sign;
      const tangentialGain = 0.4;
      dirX += tangentX * tangentialGain;
      dirY += tangentY * tangentialGain;
    }

    const sepMag = Math.hypot(sepX, sepY);
    if (sepMag > 0.001) {
      const maxSeparation = 0.5;
      const separationContribution = Math.min(maxSeparation, separationStrength);
      dirX += (sepX / sepMag) * separationContribution;
      dirY += (sepY / sepMag) * separationContribution;
    }

    const dirMag = Math.hypot(dirX, dirY);
    if (dirMag > 0.001) {
      const scale = speed / dirMag;
      enemy.setVelocity(dirX * scale, dirY * scale);
    } else {
      enemy.setVelocity(0, 0);
    }
    enemy.setFlipX(dirX < 0);
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
    const params = mobConfig?.aiParams ?? {};

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
    if (dist > 1) enemy.setVelocity((dx / dist) * moveSpeed, (dy / dist) * moveSpeed);
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
    const params = mobConfig?.aiParams ?? {};

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
      enemy.setVelocity((dx / denom) * speed, (dy / denom) * speed);
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
    const params = mobConfig?.aiParams ?? {};

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
      enemy.setVelocity((dx / denom) * speed, (dy / denom) * speed);
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
};
