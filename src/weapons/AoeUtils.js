/** Provide runAoe so callers can reuse shared logic safely. */
export function runAoe({
  scene,
  enemyGroup,
  origin,
  baseDamage = 0,
  cfg,
  damagePipeline,
  sourceKey,
  exclude = null,

  // ✅ NEW: optional full damage payload from controller (crit/status/etc).
  // If provided, we preserve fields and only override `damage` per-target.
  payload = null
}) {
  if (!cfg?.enabled || !enemyGroup || !origin) return 0;

  const radius = cfg.radius ?? 0;
  if (radius <= 0) return 0;

  const radiusSq = radius * radius;
  const damageMult = cfg.damageMult ?? 1;
  const maxTargets = Number.isFinite(cfg.maxTargets) ? cfg.maxTargets : Infinity;
  const falloff = cfg.falloff ?? 0;

  const arcDeg = cfg.arcDeg;
  const hasDirectionalArc =
    Number.isFinite(arcDeg) && arcDeg > 0 && arcDeg < 360 && Number.isFinite(cfg.angleRad);
  const halfArcRad = hasDirectionalArc ? ((arcDeg / 2) * Math.PI) / 180 : 0;

  // Optional forgiveness at cone edges
  const arcSlack = Number.isFinite(cfg.arcSlack) ? cfg.arcSlack : 0.0;

  let minDot = hasDirectionalArc ? Math.cos(halfArcRad) : -1;
  if (hasDirectionalArc) {
    minDot = Math.max(-1, minDot - arcSlack);
  }

  const facingVec = hasDirectionalArc
    ? { x: Math.cos(cfg.angleRad), y: Math.sin(cfg.angleRad) }
    : null;

  // near-body auto-hit distance for directional cones
  const innerForgive = Math.max(0, Number.isFinite(cfg.innerForgivenessPx) ? cfg.innerForgivenessPx : 0);

  let hitCount = 0;

  // Normalize a "base payload" we can clone per hit.
  // - If caller passed payload, prefer it
  // - Else build a minimal one using the old fields
  const basePayload = payload && typeof payload === 'object'
    ? payload
    : {
        crit: false,
        critChance: 0,
        critMult: 1,
        status: [],
        sourceKey
      };

  enemyGroup.children?.iterate?.((enemy) => {
    if (!enemy || !enemy.active || enemy === exclude) return;

    const dx = enemy.x - origin.x;
    const dy = enemy.y - origin.y;
    const distSq = dx * dx + dy * dy;
    if (distSq > radiusSq) return;

    const distance = Math.sqrt(distSq);

    if (hasDirectionalArc && distance > 0) {
      // Auto-pass the cone test if the enemy is very close to the player
      if (distance > innerForgive) {
        const normX = dx / distance;
        const normY = dy / distance;
        const dot = normX * facingVec.x + normY * facingVec.y;
        if (dot < minDot) return;
      }
    }

    const falloffMult = Math.max(0, 1 - (falloff * (distance / 100)));
    const finalDamage = baseDamage * damageMult * falloffMult;

    if (finalDamage > 0) {
      // ✅ Clone and override only damage + sourceKey.
      // This preserves crit + status + any future fields (lifesteal tags, etc.)
      const hitPayload = {
        ...basePayload,
        damage: finalDamage,
        sourceKey: basePayload?.sourceKey ?? sourceKey
      };

      damagePipeline?.applyHit(enemy, hitPayload);

      hitCount += 1;
      if (hitCount >= maxTargets) {
        return false; // stop iterating further enemies
      }
    }

    return undefined;
  });

  scene?.events?.emit?.('weapons:aoe', {
    key: sourceKey,
    x: origin.x,
    y: origin.y,
    radius
  });

  return hitCount;
}
