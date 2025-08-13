// Server untuk Bot WhatsApp
// Jalankan dengan 'npm run start:bot'

import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import { GoogleGenerativeAI } from "@google/generativeai";
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, query, where, getDocs } from 'firebase/firestore';

// Impor konfigurasi non-sensitif dari file config.js
import { FEATURE_CONFIG } from './config.js';

console.log("Menginisialisasi Bot WhatsApp...");

// --- Muat Konfigurasi Sensitif dari Environment Variables ---
// Pastikan Anda membuat file .env di root proyek Anda
// atau mengatur variabel ini di lingkungan server Anda.
const {
    GEMINI_API_KEY,
    ADMIN_PHONE_NUMBER,
    FB_API_KEY,
    FB_AUTH_DOMAIN,
    FB_PROJECT_ID,
    FB_STORAGE_BUCKET,
    FB_MESSAGING_SENDER_ID,
    FB_APP_ID
} = process.env;


// --- Konfigurasi Firebase (diambil dari environment variables) ---
const firebaseConfig = {
    apiKey: FB_API_KEY,
    authDomain: FB_AUTH_DOMAIN,
    projectId: FB_PROJECT_ID,
    storageBucket: FB_STORAGE_BUCKET,
    messagingSenderId: FB_MESSAGING_SENDER_ID,
    appId: FB_APP_ID
};

// Cek apakah konfigurasi Firebase lengkap
if (Object.values(firebaseConfig).some(v => !v)) {
    console.error("❌ Peringatan: Konfigurasi Firebase tidak lengkap. Pastikan semua variabel FB_* diatur di environment.");
    // process.exit(1); // Hentikan jika Firebase tidak terkonfigurasi
}

// Inisialisasi Firebase dengan SDK v9 (modular)
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
console.log("✅ Firebase SDK berhasil diinisialisasi.");


// --- Inisialisasi Gemini ---
let genAI;
if (GEMINI_API_KEY) {
    genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    console.log("✅ Gemini AI berhasil diinisialisasi.");
} else {
    console.error("❌ Peringatan: Variabel lingkungan GEMINI_API_KEY tidak diatur. Fitur AI tidak akan berfungsi.");
}

// Inisialisasi Klien WhatsApp
const client = new Client({
    authStrategy: new LocalAuth(), // Menggunakan LocalAuth untuk menyimpan sesi
    puppeteer: {
        headless: true, // Jalankan browser di background
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process', // <- Mungkin membantu di lingkungan terbatas
            '--disable-gpu'
        ],
    }
});

console.log("Mempersiapkan klien WhatsApp...");

// Event: Menghasilkan QR Code untuk otentikasi
client.on('qr', qr => {
    console.log('📱 Kode QR diterima, pindai dengan WhatsApp Anda:');
    qrcode.generate(qr, { small: true });
});

// Event: Klien berhasil terotentikasi dan siap
client.on('ready', () => {
    console.log('✅ Bot WhatsApp siap dan terhubung!');
    if (ADMIN_PHONE_NUMBER) {
        const adminTarget = ADMIN_PHONE_NUMBER.replace('+', '') + '@c.us';
        client.sendMessage(adminTarget, 'Bot ALTOBOT telah berhasil terhubung dan siap digunakan.');
    } else {
        console.warn("PERINGATAN: Variabel lingkungan ADMIN_PHONE_NUMBER tidak diatur. Notifikasi status ke admin tidak akan dikirim.");
    }
});

// Event: Menerima pesan baru
client.on('message', async message => {
    const userPhoneNumber = `+${message.from.split('@')[0]}`;
    const messageBody = message.body.trim();
    console.log(`💬 Pesan diterima dari ${userPhoneNumber}: "${messageBody}"`);

    // Abaikan pesan dari status atau grup
    if (message.from.endsWith('@g.us') || message.from.endsWith('@broadcast')) {
        return;
    }
    
    // Perintah dasar untuk testing koneksi
    if (messageBody.toLowerCase() === '!ping') {
        message.reply('Pong!');
        return;
    }
    
    // Cek apakah Gemini AI sudah siap
    if (!genAI) {
        message.reply('Maaf, layanan AI sedang tidak tersedia saat ini karena kesalahan konfigurasi API Key di server.');
        return;
    }

    try {
        // Cek data pengguna di Firestore
        const usersRef = collection(db, 'users');
        const q = query(usersRef, where('phoneNumber', '==', userPhoneNumber));
        const userSnapshot = await getDocs(q);

        if (userSnapshot.empty) {
            console.log(`Pengguna baru: ${userPhoneNumber}. Meminta untuk mendaftar.`);
            message.reply('Halo! Sepertinya Anda pengguna baru. Silakan login terlebih dahulu melalui aplikasi web kami untuk mengaktifkan akun Anda.');
            return;
        }
        
        const userData = userSnapshot.docs[0].data();

        // Periksa apakah pengguna diblokir
        if (userData.isBlocked) {
            console.log(`❌ Akses ditolak untuk pengguna yang diblokir: ${userPhoneNumber}`);
            message.reply('Maaf, akun Anda saat ini sedang diblokir.');
            return;
        }

        // Logika AI menggunakan Gemini
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const chatConfig = FEATURE_CONFIG.chatbot;
        
        const chat = model.startChat({
            systemInstruction: chatConfig.systemInstruction,
            history: [], // Anda bisa menambahkan riwayat percakapan di sini jika perlu
        });

        const result = await chat.sendMessage(messageBody);
        const response = result.response;
        const text = response.text();
        
        message.reply(text);
        console.log(`🤖 Balasan AI dikirim ke ${userPhoneNumber}`);

    } catch (error) {
        console.error(`❌ Terjadi kesalahan saat memproses pesan dari ${userPhoneNumber}:`, error);
        message.reply('Maaf, terjadi kesalahan internal di server. Silakan coba lagi nanti.');
    }
});

client.initialize();
