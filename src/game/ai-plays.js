/**
 * FFX AI Tactical Formations Engine
 */

export const FORMATIONS = {
  NORMAL: 'NORMAL',
  OFFENSE: 'OFFENSE',
  DEFENSE: 'DEFENSE',
  COUNTER: 'COUNTER',
  SIDE_ATTACK: 'SIDE_ATTACK',
  ZONE: 'ZONE'
};

export class AITactics {
  /**
   * Repositions team members based on selected tactical formation
   * @param {Array<Object>} players Array of team players
   * @param {string} formation Formation name from FORMATIONS
   * @param {boolean} isHomeTeam 
   */
  static applyFormation(players, formation, isHomeTeam) {
    const dir = isHomeTeam ? 1 : -1;

    switch (formation) {
      case FORMATIONS.OFFENSE:
        // Push forwards and midfielders deep into enemy territory
        players[0].targetPos = { x: -6, y: 0, z: dir * 10 }; // Left Forward
        players[1].targetPos = { x: 6, y: 0, z: dir * 10 };  // Right Forward
        players[2].targetPos = { x: 0, y: 2, z: dir * 6 };   // Midfielder
        players[3].targetPos = { x: -8, y: -1, z: dir * 2 }; // Left Defender
        players[4].targetPos = { x: 8, y: -1, z: dir * 2 };  // Right Defender
        break;

      case FORMATIONS.DEFENSE:
        // Collapse team back near own goal net
        players[0].targetPos = { x: -4, y: 0, z: dir * 4 };
        players[1].targetPos = { x: 4, y: 0, z: dir * 4 };
        players[2].targetPos = { x: 0, y: 0, z: dir * 2 };
        players[3].targetPos = { x: -6, y: 0, z: dir * -8 };
        players[4].targetPos = { x: 6, y: 0, z: dir * -8 };
        break;

      case FORMATIONS.SIDE_ATTACK:
        // Hug left and right sphere walls to bypass central defenders
        players[0].targetPos = { x: -12, y: 0, z: dir * 8 };
        players[1].targetPos = { x: 12, y: 0, z: dir * 8 };
        players[2].targetPos = { x: 0, y: 0, z: dir * 2 };
        players[3].targetPos = { x: -10, y: 0, z: dir * -4 };
        players[4].targetPos = { x: 10, y: 0, z: dir * -4 };
        break;

      case FORMATIONS.NORMAL:
      default:
        // Balanced standard FFX spread
        players[0].targetPos = { x: -5, y: 0, z: dir * 6 };
        players[1].targetPos = { x: 5, y: 0, z: dir * 6 };
        players[2].targetPos = { x: 0, y: 0, z: 0 };
        players[3].targetPos = { x: -6, y: 0, z: dir * -6 };
        players[4].targetPos = { x: 6, y: 0, z: dir * -6 };
        break;
    }
  }

  /**
   * Smoothly interpolates players toward target formation coordinates
   */
  static updatePlayerPositions(players, delta) {
    const moveSpeed = 3.5; // Swim speed m/s

    players.forEach(p => {
      if (!p.targetPos) return;

      const dx = p.targetPos.x - p.position.x;
      const dy = p.targetPos.y - p.position.y;
      const dz = p.targetPos.z - p.position.z;
      const dist = Math.hypot(dx, dy, dz);

      if (dist > 0.1) {
        p.position.x += (dx / dist) * moveSpeed * delta;
        p.position.y += (dy / dist) * moveSpeed * delta;
        p.position.z += (dz / dist) * moveSpeed * delta;
      }
    });
  }
}
