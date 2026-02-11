const localVideo = document.getElementById('localVideo');
const videoGrid = document.getElementById('videoGrid');
const callActionButton = document.getElementById('callAction');

let localStream;
let inCall = false;
let currentRoomId = null;
const peers = {}; // peerId -> RTCPeerConnection
const candidateQueues = {}; // peerId -> [candidates]
const peerNames = {}; // peerId -> username
const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const ws = new WebSocket(`${protocol}//${window.location.host}`);

const roomInput = document.getElementById('roomInput');
const nameInput = document.getElementById('nameInput');
const joinRoomButton = document.getElementById('joinRoom');
const roomDisplay = document.getElementById('roomDisplay');

const configuration = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

joinRoomButton.onclick = () => {
    const roomId = roomInput.value.trim();
    const username = nameInput.value.trim();
    if (roomId) joinRoom(roomId, username);
};

function joinRoom(roomId, username) {
    currentRoomId = roomId;
    roomDisplay.textContent = `Room: ${roomId}`;
    ws.send(JSON.stringify({ 
        type: 'join', 
        roomId: roomId, 
        username: username || 'Anonymous' 
    }));
    window.location.hash = roomId;
}

window.addEventListener('load', () => {
    const hashRoom = window.location.hash.substring(1);
    if (hashRoom) {
        roomInput.value = hashRoom;
        setTimeout(() => joinRoom(hashRoom), 500);
    }
});

ws.onmessage = async (event) => {
    const data = JSON.parse(event.data);
    const peerId = data.fromId || data.peerId;
    console.log(`Received ${data.type} from ${peerId}`, data);

    switch(data.type) {
        case 'room-users':
            console.log(`Existing users in room:`, data.peers);
            data.peers.forEach(peer => {
                peerNames[peer.id] = peer.username;
                // We DON'T call existing users here. 
                // We wait for them to call us or for us to send a 'user-joined' signal.
            });
            break;
        case 'user-joined':
            console.log(`User ${data.username} (${data.peerId}) joined. My inCall status: ${inCall}`);
            peerNames[data.peerId] = data.username;
            if (inCall) {
                console.log(`I am in call, initiating call to the new user: ${data.peerId}`);
                initiateCall(data.peerId);
            }
            break;
        case 'offer':
            console.log(`Handling offer from ${peerId}`);
            handleOffer(peerId, data.offer);
            break;
        case 'answer':
            console.log(`Handling answer from ${peerId}`);
            handleAnswer(peerId, data.answer);
            break;
        case 'candidate':
            console.log(`Handling candidate from ${peerId}`);
            handleCandidate(peerId, data.candidate);
            break;
        case 'user-left':
            console.log(`User ${peerId} left the room`);
            removePeer(peerId);
            break;
    }
};

async function playVideoFromCamera() {
    try {
        const constraints = { video: { width: 1280, height: 720 }, audio: true };
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        localVideo.srcObject = localStream;
        return true;
    } catch (e) {
        console.error('Camera access failed', e);
        return false;
    }
}

callActionButton.onclick = async () => {
    if (!inCall) {
        if (await playVideoFromCamera()) {
            inCall = true;
            updateActionButtonUI(true);
            // In Mesh, we wait for others to join OR we can signal current room state
            ws.send(JSON.stringify({ type: 'join', roomId: currentRoomId })); 
        }
    } else {
        hangUp();
    }
};

async function initiateCall(peerId) {
    console.log(`initiateCall() to ${peerId}`);
    const pc = await createPeerConnection(peerId);
    if (!pc) return;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    ws.send(JSON.stringify({ type: 'offer', offer, targetId: peerId }));
}

async function handleOffer(peerId, offer) {
    console.log(`handleOffer() from ${peerId}`);
    const pc = await createPeerConnection(peerId);
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    processCandidateQueue(peerId);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    ws.send(JSON.stringify({ type: 'answer', answer, targetId: peerId }));
}

function handleAnswer(peerId, answer) {
    const pc = peers[peerId];
    if (pc) {
        pc.setRemoteDescription(new RTCSessionDescription(answer)).then(() => {
            processCandidateQueue(peerId);
        });
    }
}

