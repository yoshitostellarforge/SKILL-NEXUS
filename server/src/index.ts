// @ts-ignore: IDE may not recognize esModuleInterop from the nested tsconfig
import express, { Request, Response } from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import fs from 'fs';
import { JoinQueuePayload, GameActionPayload } from './types/game';
import * as admin from 'firebase-admin';
import { glicko2 } from 'glicko2-lite';

// Initialize Firebase Admin SDK
const serviceAccountEnv = process.env.FIREBASE_SERVICE_ACCOUNT;
if (serviceAccountEnv) {
  try {
    const serviceAccount = JSON.parse(serviceAccountEnv);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log("Firebase Admin SDK initialized successfully via service account env.");
  } catch (err) {
    console.error("Failed to parse FIREBASE_SERVICE_ACCOUNT environment variable:", err);
    admin.initializeApp();
  }
} else {
  try {
    admin.initializeApp();
    console.log("Firebase Admin SDK initialized via default credentials.");
  } catch (err) {
    console.warn("Firebase Admin SDK could not be initialized. Rating updates will be skipped locally.");
  }
}

const db = admin.apps.length > 0 ? admin.firestore() : null;

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

interface RoomData {
  roomCode: string;
  players: { socketId: string; playerName: string; role: 'A' | 'B'; playerId: string; connected: boolean }[];
  state: any;
  draft: { A: { ready: boolean; skills: string[] }; B: { ready: boolean; skills: string[] } };
  rematch: { A: boolean; B: boolean };
  disconnectTimeout?: any;
  moves: GameMove[];
}
const rooms = new Map<string, RoomData>();

interface QueuePlayer {
  socketId: string;
  playerName: string;
  playerId: string;
}
const casualQueue: QueuePlayer[] = [];

interface RankedQueuePlayer {
  socketId: string;
  playerName: string;
  playerId: string;
  rating: number;
  rd: number;
  volatility: number;
  enteredAt: number;
}
const rankedQueue: RankedQueuePlayer[] = [];

function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 5; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return code;
}

// Ranked Matchmaking Polling Loop
setInterval(() => {
  if (rankedQueue.length < 2) return;

  const now = Date.now();
  
  for (let i = 0; i < rankedQueue.length; i++) {
    const p1 = rankedQueue[i];
    const elapsed1 = (now - p1.enteredAt) / 1000;
    const allowedDiff1 = 100 + (elapsed1 * 10); // Starts at ±100, increases by ±10 per second

    for (let j = i + 1; j < rankedQueue.length; j++) {
      const p2 = rankedQueue[j];
      const elapsed2 = (now - p2.enteredAt) / 1000;
      const allowedDiff2 = 100 + (elapsed2 * 10);

      const ratingDiff = Math.abs(p1.rating - p2.rating);

      if (ratingDiff <= allowedDiff1 && ratingDiff <= allowedDiff2) {
        // Match found, remove from queue
        rankedQueue.splice(j, 1);
        rankedQueue.splice(i, 1);

        const roomCode = generateRoomCode();
        console.log(`Ranked Match matched! Room ${roomCode} for A:${p1.playerName} (${p1.rating}) and B:${p2.playerName} (${p2.rating})`);

        const newRoom: RoomData = {
          roomCode,
          players: [
            { socketId: p1.socketId, playerName: p1.playerName, role: 'A', playerId: p1.playerId, connected: true },
            { socketId: p2.socketId, playerName: p2.playerName, role: 'B', playerId: p2.playerId, connected: true }
          ],
          state: {
            ...createInitialState(),
            isRanked: true,
            ratingUpdated: false
          },
          draft: { A: { ready: false, skills: [] }, B: { ready: false, skills: [] } },
          rematch: { A: false, B: false },
          moves: []
        };
        rooms.set(roomCode, newRoom);

        const s1 = io.sockets.sockets.get(p1.socketId);
        const s2 = io.sockets.sockets.get(p2.socketId);
        if (s1) s1.join(roomCode);
        if (s2) s2.join(roomCode);

        // Emit game:init with player ratings and RDs
        io.to(roomCode).emit('game:init', { 
          roomCode, 
          state: newRoom.state, 
          players: newRoom.players.map(p => {
            const isP1 = p.playerId === p1.playerId;
            return {
              ...p,
              rating: isP1 ? p1.rating : p2.rating,
              rd: isP1 ? p1.rd : p2.rd,
              volatility: isP1 ? p1.volatility : p2.volatility
            };
          })
        });
        return;
      }
    }
  }
}, 2000);

