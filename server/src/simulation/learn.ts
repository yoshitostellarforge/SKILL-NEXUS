import fs from 'fs';
import path from 'path';
import * as admin from 'firebase-admin';
import { skills } from '../../../src/lib/skills';

const RESULTS_DIR = path.join(__dirname, '../../../simulation_results');
const SELF_PLAY_KIFU_PATH = path.join(RESULTS_DIR, 'self_play_kifu.json');
const OPENING_BOOK_PATH = path.join(RESULTS_DIR, 'opening_book.json');

// Initialize Firebase Admin SDK for download
const serviceAccountEnv = process.env.FIREBASE_SERVICE_ACCOUNT;
if (serviceAccountEnv) {
  try {
    const serviceAccount = JSON.parse(serviceAccountEnv);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log("[Firebase] Admin SDK initialized via environment service account.");
  } catch (err) {
    console.error("[Firebase] Failed to parse service account JSON:", err);
    admin.initializeApp();
  }
} else {
  try {
    admin.initializeApp();
    console.log("[Firebase] Admin SDK initialized via default credentials.");
  } catch (err) {
    console.warn("[Firebase] Could not initialize Firebase Admin SDK. Firestore download will be skipped.");
  }
}

const db = admin.apps.length > 0 ? admin.firestore() : null;

// Types
interface GameMove {
  boardBefore: string;
  player: 'A' | 'B';
  action: {
    actionType: 'placeStone' | 'useSkill';
    x?: number;
    y?: number;
    skillId?: string;
    customPayload?: any;
  };
}

interface KifuRecord {
  winner: 'A' | 'B' | 'draw';
  moves: GameMove[];
}

interface Transform {
  transformCoords(x: number, y: number): { x: number; y: number };
  transformBoard(board: any[][]): any[][];
}

// 8 Symmetries
const transforms: Transform[] = [
  // 1. Identity
  {
    transformCoords: (x, y) => ({ x, y }),
    transformBoard: (b) => b
  },
  // 2. Rotate 90
  {
    transformCoords: (x, y) => ({ x: 4 - y, y: x }),
    transformBoard: (b) => {
      const res = Array.from({ length: 5 }, () => Array(5));
      for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 5; x++) {
          res[x][4 - y] = b[y][x];
        }
      }
      return res;
    }
  },
  // 3. Rotate 180
  {
    transformCoords: (x, y) => ({ x: 4 - x, y: 4 - y }),
    transformBoard: (b) => {
      const res = Array.from({ length: 5 }, () => Array(5));
      for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 5; x++) {
          res[4 - y][4 - x] = b[y][x];
        }
      }
      return res;
    }
  },
  // 4. Rotate 270
  {
    transformCoords: (x, y) => ({ x: y, y: 4 - x }),
    transformBoard: (b) => {
      const res = Array.from({ length: 5 }, () => Array(5));
      for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 5; x++) {
          res[4 - x][y] = b[y][x];
        }
      }
      return res;
    }
  },
  // 5. Flip Horizontal
  {
    transformCoords: (x, y) => ({ x: 4 - x, y }),
    transformBoard: (b) => {
      const res = Array.from({ length: 5 }, () => Array(5));
      for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 5; x++) {
          res[y][4 - x] = b[y][x];
        }
      }
      return res;
    }
  },
  // 6. Flip Vertical
  {
    transformCoords: (x, y) => ({ x, y: 4 - y }),
    transformBoard: (b) => {
      const res = Array.from({ length: 5 }, () => Array(5));
      for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 5; x++) {
          res[4 - y][x] = b[y][x];
        }
      }
      return res;
    }
  },
  // 7. Flip Diagonal (main)
  {
    transformCoords: (x, y) => ({ x: y, y: x }),
    transformBoard: (b) => {
      const res = Array.from({ length: 5 }, () => Array(5));
      for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 5; x++) {
          res[x][y] = b[y][x];
        }
      }
      return res;
    }
  },
  // 8. Flip Diagonal (anti)
  {
    transformCoords: (x, y) => ({ x: 4 - y, y: 4 - x }),
    transformBoard: (b) => {
      const res = Array.from({ length: 5 }, () => Array(5));
      for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 5; x++) {
          res[4 - x][4 - y] = b[y][x];
        }
      }
      return res;
    }
  }
];

