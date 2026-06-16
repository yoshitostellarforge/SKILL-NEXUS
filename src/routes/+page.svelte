<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { socketManager } from '$lib/socket';
  import { createInitialGame, placeStone, useSkill } from '$lib/gameLogic';
  import { skills } from '$lib/skills';
  import type { SkillModule } from '$lib/types';

  type ScreenState = 'title' | 'settings' | 'mainModeSelect' | 'onlineModeSelect' | 'roomLobby' | 'localSkillSelect' | 'onlineSkillSelect' | 'battle';

  // Navigation and State
  let currentScreen = $state<ScreenState>('title');
  let state = $state(createInitialGame());
  let selectedSkillId = $state<string | null>(null);
  let activeHelpSkill = $state<SkillModule | null>(null);

  // Responsive state
  let isMobile = $state(false);
  let isSkillsDrawerOpen = $state(false);
  let isMenuOpen = $state(false);
  let isGameSettingsOpen = $state(false);
  let isExitConfirmOpen = $state(false);

  // Draft phase state variables
  let draftActivePlayer = $state<'A' | 'B'>('A');
  let draftSelectedSkills = $state<{ A: string[]; B: string[] }>({
    A: [],
    B: []
  });
  let expandedSkillId = $state<string | null>(null);

  // Online Matchmaking state
  let isRoomMenuOpen = $state(false);
  let roomCodeInput = $state('');
  let currentRoomCode = $state<string | null>(null);
  let myPlayerName = $state(`Player_${Math.floor(Math.random() * 1000)}`);
  let isWaitingForMatch = $state(false);
  let isOnlineMatch = $state(false);
  let myRole = $state<'A' | 'B' | null>(null);

  // Online Drafting and Intro state
  let isOpponentReady = $state(false);
  let isMeReady = $state(false);
  let introPhase = $state<'none' | 'playerInfo' | 'skillsInfo' | 'roleInfo'>('none');
  let opponentName = $state('');
  let opponentSkills = $state<string[]>([]);

  // Latency & Connection states
  let myPlayerId = $state('');
  let isSocketConnected = $state(false);
  let currentPing = $state<number>(-1);
  let opponentDisconnected = $state(false);
  let disconnectCountdown = $state(15);
  let disconnectTimer: any = null;
  let matchEndedReason = $state<string | null>(null);
  let rematchRequests = $state<{ A: boolean; B: boolean }>({ A: false, B: false });
  let pingInterval: any = null;

  let opponentRole = $derived(myRole === 'A' ? 'B' : 'A');
  let opponentWantsRematch = $derived(isOnlineMatch && myRole ? rematchRequests[opponentRole] : false);
  let iWantRematch = $derived(isOnlineMatch && myRole ? rematchRequests[myRole] : false);

  function startPingInterval() {
    stopPingInterval();
    pingInterval = setInterval(() => {
      const socket = socketManager.getSocket();
      if (socket && socket.connected) {
        socket.emit('pingTest', Date.now());
      } else {
        currentPing = -1;
      }
    }, 3000);
  }

  function stopPingInterval() {
    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }
    currentPing = -1;
  }

  function setupSocketListeners() {
    const socket = socketManager.getSocket();
    if (!socket) return;

    if (socket.connected) {
      isSocketConnected = true;
    }

    socket.on('connect', () => {
      isSocketConnected = true;
      if (isOnlineMatch && currentRoomCode) {
        socket.emit('reconnectRoom', { roomCode: currentRoomCode, playerId: myPlayerId });
      }
    });

    socket.on('disconnect', () => {
      isSocketConnected = false;
    });

    socket.on('pongTest', (startTime: number) => {
      currentPing = Date.now() - startTime;
    });

    socket.on('roomCreated', (data) => {
      currentRoomCode = data.roomCode;
      isWaitingForMatch = true;
    });

    socket.on('game:init', (data) => {
      currentRoomCode = data.roomCode;
      state = data.state;
      isWaitingForMatch = false;
      isRoomMenuOpen = false;
      isOnlineMatch = true;
      const me = data.players.find((p: any) => p.socketId === socket.id || p.playerId === myPlayerId);
      myRole = me ? me.role : null;
      
      const opponent = data.players.find((p: any) => p.playerId !== myPlayerId);
      if (opponent) opponentName = opponent.playerName;

      // Reset draft state
      isOpponentReady = false;
      isMeReady = false;
      draftActivePlayer = myRole || 'A';

      // Reset rematch and disconnect overlay
      rematchRequests = { A: false, B: false };
      opponentDisconnected = false;
      if (disconnectTimer) {
        clearInterval(disconnectTimer);
        disconnectTimer = null;
      }
      matchEndedReason = null;
      
      currentScreen = 'onlineSkillSelect';
    });

    socket.on('draft:update', (data) => {
      if (data.role !== myRole) {
        isOpponentReady = true;
      }
    });

    socket.on('game:start', (data) => {
      state = data.state;
      currentScreen = 'battle';
      const oppRole = myRole === 'A' ? 'B' : 'A';
      opponentSkills = state.selectedSkills[oppRole];
      
      // Start ping monitoring once game starts
      startPingInterval();

      // Intro sequence: 3s player info -> 3s skills info -> 2s role info -> start
      introPhase = 'playerInfo';
      setTimeout(() => {
        introPhase = 'skillsInfo';
        setTimeout(() => {
          introPhase = 'roleInfo';
          setTimeout(() => {
            introPhase = 'none';
          }, 2000);
        }, 3000);
      }, 3000);
    });

    socket.on('roomError', (data) => {
      alert(`Error: ${data.message}`);
      isWaitingForMatch = false;
    });

    socket.on('game:action:received', (payload: any) => {
      if (payload.actionType === 'placeStone') {
        state = placeStone(state, payload.x, payload.y);
      } else if (payload.actionType === 'useSkill') {
        state = useSkill(state, payload.skillId, { x: payload.x, y: payload.y }, payload.customPayload);
      }
    });

    // Reconnection events
    socket.on('player:disconnected', (data) => {
      if (data.role === opponentRole) {
        opponentDisconnected = true;
        disconnectCountdown = Math.floor(data.timeoutMs / 1000);
        if (disconnectTimer) clearInterval(disconnectTimer);
        disconnectTimer = setInterval(() => {
          if (disconnectCountdown > 0) {
            disconnectCountdown--;
          } else {
            clearInterval(disconnectTimer);
          }
        }, 1000);
      }
    });

    socket.on('player:reconnected', (data) => {
      if (data.role === opponentRole) {
        opponentDisconnected = false;
        if (disconnectTimer) {
          clearInterval(disconnectTimer);
          disconnectTimer = null;
        }
      }
    });

    socket.on('game:restore', (data) => {
      currentRoomCode = data.roomCode;
      state = data.state;
      isOnlineMatch = true;
      myRole = data.myRole;
      
      const opponent = data.players.find((p: any) => p.playerId !== myPlayerId);
      if (opponent) {
        opponentName = opponent.playerName;
        opponentDisconnected = !opponent.connected;
      }
      
      rematchRequests = data.rematch;
      
      // Determine if drafting or in battle
      const oppRole = myRole === 'A' ? 'B' : 'A';
      if (state.selectedSkills.A.length > 0 && state.selectedSkills.B.length > 0) {
        opponentSkills = state.selectedSkills[oppRole];
        currentScreen = 'battle';
        startPingInterval();
      } else {
        isMeReady = data.draft[myRole!].ready;
        isOpponentReady = data.draft[oppRole].ready;
        currentScreen = 'onlineSkillSelect';
      }
    });

    // Match termination events
    socket.on('opponent:surrendered', (data) => {
      state.winner = myRole;
      matchEndedReason = 'opponent_surrendered';
      opponentDisconnected = false;
      if (disconnectTimer) {
        clearInterval(disconnectTimer);
        disconnectTimer = null;
      }
      currentScreen = 'battle';
    });

    socket.on('game:opponent_abandoned', (data) => {
      state.winner = myRole;
      matchEndedReason = 'opponent_abandoned';
      opponentDisconnected = false;
      if (disconnectTimer) {
        clearInterval(disconnectTimer);
        disconnectTimer = null;
      }
      currentScreen = 'battle';
    });

    // Rematch events
    socket.on('rematch:update', (data) => {
      rematchRequests = data.rematch;
    });
  }

  onMount(() => {
    // Generate/Load persistent Player ID
    let storedId = localStorage.getItem('skillNexusPlayerId');
    if (!storedId) {
      storedId = 'usr_' + Math.random().toString(36).substring(2, 11);
      localStorage.setItem('skillNexusPlayerId', storedId);
    }
    myPlayerId = storedId;

    // Load player name from local storage if exists
    const storedName = localStorage.getItem('skillNexusPlayerName');
    if (storedName) {
      myPlayerName = storedName;
    } else {
      localStorage.setItem('skillNexusPlayerName', myPlayerName);
    }

    // Initialize Socket.io connection to backend server
    const socket = socketManager.connect();
    isSocketConnected = socket.connected;
    setupSocketListeners();
    startPingInterval();

    // Fetch gameLogic.js to trigger Service Worker caching
    const serverUrl = import.meta.env.VITE_SERVER_URL || 'http://localhost:3000';
    fetch(`${serverUrl}/public/gameLogic.js`)
      .then(() => console.log('Successfully fetched and cached gameLogic.js'))
      .catch(console.error);

    if (typeof window !== 'undefined') {
      const mediaQuery = window.matchMedia('(max-width: 768px)');
      isMobile = mediaQuery.matches;
      const handler = (e: MediaQueryListEvent) => {
        isMobile = e.matches;
      };
      mediaQuery.addEventListener('change', handler);
      return () => mediaQuery.removeEventListener('change', handler);
    }
  });

  onDestroy(() => {
    stopPingInterval();
    if (disconnectTimer) {
      clearInterval(disconnectTimer);
    }
    // Disconnect when component is destroyed
    socketManager.disconnect();
  });

  // Filter skills for active player in Battle Screen
  let activePlayerSkills = $derived(
    skills.filter(s => {
      const activeList = state.currentPlayer === 'A' ? state.selectedSkills.A : state.selectedSkills.B;
      return activeList.includes(s.id);
    })
  );

  // Computed helper for currently selected skill targeting CSS
  let selectedSkill = $derived(
    skills.find((s) => s.id === selectedSkillId) || null
  );

  function startDraft() {
    isOnlineMatch = false;
    currentScreen = 'localSkillSelect';
    draftActivePlayer = 'A';
    draftSelectedSkills = { A: [], B: [] };
    expandedSkillId = null;
  }

  function handleDraftSelect(skillId: string) {
    const activeList = draftSelectedSkills[draftActivePlayer];
    
    // Toggle skill select
    if (activeList.includes(skillId)) {
      draftSelectedSkills[draftActivePlayer] = activeList.filter((id: string) => id !== skillId);
    } else {
      if (activeList.length >= 3) {
        alert('最大3つのスキルを選択できます！');
        return;
      }
      draftSelectedSkills[draftActivePlayer] = [...activeList, skillId];
    }
  }

  function confirmDraft() {
    const activeList = draftSelectedSkills[draftActivePlayer];
    if (activeList.length < 3) {
      alert('スキルを3つ選択してください！');
      return;
    }

    if (draftActivePlayer === 'A') {
      draftActivePlayer = 'B';
    } else {
      // Both selected, initialize GameState and transition to Battle
      state = createInitialGame();
      state.selectedSkills = {
        A: [...draftSelectedSkills.A],
        B: [...draftSelectedSkills.B]
      };
      selectedSkillId = null;
      currentScreen = 'battle';
    }
  }

  function resetGame() {
    stopPingInterval();
    if (isOnlineMatch) {
      const socket = socketManager.getSocket();
      socket?.emit('game:surrender');
    }
    state = createInitialGame();
    selectedSkillId = null;
    currentScreen = 'title';
    isOnlineMatch = false;
    currentRoomCode = null;
    matchEndedReason = null;
    rematchRequests = { A: false, B: false };
    opponentDisconnected = false;
    if (disconnectTimer) {
      clearInterval(disconnectTimer);
      disconnectTimer = null;
    }
  }

  function handleCellClick(x: number, y: number) {
    if (state.winner || introPhase !== 'none') return;
    if (isOnlineMatch && state.currentPlayer !== myRole) return;

    if (selectedSkillId) {
      const activePlayer = state.currentPlayer;
      const skill = selectedSkill;
      if (!skill) return;

      // Ensure cost check passes
      if (state.costs[activePlayer] < skill.cost) {
        alert('コストが足りません！');
        selectedSkillId = null;
        isSkillsDrawerOpen = false;
        return;
      }

      // If skill targets cell
      if (skill.targetType === 'cell') {
        const cell = state.board[y][x];
        if (cell.type === 'empty') {
          alert('対象のセルには駒がありません！');
          return;
        }
        state = useSkill(state, selectedSkillId, { x, y });
        if (isOnlineMatch) socketManager.getSocket()?.emit('game:action', { actionType: 'useSkill', skillId: selectedSkillId, x, y });
      }
      
      selectedSkillId = null;
      isSkillsDrawerOpen = false;
    } else {
      // Normal stone placement (switching player and ending turn)
      if (state.board[y][x].type !== 'empty') return;
      state = placeStone(state, x, y);
      if (isOnlineMatch) socketManager.getSocket()?.emit('game:action', { actionType: 'placeStone', x, y });
      isSkillsDrawerOpen = false;
    }
  }

  function handleSkillSelect(skill: SkillModule) {
    if (state.winner || introPhase !== 'none') return;
    if (isOnlineMatch && state.currentPlayer !== myRole) return;

    const activePlayer = state.currentPlayer;
    if (state.costs[activePlayer] < skill.cost) {
      alert('コストが不足しています！');
      return;
    }

    if (skill.targetType === 'player' || skill.targetType === 'opponent' || skill.targetType === 'global') {
      let customPayload: any = undefined;
      if (skill.id === 'skill_shuffle') {
        const result = Math.floor(Math.random() * 6) + 1;
        const tempOrder = Array.from({ length: 9 }, (_, i) => i);
        for (let i = tempOrder.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          const temp = tempOrder[i];
          tempOrder[i] = tempOrder[j];
          tempOrder[j] = temp;
        }
        customPayload = { result, shuffleOrder: tempOrder };
      }

      state = useSkill(state, skill.id, undefined, customPayload);
      if (isOnlineMatch) {
        socketManager.getSocket()?.emit('game:action', { 
          actionType: 'useSkill', 
          skillId: skill.id, 
          customPayload 
        });
      }
      selectedSkillId = null;
    } else {
      // Coordinate-targeting skills
      if (selectedSkillId === skill.id) {
        selectedSkillId = null;
      } else {
        selectedSkillId = skill.id;
      }
    }
  }
