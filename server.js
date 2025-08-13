import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { GoogleGenAI } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Baca environment variable untuk kunci API
const { GEMINI_API_KEY } = process.env;

if (!GEMINI_API_KEY) {
    console.warn("PERINGATAN: Variabel lingkungan GEMINI_API_KEY tidak diatur. Fitur AI tidak akan berfungsi.");
}
const geminiAI = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

// Helper untuk membaca request body
const getBody = (req) => new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => resolve(body));
    req.on('error', err => reject(err));
});

// Membuat server HTTP
const server = http.createServer(async (req, res) => {
    // API Proxy Endpoint untuk Gemini
    if (req.url === '/api/gemini' && req.method === 'POST') {
        if (!geminiAI) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Gemini not configured on server' }));
            return;
        }
        try {
            const body = await getBody(req);
            const { model, contents, config, history, newMessage } = JSON.parse(body);

            let requestContents;

            if (history && newMessage) { // Untuk fitur chat
                requestContents = history.map(msg => ({
                    role: msg.sender === 'user' ? 'user' : 'model',
                    parts: [{ text: msg.text }]
                }));
                requestContents.push({ role: 'user', parts: [{ text: newMessage }] });
            } else { // Untuk fitur generator biasa
                requestContents = contents;
            }

            if (!requestContents) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid request body for Gemini proxy' }));
                return;
            }

            const geminiRequest = { model, contents: requestContents, config };
            const response = await geminiAI.models.generateContent(geminiRequest);
            
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(response)); // Kirim kembali response mentah dari Gemini
        } catch (error) {
            console.error("Error in Gemini proxy:", error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal Server Error', details: error.message }));
        }
        return; // Akhiri penanganan permintaan API
    }

    // Logika penyajian file statis
    let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);

    const extname = String(path.extname(filePath)).toLowerCase();
    const mimeTypes = {
        '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
        '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
        '.gif': 'image/gif', '.svg': 'image/svg+xml',
    };

    let contentType = mimeTypes[extname] || 'application/octet-stream';
    
    if (extname === '.tsx' || extname === '.ts') {
        contentType = 'application/javascript';
    }

    fs.readFile(filePath, (error, content) => {
        if (error) {
            if (error.code == 'ENOENT') {
                res.writeHead(404, { 'Content-Type': 'text/html' });
                res.end('<h1>404: File Not Found</h1>', 'utf-8');
            } else {
                res.writeHead(500);
                res.end('Sorry, check with the site admin for error: ' + error.code + ' ..\n');
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

const wss = new WebSocketServer({ server });
wss.on('connection', (ws) => {
    console.log('✅ Klien terhubung via WebSocket');
    ws.on('message', (message) => console.log(`💬 Menerima pesan => ${message.toString()}`));
    ws.on('close', () => console.log('❌ Klien terputus'));
    ws.send('👋 Selamat datang! Anda terhubung ke server WebSocket.');
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server berjalan.`);
    console.log(`   - Server HTTP untuk file statis di http://localhost:${PORT}`);
    console.log(`   - Server WebSocket juga berjalan di port yang sama.`);
    console.log(`\nUntuk menjalankan aplikasi, buka browser Anda ke http://localhost:${PORT}`);
    console.log(`Untuk berhenti, tekan CTRL + C`);
});