// Memory rating cache for local testing / when Firestore database is offline
const localRatingCache = new Map<string, { rating: number; rd: number; volatility: number }>();

async function updatePlayerGlicko(winnerId: string, loserId: string, isDraw: boolean = false) {
  let rA = 1500;
  let rdA = 350;
  let volA = 0.06;

  let rB = 1500;
  let rdB = 350;
  let volB = 0.06;

  let loadedFromFirestore = false;

  // 1. Try loading latest stats from Firestore
  if (db) {
    try {
      const winnerRef = db.collection('users').doc(winnerId);
      const loserRef = db.collection('users').doc(loserId);
      const [winnerSnap, loserSnap] = await Promise.all([winnerRef.get(), loserRef.get()]);

      const winnerData = winnerSnap.exists ? winnerSnap.data() : {};
      const loserData = loserSnap.exists ? loserSnap.data() : {};

      rA = winnerData?.rating ?? 1500;
      rdA = winnerData?.rd ?? 350;
      volA = winnerData?.volatility ?? 0.06;

      rB = loserData?.rating ?? 1500;
      rdB = loserData?.rd ?? 350;
      volB = loserData?.volatility ?? 0.06;
      loadedFromFirestore = true;
    } catch (err) {
      console.warn("Failed to load ratings from Firestore. Using local cache fallback:", err);
    }
  }

  // Fallback to local memory cache if Firestore load was skipped or failed
  if (!loadedFromFirestore) {
    const cachedA = localRatingCache.get(winnerId);
    if (cachedA) {
      rA = cachedA.rating;
      rdA = cachedA.rd;
      volA = cachedA.volatility;
    }
    const cachedB = localRatingCache.get(loserId);
    if (cachedB) {
      rB = cachedB.rating;
      rdB = cachedB.rd;
      volB = cachedB.volatility;
    }
  }

  // 2. Perform Glicko-2 rating updates
  const scoreA = isDraw ? 0.5 : 1;
  const scoreB = isDraw ? 0.5 : 0;

  const newA = glicko2(rA, rdA, volA, [[rB, rdB, scoreA]]);
  const newB = glicko2(rB, rdB, volB, [[rA, rdA, scoreB]]);

  const roundedNewARating = Math.round(newA.rating);
  const roundedNewARd = Math.round(newA.rd);
  const roundedNewBRating = Math.round(newB.rating);
  const roundedNewBRd = Math.round(newB.rd);

  // 3. Try saving new stats to Firestore
  let savedToFirestore = false;
  if (db) {
    try {
      const winnerRef = db.collection('users').doc(winnerId);
      const loserRef = db.collection('users').doc(loserId);
      await Promise.all([
        winnerRef.set({
          rating: roundedNewARating,
          rd: roundedNewARd,
          volatility: newA.vol
        }, { merge: true }),
        loserRef.set({
          rating: roundedNewBRating,
          rd: roundedNewBRd,
          volatility: newB.vol
        }, { merge: true })
      ]);
      savedToFirestore = true;
    } catch (err) {
      console.error("Failed to save Glicko-2 ratings to Firestore:", err);
    }
  }

  // Always sync local memory cache so it contains the updated values
  localRatingCache.set(winnerId, { rating: roundedNewARating, rd: roundedNewARd, volatility: newA.vol });
  localRatingCache.set(loserId, { rating: roundedNewBRating, rd: roundedNewBRd, volatility: newB.vol });

  console.log(`${savedToFirestore ? 'Firestore' : 'Local Memory'} Glicko-2 Rating Updated:
    Winner(${winnerId}): ${rA} (±${rdA}) -> ${roundedNewARating} (±${roundedNewARd})
    Loser(${loserId}): ${rB} (±${rdB}) -> ${roundedNewBRating} (±${roundedNewBRd})`);

  return {
    winner: {
      oldRating: rA,
      oldRd: rdA,
      newRating: roundedNewARating,
      newRd: roundedNewARd
    },
    loser: {
      oldRating: rB,
      oldRd: rdB,
      newRating: roundedNewBRating,
      newRd: roundedNewBRd
    }
  };
}

