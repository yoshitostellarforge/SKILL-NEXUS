"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.skills = void 0;
const pushSkill_1 = require("./pushSkill");
const shuffleSkill_1 = require("./shuffleSkill");
const swapSkill_1 = require("./swapSkill");
const crashSkill_1 = require("./crashSkill");
const shieldSkill_1 = require("./shieldSkill");
const chainBombSkill_1 = require("./chainBombSkill");
exports.skills = [
    pushSkill_1.pushSkill,
    shuffleSkill_1.shuffleSkill,
    swapSkill_1.swapSkill,
    crashSkill_1.crashSkill,
    shieldSkill_1.shieldSkill,
    chainBombSkill_1.chainBombSkill
];
