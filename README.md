# altobotapp

```
npm install
```

```
cp .env.example .env
```


```
nano .env
```


```
# File: .env

# --- Kunci API Google Gemini ---
# Dapatkan dari Google AI Studio.
GEMINI_API_KEY="GANTI_DENGAN_KUNCI_API_GEMINI_ASLI_ANDA"

# --- Nomor Admin ---
# Nomor telepon admin dalam format internasional (+62...).
ADMIN_PHONE_NUMBER="+628XXXXXXXXXX"
```


```
npm start
```


```
npm run start:bot
```


```
npm install pm2 -g
```


```
pm2 start npm --name "altobot-web" -- start
```


```
pm2 start npm --name "altobot-bot" -- run start:bot
```


```
pm2 logs altobot-bot
```


# Langkah 5: Mengakses Aplikasi Web
Setelah server web berjalan (baik dengan Cara 1 atau 2), buka browser di komputer atau ponsel Anda dan akses alamat:
http://<IP_VPS_ANDA>:3000
Ganti <IP_VPS_ANDA> dengan alamat IP publik dari VPS Anda.
Catatan Penting: Pastikan firewall di VPS Anda mengizinkan koneksi masuk pada port 3000. Jika tidak bisa diakses, Anda mungkin perlu menjalankan perintah seperti sudo ufw allow 3000.
Ringkasan Perintah Penting PM2
# Melihat semua proses yang berjalan:
pm2 list
# Melihat log dari proses tertentu:
pm2 logs altobot-web atau pm2 logs altobot-bot
# Menghentikan proses:
pm2 stop altobot-web
# Memulai ulang proses:
pm2 restart altobot-bot
# Menghapus proses dari daftar PM2:
pm2 delete altobot-web
# Menyimpan daftar proses agar otomatis berjalan setelah reboot VPS:
`pm2 save



