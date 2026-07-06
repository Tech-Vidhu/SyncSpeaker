import os
import time
import json
import socket
import threading
import asyncio
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import websockets

# Flask Application Setup
app = Flask(__name__, static_folder='.')
CORS(app)

UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

# YouTube Config
YOUTUBE_API_KEY = "AIzaSyCtzmRB_nI4ki0L2iTBu2eOWZdUSONYdSM"

# Predefined Room IDs
ROOM_IDS = ["SYNC-101", "SYNC-202", "SYNC-303"]

def make_default_state():
    """Creates a fresh default room state."""
    return {
        "isPlaying": False,
        "mode": "file",      # "file", "mic", or "youtube"
        "audioUrl": None,    # MP3 URL
        "videoId": None,     # YouTube Video ID
        "videoTitle": None,
        "playTime": 0,       # Server epoch ms when audio should start/started
        "audioOffset": 0,    # Offset in the song when play started (seconds)
        "fileName": None,
        "hostSessionId": None
    }

# Rooms Dict: roomId -> { "state": {...}, "clients": { websocket: {name, role} } }
rooms = {}
for rid in ROOM_IDS:
    rooms[rid] = {
        "state": make_default_state(),
        "clients": {}
    }

# Map each websocket to its room
client_rooms = {}  # websocket -> room_id

