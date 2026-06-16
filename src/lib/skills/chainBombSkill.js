"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.chainBombSkill = void 0;
exports.chainBombSkill = {
    id: 'skill_chain_bomb',
    name: '連鎖爆破',
    category: 'attack',
    description: '指定マスとその上下左右の計5マスのHPをすべて1減少させる。HPが0以下になった駒は消滅する。',
    cost: 4,
    targetType: 'cell',
    getCellStyle(cell, x, y, state, isSelected) {
        if (!isSelected)
            return '';
        return 'skill-target-detonatable cyber-glow-red-border';
    },
    execute(state, target) {
        if (!target || target.x === undefined || target.y === undefined)
            return state;
        const { x, y } = target;
        const nextState = JSON.parse(JSON.stringify(state));
        // Coordinates of 5 targets
        const targetCoords = [
            { cx: x, cy: y }, // Center
            { cx: x, cy: y - 1 }, // Up
            { cx: x + 1, cy: y }, // Right
            { cx: x, cy: y + 1 }, // Down
            { cx: x - 1, cy: y } // Left
        ];
        for (const coord of targetCoords) {
            const { cx, cy } = coord;
            // Boundary check
            if (cx >= 0 && cx < 5 && cy >= 0 && cy < 5) {
                const targetCell = nextState.board[cy][cx];
                if (targetCell.type !== 'empty') {
                    targetCell.hp -= 1;
                    if (targetCell.hp <= 0) {
                        targetCell.type = 'empty';
                        targetCell.hp = 1;
                        targetCell.statusEffects = [];
                    }
                }
            }
        }
        return nextState;
    }
};
