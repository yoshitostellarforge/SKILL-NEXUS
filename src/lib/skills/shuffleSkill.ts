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
  execute(state: GameState, target?: { x?: number; y?: number }, customPayload?: { result: number; shuffleOrder: number[] }): GameState {
    const nextState: GameState = JSON.parse(JSON.stringify(state));
    
    let result: number;
    let shuffleOrder: number[];

    // If customPayload containing synchronized result and shuffleOrder is provided, use it.
    // Otherwise generate random values locally (offline fallback).
    if (customPayload && typeof customPayload.result === 'number' && Array.isArray(customPayload.shuffleOrder)) {
      result = customPayload.result;
      shuffleOrder = customPayload.shuffleOrder;
    } else {
      result = Math.floor(Math.random() * 6) + 1;
      
      const indices = Array.from({ length: 9 }, (_, i) => i);
      for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const temp = indices[i];
        indices[i] = indices[j];
        indices[j] = temp;
      }
      shuffleOrder = indices;
    }

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

    // Shuffle according to the determined order
    const shuffledCells: Cell[] = [];
    for (let i = 0; i < coords.length; i++) {
      shuffledCells.push(cells[shuffleOrder[i]]);
    }

    // Re-assign shuffled cells to coordinates
    for (let i = 0; i < coords.length; i++) {
      const { x, y } = coords[i];
      nextState.board[y][x] = shuffledCells[i];
    }

    return nextState;
  }
};
