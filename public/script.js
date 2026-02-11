const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const callActionButton = document.getElementById('callAction');
const logsDiv = document.getElementById('logs');

function log(message) {
    // console.log(message);
}

let localStream;
let peerConnection;
let inCall = false;
const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const ws = new WebSocket(`${protocol}//${window.location.host}`);
let currentRoomId = null;

const roomInput = document.getElementById('roomInput');
const joinRoomButton = document.getElementById('joinRoom');
const roomDisplay = document.getElementById('roomDisplay');

joinRoomButton.onclick = () => {
    const roomId = roomInput.value.trim();
    if (roomId) {
        joinRoom(roomId);
    }
};

function joinRoom(roomId) {
    currentRoomId = roomId;
    roomDisplay.textContent = `Room: ${roomId}`;
    ws.send(JSON.stringify({ type: 'join', roomId: roomId }));
    console.log(`Joined room: ${roomId}`);
    window.location.hash = roomId;
}

// Auto-join if room ID is in hash
window.addEventListener('load', () => {
    const hashRoom = window.location.hash.substring(1);
    if (hashRoom) {
        roomInput.value = hashRoom;
        // Wait a bit for WS to connect
        setTimeout(() => joinRoom(hashRoom), 500);
    }
});

const configuration = {
    iceServers: [
        {
            urls: 'stun:stun.l.google.com:19302'
        }
    ]
};

ws.onopen = () => {
    console.log('WebSocket Connected');
};

ws.onclose = () => {
    console.log('WebSocket Closed');
};

ws.onerror = (error) => {
    console.error('WebSocket Error:', error);
};

ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    console.log('Received Signal:', data.type);

    switch(data.type) {
        case 'offer':
            handleOffer(data.offer);
            break;
        case 'answer':
            handleAnswer(data.answer);
            break;
        case 'candidate':
            handleCandidate(data.candidate);
            break;
        default:
            break;
    }
};

const candidateQueue = [];

function swapVideoClasses() {
    const localClasses = localVideo.className;
    const remoteClasses = remoteVideo.className;

    localVideo.className = remoteClasses;
    remoteVideo.className = localClasses;
}

localVideo.onclick = swapVideoClasses;
remoteVideo.onclick = swapVideoClasses;

async function playVideoFromCamera() {
    try {
        const constraints = {
            video: {
                width: { ideal: 1920, max: 1920 },
                height: { ideal: 1080, max: 1080 },
                frameRate: { ideal: 30, max: 60 },
                facingMode: 'user'
            },
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        };
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        
        // Boost quality hints
        localStream.getVideoTracks().forEach(track => {
            if ('contentHint' in track) track.contentHint = 'motion';
        });

        localVideo.srcObject = localStream;
        return true;
    } catch (error) {
        console.error('Error accessing camera (1080p).', error);
        try {
             // Fallback to 720p
             localStream = await navigator.mediaDevices.getUserMedia({ 
                video: { width: 1280, height: 720 }, 
                audio: true 
             });
             localVideo.srcObject = localStream;
             return true;
        } catch (fallbackError) {
            console.error('Error in fallback.', fallbackError);
            return false;
        }
    }
}

// Helper to boost bitrate in SDP
function setVideoBitrate(sdp, bitrate) {
    const lines = sdp.split('\n');
    let lineIndex = -1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].indexOf('m=video') === 0) {
            lineIndex = i;
            break;
        }
    }
    if (lineIndex === -1) return sdp;

    // Add b=AS:bitrate after m=video line
    lines.splice(lineIndex + 1, 0, `b=AS:${bitrate}`);
    return lines.join('\n');
}

const muteMicButton = document.getElementById('muteMic');
const toggleVideoButton = document.getElementById('toggleVideo');

let isMuted = false;
let isVideoOff = false;

