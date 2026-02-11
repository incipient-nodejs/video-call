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
      console.log(`User joined room: ${ws.roomId}`);
      return;
    }

    // Broadcast the message to all clients in the SAME room except the sender
    const messageString = message.toString();
    wss.clients.forEach((client) => {
      if (client !== ws && 
          client.readyState === WebSocket.OPEN && 
          client.roomId === ws.roomId) {
        client.send(messageString);
      }
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});
