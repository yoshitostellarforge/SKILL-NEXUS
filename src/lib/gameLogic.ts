import type { GameState, Board, Cell } from './types';
import { skills } from './skills';

export function createInitialGame(): GameState {
  const board: Board = Array.from({ length: 5 }, () =>
    Array.from({ length: 5 }, () => ({
      type: 'empty',
      hp: 1,
      statusEffects: []
    }))
  );

  return {
    board,
    currentPlayer: 'A',
    costs: {
      A: 2,
      B: 2
    },
    winner: null,
    turnSkillCount: 0,
    selectedSkills: {
      A: [],
      B: []
    },
    moves: []
  };
}

export function checkWinner(board: Board): 'A' | 'B' | 'draw' | null {
  const size = board.length;
  const WIN_COUNT = 4;

  const playerSymbol = (player: 'A' | 'B') => (player === 'A' ? 'circle' : 'cross');

  // Helper check for a sequence of 4 of the same player
  const checkLine = (player: 'A' | 'B') => {
    const symbol = playerSymbol(player);

    // Horizontal check
    for (let r = 0; r < size; r++) {
      for (let c = 0; c <= size - WIN_COUNT; c++) {
        let count = 0;
        for (let i = 0; i < WIN_COUNT; i++) {
          if (board[r][c + i].type === symbol) count++;
        }
        if (count === WIN_COUNT) return true;
      }
    }

    // Vertical check
    for (let c = 0; c < size; c++) {
      for (let r = 0; r <= size - WIN_COUNT; r++) {
        let count = 0;
        for (let i = 0; i < WIN_COUNT; i++) {
          if (board[r + i][c].type === symbol) count++;
        }
        if (count === WIN_COUNT) return true;
      }
    }

    // Diagonal check (top-left to bottom-right)
    for (let r = 0; r <= size - WIN_COUNT; r++) {
      for (let c = 0; c <= size - WIN_COUNT; c++) {
        let count = 0;
        for (let i = 0; i < WIN_COUNT; i++) {
          if (board[r + i][c + i].type === symbol) count++;
        }
        if (count === WIN_COUNT) return true;
      }
    }

    // Diagonal check (bottom-left to top-right)
    for (let r = WIN_COUNT - 1; r < size; r++) {
      for (let c = 0; c <= size - WIN_COUNT; c++) {
        let count = 0;
        for (let i = 0; i < WIN_COUNT; i++) {
          if (board[r - i][c + i].type === symbol) count++;
        }
        if (count === WIN_COUNT) return true;
      }
    }

    return false;
  };

  if (checkLine('A')) return 'A';
  if (checkLine('B')) return 'B';

  // Check draw (if no empty cells left)
  let hasEmpty = false;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (board[r][c].type === 'empty') {
        hasEmpty = true;
        break;
      }
    }
  }

  if (!hasEmpty) return 'draw';

  return null;
}

export function placeStone(state: GameState, x: number, y: number): GameState {
  // If game is over or target cell is occupied, ignore
  if (state.winner || state.board[y][x].type !== 'empty') {
    return state;
  }

  const nextState: GameState = JSON.parse(JSON.stringify(state));
  const activePlayer = nextState.currentPlayer;
  const opponent = activePlayer === 'A' ? 'B' : 'A';

  // Place stone
  nextState.board[y][x].type = activePlayer === 'A' ? 'circle' : 'cross';

  // Check winner
  const winner = checkWinner(nextState.board);
  if (winner) {
    nextState.winner = winner;
    return nextState;
  }

  // Switch player, gain 1 cost for next player, and reset turn skill usage count
  nextState.currentPlayer = opponent;
  nextState.costs[opponent] += 1;
  nextState.turnSkillCount = 0;

  return nextState;
}

export function useSkill(
  state: GameState,
  skillId: string,
  target?: { x?: number; y?: number },
  customPayload?: any
): GameState {
  if (state.winner) return state;

  const skill = skills.find((s) => s.id === skillId);
  if (!skill) return state;

  const activePlayer = state.currentPlayer;
  const currentCost = state.costs[activePlayer];

  // ==========================================
  // Future Limits Check Placeholder
  // e.g. "Only 2 skills allowed per turn":
  // if (state.turnSkillCount >= 2) {
  //   return state;
  // }
  // ==========================================

  // Check if player has enough cost
  if (currentCost < skill.cost) {
    return state;
  }

  // Deduct cost and invoke execute
  const stateWithDeduction = JSON.parse(JSON.stringify(state));
  stateWithDeduction.costs[activePlayer] -= skill.cost;
  stateWithDeduction.turnSkillCount += 1;

  // Execute skill and check for win state transitions
  let nextState = skill.execute(stateWithDeduction, target, customPayload);

  // Re-evaluate win condition in case state changed
  nextState.winner = checkWinner(nextState.board);

  return nextState;
}

export function serializeBoard(board: Board): string {
  return board.map(row => 
    row.map(cell => {
      const char = cell.type === 'circle' ? 'O' : (cell.type === 'cross' ? 'X' : '.');
      return `${char}${cell.hp}`;
    }).join(',')
  ).join('|');
}

