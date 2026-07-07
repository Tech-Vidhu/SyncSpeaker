# SyncSpeaker — Project Specification & Feature Documentation

> **Repository:** [Tech-Vidhu/SyncSpeaker](https://github.com/Tech-Vidhu/SyncSpeaker)  
> **Live Frontend:** https://sync-speaker.vercel.app/  
> **Tech Stack:** HTML/CSS/JavaScript (Frontend) + Python Flask/WebSockets (Backend)

---

## What is SyncSpeaker?

SyncSpeaker is a real-time, multi-device audio synchronization platform that transforms multiple mobile phones into a unified, synchronized speaker system. One device acts as the **Host** (controller), while other devices join as **Speakers** (receivers). All speakers play audio in perfect time-alignment using NTP-style clock synchronization.

**No app installation required** — runs entirely in the browser as a Progressive Web App (PWA).

---

## Complete Feature List

### 1. Multi-Role System (Host & Speaker)
- **Host Role:** Controls playback, uploads files, searches YouTube, broadcasts microphone audio
- **Speaker Role:** Receives and plays audio in perfect sync with the host
- Users choose their role from the Lobby screen
- Each device gets an auto-generated name (persisted in localStorage)

### 2. Multi-Room Architecture
- 3 independent concurrent rooms: `SYNC-101`, `SYNC-202`, `SYNC-303`
- Each room supports exactly 1 Host and unlimited Speakers
- Room status displayed with live availability (green = available, red = occupied)
- Host leaving automatically resets room state for all connected speakers

### 3. Three Audio Source Modes

#### Mode A: Local File Upload
- Drag-and-drop or file browser upload of audio files (MP3, WAV, OGG, etc.)
- Files uploaded to server via REST API (`POST /api/upload`)
- Audio decoded using Web Audio API `decodeAudioData()`
- Host gets full player UI: disc art animation, progress bar, play/pause, seek
- All speakers download and decode the same audio file independently

#### Mode B: Phone Microphone (Live Broadcast)
- Host captures microphone audio via `navigator.mediaDevices.getUserMedia()`
- Raw audio settings: echo cancellation OFF, noise suppression OFF, auto gain OFF
- Audio captured as Float32 PCM (2048 samples per chunk) via ScriptProcessorNode
- Encoded to Int16 format (50% bandwidth reduction) and sent as binary WebSocket frames
- Server relays binary audio frames to all speakers in the room
- Speakers decode Int16 → Float32, create AudioBuffer, and play with 80ms jitter buffer
- Latency buildup guard: resets scheduling if queue exceeds 150ms

#### Mode C: YouTube Video (Iframe Sync)
- YouTube search powered by YouTube Data API v3 (proxied through backend server)
- Search results show video thumbnails, titles, and channel names
- Host plays YouTube video in an embedded IFrame Player with full controls
- Speakers get a visible mini-player (required by mobile browsers for unmuted audio)
- Synchronization loop runs every 2 seconds comparing player position with server clock
- Auto-seeks if drift exceeds 600ms
- Supports play, pause, and real-time state broadcasting

### 4. NTP-Style Clock Synchronization
- Client sends `ping` with local timestamp to server
- Server responds with receive and send timestamps
- Client calculates Round-Trip Time (RTT) and Clock Offset
- Uses sliding window of last 10 measurements
- Selects offset with lowest RTT for highest accuracy
- 5 rapid pings on initial connect, then every 3 seconds
- Achieves sub-15ms synchronization accuracy across devices

### 5. Precision Audio Scheduling (Web Audio API)
- Uses `AudioBufferSourceNode.start(when, offset)` for sample-accurate scheduling
- Converts server epoch timestamps to AudioContext coordinate system
- Schedules playback 400ms in the future to allow network buffering
- Late joiners calculate elapsed time and start at correct song position
- Clock drift correction: checks every 1.5 seconds during playback
  - Drift > 15ms: adjusts playbackRate to 1.008 (speed up) or 0.992 (slow down)
  - Drift < 5ms: restores playbackRate to 1.0
  - Avoids audible glitches by using gradual rate adjustments instead of hard seeks

### 6. Manual Latency Calibration
- Per-device slider: ±300ms range, 5ms steps
- Compensates for hardware audio output latency differences between phone models
- Value persisted in localStorage across sessions
- Applied in real-time during playback (triggers re-sync immediately)

### 7. Sync Test (Flash/Ping)
- Host can trigger a synchronized beep on all speakers simultaneously
- Uses a 1000Hz sine wave oscillator with fade-out envelope
- Visual flash overlay on speaker visualizer canvas
- Scheduled using the same NTP clock sync system for precise timing

### 8. Real-Time Audio Visualizer
- Canvas-based animation running on `requestAnimationFrame`
- **For Local File / Mic mode:** FFT frequency bars (cyan→violet gradient) with pulsing radial glow
- **For YouTube mode:** Simulated dual sine wave animation (cannot access cross-origin audio data)
- Volume-reactive ambient glow circle in the center

### 9. Connected Devices List
- Real-time list of all connected speakers displayed on host screen
- Shows device name with green dot indicator
- Updates automatically when devices join or leave
- Filtered to show only speaker devices (host is excluded from list)

### 10. QR Code Speaker Invitation System
- Dynamic QR code generated for easy mobile phone connection
- Two modes via tab switcher:
  - **📱 Wi-Fi Link:** Direct local IP URL (`http://10.70.236.88:5000/?room=SYNC-101`) — recommended for mobile phones on same network, prevents Mixed Content security blocks
  - **🌐 Vercel Link:** Cloud URL (`https://sync-speaker.vercel.app/?backend=IP&room=SYNC-101`) — for laptop browsers or cloud setups
- QR code and URL update dynamically when switching modes

### 11. Auto-Join via URL Parameters
- URL format: `http://IP:5000/?room=SYNC-101` or `https://vercel.app/?backend=IP&room=SYNC-101`
- Automatically sets role to speaker, connects WebSocket, and joins specified room
- Skips lobby and room selection screens entirely

### 12. Mixed Content Security Detection & Fix
- Automatically detects when HTTPS page tries to connect to HTTP/WS local IP
- Displays prominent warning banner: "Mobile Browser Security Blocked"
- Shows 1-click fix button that redirects to direct Wi-Fi URL
- Dynamically updates IP address and room ID in the redirect link
- Hidden automatically when connection succeeds

### 13. Mobile Browser Autoplay Policy Bypass
- **Unmute Overlay:** Full-screen "Tap to Join Sync Session" overlay captures user gesture
- **Silent Audio Buffer:** Plays a silent 1-sample buffer to unlock AudioContext on iOS/Android
- **YouTube `playsinline: 1`:** Prevents iOS Safari from forcing fullscreen video playback
- Pending YouTube state stored and applied after user gesture

### 14. Cloud Tunnel & Cross-Network Support
- `getApiUrl()` detects if backend parameter is a domain name vs raw IP address
- Domain names (Cloudflare Tunnel, ngrok, Render) use HTTPS/WSS on standard ports (443/80)
- Raw IPs use HTTP/WS on ports 5000/8765
- Enables devices on different networks (4G, 5G, different Wi-Fi) to connect

### 15. Progressive Web App (PWA)
- Web App Manifest with standalone display mode, portrait orientation
- App icons: 192×192 and 512×512 PNG
- Service Worker with network-first caching strategy
- Cached assets: HTML, CSS, JS, manifest, icons
- API and upload routes excluded from cache
- Can be "installed" on mobile home screen like a native app

### 16. CI/CD Pipeline (GitHub Actions)
- Triggers on push and pull requests to `main`/`master` branches
- Python linting with `flake8` (syntax errors and undefined names)
- JavaScript syntax validation with `node --check`
- Runs on Ubuntu latest with Python 3.11 and Node.js 20

### 17. Cloud Deployment Ready
- `requirements.txt` for Python dependency installation
- `render.yaml` for automatic Render.com deployment
- `Procfile` for Heroku/Railway deployment
- Dynamic PORT and WS_PORT via environment variables
- Server binds to `0.0.0.0` for external access

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    FRONTEND (Browser)                       │
│                                                             │
│  index.html ──► app.js (2039 lines) ──► style.css (938 ln) │
│       │              │                                      │
│       │         ┌────┴────────────────────┐                 │
│       │         │  Web Audio API Engine   │                 │
│       │         │  • AudioContext         │                 │
│       │         │  • BufferSourceNode     │                 │
│       │         │  • AnalyserNode (FFT)   │                 │
│       │         │  • ScriptProcessor      │                 │
│       │         └────┬────────────────────┘                 │
│       │              │                                      │
│  sw.js (PWA)    WebSocket (JSON + Binary PCM)               │
│  manifest.json       │                                      │
└──────────────────────┼──────────────────────────────────────┘
                       │
            ┌──────────┴──────────┐
            │  BACKEND (Python)   │
            │                     │
            │  server.py (469 ln) │
            │  ┌───────────────┐  │
            │  │ Flask HTTP    │  │ ◄── REST API (port 5000)
            │  │ :5000         │  │     • /api/info
            │  │ • Static files│  │     • /api/rooms
            │  │ • File upload │  │     • /api/upload
            │  │ • YT search   │  │     • /api/youtube/search
            │  └───────────────┘  │     • /api/youtube/download
            │  ┌───────────────┐  │
            │  │ WebSocket     │  │ ◄── Real-time sync (port 8765)
            │  │ :8765         │  │     • Clock sync (ping/pong)
            │  │ • Room mgmt  │  │     • State broadcast
            │  │ • State sync  │  │     • Binary PCM relay
            │  │ • PCM relay   │  │     • Device tracking
            │  └───────────────┘  │
            └─────────────────────┘
```

---

## File Structure

| File | Lines | Purpose |
|------|-------|---------|
| `index.html` | 344 | Complete UI — 4 screens (Lobby, Room Selection, Host Control, Speaker) |
| `app.js` | 2039 | All client logic — WebSocket, audio engine, sync, YouTube, visualizer |
| `style.css` | 938 | Dark glassmorphism design system with Outfit font and animations |
| `server.py` | 469 | Python backend — Flask API + WebSocket broadcast engine |
| `sw.js` | 70 | Service Worker — PWA offline caching (network-first) |
| `manifest.json` | 25 | PWA manifest — standalone, portrait, dark theme |
| `requirements.txt` | 4 | Python deps: Flask, Flask-Cors, websockets, yt-dlp |
| `render.yaml` | 10 | Render.com cloud deployment config |
| `Procfile` | 1 | Heroku/Railway start command |
| `ci-cd.yml` | 45 | GitHub Actions CI pipeline |
| `icon-192.png` | — | PWA icon (192×192) |
| `icon-512.png` | — | PWA icon (512×512) |
| `test_silent.wav` | 88KB | Silent audio for iOS/Android AudioContext unlock |

---

## All Functions in app.js (Client-Side)

### Core Application
| Function | Line | Description |
|----------|------|-------------|
| `getApiUrl(path)` | 37 | Resolves backend HTTP endpoint URL based on backend param (IP vs domain) |
| `connectWebSocket()` | 322 | Establishes WebSocket connection with auto-reconnect (3s retry) |
| `updateConnectionStatus(status)` | 404 | Updates header badge (Online/Offline/Syncing) and Mixed Content detection |
| `showRoomScreen(selectedRole)` | 432 | Navigates to room selection screen for host or speaker |
| `backToLobby()` | 453 | Returns to lobby screen from room selection |
| `fetchRoomStatus()` | 460 | Fetches room availability via GET /api/rooms and renders room cards |
| `renderRoomCards(rooms)` | 474 | Renders the 3 room cards with status indicators |
| `connectSpeakerToRoom()` | 495 | Validates speaker room ID input and joins |
| `joinRoom(roomId)` | 505 | Sets currentRoomId and starts session |
| `startSession()` | 511 | Initializes audio, shows host/speaker screen, fetches server info |
| `leaveSession()` | 532 | Resets all state, stops audio/YouTube, returns to lobby |
| `registerDevice()` | 558 | Sends join message with name, role, and roomId to server |
| `jsonMessage(type, payload)` | 570 | Helper to create JSON WebSocket message string |

### QR Code & Server Info
| Function | Line | Description |
|----------|------|-------------|
| `updateQRDisplay()` | 577 | Generates QR code URL and join link based on Wi-Fi or Vercel mode |
| `fetchServerInfo()` | 607 | Fetches server IP/ports via GET /api/info |

### Clock Synchronization (NTP)
| Function | Line | Description |
|----------|------|-------------|
| `startClockSync()` | 619 | Starts clock sync with 5 rapid pings + 3s interval |
| `stopClockSync()` | 631 | Clears sync interval timer |
| `sendPing()` | 638 | Sends ping with clientTime to server |
| `handlePong(data)` | 646 | Calculates RTT and clock offset from server timestamps |
| `getServerTime()` | 693 | Returns estimated current server time (Date.now() + offset) |

### Audio Engine
| Function | Line | Description |
|----------|------|-------------|
| `initAudio()` | 698 | Creates AudioContext (44100Hz), AnalyserNode, plays silent unlock buffer |
| `handleFileSelect(e)` | 722 | File input change handler — triggers upload |
| `uploadAudioFile(file)` | 728 | Uploads audio file via POST /api/upload |
| `loadAudioBuffer(url)` | 758 | Downloads and decodes audio file to PCM AudioBuffer |
| `syncPlaybackSchedule()` | 814 | Schedules audio playback using server epoch time and AudioContext timing |
| `stopCurrentSource()` | 904 | Stops current AudioBufferSourceNode |
| `stopAudio()` | 918 | Stops playback and clears audio buffer |
| `togglePlayback()` | 925 | Host play/pause toggle — sends control message to server |
| `seekPlayback(e)` | 950 | Host seek — calculates position from click and sends to server |
| `triggerSyncBeep()` | 964 | Sends device_ping message for sync test |

### Server Message Handling
| Function | Line | Description |
|----------|------|-------------|
| `handleServerMessage(data)` | 970 | Routes incoming WebSocket messages by type |
| `handleServerError(message)` | 988 | Displays server errors (room full, invalid room, etc.) |
| `handleStateUpdate(state)` | 1002 | Processes room state changes (play/pause/mode/URL updates) |
| `handleDevicesUpdate(devices)` | 1134 | Updates connected devices list on host screen |

### Sync Beep & Progress
| Function | Line | Description |
|----------|------|-------------|
| `playSyncBeep(targetServerTime)` | 1162 | Plays precisely timed 1000Hz beep with visual flash |
| `startProgressTimer()` | 1211 | Host progress bar update timer (100ms interval) |
| `stopProgressTimer()` | 1237 | Clears progress bar timer |

### Audio Visualizer
| Function | Line | Description |
|----------|------|-------------|
| `startVisualizer()` | 1245 | Starts canvas animation loop (FFT bars or YouTube sine waves) |
| `stopVisualizer()` | 1346 | Cancels animation frame loop |

### Utilities
| Function | Line | Description |
|----------|------|-------------|
| `formatTime(secs)` | 1354 | Converts seconds to "M:SS" format |
| `escapeHtml(str)` | 1360 | Sanitizes strings for safe HTML insertion |

### Microphone Broadcast
| Function | Line | Description |
|----------|------|-------------|
| `toggleMicBroadcast()` | 1367 | Toggles microphone broadcast on/off |
| `startMicBroadcast()` | 1375 | Captures mic, encodes to Int16 PCM, streams via WebSocket |
| `stopMicBroadcast()` | 1447 | Stops mic capture, disconnects nodes, broadcasts pause |
| `handleIncomingPCM(arrayBuffer)` | 1476 | Speaker: decodes incoming PCM binary and schedules playback |

### Clock Drift Correction
| Function | Line | Description |
|----------|------|-------------|
| `startDriftCheck()` | 1533 | Starts 1.5s interval checking playback drift vs server clock |
| `stopDriftCheck()` | 1569 | Clears drift check interval |

### Source Tab Switcher
| Function | Line | Description |
|----------|------|-------------|
| `selectSourceTab(tabName)` | 1577 | Switches between File, Mic, YouTube source sections |

### YouTube Integration
| Function | Line | Description |
|----------|------|-------------|
| `performYTSearch()` | 1610 | Searches YouTube via GET /api/youtube/search |
| `renderYTSearchResults(results)` | 1632 | Renders search result cards with thumbnails |
| `playYouTubeVideo(videoId, title)` | 1660 | Sends YouTube play command to server |
| `initYTPlayer(containerId, iframeId, videoId, onReady)` | 1674 | Creates/reuses YouTube IFrame Player |
| `onPlayerStateChange(event)` | 1750 | YouTube player state change handler (play/pause broadcast) |
| `handleYoutubeSync(state)` | 1795 | Routes YouTube state updates (init player or sync) |
| `applyYoutubeSync(isPlaying, targetPlayTime, targetOffset)` | 1854 | Seeks YouTube player to correct position based on server clock |
| `startYTSyncLoop(targetPlayTime, targetOffset)` | 1895 | 2-second interval checking YouTube player drift |
| `stopYTSyncLoop()` | 1919 | Clears YouTube sync interval |

### UI Overlays
| Function | Line | Description |
|----------|------|-------------|
| `showLoadingOverlay(message)` | 1927 | Shows full-screen loading spinner overlay |
| `hideLoadingOverlay()` | 1963 | Hides loading overlay |
| `setupUnmuteOverlay()` | 1968 | Creates "Tap to Join Sync Session" overlay for mobile autoplay bypass |

### Global Callbacks
| Function | Line | Description |
|----------|------|-------------|
| `onYouTubeIframeAPIReady()` | 18 | YouTube API ready callback — processes pending state |

---

## All Functions in server.py (Backend)

| Function | Line | Description |
|----------|------|-------------|
| `make_default_state()` | 25 | Creates fresh default room state object |
| `get_local_ip()` | 50 | Finds local IP address via UDP socket trick |
| `index()` | 63 | Serves index.html |
| `static_files(path)` | 67 | Serves any static file |
| `serve_upload(filename)` | 71 | Serves uploaded audio files |
| `get_info()` | 76 | Returns server time, IP, ports as JSON |
| `get_rooms()` | 88 | Returns status of all 3 rooms |
| `upload_file()` | 104 | Handles audio file upload (sanitizes filename, saves to uploads/) |
| `youtube_search()` | 134 | Proxies YouTube Data API v3 search |
| `youtube_download()` | 178 | Downloads YouTube audio via yt-dlp (with caching) |
| `ws_handler(websocket)` | 226 | Main WebSocket handler — routes all WS messages |
| `safe_send(client, message)` | 376 | Error-safe WebSocket send wrapper |
| `broadcast_state(room_id)` | 382 | Broadcasts room state to all clients |
| `broadcast_devices(room_id)` | 395 | Broadcasts connected devices list to all clients |
| `broadcast_to_speakers(room_id, payload)` | 416 | Sends messages only to speaker clients |
| `broadcast_binary_to_speakers(room_id, payload, exclude)` | 426 | Relays binary PCM audio to speakers (excludes sender) |
| `start_ws()` | 439 | Starts async WebSocket server on port 8765 |
| `run_ws_loop()` | 446 | Creates event loop and runs WebSocket server |

---

## REST API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/` | Serve index.html |
| `GET` | `/<path>` | Serve static files |
| `GET` | `/uploads/<filename>` | Serve uploaded audio files |
| `GET` | `/api/info` | Server metadata (time, IP, ports) |
| `GET` | `/api/rooms` | Room status (availability, speaker count, play state) |
| `POST` | `/api/upload` | Upload audio file (multipart form, field: `audio`) |
| `GET` | `/api/youtube/search?q=<query>` | YouTube search (max 10 results) |
| `GET` | `/api/youtube/download?videoId=<id>` | Download YouTube audio (cached) |

---

## WebSocket Message Protocol

### Client → Server
| Type | Payload | Purpose |
|------|---------|---------|
| `ping` | `{ clientTime }` | Clock sync request |
| `join` | `{ name, role, roomId }` | Register in room |
| `control` | `{ action: "play", audioUrl, mode, videoId, videoTitle, offset }` | Start playback |
| `control` | `{ action: "pause" }` | Pause playback |
| `control` | `{ action: "seek", offset }` | Seek to position |
| `device_ping` | `{}` | Trigger sync beep test |
| Binary | `Int16 PCM ArrayBuffer` | Live microphone audio chunk |

### Server → Client
| Type | Payload | Purpose |
|------|---------|---------|
| `pong` | `{ clientTime, serverRecvTime, serverSendTime }` | Clock sync response |
| `state` | `{ state: {...} }` | Room state broadcast |
| `devices` | `{ devices: [{name, role}] }` | Connected devices list |
| `joined` | `{ roomId, role }` | Join confirmation |
| `beep` | `{ time }` | Synchronized beep trigger |
| `error` | `{ message }` | Error message |
| Binary | `Int16 PCM ArrayBuffer` | Relayed microphone audio |

---

## Key Technical Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| Sample Rate | 44100 Hz | Fixed AudioContext sample rate |
| Sync Interval | 3000ms | Clock sync ping frequency |
| Mic Buffer Size | 2048 samples | PCM chunk size per frame |
| Play Buffer | 400ms | Future scheduling delay for network sync |
| Drift Threshold | 15ms | Triggers playbackRate adjustment |
| Drift Recovery | 5ms | Restores normal playbackRate |
| YouTube Drift | 600ms | Triggers YouTube seek correction |
| Jitter Buffer | 80ms | Mic stream scheduling buffer |
| Latency Guard | 150ms | Max mic queue lookahead |
| Reconnect Delay | 3000ms | WebSocket auto-reconnect interval |
| Calibration Range | ±300ms | Manual latency slider range |

---

## Dependencies

### Python Backend
| Package | Purpose |
|---------|---------|
| Flask | HTTP web server and API routing |
| Flask-Cors | Cross-origin request handling |
| websockets | Async WebSocket server |
| yt-dlp | YouTube audio download engine |

### Frontend (Browser APIs & CDN)
| API/Library | Purpose |
|-------------|---------|
| Web Audio API | Audio decoding, scheduling, visualization |
| WebSocket API | Real-time server communication |
| YouTube IFrame API | YouTube player embedding |
| MediaDevices API | Microphone capture |
| Service Worker API | PWA offline caching |
| Google Fonts (Outfit) | Typography |
| QR Server API | Dynamic QR code generation |

---

## Design System

- **Theme:** Dark glassmorphism with cyan (#06b6d4) and violet (#8b5cf6) accents
- **Font:** Outfit (Google Fonts)
- **Cards:** Translucent backgrounds with backdrop blur and subtle borders
- **Animations:** Spinning disc art, pulsing dots, tab transitions, ambient glow blobs
- **Layout:** Mobile-first, max-width 600px, portrait orientation
- **Buttons:** Gradient fills with glow box-shadows
