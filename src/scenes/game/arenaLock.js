import Phaser from 'phaser';

export function updateArenaLock(scene) {
  // Once the finale cleanup delay expires, convert the current camera view into a fixed arena.
  if (scene._finale && !scene._arenaLocked && (scene.time?.now ?? 0) >= scene._finale.lockAtMs) {
    const heroSprite = scene.hero?.sprite;
    const body = heroSprite?.body;

    if (heroSprite && body) {
      const cam = scene.cameras.main;

      // Use the *current visible world rectangle* as the arena bounds.
      // This makes the lock feel seamless instead of snapping to a pre-defined box.
      const view = cam.worldView;
      const x = view.x;
      const y = view.y;
      const arenaWidth = view.width;
      const arenaHeight = view.height;

      // Constrain both camera and physics world so nothing can move outside the arena.
      cam.setBounds(x, y, arenaWidth, arenaHeight);
      scene.physics.world.setBounds(x, y, arenaWidth, arenaHeight);

      // Ensure the hero cannot leave the arena and isn’t already outside due to drift.
      const heroSprite = scene.hero?.sprite;
      const body = heroSprite?.body;
      if (heroSprite && body) {
        body.setCollideWorldBounds(true);
        body.setBounce(0, 0); // No bounce — arena walls should feel solid.

        // Clamp hero inside bounds to prevent tunneling or edge glitches at lock time.
        heroSprite.x = Phaser.Math.Clamp(heroSprite.x, x, x + arenaWidth);
        heroSprite.y = Phaser.Math.Clamp(heroSprite.y, y, y + arenaHeight);
        body.reset(heroSprite.x, heroSprite.y);
      }

      // Prevent this logic from running again.
      scene._arenaLocked = true;
    }
  }
}