async function saveKifuToFirestore(room: RoomData, winnerRole: 'A' | 'B' | 'draw') {
  if (!db) return;
  if (!room.moves || room.moves.length === 0) return;

  try {
    const playerA = room.players.find(p => p.role === 'A');
    const playerB = room.players.find(p => p.role === 'B');

    await db.collection('kifu').add({
      roomCode: room.roomCode,
      players: {
        A: playerA ? { playerId: playerA.playerId, playerName: playerA.playerName } : null,
        B: playerB ? { playerId: playerB.playerId, playerName: playerB.playerName } : null
      },
      winner: winnerRole,
      moves: room.moves,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log(`Successfully saved match kifu to Firestore for room ${room.roomCode}`);
  } catch (err) {
    console.error("Failed to save match kifu to Firestore:", err);
  }
}

function createInitialState() {
  return {
    board: Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => ({ type: 'empty', hp: 1, statusEffects: [] }))),
    currentPlayer: 'A',
    costs: { A: 2, B: 2 },
    winner: null,
    turnSkillCount: 0,
    selectedSkills: { A: [], B: [] }
  };
}

// @ts-ignore
const app = express();
const server = http.createServer(app);

// Determine environments
const isProduction = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT || 3000;

// Setup CORS for Socket.io
const io = new Server(server, {
  cors: {
    origin: '*', // allow all to connect for online play / testing
    methods: ['GET', 'POST']
  }
});

// Setup Express middleware to allow CORS for static files
// @ts-ignore
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// Serve static files from /public directory
const publicPath = path.join(__dirname, '../public');
// @ts-ignore
app.use('/public', express.static(publicPath));

