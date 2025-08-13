import { initializeApp } from 'firebase/app';
import { getAuth, RecaptchaVerifier, ConfirmationResult, User, signInWithPhoneNumber } from 'firebase/auth';
import { getFirestore, collection, doc, getDoc, setDoc, updateDoc, deleteDoc, query, where, getDocs, orderBy, writeBatch, serverTimestamp, Timestamp, onSnapshot } from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';

// --- Konfigurasi Firebase ---
// Konfigurasi ini dianggap publik dan aman untuk disimpan di frontend.
const firebaseConfig = {
    apiKey: "AIzaSyD9q0oX-cYsMDmVVQeTq7c_vtDWG9xpcvw",
    authDomain: "altomedia-8f793.firebaseapp.com",
    projectId: "altomedia-8f793",
    storageBucket: "altomedia-8f793.appspot.com",
    messagingSenderId: "327513974065",
    appId: "1:327513974065:web:336ec0a85243f8bb91bc10"
};

// --- Inisialisasi Firebase ---
// Inisialisasi aplikasi Firebase dengan gaya modular (SDK v9+)
const app = initializeApp(firebaseConfig);

// Ekspor service yang sudah diinisialisasi untuk digunakan di file lain (seperti index.tsx)
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// Ekspor tipe dan fungsi spesifik agar mudah diimpor
export {
    RecaptchaVerifier,
    signInWithPhoneNumber
};

// Ekspor tipe data dari Firebase untuk digunakan di TypeScript
export type {
    User,
    ConfirmationResult
};

// Ekspor fungsi dan objek Firestore untuk kemudahan
export {
    collection,
    doc,
    getDoc,
    setDoc,
    updateDoc,
    deleteDoc,
    query,
    where,
    getDocs,
    orderBy,
    writeBatch,
    serverTimestamp,
    Timestamp,
    onSnapshot
};

// Ekspor fungsi dan objek Storage untuk kemudahan
export {
    ref,
    uploadBytes,
    getDownloadURL
};

// Anda bisa membuat objek 'firebase' tiruan jika beberapa bagian kode lama masih membutuhkannya,
// tapi praktik terbaik adalah mengimpor langsung apa yang Anda butuhkan.
export const firebase = {
    auth,
    firestore: {
        FieldValue: {
            serverTimestamp
        },
        Timestamp
    }
};
