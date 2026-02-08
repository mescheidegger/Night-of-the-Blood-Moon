export function resolveSpawnKey(ctx, mobEntry = {}) {
  const scene = ctx?.scene;
  const runtime = scene?.mapRuntime;
  const isBounded = runtime?.isBounded?.();
  const explicitKey = mobEntry?.spawnKey
    ?? mobEntry?.spawnGroup
    ?? mobEntry?.spawn?.key
    ?? mobEntry?.spawn?.group
    ?? null;

  if (!isBounded) {
    return explicitKey;
  }

  if (explicitKey) {
    return explicitKey;
  }

  return ctx?.spawnKeyDefault ?? mobEntry?.spawnKeyDefault ?? null;
}