</script>

<main class="game-wrapper">
  <!-- TITLE SCREEN -->
  {#if currentScreen === 'title'}
    <div class="screen-card card text-center animate-fade-in">
      <h1 class="hero-title">SKILL-NEXUS</h1>
      <p class="hero-subtitle">5×5 Cyberpunk Minimalist Plugin-Engine</p>
      
      <div class="menu-actions">
        <button class="primary-btn" onclick={() => currentScreen = 'mainModeSelect'}>
          PLAY GAME
        </button>
        <button class="secondary-btn" onclick={() => currentScreen = 'settings'}>
          SETTINGS
        </button>
      </div>
    </div>

  <!-- SETTINGS SCREEN (MOCK) -->
  {:else if currentScreen === 'settings'}
    <div class="screen-card card animate-fade-in">
      <div class="screen-header">
        <button class="back-btn" onclick={() => currentScreen = 'title'} aria-label="タイトルに戻る">
          ← BACK
        </button>
        <h2 class="section-title">SETTINGS & PROFILE</h2>
      </div>
      <p class="desc-text text-center">以下の機能は将来のオンラインアップデートで提供予定のプレースホルダーです。</p>
      
      <div class="settings-mock-list">
        <div class="mock-item" style="flex-direction: column; align-items: stretch; gap: 0.5rem; background: rgba(15, 23, 42, 0.8);">
          <label for="my-player-name-input" style="color: #22d3ee; font-size: 0.9rem; letter-spacing: 0.1em;">ユーザー名 (オンライン用)</label>
          <input id="my-player-name-input" type="text" bind:value={myPlayerName} style="padding: 0.8rem; background: #000; border: 1px solid #334155; border-radius: 4px; color: white; outline: none; font-size: 1rem;" />
          <button class="primary-btn compact-btn" style="margin-top: 0.5rem;" onclick={() => { localStorage.setItem('skillNexusPlayerName', myPlayerName); alert('名前を保存しました！'); currentScreen = 'title'; }}>
            SAVE & RETURN
          </button>
        </div>
        <div class="mock-item">
          <span>オンライン対戦アカウント連携</span>
          <span class="badge">Placeholder</span>
        </div>
        <div class="mock-item">
          <span>プレイ履歴 & 称号一覧</span>
          <span class="badge">Locked</span>
        </div>
        <div class="mock-item">
          <span>チュートリアル</span>
          <span class="badge">Placeholder</span>
        </div>
      </div>
    </div>

  <!-- MAIN MODE SELECT SCREEN -->
  {:else if currentScreen === 'mainModeSelect'}
    <div class="screen-card card animate-fade-in" style="max-width: 600px;">
      <div class="screen-header">
        <button class="back-btn" onclick={() => currentScreen = 'title'} aria-label="タイトルに戻る">
          ← BACK
        </button>
        <h2 class="section-title">SELECT MATCH TYPE</h2>
      </div>
      <p class="desc-text text-center">対戦形式を選択してください。</p>

      <div class="menu-actions" style="margin-top: 1rem;">
        <!-- LOCAL MATCH -->
        <button class="secondary-btn" onclick={startDraft} style="padding: 1.5rem;">
          LOCAL MATCH
          <br><span style="font-size: 0.8rem; font-weight: normal; color: #94a3b8;">1 Screen 2 Players</span>
        </button>
        
        <!-- ONLINE MATCH -->
        <button class="primary-btn" onclick={() => currentScreen = 'onlineModeSelect'} style="padding: 1.5rem;">
          ONLINE MATCH
          <br><span style="font-size: 0.8rem; font-weight: normal; color: #000;">Multiplayer Network</span>
        </button>
      </div>
    </div>

  <!-- ONLINE MODE SELECT SCREEN -->
  {:else if currentScreen === 'onlineModeSelect'}
    <div class="screen-card card animate-fade-in" style="max-width: 800px;">
      <div class="screen-header">
        <button class="back-btn" onclick={() => currentScreen = 'mainModeSelect'} aria-label="前の画面に戻る">
          ← BACK
        </button>
        <h2 class="section-title">ONLINE MATCH</h2>
      </div>

      <div class="menu-actions" style="margin-top: 1rem;">
        <!-- RANKED MATCH (Main Banner) -->
        <button class="primary-btn ranked-banner disabled-btn" disabled style="opacity: 0.5; height: 120px; font-size: 1.5rem; text-shadow: 0 0 10px rgba(255,0,0,0.8); border-color: #f43f5e; color: #f43f5e; display: flex; flex-direction: column; justify-content: center; align-items: center;">
          RANKED MATCH
          <span style="font-size: 0.9rem; color: #fff; margin-top: 0.5rem; letter-spacing: 0.2em;">[ COMING SOON ]</span>
        </button>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
          <!-- CASUAL MATCH -->
          <button class="secondary-btn disabled-btn" disabled style="opacity: 0.5; display: flex; flex-direction: column; justify-content: center; align-items: center; padding: 1.5rem 0;">
            CASUAL MATCH
            <span style="font-size: 0.7rem; margin-top: 0.25rem;">[ LOCKED ]</span>
          </button>
          
          <!-- ROOM MATCH -->
          <button class="primary-btn" onclick={() => currentScreen = 'roomLobby'} style="background: rgba(34, 211, 238, 0.1); display: flex; flex-direction: column; justify-content: center; align-items: center; padding: 1.5rem 0;">
            ROOM MATCH
            <span style="font-size: 0.7rem; margin-top: 0.25rem;">[ ACTIVE ]</span>
          </button>
        </div>
      </div>
    </div>

  <!-- ROOM LOBBY SCREEN -->
  {:else if currentScreen === 'roomLobby'}
    <div class="screen-card card animate-fade-in" style="max-width: 600px; border: 2px solid #22d3ee; background: rgba(15, 23, 42, 0.8);">
      <div class="screen-header">
        <button class="back-btn" onclick={() => { currentScreen = 'onlineModeSelect'; isWaitingForMatch = false; }} aria-label="オンライン選択に戻る">
          ← BACK
        </button>
        <h2 class="section-title">ROOM MATCH</h2>
        <div class="ping-indicator" class:ping-good={currentPing >= 0 && currentPing < 80} class:ping-fair={currentPing >= 80 && currentPing < 200} class:ping-poor={currentPing >= 200 || currentPing === -1}>
          <span class="ping-dot"></span>
          <span class="ping-text">{currentPing === -1 ? 'DISCONNECT' : `${currentPing} ms`}</span>
        </div>
      </div>
      
      {#if isWaitingForMatch}
        <div style="text-align: center; padding: 2rem 1rem;">
          <div class="animate-pulse-subtle" style="font-size: 1.2rem; color: #22d3ee; margin-bottom: 1rem;">WAITING FOR OPPONENT...</div>
          <div style="font-size: 3rem; letter-spacing: 0.3em; font-weight: bold; text-shadow: 0 0 15px rgba(34, 211, 238, 0.6);">{currentRoomCode}</div>
          <p style="font-size: 0.9rem; color: #94a3b8; margin-top: 1.5rem;">このコードを対戦相手に伝えてください</p>
        </div>
      {:else}
        <div style="display: flex; flex-direction: column; gap: 2rem; margin-top: 2rem;">
          <button class="primary-btn" style="padding: 1.5rem;" onclick={() => {
            const socket = socketManager.getSocket();
            socket?.emit('joinQueue', { matchType: 'room', playerName: myPlayerName, playerId: myPlayerId });
          }}>
            CREATE NEW ROOM
            <br><span style="font-size: 0.85rem; font-weight: normal; margin-top: 0.5rem; display: inline-block;">(新しく部屋を作る)</span>
          </button>

          <div style="display: flex; flex-direction: column; gap: 1rem;">
            <div style="text-align: center; color: #94a3b8; font-size: 0.9rem; margin: 0; position: relative;">
              <span style="background: rgba(15, 23, 42, 0.8); padding: 0 10px; position: relative; z-index: 1;">OR JOIN EXISTING</span>
              <div style="position: absolute; top: 50%; left: 0; right: 0; height: 1px; background: #334155; z-index: 0;"></div>
            </div>
            <div class="room-input-group">
              <input type="text" bind:value={roomCodeInput} placeholder="ROOM CODE (5文字)" style="flex: 1; padding: 1.2rem; background: #0f172a; border: 1px solid #334155; border-radius: 0.25rem; color: white; text-transform: uppercase; text-align: center; font-size: 1.2rem; letter-spacing: 0.1em; outline: none;" maxlength="5">
              <button class="secondary-btn" style="width: auto; padding: 0 2rem;" onclick={() => {
                if (roomCodeInput.length === 5) {
                  const socket = socketManager.getSocket();
                  socket?.emit('joinQueue', { matchType: 'room', roomCode: roomCodeInput, playerName: myPlayerName, playerId: myPlayerId });
                } else {
                  alert('5文字のルームコードを入力してください');
                }
              }}>
                JOIN
              </button>
            </div>
          </div>
        </div>
      {/if}
    </div>

  <!-- LOCAL SKILL DRAFT SELECT SCREEN -->
  {:else if currentScreen === 'localSkillSelect'}
    <div class="screen-card card animate-fade-in skill-select-card">
      <div class="screen-header">
        <button class="back-btn" onclick={() => currentScreen = 'mainModeSelect'} aria-label="モード選択に戻る">
          ← BACK
        </button>
        <h2 class="section-title">LOCAL SKILL DRAFTING</h2>
      </div>
      <div class="draft-indicator" class:player-a={draftActivePlayer === 'A'} class:player-b={draftActivePlayer === 'B'}>
        プレイヤー {draftActivePlayer} のスキル選択 ({draftSelectedSkills[draftActivePlayer].length} / 3)
      </div>
      <p class="desc-text text-center">対戦で使用するスキルを3つドラフトしてください。</p>

      <div class="draft-list">
        {#each skills as skill}
          {@const isSelected = draftSelectedSkills[draftActivePlayer].includes(skill.id)}
          {@const isAlreadyTakenByOther = draftActivePlayer === 'B' && draftSelectedSkills.A.includes(skill.id)}
          
          {#if isMobile}
            {@const isExpanded = expandedSkillId === skill.id}
            <div class="draft-accordion-item" class:expanded={isExpanded} class:selected={isSelected} class:taken={isAlreadyTakenByOther}>
              <button 
                type="button"
                class="draft-accordion-header" 
                onclick={() => expandedSkillId = isExpanded ? null : skill.id}
              >
                <div class="draft-header-main">
                  <span class="skill-name">{skill.name}</span>
                  <span class="skill-category badge">{skill.category.toUpperCase()}</span>
                </div>
                <div class="draft-header-side">
                  <span class="skill-cost">Cost {skill.cost}</span>
                  {#if isSelected}
                    <span class="selected-check">✓ SELECTED</span>
                  {/if}
                  {#if isAlreadyTakenByOther}
                    <span class="taken-badge">Player A Taken</span>
                  {/if}
                </div>
              </button>
              
              {#if isExpanded}
                <div class="draft-accordion-content animate-fade-in">
                  <p class="draft-skill-desc">{skill.description}</p>
                  <div class="draft-accordion-actions">
                    {#if isAlreadyTakenByOther}
                      <button class="disabled-btn compact-btn" disabled style="width: auto; padding: 0.5rem 1rem;">Taken by Player A</button>
                    {:else}
                      <button 
                        class="primary-btn compact-btn" 
                        class:remove-btn={isSelected}
                        onclick={() => handleDraftSelect(skill.id)}
                      >
                        {isSelected ? 'REMOVE SKILL' : 'DRAFT SKILL'}
                      </button>
                    {/if}
                  </div>
                </div>
              {/if}
            </div>
          {:else}
            <div class="draft-pc-card" class:selected={isSelected} class:taken={isAlreadyTakenByOther}>
              <div class="draft-pc-card-header">
                <div class="draft-header-main">
                  <span class="skill-name">{skill.name}</span>
                  <span class="skill-category badge">{skill.category.toUpperCase()}</span>
                </div>
                <div class="draft-header-side">
                  <span class="skill-cost">Cost {skill.cost}</span>
                  {#if isSelected}
                    <span class="selected-check">✓ SELECTED</span>
                  {/if}
                  {#if isAlreadyTakenByOther}
                    <span class="taken-badge">Player A Taken</span>
                  {/if}
                </div>
              </div>
              <div class="draft-pc-card-body">
                <p class="draft-skill-desc">{skill.description}</p>
                <div class="draft-pc-card-actions">
                  {#if isAlreadyTakenByOther}
                    <button class="disabled-btn compact-btn" disabled style="width: auto; padding: 0.5rem 1rem;">Taken by Player A</button>
                  {:else}
                    <button 
                      class="primary-btn compact-btn" 
                      class:remove-btn={isSelected}
                      onclick={() => handleDraftSelect(skill.id)}
                    >
                      {isSelected ? 'REMOVE SKILL' : 'DRAFT SKILL'}
                    </button>
                  {/if}
                </div>
              </div>
            </div>
          {/if}
        {/each}
      </div>

      {#if !isMobile}
        <div class="draft-actions">
          <button class="confirm-btn" onclick={confirmDraft} disabled={draftSelectedSkills[draftActivePlayer].length < 3}>
            {draftActivePlayer === 'A' ? 'Player B の選択へ →' : '対戦を開始する →'}
          </button>
        </div>
      {/if}
    </div>

    {#if isMobile && draftSelectedSkills[draftActivePlayer].length === 3}
      <div class="draft-sticky-footer animate-fade-in">
        <button class="confirm-btn sticky-confirm-btn" onclick={confirmDraft}>
          {draftActivePlayer === 'A' ? 'Player B の選択へ →' : '対戦を開始する →'}
        </button>
      </div>
    {/if}

  <!-- ONLINE SKILL DRAFT SELECT SCREEN -->
  {:else if currentScreen === 'onlineSkillSelect'}
    <div class="screen-card card animate-fade-in skill-select-card">
      <div class="screen-header">
        <button class="back-btn" onclick={() => resetGame()} aria-label="モード選択に戻る">
          ← BACK
        </button>
        <h2 class="section-title">ONLINE DRAFTING</h2>
        {#if isOnlineMatch}
          <div class="ping-indicator" class:ping-good={currentPing >= 0 && currentPing < 80} class:ping-fair={currentPing >= 80 && currentPing < 200} class:ping-poor={currentPing >= 200 || currentPing === -1}>
            <span class="ping-dot"></span>
            <span class="ping-text">{currentPing === -1 ? 'DISCONNECT' : `${currentPing} ms`}</span>
          </div>
        {/if}
      </div>

      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; padding: 0.8rem 1rem; background: rgba(0,0,0,0.4); border-radius: 4px; border-left: 4px solid #22d3ee;">
        <span style="color: #94a3b8; font-size: 0.9rem;">相手: <span style="color: #fff; font-weight: bold;">{opponentName}</span></span>
        {#if isOpponentReady}
          <span style="color: #22c55e; font-weight: bold; border: 1px solid #22c55e; padding: 0.2rem 0.6rem; border-radius: 4px; font-size: 0.8rem; letter-spacing: 0.1em; background: rgba(34, 197, 94, 0.1);">READY</span>
        {:else}
          <span style="color: #f59e0b; font-size: 0.8rem; letter-spacing: 0.1em; display: flex; align-items: center; gap: 0.5rem;">
            <span class="animate-pulse-subtle">●</span> SELECTING...
          </span>
        {/if}
      </div>

      <p class="desc-text text-center">対戦で使用するスキルを同時に3つドラフトしてください。</p>

      <div class="draft-list">
        {#each skills as skill}
          {@const isSelected = myRole ? draftSelectedSkills[myRole].includes(skill.id) : false}
          
          {#if isMobile}
            {@const isExpanded = expandedSkillId === skill.id}
            <div class="draft-accordion-item" class:expanded={isExpanded} class:selected={isSelected}>
              <button 
                type="button"
                class="draft-accordion-header" 
                onclick={() => expandedSkillId = isExpanded ? null : skill.id}
              >
                <div class="draft-header-main">
                  <span class="skill-name">{skill.name}</span>
                  <span class="skill-category badge">{skill.category.toUpperCase()}</span>
                </div>
                <div class="draft-header-side">
                  <span class="skill-cost">Cost {skill.cost}</span>
                  {#if isSelected}
                    <span class="selected-check">✓ SELECTED</span>
                  {/if}
                </div>
              </button>
              
              {#if isExpanded}
                <div class="draft-accordion-content animate-fade-in">
                  <p class="draft-skill-desc">{skill.description}</p>
                  <div class="draft-accordion-actions">
                    <button 
                      class="primary-btn compact-btn" 
                      class:remove-btn={isSelected}
                      onclick={() => handleDraftSelect(skill.id)}
                    >
                      {isSelected ? 'REMOVE SKILL' : 'DRAFT SKILL'}
                    </button>
                  </div>
                </div>
              {/if}
            </div>
          {:else}
            <div class="draft-pc-card" class:selected={isSelected}>
              <div class="draft-pc-card-header">
                <div class="draft-header-main">
                  <span class="skill-name">{skill.name}</span>
                  <span class="skill-category badge">{skill.category.toUpperCase()}</span>
                </div>
                <div class="draft-header-side">
                  <span class="skill-cost">Cost {skill.cost}</span>
                  {#if isSelected}
                    <span class="selected-check">✓ SELECTED</span>
                  {/if}
                </div>
              </div>
              <div class="draft-pc-card-body">
                <p class="draft-skill-desc">{skill.description}</p>
                <div class="draft-pc-card-actions">
                  <button 
                    class="primary-btn compact-btn" 
                    class:remove-btn={isSelected}
                    onclick={() => handleDraftSelect(skill.id)}
                  >
                    {isSelected ? 'REMOVE SKILL' : 'DRAFT SKILL'}
                  </button>
                </div>
              </div>
            </div>
          {/if}
        {/each}
      </div>

      {#if !isMobile}
        <div class="draft-actions">
          <button class="confirm-btn" style="{isMeReady ? 'background: #334155; color: #94a3b8; border-color: #334155;' : ''}"
                  onclick={() => {
                    if (myRole) {
                      isMeReady = true;
                      socketManager.getSocket()?.emit('draft:ready', { skills: draftSelectedSkills[myRole] });
                    }
                  }} 
                  disabled={!myRole || draftSelectedSkills[myRole].length < 3 || isMeReady}>
            {isMeReady ? '相手を待っています...' : '準備完了 (READY) →'}
          </button>
        </div>
      {/if}
    </div>

    {#if isMobile}
      {#if myRole && draftSelectedSkills[myRole].length === 3}
        <div class="draft-sticky-footer animate-fade-in">
          <button class="confirm-btn sticky-confirm-btn" style="{isMeReady ? 'background: #334155; color: #94a3b8; border-color: #334155;' : ''}"
                  onclick={() => {
                    if (myRole) {
                      isMeReady = true;
                      socketManager.getSocket()?.emit('draft:ready', { skills: draftSelectedSkills[myRole] });
                    }
                  }} 
                  disabled={isMeReady}>
            {isMeReady ? 'WAITING...' : 'READY →'}
          </button>
        </div>
      {/if}
    {/if}
  {:else if currentScreen === 'battle'}
    {#if introPhase !== 'none'}
      <div class="intro-overlay animate-fade-in" style="position: fixed; inset: 0; background: rgba(0,0,0,0.85); z-index: 9999; display: flex; flex-direction: column; align-items: center; justify-content: center; color: white;">
        {#if introPhase === 'playerInfo'}
          <div class="animate-pulse-subtle" style="font-size: 1.5rem; color: #22d3ee; margin-bottom: 1rem; letter-spacing: 0.2em;">OPPONENT FOUND</div>
          <div style="font-size: 3.5rem; font-weight: bold; text-shadow: 0 0 20px rgba(34, 211, 238, 0.8); letter-spacing: 0.1em; text-align: center; text-transform: uppercase;">{opponentName}</div>
        {:else if introPhase === 'skillsInfo'}
          <div style="font-size: 1.5rem; color: #22d3ee; margin-bottom: 2rem; letter-spacing: 0.2em;">OPPONENT'S SKILLS</div>
          <div style="display: flex; flex-wrap: wrap; gap: 1.5rem; justify-content: center; max-width: 800px; padding: 0 1rem;">
            {#each opponentSkills as skillId}
              {@const skill = skills.find(s => s.id === skillId)}
              {#if skill}
                <div class="intro-skill-card animate-fade-in" style="background: rgba(15,23,42,0.9); border: 1px solid #334155; padding: 1.5rem; border-radius: 0.5rem; text-align: center; width: 220px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.5);">
                  <div style="color: #f8fafc; font-weight: bold; font-size: 1.2rem; margin-bottom: 0.8rem;">{skill.name}</div>
                  <div style="color: #94a3b8; font-size: 0.85rem; letter-spacing: 0.1em;">{skill.category.toUpperCase()} | COST {skill.cost}</div>
                </div>
              {/if}
            {/each}
          </div>
        {:else if introPhase === 'roleInfo'}
          <div class="animate-fade-in" style="font-size: 1.5rem; color: #94a3b8; margin-bottom: 1rem; letter-spacing: 0.2em;">YOUR ROLE</div>
          <div class="animate-fade-in" style="font-size: 4rem; font-weight: bold; text-shadow: 0 0 25px rgba(244, 63, 94, 0.8); letter-spacing: 0.1em; text-align: center; color: #f43f5e;">
            {myRole === 'A' ? '先攻 (PLAYER A)' : '後攻 (PLAYER B)'}
          </div>
        {/if}
      </div>
    {/if}

    <div class="layout-grid animate-fade-in" class:mobile-layout={isMobile}>
      <!-- Sidebar / Game Info & Active Skills (PC用) -->
      {#if !isMobile}
        <section class="sidebar card">
          {#if isOnlineMatch}
            <div style="display: flex; justify-content: flex-end; margin-bottom: 0.5rem; width: 100%;">
              <div class="ping-indicator" class:ping-good={currentPing >= 0 && currentPing < 80} class:ping-fair={currentPing >= 80 && currentPing < 200} class:ping-poor={currentPing >= 200 || currentPing === -1}>
                <span class="ping-dot"></span>
                <span class="ping-text">{currentPing === -1 ? 'DISCONNECT' : `${currentPing} ms`}</span>
              </div>
            </div>
          {/if}
          <div class="turn-indicator" class:player-a={state.currentPlayer === 'A'} class:player-b={state.currentPlayer === 'B'}>
            <div class="indicator-glow"></div>
            <span class="label">CURRENT TURN</span>
            <span class="player-name">
              {#if isOnlineMatch}
                {state.currentPlayer === myRole ? `${myPlayerName} (YOU)` : opponentName}
              {:else}
                {state.currentPlayer === 'A' ? 'PLAYER A (Circle)' : 'PLAYER B (Cross)'}
              {/if}
            </span>
            <span class="turn-counter">Skills used this turn: {state.turnSkillCount}</span>
          </div>

          <!-- Costs Display -->
          <div class="costs-container">
            <div class="cost-box" class:active={state.currentPlayer === 'A'}>
              <span class="cost-label">Player A Cost</span>
              <div class="cost-value-wrapper">
                <span class="cost-number">{state.costs.A}</span>
                <div class="cost-points">
                  {#each Array(Math.min(state.costs.A, 10)) as _}
                    <span class="point-dot circle-dot"></span>
                  {/each}
                </div>
              </div>
            </div>

            <div class="cost-box" class:active={state.currentPlayer === 'B'}>
              <span class="cost-label">Player B Cost</span>
              <div class="cost-value-wrapper">
                <span class="cost-number">{state.costs.B}</span>
                <div class="cost-points">
                  {#each Array(Math.min(state.costs.B, 10)) as _}
                    <span class="point-dot cross-dot"></span>
                  {/each}
                </div>
              </div>
            </div>
          </div>

          <!-- Reset Action (Opens System Menu) -->
          <button class="system-menu-btn" onclick={() => isMenuOpen = true}>
            SYSTEM MENU
          </button>
        </section>
      {:else}
        <!-- スマホ用スリム情報バー -->
        <section class="mobile-info-bar">
          <div class="turn-indicator" class:player-a={state.currentPlayer === 'A'} class:player-b={state.currentPlayer === 'B'}>
            <span class="player-name" style="font-size: 0.95rem; font-weight: 800;">
              {#if isOnlineMatch}
                {state.currentPlayer === myRole ? `${myPlayerName.substring(0, 8)} (YOU)` : opponentName.substring(0, 10)}
              {:else}
                {state.currentPlayer === 'A' ? 'PLAYER A (〇)' : 'PLAYER B (✕)'}
              {/if}
            </span>
            <span class="turn-counter">Skills: {state.turnSkillCount}</span>
          </div>

          {#if isOnlineMatch}
            <div class="ping-indicator ping-mobile" class:ping-good={currentPing >= 0 && currentPing < 80} class:ping-fair={currentPing >= 80 && currentPing < 200} class:ping-poor={currentPing >= 200 || currentPing === -1} style="padding: 0.2rem 0.4rem; font-size: 0.65rem;">
              <span class="ping-dot" style="width: 4px; height: 4px;"></span>
              <span class="ping-text">{currentPing === -1 ? 'OFFLINE' : `${currentPing}ms`}</span>
            </div>
          {/if}

          <div class="mobile-costs-container">
            <div class="mobile-cost-box" class:active={state.currentPlayer === 'A'}>
              <span class="cost-number">A: {state.costs.A}</span>
            </div>
            <div class="mobile-cost-box" class:active={state.currentPlayer === 'B'}>
              <span class="cost-number">B: {state.costs.B}</span>
            </div>
          </div>
          <button class="menu-btn-mobile" onclick={() => isMenuOpen = true} aria-label="Open Menu">
            <span class="hamburger-line"></span>
            <span class="hamburger-line"></span>
            <span class="hamburger-line"></span>
          </button>
        </section>
      {/if}

      <!-- Main Board Section wrapped in container -->
      <div class="board-container-pc">
        <section class="board-area">
          {#if state.winner}
            <div class="winner-modal animate-pulse-subtle">
              <div class="winner-banner" style="max-width: 90%; width: 400px; padding: 2rem 1.5rem;">
                {#if state.winner === 'draw'}
                  <h2 style="font-size: 2.2rem; letter-spacing: 0.1em;">DRAW GAME</h2>
                {:else}
                  <h2 style="font-size: 2.2rem; letter-spacing: 0.1em; text-shadow: 0 0 15px rgba(34, 211, 238, 0.6);">
                    {#if isOnlineMatch}
                      {state.winner === myRole ? 'VICTORY' : 'DEFEAT'}
                    {:else}
                      PLAYER {state.winner} WINS!
                    {/if}
                  </h2>
                {/if}
                <p style="margin: 0.5rem 0 1.5rem 0; font-size: 0.95rem; color: #cbd5e1; line-height: 1.5;">
                  {#if matchEndedReason === 'opponent_surrendered'}
                    相手プレイヤーが降伏（ギブアップ）しました。あなたの勝利です。
                  {:else if matchEndedReason === 'opponent_abandoned'}
                    相手プレイヤーとの接続が切れ、制限時間を経過しました。あなたの勝利です。
                  {:else}
                    4 stones aligned successfully.
                  {/if}
                </p>

                {#if isOnlineMatch}
                  <div class="rematch-status-area">
                    <div class="rematch-status-badge" class:ready={iWantRematch}>
                      {myPlayerName} (YOU): {iWantRematch ? 'READY' : 'WAITING...'}
                    </div>
                    <div class="rematch-status-badge" class:ready={opponentWantsRematch}>
                      {opponentName}: {opponentWantsRematch ? 'READY' : 'WAITING...'}
                    </div>
                  </div>
                  
                  <div class="rematch-actions-row">
                    <button class="modal-reset-btn rematch-btn" style="flex: 1; padding: 0.8rem; font-size: 0.9rem; border-radius: 4px;" onclick={() => {
                      const socket = socketManager.getSocket();
                      socket?.emit('rematch:request');
                    }} disabled={iWantRematch}>
                      {iWantRematch ? 'REQUEST SENT' : 'REMATCH (再戦)'}
                    </button>
                    <button class="modal-reset-btn exit-btn" style="flex: 1; padding: 0.8rem; font-size: 0.9rem; border-radius: 4px;" onclick={resetGame}>
                      EXIT (終了)
                    </button>
                  </div>
                {:else}
                  <button class="modal-reset-btn" onclick={resetGame}>Back to Title</button>
                {/if}
              </div>
            </div>
          {/if}

          <div class="board-wrapper card" class:targeting-active={!!selectedSkillId}>
            <div class="board-grid">
              {#each state.board as row, y}
                {#each row as cell, x}
                  <!-- Evaluate custom style classes from chosen skill -->
                  {@const customStyleClass = selectedSkill ? selectedSkill.getCellStyle(cell, x, y, state, true) : ''}
                  <button
                    class="board-cell {customStyleClass}"
                    class:circle-cell={cell.type === 'circle'}
                    class:cross-cell={cell.type === 'cross'}
                    onclick={() => handleCellClick(x, y)}
                    disabled={!!state.winner}
                  >
                    {#if cell.type === 'circle'}
                      <div class="symbol-circle"></div>
                    {:else if cell.type === 'cross'}
                      <div class="symbol-cross"></div>
                    {/if}
                    {#if cell.type !== 'empty'}
                      <span class="cell-hp">HP {cell.hp}</span>
                    {/if}
                  </button>
                {/each}
              {/each}
            </div>
          </div>
        </section>

        {#if !isMobile}
          <!-- Active Player Drafted Skills Panel (PC用、盤面の下に配置) -->
          <div class="skills-section pc-bottom-skills">
            <div class="skills-list pc-horizontal-skills">
              {#each activePlayerSkills as skill}
                {@const isSkillSelected = selectedSkillId === skill.id}
                {@const isAffordable = state.costs[state.currentPlayer] >= skill.cost}
                <div class="skill-btn-wrapper" style="position: relative;">
                  <button
                    class="skill-btn"
                    class:selected={isSkillSelected}
                    class:locked={!isAffordable}
                    onclick={() => handleSkillSelect(skill)}
                    disabled={!!state.winner}
                  >
                    <div class="skill-meta">
                      <span class="skill-name">{skill.name}</span>
                      <span class="skill-cost">Cost {skill.cost}</span>
                    </div>
                    <p class="skill-desc">{skill.description}</p>
                    {#if isSkillSelected}
                      <span class="skill-status-tag">Targeting...</span>
                    {/if}
                  </button>
                  <button
                    type="button"
                    class="skill-help-trigger"
                    onclick={(e) => { e.stopPropagation(); activeHelpSkill = skill; }}
                    aria-label="スキル詳細説明"
                  >
                    ?
                  </button>
                </div>
              {/each}
            </div>
            {#if selectedSkillId}
              <div class="cancel-skill-tip animate-pulse-subtle">
                盤面の対象マスをクリック、またはスキルをもう一度クリックしてキャンセル
              </div>
            {/if}
          </div>
        {/if}
      </div>

      <!-- スマホ用長方形SKILLSボタン -->
      {#if isMobile}
        <button class="skills-drawer-trigger-bar animate-pulse-subtle" onclick={() => isSkillsDrawerOpen = true}>
          ACTIVE SKILLS
        </button>
      {/if}
    </div>

    <!-- スマホ用ボトムドロワー -->
    {#if isMobile}
      {#if isSkillsDrawerOpen}
        <div 
          class="drawer-overlay" 
          onclick={() => isSkillsDrawerOpen = false}
          onkeydown={(e) => { if (e.key === 'Escape' || e.key === 'Enter') isSkillsDrawerOpen = false; }}
          role="button"
          tabindex="0"
          aria-label="Close skills drawer"
        ></div>
      {/if}
      
      <div class="skills-drawer" class:open={isSkillsDrawerOpen}>
        <div class="drawer-header">
          <h4 class="drawer-title">ACTIVE SKILLS</h4>
          <button class="close-drawer-btn" onclick={() => isSkillsDrawerOpen = false}>✕ CLOSE</button>
        </div>
        <div class="drawer-content">
          <div class="skills-list-drawer">
            {#each activePlayerSkills as skill}
              {@const isSkillSelected = selectedSkillId === skill.id}
              {@const isAffordable = state.costs[state.currentPlayer] >= skill.cost}
              <button
                class="skill-btn-drawer"
                class:selected={isSkillSelected}
                class:locked={!isAffordable}
                onclick={() => {
                  handleSkillSelect(skill);
                  if (skill.targetType !== 'cell') {
                    isSkillsDrawerOpen = false;
                  }
                }}
                disabled={!!state.winner}
              >
                <div class="skill-meta-drawer">
                  <span class="skill-name-drawer">{skill.name}</span>
                  <span class="skill-cost-drawer">Cost {skill.cost}</span>
                </div>
                <p class="skill-desc-drawer">{skill.description}</p>
                {#if isSkillSelected}
                  <span class="skill-status-tag-drawer">Targeting (Tap Board)...</span>
                {/if}
              </button>
            {/each}
          </div>
          {#if selectedSkillId}
            <div class="cancel-skill-tip-drawer">
              盤面タップでスキル発動 / 閉じるタップでキャンセル
            </div>
          {/if}
        </div>
      </div>
    {/if}

    <!-- システムメニューポップアップ (PC/スマホ共通) -->
    {#if isMenuOpen}
      <div 
        class="menu-modal-overlay animate-fade-in" 
        onclick={() => isMenuOpen = false}
        onkeydown={(e) => { if (e.key === 'Escape' || e.key === 'Enter') isMenuOpen = false; }}
        role="button"
        tabindex="0"
        aria-label="Close menu modal"
      >
        <div class="menu-modal-card card" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex="-1">
          <h3 class="menu-modal-title">SYSTEM MENU</h3>
          <div class="menu-modal-actions">
            <button class="menu-modal-btn primary-btn" onclick={() => isMenuOpen = false}>
              RESUME PLAY
            </button>
            <button class="menu-modal-btn secondary-btn" onclick={() => { isMenuOpen = false; isGameSettingsOpen = true; }}>
              SETTINGS
            </button>
            <button class="menu-modal-btn secondary-btn" onclick={() => { isMenuOpen = false; alert('ルール: 5x5盤面で自分の石を縦・横・斜めに4つ並べると勝利。コストを消費してスキルを使用できます。'); }}>
              HOW TO PLAY
            </button>
            <button class="menu-modal-btn danger-btn" onclick={() => { isMenuOpen = false; isExitConfirmOpen = true; }}>
              EXIT MATCH
            </button>
          </div>
        </div>
      </div>
    {/if}

    <!-- ゲーム内設定モーダル -->
    {#if isGameSettingsOpen}
      <div 
        class="menu-modal-overlay animate-fade-in" 
        onclick={() => { isGameSettingsOpen = false; isMenuOpen = true; }}
        onkeydown={(e) => { if (e.key === 'Escape' || e.key === 'Enter') { isGameSettingsOpen = false; isMenuOpen = true; } }}
        role="button"
        tabindex="0"
        aria-label="Close settings modal"
      >
        <div class="menu-modal-card card" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex="-1">
          <h3 class="menu-modal-title">IN-GAME SETTINGS</h3>
          <p class="desc-text text-center">対戦中の設定です。ゲームの状態は保持されます。</p>
          
          <div class="settings-mock-list">
            <div class="mock-item">
              <span>BGM / 音響効果</span>
              <span class="badge">ON</span>
            </div>
            <div class="mock-item">
              <span>グラフィック効果 (Neon Glow)</span>
              <span class="badge">HIGH</span>
            </div>
            <div class="mock-item">
              <span>石の配置アニメーション</span>
              <span class="badge">FAST</span>
            </div>
          </div>
          
          <div class="menu-modal-actions">
            <button class="menu-modal-btn primary-btn" onclick={() => { isGameSettingsOpen = false; isMenuOpen = true; }}>
              BACK TO MENU
            </button>
          </div>
        </div>
      </div>
    {/if}

    <!-- 終了確認モーダル -->
    {#if isExitConfirmOpen}
      <div 
        class="menu-modal-overlay animate-fade-in" 
        onclick={() => { isExitConfirmOpen = false; isMenuOpen = true; }}
        onkeydown={(e) => { if (e.key === 'Escape' || e.key === 'Enter') { isExitConfirmOpen = false; isMenuOpen = true; } }}
        role="button"
        tabindex="0"
        aria-label="Close confirmation modal"
      >
        <div class="menu-modal-card card" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex="-1">
          <h3 class="menu-modal-title" style="color: #f43f5e; text-shadow: 0 0 10px rgba(244, 63, 94, 0.5);">EXIT MATCH?</h3>
          <p class="desc-text text-center">現在の対戦状況は破棄されます。本当にタイトル画面に戻りますか？</p>
          
          <div class="menu-modal-actions" style="flex-direction: row; gap: 1rem;">
            <button class="menu-modal-btn danger-btn" onclick={() => { isExitConfirmOpen = false; isMenuOpen = false; resetGame(); }} style="flex: 1; padding: 0.8rem 1rem; font-size: 0.95rem;">
              YES, EXIT
            </button>
            <button class="menu-modal-btn secondary-btn" onclick={() => { isExitConfirmOpen = false; isMenuOpen = true; }} style="flex: 1; padding: 0.8rem 1rem; font-size: 0.95rem;">
              NO, CANCEL
            </button>
          </div>
        </div>
      </div>
    {/if}
  {/if}

  {#if activeHelpSkill}
    <div 
      class="skill-help-overlay" 
      role="button" 
      tabindex="0" 
      onclick={() => activeHelpSkill = null}
      onkeydown={(e) => { if (e.key === 'Escape' || e.key === 'Enter') activeHelpSkill = null; }}
    >
      <div 
        class="skill-help-modal card" 
        role="dialog" 
        aria-modal="true"
        tabindex="-1"
        onclick={(e) => e.stopPropagation()}
        onkeydown={(e) => e.stopPropagation()}
      >
        <div class="skill-help-header">
          <h4 class="skill-help-title">{activeHelpSkill.name}</h4>
          <span class="skill-cost">Cost {activeHelpSkill.cost}</span>
        </div>
        <p class="skill-help-desc">{activeHelpSkill.description}</p>
        <button class="primary-btn compact-btn" onclick={() => activeHelpSkill = null}>
          CLOSE
        </button>
      </div>
    </div>
  {/if}

  {#if opponentDisconnected}
    <div class="menu-modal-overlay animate-fade-in" style="z-index: 99999;">
      <div class="menu-modal-card card" style="border-color: #f43f5e; box-shadow: 0 0 35px rgba(244, 63, 94, 0.5); max-width: 400px; gap: 1.25rem;">
        <h3 class="menu-modal-title" style="color: #f43f5e; text-shadow: 0 0 10px rgba(244, 63, 94, 0.5); margin: 0; font-size: 1.4rem;">CONNECTION LOST</h3>
        <p class="desc-text" style="margin: 0.5rem 0; font-size: 1rem; line-height: 1.5;">対戦相手（{opponentName}）との接続が切れました。</p>
        <div style="font-size: 3.5rem; font-weight: bold; color: #f43f5e; font-family: monospace; text-shadow: 0 0 10px rgba(244, 63, 94, 0.5); line-height: 1; margin: 0.5rem 0;">{disconnectCountdown}s</div>
        <p style="font-size: 0.85rem; color: #94a3b8; margin: 0; line-height: 1.4;">再接続を待っています。時間切れになるとあなたの勝利になります。</p>
      </div>
    </div>
  {/if}

  {#if isOnlineMatch && !isSocketConnected}
    <div class="menu-modal-overlay animate-fade-in" style="z-index: 99999;">
      <div class="menu-modal-card card" style="border-color: #eab308; box-shadow: 0 0 35px rgba(234, 179, 8, 0.5); max-width: 400px; gap: 1.25rem;">
        <h3 class="menu-modal-title" style="color: #eab308; text-shadow: 0 0 10px rgba(234, 179, 8, 0.5); margin: 0; font-size: 1.4rem;">RECONNECTING...</h3>
        <p class="desc-text" style="margin: 0.5rem 0; font-size: 1rem; line-height: 1.5;">サーバーとの接続が切断されました。</p>
        <div class="spinner" style="border: 4px solid rgba(234, 179, 8, 0.1); border-left-color: #eab308; border-radius: 50%; width: 40px; height: 40px; margin: 0.5rem auto; animation: spin 1s linear infinite;"></div>
        <p style="font-size: 0.85rem; color: #94a3b8; margin: 0; line-height: 1.4;">インターネット接続を確認し、再接続を待っています...</p>
      </div>
    </div>
  {/if}
</main>

<style>
  /* Connection Strength & Rematch Custom Styles */
  .ping-indicator {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.3rem 0.6rem;
    background: rgba(15, 23, 42, 0.6);
    border: 1px solid #334155;
    border-radius: 4px;
    font-family: monospace;
    font-size: 0.75rem;
    letter-spacing: 0.05em;
    color: #94a3b8;
  }
  .ping-indicator.ping-good {
    border-color: rgba(34, 197, 94, 0.4);
    color: #4ade80;
  }
  .ping-indicator.ping-good .ping-dot {
    background: #22c55e;
    box-shadow: 0 0 8px #22c55e;
  }
  .ping-indicator.ping-fair {
    border-color: rgba(234, 179, 8, 0.4);
    color: #facc15;
  }
  .ping-indicator.ping-fair .ping-dot {
    background: #eab308;
    box-shadow: 0 0 8px #eab308;
  }
  .ping-indicator.ping-poor {
    border-color: rgba(239, 68, 68, 0.4);
    color: #f87171;
    animation: ping-alert 1.5s infinite alternate ease-in-out;
  }
  .ping-indicator.ping-poor .ping-dot {
    background: #ef4444;
    box-shadow: 0 0 8px #ef4444;
  }
  .ping-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    display: inline-block;
  }
  
  .rematch-status-area {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin: 1rem 0;
    width: 100%;
    align-items: center;
  }
  .rematch-status-badge {
    padding: 0.4rem 1rem;
    background: rgba(15, 23, 42, 0.8);
    border: 1px solid #1e293b;
    border-radius: 4px;
    font-size: 0.85rem;
    color: #94a3b8;
    width: 100%;
    max-width: 280px;
    text-align: center;
    box-sizing: border-box;
    transition: all 0.3s ease;
  }
  .rematch-status-badge.ready {
    border-color: rgba(34, 211, 238, 0.5);
    color: #22d3ee;
    text-shadow: 0 0 8px rgba(34, 211, 238, 0.3);
    background: rgba(34, 211, 238, 0.1);
  }
  .rematch-actions-row {
    display: flex;
    gap: 1rem;
    margin-top: 1rem;
    width: 100%;
    justify-content: center;
  }
  .rematch-btn {
    background: rgba(34, 211, 238, 0.1) !important;
    border-color: #22d3ee !important;
    color: #22d3ee !important;
  }
  .rematch-btn:hover:not(:disabled) {
    background: #22d3ee !important;
    color: #0f172a !important;
    box-shadow: 0 0 15px rgba(34, 211, 238, 0.4);
  }
  .rematch-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    border-color: #334155 !important;
    color: #94a3b8 !important;
    background: rgba(51, 65, 85, 0.2) !important;
  }
  .exit-btn {
    background: rgba(244, 63, 94, 0.1) !important;
    border-color: #f43f5e !important;
    color: #f43f5e !important;
  }
  .exit-btn:hover {
    background: #f43f5e !important;
    color: white !important;
    box-shadow: 0 0 15px rgba(244, 63, 94, 0.4);
  }

  @keyframes ping-alert {
    from { border-color: rgba(239, 68, 68, 0.2); box-shadow: 0 0 5px rgba(239, 68, 68, 0.1); }
    to { border-color: rgba(239, 68, 68, 0.7); box-shadow: 0 0 15px rgba(239, 68, 68, 0.3); }
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .game-wrapper {
    width: 100%;
    max-width: 1100px;
    padding: 2rem;
    box-sizing: border-box;
  }

  /* Screens & Navigation Styles */
  .screen-card {
    max-width: 600px;
    margin: 4rem auto;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .text-center {
    text-align: center;
  }

  .hero-title {
    font-size: clamp(1.4rem, 7.5vw, 4rem);
    font-weight: 800;
    white-space: nowrap;
    margin: 0;
    letter-spacing: 0.05em;
    color: #22d3ee;
    text-shadow: 0 0 15px rgba(34, 211, 238, 0.6);
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .hero-subtitle {
    color: #94a3b8;
    font-size: 1.1rem;
    margin: 0;
    letter-spacing: 0.05em;
  }

  /* Screen header: back btn left, title center */
  .screen-header {
    display: flex;
    align-items: center;
    gap: 1.25rem;
    margin-bottom: 0.5rem;
  }

  .screen-header .section-title {
    flex: 1;
    text-align: center;
    margin-right: 4rem; /* balance the back btn width */
  }

  .menu-actions {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    margin-top: 1.5rem;
  }

  /* Button Styles (High Contrast, Cyberpunk style) */
  .primary-btn {
    background: #22d3ee;
    border: 2px solid #22d3ee;
    color: #000000;
    padding: 1rem 1.5rem;
    border-radius: 0.25rem;
    font-weight: 800;
    cursor: pointer;
    font-size: 1.1rem;
    letter-spacing: 0.05em;
    transition: all 0.25s ease;
    width: 100%;
    text-transform: uppercase;
  }

  .primary-btn:hover {
    background: #000000;
    color: #22d3ee;
    box-shadow: 0 0 25px rgba(34, 211, 238, 0.7);
    transform: translateY(-2px);
  }

  .primary-btn:focus-visible {
    outline: 3px solid #22d3ee;
    outline-offset: 3px;
  }

  .secondary-btn {
    background: transparent;
    border: 2px solid #1e293b;
    color: #f8fafc;
    padding: 1rem 1.5rem;
    border-radius: 0.25rem;
    font-weight: 600;
    cursor: pointer;
    font-size: 1.1rem;
    transition: all 0.25s ease;
    width: 100%;
    text-transform: uppercase;
  }

  .secondary-btn:hover {
    border-color: #22d3ee;
    color: #22d3ee;
    background: rgba(34, 211, 238, 0.05);
  }

  .secondary-btn:focus-visible {
    outline: 3px solid #22d3ee;
    outline-offset: 3px;
  }

  .disabled-btn {
    background: transparent;
    border: 2px solid #1e293b;
    color: #475569;
    padding: 1rem 1.5rem;
    border-radius: 0.25rem;
    font-weight: 600;
    font-size: 1.1rem;
    cursor: not-allowed;
    width: 100%;
    text-transform: uppercase;
  }

  /* Back Button: Solid Cyan, Bold Black Text, Glow on Hover */
  .back-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    background: #22d3ee;
    border: 2px solid #22d3ee;
    color: #000000;
    padding: 0.6rem 1.2rem;
    border-radius: 0.25rem;
    font-weight: 800;
    font-size: 0.95rem;
    letter-spacing: 0.05em;
    cursor: pointer;
    transition: all 0.25s ease;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .back-btn:hover {
    background: #000000;
    color: #22d3ee;
    box-shadow: 0 0 20px #22d3ee;
  }

  .back-btn:focus-visible {
    outline: 3px solid #22d3ee;
    outline-offset: 3px;
  }

  /* Settings Mock Screen */
  .desc-text {
    color: #94a3b8;
    margin: 0;
  }

  .settings-mock-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin: 1rem 0;
  }

  .mock-item {
    background: rgba(17, 24, 39, 0.85);
    padding: 1rem;
    border-radius: 0.25rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border: 1px solid #1e293b;
  }

  .badge {
    background: rgba(34, 211, 238, 0.1);
    color: #22d3ee;
    font-size: 0.75rem;
    padding: 0.2rem 0.5rem;
    border-radius: 0.25rem;
    font-weight: 600;
    border: 1px solid rgba(34, 211, 238, 0.2);
  }

  /* Draft Select Screen */
  .draft-indicator {
    padding: 0.75rem;
    border-radius: 0.25rem;
    text-align: center;
    font-weight: 800;
    font-size: 1.1rem;
    transition: all 0.3s ease;
  }

  .draft-indicator.player-a {
    background: rgba(34, 211, 238, 0.1);
    color: #22d3ee;
    border: 1px solid #22d3ee;
  }

  .draft-indicator.player-b {
    background: rgba(248, 250, 252, 0.05);
    color: #f8fafc;
    border: 1px solid #f8fafc;
  }

  .draft-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 1rem;
    margin: 1.5rem 0;
  }

  @media (min-width: 600px) {
    .draft-grid {
      grid-template-columns: 1fr 1fr;
    }
  }

  .draft-cell-btn {
    text-align: left;
    background: rgba(17, 24, 39, 0.85);
    border: 1px solid #1e293b;
    padding: 1rem;
    border-radius: 0.25rem;
    cursor: pointer;
    transition: all 0.2s ease;
    color: #f8fafc;
    position: relative;
  }

  .draft-cell-btn:hover:not(:disabled) {
    background: #111827;
    border-color: #22d3ee;
  }

  .draft-cell-btn.selected {
    background: rgba(34, 211, 238, 0.1);
    border-color: #22d3ee;
    box-shadow: 0 0 15px rgba(34, 211, 238, 0.3);
  }

  .draft-cell-btn.taken {
    opacity: 0.3;
    cursor: not-allowed;
    border-color: #1e293b;
  }

  .taken-badge {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    font-size: 0.7rem;
    background: rgba(34, 211, 238, 0.2);
    color: #22d3ee;
    padding: 0.1rem 0.4rem;
    border-radius: 2px;
  }

  .draft-actions {
    display: flex;
    justify-content: center;
    margin-top: 1rem;
  }

  .confirm-btn {
    background: #22d3ee;
    border: 2px solid #22d3ee;
    color: #000000;
    padding: 1rem 2.5rem;
    border-radius: 0.25rem;
    font-weight: 800;
    cursor: pointer;
    font-size: 1.1rem;
    transition: all 0.25s ease;
    text-transform: uppercase;
  }

  .confirm-btn:hover:not(:disabled) {
    background: #000000;
    color: #22d3ee;
    box-shadow: 0 0 20px rgba(34, 211, 238, 0.5);
  }

  .confirm-btn:disabled {
    background: #1e293b;
    border-color: #1e293b;
    color: #475569;
    cursor: not-allowed;
  }

  /* Animations */
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .animate-fade-in {
    animation: fadeIn 0.3s forwards ease-out;
  }

  /* BATTLE ARENA STYLES */
  .header {
    text-align: center;
    margin-bottom: 2.5rem;
  }

  .title {
    font-size: 3rem;
    font-weight: 800;
    margin: 0;
    letter-spacing: 0.05em;
    color: #22d3ee;
    text-shadow: 0 0 15px rgba(34, 211, 238, 0.4);
  }

  .subtitle {
    margin-top: 0.5rem;
    font-size: 1rem;
    color: #94a3b8;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .layout-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 2rem;
    align-items: start;
  }

  /* Global fallback for board-container-pc */
  .board-container-pc {
    display: contents;
  }

  @media (min-width: 769px) {
    .layout-grid {
      grid-template-columns: 340px 1fr;
      align-items: center;
      height: 88vh;
      max-height: 88vh;
      gap: 2rem;
      width: 100%;
    }
    :global(body:has(.layout-grid)) {
      height: 100vh;
      overflow: hidden;
    }
    .game-wrapper:has(.layout-grid) {
      height: 100vh;
      max-height: 100vh;
      box-sizing: border-box;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
      overflow: hidden;
    }
    .board-container-pc {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1.25rem;
      width: 100%;
    }
    .board-area {
      max-width: 54vh;
      max-height: 54vh;
    }
    .sidebar {
      gap: 1rem;
      padding: 1.25rem;
    }
    .pc-bottom-skills {
      width: 100%;
      max-width: 600px;
    }
    .pc-horizontal-skills {
      display: grid !important;
      grid-template-columns: repeat(3, 1fr) !important;
      gap: 0.75rem;
      width: 100%;
    }
    .pc-horizontal-skills .skill-btn {
      padding: 0.75rem;
      min-height: 90px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .pc-horizontal-skills .skill-desc {
      font-size: 0.75rem;
      line-height: 1.3;
      margin-top: 0.25rem;
    }
  }

  /* Cards Style */
  .card {
    background: rgba(17, 24, 39, 0.85);
    border: 1px solid #1e293b;
    border-radius: 0.25rem;
    padding: 1.5rem;
    box-shadow: 0 10px 30px -10px rgba(0, 0, 0, 0.5);
  }

  /* Sidebar details */
  .sidebar {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .turn-indicator {
    position: relative;
    padding: 1.25rem;
    border-radius: 0.25rem;
    background: #000000;
    display: flex;
    flex-direction: column;
    border: 1px solid #1e293b;
    transition: all 0.3s ease;
  }

  .turn-indicator.player-a {
    border-color: #22d3ee;
    box-shadow: 0 0 15px rgba(34, 211, 238, 0.2);
  }

  .turn-indicator.player-b {
    border-color: #f8fafc;
    box-shadow: 0 0 15px rgba(248, 250, 252, 0.2);
  }

  .label {
    font-size: 0.75rem;
    font-weight: 600;
    color: #94a3b8;
    letter-spacing: 0.15em;
  }

  .player-name {
    font-size: 1.25rem;
    font-weight: 800;
    margin-top: 0.25rem;
  }

  .player-a .player-name {
    color: #22d3ee;
    text-shadow: 0 0 10px rgba(34, 211, 238, 0.3);
  }

  .player-b .player-name {
    color: #f8fafc;
  }

  .turn-counter {
    margin-top: 0.5rem;
    font-size: 0.8rem;
    color: #64748b;
  }

  /* Cost system */
  .costs-container {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
  }

  .cost-box {
    background: #000000;
    padding: 1rem;
    border-radius: 0.25rem;
    border: 1px solid #1e293b;
    opacity: 0.6;
    transition: all 0.3s ease;
  }

  .cost-box.active {
    opacity: 1;
    border-color: #22d3ee;
  }

  .cost-label {
    font-size: 0.75rem;
    color: #94a3b8;
  }

  .cost-value-wrapper {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.25rem;
  }

  .cost-number {
    font-size: 1.75rem;
    font-weight: 800;
  }

  .cost-points {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    max-width: 60px;
  }

  .point-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
  }

  .circle-dot {
    background-color: #22d3ee;
    box-shadow: 0 0 5px #22d3ee;
  }

  .cross-dot {
    background-color: #f8fafc;
    box-shadow: 0 0 5px #f8fafc;
  }

  /* Skills Selection */
  .skills-section {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .section-title {
    font-size: 1.1rem;
    font-weight: 600;
    margin: 0;
    color: #22d3ee;
    letter-spacing: 0.05em;
  }

  .skills-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .skill-btn {
    text-align: left;
    background: #000000;
    border: 1px solid #1e293b;
    padding: 1rem;
    border-radius: 0.25rem;
    cursor: pointer;
    transition: all 0.2s ease;
    color: #f8fafc;
  }

  .skill-btn:hover:not(:disabled) {
    border-color: #22d3ee;
  }

  .skill-btn.selected {
    background: rgba(34, 211, 238, 0.1);
    border-color: #22d3ee;
    box-shadow: 0 0 15px rgba(34, 211, 238, 0.3);
  }

  .skill-btn.locked {
    opacity: 0.4;
  }

  .skill-meta {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.25rem;
  }

  .skill-name {
    font-weight: 700;
    font-size: 0.95rem;
  }

  .skill-cost {
    font-size: 0.75rem;
    background: rgba(34, 211, 238, 0.2);
    border: 1px solid rgba(34, 211, 238, 0.3);
    padding: 0.2rem 0.5rem;
    border-radius: 0.25rem;
    color: #22d3ee;
    font-weight: bold;
  }

  .skill-desc {
    font-size: 0.8rem;
    color: #94a3b8;
    margin: 0;
  }

  .skill-status-tag {
    display: inline-block;
    font-size: 0.75rem;
    color: #22d3ee;
    margin-top: 0.5rem;
    font-weight: 700;
  }

  .cancel-skill-tip {
    font-size: 0.75rem;
    color: #22d3ee;
    text-align: center;
    background: rgba(34, 211, 238, 0.05);
    padding: 0.5rem;
    border-radius: 0.25rem;
    border: 1px solid rgba(34, 211, 238, 0.2);
  }

  /* System Menu Action Button (PC) */
  .system-menu-btn {
    background: transparent;
    border: 2px solid #22d3ee;
    color: #22d3ee;
    padding: 0.75rem;
    border-radius: 0.25rem;
    font-weight: 800;
    cursor: pointer;
    transition: all 0.2s ease;
    width: 100%;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .system-menu-btn:hover {
    background: rgba(34, 211, 238, 0.1);
    box-shadow: 0 0 15px rgba(34, 211, 238, 0.4);
  }

  /* Reset layout button (Fallback) */
  .reset-btn {
    background: transparent;
    border: 2px solid #1e293b;
    color: #f8fafc;
    padding: 0.75rem;
    border-radius: 0.25rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .reset-btn:hover {
    border-color: #f43f5e;
    color: #f43f5e;
    box-shadow: 0 0 15px rgba(244, 63, 94, 0.3);
  }

  /* SYSTEM MENU POPUP MODAL STYLES */
  .menu-modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.85);
    backdrop-filter: blur(5px);
    z-index: 2000;
    display: flex;
    justify-content: center;
    align-items: center;
  }

  .menu-modal-card {
    max-width: 380px;
    width: 90%;
    background: #111827;
    border: 2px solid #22d3ee;
    box-shadow: 0 0 35px rgba(34, 211, 238, 0.5);
    padding: 2.25rem 2rem;
    display: flex;
    flex-direction: column;
    gap: 1.75rem;
    text-align: center;
    border-radius: 0.25rem;
  }

  .menu-modal-title {
    font-size: 1.5rem;
    font-weight: 800;
    color: #22d3ee;
    margin: 0;
    letter-spacing: 0.1em;
    text-shadow: 0 0 10px rgba(34, 211, 238, 0.5);
  }

  .menu-modal-actions {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }

  .menu-modal-btn {
    width: 100%;
    box-sizing: border-box;
  }

  .danger-btn {
    background: rgba(244, 63, 94, 0.1);
    border: 2px solid #f43f5e;
    color: #f43f5e;
    padding: 1rem 1.5rem;
    font-weight: 800;
    border-radius: 0.25rem;
    cursor: pointer;
    transition: all 0.25s ease;
    text-transform: uppercase;
    font-size: 1.1rem;
  }

  .danger-btn:hover {
    background: #f43f5e;
    color: #ffffff;
    box-shadow: 0 0 15px rgba(244, 63, 94, 0.5);
  }

  /* Board Area */
  .board-area {
    position: relative;
    width: 100%;
    aspect-ratio: 1;
    max-width: 50vh;
    max-height: 50vh;
    margin: 0 auto;
  }

  .board-wrapper {
    display: flex;
    justify-content: center;
    align-items: center;
    height: 100%;
    width: 100%;
    box-sizing: border-box;
    padding: 1rem;
  }

  .board-wrapper.targeting-active {
    border-color: #22d3ee;
    box-shadow: 0 0 30px rgba(34, 211, 238, 0.15);
  }

  .board-grid {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    grid-template-rows: repeat(5, 1fr);
    gap: 0.5rem;
    width: 100%;
    height: 100%;
  }

  /* Individual Board Cells */
  .board-cell {
    position: relative;
    width: 100%;
    height: 100%;
    aspect-ratio: 1;
    background: #000000;
    border: 1.5px solid #334155; /* Board line colour as requested */
    border-radius: 0.25rem;
    display: flex;
    justify-content: center;
    align-items: center;
    cursor: pointer;
    transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    box-sizing: border-box;
  }

  .board-cell:hover:not(:disabled) {
    background: rgba(34, 211, 238, 0.05);
    border-color: #22d3ee;
  }

  .cell-hp {
    position: absolute;
    bottom: 0.25rem;
    right: 0.35rem;
    font-size: 0.6rem;
    color: #475569;
    font-weight: bold;
  }

  /* Symbols design & place animation */
  @keyframes piece-appear {
    0% {
      transform: scale(0.3);
      opacity: 0;
    }
    50% {
      transform: scale(1.1);
      filter: brightness(2);
    }
    100% {
      transform: scale(1);
      opacity: 1;
    }
  }

  .symbol-circle {
    width: 45%;
    height: 45%;
    border-radius: 50%;
    border: 6px solid #22d3ee; /* Neon Cyan */
    box-shadow: 0 0 20px #22d3ee;
    box-sizing: border-box;
    animation: piece-appear 0.3s ease-out forwards;
  }

  .symbol-cross {
    position: relative;
    width: 45%;
    height: 45%;
    animation: piece-appear 0.3s ease-out forwards;
  }

  .symbol-cross::before, .symbol-cross::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    width: 6px;
    height: 100%;
    background-color: #f8fafc; /* Bright White */
    box-shadow: 0 0 20px #f8fafc;
    border-radius: 3px;
  }

  .symbol-cross::before {
    transform: translate(-50%, -50%) rotate(45deg);
  }

  .symbol-cross::after {
    transform: translate(-50%, -50%) rotate(-45deg);
  }

  /* Custom targeting classes applied via skills */
  :global(.board-cell.cyber-glow-cyan-border) {
    border-color: #22d3ee !important;
    box-shadow: 0 0 15px rgba(34, 211, 238, 0.4) !important;
  }

  :global(.board-cell.cyber-glow-red-border) {
    border-color: #f43f5e !important;
    box-shadow: 0 0 15px rgba(244, 63, 94, 0.4) !important;
  }

  :global(.board-cell.skill-target-shuffle-area) {
    border-color: #22d3ee !important;
    background: rgba(34, 211, 238, 0.05) !important;
  }

  :global(.board-cell.skill-target-swap-selected) {
    background: rgba(34, 211, 238, 0.15) !important;
    border-color: #22d3ee !important;
    box-shadow: 0 0 20px #22d3ee !important;
  }

  :global(.board-cell.skill-target-swap-dest) {
    background: rgba(244, 63, 94, 0.1) !important;
    border-color: #f43f5e !important;
  }
  :global(.board-cell.skill-target-swap-dest:hover) {
    box-shadow: 0 0 15px rgba(244, 63, 94, 0.6) !important;
  }

  :global(.board-cell.is-shielded) {
    border-color: #0ea5e9 !important;
    box-shadow: inset 0 0 10px rgba(14, 165, 233, 0.5), 0 0 15px rgba(14, 165, 233, 0.3) !important;
  }

  :global(.board-cell.skill-target-invalid) {
    opacity: 0.3;
    cursor: not-allowed;
  }

  /* Winner Overlay Modals */
  .winner-modal {
    position: absolute;
    inset: 0;
    z-index: 10;
    background: rgba(0, 0, 0, 0.95);
    border: 2px solid #22d3ee;
    border-radius: 0.25rem;
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 2rem;
    box-shadow: 0 0 30px rgba(34, 211, 238, 0.2);
  }

  .winner-banner {
    text-align: center;
  }

  .winner-banner h2 {
    font-size: 2.25rem;
    font-weight: 800;
    margin: 0;
    color: #22d3ee;
    text-shadow: 0 0 20px rgba(34, 211, 238, 0.6);
  }

  .winner-banner p {
    color: #94a3b8;
    margin-top: 0.5rem;
    margin-bottom: 1.5rem;
  }

  .modal-reset-btn {
    background: #22d3ee;
    border: none;
    color: #000000;
    font-weight: 800;
    padding: 0.75rem 2rem;
    border-radius: 0.25rem;
    cursor: pointer;
    transition: all 0.2s;
    text-transform: uppercase;
  }

  .modal-reset-btn:hover {
    box-shadow: 0 0 20px #22d3ee;
    transform: scale(1.05);
  }

  /* Help Overlay & Modal Styles */
  .skill-help-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.85);
    z-index: 1000;
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 1.5rem;
    backdrop-filter: blur(4px);
  }

  .skill-help-modal {
    max-width: 400px;
    width: 100%;
    background: #111827;
    border: 2px solid #22d3ee;
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    box-shadow: 0 0 25px rgba(34, 211, 238, 0.4);
  }

  .skill-help-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .skill-help-title {
    font-size: 1.3rem;
    font-weight: 800;
    color: #22d3ee;
    margin: 0;
  }

  .skill-help-desc {
    color: #f8fafc;
    font-size: 0.95rem;
    line-height: 1.5;
    margin: 0;
  }

  .compact-btn {
    align-self: flex-end;
    padding: 0.5rem 1.5rem;
    font-size: 0.9rem;
    max-width: 120px;
  }

  .skill-help-trigger {
    display: none;
  }

  /* MOBILE OPTIMIZATIONS (SCROLL-FREE 100DVH VIEWPORT) */
  @media (max-width: 768px) {
    :global(body) {
      height: 100dvh;
      overflow: hidden;
      position: fixed;
      width: 100%;
    }

    .game-wrapper {
      height: 100dvh;
      padding: 0.5rem;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      overflow: hidden;
      box-sizing: border-box;
    }

    /* Hide header logo inside battle screen */
    :global(body:has(.layout-grid)) .header,
    .header {
      display: none !important;
    }

    .layout-grid {
      display: flex;
      flex-direction: column;
      height: 100%;
      justify-content: space-between;
      gap: 0.5rem;
      margin: 0;
    }

    .sidebar {
      display: none !important;
    }

    /* Slim top row turn indicator & costs */
    .turn-indicator {
      padding: 0.4rem 0.6rem;
      flex-direction: row;
      justify-content: space-between;
      align-items: center;
      background: #111827;
      border: 1px solid #1e293b;
    }

    .turn-indicator .player-name {
      font-size: 0.95rem;
      margin: 0;
    }

    .turn-counter {
      margin: 0;
      font-size: 0.75rem;
    }

    .costs-container {
      display: flex;
      gap: 0.4rem;
    }

    .cost-box {
      padding: 0.35rem 0.6rem;
      flex: 1;
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #111827;
      border: 1px solid #1e293b;
    }

    .cost-value-wrapper {
      margin: 0;
    }

    .cost-number {
      font-size: 1.1rem;
    }

    .cost-points {
      display: none; /* Hide cost point dots on mobile to save vertical space */
    }

    /* Exit Battle button placed nicely */
    .reset-btn {
      position: absolute;
      top: 0.4rem;
      right: 0.4rem;
      padding: 0.25rem 0.5rem;
      font-size: 0.7rem;
      border-radius: 0.25rem;
      background: rgba(244, 63, 94, 0.1);
      border-color: rgba(244, 63, 94, 0.3);
      z-index: 100;
    }

    /* Center Board scaling to take available height */
    .board-area {
      flex: 0 0 auto;
      display: flex;
      justify-content: center;
      align-items: center;
      width: 80vw;
      height: 80vw;
      max-width: 40vh;
      max-height: 40vh;
      margin: 0 auto;
      box-sizing: border-box;
    }

    .board-wrapper {
      padding: 0.3rem;
      width: 100%;
      height: 100%;
      box-sizing: border-box;
    }

    .board-grid {
      gap: 0.25rem;
    }

    .board-cell {
      border-width: 1px;
    }



    /* Help trigger button layout */
    .skill-help-trigger {
      display: flex;
      position: absolute;
      top: -2px;
      right: -2px;
      width: 15px;
      height: 15px;
      border-radius: 50%;
      background: #22d3ee;
      border: 1px solid #22d3ee;
      color: #000000;
      font-size: 0.65rem;
      font-weight: 800;
      justify-content: center;
      align-items: center;
      cursor: pointer;
      z-index: 10;
    }

    .cancel-skill-tip {
      font-size: 0.7rem;
      padding: 0.35rem;
      margin-top: 0.25rem;
    }

    .skills-drawer-trigger-bar {
      margin: 0 auto;
      width: 100%;
      max-width: 100%;
      border-radius: 0.375rem 0.375rem 0 0;
      border-bottom: none;
      box-sizing: border-box;
      padding-bottom: calc(0.75rem + env(safe-area-inset-bottom, 0px));
    }

    /* Mobile Hamburger Menu Button */
    .menu-btn-mobile {
      background: transparent;
      border: 1.5px solid #22d3ee;
      padding: 0.4rem 0.45rem;
      border-radius: 0.25rem;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      align-items: center;
      width: 32px;
      height: 26px;
      box-sizing: border-box;
      box-shadow: 0 0 5px rgba(34, 211, 238, 0.3);
      flex-shrink: 0;
    }
    .menu-btn-mobile:hover {
      background: rgba(34, 211, 238, 0.05);
      box-shadow: 0 0 10px rgba(34, 211, 238, 0.5);
    }
    .hamburger-line {
      width: 100%;
      height: 2px;
      background-color: #22d3ee;
      border-radius: 1px;
    }

    /* Lobby Screen Mobile Layout Fixes */
    .screen-card {
      margin: 1.5rem auto !important;
      padding: 1.25rem !important;
      width: 92% !important;
      box-sizing: border-box;
      max-height: 85vh;
      overflow-y: auto;
    }
    .screen-header {
      flex-direction: row !important;
      justify-content: space-between;
      align-items: center;
      gap: 0.5rem;
      width: 100%;
    }
    .screen-header .section-title {
      margin-right: 0 !important;
      font-size: 1.25rem !important;
      text-align: center;
      white-space: nowrap;
    }
    .screen-header .back-btn {
      padding: 0.4rem 0.8rem !important;
      font-size: 0.8rem !important;
    }
    .screen-header .ping-indicator {
      padding: 0.3rem 0.6rem !important;
      font-size: 0.75rem !important;
    }
  }

  /* Accordion and Drafting List Styles */
  .skill-select-card {
    padding-bottom: 90px; /* Leave room for sticky footer */
    max-height: 85vh;
    overflow-y: auto;
  }
  
  .draft-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin: 1.5rem 0;
  }

  .draft-accordion-item {
    background: rgba(17, 24, 39, 0.85);
    border: 1px solid #1e293b;
    border-radius: 0.25rem;
    overflow: hidden;
    transition: border-color 0.25s;
  }

  .draft-accordion-item.selected {
    border-color: #22d3ee;
    box-shadow: 0 0 10px rgba(34, 211, 238, 0.15);
  }

  .draft-accordion-item.taken {
    opacity: 0.45;
  }

  .draft-accordion-header {
    width: 100%;
    background: transparent;
    border: none;
    color: #f8fafc;
    padding: 1rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
    cursor: pointer;
    font-family: inherit;
    text-align: left;
  }

  .draft-accordion-header:hover {
    background: rgba(34, 211, 238, 0.02);
  }

  .draft-header-main {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .draft-header-side {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .draft-accordion-content {
    padding: 0 1rem 1rem 1rem;
    border-top: 1px solid rgba(30, 41, 59, 0.5);
    background: rgba(0, 0, 0, 0.2);
  }

  .draft-accordion-content .draft-skill-desc {
    margin: 1rem 0;
    line-height: 1.5;
  }

  .draft-accordion-actions {
    display: flex;
    justify-content: flex-end;
  }

  .selected-check {
    color: #22d3ee;
    font-weight: 800;
    font-size: 0.85rem;
    letter-spacing: 0.05em;
  }

  .remove-btn {
    background: #f43f5e !important;
    border-color: #f43f5e !important;
    color: #ffffff !important;
  }

  .remove-btn:hover {
    background: #000000 !important;
    color: #f43f5e !important;
    box-shadow: 0 0 15px rgba(244, 63, 94, 0.5) !important;
  }

  /* Sticky Footer Styles */
  .draft-sticky-footer {
    position: fixed;
    bottom: 0;
    left: 0;
    width: 100%;
    background: #000000;
    border-top: 2px solid #22d3ee;
    padding: 1rem 2rem;
    display: flex;
    justify-content: center;
    box-sizing: border-box;
    z-index: 1000;
    box-shadow: 0 -10px 30px rgba(0, 0, 0, 0.8);
  }

  .sticky-confirm-btn {
    max-width: 600px;
    width: 100%;
    background: #22d3ee;
    color: #000000;
    border: 2px solid #22d3ee;
    box-shadow: 0 0 15px rgba(34, 211, 238, 0.4);
  }

  .sticky-confirm-btn:hover {
    background: #000000;
    color: #22d3ee;
    box-shadow: 0 0 25px #22d3ee;
  }

  /* PC版 スキルドラフトカード */
  .draft-pc-card {
    background: rgba(17, 24, 39, 0.85);
    border: 1px solid #1e293b;
    border-radius: 0.25rem;
    padding: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    transition: all 0.25s ease;
  }

  .draft-pc-card:hover {
    border-color: rgba(34, 211, 238, 0.3);
  }

  .draft-pc-card.selected {
    border-color: #22d3ee;
    box-shadow: 0 0 15px rgba(34, 211, 238, 0.2);
    background: rgba(34, 211, 238, 0.02);
  }

  .draft-pc-card.taken {
    opacity: 0.45;
  }

  .draft-pc-card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .draft-pc-card-body {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1.5rem;
    border-top: 1px solid rgba(30, 41, 59, 0.5);
    padding-top: 0.75rem;
  }

  .draft-pc-card-body .draft-skill-desc {
    flex: 1;
    margin: 0;
  }

  .draft-pc-card-actions {
    flex-shrink: 0;
  }

  .draft-skill-desc {
    font-size: 0.85rem;
    color: #94a3b8;
    line-height: 1.5;
    margin: 0;
  }

  @media (min-width: 769px) {
    .skill-select-card {
      max-height: none !important;
      overflow-y: visible !important;
      padding-bottom: 2rem !important;
    }
  }

  /* スマホ用長方形スキルパネル展開ボタン */
  .skills-drawer-trigger-bar {
    width: 100%;
    max-width: 450px;
    background: #000000;
    border: 2px solid #22d3ee;
    color: #22d3ee;
    padding: 0.75rem 1rem;
    font-weight: 800;
    font-size: 1rem;
    letter-spacing: 0.05em;
    cursor: pointer;
    border-radius: 0.25rem;
    box-shadow: 0 0 15px rgba(34, 211, 238, 0.3);
    text-align: center;
    box-sizing: border-box;
    transition: all 0.25s ease;
    text-transform: uppercase;
    margin: 0.5rem auto 0 auto;
    z-index: 900;
  }

  .skills-drawer-trigger-bar:hover {
    background: #22d3ee;
    color: #000000;
    box-shadow: 0 0 25px #22d3ee;
  }

  /* ドロワー本体 (下から引き上がるボトムシート形式) */
  .skills-drawer {
    position: fixed;
    left: 0;
    bottom: -100%;
    width: 100% !important;
    max-width: none !important;
    height: 60dvh;
    background: rgba(17, 24, 39, 0.98);
    border-top: 2px solid #22d3ee;
    box-shadow: 0 -10px 30px rgba(0, 0, 0, 0.8);
    z-index: 1001;
    transition: bottom 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    border-top-left-radius: 0.75rem;
    border-top-right-radius: 0.75rem;
    overflow: hidden;
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }

  .skills-drawer.open {
    bottom: 0;
  }

  .drawer-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.65);
    backdrop-filter: blur(2px);
    z-index: 1000;
  }

  .drawer-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1.25rem;
    border-bottom: 1px solid #1e293b;
    background: #000000;
  }

  .drawer-title {
    font-size: 1.1rem;
    font-weight: 800;
    color: #22d3ee;
    margin: 0;
    letter-spacing: 0.05em;
  }

  .close-drawer-btn {
    background: transparent;
    border: 1px solid #f43f5e;
    color: #f43f5e;
    padding: 0.35rem 0.75rem;
    font-size: 0.8rem;
    font-weight: bold;
    cursor: pointer;
    border-radius: 2px;
    transition: all 0.2s ease;
  }

  .close-drawer-btn:hover {
    background: #f43f5e;
    color: #ffffff;
  }

  .drawer-content {
    flex: 1;
    overflow-y: auto;
    padding: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    box-sizing: border-box;
  }

  .skills-list-drawer {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .skill-btn-drawer {
    text-align: left;
    background: #000000;
    border: 1px solid #1e293b;
    padding: 1rem;
    border-radius: 0.25rem;
    cursor: pointer;
    transition: all 0.2s ease;
    color: #f8fafc;
    width: 100%;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .skill-btn-drawer:hover:not(:disabled) {
    border-color: #22d3ee;
  }

  .skill-btn-drawer.selected {
    background: rgba(34, 211, 238, 0.15);
    border-color: #22d3ee;
    box-shadow: 0 0 15px rgba(34, 211, 238, 0.3);
  }

  .skill-btn-drawer.locked {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .skill-meta-drawer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
  }

  .skill-name-drawer {
    font-weight: 800;
    font-size: 0.95rem;
    color: #22d3ee;
  }

  .skill-cost-drawer {
    font-size: 0.75rem;
    background: rgba(34, 211, 238, 0.2);
    border: 1px solid rgba(34, 211, 238, 0.3);
    padding: 0.15rem 0.4rem;
    border-radius: 0.25rem;
    color: #22d3ee;
    font-weight: bold;
  }

  .skill-desc-drawer {
    font-size: 0.8rem;
    color: #94a3b8;
    margin: 0;
    line-height: 1.4;
  }

  .skill-status-tag-drawer {
    font-size: 0.75rem;
    color: #22d3ee;
    font-weight: bold;
    align-self: flex-start;
    margin-top: 0.25rem;
  }

  .cancel-skill-tip-drawer {
    font-size: 0.75rem;
    color: #22d3ee;
    text-align: center;
    background: rgba(34, 211, 238, 0.05);
    padding: 0.5rem;
    border-radius: 0.25rem;
    border: 1px solid rgba(34, 211, 238, 0.2);
  }

  /* スマホ版スリム情報バー */
  .mobile-info-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.5rem 0.75rem;
    background: rgba(17, 24, 39, 0.85);
    border: 1px solid #1e293b;
    border-radius: 0.25rem;
    box-sizing: border-box;
    width: 100%;
  }

  .mobile-info-bar .turn-indicator {
    padding: 0 !important;
    border: none !important;
    background: transparent !important;
    box-shadow: none !important;
    flex-direction: column;
    align-items: flex-start;
  }

  /* スマホ用コスト表示の統一クラス (改行防止) */
  .mobile-costs-container {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  .mobile-cost-box {
    padding: 0.25rem 0.6rem;
    background: #000000;
    border: 1px solid #1e293b;
    border-radius: 0.25rem;
    opacity: 0.5;
    display: flex;
    align-items: center;
    justify-content: center;
    white-space: nowrap;
  }

  .mobile-cost-box.active {
    opacity: 1;
    border-color: #22d3ee;
    box-shadow: 0 0 10px rgba(34, 211, 238, 0.3);
  }

  .mobile-cost-box .cost-number {
    font-size: 0.9rem;
    font-weight: 800;
    color: #f8fafc;
  }

  .mobile-cost-box.active .cost-number {
    color: #22d3ee;
  }

  .reset-btn-mobile {
    background: transparent;
    border: 1px solid rgba(244, 63, 94, 0.5);
    color: #f43f5e;
    padding: 0.35rem 0.75rem;
    font-size: 0.75rem;
    font-weight: bold;
    cursor: pointer;
    border-radius: 2px;
    transition: all 0.2s ease;
  }
  .reset-btn-mobile:hover {
    background: rgba(244, 63, 94, 0.1);
    border-color: #f43f5e;
  }

  .room-input-group {
    display: flex;
    gap: 0.5rem;
  }

  @media (max-width: 480px) {
    .room-input-group {
      flex-direction: column;
    }
    .room-input-group input {
      padding: 1rem !important;
      font-size: 1rem !important;
    }
    .room-input-group button {
      padding: 1rem !important;
      width: 100% !important;
    }
  }
  </style>