def get_local_ip():
    """Finds the local IP address of the server on the network."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        # Doesn't need to connect to actual external server, just initializes local IP lookup
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

# Serve static web files
@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/<path:path>')
def static_files(path):
    return send_from_directory('.', path)

@app.route('/uploads/<path:filename>')
def serve_upload(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

# API: Get Server Information
@app.route('/api/info', methods=['GET'])
def get_info():
    local_ip = get_local_ip()
    return jsonify({
        "server_time": int(time.time() * 1000),
        "local_ip": local_ip,
        "http_port": 5000,
        "ws_port": 8765
    })

# API: Get Room Status
@app.route('/api/rooms', methods=['GET'])
def get_rooms():
    result = []
    for rid in ROOM_IDS:
        room = rooms[rid]
        has_host = any(info["role"] == "host" for info in room["clients"].values())
        speaker_count = sum(1 for info in room["clients"].values() if info["role"] == "speaker")
        result.append({
            "roomId": rid,
            "hasHost": has_host,
            "speakerCount": speaker_count,
            "isPlaying": room["state"]["isPlaying"],
            "mode": room["state"]["mode"]
        })
    return jsonify({"rooms": result})

# API: Upload Audio File
@app.route('/api/upload', methods=['POST'])
def upload_file():
    if 'audio' not in request.files:
        return jsonify({"error": "No file part"}), 400
    file = request.files['audio']
    if file.filename == '':
        return jsonify({"error": "No selected file"}), 400
    
    # Save the file
    filename = file.filename
    # Clean filename simply
    safe_filename = "".join(c for c in filename if c.isalnum() or c in ('.', '_', '-')).strip()
    if not safe_filename:
        safe_filename = "upload.mp3"
        
    file_path = os.path.join(app.config['UPLOAD_FOLDER'], safe_filename)
    file.save(file_path)
    
    local_ip = get_local_ip()
    audio_url = f"http://{local_ip}:5000/uploads/{safe_filename}"
    
    # Room-aware: the room_id will be set via WebSocket control message, not here
    # Just return the URL for the host to use
    return jsonify({
        "success": True,
        "audioUrl": audio_url,
        "fileName": filename
    })

# API: YouTube Data API v3 Proxy Search
@app.route('/api/youtube/search', methods=['GET'])
def youtube_search():
    import urllib.request
    import urllib.parse
    
    query = request.args.get('q', '')
    if not query:
        return jsonify({"error": "No query provided"}), 400
        
    try:
        params = {
            "part": "snippet",
            "maxResults": 10,
            "q": query,
            "type": "video",
            "key": YOUTUBE_API_KEY
        }
        url = "https://www.googleapis.com/youtube/v3/search?" + urllib.parse.urlencode(params)
        
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as response:
            res_data = json.loads(response.read().decode('utf-8'))
            
        results = []
        for item in res_data.get('items', []):
            video_id = item.get('id', {}).get('videoId')
            snippet = item.get('snippet', {})
            if video_id:
                # Resolve basic HTML escapes in snippet title simply
                import html
                raw_title = snippet.get('title', '')
                clean_title = html.unescape(raw_title)
                results.append({
                    "videoId": video_id,
                    "title": clean_title,
                    "channelTitle": snippet.get('channelTitle'),
                    "thumbnailUrl": snippet.get('thumbnails', {}).get('medium', {}).get('url')
                })
        return jsonify({"results": results})
    except Exception as e:
        print("[Server Error] YouTube search failed:", e)
        return jsonify({"error": str(e)}), 500

# API: Download and Extract YouTube Audio Programmatically
@app.route('/api/youtube/download', methods=['GET'])
def youtube_download():
    video_id = request.args.get('videoId', '')
    if not video_id:
        return jsonify({"error": "No videoId provided"}), 400
        
    # Check if file already exists in uploads folder
    for ext in ['m4a', 'webm', 'mp3', 'opus', 'ogg']:
        filename = f"{video_id}.{ext}"
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        if os.path.exists(filepath):
            local_ip = get_local_ip()
            audio_url = f"http://{local_ip}:5000/uploads/{filename}"
            return jsonify({
                "success": True,
                "audioUrl": audio_url,
                "videoId": video_id
            })
            
    # Download Best Audio using yt-dlp Python API
    import yt_dlp
    try:
        ydl_opts = {
            'format': 'bestaudio/best',
            # Save format as video_id.extension
            'outtmpl': os.path.join(app.config['UPLOAD_FOLDER'], f"{video_id}.%(ext)s"),
            'nocheckcertificate': True,
            'quiet': True,
            'no_warnings': True
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=True)
            ext = info.get('ext', 'm4a')
            filename = f"{video_id}.{ext}"
            
        local_ip = get_local_ip()
        audio_url = f"http://{local_ip}:5000/uploads/{filename}"
        return jsonify({
            "success": True,
            "audioUrl": audio_url,
            "videoId": video_id
        })
    except Exception as e:
        print("[Server Error] YouTube download failed:", e)
        return jsonify({"error": str(e)}), 500

# WebSocket Server Handler
async def ws_handler(websocket):
    # Initially client is not in any room
    print(f"[WS] Client connected. Awaiting room join.")
    
    try:
        async for message in websocket:
            # Check if message is binary (microphone audio data)
            if isinstance(message, bytes):
                # Relay raw binary audio data to all speaker clients in the same room
                room_id = client_rooms.get(websocket)
                if room_id and room_id in rooms:
                    await broadcast_binary_to_speakers(room_id, message, exclude=websocket)
                continue

            data = json.loads(message)
            msg_type = data.get("type")
            
            if msg_type == "ping":
                # Clock Sync Protocol (NTP style)
                t1 = int(time.time() * 1000)
                client_time = data.get("clientTime", 0)
                await websocket.send(json.dumps({
                    "type": "pong",
                    "clientTime": client_time,
                    "serverRecvTime": t1,
                    "serverSendTime": int(time.time() * 1000)
                }))
                
            elif msg_type == "join":
                # Client identifying itself with a room
                name = data.get("name", "Unknown Device")
                role = data.get("role", "speaker")
                room_id = data.get("roomId", "")
                
                # Validate room
                if room_id not in rooms:
                    await websocket.send(json.dumps({
                        "type": "error",
                        "message": f"Room '{room_id}' does not exist. Valid rooms: {', '.join(ROOM_IDS)}"
                    }))
                    continue
                
                room = rooms[room_id]
                
                # Enforce single host per room
                if role == "host":
                    existing_host = any(
                        info["role"] == "host" 
                        for ws, info in room["clients"].items() 
                        if ws != websocket
                    )
                    if existing_host:
                        await websocket.send(json.dumps({
                            "type": "error",
                            "message": "This room already has a host. Only one host is allowed per room."
                        }))
                        continue
                
                # Remove from any previous room
                old_room_id = client_rooms.get(websocket)
                if old_room_id and old_room_id in rooms:
                    rooms[old_room_id]["clients"].pop(websocket, None)
                    await broadcast_devices(old_room_id)
                
                # Add to the new room
                room["clients"][websocket] = {"name": name, "role": role}
                client_rooms[websocket] = room_id
                
                print(f"[WS] Device '{name}' joined room {room_id} as {role}")
                
                # Send current room state
                await websocket.send(json.dumps({
                    "type": "state",
                    "state": room["state"]
                }))
                
                # Send join success confirmation
                await websocket.send(json.dumps({
                    "type": "joined",
                    "roomId": room_id,
                    "role": role
                }))
                
                await broadcast_devices(room_id)
                
            elif msg_type == "control":
                # Host sending playback control commands
                room_id = client_rooms.get(websocket)
                if not room_id or room_id not in rooms:
                    continue
                    
                room = rooms[room_id]
                action = data.get("action")  # "play", "pause", "seek"
                
                if action == "play":
                    room["state"]["isPlaying"] = True
                    room["state"]["mode"] = data.get("mode", room["state"]["mode"])
                    room["state"]["audioUrl"] = data.get("audioUrl", room["state"]["audioUrl"])
                    room["state"]["videoId"] = data.get("videoId", room["state"]["videoId"])
                    room["state"]["videoTitle"] = data.get("videoTitle", room["state"]["videoTitle"])
                    # Future epoch millisecond when clients should play
                    # Delay by 400ms to allow network buffering and synchronization
                    room["state"]["playTime"] = int(time.time() * 1000) + 400
                    room["state"]["audioOffset"] = data.get("offset", 0)
                    
                elif action == "pause":
                    room["state"]["isPlaying"] = False
                    # Keep current modes/urls but stop play
                    room["state"]["playTime"] = 0
                    
                elif action == "seek":
                    room["state"]["audioOffset"] = data.get("offset", 0)
                    if room["state"]["isPlaying"]:
                        room["state"]["playTime"] = int(time.time() * 1000) + 400
                    else:
                        room["state"]["playTime"] = 0
                
                # Broadcast updated state to everyone in the room
                await broadcast_state(room_id)
                
            elif msg_type == "device_ping":
                # Direct trigger to flash or sound-beep all speakers (sync test)
                room_id = client_rooms.get(websocket)
                if room_id and room_id in rooms:
                    await broadcast_to_speakers(room_id, {
                        "type": "beep",
                        "time": int(time.time() * 1000) + 400
                    })
                
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        # Remove from room and client tracking
        room_id = client_rooms.pop(websocket, None)
        if room_id and room_id in rooms:
            was_host = rooms[room_id]["clients"].get(websocket, {}).get("role") == "host"
            rooms[room_id]["clients"].pop(websocket, None)
            print(f"[WS] Client disconnected from room {room_id}. Room clients: {len(rooms[room_id]['clients'])}")
            
            # If the host left, reset the room state
            if was_host:
                rooms[room_id]["state"] = make_default_state()
                print(f"[WS] Host left room {room_id}. Room state reset.")
                await broadcast_state(room_id)
            
            await broadcast_devices(room_id)
        else:
            print(f"[WS] Unregistered client disconnected.")

async def safe_send(client, message):
    try:
        await client.send(message)
    except Exception:
        pass

async def broadcast_state(room_id):
    """Broadcasts current room state to all clients in a room."""
    if room_id not in rooms:
        return
    room = rooms[room_id]
    if not room["clients"]:
        return
    message = json.dumps({
        "type": "state",
        "state": room["state"]
    })
    await asyncio.gather(*[safe_send(client, message) for client in list(room["clients"].keys())], return_exceptions=True)

async def broadcast_devices(room_id):
    """Sends list of connected devices to all clients in a room."""
    if room_id not in rooms:
        return
    room = rooms[room_id]
    if not room["clients"]:
        return
    devices = []
    for client, info in list(room["clients"].items()):
        devices.append({
            "name": info["name"],
            "role": info["role"]
        })
    
    message = json.dumps({
        "type": "devices",
        "devices": devices
    })
    
    await asyncio.gather(*[safe_send(client, message) for client in list(room["clients"].keys())], return_exceptions=True)

async def broadcast_to_speakers(room_id, payload):
    """Sends control messages only to speakers in a room."""
    if room_id not in rooms:
        return
    room = rooms[room_id]
    message = json.dumps(payload)
    speakers = [client for client, info in list(room["clients"].items()) if info["role"] == "speaker"]
    if speakers:
        await asyncio.gather(*[safe_send(client, message) for client in speakers], return_exceptions=True)

async def broadcast_binary_to_speakers(room_id, payload, exclude=None):
    """Sends raw binary PCM chunks to speaker clients in a room."""
    if room_id not in rooms:
        return
    room = rooms[room_id]
    speakers = [
        client for client, info in list(room["clients"].items()) 
        if info["role"] == "speaker" and client != exclude
    ]
    if speakers:
        await asyncio.gather(*[safe_send(client, payload) for client in speakers], return_exceptions=True)

# Main WS Server Loop
async def start_ws():
    local_ip = get_local_ip()
    async with websockets.serve(ws_handler, "0.0.0.0", 8765):
        print(f"[WS] Server running on ws://0.0.0.0:8765 (Local IP: ws://{local_ip}:8765)")
        await asyncio.Future()  # run forever

def run_ws_loop():
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    loop.run_until_complete(start_ws())

if __name__ == '__main__':
    # Start WebSockets server in a background thread
    ws_thread = threading.Thread(target=run_ws_loop, daemon=True)
    ws_thread.start()
    
    # Start Flask Web Server
    local_ip = get_local_ip()
    print("\n" + "="*60)
    print(f" NETWORK SPEAKER SYNC SERVER STARTED")
    print(f" Web UI URL: http://localhost:5000")
    print(f" Local Wi-Fi URL: http://{local_ip}:5000")
    print(f" Available Rooms: {', '.join(ROOM_IDS)}")
    print("="*60 + "\n")
    
    app.run(host='0.0.0.0', port=5000, debug=False)
