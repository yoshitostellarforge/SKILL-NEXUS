// @ts-ignore: IDE may not recognize esModuleInterop from the nested tsconfig
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { JoinQueuePayload, GameActionPayload } from './types/game';

interface RoomData {
  roomCode: string;
  players: { socketId: string; playerName: string; role: 'A' | 'B'; playerId: string; connected: boolean }[];
  state: any;
  draft: { A: { ready: boolean; skills: string[] }; B: { ready: boolean; skills: string[] } };
  rematch: { A: boolean; B: boolean };
  disconnectTimeout?: any;
}
const rooms = new Map<string, RoomData>();

function generateRoomCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 5; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return code;
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

// Setup Express middleware to allow CORS for static files in development
// @ts-ignore
app.use((req, res, next) => {
  if (!isProduction) {
    res.header('Access-Control-Allow-Origin', '*');
  }
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
          
          room.disconnectTimeout = setTimeout(() => {
            console.log(`Reconnection timeout expired for player in room: ${roomCode}`);
            const remainingPlayer = room.players.find(p => p.connected);
            if (remainingPlayer) {
              io.to(roomCode).emit('game:opponent_abandoned', {
                winnerRole: remainingPlayer.role,
                playerName: remainingPlayer.playerName
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
  socket.on('joinQueue', (payload: JoinQueuePayload) => {
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
          socket.emit('roomError', { message: 'Room not found or already full.' });
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
          rematch: { A: false, B: false }
        });
        socket.join(roomCode);
        console.log(`Player ${payload.playerName} created room ${roomCode}`);
        socket.emit('roomCreated', { roomCode });
      }
    } else {
      socket.emit('roomError', { message: 'Mode not implemented yet.' });
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
  socket.on('game:action', (payload: GameActionPayload) => {
    const roomCode = Array.from(socket.rooms).find(r => r !== socket.id);
    if (roomCode) {
      // Sync local state copy for potential reconnections
      const room = rooms.get(roomCode);
      if (room && room.state) {
        // In real server-side state evaluation, we would run:
        // room.state = processAction(room.state, payload);
        // For simple sync, we update the winner or state fields if passed, or just trust the actions.
        // Let's also sync state updates if they are embedded or computed.
        // To keep it simple, we just broadcast the action.
        socket.to(roomCode).emit('game:action:received', payload);
      }
    }
  });

  // Explicit Exit / Surrender
  socket.on('game:surrender', () => {
    const roomCode = Array.from(socket.rooms).find(r => r !== socket.id);
    if (roomCode) {
      const room = rooms.get(roomCode);
      if (room) {
        const player = room.players.find(p => p.socketId === socket.id);
        if (player) {
          console.log(`Player ${player.playerName} (${player.role}) surrendered in room ${roomCode}`);
          socket.to(roomCode).emit('opponent:surrendered', { role: player.role });
        }
        rooms.delete(roomCode);
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

// Start the server
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Static files are served from: /public`);
});
