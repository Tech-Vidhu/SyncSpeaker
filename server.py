import os
import time
import json
import random
import string
import socket
import threading
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from flask_sock import Sock

# Flask Application Setup
app = Flask(__name__, static_folder='.')
CORS(app)
sock = Sock(app)

UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

# YouTube Config
YOUTUBE_API_KEY = "AIzaSyCtzmRB_nI4ki0L2iTBu2eOWZdUSONYdSM"

# Rooms Dict: roomId -> { "state": {...}, "clients": { websocket: {name, role} } }
# Rooms are now created dynamically — no hardcoded list.
rooms = {}
rooms_lock = threading.Lock()

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

def generate_room_id():
    """Generates a unique random room ID like ROOM-AB12."""
    chars = string.ascii_uppercase + string.digits
    suffix = ''.join(random.choices(chars, k=4))
    return f"ROOM-{suffix}"

def get_or_create_room(room_id):
    """Returns an existing room or creates a new one."""
    with rooms_lock:
        if room_id not in rooms:
            rooms[room_id] = {
                "state": make_default_state(),
                "clients": {}
            }
        return rooms[room_id]

def cleanup_empty_room(room_id):
    """Removes a room from the dict if it has no clients left."""
    with rooms_lock:
        if room_id in rooms and not rooms[room_id]["clients"]:
            del rooms[room_id]
            print(f"[Room] Room '{room_id}' was empty and has been removed.")

# Map each websocket to its room
client_rooms = {}  # websocket -> room_id

