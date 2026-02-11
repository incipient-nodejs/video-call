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
    // Broadcast the message to all clients except the sender
    // Ensure we convert Buffer to String so clients receive text, not Blobs
    const messageString = message.toString();
    wss.clients.forEach((client) => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(messageString);
      }
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});
