import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';
import 'firebase/compat/firestore';
import 'firebase/compat/storage';

// --- Konfigurasi Firebase ---
const firebaseConfig = {
    apiKey: "AIzaSyD9q0oX-cYsMDmVVQeTq7c_vtDWG9xpcvw",
    authDomain: "altomedia-8f793.firebaseapp.com",
    projectId: "altomedia-8f793",
    storageBucket: "altomedia-8f793.appspot.com",
    messagingSenderId: "327513974065",
    appId: "1:327513974065:web:336ec0a85243f8bb91bc10"
};

// --- Inisialisasi Firebase ---
const app = firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();

export { app, auth, db, storage, firebase };
