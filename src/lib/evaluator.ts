import type { GameState, Board, Cell } from './types';
import { placeStone, useSkill, serializeBoard } from './gameLogic';
import { skills } from './skills';

export interface AgentGene {
  id: string;
  attackWeight: number;      // Preference for aligning own stones (0.0 to 1.0)
  defenseWeight: number;     // Preference for blocking opponent (0.0 to 1.0)
  skillAggressiveness: number; // General aggressiveness to use skills (0.0 to 1.0)
  skillWeights: { [skillId: string]: number }; // Preference weight per skill ID
  skills: string[];          // List of 3 drafted skills
  wins: number;
  matches: number;
}

/**
 * Helper to analyze vertical, horizontal and diagonal lines of 4 on a 5x5 board
 * and count occurrences of line lengths (e.g. 2 stones in a line, 3 stones in a line) for a player.
 */
function evaluatePlayerStones(board: Board, player: 'A' | 'B'): { linesOf2: number; linesOf3: number; wins: number } {
  const size = board.length;
  const targetSymbol = player === 'A' ? 'circle' : 'cross';
  const oppSymbol = player === 'A' ? 'cross' : 'circle';
  
  let linesOf2 = 0;
  let linesOf3 = 0;
  let wins = 0;

  // Helper check for any 4 consecutive cells on the board
  const checkStreak = (cells: Cell[]) => {
    let ownCount = 0;
    let oppCount = 0;
    for (const c of cells) {
      if (c.type === targetSymbol) ownCount++;
      else if (c.type === oppSymbol) oppCount++;
    }

    // If there are opponent stones in this line, we cannot make 4-in-a-row here
    if (oppCount > 0) return;

    if (ownCount === 4) wins++;
    else if (ownCount === 3) linesOf3++;
    else if (ownCount === 2) linesOf2++;
  };

  // Horizontal lines of 4
  for (let r = 0; r < size; r++) {
    for (let c = 0; c <= size - 4; c++) {
      checkStreak([board[r][c], board[r][c+1], board[r][c+2], board[r][c+3]]);
    }
  }

  // Vertical lines of 4
  for (let c = 0; c < size; c++) {
    for (let r = 0; r <= size - 4; r++) {
      checkStreak([board[r][c], board[r+1][c], board[r+2][c], board[r+3][c]]);
    }
  }

  // Diagonals (top-left to bottom-right)
  for (let r = 0; r <= size - 4; r++) {
    for (let c = 0; c <= size - 4; c++) {
      checkStreak([board[r][c], board[r+1][c+1], board[r+2][c+2], board[r+3][c+3]]);
    }
  }

  // Diagonals (bottom-left to top-right)
  for (let r = 3; r < size; r++) {
    for (let c = 0; c <= size - 4; c++) {
      checkStreak([board[r][c], board[r-1][c+1], board[r-2][c+2], board[r-3][c+3]]);
    }
  }

  return { linesOf2, linesOf3, wins };
}

/**
 * Rate the current board state for the given player role
 */
export function evaluateBoardScore(board: Board, player: 'A' | 'B', gene: AgentGene): number {
  const opponent = player === 'A' ? 'B' : 'A';

  const own = evaluatePlayerStones(board, player);
  const opp = evaluatePlayerStones(board, opponent);

  if (own.wins > 0) return 100000; // Winning condition
  if (opp.wins > 0) return -100000; // Opponent winning

  // Calculate scores based on weights
  const attackScore = (own.linesOf3 * 800) + (own.linesOf2 * 50);
  const defenseScore = (opp.linesOf3 * 900) + (opp.linesOf2 * 40);

  return (attackScore * gene.attackWeight) - (defenseScore * gene.defenseWeight);
}

export interface DecidedAction {
  actionType: 'placeStone' | 'useSkill';
  x?: number;
  y?: number;
  skillId?: string;
  score: number;
}

interface Coord { x: number; y: number }
interface Symmetry {
  transform: (x: number, y: number) => Coord;
  invert: (x: number, y: number) => Coord;
  transformBoard: (b: Board) => Board;
}