muteMicButton.onclick = () => {
    if (localStream) {
        isMuted = !isMuted;
        localStream.getAudioTracks()[0].enabled = !isMuted;
        muteMicButton.classList.toggle('off', isMuted);
        muteMicButton.querySelector('.material-icons').textContent = isMuted ? 'mic_off' : 'mic';
    }
};

toggleVideoButton.onclick = () => {
    if (localStream) {
        isVideoOff = !isVideoOff;
        localStream.getVideoTracks()[0].enabled = !isVideoOff;
        toggleVideoButton.classList.toggle('off', isVideoOff);
        toggleVideoButton.querySelector('.material-icons').textContent = isVideoOff ? 'videocam_off' : 'videocam';
    }
};

callActionButton.onclick = async () => {
    if (!inCall) {
        startCall();
    } else {
        hangUp();
    }
};

async function startCall() {
    console.log('Starting Call...');
    if (await playVideoFromCamera()) {
        inCall = true;
        updateActionButtonUI(true);
        createPeerConnection();
        const offer = await peerConnection.createOffer();
        
        // Boost bitrate to 2500kbps (2.5Mbps)
        offer.sdp = setVideoBitrate(offer.sdp, 2500);
        
        await peerConnection.setLocalDescription(offer);
        ws.send(JSON.stringify({ 
            type: 'offer', 
            offer: offer, 
            roomId: currentRoomId 
        }));
    }
}

function updateActionButtonUI(active) {
    const icon = callActionButton.querySelector('.material-icons');
    if (active) {
        callActionButton.classList.remove('call-start');
        callActionButton.classList.add('call-end');
        callActionButton.title = "End Call";
        icon.textContent = "call_end";
    } else {
        callActionButton.classList.remove('call-end');
        callActionButton.classList.add('call-start');
        callActionButton.title = "Start Call";
        icon.textContent = "call";
    }
}

async function handleOffer(offer) {
    if (!localStream) {
        await playVideoFromCamera();
    }
    
    if (!peerConnection) {
        createPeerConnection();
    }
    
    inCall = true;
    updateActionButtonUI(true);
    
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    processCandidateQueue();

    const answer = await peerConnection.createAnswer();
    
    // Boost bitrate on the answer as well
    answer.sdp = setVideoBitrate(answer.sdp, 2500);
    
    await peerConnection.setLocalDescription(answer);
    ws.send(JSON.stringify({ 
        type: 'answer', 
        answer: answer,
        roomId: currentRoomId 
    }));
}

function handleAnswer(answer) {
    if (peerConnection) {
        peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        processCandidateQueue();
    }
}

function handleCandidate(candidate) {
    if (peerConnection && peerConnection.remoteDescription) {
        peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } else {
        candidateQueue.push(candidate);
    }
}

function processCandidateQueue() {
    if (peerConnection && peerConnection.remoteDescription) {
        while (candidateQueue.length > 0) {
            const candidate = candidateQueue.shift();
            peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        }
    }
}

function createPeerConnection() {
    peerConnection = new RTCPeerConnection(configuration);

    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    peerConnection.ontrack = (event) => {
        if (event.streams && event.streams[0]) {
            remoteVideo.srcObject = event.streams[0];
            remoteVideo.className = 'full-screen';
            localVideo.className = 'floating';
        }
    };

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            ws.send(JSON.stringify({ 
                type: 'candidate', 
                candidate: event.candidate,
                roomId: currentRoomId 
            }));
        }
    };
}

function hangUp() {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    localVideo.srcObject = null;
    remoteVideo.srcObject = null;
    candidateQueue.length = 0;
    
    localVideo.className = 'full-screen';
    remoteVideo.className = 'floating';

    isMuted = false;
    isVideoOff = false;
    muteMicButton.classList.remove('off');
    muteMicButton.querySelector('.material-icons').textContent = 'mic';
    toggleVideoButton.classList.remove('off');
    toggleVideoButton.querySelector('.material-icons').textContent = 'videocam';
    
    inCall = false;
    updateActionButtonUI(false);
}
