// SyncSpeaker - Mobile Synchronized Audio Client

// Load YouTube IFrame Player API asynchronously
const tag = document.createElement('script');
tag.src = "https://www.youtube.com/iframe_api";
const firstScriptTag = document.getElementsByTagName('script')[0];
firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

let ytPlayer = null;
let isYTAPIReady = false;
let activeVideoId = null;
let ytSyncInterval = null;
let isSyncingPlayer = false;
let hasUserGesture = false;
let pendingYoutubeState = null;


window.onYouTubeIframeAPIReady = function() {
    isYTAPIReady = true;
    console.log('YouTube IFrame API Ready');
    if (pendingYoutubeState && (role !== 'speaker' || hasUserGesture)) {
        const state = pendingYoutubeState;
        pendingYoutubeState = null;
        handleYoutubeSync(state);
    }
};

// Application State
let role = null; // 'host' or 'speaker'
let currentRoomId = null; // Room the user is in
let deviceName = '';
let ws = null;
let wsUrl = '';
let isConnected = false;

// Audio State
let audioCtx = null;
let audioBuffer = null;
let currentSource = null;
let isAudioPlaying = false;
let audioUrl = null;
let audioOffset = 0;       // Track position when playback started (seconds)
let playTime = 0;          // Server epoch ms when playback starts/started
let audioDuration = 0;
let isDecoding = false;
let playCtxTime = 0;       // AudioContext.currentTime when playback started
let playAudioOffset = 0;   // Song position when playback started (seconds)
let driftInterval = null;  // Timer to check and correct clock drift

// Microphone / Live Streaming State
let isMicBroadcasting = false;
let micStream = null;
let micSourceNode = null;
let micProcessorNode = null;
const MIC_BUFFER_SIZE = 2048;
let nextPCMPlayTime = 0;

// Visualizer State
let analyser = null;
let visualizerAnimationId = null;

// Clock Sync (NTP) State
let serverOffset = 0;      // Server time - Client time (ms)
let serverOffsetsHistory = []; // Slide window of offsets
let rttHistory = [];
const SYNC_INTERVAL = 3000; // sync clock every 3s
let syncTimer = null;

// Manual Calibration (ms)
let manualCalibrationMs = 0;

// Host Player Progress Update Timer
let progressInterval = null;

// DOM Elements
const lobbyScreen = document.getElementById('lobby-screen');
const roomScreen = document.getElementById('room-screen');
const hostScreen = document.getElementById('host-screen');
const speakerScreen = document.getElementById('speaker-screen');

const btnSelectHost = document.getElementById('btn-select-host');
const btnSelectSpeaker = document.getElementById('btn-select-speaker');
const btnHostBack = document.getElementById('btn-host-back');
const btnSpeakerBack = document.getElementById('btn-speaker-back');
const btnRoomBack = document.getElementById('btn-room-back');
const deviceNameInput = document.getElementById('device-name');

// Room Screen Elements
const roomScreenTitle = document.getElementById('room-screen-title');
const roomScreenSubtitle = document.getElementById('room-screen-subtitle');
const roomHostPicker = document.getElementById('room-host-picker');
const roomSpeakerInput = document.getElementById('room-speaker-input');
const roomCardsContainer = document.getElementById('room-cards-container');
const roomIdInput = document.getElementById('room-id-input');
const btnRoomConnect = document.getElementById('btn-room-connect');
const roomErrorMsg = document.getElementById('room-error-msg');

const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const playerContainer = document.getElementById('player-container');
const hostDisc = document.getElementById('host-disc');
const hostTrackTitle = document.getElementById('host-track-title');
const progressBarWrapper = document.getElementById('progress-bar-wrapper');
const progressFill = document.getElementById('progress-fill');
const timeCurrent = document.getElementById('time-current');
const timeDuration = document.getElementById('time-duration');
const btnPlayPause = document.getElementById('btn-play-pause');
const playIcon = document.getElementById('play-icon');
const pauseIcon = document.getElementById('pause-icon');
const btnSyncPing = document.getElementById('btn-sync-ping');
const btnMicBroadcast = document.getElementById('btn-mic-broadcast');

const serverUrlDisplay = document.getElementById('server-url-display');
const qrCodeImg = document.getElementById('qr-code-img');
const devicesList = document.getElementById('devices-list');

const connectionStatusDot = document.getElementById('connection-status-dot');
const connectionStatusText = document.getElementById('connection-status-text');

const canvasVisualizer = document.getElementById('canvas-visualizer');
const speakerMainStatus = document.getElementById('speaker-main-status');
const speakerSubStatus = document.getElementById('speaker-sub-status');
const speakerPingDisplay = document.getElementById('speaker-ping-display');
const speakerOffsetDisplay = document.getElementById('speaker-offset-display');
const speakerTrackDisplay = document.getElementById('speaker-track-display');

const delaySlider = document.getElementById('delay-slider');
const delayVal = document.getElementById('delay-val');
const btnDelayMinus = document.getElementById('btn-delay-minus');
const btnDelayPlus = document.getElementById('btn-delay-plus');

// YouTube Source Elements
const tabFile = document.getElementById('tab-file');
const tabMic = document.getElementById('tab-mic');
const tabYoutube = document.getElementById('tab-youtube');
const sourceFileSec = document.getElementById('source-file-section');
const sourceMicSec = document.getElementById('source-mic-section');
const sourceYoutubeSec = document.getElementById('source-youtube-section');
const btnYTSearch = document.getElementById('btn-yt-search');
const ytSearchInput = document.getElementById('yt-search-input');
const ytResults = document.getElementById('yt-results');
const hostYTPlayerContainer = document.getElementById('host-youtube-player-container');
const speakerYTPlayerContainer = document.getElementById('speaker-youtube-player-container');

// Initialization
window.addEventListener('DOMContentLoaded', () => {
    // Generate/Load Device Name
    deviceName = localStorage.getItem('device_name') || '';
    if (!deviceName) {
        deviceName = 'Mobile Device ' + Math.floor(Math.random() * 1000);
    }
    deviceNameInput.value = deviceName;

    // Load Manual Calibration
    manualCalibrationMs = parseInt(localStorage.getItem('calibration_ms')) || 0;
    delaySlider.value = manualCalibrationMs;
    updateCalibrationUI();

    // Event Listeners
    btnSelectHost.addEventListener('click', () => showRoomScreen('host'));
    btnSelectSpeaker.addEventListener('click', () => showRoomScreen('speaker'));
    btnHostBack.addEventListener('click', leaveSession);
    btnSpeakerBack.addEventListener('click', leaveSession);

    // Room screen events
    btnRoomBack.addEventListener('click', backToLobby);
    btnRoomConnect.addEventListener('click', connectSpeakerToRoom);
    roomIdInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') connectSpeakerToRoom();
    });

    // Save device name on change
    deviceNameInput.addEventListener('change', () => {
        deviceName = deviceNameInput.value.trim() || 'Mobile Device';
        localStorage.setItem('device_name', deviceName);
    });

    // Host Panel File Upload Events
    dropZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileSelect);
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) {
            uploadAudioFile(e.dataTransfer.files[0]);
        }
    });

    // Play/Pause control for host
    btnPlayPause.addEventListener('click', togglePlayback);

    // Seek control for host
    progressBarWrapper.addEventListener('click', seekPlayback);

    // Sync test button
    btnSyncPing.addEventListener('click', triggerSyncBeep);

    // Play by phone mic button
    btnMicBroadcast.addEventListener('click', toggleMicBroadcast);

    // YouTube Tab switcher events
    tabFile.addEventListener('click', () => selectSourceTab('file'));
    tabMic.addEventListener('click', () => selectSourceTab('mic'));
    tabYoutube.addEventListener('click', () => selectSourceTab('youtube'));

    // YouTube Search actions
    btnYTSearch.addEventListener('click', performYTSearch);
    ytSearchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') performYTSearch();
    });

    // Calibration Slider events
    delaySlider.addEventListener('input', () => {
        manualCalibrationMs = parseInt(delaySlider.value);
        localStorage.setItem('calibration_ms', manualCalibrationMs);
        updateCalibrationUI();
        
        // If speaker is playing, trigger a re-sync to apply calibration immediately
        if (role === 'speaker' && isAudioPlaying) {
            syncPlaybackSchedule();
        }
    });

    btnDelayMinus.addEventListener('click', () => {
        delaySlider.value = parseInt(delaySlider.value) - 5;
        delaySlider.dispatchEvent(new Event('input'));
    });

    btnDelayPlus.addEventListener('click', () => {
        delaySlider.value = parseInt(delaySlider.value) + 5;
        delaySlider.dispatchEvent(new Event('input'));
    });

    // Configure connection status bar
    updateConnectionStatus('connecting');
    connectWebSocket();
});

