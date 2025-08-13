// Konfigurasi utama aplikasi
// File ini berfungsi sebagai pusat pengaturan agar mudah diubah tanpa menyentuh logika utama.

// PENTING: Kunci API Gemini dan Nomor Admin sekarang dikonfigurasi melalui variabel lingkungan (environment variables).
// Lihat file .env.example untuk daftar variabel yang diperlukan saat menjalankan di server/VPS.

// Biaya pengiriman standar untuk produk fisik.
export const SHIPPING_COST = 15000;

// Definisi paket langganan yang tersedia
export const PACKAGES = {
  basic: { name: 'Paket Basic', price: 20000, durationDays: 7 },
  premium: { name: 'Paket Premium', price: 50000, durationDays: 30 },
};

// Konfigurasi untuk setiap fitur chatbot/generator
export const FEATURE_CONFIG = {
    image_prompt: { name: 'Generator Prompt Gambar' },
    chatbot: { name: 'Chat Bot', systemInstruction: 'Anda adalah asisten AI serbaguna.', welcomeMessage: 'Halo! Ada yang bisa saya bantu?' },
    olshop: { name: 'Asisten Olshop', systemInstruction: 'Anda adalah asisten belanja online.', welcomeMessage: 'Selamat datang di Asisten Olshop!' },
    veo3: { name: 'Generator Prompt Veo' },
    dalle: { name: 'Generator Prompt Dall-E' }
};

// Status pesanan untuk fitur Olshop
export const ORDER_STATUSES = {
    processing: 'Diproses',
    shipped: 'Dikirim',
    completed: 'Selesai',
    cancelled: 'Dibatalkan'
};
