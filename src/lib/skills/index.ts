import type { SkillModule } from '../types';
import { pushSkill } from './pushSkill';
import { shuffleSkill } from './shuffleSkill';
import { swapSkill } from './swapSkill';
import { crashSkill } from './crashSkill';
import { shieldSkill } from './shieldSkill';
import { chainBombSkill } from './chainBombSkill';

export const skills: SkillModule[] = [
  pushSkill,
  shuffleSkill,
  swapSkill,
  crashSkill,
  shieldSkill,
  chainBombSkill
];