// Update manual delay calibration UI labels
function updateCalibrationUI() {
    const sign = manualCalibrationMs >= 0 ? '+' : '';
    delayVal.textContent = `${sign}${manualCalibrationMs} ms`;
}

// Websocket connection
function connectWebSocket() {
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
        return;
    }
    // Determine websocket URL from current location
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Websocket server runs on port 8765
    wsUrl = `${protocol}//${window.location.hostname}:8765`;
    
    console.log(`Connecting to WebSocket: ${wsUrl}`);
    
    ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    
    ws.onopen = () => {
        console.log('WebSocket connected');
        isConnected = true;
        updateConnectionStatus('connected');
        
        // Start periodic clock sync (NTP)
        startClockSync();
        
        // Register client if role and room are chosen
        if (role && currentRoomId) {
            registerDevice();
        }
    };
    
    ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
            handleIncomingPCM(event.data);
            return;
        }
        const data = JSON.parse(event.data);
        handleServerMessage(data);
    };
    
    ws.onclose = () => {
        console.log('WebSocket disconnected. Retrying in 3s...');
        isConnected = false;
        updateConnectionStatus('disconnected');
        stopClockSync();
        
        setTimeout(connectWebSocket, 3000);
    };

    ws.onerror = (err) => {
        console.error('WebSocket error:', err);
    };
}

function updateConnectionStatus(status) {
    connectionStatusDot.className = 'status-dot';
    if (status === 'connected') {
        connectionStatusDot.classList.add('connected');
        connectionStatusText.textContent = 'Online';
    } else if (status === 'syncing') {
        connectionStatusDot.classList.add('syncing');
        connectionStatusText.textContent = 'Syncing...';
    } else {
        connectionStatusText.textContent = 'Offline';
    }
}

// Room Selection Flow
function showRoomScreen(selectedRole) {
    role = selectedRole;
    lobbyScreen.classList.remove('active');
    roomScreen.classList.add('active');
    
    roomErrorMsg.style.display = 'none';
    
    if (role === 'host') {
        roomScreenTitle.textContent = 'Select a Room';
        roomScreenSubtitle.textContent = 'Choose a room to host your music session.';
        roomHostPicker.style.display = 'block';
        roomSpeakerInput.style.display = 'none';
        fetchRoomStatus();
    } else {
        roomScreenTitle.textContent = 'Join a Room';
        roomScreenSubtitle.textContent = 'Enter the Room ID shared by the host.';
        roomHostPicker.style.display = 'none';
        roomSpeakerInput.style.display = 'block';
        roomIdInput.value = '';
        roomIdInput.focus();
    }
}

function backToLobby() {
    role = null;
    currentRoomId = null;
    roomScreen.classList.remove('active');
    lobbyScreen.classList.add('active');
}

async function fetchRoomStatus() {
    try {
        const response = await fetch('/api/rooms');
        const data = await response.json();
        renderRoomCards(data.rooms);
    } catch (err) {
        console.error('Failed to fetch rooms:', err);
        roomCardsContainer.innerHTML = '<p style="color: #ef4444; text-align: center;">Could not load rooms. Is the server running?</p>';
    }
}

function renderRoomCards(roomList) {
    roomCardsContainer.innerHTML = '';
    const icons = ['🎵', '🎶', '🎧'];
    
    roomList.forEach((room, i) => {
        const isOccupied = room.hasHost;
        const card = document.createElement('div');
        card.className = 'room-card' + (isOccupied ? ' occupied' : '');
        card.innerHTML = `
            <div class="room-card-left">
                <div class="room-card-icon">${icons[i] || '🎵'}</div>
                <div class="room-card-info">
                    <div class="room-card-id">${room.roomId}</div>
                    <div class="room-card-detail">${room.speakerCount} speaker${room.speakerCount !== 1 ? 's' : ''} connected</div>
                </div>
            </div>
            <span class="room-card-status ${isOccupied ? 'occupied' : 'available'}">${isOccupied ? 'Occupied' : 'Available'}</span>
        `;
        
        if (!isOccupied) {
            card.addEventListener('click', () => joinRoom(room.roomId));
        }
        
        roomCardsContainer.appendChild(card);
    });
}

function connectSpeakerToRoom() {
    const roomId = roomIdInput.value.trim().toUpperCase();
    if (!roomId) {
        roomErrorMsg.textContent = 'Please enter a Room ID.';
        roomErrorMsg.style.display = 'block';
        return;
    }
    roomErrorMsg.style.display = 'none';
    joinRoom(roomId);
}

function joinRoom(roomId) {
    currentRoomId = roomId;
    startSession();
}

// Session Management
async function startSession() {
    // Initialize AudioContext on user interaction (required by browsers)
    initAudio();
    
    roomScreen.classList.remove('active');
    
    if (role === 'host') {
        hostScreen.classList.add('active');
        // Show Room ID on host panel
        const roomIdDisplay = document.getElementById('host-room-id-display');
        if (roomIdDisplay) roomIdDisplay.textContent = currentRoomId;
        // Fetch server details for QR code
        fetchServerInfo();
    } else {
        speakerScreen.classList.add('active');
        startVisualizer();
        speakerMainStatus.textContent = 'Connecting...';
        speakerSubStatus.textContent = 'Syncing clock with server';
        setupUnmuteOverlay(); // Setup blocker overlay to capture user gesture
    }
    
    // Register role with server
    registerDevice();
}

function leaveSession() {
    role = null;
    currentRoomId = null;
    stopAudio();
    stopVisualizer();
    
    hasUserGesture = false;
    pendingYoutubeState = null;
    const overlay = document.getElementById('unmute-overlay');
    if (overlay) overlay.style.display = 'none';
    
    // Stop any YouTube player playback
    stopYTSyncLoop();
    if (ytPlayer && typeof ytPlayer.pauseVideo === 'function') {
        try {
            ytPlayer.pauseVideo();
        } catch(e) {}
    }
    activeVideoId = null;
    
    hostScreen.classList.remove('active');
    speakerScreen.classList.remove('active');
    roomScreen.classList.remove('active');
    lobbyScreen.classList.add('active');
}

function registerDevice() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (!currentRoomId) return;
    
    ws.send(jsonMessage('join', {
        name: deviceName,
        role: role || 'speaker',
        roomId: currentRoomId
    }));
}

// Server communication helper
function jsonMessage(type, payload = {}) {
    return JSON.stringify({ type, ...payload });
}

