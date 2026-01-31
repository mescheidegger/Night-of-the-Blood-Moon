export const DEFAULT_MAP_KEY = 'endless_default';

// Registry of map configs; bounded entries include tilemap/collision metadata.
export const MapRegistry = {
  endless_default: {
    type: 'infinite',
    ground: {
      textureKey: 'ground',
    },
    props: {
      mode: 'procedural',
      chunkSize: 384,
      seed: 12345,
      density: 3,
      registryKey: 'all',
    },
  },
  endless_blood: {
    type: 'infinite',
    ground: {
      textureKey: 'ground',
    },
    props: {
      mode: 'procedural',
      chunkSize: 384,
      seed: 12345,
      density: 3,
      registryKey: 'blood',
    },
  },
  endless_grave: {
    type: 'infinite',
    ground: {
      textureKey: 'ground',
    },
    props: {
      mode: 'procedural',
      chunkSize: 384,
      seed: 12345,
      density: 3,
      registryKey: 'grave',
    },
  },
  // Bounded map example: loads a Tiled JSON and uses object layers as colliders.
  bounded_graveyard: {
    type: 'bounded',
    tilemap: {
      jsonKey: 'map.graveyard.scarywary',
      jsonPath: '/assets/tiles/graveyard/ScaryWary.json',
      tilesets: [
        { name: 'TX_Struct', key: 'tiles.graveyard.struct', path: '/assets/tiles/graveyard/TX_Struct.png' },
        { name: 'TX_Tileset_Wall', key: 'tiles.graveyard.wall', path: '/assets/tiles/graveyard/TX_Tileset_Wall.png' },
        { name: 'TX_Plant', key: 'tiles.graveyard.plant', path: '/assets/tiles/graveyard/TX_Plant.png' },
        { name: 'TX_Player', key: 'tiles.graveyard.player', path: '/assets/tiles/graveyard/TX_Player.png' },
        { name: 'TX_Props', key: 'tiles.graveyard.props', path: '/assets/tiles/graveyard/TX_Props.png' },
        { name: 'TX_Shadow_Plant', key: 'tiles.graveyard.shadow-plant', path: '/assets/tiles/graveyard/TX_Shadow_Plant.png' },
        { name: 'TX_Shadow', key: 'tiles.graveyard.shadow', path: '/assets/tiles/graveyard/TX_Shadow.png' },
        { name: 'TX_Tileset_Grass', key: 'tiles.graveyard.grass', path: '/assets/tiles/graveyard/TX_Tileset_Grass.png' },
        {
          name: 'TX_Tileset_Stone_Ground',
          key: 'tiles.graveyard.stone',
          path: '/assets/tiles/graveyard/TX_Tileset_Stone_Ground.png'
        },
        { name: 'TX_Plant_with_Shadow', key: 'tiles.graveyard.plant-shadow', path: '/assets/tiles/graveyard/TX_Plant_with_Shadow.png' }
      ],
    },
    collision: {
      tileLayerRules: {
        Grass: false,
        Stairs: false,
        Walls: false,
        Props: false,
        Plants: false,
        Collision: true,
      },
      objectLayerRules: {
        InvisibleWalls: true,
      }
    },
    props: {
      mode: 'tiled',
    },
  },
};
