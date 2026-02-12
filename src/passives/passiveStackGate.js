import { LEVEL_UP } from '../config/gameConfig.js';

/**
 * Resolve the level needed to grant the next stack for a passive.
 *
 * Formula:
 * - stack 1: always allowed when gating starts at stack 2
 * - stack N: (N - 1) * interval, for N >= gateStartStack
 */
export function getRequiredLevelForNextStack(currentCount, levelUpConfig = LEVEL_UP) {
  const count = Number.isFinite(currentCount) ? Math.max(0, Math.floor(currentCount)) : 0;
  const nextStackIndex = count + 1;

  const gateStartStack = Number(levelUpConfig?.passiveStackGateStartAtStack ?? 2);
  if (!Number.isFinite(gateStartStack) || nextStackIndex < gateStartStack) {
    return 1;
  }

  const interval = Number(levelUpConfig?.passiveStackLevelInterval ?? 0);
  if (!Number.isFinite(interval) || interval <= 0) {
    return 1;
  }

  return Math.max(1, Math.floor((nextStackIndex - 1) * interval));
}

/**
 * Determine if a passive's next stack can be granted at the current level.
 */
export function canGrantNextStack({ level, currentCount, config = LEVEL_UP } = {}) {
  const resolvedLevel = Number.isFinite(level) ? Math.floor(level) : 1;
  const requiredLevel = getRequiredLevelForNextStack(currentCount, config);
  return resolvedLevel >= requiredLevel;
}
