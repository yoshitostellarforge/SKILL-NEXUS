"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.crashSkill = void 0;
exports.crashSkill = {
    id: 'skill_crash',
    name: '破砕',
    category: 'attack',
    description: '指定したマスの駒のHPを1減少させる。HPが0以下になった駒は消滅する。',
    cost: 2,
    targetType: 'cell',
    getCellStyle(cell, x, y, state, isSelected) {
        if (!isSelected)
            return '';
        if (cell.type !== 'empty') {
            return 'skill-target-damageable cyber-glow-red-border';
        }
        return 'skill-target-invalid';
    },
    execute(state, target) {
        if (!target || target.x === undefined || target.y === undefined)
            return state;
        const { x, y } = target;
        const nextState = JSON.parse(JSON.stringify(state));
        const cell = nextState.board[y][x];
        if (cell.type !== 'empty') {
            cell.hp -= 1;
            if (cell.hp <= 0) {
                cell.type = 'empty';
                cell.hp = 1;
                cell.statusEffects = [];
            }
        }
        return nextState;
    }
};
