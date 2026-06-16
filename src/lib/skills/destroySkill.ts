import type { Cell, GameState, SkillModule } from '../types';

export const destroySkill: SkillModule = {
  id: 'destroy',
  name: '駒破壊 (Destroy)',
  description: '盤面上の指定したマスの駒を消去する。',
  category: 'attack',
  cost: 2,
  targetType: 'cell',
  getCellStyle(cell: Cell, x: number, y: number, state: GameState, isSelected: boolean): string {
    if (!isSelected) return '';
    // If selected and cell is not empty, highlight it as destructible target
    if (cell.type !== 'empty') {
      return 'skill-target-destructible animate-pulse-subtle';
    }
    return 'skill-target-invalid';
  },
  execute(state: GameState, target?: { x?: number; y?: number }): GameState {
    if (!target || target.x === undefined || target.y === undefined) {
      return state;
    }
    const { x, y } = target;
    // Deep copy state to remain pure
    const nextState: GameState = JSON.parse(JSON.stringify(state));
    const cell = nextState.board[y][x];

    if (cell.type !== 'empty') {
      cell.type = 'empty';
      cell.hp = 1;
      cell.statusEffects = [];
    }

    return nextState;
  }
};
