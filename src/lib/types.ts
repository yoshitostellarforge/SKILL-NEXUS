export interface Cell {
  type: 'empty' | 'circle' | 'cross';
  hp: number;
  statusEffects: string[];
}

export type Board = Cell[][];

export interface GameMove {
  b: string; // boardBefore
  p: 'A' | 'B'; // player
  a: { // action
    t: 'p' | 's'; // actionType ('p' = 'placeStone', 's' = 'useSkill')
    x?: number;
    y?: number;
    s?: string; // skillId
    pay?: any; // customPayload
  };
}

export interface GameState {
  board: Board;
  currentPlayer: 'A' | 'B';
  costs: {
    A: number;
    B: number;
  };
  winner: 'A' | 'B' | 'draw' | null;
  turnSkillCount: number;
  selectedSkills: {
    A: string[];
    B: string[];
  };
  moves: GameMove[];
  // Temporary coordinates for swap selection source
  swapSource?: { x: number; y: number } | null;
  // Dice roll values for shuffle randomized outcomes
  activeDiceRoll?: {
    isRolling: boolean;
    result: number;
  } | null;
}

export interface SkillModule {
  id: string;
  name: string;
  description: string;
  category: 'attack' | 'defense' | 'utility' | 'buff';
  cost: number;
  targetType: 'cell' | 'player' | 'opponent' | 'global';
  getCellStyle(cell: Cell, x: number, y: number, state: GameState, isSelected: boolean): string;
  execute(state: GameState, target?: { x?: number; y?: number }, customPayload?: any): GameState;
}

export interface JoinQueuePayload {
  matchType: 'room' | 'casual' | 'ranked';
  roomCode?: string; // used when matchType is 'room'
  playerName: string;
}

export interface GameActionPayload {
  actionType: 'placeStone' | 'useSkill';
  x?: number;
  y?: number;
  skillId?: string;
  customPayload?: any;
}