function serializeBoard(board: any[][]): string {
  return board.map(row => 
    row.map(cell => {
      const char = cell.type === 'circle' ? 'O' : (cell.type === 'cross' ? 'X' : '.');
      return `${char}${cell.hp}`;
    }).join(',')
  ).join('|');
}

function parseSerializedBoard(serialized: string): any[][] {
  return serialized.split('|').map(row => 
    row.split(',').map(cell => {
      const typeChar = cell[0];
      const hp = parseInt(cell.substring(1), 10);
      const type = typeChar === 'O' ? 'circle' : (typeChar === 'X' ? 'cross' : 'empty');
      return { type, hp };
    })
  );
}

// Download human kifu logs from Firestore
async function fetchFirestoreKifu(): Promise<KifuRecord[]> {
  if (!db) {
    console.log("[Firestore] Offline - skipping download.");
    return [];
  }
  try {
    console.log("[Firestore] Downloading human kifu records...");
    const snapshot = await db.collection('kifu').get();
    const records: KifuRecord[] = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.winner && data.moves) {
        records.push({
          winner: data.winner,
          moves: data.moves
        });
      }
    });
    console.log(`[Firestore] Successfully downloaded ${records.length} human matches.`);
    return records;
  } catch (err) {
    console.error("[Firestore] Error fetching kifu collection:", err);
    return [];
  }
}

// Action helpers
interface ActionObj {
  actionType: 'placeStone' | 'useSkill';
  x?: number;
  y?: number;
  skillId?: string;
  customPayload?: any;
}

function actionToString(act: ActionObj): string {
  if (act.actionType === 'placeStone') {
    return `placeStone:${act.x},${act.y}`;
  } else {
    // If it has coordinate targets
    if (act.x !== undefined && act.y !== undefined) {
      return `useSkill:${act.skillId}:${act.x},${act.y}`;
    }
    return `useSkill:${act.skillId}`;
  }
}

function stringToAction(str: string, originalPayload?: any): ActionObj {
  const parts = str.split(':');
  if (parts[0] === 'placeStone') {
    const coords = parts[1].split(',').map(Number);
    return { actionType: 'placeStone', x: coords[0], y: coords[1] };
  } else {
    const skillId = parts[1];
    if (parts[2]) {
      const coords = parts[2].split(',').map(Number);
      return { actionType: 'useSkill', skillId, x: coords[0], y: coords[1] };
    }
    return { actionType: 'useSkill', skillId, customPayload: originalPayload };
  }
}

// Core Aggregations Map: BoardHash -> ActionKey -> { wins, count }
const aggregation: {
  [boardHash: string]: {
    [actionKey: string]: { wins: number; count: number }
  }
} = {};

function addSample(boardHash: string, actionKey: string, weight: number, outcome: 'win' | 'loss' | 'draw') {
  if (!aggregation[boardHash]) {
    aggregation[boardHash] = {};
  }
  if (!aggregation[boardHash][actionKey]) {
    aggregation[boardHash][actionKey] = { wins: 0, count: 0 };
  }

  const score = outcome === 'win' ? 1.0 : (outcome === 'draw' ? 0.5 : 0.0);
  aggregation[boardHash][actionKey].wins += score * weight;
  aggregation[boardHash][actionKey].count += weight;
}

