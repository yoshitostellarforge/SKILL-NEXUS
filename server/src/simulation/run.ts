import fs from 'fs';
import path from 'path';
import type { GameState } from '../../../src/lib/types';
import { createInitialGame, placeStone, useSkill } from '../../../src/lib/gameLogic';
import { skills } from '../../../src/lib/skills';
import { AgentGene, decideBestAction } from './evaluator';

const RESULTS_DIR = path.join(__dirname, '../../../simulation_results');
const GENERATIONS = 15;      // Number of generations to simulate
const POOL_SIZE = 20;        // Number of agents per generation
const MATCHES_PER_PAIR = 2;   // 2 matches per pair (one as A, one as B) for fairness
const MUTATION_RATE = 0.15;   // Probability of parameter mutation

/**
 * Initialize a randomized agent gene
 */
function createRandomAgent(id: string): AgentGene {
  const allSkillIds = skills.map(s => s.id);
  const draftedSkills: string[] = [];
  
  // Randomly draft 3 unique skills
  while (draftedSkills.length < 3) {
    const idx = Math.floor(Math.random() * allSkillIds.length);
    const sId = allSkillIds[idx];
    if (!draftedSkills.includes(sId)) {
      draftedSkills.push(sId);
    }
  }

  const skillWeights: { [skillId: string]: number } = {};
  for (const sId of allSkillIds) {
    skillWeights[sId] = Math.random();
  }

  return {
    id,
    attackWeight: Math.random(),
    defenseWeight: Math.random(),
    skillAggressiveness: Math.random(),
    skillWeights,
    skills: draftedSkills,
    wins: 0,
    matches: 0
  };
}

/**
 * Run a single match between two agents A and B
 * Returns the winner role 'A' | 'B' or 'draw'
 */
function playMatch(agentA: AgentGene, agentB: AgentGene): 'A' | 'B' | 'draw' {
  let state = createInitialGame();
  
  // Apply drafted skills
  state.selectedSkills.A = [...agentA.skills];
  state.selectedSkills.B = [...agentB.skills];

  let turn = 0;
  const maxTurns = 60; // Prevent infinite games

  while (!state.winner && turn < maxTurns) {
    const currentRole = state.currentPlayer;
    const currentGene = currentRole === 'A' ? agentA : agentB;
    
    // NPC decides action
    const decision = decideBestAction(state, currentRole, currentGene);

    if (decision.actionType === 'placeStone') {
      state = placeStone(state, decision.x!, decision.y!);
    } else if (decision.actionType === 'useSkill') {
      let customPayload: any = undefined;
      if (decision.skillId === 'skill_shuffle') {
        customPayload = { result: Math.floor(Math.random() * 6) + 1, shuffleOrder: Array.from({ length: 9 }, (_, i) => i).sort(() => Math.random() - 0.5) };
      }
      state = useSkill(state, decision.skillId!, { x: decision.x, y: decision.y }, customPayload);
    }

    turn++;
  }

  return state.winner || 'draw';
}

/**
 * Create a offspring agent by mixing two parents
 */
function crossover(id: string, parent1: AgentGene, parent2: AgentGene): AgentGene {
  const blend = (v1: number, v2: number) => {
    const ratio = Math.random();
    return v1 * ratio + v2 * (1 - ratio);
  };

  const attackWeight = blend(parent1.attackWeight, parent2.attackWeight);
  const defenseWeight = blend(parent1.defenseWeight, parent2.defenseWeight);
  const skillAggressiveness = blend(parent1.skillAggressiveness, parent2.skillAggressiveness);

  // Blend skill weights
  const skillWeights: { [skillId: string]: number } = {};
  const allSkillIds = skills.map(s => s.id);
  for (const sId of allSkillIds) {
    skillWeights[sId] = blend(parent1.skillWeights[sId] ?? 0.5, parent2.skillWeights[sId] ?? 0.5);
  }

  // Merge parent skills and select 3
  const pool = Array.from(new Set([...parent1.skills, ...parent2.skills]));
  const childSkills: string[] = [];
  while (childSkills.length < 3 && pool.length > 0) {
    const idx = Math.floor(Math.random() * pool.length);
    childSkills.push(pool.splice(idx, 1)[0]);
  }
  // Fill with random if pool is dry (shouldn't happen with 3+3 inputs)
  while (childSkills.length < 3) {
    const randomSkill = allSkillIds[Math.floor(Math.random() * allSkillIds.length)];
    if (!childSkills.includes(randomSkill)) childSkills.push(randomSkill);
  }

  return {
    id,
    attackWeight,
    defenseWeight,
    skillAggressiveness,
    skillWeights,
    skills: childSkills,
    wins: 0,
    matches: 0
  };
}