def get_local_ip():
    """Finds the local IP address of the server on the network."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
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

@app.route('/<path:path>', methods=['GET'])
def static_files(path):
    return send_from_directory('.', path)

@app.route('/uploads/<path:filename>', methods=['GET'])
def serve_upload(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

# API: Get Server Information
@app.route('/api/info', methods=['GET'])
def get_info():
    local_ip = get_local_ip()
    http_port = int(os.environ.get('PORT', 5000))
    return jsonify({
        "server_time": int(time.time() * 1000),
        "local_ip": local_ip,
        "http_port": http_port,
        "ws_port": http_port
    })

# API: Get Active Room Status (only rooms that currently have a host)
@app.route('/api/rooms', methods=['GET'])
def get_rooms():
    result = []
    with rooms_lock:
        room_ids = list(rooms.keys())
    for rid in room_ids:
        with rooms_lock:
            if rid not in rooms:
                continue
            room = rooms[rid]
            clients_copy = dict(room["clients"])
            state_copy = dict(room["state"])
        has_host = any(info["role"] == "host" for info in clients_copy.values())
        speaker_count = sum(1 for info in clients_copy.values() if info["role"] == "speaker")
        # Only expose rooms that have an active host
        if has_host:
            result.append({
                "roomId": rid,
                "hasHost": has_host,
                "speakerCount": speaker_count,
                "isPlaying": state_copy["isPlaying"],
                "mode": state_copy["mode"]
            })
    return jsonify({"rooms": result})

# API: Create a New Room (called by Host before joining)
@app.route('/api/rooms/create', methods=['POST'])
def create_room():
    data = request.get_json(silent=True) or {}
    requested_id = (data.get('roomId') or '').strip().upper()

    # Sanitize: keep only alphanumeric and dashes
    sanitized = ''.join(c for c in requested_id if c.isalnum() or c == '-')

    # Use provided ID or auto-generate one
    if sanitized:
        room_id = sanitized
    else:
        # Auto-generate a unique ID
        with rooms_lock:
            while True:
                room_id = generate_room_id()
                if room_id not in rooms:
                    break

    with rooms_lock:
        if room_id in rooms:
            # Check if there's already a host
            has_host = any(info["role"] == "host" for info in rooms[room_id]["clients"].values())
            if has_host:
                return jsonify({
                    "success": False,
                    "error": f"Room '{room_id}' already has a host. Choose a different name."
                }), 409
        else:
            # Create the room
            rooms[room_id] = {
                "state": make_default_state(),
                "clients": {}
            }

    print(f"[Room] Room '{room_id}' created via API.")
    return jsonify({
        "success": True,
        "roomId": room_id
    })

# API: Upload Audio File
@app.route('/api/upload', methods=['POST'])
def upload_file():
    if 'audio' not in request.files:
        return jsonify({"error": "No file part"}), 400
    file = request.files['audio']
    if file.filename == '':
        return jsonify({"error": "No selected file"}), 400
    
    filename = file.filename
    safe_filename = "".join(c for c in filename if c.isalnum() or c in ('.', '_', '-')).strip()
    if not safe_filename:
        safe_filename = "upload.mp3"
        
    file_path = os.path.join(app.config['UPLOAD_FOLDER'], safe_filename)
    file.save(file_path)
    
    local_ip = get_local_ip()
    audio_url = f"http://{local_ip}:5000/uploads/{safe_filename}"
    
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
            
    import yt_dlp
    try:
        ydl_opts = {
            'format': 'bestaudio/best',
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
@sock.route('/ws')
def ws_handler(websocket):
    print(f"[WS] Client connected. Awaiting room join.")
    
    try:
        while True:
            message = websocket.receive()
            if message is None:
                break
                
            # Check if message is binary (microphone audio data)
            if isinstance(message, bytes):
                room_id = client_rooms.get(websocket)
                if room_id and room_id in rooms:
                    broadcast_binary_to_speakers(room_id, message, exclude=websocket)
                continue

            data = json.loads(message)
            msg_type = data.get("type")
            
            if msg_type == "ping":
                t1 = int(time.time() * 1000)
                client_time = data.get("clientTime", 0)
                websocket.send(json.dumps({
                    "type": "pong",
                    "clientTime": client_time,
                    "serverRecvTime": t1,
                    "serverSendTime": int(time.time() * 1000)
                }))
                
            elif msg_type == "join":
                name = data.get("name", "Unknown Device")
                role = data.get("role", "speaker")
                room_id = data.get("roomId", "").strip().upper()
                
                if not room_id:
                    websocket.send(json.dumps({
                        "type": "error",
                        "message": "Room ID cannot be empty."
                    }))
                    continue

                # For hosts: auto-create room if it doesn't exist
                # For speakers: room must exist and have a host
                with rooms_lock:
                    room_exists = room_id in rooms
                
                if role == "host":
                    # Create room if it doesn't exist yet
                    room = get_or_create_room(room_id)
                    
                    # Enforce single host per room
                    with rooms_lock:
                        existing_host = any(
                            info["role"] == "host"
                            for ws, info in rooms[room_id]["clients"].items()
                            if ws != websocket
                        )
                    if existing_host:
                        websocket.send(json.dumps({
                            "type": "error",
                            "message": "This room already has a host. Only one host is allowed per room."
                        }))
                        continue
                else:
                    # Speaker: room must exist
                    if not room_exists:
                        websocket.send(json.dumps({
                            "type": "error",
                            "message": f"Room '{room_id}' does not exist or has no active host. Please check the Room ID."
                        }))
                        continue
                    
                    with rooms_lock:
                        room = rooms[room_id]
                
                # Remove from any previous room
                old_room_id = client_rooms.get(websocket)
                if old_room_id and old_room_id in rooms:
                    with rooms_lock:
                        rooms[old_room_id]["clients"].pop(websocket, None)
                    broadcast_devices(old_room_id)
                    cleanup_empty_room(old_room_id)
                
                # Add to the new room
                with rooms_lock:
                    rooms[room_id]["clients"][websocket] = {"name": name, "role": role}
                client_rooms[websocket] = room_id
                
                print(f"[WS] Device '{name}' joined room {room_id} as {role}")
                
                # Send current room state
                with rooms_lock:
                    current_state = dict(rooms[room_id]["state"])
                websocket.send(json.dumps({
                    "type": "state",
                    "state": current_state
                }))
                
                # Send join success confirmation
                websocket.send(json.dumps({
                    "type": "joined",
                    "roomId": room_id,
                    "role": role
                }))
                
                broadcast_devices(room_id)
                
            elif msg_type == "control":
                room_id = client_rooms.get(websocket)
                if not room_id or room_id not in rooms:
                    continue
                    
                action = data.get("action")
                
                with rooms_lock:
                    room = rooms[room_id]
                    
                    if action == "play":
                        room["state"]["isPlaying"] = True
                        room["state"]["mode"] = data.get("mode", room["state"]["mode"])
                        room["state"]["audioUrl"] = data.get("audioUrl", room["state"]["audioUrl"])
                        room["state"]["videoId"] = data.get("videoId", room["state"]["videoId"])
                        room["state"]["videoTitle"] = data.get("videoTitle", room["state"]["videoTitle"])
                        room["state"]["playTime"] = int(time.time() * 1000) + 400
                        room["state"]["audioOffset"] = data.get("offset", 0)
                        
                    elif action == "pause":
                        room["state"]["isPlaying"] = False
                        room["state"]["playTime"] = 0
                        
                    elif action == "seek":
                        room["state"]["audioOffset"] = data.get("offset", 0)
                        if room["state"]["isPlaying"]:
                            room["state"]["playTime"] = int(time.time() * 1000) + 400
                        else:
                            room["state"]["playTime"] = 0
                
                broadcast_state(room_id)
                
            elif msg_type == "device_ping":
                room_id = client_rooms.get(websocket)
                if room_id and room_id in rooms:
                    broadcast_to_speakers(room_id, {
                        "type": "beep",
                        "time": int(time.time() * 1000) + 400
                    })
    except Exception:
        pass
    finally:
        room_id = client_rooms.pop(websocket, None)
        if room_id and room_id in rooms:
            with rooms_lock:
                was_host = rooms[room_id]["clients"].get(websocket, {}).get("role") == "host"
                rooms[room_id]["clients"].pop(websocket, None)
            print(f"[WS] Client disconnected from room {room_id}. Room clients: {len(rooms[room_id]['clients'])}")
            
            if was_host:
                with rooms_lock:
                    if room_id in rooms:
                        rooms[room_id]["state"] = make_default_state()
                print(f"[WS] Host left room {room_id}. Room state reset.")
                broadcast_state(room_id)
            
            broadcast_devices(room_id)
            cleanup_empty_room(room_id)
        else:
            print(f"[WS] Unregistered client disconnected.")

def safe_send(client, message):
    try:
        client.send(message)
    except Exception:
        pass

def broadcast_state(room_id):
    """Broadcasts current room state to all clients in a room."""
    with rooms_lock:
        if room_id not in rooms:
            return
        clients = list(rooms[room_id]["clients"].keys())
        state = dict(rooms[room_id]["state"])
    message = json.dumps({"type": "state", "state": state})
    for client in clients:
        safe_send(client, message)

def broadcast_devices(room_id):
    """Sends list of connected devices to all clients in a room."""
    with rooms_lock:
        if room_id not in rooms:
            return
        clients = list(rooms[room_id]["clients"].keys())
        devices = [
            {"name": info["name"], "role": info["role"]}
            for info in rooms[room_id]["clients"].values()
        ]
    message = json.dumps({"type": "devices", "devices": devices})
    for client in clients:
        safe_send(client, message)

def broadcast_to_speakers(room_id, payload):
    """Sends control messages only to speakers in a room."""
    with rooms_lock:
        if room_id not in rooms:
            return
        speakers = [
            client for client, info in rooms[room_id]["clients"].items()
            if info["role"] == "speaker"
        ]
    message = json.dumps(payload)
    for client in speakers:
        safe_send(client, message)

def broadcast_binary_to_speakers(room_id, payload, exclude=None):
    """Sends raw binary PCM chunks to speaker clients in a room."""
    with rooms_lock:
        if room_id not in rooms:
            return
        speakers = [
            client for client, info in rooms[room_id]["clients"].items()
            if info["role"] == "speaker" and client != exclude
        ]
    for client in speakers:
        safe_send(client, payload)

if __name__ == '__main__':
    local_ip = get_local_ip()
    http_port = int(os.environ.get('PORT', 5000))
    print("\n" + "="*60)
    print(f" NETWORK SPEAKER SYNC SERVER STARTED")
    print(f" Web UI URL: http://localhost:{http_port}")
    print(f" Local Wi-Fi URL: http://{local_ip}:{http_port}")
    print(f" WebSocket Endpoint: /ws (Shared Port: {http_port})")
    print(f" Rooms: Dynamic (created by hosts on demand)")
    print("="*60 + "\n")
    
    app.run(host='0.0.0.0', port=http_port, debug=False)
