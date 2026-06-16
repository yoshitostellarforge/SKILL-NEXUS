"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shieldSkill = void 0;
exports.shieldSkill = {
    id: 'skill_shield',
    name: '防壁',
    category: 'defense',
    description: '自分の駒のHPを+1する。',
    cost: 1,
    targetType: 'cell',
    getCellStyle(cell, x, y, state, isSelected) {
        let classes = '';
        if (cell.hp >= 2) {
            classes += 'is-shielded ';
        }
        if (isSelected) {
            const activePlayer = state.currentPlayer;
            const isOwnPiece = (activePlayer === 'A' && cell.type === 'circle') || (activePlayer === 'B' && cell.type === 'cross');
            if (isOwnPiece) {
                classes += 'skill-target-shieldable cyber-glow-cyan-border';
            }
            else {
                classes += 'skill-target-invalid';
            }
        }
        return classes.trim();
    },
    execute(state, target) {
        if (!target || target.x === undefined || target.y === undefined)
            return state;
        const { x, y } = target;
        const nextState = JSON.parse(JSON.stringify(state));
        const cell = nextState.board[y][x];
        const activePlayer = state.currentPlayer;
        const isOwnPiece = (activePlayer === 'A' && cell.type === 'circle') || (activePlayer === 'B' && cell.type === 'cross');
        if (isOwnPiece) {
            cell.hp += 1;
        }
        return nextState;
    }
};