/**
 * Apply mutation to an agent
 */
function mutate(agent: AgentGene): AgentGene {
  const mutateVal = (v: number) => {
    const delta = (Math.random() - 0.5) * 0.2; // +/- 0.1
    return Math.max(0, Math.min(1, v + delta));
  };

  agent.attackWeight = mutateVal(agent.attackWeight);
  agent.defenseWeight = mutateVal(agent.defenseWeight);
  agent.skillAggressiveness = mutateVal(agent.skillAggressiveness);

  // Mutate skill weights
  for (const sId of Object.keys(agent.skillWeights)) {
    agent.skillWeights[sId] = mutateVal(agent.skillWeights[sId]);
  }

  // Small chance to mutate one skill for another random one
  if (Math.random() < 0.25) {
    const allSkillIds = skills.map(s => s.id);
    const replaceIdx = Math.floor(Math.random() * 3);
    let newSkill = allSkillIds[Math.floor(Math.random() * allSkillIds.length)];
    // Ensure uniqueness
    let attempts = 0;
    while (agent.skills.includes(newSkill) && attempts < 10) {
      newSkill = allSkillIds[Math.floor(Math.random() * allSkillIds.length)];
      attempts++;
    }
    agent.skills[replaceIdx] = newSkill;
  }

  return agent;
}

