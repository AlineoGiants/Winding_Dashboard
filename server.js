const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const cors = require('cors');

// --- 1. SYSTEM CONFIGURATION ---
const ARDUINO_COM_PORT = 'COM3'; // <-- You will change this to match your Windows COM port
const BAUD_RATE = 9600;
const SERVER_PORT = 3001; // Runs on 3001 so it doesn't fight with your Next.js UI on 3000

// --- 2. INITIALIZE SERVER ---
const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "http://localhost:3000", methods: ["GET", "POST"] }
});

// --- 3. INITIALIZE HARDWARE CONNECTION ---
const port = new SerialPort({ path: ARDUINO_COM_PORT, baudRate: BAUD_RATE }, function (err) {
  if (err) {
    console.log('\n[!] COM PORT ERROR: Could not find Arduino on ' + ARDUINO_COM_PORT);
    console.log('[!] Please check your USB connection and Device Manager.\n');
    return;
  }
});
const parser = port.pipe(new ReadlineParser({ delimiter: '\r\n' }));

// --- 4. THE DATA PIPELINE: ARDUINO -> DASHBOARD ---
parser.on('data', (data) => {
  try {
    // If the Arduino sends clean JSON, broadcast it to the UI
    const telemetry = JSON.parse(data);
    io.emit('telemetry', telemetry); 
  } catch (e) {
    // If it's just standard text (like bootup logs), print it to the console
    console.log("ARDUINO LOG:", data);
  }
});

// --- 5. THE CONTROL PIPELINE: DASHBOARD -> ARDUINO ---
io.on('connection', (socket) => {
  console.log('[+] Dashboard connected to Node.js Bridge');

  socket.on('command', (cmd) => {
    console.log('Sending command to hardware:', cmd);
    // Send the JSON command down the USB cable to the Arduino
    port.write(JSON.stringify(cmd) + '\n');
  });
});

server.listen(SERVER_PORT, () => {
  console.log(`\n=== SCADA BRIDGE ACTIVE ===`);
  console.log(`-> Listening to Arduino on ${ARDUINO_COM_PORT}...`);
  console.log(`-> WebSocket broadcasting on http://localhost:${SERVER_PORT}\n`);
});