import type { Cell, GameState, SkillModule } from '../types';

export const shuffleSkill: SkillModule = {
  id: 'skill_shuffle',
  name: '天変地異',
  category: 'utility',
  description: '盤面の中心3x3の範囲内にあるすべての駒の位置を、ダイスの出目に応じてランダムに入れ替える。',
  cost: 4,
  targetType: 'global',
  getCellStyle(cell: Cell, x: number, y: number, state: GameState, isSelected: boolean): string {
    // Highlight center 3x3 grid when active or selected
    if (x >= 1 && x <= 3 && y >= 1 && y <= 3) {
      return 'skill-target-shuffle-area cyber-glow-cyan-border';
    }
    return '';
  },
  execute(state: GameState, target?: { x?: number; y?: number }): GameState {
    const nextState: GameState = JSON.parse(JSON.stringify(state));
    const result = Math.floor(Math.random() * 6) + 1;

    nextState.activeDiceRoll = {
      isRolling: true,
      result: result
    };

    // Extract center 3x3 positions
    const coords: { x: number; y: number }[] = [];
    const cells: Cell[] = [];

    for (let yIndex = 1; yIndex <= 3; yIndex++) {
      for (let xIndex = 1; xIndex <= 3; xIndex++) {
        coords.push({ x: xIndex, y: yIndex });
        cells.push(JSON.parse(JSON.stringify(nextState.board[yIndex][xIndex])));
      }
    }

    // Shuffle
    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const temp = cells[i];
      cells[i] = cells[j];
      cells[j] = temp;
    }

    // Re-assign shuffled cells to coordinates
    for (let i = 0; i < coords.length; i++) {
      const { x, y } = coords[i];
      nextState.board[y][x] = cells[i];
    }

    return nextState;
  }
};
