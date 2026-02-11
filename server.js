const https = require("https");
const fs = require("fs");
const express = require("express");

const { Server } = require('ws');

const app = express();
const server = https.createServer({
    key: fs.readFileSync('certs/key.pem'),
    cert: fs.readFileSync('certs/cert.pem')
}, app);
const wss = new Server({ server });

app.use(express.static("public"));

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/index.html");
});

wss.on("connection", (ws) => {
  ws.id = Math.random().toString(36).substr(2, 9); // Simple unique ID
  
  ws.on("message", (message) => {
    let data;
    try {
      data = JSON.parse(message);
    } catch (e) {
      console.error("Invalid JSON:", message.toString());
      return;
    }

    if (data.type === 'join') {
      ws.roomId = data.roomId;
      ws.username = data.username || `User ${ws.id.substr(0,4)}`;
      console.log(`${ws.username} (${ws.id}) joined room: ${ws.roomId}`);
      
      const otherPeers = [];
      wss.clients.forEach((client) => {
        if (client !== ws && client.readyState === WebSocket.OPEN && client.roomId === ws.roomId) {
          otherPeers.push({ id: client.id, username: client.username });
          // Notify others about the new user
          client.send(JSON.stringify({ 
            type: 'user-joined', 
            peerId: ws.id, 
            username: ws.username 
          }));
        }
      });

      // Send the list of existing peers to the new user
      ws.send(JSON.stringify({ type: 'room-users', peers: otherPeers }));
      return;
    }

    // Targeted signaling: send to a specific peer
    if (data.targetId) {
      wss.clients.forEach((client) => {
        if (client.id === data.targetId && client.readyState === WebSocket.OPEN) {
          data.fromId = ws.id; // Tell the target who sent it
          client.send(JSON.stringify(data));
        }
      });
      return;
    }

    // Fallback broadcast (for backwards compatibility if needed)
    wss.clients.forEach((client) => {
      if (client !== ws && 
          client.readyState === WebSocket.OPEN && 
          client.roomId === ws.roomId) {
        client.send(message.toString());
      }
    });
  });

  ws.on("close", () => {
    if (ws.roomId) {
      wss.clients.forEach((client) => {
        if (client !== ws && client.readyState === WebSocket.OPEN && client.roomId === ws.roomId) {
          client.send(JSON.stringify({ type: 'user-left', peerId: ws.id }));
        }
      });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});