const symmetries: Symmetry[] = [
  // 1. Identity
  {
    transform: (x, y) => ({ x, y }),
    invert: (x, y) => ({ x, y }),
    transformBoard: (b) => b
  },
  // 2. Rotate 90
  {
    transform: (x, y) => ({ x: 4 - y, y: x }),
    invert: (x, y) => ({ x: y, y: 4 - x }),
    transformBoard: (b) => {
      const res = Array.from({ length: 5 }, () => Array(5)) as any;
      for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 5; x++) res[x][4 - y] = b[y][x];
      }
      return res;
    }
  },
  // 3. Rotate 180
  {
    transform: (x, y) => ({ x: 4 - x, y: 4 - y }),
    invert: (x, y) => ({ x: 4 - x, y: 4 - y }),
    transformBoard: (b) => {
      const res = Array.from({ length: 5 }, () => Array(5)) as any;
      for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 5; x++) res[4 - y][4 - x] = b[y][x];
      }
      return res;
    }
  },
  // 4. Rotate 270
  {
    transform: (x, y) => ({ x: y, y: 4 - x }),
    invert: (x, y) => ({ x: 4 - y, y: x }),
    transformBoard: (b) => {
      const res = Array.from({ length: 5 }, () => Array(5)) as any;
      for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 5; x++) res[4 - x][y] = b[y][x];
      }
      return res;
    }
  },
  // 5. Flip Horizontal
  {
    transform: (x, y) => ({ x: 4 - x, y }),
    invert: (x, y) => ({ x: 4 - x, y }),
    transformBoard: (b) => {
      const res = Array.from({ length: 5 }, () => Array(5)) as any;
      for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 5; x++) res[y][4 - x] = b[y][x];
      }
      return res;
    }
  },
  // 6. Flip Vertical
  {
    transform: (x, y) => ({ x, y: 4 - y }),
    invert: (x, y) => ({ x, y: 4 - y }),
    transformBoard: (b) => {
      const res = Array.from({ length: 5 }, () => Array(5)) as any;
      for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 5; x++) res[4 - y][x] = b[y][x];
      }
      return res;
    }
  },
  // 7. Flip Diagonal (main)
  {
    transform: (x, y) => ({ x: y, y: x }),
    invert: (x, y) => ({ x: y, y: x }),
    transformBoard: (b) => {
      const res = Array.from({ length: 5 }, () => Array(5)) as any;
      for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 5; x++) res[x][y] = b[y][x];
      }
      return res;
    }
  },
  // 8. Flip Diagonal (anti)
  {
    transform: (x, y) => ({ x: 4 - y, y: 4 - x }),
    invert: (x, y) => ({ x: 4 - y, y: 4 - x }),
    transformBoard: (b) => {
      const res = Array.from({ length: 5 }, () => Array(5)) as any;
      for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 5; x++) res[4 - x][4 - y] = b[y][x];
      }
      return res;
    }
  }
];

function getCandidateMoves(board: Board): { x: number; y: number }[] {
  const size = board.length;
  const candidates: { x: number; y: number }[] = [];
  let hasStones = false;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (board[y][x].type !== 'empty') {
        hasStones = true;
        break;
      }
    }
    if (hasStones) break;
  }

  // If board is empty, evaluate all cells (usually just the center or few cells, but all is safe)
  if (!hasStones) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        candidates.push({ x, y });
      }
    }
    return candidates;
  }

  // Otherwise, only evaluate empty cells adjacent (within 1 step) to any existing stones
  const visited = new Set<string>();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (board[y][x].type !== 'empty') {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const ny = y + dy;
            const nx = x + dx;
            if (ny >= 0 && ny < size && nx >= 0 && nx < size) {
              if (board[ny][nx].type === 'empty') {
                const key = `${nx},${ny}`;
                if (!visited.has(key)) {
                  visited.add(key);
                  candidates.push({ x: nx, y: ny });
                }
              }
            }
          }
        }
      }
    }
  }

  return candidates;
}

function evaluateStonePlacementWithLookahead(
  state: GameState,
  x: number,
  y: number,
  role: 'A' | 'B',
  gene: AgentGene
): number {
  const testState = placeStone(state, x, y);
  
  if (testState.winner === role) {
    return 100000; // Immediate win
  }
  if (testState.winner === 'draw') {
    return 0;
  }
  if (testState.winner) {
    return -100000; // Immediate loss (should not happen normally since it's our turn)
  }

  // Simulate opponent's turn (1 step lookahead response)
  const opponent = role === 'A' ? 'B' : 'A';
  let opponentBestScore = -Infinity;
  let opponentBestState = testState;
  let hasOpponentMoves = false;

  // Filter opponent response candidates to adjacent empty cells
  const oppCandidates = getCandidateMoves(testState.board);
  for (const coord of oppCandidates) {
    hasOpponentMoves = true;
    const oppState = placeStone(testState, coord.x, coord.y);
    const oppScore = evaluateBoardScore(oppState.board, opponent, gene);
    if (oppScore > opponentBestScore) {
      opponentBestScore = oppScore;
      opponentBestState = oppState;
    }
  }

  // If opponent has no empty cells to place, evaluate current board
  if (!hasOpponentMoves) {
    return evaluateBoardScore(testState.board, role, gene);
  }

  // Return the score from our perspective after opponent's best response
  return evaluateBoardScore(opponentBestState.board, role, gene);
}

