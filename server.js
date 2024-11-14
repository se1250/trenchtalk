const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const fetch = require('node-fetch');

app.use(express.static('public'));

const waitingUsers = new Set();
const activeConnections = new Map();

const marketCapNamespace = io.of('/market-cap');

async function trackMarketCap() {
    const COIN_ADDRESS = '';
    let useRaydiumApi = false;

    async function fetchMarketCap() {
        try {
            if (useRaydiumApi) {
                const timestamp = Date.now();
                const response = await fetch(
                    `https://api.dexscreener.com/latest/dex/tokens/${COIN_ADDRESS}?t=${timestamp}`
                );
                const data = await response.json();
                
                if (data.pairs && data.pairs[0]) {
                    return parseFloat(data.pairs[0].marketCap);
                }
            } else {
                const response = await fetch('https://streaming.bitquery.io/eap', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-API-KEY': 'BQYMSCxiZz5DlQgk6Fxx9KFeTXVtnuVL'
                    },
                    body: JSON.stringify({
                        query: `
                        subscription MyQuery {
                            Solana {
                                DEXTradeByTokens(
                                    orderBy: { descending: Block_Time }
                                    limit: { count: 10 }
                                    where: {
                                        Trade: {
                                            Dex: {
                                                ProgramAddress: {
                                                    is: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
                                                }
                                            }
                                            Currency: {
                                                MintAddress: { is: "2RADZAQBTGE31yRcsjaKJRZ7TM9hq59AKjxZK9ospump" }
                                            }
                                        }
                                        Transaction: { Result: { Success: true } }
                                    }
                                ) {
                                    Block {
                                        Time
                                    }
                                    Trade {
                                        Currency {
                                            MintAddress
                                            Name
                                            Symbol
                                        }
                                        Dex {
                                            ProtocolName
                                            ProtocolFamily
                                            ProgramAddress
                                        }
                                        Side {
                                            Currency {
                                                MintAddress
                                                Symbol
                                                Name
                                            }
                                        }
                                        Price
                                        PriceInUSD
                                    }
                                    Transaction {
                                        Signature
                                    }
                                }
                            }
                        }`
                    })
                });
                const data = await response.json();
                const price = parseFloat(data.data.Solana.DEXTradeByTokens[0].Trade.PriceInUSD);
                const marketCap = price * 1_000_000_000;
                
                if (marketCap >= 64000) {
                    useRaydiumApi = true;
                }
                
                return marketCap;
            }
        } catch (error) {
            console.error('Error fetching market cap:', error);
            console.error('Error details:', error.response?.data || error.message);
            return null;
        }
    }

    // Update market cap every 5 seconds
    setInterval(async () => {
        const marketCap = await fetchMarketCap();
        if (marketCap !== null) {
            marketCapNamespace.emit('market-cap-update', { marketCap });
        }
    }, 5000);
}

// Start tracking
trackMarketCap();

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('find-partner', (offer) => {
        console.log('User looking for partner:', socket.id);
        
        // If user was already waiting, remove them
        waitingUsers.delete(socket.id);
        
        // If user was in an active connection, remove them
        if (activeConnections.has(socket.id)) {
            const oldPartner = activeConnections.get(socket.id);
            activeConnections.delete(socket.id);
            activeConnections.delete(oldPartner);
            io.to(oldPartner).emit('partner-disconnected');
        }

        if (waitingUsers.size > 0) {
            const partner = [...waitingUsers][0];
            waitingUsers.delete(partner);
            
            // Create new active connection
            activeConnections.set(socket.id, partner);
            activeConnections.set(partner, socket.id);
            
            console.log('Matching users:', socket.id, 'and', partner);
            io.to(partner).emit('partner-found', offer);
        } else {
            console.log('User added to waiting list:', socket.id);
            waitingUsers.add(socket.id);
        }
    });

    socket.on('answer', (answer) => {
        const partner = activeConnections.get(socket.id);
        if (partner) {
            console.log('Sending answer to:', partner);
            io.to(partner).emit('answer', answer);
        }
    });

    socket.on('ice-candidate', (candidate) => {
        const partner = activeConnections.get(socket.id);
        if (partner) {
            console.log('Sending ICE candidate to:', partner);
            io.to(partner).emit('ice-candidate', candidate);
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        try {
            waitingUsers.delete(socket.id);
            
            if (activeConnections.has(socket.id)) {
                const partner = activeConnections.get(socket.id);
                activeConnections.delete(socket.id);
                activeConnections.delete(partner);
                io.to(partner).emit('partner-disconnected');
                console.log(`Notified partner ${partner} about disconnection`);
            }
        } catch (error) {
            console.error('Error handling disconnection:', error);
        }
    });

    socket.on('chat-message', (message) => {
        const partner = activeConnections.get(socket.id);
        if (partner) {
            try {
                io.to(partner).emit('chat-message', message);
                console.log(`Chat message sent from ${socket.id} to ${partner}`);
            } catch (error) {
                console.error('Error sending chat message:', error);
            }
        } else {
            console.log('No partner found for chat message from:', socket.id);
        }
    });

    socket.on('typing-start', () => {
        const partner = activeConnections.get(socket.id);
        if (partner) {
            io.to(partner).emit('typing-start');
        }
    });

    socket.on('typing-stop', () => {
        const partner = activeConnections.get(socket.id);
        if (partner) {
            io.to(partner).emit('typing-stop');
        }
    });

    socket.on('cancel-search', () => {
        console.log('User cancelled search:', socket.id);
        waitingUsers.delete(socket.id);
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
}); 
