import fs from 'fs';
import path from 'path';
import readline from 'readline';
import type { GameState, Board, Cell } from '../../../src/lib/types';
import { createInitialGame, placeStone, useSkill } from '../../../src/lib/gameLogic';
import { skills } from '../../../src/lib/skills';
import { AgentGene, decideBestAction } from '../../../src/lib/evaluator';

const BEST_AGENT_PATH = path.join(__dirname, '../../../simulation_results/best_agent.json');

// Setup readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const askQuestion = (query: string): Promise<string> => {
  return new Promise((resolve) => rl.question(query, resolve));
};

/**
 * Load the evolved AI parameters or return default fallback values
 */
function loadBestAgent(): AgentGene {
  try {
    if (fs.existsSync(BEST_AGENT_PATH)) {
      const data = JSON.parse(fs.readFileSync(BEST_AGENT_PATH, 'utf-8'));
      console.log(`[AI] Loaded evolved AI parameters: ${data.id}`);
      return {
        ...data,
        wins: 0,
        matches: 0
      };
    }
  } catch (e) {
    console.warn("[AI] Failed to read best_agent.json. Falling back to default evolved weights.");
  }

  // Evolved default weights fallback from simulation results
  return {
    id: "g15_elite_default",
    attackWeight: 0.40,
    defenseWeight: 0.55,
    skillAggressiveness: 0.87,
    skillWeights: {
      "skill_push": 0.25,
      "skill_shuffle": 0.60,
      "skill_swap": 0.12,
      "skill_crash": 0.33,
      "skill_shield": 0.26,
      "skill_chain_bomb": 0.49
    },
    skills: ["skill_push", "skill_crash", "skill_swap"],
    wins: 0,
    matches: 0
  };
}

/**
 * Render the board on the terminal using ASCII characters
 */
function drawBoard(board: Board) {
  const size = board.length;
  console.log("\n     0     1     2     3     4  ");
  console.log("  ┌─────┬─────┬─────┬─────┬─────┐");
  for (let y = 0; y < size; y++) {
    let rowStr = `${y} │`;
    for (let x = 0; x < size; x++) {
      const cell = board[y][x];
      let char = "   ";
      if (cell.type === 'circle') char = " 〇";
      else if (cell.type === 'cross') char = "  ✕";
      
      // HP representation (e.g. 〇² or ✕¹)
      const hpIndicator = cell.type !== 'empty' ? `\x1b[2m${cell.hp}\x1b[0m` : " ";
      rowStr += `${char}${hpIndicator}│`;
    }
    console.log(rowStr);
    if (y < size - 1) {
      console.log("  ├─────┼─────┼─────┼─────┼─────┤");
    }
  }
  console.log("  └─────┴─────┴─────┴─────┴─────┘\n");
}