function handleCandidate(peerId, candidate) {
    const pc = peers[peerId];
    if (pc && pc.remoteDescription) {
        pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => console.error("Error adding IceCandidate:", e));
    } else {
        if (!candidateQueues[peerId]) candidateQueues[peerId] = [];
        candidateQueues[peerId].push(candidate);
        console.log(`Queued candidate from ${peerId}`);
    }
}

function processCandidateQueue(peerId) {
    const pc = peers[peerId];
    const queue = candidateQueues[peerId];
    if (pc && pc.remoteDescription && queue) {
        console.log(`Processing ${queue.length} queued candidates for ${peerId}`);
        while (queue.length > 0) {
            const cand = queue.shift();
            pc.addIceCandidate(new RTCIceCandidate(cand)).catch(e => console.error("Error adding queued IceCandidate:", e));
        }
    }
}

async function createPeerConnection(peerId) {
    if (peers[peerId]) return peers[peerId];
    
    // Ensure we have a local stream before creating peer connections
    if (!localStream) {
        console.log("No localStream found, requesting camera access...");
        const success = await playVideoFromCamera();
        if (!success) {
            console.error("Could not obtain localStream for peer connection");
            return null;
        }
    }

    console.log(`Creating RTCPeerConnection for ${peerId}`);
    const pc = new RTCPeerConnection(configuration);
    peers[peerId] = pc;

    localStream.getTracks().forEach(track => {
        console.log(`Adding track ${track.kind} to ${peerId}`);
        pc.addTrack(track, localStream);
    });

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            console.log(`Sending ICE candidate to ${peerId}`);
            ws.send(JSON.stringify({ type: 'candidate', candidate: event.candidate, targetId: peerId }));
        }
    };

    pc.ontrack = (event) => {
        console.log(`Received remote track from ${peerId}`, event.streams);
        if (event.streams && event.streams[0]) {
            let container = document.getElementById(`video-${peerId}`);
            if (!container) {
                container = document.createElement('div');
                container.id = `video-${peerId}`;
                container.className = 'video-container';
                
                const video = document.createElement('video');
                video.id = `v-stream-${peerId}`;
                video.autoplay = true;
                video.playsinline = true;
                
                const label = document.createElement('div');
                label.className = 'label';
                label.textContent = peerNames[peerId] || `Peer ${peerId.substr(0,4)}`;
                
                container.appendChild(video);
                container.appendChild(label);
                videoGrid.appendChild(container);
                console.log(`Created video container for ${peerId}`);
            }
            
            const videoEl = document.getElementById(`v-stream-${peerId}`);
            if (videoEl.srcObject !== event.streams[0]) {
                videoEl.srcObject = event.streams[0];
                console.log(`Attached remote stream to video element for ${peerId}`);
            }
        }
    };

    pc.onconnectionstatechange = () => {
        console.log(`Connection state with ${peerId}: ${pc.connectionState}`);
    };

    return pc;
}

function removePeer(peerId) {
    if (peers[peerId]) {
        peers[peerId].close();
        delete peers[peerId];
    }
    delete candidateQueues[peerId];
    const el = document.getElementById(`video-${peerId}`);
    if (el) el.remove();
}

function updateActionButtonUI(active) {
    const icon = callActionButton.querySelector('.material-icons');
    callActionButton.classList.toggle('call-start', !active);
    callActionButton.classList.toggle('call-end', active);
    icon.textContent = active ? "call_end" : "call";
}

const muteMicButton = document.getElementById('muteMic');
const toggleVideoButton = document.getElementById('toggleVideo');

let isMuted = false;
let isVideoOff = false;

muteMicButton.onclick = () => {
    if (localStream) {
        isMuted = !isMuted;
        localStream.getAudioTracks().forEach(track => track.enabled = !isMuted);
        muteMicButton.classList.toggle('off', isMuted);
        muteMicButton.querySelector('.material-icons').textContent = isMuted ? 'mic_off' : 'mic';
    }
};

toggleVideoButton.onclick = () => {
    if (localStream) {
        isVideoOff = !isVideoOff;
        localStream.getVideoTracks().forEach(track => track.enabled = !isVideoOff);
        toggleVideoButton.classList.toggle('off', isVideoOff);
        toggleVideoButton.querySelector('.material-icons').textContent = isVideoOff ? 'videocam_off' : 'videocam';
    }
};

function hangUp() {
    Object.keys(peers).forEach(id => removePeer(id));
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    localVideo.srcObject = null;
    inCall = false;
    updateActionButtonUI(false);
}