// Fetch general server HTTP data
async function fetchServerInfo() {
    try {
        const response = await fetch('/api/info');
        const data = await response.json();
        
        // Show server URL and QR Code
        const serverUrl = `http://${data.local_ip}:5000`;
        serverUrlDisplay.textContent = serverUrl;
        
        // Use QR Server API to generate QR Code image src
        qrCodeImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(serverUrl)}`;
        
        // Room state is now sent via WebSocket on join, not via HTTP
    } catch (err) {
        console.error('Error fetching server info:', err);
    }
}

// NTP-style clock synchronization
function startClockSync() {
    if (syncTimer) clearInterval(syncTimer);
    
    // Fast initial sync (5 rapid pings)
    for (let i = 0; i < 5; i++) {
        setTimeout(sendPing, i * 200);
    }
    
    // Regular intervals
    syncTimer = setInterval(sendPing, SYNC_INTERVAL);
}

function stopClockSync() {
    if (syncTimer) {
        clearInterval(syncTimer);
        syncTimer = null;
    }
}

function sendPing() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    
    ws.send(jsonMessage('ping', {
        clientTime: Date.now()
    }));
}

function handlePong(data) {
    const t3 = Date.now(); // Client receive time
    const t0 = data.clientTime;
    const t1 = data.serverRecvTime;
    const t2 = data.serverSendTime;
    
    // Round trip time (network latency back and forth)
    const rtt = (t3 - t0) - (t2 - t1);
    
    // Clock offset (Server Time - Client Time)
    // T_server = T_client + offset
    const offset = ((t1 - t0) + (t2 - t3)) / 2;
    
    // Keep a sliding window of the last 10 points
    serverOffsetsHistory.push(offset);
    rttHistory.push(rtt);
    if (serverOffsetsHistory.length > 10) {
        serverOffsetsHistory.shift();
        rttHistory.shift();
    }
    
    // Filter measurements: select the offset that has the lowest RTT (most stable network route)
    let bestIdx = 0;
    let minRtt = rttHistory[0];
    for (let i = 1; i < rttHistory.length; i++) {
        if (rttHistory[i] < minRtt) {
            minRtt = rttHistory[i];
            bestIdx = i;
        }
    }
    
    serverOffset = serverOffsetsHistory[bestIdx];
    
    // Update labels in speaker screen
    if (role === 'speaker') {
        speakerPingDisplay.textContent = `${Math.round(minRtt)} ms`;
        const sign = serverOffset >= 0 ? '+' : '';
        speakerOffsetDisplay.textContent = `${sign}${Math.round(serverOffset)} ms`;
        
        if (speakerMainStatus.textContent === 'Connecting...') {
            speakerMainStatus.textContent = 'Synchronized';
            speakerSubStatus.textContent = 'Waiting for host to play music';
        }
    }
}

// Convert local client epoch time to estimated server epoch time
function getServerTime() {
    return Date.now() + serverOffset;
}

// Audio System Engine
function initAudio() {
    if (audioCtx) return;
    
    // Create audio context with fixed sample rate to avoid device pitch drift
    window.AudioContext = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AudioContext({ sampleRate: 44100 });
    
    // Create Analyser for visualizer
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 128;
}

// Host file upload
function handleFileSelect(e) {
    if (e.target.files.length > 0) {
        uploadAudioFile(e.target.files[0]);
    }
}

async function uploadAudioFile(file) {
    dropZone.querySelector('p').textContent = "Uploading audio file...";
    
    const formData = new FormData();
    formData.append('audio', file);
    
    try {
        const response = await fetch('/api/upload', {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        if (data.success) {
            dropZone.querySelector('p').innerHTML = `File uploaded! Drag another or <span class="browse-link">browse</span>`;
            
            // Set up player
            playerContainer.style.display = 'flex';
            hostTrackTitle.textContent = data.fileName;
            
            // Start decoding locally as well to calculate duration and enable playback control
            loadAudioBuffer(data.audioUrl);
        }
    } catch (err) {
        console.error('File upload failed:', err);
        dropZone.querySelector('p').textContent = "Upload failed. Try again.";
    }
}

// Load audio track and decode it to PCM buffer
async function loadAudioBuffer(url) {
    if (audioUrl === url && audioBuffer) return; // Already loaded
    
    audioUrl = url;
    isDecoding = true;
    
    if (role === 'speaker') {
        speakerMainStatus.textContent = 'Buffering Track...';
        speakerSubStatus.textContent = 'Downloading and decoding audio';
        speakerTrackDisplay.textContent = url.split('/').pop();
    }
    
    try {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        
        // Decode audio data asynchronously
        audioCtx.decodeAudioData(arrayBuffer, (decodedBuffer) => {
            audioBuffer = decodedBuffer;
            audioDuration = audioBuffer.duration;
            isDecoding = false;
            
            console.log(`Audio buffer loaded. Duration: ${audioDuration} seconds`);
            
            if (role === 'host') {
                timeDuration.textContent = formatTime(audioDuration);
                timeCurrent.textContent = formatTime(0);
                progressFill.style.width = '0%';
            } else if (role === 'speaker') {
                speakerMainStatus.textContent = 'Synchronized & Buffered';
                speakerSubStatus.textContent = 'Ready to play';
                
                // If the state was already playing, start playback immediately
                if (isAudioPlaying) {
                    syncPlaybackSchedule();
                }
            }
        }, (err) => {
            console.error('Error decoding audio:', err);
            isDecoding = false;
            if (role === 'speaker') {
                speakerMainStatus.textContent = 'Sync Error';
                speakerSubStatus.textContent = 'Could not decode audio file';
            }
        });
    } catch (err) {
        console.error('Error fetching audio file:', err);
        isDecoding = false;
        if (role === 'speaker') {
            speakerMainStatus.textContent = 'Network Error';
            speakerSubStatus.textContent = 'Could not download audio';
        }
    }
}

// Scheduling playback based on network sync time
function syncPlaybackSchedule() {
    stopCurrentSource();
    
    if (!audioBuffer) {
        console.log("No audio buffer loaded yet, skipping playback start");
        return;
    }
    
    // Ensure AudioContext is running
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    
    // Create new audio buffer source node
    currentSource = audioCtx.createBufferSource();
    currentSource.buffer = audioBuffer;
    
    // Connect visualizer analyser
    currentSource.connect(analyser);
    analyser.connect(audioCtx.destination);
    
    // Math logic to calculate play start relative to server epoch time
    // Server Play Time (ms epoch)
    const targetServerPlayTime = playTime;
    
    // Current server time (ms epoch)
    const currentServerTime = getServerTime();
    
    // Apply manual speaker latency calibration (in milliseconds)
    const calibrationAdjust = (role === 'speaker') ? manualCalibrationMs : 0;
    
    // Calculate start time in AudioContext coordinate system
    // We compute the relationship: Date.now() <-> audioCtx.currentTime
    const audioCtxEpochBase = Date.now() - (audioCtx.currentTime * 1000);
    
    // Target client epoch time (ms) to start playing
    // (If server time is T_play, client time is T_play - serverOffset)
    const targetClientPlayTime = targetServerPlayTime - serverOffset + calibrationAdjust;
    
    // Target AudioContext timestamp (seconds)
    const targetAudioContextTime = (targetClientPlayTime - audioCtxEpochBase) / 1000;
    
    console.log(`Scheduling playback: Target context time = ${targetAudioContextTime}, Current = ${audioCtx.currentTime}`);
    
    if (targetAudioContextTime > audioCtx.currentTime) {
        // Scheduled in the future (this is ideal for synchronization)
        // Wait, start(when, offset) schedules play starting at 'when' from song position 'offset'
        currentSource.start(targetAudioContextTime, audioOffset);
        isAudioPlaying = true;
        
        playCtxTime = targetAudioContextTime;
        playAudioOffset = audioOffset;
        startDriftCheck();
        
        if (role === 'speaker') {
            speakerMainStatus.textContent = 'Synchronized Playback';
            speakerSubStatus.textContent = 'Audio playing in perfect sync';
        }
    } else {
        // Scheduled in the past (late joiner or network lag)
        // Calculate how many seconds have elapsed since it should have started
        const elapsedSeconds = audioCtx.currentTime - targetAudioContextTime;
        const newOffset = audioOffset + elapsedSeconds;
        
        console.log(`Playback target missed. Playback elapsed: ${elapsedSeconds}s. New offset: ${newOffset}s`);
        
        if (newOffset < audioDuration) {
            currentSource.start(audioCtx.currentTime, newOffset);
            isAudioPlaying = true;
            
            playCtxTime = audioCtx.currentTime;
            playAudioOffset = newOffset;
            startDriftCheck();
            
            if (role === 'speaker') {
                speakerMainStatus.textContent = 'Synchronized Playback';
                speakerSubStatus.textContent = 'Late joined & aligned';
            }
        } else {
            console.log("Song already finished based on sync timer");
            isAudioPlaying = false;
            
            if (role === 'speaker') {
                speakerMainStatus.textContent = 'Finished';
                speakerSubStatus.textContent = 'Host audio finished';
            }
        }
    }
}

function stopCurrentSource() {
    stopDriftCheck();
    if (currentSource) {
        try {
            currentSource.stop();
        } catch (e) {
            // Already stopped or not started
        }
        currentSource.disconnect();
        currentSource = null;
    }
    isAudioPlaying = false;
}

function stopAudio() {
    stopCurrentSource();
    audioBuffer = null;
    audioUrl = null;
}

// Host controls
function togglePlayback() {
    if (!audioUrl) return;
    
    const action = isAudioPlaying ? 'pause' : 'play';
    
    if (action === 'play') {
        // Calculate offset (if paused, continue from current duration)
        // We broadcast command to all devices
        ws.send(jsonMessage('control', {
            action: 'play',
            audioUrl: audioUrl,
            offset: audioOffset
        }));
    } else {
        // Calculate current offset to save for resume
        if (progressInterval) {
            clearInterval(progressInterval);
        }
        
        ws.send(jsonMessage('control', {
            action: 'pause'
        }));
    }
}

function seekPlayback(e) {
    if (!audioUrl || !audioDuration) return;
    
    const clickX = e.offsetX;
    const width = progressBarWrapper.clientWidth;
    const pct = clickX / width;
    const seekTime = pct * audioDuration;
    
    ws.send(jsonMessage('control', {
        action: 'seek',
        offset: seekTime
    }));
}

function triggerSyncBeep() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(jsonMessage('device_ping'));
}

// UI State Handling from Server Messages
function handleServerMessage(data) {
    const type = data.type;
    
    if (type === 'pong') {
        handlePong(data);
    } else if (type === 'state') {
        handleStateUpdate(data.state);
    } else if (type === 'devices') {
        handleDevicesUpdate(data.devices);
    } else if (type === 'beep') {
        playSyncBeep(data.time);
    } else if (type === 'error') {
        handleServerError(data.message);
    } else if (type === 'joined') {
        console.log(`[Room] Successfully joined room ${data.roomId} as ${data.role}`);
    }
}

function handleServerError(message) {
    console.error('[Server Error]', message);
    
    // If we're on the room screen or just joined, show error
    if (roomScreen.classList.contains('active')) {
        roomErrorMsg.textContent = message;
        roomErrorMsg.style.display = 'block';
    } else {
        // If already in host/speaker screen, show alert and go back
        alert(message);
        leaveSession();
    }
}

function handleStateUpdate(state) {
    const serverPlaying = state.isPlaying;
    const incomingAudioUrl = state.audioUrl;
    playTime = state.playTime;
    audioOffset = state.audioOffset;
    
    console.log('[WS State Change]', state);
    
    // Check if mode is YouTube
    if (state.mode === 'youtube') {
        stopCurrentSource();
        audioBuffer = null;
        audioUrl = null;
        isAudioPlaying = serverPlaying;
        
        // Host UI changes
        if (role === 'host') {
            if (hostYTPlayerContainer) hostYTPlayerContainer.style.display = 'flex';
            if (playerContainer) playerContainer.style.display = 'none'; // hide local progress bar
        } else if (role === 'speaker') {
            // Show visualizer card for speaker
            const visualizerCard = canvasVisualizer.closest('.glass-card');
            if (visualizerCard) visualizerCard.style.display = 'block';
            
            speakerTrackDisplay.textContent = state.videoTitle || 'YouTube Stream';
            const ytLabel = document.getElementById('speaker-yt-label');
            if (ytLabel) ytLabel.textContent = state.videoTitle || 'Audio Source';
        }
        
        handleYoutubeSync(state);
        return;
    } else {
        // Mode is not youtube, hide YouTube players and stop sync loops
        if (hostYTPlayerContainer) hostYTPlayerContainer.style.display = 'none';
        if (speakerYTPlayerContainer) speakerYTPlayerContainer.style.display = 'none';
        
        // Restore speaker visualizer card
        const visualizerCard = canvasVisualizer.closest('.glass-card');
        if (visualizerCard) visualizerCard.style.display = 'block';
        
        stopYTSyncLoop();
        if (ytPlayer && typeof ytPlayer.pauseVideo === 'function') {
            try {
                ytPlayer.pauseVideo();
            } catch(e) {}
        }
        activeVideoId = null;
    }
    
    // Check if the stream is a live microphone broadcast
    if (incomingAudioUrl === 'MIC_STREAM') {
        audioUrl = 'MIC_STREAM';
        audioBuffer = null;
        isAudioPlaying = serverPlaying;
        
        if (role === 'speaker') {
            if (serverPlaying) {
                speakerMainStatus.textContent = 'Live Broadcast';
                speakerSubStatus.textContent = 'Streaming audio from host phone';
                speakerTrackDisplay.textContent = 'Host Microphone';
                nextPCMPlayTime = 0; // Reset scheduling queue
            } else {
                speakerMainStatus.textContent = 'Broadcast Stopped';
                speakerSubStatus.textContent = 'Host stopped microphone';
            }
        }
        
        // Host player UI setup
        if (role === 'host') {
            if (serverPlaying) {
                btnMicBroadcast.classList.add('btn-mic-active');
                btnMicBroadcast.querySelector('span').textContent = 'Broadcasting Mic (Tap to Stop)';
            } else {
                btnMicBroadcast.classList.remove('btn-mic-active');
                btnMicBroadcast.querySelector('span').textContent = 'Play by Phone Mic (Live Broadcast)';
            }
        }
        return;
    }
    
    // Determine action
    if (incomingAudioUrl) {
        // Load audio if it's new
        if (audioUrl !== incomingAudioUrl) {
            stopCurrentSource(); // Stop old track immediately
            audioBuffer = null;  // Clear old buffer to prevent accidental playback
            loadAudioBuffer(incomingAudioUrl);
        }
        
        if (serverPlaying) {
            isAudioPlaying = true;
            
            // If the buffer is loaded, schedule play immediately
            if (audioBuffer && !isDecoding) {
                syncPlaybackSchedule();
            }
            
            // Host player UI setup
            if (role === 'host') {
                playIcon.style.display = 'none';
                pauseIcon.style.display = 'block';
                hostDisc.classList.add('playing');
                startProgressTimer();
            }
        } else {
            // Paused
            stopCurrentSource();
            
            if (role === 'host') {
                playIcon.style.display = 'block';
                pauseIcon.style.display = 'none';
                hostDisc.classList.remove('playing');
                stopProgressTimer();
            } else if (role === 'speaker') {
                speakerMainStatus.textContent = 'Paused';
                speakerSubStatus.textContent = 'Audio paused by host';
            }
        }
    } else {
        // No audio uploaded
        stopAudio();
        if (role === 'host') {
            playerContainer.style.display = 'none';
            stopProgressTimer();
        } else if (role === 'speaker') {
            speakerMainStatus.textContent = 'Waiting for Host';
            speakerSubStatus.textContent = 'No track selected';
            speakerTrackDisplay.textContent = 'None';
        }
    }
}

function handleDevicesUpdate(devices) {
    if (role !== 'host') return;
    
    devicesList.innerHTML = '';
    
    // Filter out host device itself to display client speakers
    const speakerDevices = devices.filter(d => d.role === 'speaker');
    
    if (speakerDevices.length === 0) {
        devicesList.innerHTML = '<div style="color: var(--text-secondary); font-size: 0.9rem; text-align: center; padding: 1rem;">No other speakers connected yet.</div>';
        return;
    }
    
    speakerDevices.forEach(dev => {
        const item = document.createElement('div');
        item.className = 'device-item';
        item.innerHTML = `
            <div class="device-info">
                <span class="device-dot"></span>
                <span>${escapeHtml(dev.name)}</span>
            </div>
            <span class="device-role">Speaker</span>
        `;
        devicesList.appendChild(item);
    });
}

// Local Sync Calibration beep player
function playSyncBeep(targetServerTime) {
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    
    // Create oscilator node for a short high-pitch beep
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1000, audioCtx.currentTime); // 1000 Hz beep
    
    gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.5, audioCtx.currentTime + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15); // fade out fast
    
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    // Schedule timing
    const audioCtxEpochBase = Date.now() - (audioCtx.currentTime * 1000);
    const calibrationAdjust = (role === 'speaker') ? manualCalibrationMs : 0;
    const targetClientTime = targetServerTime - serverOffset + calibrationAdjust;
    const targetAudioContextTime = (targetClientTime - audioCtxEpochBase) / 1000;
    
    if (targetAudioContextTime > audioCtx.currentTime) {
        osc.start(targetAudioContextTime);
        osc.stop(targetAudioContextTime + 0.2);
        
        // Visual flash overlay
        setTimeout(() => {
            const container = document.querySelector('.visualizer-container');
            if (container) {
                container.style.boxShadow = '0 0 25px rgba(6, 182, 212, 0.8)';
                container.style.borderColor = 'var(--glow-cyan)';
                setTimeout(() => {
                    container.style.boxShadow = 'none';
                    container.style.borderColor = 'var(--card-border)';
                }, 150);
            }
        }, targetClientTime - Date.now());
    } else {
        // Late beep, play immediately
        osc.start();
        osc.stop(audioCtx.currentTime + 0.2);
    }
}

// Host progress bar timer
function startProgressTimer() {
    if (progressInterval) clearInterval(progressInterval);
    
    const updateProgress = () => {
        if (!isAudioPlaying || !audioDuration) return;
        
        // Calculate current position based on server play startTime and offset
        const elapsedMs = getServerTime() - playTime;
        const currentPos = audioOffset + (elapsedMs / 1000);
        
        if (currentPos >= audioDuration) {
            // Audio finished
            clearInterval(progressInterval);
            progressFill.style.width = '100%';
            timeCurrent.textContent = formatTime(audioDuration);
            togglePlayback(); // pause it
        } else {
            progressFill.style.width = `${(currentPos / audioDuration) * 100}%`;
            timeCurrent.textContent = formatTime(Math.max(0, currentPos));
        }
    };
    
    updateProgress();
    progressInterval = setInterval(updateProgress, 100);
}

function stopProgressTimer() {
    if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
    }
}

// Canvas visualizer animation
function startVisualizer() {
    const ctx = canvasVisualizer.getContext('2d');
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    const draw = () => {
        visualizerAnimationId = requestAnimationFrame(draw);
        
        const width = canvasVisualizer.width = canvasVisualizer.clientWidth;
        const height = canvasVisualizer.height = canvasVisualizer.clientHeight;
        
        analyser.getByteFrequencyData(dataArray);
        
        ctx.clearRect(0, 0, width, height);
        
        // If playing YouTube, draw a simulated visualizer wave pattern (bypasses cross-origin audio block)
        if (activeVideoId && isAudioPlaying) {
            const time = Date.now() * 0.004;
            
            // Pulsing central glow
            const pulse = 0.45 + Math.sin(time * 1.5) * 0.15;
            const radius = Math.min(width, height) * 0.22 + (pulse * 15);
            const grad = ctx.createRadialGradient(width/2, height/2, 5, width/2, height/2, radius * 1.6);
            grad.addColorStop(0, 'rgba(6, 182, 212, 0.35)');
            grad.addColorStop(0.5, 'rgba(139, 92, 246, 0.15)');
            grad.addColorStop(1, 'rgba(10, 10, 15, 0)');
            
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(width/2, height/2, radius * 1.6, 0, Math.PI * 2);
            ctx.fill();
            
            // Draw dual crossing sine waves
            ctx.lineWidth = 2.5;
            ctx.strokeStyle = 'rgba(6, 182, 212, 0.8)';
            ctx.beginPath();
            for (let x = 0; x < width; x++) {
                const y = height/2 + Math.sin(x * 0.025 + time) * 20 * Math.sin(x * Math.PI / width);
                if (x === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
            
            ctx.strokeStyle = 'rgba(139, 92, 246, 0.6)';
            ctx.beginPath();
            for (let x = 0; x < width; x++) {
                const y = height/2 + Math.cos(x * 0.018 - time * 0.7) * 15 * Math.sin(x * Math.PI / width);
                if (x === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
            return;
        }
        
        // Calculate average volume for pulse effect
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
            sum += dataArray[i];
        }
        const average = sum / bufferLength;
        const pulse = average / 255; // 0 to 1
        
        if (isAudioPlaying) {
            // Draw a beating ambient glow circle in the center
            const radius = Math.min(width, height) * 0.25 + (pulse * 20);
            const grad = ctx.createRadialGradient(width/2, height/2, 5, width/2, height/2, radius * 1.5);
            grad.addColorStop(0, 'rgba(6, 182, 212, 0.4)');
            grad.addColorStop(0.5, 'rgba(139, 92, 246, 0.15)');
            grad.addColorStop(1, 'rgba(10, 10, 15, 0)');
            
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(width/2, height/2, radius * 1.5, 0, Math.PI * 2);
            ctx.fill();
        }
        
        // Draw standard frequency visualizer bars
        const barWidth = (width / bufferLength) * 1.5;
        let x = 0;
        
        for (let i = 0; i < bufferLength; i++) {
            const barHeight = (dataArray[i] / 255) * height * 0.7;
            
            // Dynamic color gradient (Cyan to Purple)
            const colorRatio = i / bufferLength;
            const r = Math.round(6 + colorRatio * 133);
            const g = Math.round(182 - colorRatio * 90);
            const b = Math.round(212 + colorRatio * 44);
            
            ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
            
            // Draw mirrored double-sided bars
            ctx.fillRect(x, height/2 - barHeight/2, barWidth - 1, barHeight);
            
            x += barWidth;
        }
    };
    
    draw();
}

function stopVisualizer() {
    if (visualizerAnimationId) {
        cancelAnimationFrame(visualizerAnimationId);
        visualizerAnimationId = null;
    }
}

// Utility functions
function formatTime(secs) {
    const minutes = Math.floor(secs / 60);
    const seconds = Math.floor(secs % 60);
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// Microphone Broadcast and Local Audio Capture API
async function toggleMicBroadcast() {
    if (isMicBroadcasting) {
        stopMicBroadcast();
    } else {
        await startMicBroadcast();
    }
}

async function startMicBroadcast() {
    // Pause any playing file
    if (isAudioPlaying) {
        togglePlayback();
    }
    
    initAudio();
    if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
    }
    
    try {
        // Request microphone access
        micStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
            }
        });
        
        isMicBroadcasting = true;
        btnMicBroadcast.classList.add('btn-mic-active');
        btnMicBroadcast.querySelector('span').textContent = 'Broadcasting Phone (Tap to Stop)';
        
        // Notify server that host is streaming mic
        ws.send(jsonMessage('control', {
            action: 'play',
            audioUrl: 'MIC_STREAM',
            offset: 0
        }));
        
        // Set up MediaStreamSource
        micSourceNode = audioCtx.createMediaStreamSource(micStream);
        
        // ScriptProcessor captures raw PCM chunks
        micProcessorNode = audioCtx.createScriptProcessor(MIC_BUFFER_SIZE, 1, 1);
        
        micProcessorNode.onaudioprocess = (e) => {
            if (!isMicBroadcasting) return;
            
            const inputData = e.inputBuffer.getChannelData(0); // Float32Array
            
            // Encode to Int16 to compress packet size
            const pcmData = new Int16Array(inputData.length);
            for (let i = 0; i < inputData.length; i++) {
                const s = Math.max(-1, Math.min(1, inputData[i]));
                pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }
            
            // Send binary frame
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(pcmData.buffer);
            }
        };
        
        // Connect nodes
        micSourceNode.connect(micProcessorNode);
        micProcessorNode.connect(audioCtx.destination);
        
        console.log('Phone microphone broadcast started');
    } catch (err) {
        console.error('Failed to start microphone broadcast:', err);
        alert('Could not start microphone broadcast: ' + err.message);
        stopMicBroadcast();
    }
}

function stopMicBroadcast() {
    isMicBroadcasting = false;
    btnMicBroadcast.classList.remove('btn-mic-active');
    btnMicBroadcast.querySelector('span').textContent = 'Play by Phone Mic (Live Broadcast)';
    
    if (micProcessorNode) {
        micProcessorNode.disconnect();
        micProcessorNode = null;
    }
    if (micSourceNode) {
        micSourceNode.disconnect();
        micSourceNode = null;
    }
    if (micStream) {
        micStream.getTracks().forEach(track => track.stop());
        micStream = null;
    }
    
    // Broadcast pause to server
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(jsonMessage('control', {
            action: 'pause'
        }));
    }
    
    console.log('Phone microphone broadcast stopped');
}

// Speaker: Handle incoming raw binary PCM buffer
function handleIncomingPCM(arrayBuffer) {
    if (role !== 'speaker' || !isAudioPlaying || !audioCtx) return;
    
    // Resume context if suspended
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    
    const int16Array = new Int16Array(arrayBuffer);
    const float32Array = new Float32Array(int16Array.length);
    
    // Convert Int16 back to Float32
    for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / 32768.0;
    }
    
    // Create Float32 temporary AudioBuffer (matches fixed 44100 Hz context)
    const buffer = audioCtx.createBuffer(1, float32Array.length, 44100);
    buffer.copyToChannel(float32Array, 0);
    
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    
    // Connect to analyser & output
    source.connect(analyser);
    analyser.connect(audioCtx.destination);
    
    // Calculate output scheduling time
    const currentTime = audioCtx.currentTime;
    
    // 80ms network jitter buffer to ensure sound continuity
    const networkJitterDelay = 0.080;
    
    let targetTime = nextPCMPlayTime;
    if (targetTime < currentTime + networkJitterDelay) {
        targetTime = currentTime + networkJitterDelay;
    }
    
    // Latency buildup guard: if queue is buffered too much (more than 150ms in future), reset to real-time!
    if (targetTime > currentTime + networkJitterDelay + 0.15) {
        targetTime = currentTime + networkJitterDelay;
    }
    
    // Apply manual delay calibration (ms)
    const calibrationAdjust = manualCalibrationMs / 1000.0;
    const scheduledTime = targetTime + calibrationAdjust;
    
    if (scheduledTime > currentTime) {
        source.start(scheduledTime);
    } else {
        source.start(currentTime);
    }
    
    nextPCMPlayTime = targetTime + buffer.duration;
}

// Clock drift adjustment interval check (Sonos/Chromecast standard)
function startDriftCheck() {
    if (driftInterval) clearInterval(driftInterval);
    
    driftInterval = setInterval(() => {
        if (!isAudioPlaying || !currentSource || !audioCtx || audioUrl === 'MIC_STREAM') return;
        
        // Expected song offset based on server play clock
        const serverPlayElapsed = getServerTime() - playTime;
        const expectedOffset = playAudioOffset + (serverPlayElapsed / 1000.0);
        
        // Actual song offset based on local AudioContext elapsed clock
        const ctxElapsed = audioCtx.currentTime - playCtxTime;
        const actualOffset = playAudioOffset + ctxElapsed;
        
        const drift = expectedOffset - actualOffset; // in seconds
        
        // If drift is significant (more than 15ms), perform micro-adjustments to playbackRate
        if (Math.abs(drift) > 0.015) { 
            console.log(`[Drift Detect] Out of sync by ${Math.round(drift * 1000)} ms. Adjusting playback rate.`);
            if (drift > 0) {
                // Client is lagging, speed up slightly
                currentSource.playbackRate.setValueAtTime(1.008, audioCtx.currentTime);
            } else {
                // Client is leading, slow down slightly
                currentSource.playbackRate.setValueAtTime(0.992, audioCtx.currentTime);
            }
        } else if (Math.abs(drift) < 0.005) {
            // Perfect sync restored, return to normal speed
            if (currentSource.playbackRate.value !== 1.0) {
                currentSource.playbackRate.setValueAtTime(1.0, audioCtx.currentTime);
                console.log(`[Drift Recovered] Perfect sync restored.`);
            }
        }
    }, 1500);
}

function stopDriftCheck() {
    if (driftInterval) {
        clearInterval(driftInterval);
        driftInterval = null;
    }
}

// Source Switcher UI Tabs
function selectSourceTab(tabName) {
    [tabFile, tabMic, tabYoutube].forEach(btn => {
        if (btn) {
            btn.style.background = 'transparent';
            btn.style.color = 'var(--text-secondary)';
        }
    });
    [sourceFileSec, sourceMicSec, sourceYoutubeSec].forEach(sec => {
        if (sec) sec.style.display = 'none';
    });
    
    if (tabName === 'file') {
        if (tabFile) {
            tabFile.style.background = 'rgba(255, 255, 255, 0.08)';
            tabFile.style.color = 'var(--text-primary)';
        }
        if (sourceFileSec) sourceFileSec.style.display = 'block';
    } else if (tabName === 'mic') {
        if (tabMic) {
            tabMic.style.background = 'rgba(255, 255, 255, 0.08)';
            tabMic.style.color = 'var(--text-primary)';
        }
        if (sourceMicSec) sourceMicSec.style.display = 'block';
    } else if (tabName === 'youtube') {
        if (tabYoutube) {
            tabYoutube.style.background = 'rgba(255, 255, 255, 0.08)';
            tabYoutube.style.color = 'var(--text-primary)';
        }
        if (sourceYoutubeSec) sourceYoutubeSec.style.display = 'flex';
    }
}

// YouTube Search API caller
async function performYTSearch() {
    const query = ytSearchInput.value.trim();
    if (!query) return;
    
    ytResults.innerHTML = '<div style="color: var(--text-secondary); font-size: 0.85rem; text-align: center; padding: 1.5rem;">Searching YouTube...</div>';
    
    try {
        const response = await fetch(`/api/youtube/search?q=${encodeURIComponent(query)}`);
        const data = await response.json();
        
        if (data.error) {
            ytResults.innerHTML = `<div style="color: #ef4444; font-size: 0.85rem; text-align: center; padding: 1.5rem;">Error: ${escapeHtml(data.error)}</div>`;
            return;
        }
        
        renderYTSearchResults(data.results);
    } catch (err) {
        console.error('Search failed:', err);
        ytResults.innerHTML = '<div style="color: #ef4444; font-size: 0.85rem; text-align: center; padding: 1.5rem;">Failed to fetch results.</div>';
    }
}

function renderYTSearchResults(results) {
    ytResults.innerHTML = '';
    if (!results || results.length === 0) {
        ytResults.innerHTML = '<div style="color: var(--text-secondary); font-size: 0.85rem; text-align: center; padding: 1.5rem;">No videos found.</div>';
        return;
    }
    
    results.forEach(video => {
        const card = document.createElement('div');
        card.className = 'yt-video-card';
        card.innerHTML = `
            <div class="yt-thumb-box">
                <img src="${video.thumbnailUrl}" alt="thumbnail">
            </div>
            <div class="yt-meta-box">
                <div class="yt-video-title">${escapeHtml(video.title)}</div>
                <div class="yt-video-channel">${escapeHtml(video.channelTitle)}</div>
            </div>
        `;
        
        card.addEventListener('click', () => {
            playYouTubeVideo(video.videoId, video.title);
        });
        
        ytResults.appendChild(card);
    });
}

function playYouTubeVideo(videoId, title) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    
    console.log(`Requesting to play YouTube video: ${videoId}`);
    ws.send(jsonMessage('control', {
        action: 'play',
        mode: 'youtube',
        videoId: videoId,
        videoTitle: title,
        offset: 0
    }));
}

// Initialize YouTube Iframe Player
function initYTPlayer(containerId, iframeId, videoId, onReadyCallback) {
    const container = document.getElementById(containerId);
    if (container) container.style.display = 'flex';
    
    // If player already exists and is ready, just load the new video into existing player
    if (ytPlayer && typeof ytPlayer.loadVideoById === 'function' && document.getElementById(iframeId)) {
        console.log(`Loading new YouTube video ID into existing player: ${videoId}`);
        ytPlayer.loadVideoById(videoId);
        if (onReadyCallback) onReadyCallback({ target: ytPlayer });
        return;
    }
    
    if (ytPlayer) {
        try {
            ytPlayer.destroy();
        } catch(e) {}
        ytPlayer = null;
    }
    
    if (!container) return;
    
    // Target the dedicated wrapper element so we never wipe out sibling title or label divs
    const wrapper = container.querySelector('[id$="-wrapper"]');
    if (wrapper) {
        wrapper.innerHTML = `<div id="${iframeId}" style="width: 100%; height: 100%;"></div>`;
    } else {
        // Fallback: ensure iframe elem exists without wiping sibling elements
        let elem = document.getElementById(iframeId);
        if (!elem) {
            elem = document.createElement('div');
            elem.id = iframeId;
            container.insertBefore(elem, container.firstChild);
        }
    }
    
    const isHostPlayer = (role === 'host');
    
    ytPlayer = new YT.Player(iframeId, {
        height: '100%',
        width: '100%',
        videoId: videoId,
        playerVars: {
            'autoplay': 1,
            'controls': isHostPlayer ? 1 : 0,
            'disablekb': 1,
            'fs': 0,
            'rel': 0,
            'modestbranding': 1,
            'playsinline': 1,
            'origin': window.location.origin
        },
        events: {
            'onReady': (e) => {
                console.log(`YouTube Player Ready (role: ${role})`);
                e.target.unMute();
                if (typeof e.target.setVolume === 'function') e.target.setVolume(100);
                e.target.playVideo();
                if (onReadyCallback) onReadyCallback(e);
                
                if (role === 'speaker') {
                    speakerMainStatus.textContent = 'YouTube Synchronized';
                    speakerSubStatus.textContent = 'Playing audio in sync with host';
                }
            },
            'onStateChange': onPlayerStateChange,
            'onError': (e) => {
                console.error('[YT Error] Code:', e.data);
                if (role === 'speaker') {
                    speakerMainStatus.textContent = 'YouTube Error';
                    speakerSubStatus.textContent = `Player error code: ${e.data}. Try refreshing.`;
                }
            }
        }
    });
}

function onPlayerStateChange(event) {
    console.log(`[YT State] role=${role}, state=${event.data}, isSyncing=${isSyncingPlayer}`);
    
    // Speaker: if player gets stuck in UNSTARTED or CUED, try to force play
    if (role === 'speaker' && !isSyncingPlayer) {
        if (event.data === YT.PlayerState.UNSTARTED || event.data === YT.PlayerState.CUED) {
            console.log('[YT Speaker] Player unstarted/cued, forcing playVideo...');
            setTimeout(() => {
                if (ytPlayer && typeof ytPlayer.playVideo === 'function') {
                    ytPlayer.unMute();
                    ytPlayer.setVolume(100);
                    ytPlayer.playVideo();
                }
            }, 500);
        } else if (event.data === YT.PlayerState.PLAYING) {
            speakerMainStatus.textContent = 'YouTube Synchronized';
            speakerSubStatus.textContent = 'Playing audio in sync with host';
        } else if (event.data === YT.PlayerState.PAUSED) {
            speakerMainStatus.textContent = 'YouTube Paused';
            speakerSubStatus.textContent = 'Paused by host';
        } else if (event.data === YT.PlayerState.BUFFERING) {
            speakerMainStatus.textContent = 'Buffering...';
            speakerSubStatus.textContent = 'Loading YouTube audio stream';
        }
    }
    
    if (role !== 'host' || isSyncingPlayer) return;
    
    const state = event.data;
    if (state === YT.PlayerState.PLAYING) {
        ws.send(jsonMessage('control', {
            action: 'play',
            mode: 'youtube',
            videoId: activeVideoId,
            videoTitle: document.getElementById('host-yt-title').textContent,
            offset: ytPlayer.getCurrentTime()
        }));
    } else if (state === YT.PlayerState.PAUSED) {
        ws.send(jsonMessage('control', {
            action: 'pause'
        }));
    }
}

// WebSocket State Router for YouTube Mode
function handleYoutubeSync(state) {
    const targetVideoId = state.videoId;
    const isPlaying = state.isPlaying;
    const targetPlayTime = state.playTime;
    const targetOffset = state.audioOffset;
    
    if (role === 'speaker' && !hasUserGesture) {
        console.log("Postponing YouTube player initialization until Tap to Join...");
        pendingYoutubeState = state;
        speakerMainStatus.textContent = 'Tap Required';
        speakerSubStatus.textContent = 'Tap Join Sync Session to start audio';
        return;
    }
    
    if (!isYTAPIReady) {
        console.log("Waiting for YouTube API...");
        pendingYoutubeState = state;
        return;
    }
    
    if (activeVideoId !== targetVideoId) {
        activeVideoId = targetVideoId;
        
        if (role === 'host') {
            playerContainer.style.display = 'none';
            document.getElementById('host-yt-title').textContent = state.videoTitle || 'YouTube Video';
            initYTPlayer('host-youtube-player-container', 'host-youtube-iframe', targetVideoId, () => {
                applyYoutubeSync(isPlaying, targetPlayTime, targetOffset);
            });
        } else if (role === 'speaker') {
            // Show the YouTube player as a visible mini-player on the speaker screen.
            // Mobile browsers REQUIRE the iframe to be genuinely visible in the viewport
            // to allow unmuted audio playback. Hidden/off-screen/z-index tricks get throttled.
            if (speakerYTPlayerContainer) {
                speakerYTPlayerContainer.style.position = '';
                speakerYTPlayerContainer.style.top = '';
                speakerYTPlayerContainer.style.left = '';
                speakerYTPlayerContainer.style.width = '';
                speakerYTPlayerContainer.style.height = '';
                speakerYTPlayerContainer.style.zIndex = '';
                speakerYTPlayerContainer.style.opacity = '';
                speakerYTPlayerContainer.style.pointerEvents = '';
                speakerYTPlayerContainer.style.display = 'block';
            }
            const ytLabel = document.getElementById('speaker-yt-label');
            if (ytLabel) ytLabel.textContent = state.videoTitle || 'Audio Source';
            
            speakerMainStatus.textContent = 'Loading YouTube...';
            speakerSubStatus.textContent = 'Initializing audio stream';
            
            initYTPlayer('speaker-youtube-player-container', 'speaker-youtube-iframe', targetVideoId, () => {
                applyYoutubeSync(isPlaying, targetPlayTime, targetOffset);
            });
        }
    } else {
        applyYoutubeSync(isPlaying, targetPlayTime, targetOffset);
    }
}

function applyYoutubeSync(isPlaying, targetPlayTime, targetOffset) {
    if (!ytPlayer || typeof ytPlayer.getPlayerState !== 'function') return;
    
    isSyncingPlayer = true;
    
    if (isPlaying) {
        const currentServerTime = getServerTime();
        const elapsed = (currentServerTime - targetPlayTime) / 1000.0;
        const calibrationAdjust = (role === 'speaker') ? manualCalibrationMs / 1000.0 : 0;
        const expectedOffset = targetOffset + elapsed + calibrationAdjust;
        
        const currentPos = ytPlayer.getCurrentTime();
        const drift = expectedOffset - currentPos;
        
        if (typeof ytPlayer.unMute === 'function') {
            ytPlayer.unMute();
            if (typeof ytPlayer.setVolume === 'function') ytPlayer.setVolume(100);
        }
        if (ytPlayer.getPlayerState() !== YT.PlayerState.PLAYING) {
            ytPlayer.playVideo();
        }
        
        // Correct alignment if drift exceeds 500ms
        if (Math.abs(drift) > 0.5 && expectedOffset > 0) {
            console.log(`[YT Sync] Seeking to: ${expectedOffset.toFixed(2)}s (Drift: ${drift.toFixed(2)}s)`);
            ytPlayer.seekTo(expectedOffset, true);
        }
        
        startYTSyncLoop(targetPlayTime, targetOffset);
    } else {
        if (ytPlayer.getPlayerState() === YT.PlayerState.PLAYING) {
            ytPlayer.pauseVideo();
        }
        stopYTSyncLoop();
    }
    
    setTimeout(() => {
        isSyncingPlayer = false;
    }, 400);
}

function startYTSyncLoop(targetPlayTime, targetOffset) {
    if (ytSyncInterval) clearInterval(ytSyncInterval);
    
    ytSyncInterval = setInterval(() => {
        if (!ytPlayer || typeof ytPlayer.getCurrentTime !== 'function') return;
        if (ytPlayer.getPlayerState() !== YT.PlayerState.PLAYING) return;
        
        const elapsed = (getServerTime() - targetPlayTime) / 1000.0;
        const calibrationAdjust = (role === 'speaker') ? manualCalibrationMs / 1000.0 : 0;
        const expectedOffset = targetOffset + elapsed + calibrationAdjust;
        
        const currentPos = ytPlayer.getCurrentTime();
        const drift = expectedOffset - currentPos;
        
        // Correct drift if it slips past 600ms
        if (Math.abs(drift) > 0.6 && expectedOffset > 0) {
            console.log(`[YT Sync Loop] Realigning YouTube drift: ${drift.toFixed(2)}s`);
            isSyncingPlayer = true;
            ytPlayer.seekTo(expectedOffset, true);
            setTimeout(() => { isSyncingPlayer = false; }, 200);
        }
    }, 2000);
}

function stopYTSyncLoop() {
    if (ytSyncInterval) {
        clearInterval(ytSyncInterval);
        ytSyncInterval = null;
    }
}

// Dynamic Loading Overlay for YouTube downloads
function showLoadingOverlay(message) {
    let overlay = document.getElementById('loading-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'loading-overlay';
        overlay.style = `
            position: fixed;
            top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(10, 10, 15, 0.85);
            backdrop-filter: blur(8px);
            display: flex; flex-direction: column;
            justify-content: center; align-items: center;
            z-index: 9999; color: var(--text-primary);
            font-family: var(--font-sans);
        `;
        overlay.innerHTML = `
            <div class="spinner" style="
                width: 50px; height: 50px;
                border: 4px solid rgba(255,255,255,0.1);
                border-top: 4px solid var(--glow-cyan);
                border-radius: 50%;
                animation: spin 1s linear infinite;
                margin-bottom: 1.5rem;
            "></div>
            <div id="loading-overlay-text" style="font-weight: 500; font-size: 1.1rem; text-shadow: 0 2px 10px rgba(0,0,0,0.5);">${message}</div>
            <style>
                @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
            </style>
        `;
        document.body.appendChild(overlay);
    } else {
        document.getElementById('loading-overlay-text').textContent = message;
        overlay.style.display = 'flex';
    }
}

function hideLoadingOverlay() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.style.display = 'none';
}

function setupUnmuteOverlay() {
    let overlay = document.getElementById('unmute-overlay');
    if (overlay) {
        overlay.style.display = 'flex';
        return;
    }
    
    overlay = document.createElement('div');
    overlay.id = 'unmute-overlay';
    overlay.style = `
        position: fixed;
        top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(10, 10, 15, 0.95);
        backdrop-filter: blur(12px);
        display: flex; flex-direction: column;
        justify-content: center; align-items: center;
        z-index: 99999; color: var(--text-primary);
        font-family: var(--font-sans);
    `;
    overlay.innerHTML = `
        <div style="font-size: 2.5rem; margin-bottom: 1.5rem; animation: pulse 1.5s infinite alternate;">🔊</div>
        <h2 style="margin-bottom: 0.5rem; font-weight: 600;">Speaker Synchronization</h2>
        <p style="color: var(--text-secondary); text-align: center; max-width: 280px; font-size: 0.9rem; margin-bottom: 2rem; line-height: 1.5;">Tap to join the audio broadcast. Browser policies require a user action to play sounds.</p>
        <button id="btn-unmute-join" class="btn-primary" style="padding: 0.8rem 2rem; font-size: 1rem; text-transform: uppercase; letter-spacing: 1px; box-shadow: 0 4px 20px rgba(6, 182, 212, 0.4);">Join Sync Session</button>
        <style>
            @keyframes pulse {
                0% { transform: scale(1); opacity: 0.8; }
                100% { transform: scale(1.15); opacity: 1; }
            }
        </style>
    `;
    document.body.appendChild(overlay);
    
    document.getElementById('btn-unmute-join').addEventListener('click', () => {
        hasUserGesture = true;
        overlay.style.display = 'none';
        
        // Initialize AudioContext if not active
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        
        // If there's a pending YouTube video stream, load it immediately inside the click event!
        if (pendingYoutubeState) {
            console.log("Loading postponed YouTube state using user gesture...");
            const state = pendingYoutubeState;
            pendingYoutubeState = null;
            if (role === 'speaker') {
                speakerTrackDisplay.textContent = state.videoTitle || 'YouTube Stream';
                if (state.isPlaying) {
                    speakerMainStatus.textContent = 'YouTube Synchronized';
                    speakerSubStatus.textContent = 'Playing audio in sync with host';
                } else {
                    speakerMainStatus.textContent = 'YouTube Paused';
                    speakerSubStatus.textContent = 'Paused by host';
                }
            }
            handleYoutubeSync(state);
        }
    });
}

// Service Worker PWA registration
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => console.log('Service Worker registered', reg))
            .catch(err => console.error('Service Worker registration failed', err));
    });
}