async function runLearning() {
  console.log("==========================================");
  console.log("      SKILL-NEXUS HYBRID PATTERN LEARNER  ");
  console.log("==========================================");

  // 1. Load data sources
  let humanRecords: KifuRecord[] = [];
  try {
    humanRecords = await fetchFirestoreKifu();
  } catch (e) {
    console.warn("Firestore download encountered an error, falling back to local only.");
  }

  let selfPlayRecords: KifuRecord[] = [];
  try {
    if (fs.existsSync(SELF_PLAY_KIFU_PATH)) {
      selfPlayRecords = JSON.parse(fs.readFileSync(SELF_PLAY_KIFU_PATH, 'utf-8'));
      console.log(`[Self-Play] Loaded ${selfPlayRecords.length} matches from local self_play_kifu.json`);
    } else {
      console.log("[Self-Play] No self_play_kifu.json found. Proceeding with human data only.");
    }
  } catch (e) {
    console.error("[Self-Play] Failed to read self_play_kifu.json:", e);
  }

  // 2. Process all records
  // We apply weight 3.0 to human play, 1.0 to self-play
  const processMatch = (record: KifuRecord, weight: number) => {
    const winner = record.winner;
    
    for (const move of record.moves) {
      if (!move.boardBefore || !move.action) continue;

      const board = parseSerializedBoard(move.boardBefore);

      // A. Evaluate 8 symmetries to find canonical dictionary-smallest representation
      let minSerialized = move.boardBefore;
      let bestTransformIdx = 0;

      for (let tIdx = 0; tIdx < transforms.length; tIdx++) {
        const transformedBoard = transforms[tIdx].transformBoard(board);
        const serialized = serializeBoard(transformedBoard);
        if (serialized < minSerialized) {
          minSerialized = serialized;
          bestTransformIdx = tIdx;
        }
      }

      // B. Transform the action using the same symmetry index
      const bestTransform = transforms[bestTransformIdx];
      const originalAction = move.action;
      const transformedAction: ActionObj = {
        actionType: originalAction.actionType,
        skillId: originalAction.skillId,
        customPayload: originalAction.customPayload
      };

      if (originalAction.x !== undefined && originalAction.y !== undefined) {
        const coords = bestTransform.transformCoords(originalAction.x, originalAction.y);
        transformedAction.x = coords.x;
        transformedAction.y = coords.y;
      }

      const actionKey = actionToString(transformedAction);

      // C. Record outcome
      let outcome: 'win' | 'loss' | 'draw' = 'loss';
      if (winner === 'draw') {
        outcome = 'draw';
      } else if (winner === move.player) {
        outcome = 'win';
      }

      addSample(minSerialized, actionKey, weight, outcome);
    }
  };

  console.log("[Aggregator] Processing datasets...");
  humanRecords.forEach(r => processMatch(r, 3.0));
  selfPlayRecords.forEach(r => processMatch(r, 1.0));

  // 3. Compile the Opening Book
  const openingBook: { [boardHash: string]: ActionObj } = {};
  let bookCount = 0;

  for (const boardHash of Object.keys(aggregation)) {
    const actionsMap = aggregation[boardHash];
    let bestActionKey: string | null = null;
    let bestWinRate = -1;
    let totalStateCount = 0;

    for (const actionKey of Object.keys(actionsMap)) {
      const stats = actionsMap[actionKey];
      const winRate = stats.wins / stats.count;
      totalStateCount += stats.count;

      if (winRate > bestWinRate) {
        bestWinRate = winRate;
        bestActionKey = actionKey;
      }
    }

    // Filter rules:
    // - High state reliability (e.g. cumulative state trials >= 2.0 weight equivalent)
    // - Strong winrate (> 50.0%)
    if (bestActionKey && totalStateCount >= 2.0 && bestWinRate >= 0.52) {
      const bestAction = stringToAction(bestActionKey);
      openingBook[boardHash] = bestAction;
      bookCount++;
    }
  }

  // 4. Save opening_book.json
  const resultsDir = path.dirname(OPENING_BOOK_PATH);
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }

  fs.writeFileSync(OPENING_BOOK_PATH, JSON.stringify(openingBook, null, 2));

  console.log("==========================================");
  console.log("      LEARNING SUMMARY & RESULTS          ");
  console.log("==========================================");
  console.log(`1. Opening Book entries generated: ${bookCount}`);
  console.log(`2. Output saved to: simulation_results/opening_book.json`);
  console.log("Learning process completed successfully.\n");
  
  // Exit script safely
  process.exit(0);
}

runLearning().catch(err => {
  console.error("Critical error in learning script:", err);
  process.exit(1);
});
