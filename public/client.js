let localStream;
let peerConnection;
let socket;
const marketCapSocket = io('/market-cap');
let isConnected = false;
let typingTimeout = null;
let isSearching = false;

const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
    ]
};

async function requestCamera() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        document.getElementById('localVideo').srcObject = localStream;
        return true;
    } catch (error) {
        console.error('Error accessing media devices:', error);
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
            localStream = null;
        }
        return false;
    }
}

async function init() {
    socket = io();
    
    document.getElementById('startButton').addEventListener('click', async () => {
        const hasCamera = await requestCamera();
        if (hasCamera) {
            startChat();
        }
    });

    document.getElementById('nextButton').addEventListener('click', async () => {
        const hasCamera = await requestCamera();
        if (hasCamera) {
            nextPerson();
        }
    });

    socket.on('offer', async (offer) => {
        createPeerConnection();
        await peerConnection.setRemoteDescription(offer);
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        socket.emit('answer', answer);
    });

    socket.on('partner-found', async (offer) => {
        console.log('Partner found, creating answer');
        try {
            await createPeerConnection();
            await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            socket.emit('answer', answer);
            
            document.querySelector('.chat-container').classList.add('active');
            document.getElementById('loadingOverlay').classList.add('hidden');
            document.getElementById('messages').innerHTML = '';
            isConnected = true;
        } catch (error) {
            console.error('Error creating answer:', error);
        }
    });

    socket.on('answer', async (answer) => {
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
            document.querySelector('.chat-container').classList.add('active');
            document.getElementById('loadingOverlay').classList.add('hidden');
            isConnected = true;
        } catch (error) {
            console.error('Error setting remote description:', error);
        }
    });

    socket.on('ice-candidate', async (candidate) => {
        console.log('Received ICE candidate');
        try {
            if (peerConnection) {
                await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            }
        } catch (error) {
            console.error('Error adding ICE candidate:', error);
        }
    });

    socket.on('partner-disconnected', () => {
        console.log('Partner disconnected');
        if (peerConnection) {
            peerConnection.close();
        }
        document.getElementById('remoteVideo').srcObject = null;
        
        document.querySelector('.chat-container').classList.remove('active');
        document.getElementById('messageInput').value = '';
    });

    marketCapSocket.on('connect', () => {
        console.log('Connected to market cap namespace');
    });

    marketCapSocket.on('market-cap-update', (data) => {
        console.log('Received market cap update:', data);
        updateMarketCap(data.marketCap);
    });

    const messageInput = document.getElementById('messageInput');
    const sendButton = document.getElementById('sendButton');

    sendButton.addEventListener('click', sendMessage);
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendMessage();
        }
    });

    socket.on('chat-message', (message) => {
        addMessage(message, false);
    });

    socket.on('typing-start', () => {
        document.querySelector('.typing-indicator').classList.add('active');
    });

    socket.on('typing-stop', () => {
        document.querySelector('.typing-indicator').classList.remove('active');
    });

    messageInput.addEventListener('input', () => {
        if (!isConnected) return;
        
        if (typingTimeout) clearTimeout(typingTimeout);
        
        socket.emit('typing-start');
        
        typingTimeout = setTimeout(() => {
            socket.emit('typing-stop');
        }, 1000);
    });

    document.getElementById('cancelButton').addEventListener('click', () => {
        if (isSearching) {
            socket.emit('cancel-search');
            document.getElementById('loadingOverlay').classList.add('hidden');
            isSearching = false;
        }
    });
}

function createPeerConnection() {
    peerConnection = new RTCPeerConnection(configuration);
    
    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    peerConnection.ontrack = event => {
        document.getElementById('remoteVideo').srcObject = event.streams[0];
    };

    peerConnection.onicecandidate = event => {
        if (event.candidate) {
            socket.emit('ice-candidate', event.candidate);
        }
    };
}

async function startChat() {
    isConnected = false;
    isSearching = true;
    document.getElementById('loadingOverlay').classList.remove('hidden');
    document.querySelector('.chat-container').classList.remove('active');
    document.getElementById('messages').innerHTML = '';
    
    if (peerConnection) {
        peerConnection.close();
    }
    
    try {
        createPeerConnection();
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.emit('find-partner', offer);
    } catch (error) {
        console.error('Error starting chat:', error);
        document.getElementById('loadingOverlay').classList.add('hidden');
        isSearching = false;
    }
}

async function nextPerson() {
    startChat();
}

function updateMarketCap(marketCap) {
    const formattedMarketCap = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(marketCap);
    
    document.getElementById('marketCap').textContent = `Market Cap: ${formattedMarketCap}`;
}

function sendMessage() {
    const messageInput = document.getElementById('messageInput');
    const message = messageInput.value.trim();
    
    if (message && isConnected) {
        socket.emit('chat-message', message);
        addMessage(message, true);
        messageInput.value = '';
    }
}

function addMessage(message, sent) {
    const messages = document.getElementById('messages');
    const messageElement = document.createElement('div');
    messageElement.classList.add('message', sent ? 'sent' : 'received');
    messageElement.textContent = sent ? `You: ${message}` : `Stranger: ${message}`;
    messages.appendChild(messageElement);
    messages.scrollTop = messages.scrollHeight;
}

window.addEventListener('load', init); 