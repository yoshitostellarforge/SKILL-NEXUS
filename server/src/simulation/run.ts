import fs from 'fs';
import path from 'path';
import type { GameState } from '../../../src/lib/types';
import { createInitialGame, placeStone, useSkill, serializeBoard } from '../../../src/lib/gameLogic';
import { skills } from '../../../src/lib/skills';
import { AgentGene, decideBestAction } from '../../../src/lib/evaluator';

const RESULTS_DIR = path.join(__dirname, '../../../simulation_results');
const POOL_SIZE = 20;        // Number of agents per generation
const MATCHES_PER_PAIR = 2;   // 2 matches per pair (one as A, one as B) for fairness
const MUTATION_RATE = 0.15;   // Probability of parameter mutation

// Dynamic generations parsing from CLI arguments
let generations = 15;
let sleepDelayMs = 10; // Default 10ms sleep to throttle CPU
const args = process.argv.slice(2);
if (args.length > 0) {
  const parsedVal = parseInt(args[0], 10);
  if (!isNaN(parsedVal) && parsedVal > 0) {
    generations = parsedVal;
  }
}
if (args.length > 1) {
  const parsedDelay = parseInt(args[1], 10);
  if (!isNaN(parsedDelay) && parsedDelay >= 0) {
    sleepDelayMs = parsedDelay;
  }
}

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
 * Returns the winner role and match moves
 */
