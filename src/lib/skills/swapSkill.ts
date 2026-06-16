import type { Cell, GameState, SkillModule } from '../types';

export const swapSkill: SkillModule = {
  id: 'skill_swap',
  name: '等価交換',
  category: 'utility',
  description: '自分の駒と相手の駒の位置を入れ替える（2段階選択）。',
  cost: 3,
  targetType: 'cell',
  getCellStyle(cell: Cell, x: number, y: number, state: GameState, isSelected: boolean): string {
    if (!isSelected) return '';
    const activePlayer = state.currentPlayer;
    const isOwnPiece = (activePlayer === 'A' && cell.type === 'circle') || (activePlayer === 'B' && cell.type === 'cross');
    const isOpponentPiece = (activePlayer === 'A' && cell.type === 'cross') || (activePlayer === 'B' && cell.type === 'circle');

    if (!state.swapSource) {
      // Step 1: Highlight own pieces
      if (isOwnPiece) {
        return 'skill-target-swap-source cyber-glow-cyan-border';
      }
    } else {
      // Step 2: Highlight selected source and target opponent pieces
      if (state.swapSource.x === x && state.swapSource.y === y) {
        return 'skill-target-swap-selected';
      }
      if (isOpponentPiece) {
        return 'skill-target-swap-dest';
      }
    }
    return 'skill-target-invalid';
  },
  execute(state: GameState, target?: { x?: number; y?: number }): GameState {
    if (!target || target.x === undefined || target.y === undefined) return state;
    const { x, y } = target;
    const nextState: GameState = JSON.parse(JSON.stringify(state));
    const activePlayer = state.currentPlayer;
    const cell = nextState.board[y][x];

    const isOwnPiece = (activePlayer === 'A' && cell.type === 'circle') || (activePlayer === 'B' && cell.type === 'cross');
    const isOpponentPiece = (activePlayer === 'A' && cell.type === 'cross') || (activePlayer === 'B' && cell.type === 'circle');

    if (!nextState.swapSource) {
      // Select source piece
      if (isOwnPiece) {
        nextState.swapSource = { x, y };
        // Refund cost and count because it's not fully committed
        nextState.costs[activePlayer] += this.cost;
        if (nextState.turnSkillCount > 0) {
          nextState.turnSkillCount -= 1;
        }
      }
    } else {
      // Select destination piece to swap with
      const src = nextState.swapSource;
      if (isOpponentPiece) {
        // Perform swap
        const temp = JSON.parse(JSON.stringify(nextState.board[src.y][src.x]));
        nextState.board[src.y][src.x] = JSON.parse(JSON.stringify(nextState.board[y][x]));
        nextState.board[y][x] = temp;

        nextState.swapSource = null;
      } else {
        // Clicked invalid target, refund cost and cancel source selection
        nextState.costs[activePlayer] += this.cost;
        if (nextState.turnSkillCount > 0) {
          nextState.turnSkillCount -= 1;
        }
        nextState.swapSource = null;
      }
    }

    return nextState;
  }
};
