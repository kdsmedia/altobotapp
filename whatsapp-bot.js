// Server untuk Bot WhatsApp
// Jalankan dengan 'npm run start:bot'

import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import { GoogleGenAI } from "@google/genai";
import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';
import 'firebase/compat/firestore';

// Impor konfigurasi non-sensitif dari file config.js
import { FEATURE_CONFIG } from './config.js';

console.log("Menginisialisasi Bot WhatsApp...");

// --- Konfigurasi Firebase (tetap karena ini info publik untuk koneksi) ---
const firebaseConfig = {
    apiKey: "AIzaSyD9q0oX-cYsMDmVVQeTq7c_vtDWG9xpcvw",
    authDomain: "altomedia-8f793.firebaseapp.com",
    projectId: "altomedia-8f793",
    storageBucket: "altomedia-8f793.appspot.com",
    messagingSenderId: "327513974065",
    appId: "1:327513974065:web:336ec0a85243f8bb91bc10"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// --- Muat Konfigurasi Sensitif dari Environment Variables ---
const { GEMINI_API_KEY, ADMIN_PHONE_NUMBER } = process.env;

// --- Inisialisasi Gemini ---
let geminiAI;
if (GEMINI_API_KEY) {
    geminiAI = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    console.log("✅ Gemini AI berhasil diinisialisasi.");
} else {
    console.error("❌ Peringatan: Variabel lingkungan GEMINI_API_KEY tidak diatur. Fitur AI tidak akan berfungsi.");
}

// Inisialisasi Klien WhatsApp
const client = new Client({
    authStrategy: new LocalAuth(), // Menggunakan LocalAuth untuk menyimpan sesi
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox'], // Diperlukan untuk lingkungan server/docker
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

    if (messageBody.toLowerCase() === '!ping') {
        message.reply('Pong!');
        return;
    }
    
    if (!geminiAI) {
        message.reply('Maaf, layanan AI sedang tidak tersedia saat ini karena kesalahan konfigurasi API Key di server.');
        return;
    }

    try {
        // Cek data pengguna di Firestore
        const usersRef = db.collection('users');
        const query = usersRef.where('phoneNumber', '==', userPhoneNumber);
        const userSnapshot = await query.get();

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

        // Logika AI menggunakan API yang sudah diperbarui
        const chatConfig = FEATURE_CONFIG.chatbot;
        const response = await geminiAI.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: messageBody,
            config: {
                systemInstruction: chatConfig.systemInstruction
            }
        });
        
        const text = response.text;
        
        message.reply(text);
        console.log(`🤖 Balasan AI dikirim ke ${userPhoneNumber}`);

    } catch (error) {
        console.error(`❌ Terjadi kesalahan saat memproses pesan dari ${userPhoneNumber}:`, error);
        message.reply('Maaf, terjadi kesalahan internal di server. Silakan coba lagi nanti.');
    }
});

client.initialize();