async function runInteractiveGame() {
  console.log("==========================================");
  console.log("  SKILL-NEXUS: HUMAN VS GENETIC AI LAB");
  console.log("==========================================\n");

  const aiGene = loadBestAgent();
  console.log(`[AI Configuration] Skills: ${aiGene.skills.map(id => skills.find(s => s.id === id)?.name).join(", ")}`);
  console.log(`[AI Configuration] Attack Weight: ${aiGene.attackWeight.toFixed(2)} | Defense Weight: ${aiGene.defenseWeight.toFixed(2)}`);

  // Choose Roles
  let userRole: 'A' | 'B' = 'A';
  console.log("\nChoose your turn:");
  console.log("1. Play as Player A (先攻 - Circle 〇)");
  console.log("2. Play as Player B (後攻 - Cross ✕)");
  const roleChoice = await askQuestion("Enter choice (1 or 2): ");
  if (roleChoice.trim() === '2') {
    userRole = 'B';
  }
  const aiRole = userRole === 'A' ? 'B' : 'A';
  console.log(`\nYou are Player ${userRole}. AI is Player ${aiRole}.\n`);

  // Draft Phase for Human
  console.log("--- SKILL DRAFT PHASE ---");
  console.log("Select 3 skills to load in your loadout:");
  skills.forEach((s, idx) => {
    console.log(`${idx + 1}. [${s.category.toUpperCase()}] ${s.name} (Cost: ${s.cost}) - ${s.description}`);
  });

  const selectedSkills: string[] = [];
  while (selectedSkills.length < 3) {
    const rawChoice = await askQuestion(`Select skill ${selectedSkills.length + 1} / 3 (Enter number 1-${skills.length}): `);
    const choiceIdx = parseInt(rawChoice) - 1;
    if (isNaN(choiceIdx) || choiceIdx < 0 || choiceIdx >= skills.length) {
      console.log("Invalid option. Please try again.");
      continue;
    }
    const skillId = skills[choiceIdx].id;
    if (selectedSkills.includes(skillId)) {
      console.log("You have already drafted this skill. Select a different one.");
      continue;
    }
    selectedSkills.push(skillId);
  }

  // Initialize game state
  let state = createInitialGame();
  state.selectedSkills[userRole] = [...selectedSkills];
  state.selectedSkills[aiRole] = [...aiGene.skills];

  console.log("\n=== COMBAT INITIALIZED ===");
  
  let turnCount = 0;
  const maxTurns = 100;

  while (!state.winner && turnCount < maxTurns) {
    drawBoard(state.board);
    const currentPlayer = state.currentPlayer;
    
    // Status Display
    console.log(`[TURN ${turnCount}] Player ${currentPlayer}'s turn`);
    console.log(`MP Cost: [Player A: ${state.costs.A}] | [Player B: ${state.costs.B}]`);
    
    if (currentPlayer === userRole) {
      // Human Turn
      console.log("\nWhat would you like to do?");
      console.log("1. Place Stone (通常配置)");
      console.log("2. Use Skill (スキル発動)");
      
      const actionChoice = await askQuestion("Enter choice (1 or 2): ");
      
      if (actionChoice.trim() === '2') {
        // Use Skill
        console.log("\nYour Available Skills:");
        const myDraftedSkills = state.selectedSkills[userRole];
        myDraftedSkills.forEach((sId, idx) => {
          const s = skills.find(sk => sk.id === sId)!;
          const affordable = state.costs[userRole] >= s.cost ? "Ready" : "Insufficient MP";
          console.log(`${idx + 1}. ${s.name} (Cost: ${s.cost}) - [${affordable}] - ${s.description}`);
        });
        console.log("0. Cancel / Back to Place Stone");

        const skillChoiceRaw = await askQuestion(`Select skill (0-${myDraftedSkills.length}): `);
        const skillIdx = parseInt(skillChoiceRaw) - 1;
        
        if (isNaN(skillIdx) || skillIdx < 0 || skillIdx >= myDraftedSkills.length) {
          console.log("Skill usage cancelled. Placing stone instead.");
          // Fallback to placing stone
          await handleHumanPlaceStone();
        } else {
          const skillId = myDraftedSkills[skillIdx];
          const skill = skills.find(sk => sk.id === skillId)!;
          if (state.costs[userRole] < skill.cost) {
            console.log("Insufficient MP. Cannot use this skill.");
            await handleHumanPlaceStone();
          } else {
            // Target prompt
            let x: number | undefined = undefined;
            let y: number | undefined = undefined;

            if (skill.targetType === 'cell') {
              console.log(`\nSkill [${skill.name}] requires a target cell (0-4).`);
              const coords = await askQuestion("Enter target coordinates as 'x y' (e.g. 2 3): ");
              const parts = coords.trim().split(/\s+/);
              x = parseInt(parts[0]);
              y = parseInt(parts[1]);
            }

            try {
              let customPayload: any = undefined;
              if (skillId === 'skill_shuffle') {
                const result = Math.floor(Math.random() * 6) + 1;
                const tempOrder = Array.from({ length: 9 }, (_, i) => i).sort(() => Math.random() - 0.5);
                customPayload = { result, shuffleOrder: tempOrder };
                console.log(`[天変地異] Shuffled cells sequence rolled: ${result}`);
              }

              state = useSkill(state, skillId, { x, y }, customPayload);
              console.log(`\n[YOU] Used Skill [${skill.name}]!`);
            } catch (err: any) {
              console.log(`Failed to execute skill: ${err.message || err}. Placed stone instead.`);
              await handleHumanPlaceStone();
            }
          }
        }
      } else {
        // Place Stone
        await handleHumanPlaceStone();
      }

      async function handleHumanPlaceStone() {
        let valid = false;
        while (!valid) {
          const coords = await askQuestion("Enter placement coordinates as 'x y' (e.g. 2 2): ");
          const parts = coords.trim().split(/\s+/);
          const px = parseInt(parts[0]);
          const py = parseInt(parts[1]);

          if (isNaN(px) || isNaN(py) || px < 0 || px > 4 || py < 0 || py > 4) {
            console.log("Invalid coordinates. Must be between 0 and 4.");
            continue;
          }

          if (state.board[py][px].type !== 'empty') {
            console.log("That cell is already occupied.");
            continue;
          }

          state = placeStone(state, px, py);
          valid = true;
          console.log(`\n[YOU] Placed stone at (${px}, ${py})`);
        }
      }

    } else {
      // AI Turn
      console.log("\n[AI] Thinking...");
      // Simulate small thinking delay
      await new Promise(res => setTimeout(res, 800));
      
      const decision = decideBestAction(state, aiRole, aiGene);
      
      if (decision.actionType === 'placeStone') {
        state = placeStone(state, decision.x!, decision.y!);
        console.log(`\n[AI] Placed stone at (${decision.x}, ${decision.y})`);
      } else if (decision.actionType === 'useSkill') {
        let customPayload: any = undefined;
        if (decision.skillId === 'skill_shuffle') {
          const result = Math.floor(Math.random() * 6) + 1;
          const tempOrder = Array.from({ length: 9 }, (_, i) => i).sort(() => Math.random() - 0.5);
          customPayload = { result, shuffleOrder: tempOrder };
          console.log(`[天変地異] AI rolled shuffle sequence: ${result}`);
        }

        const skillName = skills.find(s => s.id === decision.skillId)?.name ?? decision.skillId;
        state = useSkill(state, decision.skillId!, { x: decision.x, y: decision.y }, customPayload);
        console.log(`\n[AI] Used Skill [${skillName}]!`);
      }
    }

    turnCount++;
  }

  // Draw final board
  drawBoard(state.board);

  console.log("==========================================");
  console.log("             GAME OVER");
  console.log("==========================================");
  if (state.winner === 'draw') {
    console.log("The match ended in a DRAW!");
  } else if (state.winner === userRole) {
    console.log("🏆 CONGRATULATIONS! You defeated the Genetic AI! 🏆");
  } else {
    console.log("💀 DEFEAT! The AI successfully outplayed you. 💀");
  }
  console.log("==========================================");

  rl.close();
}

// Start game
runInteractiveGame().catch(console.error);
