import type { Cell, GameState, SkillModule } from '../types';

export const boostCostSkill: SkillModule = {
  id: 'boostCost',
  name: 'コストブースト (Boost Cost)',
  description: '自身のコストを3増やす。',
  category: 'utility',
  cost: 1,
  targetType: 'player',
  getCellStyle(cell: Cell, x: number, y: number, state: GameState, isSelected: boolean): string {
    // This is a player target skill, board style changes are not needed, but we can highlight global board frame
    return '';
  },
  execute(state: GameState, target?: { x?: number; y?: number }): GameState {
    const nextState: GameState = JSON.parse(JSON.stringify(state));
    const activePlayer = nextState.currentPlayer;
    nextState.costs[activePlayer] += 3;
    return nextState;
  }
};