// Socket.io event handling
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
    
    // Remove from casual queue if present
    const qIndex = casualQueue.findIndex(p => p.socketId === socket.id);
    if (qIndex !== -1) {
      console.log(`Removing disconnected client from casual queue: ${socket.id}`);
      casualQueue.splice(qIndex, 1);
    }

    // Remove from ranked queue if present
    const rqIndex = rankedQueue.findIndex(p => p.socketId === socket.id);
    if (rqIndex !== -1) {
      console.log(`Removing disconnected client from ranked queue: ${socket.id}`);
      rankedQueue.splice(rqIndex, 1);
    }
    
    // Find room the socket was in
    for (const [roomCode, room] of rooms.entries()) {
      const pIndex = room.players.findIndex(p => p.socketId === socket.id);
      if (pIndex !== -1) {
        const player = room.players[pIndex];
        
        // If room only has 1 player or hasn't started properly yet, just clean it up
        if (room.players.length < 2 || !room.state) {
          console.log(`Cleaning up incomplete room: ${roomCode}`);
          rooms.delete(roomCode);
        } else {
          // If active match, initiate 15 seconds grace period
          player.connected = false;
          console.log(`Player ${player.playerName} (${player.role}) disconnected. Starting 15s grace period.`);
          
          socket.to(roomCode).emit('player:disconnected', {
            role: player.role,
            playerName: player.playerName,
            timeoutMs: 15000
          });
          
          if (room.disconnectTimeout) {
            clearTimeout(room.disconnectTimeout);
          }
          
          room.disconnectTimeout = setTimeout(async () => {
            console.log(`Reconnection timeout expired for player in room: ${roomCode}`);
            const remainingPlayer = room.players.find(p => p.connected);
            const disconnectedPlayer = room.players.find(p => !p.connected);
            if (remainingPlayer && disconnectedPlayer) {
              // Save kifu to Firestore
              if (room.state && !room.state.kifuSaved) {
                room.state.kifuSaved = true;
                await saveKifuToFirestore(room, remainingPlayer.role);
              }

              let ratingResult = null;
              if (room.state && room.state.isRanked && !room.state.ratingUpdated) {
                room.state.ratingUpdated = true;
                ratingResult = await updatePlayerGlicko(remainingPlayer.playerId, disconnectedPlayer.playerId, false);
              }

              io.to(roomCode).emit('game:opponent_abandoned', {
                winnerRole: remainingPlayer.role,
                playerName: remainingPlayer.playerName,
                ratingResult
              });
            }
            rooms.delete(roomCode);
          }, 15000);
        }
        break;
      }
    }
  });

  // Latency / connection test
  socket.on('pingTest', (startTime: number) => {
    socket.emit('pongTest', startTime);
  });

  // Reconnection handler
  socket.on('reconnectRoom', (payload: { roomCode: string; playerId: string }) => {
    const roomCode = payload.roomCode.toUpperCase();
    const room = rooms.get(roomCode);
    if (room) {
      const player = room.players.find(p => p.playerId === payload.playerId);
      if (player) {
        // Re-bind player to this socket
        player.socketId = socket.id;
        player.connected = true;
        socket.join(roomCode);
        
        console.log(`Player ${player.playerName} (${player.role}) reconnected to room ${roomCode}`);
        
        if (room.disconnectTimeout) {
          clearTimeout(room.disconnectTimeout);
          room.disconnectTimeout = null;
        }
        
        // Notify other player
        socket.to(roomCode).emit('player:reconnected', { role: player.role });
        
        // Restore state to reconnecting player
        socket.emit('game:restore', {
          roomCode: room.roomCode,
          state: room.state,
          players: room.players.map(p => ({
            playerName: p.playerName,
            role: p.role,
            playerId: p.playerId,
            connected: p.connected
          })),
          draft: room.draft,
          rematch: room.rematch,
          myRole: player.role
        });
      } else {
        socket.emit('roomError', { message: 'Player not found in this room.' });
      }
    } else {
      socket.emit('roomError', { message: 'Room not found for reconnection.' });
    }
  });

  // Matchmaking: Join Queue
  socket.on('joinQueue', async (payload: JoinQueuePayload) => {
    // 1. 同一 playerId のプレイヤーがすでにアクティブなルームに存在するか二重ログインチェック
    for (const [roomCode, room] of rooms.entries()) {
      const activePlayer = room.players.find(p => p.playerId === payload.playerId && p.connected);
      if (activePlayer) {
        socket.emit('roomError', { message: 'このアカウントはすでに別のタブでオンライン対戦中か、ロビーに接続しています。' });
        return;
      }
    }

    // 2. 同一 playerId のプレイヤーがすでにカジュアル待機キューにいるかチェック
    if (casualQueue.some(p => p.playerId === payload.playerId)) {
      socket.emit('roomError', { message: 'すでにこのアカウントでマッチング待機中です。' });
      return;
    }

    // 3. 同一 playerId のプレイヤーがすでにランク待機キューにいるかチェック
    if (rankedQueue.some(p => p.playerId === payload.playerId)) {
      socket.emit('roomError', { message: 'すでにこのアカウントでマッチング待機中です。' });
      return;
    }

    if (payload.matchType === 'room') {
      if (payload.roomCode) {
        // Join existing room
        const roomCode = payload.roomCode.toUpperCase();
        const room = rooms.get(roomCode);
        if (room && room.players.length === 1) {
          room.players.push({
            socketId: socket.id,
            playerName: payload.playerName,
            role: 'B',
            playerId: payload.playerId,
            connected: true
          });
          socket.join(roomCode);
          console.log(`Player ${payload.playerName} joined room ${roomCode}`);

          // Trigger match start
          room.state = createInitialState();
          io.to(roomCode).emit('game:init', { roomCode, state: room.state, players: room.players });
        } else {
          socket.emit('roomError', { message: '指定されたルームが見つからないか、すでに満員です。' });
        }
      } else {
        // Create new room
        const roomCode = generateRoomCode();
        rooms.set(roomCode, {
          roomCode,
          players: [{
            socketId: socket.id,
            playerName: payload.playerName,
            role: 'A',
            playerId: payload.playerId,
            connected: true
          }],
          state: null,
          draft: { A: { ready: false, skills: [] }, B: { ready: false, skills: [] } },
          rematch: { A: false, B: false },
          moves: []
        });
        socket.join(roomCode);
        console.log(`Player ${payload.playerName} created room ${roomCode}`);
        socket.emit('roomCreated', { roomCode });
      }
    } else if (payload.matchType === 'casual') {
      // カジュアル（ランダム）マッチング処理
      console.log(`Player ${payload.playerName} entered casual queue: ${socket.id}`);
      casualQueue.push({
        socketId: socket.id,
        playerName: payload.playerName,
        playerId: payload.playerId
      });

      // 2人以上揃ったらマッチング成立
      if (casualQueue.length >= 2) {
        const player1 = casualQueue.shift()!;
        const player2 = casualQueue.shift()!;

        const roomCode = generateRoomCode();
        console.log(`Casual Match matched! Creating room ${roomCode} for A:${player1.playerName} and B:${player2.playerName}`);

        const newRoom: RoomData = {
          roomCode,
          players: [
            { socketId: player1.socketId, playerName: player1.playerName, role: 'A', playerId: player1.playerId, connected: true },
            { socketId: player2.socketId, playerName: player2.playerName, role: 'B', playerId: player2.playerId, connected: true }
          ],
          state: createInitialState(),
          draft: { A: { ready: false, skills: [] }, B: { ready: false, skills: [] } },
          rematch: { A: false, B: false },
          moves: []
        };
        rooms.set(roomCode, newRoom);

        // 両ソケットをRoomに参加させて初期化イベントを送信
        const s1 = io.sockets.sockets.get(player1.socketId);
        const s2 = io.sockets.sockets.get(player2.socketId);
        if (s1) s1.join(roomCode);
        if (s2) s2.join(roomCode);

        io.to(roomCode).emit('game:init', { roomCode, state: newRoom.state, players: newRoom.players });
      }
    } else if (payload.matchType === 'ranked') {
      // ランクマッチング処理
      console.log(`Player ${payload.playerName} entered ranked queue: ${socket.id}`);
      
      // Firestore から最新の Glicko-2 パラメータを取得
      let rating = 1500;
      let rd = 350;
      let volatility = 0.06;
      
      if (db) {
        try {
          const userSnap = await db.collection('users').doc(payload.playerId).get();
          if (userSnap.exists) {
            const userData = userSnap.data();
            rating = userData?.rating ?? 1500;
            rd = userData?.rd ?? 350;
            volatility = userData?.volatility ?? 0.06;
          }
        } catch (err) {
          console.error("Failed to load user ranked rating on joinQueue:", err);
        }
      }

      rankedQueue.push({
        socketId: socket.id,
        playerName: payload.playerName,
        playerId: payload.playerId,
        rating,
        rd,
        volatility,
        enteredAt: Date.now()
      });
    } else {
      socket.emit('roomError', { message: 'サポートされていないゲームモードです。' });
    }
  });

  // Leave Queue (for matchmaking cancellation)
  socket.on('leaveQueue', () => {
    // Check casual queue
    const cqIndex = casualQueue.findIndex(p => p.socketId === socket.id);
    if (cqIndex !== -1) {
      console.log(`Player left casual queue: ${socket.id}`);
      casualQueue.splice(cqIndex, 1);
    }
    
    // Check ranked queue
    const rqIndex = rankedQueue.findIndex(p => p.socketId === socket.id);
    if (rqIndex !== -1) {
      console.log(`Player left ranked queue: ${socket.id}`);
      rankedQueue.splice(rqIndex, 1);
    }
  });

  // Draft phase ready payload
  socket.on('draft:ready', (payload: { skills: string[] }) => {
    const roomCode = Array.from(socket.rooms).find(r => r !== socket.id);
    if (roomCode) {
      const room = rooms.get(roomCode);
      if (room) {
        const player = room.players.find(p => p.socketId === socket.id);
        if (player) {
          room.draft[player.role].ready = true;
          room.draft[player.role].skills = payload.skills;
          // Notify the other player that this player is ready
          socket.to(roomCode).emit('draft:update', { role: player.role });

          // If both players are ready, start the game
          if (room.draft['A'].ready && room.draft['B'].ready) {
            room.state.selectedSkills.A = room.draft['A'].skills;
            room.state.selectedSkills.B = room.draft['B'].skills;
            io.to(roomCode).emit('game:start', { state: room.state });
          }
        }
      }
    }
  });

  // In-game Action Payload
  socket.on('game:action', (payload: GameActionPayload & { boardBefore?: string; customPayload?: any }) => {
    const roomCode = Array.from(socket.rooms).find(r => r !== socket.id);
    if (roomCode) {
      const room = rooms.get(roomCode);
      if (room) {
        const player = room.players.find(p => p.socketId === socket.id);
        if (player && payload.boardBefore) {
          room.moves.push({
            boardBefore: payload.boardBefore,
            player: player.role,
            action: {
              actionType: payload.actionType,
              x: payload.x,
              y: payload.y,
              skillId: payload.skillId,
              customPayload: payload.customPayload
            }
          });
        }
        socket.to(roomCode).emit('game:action:received', payload);
      }
    }
  });

  // Explicit Exit / Surrender
  socket.on('game:surrender', async () => {
    const roomCode = Array.from(socket.rooms).find(r => r !== socket.id);
    if (roomCode) {
      const room = rooms.get(roomCode);
      if (room) {
        const surrenderPlayer = room.players.find(p => p.socketId === socket.id);
        const otherPlayer = room.players.find(p => p.socketId !== socket.id);
        if (surrenderPlayer && otherPlayer) {
          console.log(`Player ${surrenderPlayer.playerName} (${surrenderPlayer.role}) surrendered in room ${roomCode}`);
          
          // Save kifu to Firestore
          if (room.state && !room.state.kifuSaved) {
            room.state.kifuSaved = true;
            await saveKifuToFirestore(room, otherPlayer.role);
          }

          let ratingResult = null;
          if (room.state && room.state.isRanked && !room.state.ratingUpdated) {
            room.state.ratingUpdated = true;
            ratingResult = await updatePlayerGlicko(otherPlayer.playerId, surrenderPlayer.playerId, false);
          }

          socket.to(roomCode).emit('opponent:surrendered', { 
            role: surrenderPlayer.role,
            ratingResult
          });
        }
        rooms.delete(roomCode);
      }
    }
  });

  // End of Ranked Game report
  socket.on('game:ranked:ended', async (payload: { winnerRole: 'A' | 'B' | 'draw'; moves?: GameMove[] }) => {
    const roomCode = Array.from(socket.rooms).find(r => r !== socket.id);
    if (roomCode) {
      const room = rooms.get(roomCode);
      if (room && room.state) {
        // Sync moves from client if server moves are empty
        if (payload.moves && (!room.moves || room.moves.length === 0)) {
          room.moves = payload.moves;
        }

        // Save kifu to Firestore
        if (!room.state.kifuSaved) {
          room.state.kifuSaved = true;
          await saveKifuToFirestore(room, payload.winnerRole);
        }

        // Rating updates (Ranked matches only)
        if (room.state.isRanked && !room.state.ratingUpdated) {
          room.state.ratingUpdated = true;

          const playerA = room.players.find(p => p.role === 'A')!;
          const playerB = room.players.find(p => p.role === 'B')!;

          let ratingResult = null;
          if (payload.winnerRole === 'A') {
            ratingResult = await updatePlayerGlicko(playerA.playerId, playerB.playerId, false);
          } else if (payload.winnerRole === 'B') {
            ratingResult = await updatePlayerGlicko(playerB.playerId, playerA.playerId, false);
          } else if (payload.winnerRole === 'draw') {
            ratingResult = await updatePlayerGlicko(playerA.playerId, playerB.playerId, true);
          }

          io.to(roomCode).emit('game:rating:updated', { 
            ratingResult, 
            winnerRole: payload.winnerRole 
          });
        }
      }
    }
  });

  // Rematch request
  socket.on('rematch:request', () => {
    const roomCode = Array.from(socket.rooms).find(r => r !== socket.id);
    if (roomCode) {
      const room = rooms.get(roomCode);
      if (room) {
        const player = room.players.find(p => p.socketId === socket.id);
        if (player) {
          room.rematch[player.role] = true;
          console.log(`Player ${player.playerName} (${player.role}) requested rematch in room ${roomCode}`);
          
          io.to(roomCode).emit('rematch:update', { rematch: room.rematch });

          if (room.rematch.A && room.rematch.B) {
            console.log(`Both players accepted rematch in room ${roomCode}. Restarting match.`);
            
            // Swap roles for fairness
            room.players.forEach(p => {
              p.role = p.role === 'A' ? 'B' : 'A';
            });
            
            // Reset rematch status
            room.rematch = { A: false, B: false };
            // Reset draft status
            room.draft = {
              A: { ready: false, skills: [] },
              B: { ready: false, skills: [] }
            };
            // Reset moves history
            room.moves = [];
            
            // Initialize new state
            room.state = createInitialState();
            
            // Send new game:init event to restart draft phase with updated roles
            io.to(roomCode).emit('game:init', {
              roomCode,
              state: room.state,
              players: room.players
            });
          }
        }
      }
    }
  });
});

