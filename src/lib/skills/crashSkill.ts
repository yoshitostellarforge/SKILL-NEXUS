import type { Cell, GameState, SkillModule } from '../types';

export const crashSkill: SkillModule = {
  id: 'skill_crash',
  name: '破砕',
  category: 'attack',
  description: '指定したマスの駒のHPを1減少させる。HPが0以下になった駒は消滅する。',
  cost: 2,
  targetType: 'cell',
  getCellStyle(cell: Cell, x: number, y: number, state: GameState, isSelected: boolean): string {
    if (!isSelected) return '';
    if (cell.type !== 'empty') {
      return 'skill-target-damageable cyber-glow-red-border';
    }
    return 'skill-target-invalid';
  },
  execute(state: GameState, target?: { x?: number; y?: number }): GameState {
    if (!target || target.x === undefined || target.y === undefined) return state;
    const { x, y } = target;
    const nextState: GameState = JSON.parse(JSON.stringify(state));
    const cell = nextState.board[y][x];

    if (cell.type !== 'empty') {
      cell.hp -= 1;
      if (cell.hp <= 0) {
        cell.type = 'empty';
        cell.hp = 1;
        cell.statusEffects = [];
      }
    }

    return nextState;
  }
};
