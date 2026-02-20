const https = require("https");
const http = require("http");
const fs = require("fs");
const express = require("express");
const WebSocket = require("ws");
const { Server } = WebSocket;

const app = express();

const certPath = "certs/cert.pem";
const keyPath = "certs/key.pem";

let server;

if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  console.log("Loading HTTPS certificates...");
  server = https.createServer(
    {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath),
    },
    app,
  );
  console.log("Starting HTTPS server...");
} else {
  console.log("Certificates not found. Starting HTTP server...");
  server = http.createServer(app);
}

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
  const protocol = server instanceof https.Server ? "https" : "http";
  console.log(`Server is listening on ${protocol}://localhost:${PORT}`);
});