// Main execution loop
async function runSimulation() {
  console.log("==========================================");
  console.log("  SKILL-NEXUS GENETIC AI BALANCE SIMULATOR");
  console.log("==========================================");
  console.log(`Generations: ${GENERATIONS}`);
  console.log(`Pool Size: ${POOL_SIZE}`);
  console.log(`Output Directory: ${RESULTS_DIR}\n`);

  // Ensure results folder exists
  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  }

  // 1. Initialize first generation
  let pool: AgentGene[] = [];
  for (let i = 0; i < POOL_SIZE; i++) {
    pool.push(createRandomAgent(`g1_a${i}`));
  }

  const summaryData: any[] = [];
  const skillHistory: { [skillId: string]: { drafts: number; wins: number } } = {};
  
  // Initialize skill statistics map
  for (const s of skills) {
    skillHistory[s.id] = { drafts: 0, wins: 0 };
  }

  let logStream = fs.createWriteStream(path.join(RESULTS_DIR, 'battle_log.txt'));

  for (let gen = 1; gen <= GENERATIONS; gen++) {
    console.log(`--- Generation ${gen} / ${GENERATIONS} ---`);
    logStream.write(`\n--- Generation ${gen} ---\n`);

    // Reset scores
    for (const agent of pool) {
      agent.wins = 0;
      agent.matches = 0;
    }

    // Play matches (Round Robin)
    let matchCount = 0;
    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        const agent1 = pool[i];
        const agent2 = pool[j];

        for (let m = 0; m < MATCHES_PER_PAIR; m++) {
          const outcome = m === 0 ? playMatch(agent1, agent2) : playMatch(agent2, agent1);

          agent1.matches++;
          agent2.matches++;
          matchCount++;

          if (m === 0) {
            // m===0: agent1 is A, agent2 is B
            if (outcome === 'A') agent1.wins++;
            else if (outcome === 'B') agent2.wins++;
          } else {
            // m===1: agent2 is A, agent1 is B
            if (outcome === 'A') agent2.wins++;
            else if (outcome === 'B') agent1.wins++;
          }
        }
      }
    }

    // Sort agents by win rate
    pool.sort((a, b) => (b.wins / b.matches) - (a.wins / a.matches));

    // Gather statistics for this generation
    let avgAttack = 0;
    let avgDefense = 0;
    let avgSkillAgg = 0;
    for (const agent of pool) {
      avgAttack += agent.attackWeight;
      avgDefense += agent.defenseWeight;
      avgSkillAgg += agent.skillAggressiveness;

      // Track skill usage statistics
      for (const sId of agent.skills) {
        skillHistory[sId].drafts++;
        if (agent.wins > agent.matches * 0.5) {
          // Weighted wins for skills held by positive win-rate agents
          skillHistory[sId].wins += (agent.wins / agent.matches);
        }
      }
    }
    avgAttack /= pool.length;
    avgDefense /= pool.length;
    avgSkillAgg /= pool.length;

    const bestAgent = pool[0];
    const bestWinRate = bestAgent.wins / bestAgent.matches;

    console.log(`Best Agent: ${bestAgent.id} | Win Rate: ${(bestWinRate * 100).toFixed(1)}%`);
    console.log(`Avg Weights - Attack: ${avgAttack.toFixed(2)} | Defense: ${avgDefense.toFixed(2)} | Skill: ${avgSkillAgg.toFixed(2)}`);
    console.log(`Best Agent Skills: ${bestAgent.skills.join(", ")}\n`);

    logStream.write(`Best Agent: ${bestAgent.id} (Winrate: ${(bestWinRate * 100).toFixed(1)}%)\n`);
    logStream.write(`Best Skills: ${bestAgent.skills.join(", ")}\n`);
    logStream.write(`Avg Attack: ${avgAttack.toFixed(3)}, Avg Defense: ${avgDefense.toFixed(3)}, Avg Skill: ${avgSkillAgg.toFixed(3)}\n`);

    summaryData.push({
      generation: gen,
      bestWinRate,
      avgAttack,
      avgDefense,
      avgSkillAgg,
      bestAgentSkills: bestAgent.skills
    });

    // 4. Selection & Next Generation Setup
    if (gen < GENERATIONS) {
      const nextPool: AgentGene[] = [];

      // A. Keep the top 20% (Elite Selection)
      const eliteCount = Math.floor(POOL_SIZE * 0.20);
      for (let i = 0; i < eliteCount; i++) {
        // Clone elites
        nextPool.push({
          ...pool[i],
          id: `g${gen + 1}_elite${i}`,
          wins: 0,
          matches: 0
        });
      }

      // B. Generate children via Crossover & Mutation from the top 50%
      const parentCandidateCount = Math.floor(POOL_SIZE * 0.50);
      let childIdCounter = 0;
      while (nextPool.length < POOL_SIZE) {
        const p1Idx = Math.floor(Math.random() * parentCandidateCount);
        let p2Idx = Math.floor(Math.random() * parentCandidateCount);
        while (p1Idx === p2Idx && parentCandidateCount > 1) {
          p2Idx = Math.floor(Math.random() * parentCandidateCount);
        }

        const parent1 = pool[p1Idx];
        const parent2 = pool[p2Idx];

        let child = crossover(`g${gen + 1}_c${childIdCounter++}`, parent1, parent2);

        // Apply mutation with a specific rate
        if (Math.random() < MUTATION_RATE) {
          child = mutate(child);
        }

        nextPool.push(child);
      }

      pool = nextPool;
    }
  }

  // Close log stream
  logStream.end();

  // Write summary.json
  fs.writeFileSync(
    path.join(RESULTS_DIR, 'summary.json'),
    JSON.stringify(summaryData, null, 2)
  );

  // Write best_agent.json (the final top individual)
  const finalBest = pool[0];
  fs.writeFileSync(
    path.join(RESULTS_DIR, 'best_agent.json'),
    JSON.stringify(finalBest, null, 2)
  );

  // Calculate and write skill_stats.csv
  let csvContent = "skill_id,name,draft_count,weighted_wins,win_rate_index\n";
  for (const sId of Object.keys(skillHistory)) {
    const stat = skillHistory[sId];
    const skillName = skills.find(s => s.id === sId)?.name ?? sId;
    const winRateIndex = stat.drafts > 0 ? (stat.wins / stat.drafts).toFixed(3) : "0.000";
    csvContent += `"${sId}","${skillName}",${stat.drafts},${stat.wins.toFixed(2)},${winRateIndex}\n`;
  }
  fs.writeFileSync(
    path.join(RESULTS_DIR, 'skill_stats.csv'),
    csvContent
  );

  console.log("==========================================");
  console.log("  SIMULATION COMPLETED SUCCESSFULLY!");
  console.log("==========================================");
  console.log(`1. Summary saved to: simulation_results/summary.json`);
  console.log(`2. Best agent weights saved to: simulation_results/best_agent.json`);
  console.log(`3. Skill balance statistics saved to: simulation_results/skill_stats.csv`);
  console.log(`4. Full log output saved to: simulation_results/battle_log.txt\n`);
}

// Kick off simulation
runSimulation().catch(console.error);
