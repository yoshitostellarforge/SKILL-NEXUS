import { io, Socket } from 'socket.io-client';

// Vite environment variables (fallback to localhost:3000 for local dev)
const serverUrl = import.meta.env.VITE_SERVER_URL || 'http://localhost:3000';

class SocketManager {
  private socket: Socket | null = null;

  connect(): Socket {
    if (!this.socket) {
      this.socket = io(serverUrl, {
        autoConnect: true,
      });

      this.socket.on('connect', () => {
        console.log('[Socket.io] Connected to server:', this.socket?.id);
        
        // Test connection by sending a ping
        this.socket?.emit('pingServer');
      });

      this.socket.on('pongClient', (data) => {
        console.log('[Socket.io] Received pongClient:', data);
      });

      this.socket.on('disconnect', () => {
        console.log('[Socket.io] Disconnected from server');
      });
    }
    return this.socket;
  }

  getSocket(): Socket | null {
    return this.socket;
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }
}

export const socketManager = new SocketManager();