// Add endpoint for fetching best agent weights
app.get('/api/best-agent', (req: Request, res: Response) => {
  const BEST_AGENT_PATH = path.join(__dirname, '../../simulation_results/best_agent.json');
  try {
    if (fs.existsSync(BEST_AGENT_PATH)) {
      const data = JSON.parse(fs.readFileSync(BEST_AGENT_PATH, 'utf-8'));
      return res.json(data);
    }
  } catch (e) {
    console.warn("Failed to read best_agent.json from server endpoint. Returning default.");
  }
  
  // Default fallback (matching the one in play.ts)
  res.json({
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
    skills: ["skill_push", "skill_crash", "skill_swap"]
  });
});

// Add endpoint for fetching opening book json
app.get('/api/opening-book', (req: Request, res: Response) => {
  const OPENING_BOOK_PATH = path.join(__dirname, '../../simulation_results/opening_book.json');
  try {
    if (fs.existsSync(OPENING_BOOK_PATH)) {
      const data = JSON.parse(fs.readFileSync(OPENING_BOOK_PATH, 'utf-8'));
      return res.json(data);
    }
  } catch (e) {
    console.warn("Failed to read opening_book.json from server endpoint. Returning empty.");
  }
  res.json({});
});

// Start the server
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Static files are served from: /public`);
});
