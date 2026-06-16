// Game Logic Stub for Service Worker Caching
// This file is served by the backend to ensure both front-end (offline) and back-end
// use the same core logic for validations and state updates.

(function (global) {
  const GameLogic = {
    version: "1.0.0",

    // Example function: Check if a move is valid
    isValidMove(board, index, playerId) {
      if (index < 0 || index >= board.length) return false;
      if (board[index] !== null) return false;
      return true;
    },

    // Example function: Check for win conditions (5x5 grid, 5 in a row/col/diag)
    checkWinCondition(board, playerId) {
      // 5x5 board win logic here
      const size = 5;
      
      // Rows
      for (let i = 0; i < size; i++) {
        let win = true;
        for (let j = 0; j < size; j++) {
          if (board[i * size + j] !== playerId) { win = false; break; }
        }
        if (win) return true;
      }
      
      // Cols
      for (let j = 0; j < size; j++) {
        let win = true;
        for (let i = 0; i < size; i++) {
          if (board[i * size + j] !== playerId) { win = false; break; }
        }
        if (win) return true;
      }
      
      // Diagonals
      let winDiag1 = true;
      let winDiag2 = true;
      for (let i = 0; i < size; i++) {
        if (board[i * size + i] !== playerId) winDiag1 = false;
        if (board[i * size + (size - 1 - i)] !== playerId) winDiag2 = false;
      }
      
      if (winDiag1 || winDiag2) return true;

      return false;
    }
  };

  // Export based on environment (CommonJS for Node, window for browser)
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = GameLogic;
  } else {
    global.GameLogic = GameLogic;
  }
})(typeof window !== 'undefined' ? window : global);