/**
 * Determine the next best action for the NPC agent
 */
export function decideBestAction(
  state: GameState, 
  role: 'A' | 'B', 
  gene: AgentGene,
  openingBook?: { [boardHash: string]: any }
): DecidedAction {
  // Query Opening Book if provided
  if (openingBook) {
    const rawSerialized = serializeBoard(state.board);
    let minSerialized = rawSerialized;
    let bestSymIdx = 0;

    for (let i = 0; i < symmetries.length; i++) {
      const transBoard = symmetries[i].transformBoard(state.board);
      const serialized = serializeBoard(transBoard);
      if (serialized < minSerialized) {
        minSerialized = serialized;
        bestSymIdx = i;
      }
    }

    if (openingBook[minSerialized]) {
      const canonicalAction = openingBook[minSerialized];
      const selectedSym = symmetries[bestSymIdx];

      const decodedAction: DecidedAction = {
        actionType: canonicalAction.actionType,
        skillId: canonicalAction.skillId,
        score: 999999 // High score to denote opening book selection
      };

      if (canonicalAction.x !== undefined && canonicalAction.y !== undefined) {
        const restored = selectedSym.invert(canonicalAction.x, canonicalAction.y);
        decodedAction.x = restored.x;
        decodedAction.y = restored.y;
      }

      return decodedAction;
    }
  }

  const size = state.board.length;
  const currentCost = state.costs[role];
  
  let bestAction: DecidedAction = {
    actionType: 'placeStone',
    x: 0,
    y: 0,
    score: -Infinity
  };

  // 1. Evaluate normal stone placement options
  const candidates = getCandidateMoves(state.board);
  for (const coord of candidates) {
    const { x, y } = coord;
    const score = evaluateStonePlacementWithLookahead(state, x, y, role, gene);
    
    if (score > bestAction.score) {
      bestAction = {
        actionType: 'placeStone',
        x,
        y,
        score
      };
    }
  }

  // 2. Evaluate skill usage options (only if we have drafted skills and enough cost)
  if (gene.skillAggressiveness > 0.1) {
    for (const skillId of gene.skills) {
      const skill = skills.find(s => s.id === skillId);
      if (!skill || currentCost < skill.cost) continue;

      const skillPref = gene.skillWeights[skillId] ?? 0.5;
      const baseSkillBonus = skillPref * 300 * gene.skillAggressiveness;

      // Handle target types
      if (skill.targetType === 'global' || skill.targetType === 'player' || skill.targetType === 'opponent') {
        // Simple direct simulation
        let customPayload: any = undefined;
        if (skillId === 'skill_shuffle') {
          // Mock shuffle payload
          customPayload = { result: 3, shuffleOrder: Array.from({ length: 9 }, (_, i) => i) };
        }
        
        try {
          const testState = useSkill(state, skillId, undefined, customPayload);
          const boardScore = evaluateBoardScore(testState.board, role, gene);
          const totalScore = boardScore + baseSkillBonus;

          if (totalScore > bestAction.score) {
            bestAction = {
              actionType: 'useSkill',
              skillId,
              score: totalScore
            };
          }
        } catch (e) {
          // Ignore failed skill execution simulations
        }
      } else if (skill.targetType === 'cell') {
        // Simulate cell targeting skill on every non-empty board cell
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            if (state.board[y][x].type !== 'empty') {
              try {
                const testState = useSkill(state, skillId, { x, y });
                const boardScore = evaluateBoardScore(testState.board, role, gene);
                const totalScore = boardScore + baseSkillBonus;

                if (totalScore > bestAction.score) {
                  bestAction = {
                    actionType: 'useSkill',
                    x,
                    y,
                    skillId,
                    score: totalScore
                  };
                }
              } catch (e) {
                // Ignore failed coordinate skill simulations
              }
            }
          }
        }
      }
    }
  }

  return bestAction;
}
