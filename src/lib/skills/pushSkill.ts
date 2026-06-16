import type { Cell, GameState, SkillModule } from '../types';

export const pushSkill: SkillModule = {
  id: 'skill_push',
  name: '突風',
  category: 'utility',
  description: '対象の駒を隣接するいずれかの空きマスへ1マス押し出す。',
  cost: 2,
  targetType: 'cell',
  getCellStyle(cell: Cell, x: number, y: number, state: GameState, isSelected: boolean): string {
    if (!isSelected) return '';
    if (cell.type !== 'empty') {
      return 'skill-target-pushable cyber-glow-cyan-border';
    }
    return 'skill-target-invalid';
  },
  execute(state: GameState, target?: { x?: number; y?: number }): GameState {
    if (!target || target.x === undefined || target.y === undefined) return state;
    const { x, y } = target;
    const nextState: GameState = JSON.parse(JSON.stringify(state));
    const cell = nextState.board[y][x];

    if (cell.type === 'empty') return state;

    // Check adjacent cells (Up, Right, Down, Left)
    const directions = [
      { dx: 0, dy: -1 }, // Up
      { dx: 1, dy: 0 },  // Right
      { dx: 0, dy: 1 },  // Down
      { dx: -1, dy: 0 }  // Left
    ];

    for (const dir of directions) {
      const tx = x + dir.dx;
      const ty = y + dir.dy;
      // Boundary check
      if (tx >= 0 && tx < 5 && ty >= 0 && ty < 5) {
        if (nextState.board[ty][tx].type === 'empty') {
          // Push cell attributes to target cell
          nextState.board[ty][tx].type = cell.type;
          nextState.board[ty][tx].hp = cell.hp;
          nextState.board[ty][tx].statusEffects = [...cell.statusEffects];

          // Clear original cell
          cell.type = 'empty';
          cell.hp = 1;
          cell.statusEffects = [];
          break;
        }
      }
    }

    return nextState;
  }
};
