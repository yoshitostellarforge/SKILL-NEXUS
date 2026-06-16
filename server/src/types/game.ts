export type PlayerId = 'player1' | 'player2';

export interface PlayerState {
  hp: number;
  mp: number;
  skills: any[]; // Adjust according to your skill type
}

export type CellState = PlayerId | null;
export type BoardState = CellState[]; // Expected length 25 for 5x5 board

export interface GameState {
  board: BoardState;
  players: Record<PlayerId, PlayerState>;
  currentTurn: PlayerId;
  gameMode: 'online' | 'offline';
  status: 'waiting' | 'playing' | 'finished';
  winner: PlayerId | null;
}

export interface JoinQueuePayload {
  matchType: 'room' | 'casual' | 'ranked';
  roomCode?: string; // used when matchType is 'room'
  playerName: string;
  playerId: string;
}

export interface GameActionPayload {
  actionType: 'placeStone' | 'useSkill';
  x?: number;
  y?: number;
  skillId?: string;
}