function playMatch(agentA: AgentGene, agentB: AgentGene, openingBook?: any): { winner: 'A' | 'B' | 'draw'; moves: any[] } {
  let state = createInitialGame();
  
  // Apply drafted skills
  state.selectedSkills.A = [...agentA.skills];
  state.selectedSkills.B = [...agentB.skills];

  let turn = 0;
  const maxTurns = 60; // Prevent infinite games

  while (!state.winner && turn < maxTurns) {
    const currentRole = state.currentPlayer;
    const currentGene = currentRole === 'A' ? agentA : agentB;
    const boardBefore = serializeBoard(state.board);
    
    // Epsilon-greedy: 80% use opening book if available, 20% explore via active search
    const useBook = openingBook && (Math.random() < 0.80);

    // NPC decides action
    const decision = decideBestAction(state, currentRole, currentGene, useBook ? openingBook : undefined);

    if (decision.actionType === 'placeStone') {
      state.moves.push({
        boardBefore,
        player: currentRole,
        action: {
          actionType: 'placeStone',
          x: decision.x,
          y: decision.y
        }
      });
      state = placeStone(state, decision.x!, decision.y!);
    } else if (decision.actionType === 'useSkill') {
      let customPayload: any = undefined;
      if (decision.skillId === 'skill_shuffle') {
        customPayload = { result: Math.floor(Math.random() * 6) + 1, shuffleOrder: Array.from({ length: 9 }, (_, i) => i).sort(() => Math.random() - 0.5) };
      }
      state.moves.push({
        boardBefore,
        player: currentRole,
        action: {
          actionType: 'useSkill',
          skillId: decision.skillId,
          x: decision.x,
          y: decision.y,
          customPayload
        }
      });
      state = useSkill(state, decision.skillId!, { x: decision.x, y: decision.y }, customPayload);
    }

    turn++;
  }

  return {
    winner: state.winner || 'draw',
    moves: state.moves
  };
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
  console.log(`__dirname is: ${__dirname}`);
  console.log(`RESULTS_DIR is: ${RESULTS_DIR}`);
  console.log(`Generations: ${generations}`);
  console.log(`Pool Size: ${POOL_SIZE}`);
  console.log(`Output Directory: ${RESULTS_DIR}\n`);

  // Ensure results folder exists
  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  }

  // Load existing self-play kifu if present
  const SELF_PLAY_KIFU_PATH = path.join(RESULTS_DIR, 'self_play_kifu.json');
  console.log(`Checking if kifu file exists at ${SELF_PLAY_KIFU_PATH}...`);
  console.log(`Result of fs.existsSync: ${fs.existsSync(SELF_PLAY_KIFU_PATH)}`);
  let selfPlayKifuList: any[] = [];
  try {
    if (fs.existsSync(SELF_PLAY_KIFU_PATH)) {
      selfPlayKifuList = JSON.parse(fs.readFileSync(SELF_PLAY_KIFU_PATH, 'utf-8'));
      console.log(`[Resume] Loaded ${selfPlayKifuList.length} matches from self_play_kifu.json`);
    }
  } catch (e) {
    console.warn("Failed to load existing self_play_kifu.json. Starting fresh.");
  }

  // Load opening book to seed simulation decisions
  const OPENING_BOOK_PATH = path.join(RESULTS_DIR, 'opening_book.json');
  let openingBook: any = null;
  try {
    if (fs.existsSync(OPENING_BOOK_PATH)) {
      openingBook = JSON.parse(fs.readFileSync(OPENING_BOOK_PATH, 'utf-8'));
      console.log(`[Simulation] Loaded opening book with ${Object.keys(openingBook).length} entries to guide play (80% rate).`);
    }
  } catch (e) {
    console.log("[Simulation] No opening_book.json found or failed to parse. Running pure evaluations.");
  }

  // 1. Initialize first generation (with Resume check)
  let pool: AgentGene[] = [];
  const BEST_AGENT_PATH = path.join(RESULTS_DIR, 'best_agent.json');
  let loadedAgent: AgentGene | null = null;
  try {
    if (fs.existsSync(BEST_AGENT_PATH)) {
      loadedAgent = JSON.parse(fs.readFileSync(BEST_AGENT_PATH, 'utf-8'));
    }
  } catch (e) {
    console.warn("[Resume] Found best_agent.json but failed to parse it. Starting fresh.");
  }

  if (loadedAgent) {
    console.log(`[Resume] Found previous best agent: ${loadedAgent.id}. Resuming simulation from this champion.`);
    // A. Keep the exact best agent
    pool.push({
      ...loadedAgent,
      id: `g1_elite_resume`,
      wins: 0,
      matches: 0
    });
    // B. Add mutated clones of the best agent to explore surrounding local space
    const cloneCount = Math.floor(POOL_SIZE * 0.5) - 1;
    for (let i = 0; i < cloneCount; i++) {
      let clone = JSON.parse(JSON.stringify(loadedAgent));
      clone.id = `g1_clone_resume_${i}`;
      clone = mutate(clone);
      clone.wins = 0;
      clone.matches = 0;
      pool.push(clone);
    }
    // C. Fill the rest with random agents to keep genetic diversity high
    while (pool.length < POOL_SIZE) {
      pool.push(createRandomAgent(`g1_rand_resume_${pool.length}`));
    }
  } else {
    // Fresh run random initialization
    console.log("[Simulation] No previous agent weights found. Initializing fresh pool.");
    for (let i = 0; i < POOL_SIZE; i++) {
      pool.push(createRandomAgent(`g1_a${i}`));
    }
  }

  const summaryData: any[] = [];
  const skillHistory: { [skillId: string]: { drafts: number; wins: number } } = {};
  
  // Initialize skill statistics map
  for (const s of skills) {
    skillHistory[s.id] = { drafts: 0, wins: 0 };
  }

  let logStream = fs.createWriteStream(path.join(RESULTS_DIR, 'battle_log.txt'));

  for (let gen = 1; gen <= generations; gen++) {
    console.log(`--- Generation ${gen} / ${generations} ---`);
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
          // Asynchronous sleep for CPU throttling
          if (sleepDelayMs > 0) {
            await new Promise(resolve => setTimeout(resolve, sleepDelayMs));
          }

          const matchResult = m === 0 ? playMatch(agent1, agent2, openingBook) : playMatch(agent2, agent1, openingBook);
          const outcome = matchResult.winner;

          // Record self-play kifu
          selfPlayKifuList.push({
            winner: outcome,
            moves: matchResult.moves
          });

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

    // Save intermediate results to prevent data loss on long runs
    try {
      fs.writeFileSync(
        path.join(RESULTS_DIR, 'summary.json'),
        JSON.stringify(summaryData, null, 2)
      );

      const currentBest = pool[0];
      fs.writeFileSync(
        path.join(RESULTS_DIR, 'best_agent.json'),
        JSON.stringify(currentBest, null, 2)
      );

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

      fs.writeFileSync(
        SELF_PLAY_KIFU_PATH,
        JSON.stringify(selfPlayKifuList, null, 2)
      );
    } catch (saveErr) {
      console.error(`[Warning] Failed to write intermediate results for generation ${gen}:`, saveErr);
    }

    // 4. Selection & Next Generation Setup
    if (gen < generations) {
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

  // Final write for safety
  try {
    fs.writeFileSync(
      path.join(RESULTS_DIR, 'summary.json'),
      JSON.stringify(summaryData, null, 2)
    );

    const finalBest = pool[0];
    fs.writeFileSync(
      path.join(RESULTS_DIR, 'best_agent.json'),
      JSON.stringify(finalBest, null, 2)
    );

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

    fs.writeFileSync(
      SELF_PLAY_KIFU_PATH,
      JSON.stringify(selfPlayKifuList, null, 2)
    );
  } catch (finalSaveErr) {
    console.error("[Warning] Failed to write final results:", finalSaveErr);
  }

  console.log("==========================================");
  console.log("  SIMULATION COMPLETED SUCCESSFULLY!");
  console.log("==========================================");
  console.log(`1. Summary saved to: simulation_results/summary.json`);
  console.log(`2. Best agent weights saved to: simulation_results/best_agent.json`);
  console.log(`3. Skill balance statistics saved to: simulation_results/skill_stats.csv`);
  console.log(`4. Full log output saved to: simulation_results/battle_log.txt`);
  console.log(`5. Self-play game record (kifu) saved to: simulation_results/self_play_kifu.json\n`);
}

// Kick off simulation
runSimulation().catch(console.error);
