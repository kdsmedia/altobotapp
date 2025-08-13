import { GoogleGenAI, Type } from "@google/genai";
import { auth, db, firebase, storage } from './firebase.ts';
import { PACKAGES, FEATURE_CONFIG, ORDER_STATUSES, SHIPPING_COST } from './config.js';


// --- Deklarasi Global untuk TypeScript ---
declare var grecaptcha: any;

declare global {
  interface Window {
    recaptchaVerifier: firebase.auth.RecaptchaVerifier;
  }
}

// --- Inisialisasi Gemini AI tidak lagi dilakukan di sini untuk keamanan ---
// Panggilan API akan dilakukan melalui backend proxy


// --- State Aplikasi ---
let currentUser: firebase.User | null = null;
let currentUserData: firebase.firestore.DocumentData | null = null;
let messages = [];
let isLoading = false;
let confirmationResult: firebase.auth.ConfirmationResult | null = null;
let unsubscribeListeners: (() => void)[] = [];
let checkoutItem: any = null;


// --- Helper Functions ---
const formatCurrency = (amount) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(amount);
const formatDate = (timestamp: firebase.firestore.Timestamp) => timestamp ? timestamp.toDate().toLocaleString('id-ID') : 'N/A';
const show = (el) => el?.classList.remove('hidden');
const hide = (el) => el?.classList.add('hidden');

// --- Inisialisasi Aplikasi ---
document.addEventListener('DOMContentLoaded', () => {
  setupAuthSystem();
  setupGeneralEventListeners();
  setupGeneratorEventListeners();
  setupOlshopEventListeners();
});

// =================================================================
// AUTHENTICATION SYSTEM
// =================================================================
function setupAuthSystem() {
  window.recaptchaVerifier = new firebase.auth.RecaptchaVerifier('recaptcha-container', {
    'size': 'invisible',
    'callback': (response) => { console.log('reCAPTCHA verified'); }
  });

  auth.onAuthStateChanged(async (user) => {
    const loginModal = document.getElementById('login-modal-overlay');
    if (user) {
      currentUser = user;
      await loadUserData(user.uid, user.phoneNumber);
      hide(loginModal);
    } else {
      currentUser = null;
      currentUserData = null;
      show(loginModal);
      resetUI();
    }
  });

  document.getElementById('login-form').addEventListener('submit', onSignInSubmit);
  document.getElementById('verify-form').addEventListener('submit', onVerifyCodeSubmit);
  document.getElementById('logout-btn').addEventListener('click', () => auth.signOut());
}

async function onSignInSubmit(e) {
  e.preventDefault();
  const phoneNumber = (document.getElementById('phone-number') as HTMLInputElement).value;
  const appVerifier = window.recaptchaVerifier;
  const loginErrorEl = document.getElementById('login-error');
  loginErrorEl.textContent = '';

  try {
    confirmationResult = await auth.signInWithPhoneNumber(phoneNumber, appVerifier);
    hide(document.getElementById('login-form'));
    show(document.getElementById('verify-form'));
    alert('Kode verifikasi telah dikirim.');
  } catch (error) {
    console.error("Error sending verification code", error);
    loginErrorEl.textContent = "Gagal mengirim kode. Pastikan nomor benar dan formatnya (+62...).";
    window.recaptchaVerifier.render().then(widgetId => grecaptcha.reset(widgetId));
  }
}

async function onVerifyCodeSubmit(e) {
  e.preventDefault();
  const code = (document.getElementById('verification-code') as HTMLInputElement).value;
  const loginErrorEl = document.getElementById('login-error');
  loginErrorEl.textContent = '';
  try {
    await confirmationResult.confirm(code);
    // onAuthStateChanged akan menangani sisanya
  } catch (error) {
    console.error("Error verifying code", error);
    loginErrorEl.textContent = "Kode verifikasi salah.";
  }
}

async function loadUserData(uid, phoneNumber) {
  const userRef = db.collection("users").doc(uid);
  let userDoc = await userRef.get();
  
  // Ambil nomor admin dari server jika perlu, atau hardcode jika hanya untuk UI check
  const adminPhoneNumber = "+6285813899649"; // Nomor ini tidak lagi sensitif karena hanya untuk check UI

  if (!userDoc.exists) {
    const newUser = {
      phoneNumber: phoneNumber,
      displayName: '',
      balance: 0,
      subscription: { plan: null, expiresAt: null },
      lastBonusClaim: null,
      isBlocked: false,
      isAdmin: phoneNumber === adminPhoneNumber,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    await userRef.set(newUser);
    userDoc = await userRef.get();
  }
  
  currentUserData = userDoc.data();
  
  if (currentUserData.isBlocked) {
      alert("Akun Anda telah diblokir.");
      await auth.signOut();
      return;
  }
  
  renderUIForUser();
}

// =================================================================
// UI RENDERING
// =================================================================

function resetUI() {
    hide(document.getElementById('main-content'));
    hide(document.getElementById('admin-panel-container'));
    hide(document.getElementById('user-wallet-info'));
    hideAllViews();
    unsubscribeAll();
}

function renderUIForUser() {
  resetUI();
  if (currentUserData.isAdmin) {
    renderAdminPanel();
  } else {
    renderUserView();
  }
}

function renderUserView() {
    const mainContent = document.getElementById('main-content');
    const userWalletInfo = document.getElementById('user-wallet-info');
    const userBalanceEl = document.getElementById('user-balance');
    const notificationBanner = document.getElementById('notification-banner');

    show(mainContent);
    show(userWalletInfo);
    
    // Update balance
    userBalanceEl.textContent = `Saldo: ${formatCurrency(currentUserData.balance)}`;

    // Check subscription and handle both Timestamp and Date objects for safety
    if (hasActiveSubscription()) {
      // Subscription is active
    } else {
      currentUserData.subscription = { plan: null, expiresAt: null };
    }

    // Setup wallet modal
    setupWalletModal();

    // Listen for global notifications
    const unsub = db.collection("notifications").doc("global").onSnapshot((doc) => {
        if (doc.exists) {
            const data = doc.data();
            notificationBanner.textContent = data.message;
            show(notificationBanner);
        } else {
            hide(notificationBanner);
        }
    });
    unsubscribeListeners.push(unsub);
}

// =================================================================
// ADMIN PANEL
// =================================================================

function renderAdminPanel() {
    show(document.getElementById('admin-panel-container'));
    setupAdminTabs();
    loadAdminData('orders'); // Load initial tab
}

function setupAdminTabs() {
    const tabs = document.querySelectorAll('.admin-tab-btn');
    tabs.forEach((tab: HTMLElement) => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const tabName = tab.dataset.tab;
            document.querySelectorAll('.admin-tab-content').forEach(c => hide(c));
            show(document.getElementById(`admin-tab-${tabName}`));
            loadAdminData(tabName);
        });
    });

    document.getElementById('notification-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const message = (document.getElementById('notification-message') as HTMLTextAreaElement).value;
        if (!message) return;
        await db.collection("notifications").doc("global").set({
            message: message,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        alert('Notifikasi berhasil dikirim.');
    });

    document.getElementById('product-form').addEventListener('submit', handleProductFormSubmit);
    document.getElementById('close-product-form-btn').addEventListener('click', () => hide(document.getElementById('product-form-overlay')));
    
    document.getElementById('product-category').addEventListener('change', (e) => {
        const category = (e.target as HTMLSelectElement).value;
        const fashionFields = document.getElementById('fashion-fields');
        if (category === 'fashion') {
            show(fashionFields);
        } else {
            hide(fashionFields);
        }
    });
}

function loadAdminData(tabName) {
    unsubscribeAll();
    const container = document.getElementById(`admin-tab-${tabName}`);
    if (!container) return; // Exit if container doesn't exist (e.g., 'bot' tab)
    
    container.innerHTML = 'Memuat data...';

    let q;
    if (tabName === 'users') {
        q = db.collection('users');
        const unsub = q.onSnapshot((snapshot) => renderUsersTable(container, snapshot.docs));
        unsubscribeListeners.push(unsub);
    } else if (tabName === 'orders') {
        q = db.collection('orders').orderBy('createdAt', 'desc');
        const unsub = q.onSnapshot((snapshot) => renderOrdersTable(container, snapshot.docs));
        unsubscribeListeners.push(unsub);
    } else if (tabName === 'products') {
        q = db.collection('products').orderBy('name');
        const unsub = q.onSnapshot((snapshot) => renderAdminProductsTable(container, snapshot.docs));
        unsubscribeListeners.push(unsub);
    } else if (['subscriptions', 'deposits', 'withdrawals'].includes(tabName)) {
        let type = tabName.slice(0, -1);
        q = db.collection("transactions").where("type", "==", type).where("status", "==", "pending");
        const unsub = q.onSnapshot((snapshot) => renderTransactionsTable(container, snapshot.docs));
        unsubscribeListeners.push(unsub);
    } else if (tabName === 'notifications' || tabName === 'bot') {
        // These tabs have static content, no data loading needed
        container.innerHTML = '';
    }
}

function renderUsersTable(container, userDocs) {
    if (userDocs.length === 0) {
        container.innerHTML = '<p>Tidak ada data pengguna.</p>';
        return;
    }
    const table = `
        <table class="admin-table">
            <thead><tr><th>Telepon</th><th>Saldo</th><th>Langganan</th><th>Status</th><th>Aksi</th></tr></thead>
            <tbody>
                ${userDocs.map(doc => {
                    const user = doc.data();
                    const subInfo = user.subscription?.plan ? `${user.subscription.plan} (hingga ${formatDate(user.subscription.expiresAt)})` : 'Tidak ada';
                    return `
                        <tr>
                            <td>${user.phoneNumber}</td>
                            <td>${formatCurrency(user.balance)}</td>
                            <td>${subInfo}</td>
                            <td>${user.isBlocked ? 'Diblokir' : 'Aktif'}</td>
                            <td>
                                <button class="btn-action btn-block" data-uid="${doc.id}" data-blocked="${user.isBlocked}">${user.isBlocked ? 'Buka Blokir' : 'Blokir'}</button>
                                <button class="btn-action btn-delete" data-uid="${doc.id}">Hapus</button>
                            </td>
                        </tr>
                    `;
                }).join('')}
            </tbody>
        </table>
    `;
    container.innerHTML = table;
    container.querySelectorAll('.btn-block').forEach(btn => btn.addEventListener('click', handleBlockUser));
    container.querySelectorAll('.btn-delete').forEach(btn => btn.addEventListener('click', handleDeleteUser));
}


function renderTransactionsTable(container, transactionDocs) {
    if (transactionDocs.length === 0) {
        container.innerHTML = '<p>Tidak ada permintaan tertunda.</p>';
        return;
    }
    const table = `
        <table class="admin-table">
             <thead><tr><th>User</th><th>Tipe</th><th>Detail</th><th>Tanggal</th><th>Aksi</th></tr></thead>
             <tbody>
                ${transactionDocs.map(doc => {
                    const t = doc.data();
                    let detail = '';
                    if (t.type === 'deposit' || t.type === 'withdrawal') detail = formatCurrency(t.amount);
                    if (t.type === 'subscription') detail = `${PACKAGES[t.plan].name} (${formatCurrency(PACKAGES[t.plan].price)})`;
                    
                    return `
                        <tr>
                            <td>${t.userPhoneNumber}</td>
                            <td>${t.type}</td>
                            <td>${detail}</td>
                            <td>${formatDate(t.createdAt)}</td>
                            <td>
                                <button class="btn-action btn-approve" data-id="${doc.id}">Setujui</button>
                                <button class="btn-action btn-reject" data-id="${doc.id}">Tolak</button>
                            </td>
                        </tr>
                    `
                }).join('')}
             </tbody>
        </table>
    `;
    container.innerHTML = table;
    container.querySelectorAll('.btn-approve').forEach(btn => btn.addEventListener('click', handleTransactionApproval));
    container.querySelectorAll('.btn-reject').forEach(btn => btn.addEventListener('click', handleTransactionApproval));
}

function renderOrdersTable(container, orderDocs) {
    if (orderDocs.length === 0) {
        container.innerHTML = '<p>Tidak ada pesanan.</p>';
        return;
    }
    const table = `
        <table class="admin-table">
            <thead>
                <tr>
                    <th>Tanggal</th>
                    <th>Customer</th>
                    <th>Produk</th>
                    <th>Detail Pesanan</th>
                    <th>Alamat</th>
                    <th>Bukti Bayar</th>
                    <th>Status</th>
                </tr>
            </thead>
            <tbody>
                ${orderDocs.map(doc => {
                    const order = doc.data();
                    
                    // Product Details
                    let productDetails = '';
                    if (order.items && order.items.length > 0) {
                        productDetails = order.items.map(item => {
                            let details = `<strong>${item.productName}</strong>`;
                            if(item.color) details += `<br><small>Warna: ${item.color}</small>`;
                            if(item.size) details += `<br><small>Size: ${item.size}</small>`;
                            if(item.quantity) details += `<br><small>Qty: ${item.quantity}</small>`;
                            return details;
                        }).join('<hr style="margin: 4px 0; border-color: #eee;">');
                    } else {
                        // Fallback for old orders
                        productDetails = `<strong>${order.productName}</strong>`;
                        if(order.color) productDetails += `<br><small>Warna: ${order.color}</small>`;
                        if(order.size) productDetails += `<br><small>Size: ${order.size}</small>`;
                        if(order.quantity > 1) productDetails += `<br><small>Qty: ${order.quantity}</small>`;
                    }

                    // Address Details
                    let addressHtml = '';
                    if (order.shippingDetails) {
                        const d = order.shippingDetails;
                        addressHtml = `
                            <strong>${d.name}</strong> (${d.phone})<br>
                            ${d.fullAddress}, ${d.village}, ${d.district},<br>
                            ${d.city}, ${d.province} ${d.postalCode}<br>
                            RT/RW: ${d.rt}/${d.rw}
                        `;
                    } else {
                        addressHtml = order.shippingAddress; // Fallback for old orders
                    }

                    // Payment Details
                    const paymentDetails = `
                        Subtotal: ${formatCurrency(order.subtotal || 0)}<br>
                        Ongkir: ${formatCurrency(order.shippingCost || 0)}<br>
                        <strong>Total: ${formatCurrency(order.totalPrice || 0)}</strong>
                    `;
                    
                    const statusOptions = Object.keys(ORDER_STATUSES).map(key => 
                        `<option value="${key}" ${order.status === key ? 'selected' : ''}>${ORDER_STATUSES[key]}</option>`
                    ).join('');

                    const proofLink = order.paymentProofUrl 
                        ? `<a href="${order.paymentProofUrl}" target="_blank" class="btn-action view-proof">Lihat Bukti</a>`
                        : '<span>Tidak Ada</span>';

                    return `
                        <tr>
                            <td>${formatDate(order.createdAt)}</td>
                            <td>
                                ${order.shippingDetails?.name || order.customerName}<br>
                                <small>${order.userPhoneNumber}</small>
                            </td>
                            <td>${productDetails}</td>
                            <td>${paymentDetails}</td>
                            <td class="address-cell">${addressHtml}</td>
                            <td>${proofLink}</td>
                            <td>
                                <select class="order-status-select" data-id="${doc.id}">
                                    ${statusOptions}
                                </select>
                            </td>
                        </tr>
                    `;
                }).join('')}
            </tbody>
        </table>
    `;
    container.innerHTML = table;
    container.querySelectorAll('.order-status-select').forEach(select => {
        select.addEventListener('change', handleOrderStatusChange);
    });
}

function renderAdminProductsTable(container, productDocs) {
    let content = `
        <div class="admin-tab-header">
            <h2>Kelola Produk</h2>
            <button id="add-product-btn" class="btn-primary">Tambah Produk Baru</button>
        </div>
    `;

    if (productDocs.length === 0) {
        content += '<p>Belum ada produk. Tambahkan produk pertama Anda!</p>';
        container.innerHTML = content;
        document.getElementById('add-product-btn').addEventListener('click', () => showProductFormModal());
        return;
    }

    content += `
        <table class="admin-table">
            <thead>
                <tr>
                    <th>Gambar</th>
                    <th>Nama Produk</th>
                    <th>Harga</th>
                    <th>Kategori</th>
                    <th>Aksi</th>
                </tr>
            </thead>
            <tbody>
                ${productDocs.map(doc => {
                    const product = doc.data();
                    return `
                        <tr>
                            <td><img src="${product.imageUrl}" alt="${product.name}" class="product-image-thumb"></td>
                            <td>${product.name}</td>
                            <td>${formatCurrency(product.price)}</td>
                            <td>${product.category || 'Standard'}</td>
                            <td>
                                <button class="btn-action btn-edit-product" data-id="${doc.id}">Edit</button>
                                <button class="btn-action btn-delete btn-delete-product" data-id="${doc.id}">Hapus</button>
                            </td>
                        </tr>
                    `;
                }).join('')}
            </tbody>
        </table>
    `;
    container.innerHTML = content;
    
    document.getElementById('add-product-btn').addEventListener('click', () => showProductFormModal());
    
    container.querySelectorAll('.btn-edit-product').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const id = (e.target as HTMLElement).dataset.id;
            const docRef = db.collection('products').doc(id);
            const docSnap = await docRef.get();
            if (docSnap.exists) {
                showProductFormModal(id, docSnap.data());
            }
        });
    });

    container.querySelectorAll('.btn-delete-product').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = (e.target as HTMLElement).dataset.id;
            handleDeleteProduct(id);
        });
    });
}

async function handleTransactionApproval(e) {
    const button = e.target as HTMLButtonElement;
    const transactionId = button.dataset.id;
    const isApproved = button.classList.contains('btn-approve');
    button.textContent = 'Memproses...';
    button.disabled = true;

    const transactionRef = db.collection("transactions").doc(transactionId);
    try {
        const transactionDoc = await transactionRef.get();
        if (!transactionDoc.exists) throw new Error("Transaksi tidak ditemukan.");
        
        const transactionData = transactionDoc.data();
        const userRef = db.collection("users").doc(transactionData.userId);

        const batch = db.batch();

        if (isApproved) {
             const userDoc = await userRef.get();
             if (!userDoc.exists) throw new Error("User tidak ditemukan.");
             const userData = userDoc.data();
             let newBalance = userData.balance;

             if (transactionData.type === 'deposit') {
                 newBalance += transactionData.amount;
             } else if (transactionData.type === 'withdrawal') {
                 if(newBalance < transactionData.amount) throw new Error("Saldo tidak cukup");
                 newBalance -= transactionData.amount;
             } else if (transactionData.type === 'subscription') {
                 const pkg = PACKAGES[transactionData.plan];
                 const newExpiry = new Date();
                 newExpiry.setDate(newExpiry.getDate() + pkg.durationDays);
                 batch.update(userRef, { 'subscription.plan': transactionData.plan, 'subscription.expiresAt': firebase.firestore.Timestamp.fromDate(newExpiry) });
             }
             if(newBalance !== userData.balance) {
                 batch.update(userRef, { balance: newBalance });
             }
        }
        
        batch.update(transactionRef, { status: isApproved ? 'approved' : 'rejected' });
        await batch.commit();
        alert('Transaksi berhasil diproses.');

    } catch (error) {
        console.error("Error processing transaction:", error);
        alert('Gagal memproses transaksi: ' + error.message);
        button.textContent = isApproved ? 'Setujui' : 'Tolak';
        button.disabled = false;
    }
}

async function handleBlockUser(e) {
    const button = e.target as HTMLElement;
    const uid = button.dataset.uid;
    const isCurrentlyBlocked = button.dataset.blocked === 'true';
    if(confirm(`Anda yakin ingin ${isCurrentlyBlocked ? 'membuka blokir' : 'memblokir'} pengguna ini?`)){
        await db.collection("users").doc(uid).update({ isBlocked: !isCurrentlyBlocked });
    }
}

async function handleDeleteUser(e) {
    const uid = (e.target as HTMLElement).dataset.uid;
    if(confirm('PERINGATAN: Menghapus pengguna akan menghapus semua datanya dan tidak bisa dibatalkan. Lanjutkan?')){
        // Note: This only deletes Firestore data. Auth user is separate.
        // For a full solution, you'd need Cloud Functions to delete the Auth user too.
        await db.collection("users").doc(uid).delete();
    }
}

async function handleOrderStatusChange(e) {
    const select = e.target as HTMLSelectElement;
    const orderId = select.dataset.id;
    const newStatus = select.value;

    if (!orderId || !newStatus) return;
    
    try {
        await db.collection('orders').doc(orderId).update({
            status: newStatus,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        // The UI will update automatically due to the onSnapshot listener
    } catch (error) {
        console.error("Error updating order status:", error);
        alert("Gagal memperbarui status pesanan.");
    }
}


function showProductFormModal(productId = null, productData: any = null) {
    const modal = document.getElementById('product-form-overlay');
    const form = document.getElementById('product-form') as HTMLFormElement;
    const title = document.getElementById('product-form-title');
    
    form.reset();
    (document.getElementById('product-id') as HTMLInputElement).value = '';

    const categorySelect = document.getElementById('product-category') as HTMLSelectElement;
    const colorsInput = document.getElementById('product-colors') as HTMLInputElement;
    const sizesInput = document.getElementById('product-sizes') as HTMLInputElement;
    const fashionFields = document.getElementById('fashion-fields');

    if (productId && productData) {
        // Edit mode
        title.textContent = 'Edit Produk';
        (document.getElementById('product-id') as HTMLInputElement).value = productId;
        (document.getElementById('product-name') as HTMLInputElement).value = productData.name;
        (document.getElementById('product-price') as HTMLInputElement).value = productData.price;
        (document.getElementById('product-description') as HTMLTextAreaElement).value = productData.description;
        (document.getElementById('product-imageUrl') as HTMLInputElement).value = productData.imageUrl;
        categorySelect.value = productData.category || 'standard';

        if (productData.category === 'fashion') {
            colorsInput.value = productData.colors?.join(',') || '';
            sizesInput.value = productData.sizes?.join(',') || '';
            show(fashionFields);
        } else {
            hide(fashionFields);
        }

    } else {
        // Add mode
        title.textContent = 'Tambah Produk Baru';
        categorySelect.value = 'standard';
        hide(fashionFields);
    }

    show(modal);
}

async function handleProductFormSubmit(e) {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const productId = (document.getElementById('product-id') as HTMLInputElement).value;
    const category = (document.getElementById('product-category') as HTMLSelectElement).value;
    const name = (document.getElementById('product-name') as HTMLInputElement).value;
    const price = parseInt((document.getElementById('product-price') as HTMLInputElement).value);
    const description = (document.getElementById('product-description') as HTMLTextAreaElement).value;
    const imageUrl = (document.getElementById('product-imageUrl') as HTMLInputElement).value;

    if (!name || !price || !description || !imageUrl) {
        alert('Harap isi semua field.');
        return;
    }

    const productData: any = { name, price, description, imageUrl, category };

    if (category === 'fashion') {
        const colors = (document.getElementById('product-colors') as HTMLInputElement).value.split(',').map(s => s.trim()).filter(Boolean);
        const sizes = (document.getElementById('product-sizes') as HTMLInputElement).value.split(',').map(s => s.trim()).filter(Boolean);
        productData.colors = colors;
        productData.sizes = sizes;
    }

    try {
        if (productId) {
            // Update existing product
            await db.collection('products').doc(productId).update(productData);
            alert('Produk berhasil diperbarui.');
        } else {
            // Add new product
            await db.collection('products').add(productData);
            alert('Produk berhasil ditambahkan.');
        }
        hide(document.getElementById('product-form-overlay'));
        form.reset();
    } catch (error) {
        console.error('Error saving product:', error);
        alert('Gagal menyimpan produk. ' + error.message);
    }
}

async function handleDeleteProduct(productId) {
    if (confirm('Anda yakin ingin menghapus produk ini? Aksi ini tidak dapat dibatalkan.')) {
        try {
            await db.collection('products').doc(productId).delete();
            alert('Produk berhasil dihapus.');
        } catch (error) {
            console.error('Error deleting product:', error);
            alert('Gagal menghapus produk. ' + error.message);
        }
    }
}

function unsubscribeAll() {
  unsubscribeListeners.forEach(unsub => unsub());
  unsubscribeListeners = [];
}

// =================================================================
// USER FEATURES (WALLET, SUBSCRIPTION, ETC)
// =================================================================

function setupWalletModal() {
    const walletModal = document.getElementById('wallet-modal-overlay');
    document.getElementById('open-wallet-btn').addEventListener('click', () => show(walletModal));
    document.getElementById('close-wallet-btn').addEventListener('click', () => hide(walletModal));

    // Claim Bonus
    const claimBtn = document.getElementById('claim-bonus-btn') as HTMLButtonElement;
    const lastClaim = currentUserData.lastBonusClaim?.toDate();
    const oneDay = 24 * 60 * 60 * 1000;
    if (lastClaim && (Date.now() - lastClaim.getTime() < oneDay)) {
        claimBtn.disabled = true;
        claimBtn.textContent = 'Bonus sudah diklaim hari ini';
    } else {
        claimBtn.disabled = false;
        claimBtn.textContent = 'Klaim Bonus (Rp 200)';
    }
    claimBtn.onclick = handleClaimBonus;
    
    // Deposit Form
    document.getElementById('deposit-form').addEventListener('submit', handleDepositRequest);

    // Withdraw Form
    document.getElementById('withdraw-form').addEventListener('submit', handleWithdrawRequest);
}

async function handleClaimBonus() {
    const claimBtn = document.getElementById('claim-bonus-btn') as HTMLButtonElement;
    claimBtn.disabled = true;
    try {
        const userRef = db.collection("users").doc(currentUser.uid);
        const newBalance = (currentUserData.balance || 0) + 200;
        await userRef.update({
            balance: newBalance,
            lastBonusClaim: firebase.firestore.FieldValue.serverTimestamp()
        });
        // Optimistic UI update
        currentUserData.balance = newBalance;
        currentUserData.lastBonusClaim = firebase.firestore.Timestamp.now();
        (document.getElementById('user-balance') as HTMLSpanElement).textContent = `Saldo: ${formatCurrency(newBalance)}`;
        alert('Bonus Rp 200 berhasil diklaim!');
        claimBtn.textContent = 'Bonus sudah diklaim hari ini';
    } catch(error) {
        console.error("Error claiming bonus:", error);
        alert('Gagal mengklaim bonus.');
        claimBtn.disabled = false;
    }
}

async function handleDepositRequest(e) {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const amount = parseInt((form.elements.namedItem('depositAmount') as HTMLInputElement).value);
    const bankName = (form.elements.namedItem('bankName') as HTMLInputElement).value;
    const senderName = (form.elements.namedItem('senderName') as HTMLInputElement).value;
    
    if (!amount || !bankName || !senderName) {
        alert("Harap isi semua kolom.");
        return;
    }

    await db.collection("transactions").add({
        userId: currentUser.uid,
        userPhoneNumber: currentUser.phoneNumber,
        type: 'deposit',
        amount: amount,
        details: { bankName, senderName },
        status: 'pending',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    
    alert('Permintaan deposit Anda telah dikirim dan akan diproses oleh admin.');
    form.reset();
    hide(document.getElementById('wallet-modal-overlay'));
}

async function handleWithdrawRequest(e) {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const amount = parseInt((form.elements.namedItem('withdrawAmount') as HTMLInputElement).value);
    
    if (amount > currentUserData.balance) {
        alert('Saldo tidak mencukupi untuk penarikan.');
        return;
    }

    await db.collection("transactions").add({
        userId: currentUser.uid,
        userPhoneNumber: currentUser.phoneNumber,
        type: 'withdrawal',
        amount: amount,
        status: 'pending',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    alert('Permintaan penarikan Anda telah dikirim dan akan diproses oleh admin.');
    form.reset();
    hide(document.getElementById('wallet-modal-overlay'));
}


function setupSubscriptionModal() {
    const modal = document.getElementById('subscription-modal-overlay');
    const closeBtn = document.getElementById('close-subscription-modal-btn');
    
    closeBtn.addEventListener('click', () => hide(modal));

    document.querySelectorAll('.package-card').forEach(card => {
        card.addEventListener('click', async () => {
            const plan = (card as HTMLElement).dataset.plan;
            const pkg = PACKAGES[plan];
            if (currentUserData.balance < pkg.price) {
                alert(`Saldo tidak cukup. Saldo Anda ${formatCurrency(currentUserData.balance)}, harga paket ${formatCurrency(pkg.price)}.`);
                return;
            }
            if (confirm(`Anda akan membeli ${pkg.name} seharga ${formatCurrency(pkg.price)} menggunakan saldo Anda. Lanjutkan?`)) {
                await purchaseSubscriptionWithBalance(plan);
            }
        });
    });
}

async function purchaseSubscriptionWithBalance(plan) {
    const pkg = PACKAGES[plan];
    const newBalance = currentUserData.balance - pkg.price;
    const newExpiryDate = new Date();
    newExpiryDate.setDate(newExpiryDate.getDate() + pkg.durationDays);
    const newExpiryTimestamp = firebase.firestore.Timestamp.fromDate(newExpiryDate);

    const userRef = db.collection("users").doc(currentUser.uid);
    const transactionRef = db.collection("transactions").doc(); // Create new ref for transaction
    const batch = db.batch();

    // Update user's balance and subscription
    batch.update(userRef, {
        balance: newBalance,
        subscription: { plan, expiresAt: newExpiryTimestamp }
    });

    // Create a new transaction record for the purchase
    batch.set(transactionRef, {
        userId: currentUser.uid,
        userPhoneNumber: currentUser.phoneNumber,
        type: 'subscription',
        plan: plan,
        amount: pkg.price,
        status: 'approved', // Direct purchase with balance is auto-approved
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    
    // Commit both operations atomically
    await batch.commit();

    // Update local state consistently with Firestore data type
    currentUserData.balance = newBalance;
    currentUserData.subscription = { plan, expiresAt: newExpiryTimestamp };

    (document.getElementById('user-balance') as HTMLSpanElement).textContent = `Saldo: ${formatCurrency(newBalance)}`;

    alert(`${pkg.name} berhasil diaktifkan!`);
    hide(document.getElementById('subscription-modal-overlay'));
}

// =================================================================
// GENERAL & GENERATOR EVENT LISTENERS / LOGIC
// =================================================================
function setupGeneralEventListeners() {
    document.getElementById('input-area').addEventListener('submit', handleSendMessage);
    setupSubscriptionModal();

    document.querySelectorAll('.feature-card').forEach(card => {
        card.addEventListener('click', () => handleFeatureClick(card as HTMLElement));
    });
    
    document.getElementById('back-to-main-menu').addEventListener('click', () => {
        hide(document.getElementById('video-submenu-container'));
        show(document.getElementById('welcome-container'));
        show(document.getElementById('messages-container'));
    });
}

function hasActiveSubscription() {
    const sub = currentUserData?.subscription;
    if (!sub || !sub.expiresAt) return false;
    // `expiresAt` is expected to be a Firestore Timestamp object.
    const expiryDate = (sub.expiresAt as firebase.firestore.Timestamp).toDate();
    return expiryDate.getTime() > Date.now();
}

function handleFeatureClick(card: HTMLElement) {
    const featureKey = card.dataset.feature;
    const requiresSubscription = card.dataset.requiresSubscription === 'true';

    if (currentUserData.isBlocked) {
        alert("Akun Anda diblokir.");
        return;
    }

    if (featureKey === 'video_menu') {
        hideAllViews();
        show(document.getElementById('video-submenu-container'));
        show(document.getElementById('messages-container'));
        return;
    }

    if (requiresSubscription && !hasActiveSubscription()) {
        show(document.getElementById('subscription-modal-overlay'));
        return;
    }
    
    hideAllViews();
    
    if (featureKey === 'dalle') showDalleGenerator();
    else if (featureKey === 'veo3') showVeoGenerator();
    else if (featureKey === 'image_prompt') showImageGenerator();
    else if (featureKey === 'olshop') showOlshopView();
    else {
        startChatSession(featureKey);
    }
}

function startChatSession(featureKey) {
    const feature = FEATURE_CONFIG[featureKey];
    if (!feature) return;
  
    show(document.getElementById('messages-container'));
    show(document.getElementById('input-area'));
  
    const messageInput = document.getElementById('message-input') as HTMLInputElement;
    const sendButton = document.getElementById('send-button') as HTMLButtonElement;
  
    messageInput.disabled = false;
    sendButton.disabled = false;
    messageInput.placeholder = `Kirim pesan ke ${feature.name}...`;
    messageInput.focus();
  
    messages = [{
      text: feature.welcomeMessage,
      sender: 'bot',
      senderName: feature.name
    }];
    // Store system instruction in a way that handleSendMessage can access it
    (messages as any).systemInstruction = feature.systemInstruction;
    
    renderMessagesUI();
}

async function handleSendMessage(e) {
    e.preventDefault();
    const messageInput = document.getElementById('message-input') as HTMLInputElement;
    const text = messageInput.value.trim();
    if (!text || isLoading || messages.length === 0) return;

    const userMessage = { text, sender: 'user' };
    messages.push(userMessage);
    const currentHistory = messages.slice(0, -1); // History is everything BEFORE the new message

    messageInput.value = '';
    isLoading = true;
    renderMessagesUI();

    try {
        const systemInstruction = (messages as any).systemInstruction || 'You are a helpful assistant.';
        const response = await fetch('/api/gemini', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'gemini-2.5-flash',
                history: currentHistory.map(m => ({ text: m.text, sender: m.sender })),
                newMessage: text,
                config: { systemInstruction }
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Network response was not ok');
        }

        const geminiResponse = await response.json();
        const featureName = messages[0]?.senderName;
        messages.push({ text: geminiResponse.text, sender: 'bot', senderName: featureName });
    } catch (error) {
      console.error('Error sending message:', error);
      messages.push({ text: 'Maaf, terjadi kesalahan.', sender: 'bot', senderName: 'Sistem' });
    } finally {
      isLoading = false;
      renderMessagesUI();
    }
}


function renderMessagesUI() {
    const messagesContainer = document.getElementById('messages-container');
    const loadingIndicatorContainer = document.getElementById('loading-indicator-container');
    
    if (messages.length > 0) {
        hide(document.getElementById('welcome-container'));
    }

    messagesContainer.innerHTML = '';
    messages.forEach(msg => {
      const msgDiv = document.createElement('div');
      msgDiv.className = `message ${msg.sender}`;
      if (msg.sender === 'bot') {
        msgDiv.innerHTML = `<div class="sender">${msg.senderName || 'Bot'}</div>${msg.text}`;
      } else {
        msgDiv.textContent = msg.text;
      }
      messagesContainer.appendChild(msgDiv);
    });
    
    messagesContainer.appendChild(loadingIndicatorContainer);

    if (isLoading) {
      loadingIndicatorContainer.innerHTML = `<div class="message bot"><div class="loading-indicator"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div></div>`;
    } else {
      loadingIndicatorContainer.innerHTML = '';
    }
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function hideAllViews() {
  hide(document.getElementById('messages-container'));
  hide(document.getElementById('input-area'));
  hide(document.getElementById('welcome-container'));
  hide(document.getElementById('video-submenu-container'));
  hide(document.getElementById('dalle-generator-container'));
  hide(document.getElementById('veo-generator-container'));
  hide(document.getElementById('image-generator-container'));
  hide(document.getElementById('olshop-container'));
  hide(document.getElementById('product-detail-container'));
  hide(document.getElementById('checkout-page'));
  show(document.getElementById('main-content')); // Ensure main content area is visible
}

function showDalleGenerator() {
    show(document.getElementById('dalle-generator-container'));
    updateDallePromptDisplay();
}

function showVeoGenerator() {
    show(document.getElementById('veo-generator-container'));
    updateVeoPromptDisplay();
}

function showImageGenerator() {
    show(document.getElementById('image-generator-container'));
    updateImagePromptDisplay();
}

function setupGeneratorEventListeners() {
    // --- Image Generator ---
    const imageBackButton = document.getElementById('image-back-button');
    imageBackButton.addEventListener('click', () => { hideAllViews(); show(document.getElementById('welcome-container')); show(document.getElementById('messages-container')); });
    document.getElementById('image-generate-scenes-btn').addEventListener('click', () => handleGenerateScenes('image'));
    document.getElementById('image-copy-btn').addEventListener('click', () => handleCopyToClipboard('image'));
    document.querySelectorAll('#image-generator-container textarea, #image-generator-container input').forEach(el => {
        el.addEventListener('input', updateImagePromptDisplay);
    });

    // --- DALL-E Generator ---
    const dalleBackButton = document.getElementById('dalle-back-button');
    dalleBackButton.addEventListener('click', () => { hideAllViews(); show(document.getElementById('video-submenu-container')); show(document.getElementById('messages-container')); });
    document.getElementById('dalle-generate-scenes-btn').addEventListener('click', () => handleGenerateScenes('dalle'));
    document.getElementById('dalle-copy-btn').addEventListener('click', () => handleCopyToClipboard('dalle'));
    document.querySelectorAll('#dalle-generator-container textarea, #dalle-generator-container input').forEach(el => {
        el.addEventListener('input', updateDallePromptDisplay);
    });
    
    // --- VEO Generator ---
    const veoBackButton = document.getElementById('veo-back-button');
    veoBackButton.addEventListener('click', () => { hideAllViews(); show(document.getElementById('video-submenu-container')); show(document.getElementById('messages-container')); });
    document.getElementById('veo-generate-scenes-btn').addEventListener('click', () => handleGenerateScenes('veo'));
    document.getElementById('veo-copy-btn').addEventListener('click', () => handleCopyToClipboard('veo'));
    document.querySelectorAll('#veo-generator-container textarea, #veo-generator-container input').forEach(el => {
        el.addEventListener('input', updateVeoPromptDisplay);
    });
}

// --- Generic Generator Logic ---
const getGeneratorElements = (type) => {
    return {
        storyConcept: document.getElementById(`${type}-story-concept`) as HTMLInputElement,
        errorMessage: document.getElementById(`${type}-error-message`),
        generateBtnContent: document.getElementById(`${type}-generate-btn-content`),
        generateBtnLoading: document.getElementById(`${type}-generate-btn-loading`),
        generateScenesBtn: document.getElementById(`${type}-generate-scenes-btn`) as HTMLButtonElement,
        sceneInputs: document.querySelectorAll(`.${type}-scene-input`),
        promptOutput: document.getElementById(`${type}-prompt-output`),
        copyBtnDefault: document.getElementById(`${type}-copy-btn-default`),
        copyBtnSuccess: document.getElementById(`${type}-copy-btn-success`),
    };
};

const updateImagePromptDisplay = () => {
    const mainSubject = (document.getElementById('image-character-desc') as HTMLTextAreaElement).value.trim();
    const styleDetails = (document.getElementById('image-clothing-desc') as HTMLTextAreaElement).value.trim();
    const scenes = Array.from(document.querySelectorAll('.image-scene-input')).map(input => (input as HTMLInputElement).value.trim());
    let promptParts = [mainSubject || '[SUBJEK UTAMA]'];
    if (styleDetails) promptParts.push(styleDetails);
    const details = scenes.filter(Boolean);
    if (details.length > 0) promptParts.push(...details);
    (document.getElementById('image-prompt-output') as HTMLElement).textContent = promptParts.join(', ');
};
const updateDallePromptDisplay = () => {
    const charDesc = (document.getElementById('dalle-character-desc') as HTMLTextAreaElement).value.trim();
    const clothingDesc = (document.getElementById('dalle-clothing-desc') as HTMLTextAreaElement).value.trim();
    const scenes = Array.from(document.querySelectorAll('.dalle-scene-input')).map(input => (input as HTMLInputElement).value.trim());
    const fullCharDesc = [charDesc, clothingDesc].filter(Boolean).join(', ');
    let prompt = `photo collage of a ${fullCharDesc || '[CHARACTER]'}. 4 panels. consistent character, same person. cinematic, high detail.`;
    scenes.forEach((scene, index) => { if (scene) { prompt += `\n\n-- Panel ${index + 1}: ${scene}`; } });
    (document.getElementById('dalle-prompt-output') as HTMLElement).textContent = prompt;
};
const updateVeoPromptDisplay = () => {
    const charDesc = (document.getElementById('veo-character-desc') as HTMLTextAreaElement).value.trim();
    const clothingDesc = (document.getElementById('veo-clothing-desc') as HTMLTextAreaElement).value.trim();
    const scenes = Array.from(document.querySelectorAll('.veo-scene-input')).map(input => (input as HTMLInputElement).value.trim());
    const fullCharDesc = [charDesc, clothingDesc].filter(Boolean).join(', ');
    let prompt = `Cinematic video of a ${fullCharDesc || '[CHARACTER]'}. A sequence of 4 shots. The character must be consistent. Style: photorealistic, high detail, 16:9 aspect ratio.`;
    scenes.forEach((scene, index) => { if (scene) { prompt += `\n\n-- Shot ${index + 1}: ${scene}`; } });
    (document.getElementById('veo-prompt-output') as HTMLElement).textContent = prompt;
};

const handleGenerateScenes = async (type) => {
    const els = getGeneratorElements(type);
    const storyConcept = els.storyConcept.value.trim();
    if (!storyConcept) {
        els.errorMessage.textContent = 'Silakan masukkan konsep terlebih dahulu.';
        return;
    }
    els.errorMessage.textContent = '';
    hide(els.generateBtnContent);
    show(els.generateBtnLoading);
    els.generateScenesBtn.disabled = true;

    const schema = { type: Type.OBJECT, properties: { scenes: { type: Type.ARRAY, description: "Array of 4 distinct descriptions.", items: { type: Type.STRING } } }};
    
    let prompt = '';
    switch (type) {
        case 'image':
            prompt = `Based on the image concept "${storyConcept}", generate 4 short, distinct, and visual descriptions to be combined into a detailed image prompt. The 4 descriptions should cover: 1. A specific action or pose of the subject. 2. The background or environment details. 3. Key colors or lighting style. 4. The overall composition or art style (e.g., 'digital art', 'close-up shot').`;
            break;
        case 'dalle':
            prompt = `Based on the story concept "${storyConcept}", generate 4 short scene descriptions for a 4-panel photo collage. Each scene should describe a distinct moment or angle. Ensure the descriptions are visual and can be rendered in a single panel.`;
            break;
        case 'veo':
            prompt = `Based on the video concept "${storyConcept}", generate 4 short shot descriptions for a cinematic video sequence. Each description should represent a consecutive shot. Describe camera movement (e.g., tracking shot, wide shot), character action, or key environmental details for each shot.`;
            break;
        default:
            prompt = `Based on the concept "${storyConcept}", generate 4 short, distinct descriptions for a prompt.`;
            break;
    }

    try {
        const response = await fetch('/api/gemini', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'gemini-2.5-flash',
                contents: prompt,
                config: { responseMimeType: 'application/json', responseSchema: schema }
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Network response was not ok');
        }

      const geminiResponse = await response.json();
      const jsonResponse = JSON.parse(geminiResponse.text);
      if (jsonResponse.scenes && jsonResponse.scenes.length >= 4) {
        els.sceneInputs.forEach((input, index) => { (input as HTMLInputElement).value = jsonResponse.scenes[index] || ''; });
        if(type === 'image') updateImagePromptDisplay();
        else if(type === 'dalle') updateDallePromptDisplay();
        else if(type === 'veo') updateVeoPromptDisplay();
      } else { throw new Error("AI response did not contain 4 items."); }
    } catch (error) {
      console.error(`Error generating ${type} scenes:`, error);
      els.errorMessage.textContent = 'Gagal membuat detail. Silakan coba lagi.';
    } finally {
      show(els.generateBtnContent);
      hide(els.generateBtnLoading);
      els.generateScenesBtn.disabled = false;
    }
};

const handleCopyToClipboard = (type) => {
    const els = getGeneratorElements(type);
    navigator.clipboard.writeText(els.promptOutput.textContent)
      .then(() => {
        hide(els.copyBtnDefault);
        show(els.copyBtnSuccess);
        setTimeout(() => { show(els.copyBtnDefault); hide(els.copyBtnSuccess); }, 2000);
      }).catch(err => { console.error('Failed to copy text: ', err); alert('Gagal menyalin prompt.'); });
};

// =================================================================
// OLSHOP FEATURE
// =================================================================
function setupOlshopEventListeners() {
    document.getElementById('olshop-back-to-main').addEventListener('click', () => {
        hideAllViews();
        show(document.getElementById('welcome-container'));
        show(document.getElementById('messages-container'));
    });
    
    document.getElementById('close-order-form-btn').addEventListener('click', () => hide(document.getElementById('order-form-overlay')));
    document.getElementById('show-order-history-btn').addEventListener('click', showOrderHistory);
    document.getElementById('close-order-history-btn').addEventListener('click', () => hide(document.getElementById('order-history-overlay')));
    
    document.getElementById('product-detail-back-btn').addEventListener('click', () => {
        hide(document.getElementById('product-detail-container'));
        show(document.getElementById('olshop-container'));
    });

    document.getElementById('checkout-back-btn').addEventListener('click', () => {
        hide(document.getElementById('checkout-page'));
        show(document.getElementById('product-detail-container'));
    });
}

function showOlshopView() {
    show(document.getElementById('olshop-container'));
    loadAndRenderProducts();
}

async function loadAndRenderProducts() {
    const productListEl = document.getElementById('product-list');
    productListEl.innerHTML = '<p>Memuat produk...</p>';

    try {
        const productQuery = db.collection('products');
        const snapshot = await productQuery.get();
        if (snapshot.empty) {
            productListEl.innerHTML = '<p>Belum ada produk yang tersedia.</p>';
            return;
        }

        let productsHtml = '';
        snapshot.forEach(doc => {
            const product = doc.data();
            const shortDescription = product.description.length > 100 
                ? product.description.substring(0, 100) + '...' 
                : product.description;

            productsHtml += `
                <div class="product-card" data-id="${doc.id}" role="button" tabindex="0">
                    <img src="${product.imageUrl}" alt="${product.name}">
                    <div class="product-card-content">
                        <h3>${product.name}</h3>
                        <p class="price">${formatCurrency(product.price)}</p>
                        <p class="description">${shortDescription}</p>
                    </div>
                </div>
            `;
        });
        productListEl.innerHTML = productsHtml;

        productListEl.querySelectorAll('.product-card').forEach(card => {
            card.addEventListener('click', () => {
                const productId = (card as HTMLElement).dataset.id;
                showProductDetail(productId);
            });
        });

    } catch (error) {
        console.error("Error loading products:", error);
        productListEl.innerHTML = '<p>Gagal memuat produk. Coba lagi nanti.</p>';
    }
}

async function showProductDetail(productId: string) {
    hide(document.getElementById('olshop-container'));
    const detailContainer = document.getElementById('product-detail-container');
    const contentEl = document.getElementById('product-detail-content');
    contentEl.innerHTML = '<p>Memuat detail produk...</p>';
    show(detailContainer);

    try {
        const docRef = db.collection('products').doc(productId);
        const docSnap = await docRef.get();

        if (!docSnap.exists) {
            throw new Error("Produk tidak ditemukan.");
        }

        const product = docSnap.data();
        const ratingValue = 4; // Static rating
        const starTotal = 5;
        const starsHtml = '★'.repeat(ratingValue) + '☆'.repeat(starTotal - ratingValue);
        
        let optionsHtml = '';
        if (product.category === 'fashion') {
            if (product.colors && product.colors.length > 0) {
                optionsHtml += `<div class="form-group"><label for="product-color">Pilih Warna</label><select id="product-color">${product.colors.map(c => `<option value="${c}">${c}</option>`).join('')}</select></div>`;
            }
            if (product.sizes && product.sizes.length > 0) {
                optionsHtml += `<div class="form-group"><label for="product-size">Pilih Ukuran</label><select id="product-size">${product.sizes.map(s => `<option value="${s}">${s}</option>`).join('')}</select></div>`;
            }
        }

        if (product.category !== 'digital') {
            optionsHtml += `<div class="form-group"><label for="product-quantity">Jumlah</label><input type="number" id="product-quantity" value="1" min="1"></div>`;
        }

        contentEl.innerHTML = `
            <img src="${product.imageUrl}" alt="${product.name}" class="product-detail-image">
            <div class="product-detail-info">
                <h2>${product.name}</h2>
                <p class="price">${formatCurrency(product.price)}</p>
                <div class="rating">
                    <span class="stars">${starsHtml}</span>
                    <span class="rating-text">${ratingValue}.0 / ${starTotal}.0</span>
                </div>
                <p>${product.description}</p>
            </div>
            <div class="product-options-container">
                ${optionsHtml}
            </div>
            <div class="product-detail-actions">
                <button id="add-to-cart-btn" class="btn-secondary">Tambahkan Keranjang</button>
                <button id="buy-now-btn" class="btn-primary">Beli Sekarang</button>
            </div>
        `;

        document.getElementById('add-to-cart-btn').addEventListener('click', () => {
            alert(`"${product.name}" telah ditambahkan ke keranjang! (Fitur keranjang sedang dalam pengembangan)`);
        });

        document.getElementById('buy-now-btn').addEventListener('click', () => {
            handleBuyClick(productId, product);
        });

    } catch (error) {
        console.error("Error showing product detail:", error);
        contentEl.innerHTML = `<p>Gagal memuat detail produk. ${error.message}</p>`;
    }
}

async function handleBuyClick(productId: string, productData: any) {
    try {
        const selectedOptions: any = {
            productId: productId,
            productName: productData.name,
            productPrice: productData.price,
            imageUrl: productData.imageUrl,
            category: productData.category
        };

        let quantity = 1;
        if (productData.category !== 'digital') {
            const qtyEl = document.getElementById('product-quantity') as HTMLInputElement;
            quantity = parseInt(qtyEl.value) || 1;
        }
        selectedOptions.quantity = quantity;

        if (productData.category === 'fashion') {
            const colorEl = document.getElementById('product-color') as HTMLSelectElement;
            const sizeEl = document.getElementById('product-size') as HTMLSelectElement;
            if (colorEl) selectedOptions.color = colorEl.value;
            if (sizeEl) selectedOptions.size = sizeEl.value;
        }

        checkoutItem = selectedOptions;
        showCheckoutPage();

    } catch (error) {
        console.error("Error preparing for checkout:", error);
        alert("Gagal memproses, silakan coba lagi.");
    }
}

function showCheckoutPage() {
    hideAllViews();
    show(document.getElementById('checkout-page'));
    
    // Reset form
    (document.getElementById('shipping-form') as HTMLFormElement).reset();
    const proofInput = document.getElementById('checkout-payment-proof-input') as HTMLInputElement;
    const proofPreview = document.getElementById('checkout-payment-proof-preview') as HTMLImageElement;
    const proofLabel = proofInput.nextElementSibling as HTMLLabelElement;
    proofInput.value = '';
    hide(proofPreview);
    proofLabel.textContent = 'Pilih File...';

    // Populate user data
    (document.getElementById('shipping-name') as HTMLInputElement).value = currentUserData.displayName || '';
    (document.getElementById('shipping-phone') as HTMLInputElement).value = currentUser.phoneNumber || '';
    
    // Render product summary
    const summaryContainer = document.getElementById('checkout-items-summary');
    summaryContainer.innerHTML = `
        <div class="checkout-item-summary">
            <img src="${checkoutItem.imageUrl}" alt="${checkoutItem.productName}">
            <div class="checkout-item-summary-info">
                <h4>${checkoutItem.productName}</h4>
                <p>
                    ${checkoutItem.color ? `Warna: ${checkoutItem.color}` : ''}
                    ${checkoutItem.size ? `, Ukuran: ${checkoutItem.size}` : ''}
                </p>
                <p>Jumlah: ${checkoutItem.quantity}</p>
            </div>
            <span class="checkout-item-summary-price">${formatCurrency(checkoutItem.productPrice * checkoutItem.quantity)}</span>
        </div>
    `;

    // Reset and calculate totals
    cekOngkir(); // Initial check

    // Setup event listeners
    document.getElementById('shipping-provinsi').addEventListener('input', cekOngkir);
    document.getElementById('shipping-kota').addEventListener('input', cekOngkir);
    document.getElementById('shipping-kecamatan').addEventListener('input', cekOngkir);
    
    proofInput.addEventListener('change', () => {
        if (proofInput.files && proofInput.files[0]) {
            const file = proofInput.files[0];
            const reader = new FileReader();
            reader.onload = (e) => {
                proofPreview.src = e.target.result as string;
                show(proofPreview);
            };
            reader.readAsDataURL(file);
            proofLabel.textContent = file.name;
        }
    });

    document.getElementById('place-order-btn').onclick = placeOrder; // Use onclick to easily overwrite
}

function cekOngkir() {
    const shippingEl = document.getElementById('checkout-shipping');
    const provinsi = (document.getElementById('shipping-provinsi') as HTMLInputElement).value.trim();
    const kota = (document.getElementById('shipping-kota') as HTMLInputElement).value.trim();
    const kecamatan = (document.getElementById('shipping-kecamatan') as HTMLInputElement).value.trim();

    if (checkoutItem.category === 'digital') {
        shippingEl.textContent = formatCurrency(0);
        shippingEl.dataset.cost = "0";
        shippingEl.classList.remove('not-calculated');
    } else if (provinsi && kota && kecamatan) {
        shippingEl.textContent = formatCurrency(SHIPPING_COST);
        shippingEl.dataset.cost = String(SHIPPING_COST);
        shippingEl.classList.remove('not-calculated');
    } else {
        shippingEl.textContent = 'Isi provinsi, kota, dan kecamatan';
        shippingEl.dataset.cost = "0";
        shippingEl.classList.add('not-calculated');
    }
    updateCheckoutTotal();
}

function updateCheckoutTotal() {
    const subtotal = checkoutItem.productPrice * checkoutItem.quantity;
    const shippingCost = parseInt(document.getElementById('checkout-shipping').dataset.cost || "0");
    const total = subtotal + shippingCost;

    document.getElementById('checkout-subtotal').textContent = formatCurrency(subtotal);
    document.getElementById('checkout-total').textContent = formatCurrency(total);
}

async function placeOrder() {
    const form = document.getElementById('shipping-form') as HTMLFormElement;
    if (!form.checkValidity()) {
        alert('Harap isi semua field alamat pengiriman yang wajib diisi.');
        form.reportValidity();
        return;
    }

    const proofInput = document.getElementById('checkout-payment-proof-input') as HTMLInputElement;
    if (!proofInput.files || proofInput.files.length === 0) {
        alert('Harap unggah bukti pembayaran.');
        return;
    }

    const placeOrderBtn = document.getElementById('place-order-btn') as HTMLButtonElement;
    placeOrderBtn.disabled = true;
    placeOrderBtn.textContent = 'Memproses...';

    try {
        const formData = new FormData(form);
        const shippingDetails = {
            name: formData.get('nama'),
            phone: formData.get('telepon'),
            province: formData.get('provinsi'),
            city: formData.get('kota'),
            district: formData.get('kecamatan'),
            village: formData.get('desa'),
            rt: formData.get('rt'),
            rw: formData.get('rw'),
            postalCode: formData.get('kodepos'),
            fullAddress: formData.get('alamat'),
        };
        
        // Upload proof
        placeOrderBtn.textContent = 'Mengunggah...';
        const proofFile = proofInput.files[0];
        const timestamp = Date.now();
        const fileName = `${currentUser.uid}_${timestamp}_${proofFile.name.replace(/\s/g, '_')}`;
        const storageRef = storage.ref(`payment_proofs/${fileName}`);
        const uploadTask = await storageRef.put(proofFile);
        const downloadURL = await uploadTask.ref.getDownloadURL();
        
        placeOrderBtn.textContent = 'Menyimpan...';
        
        // Prepare order data
        const subtotal = checkoutItem.productPrice * checkoutItem.quantity;
        const shippingCost = parseInt(document.getElementById('checkout-shipping').dataset.cost || "0");
        const total = subtotal + shippingCost;
        
        const orderData = {
            userId: currentUser.uid,
            userPhoneNumber: currentUser.phoneNumber,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            status: 'processing',
            paymentProofUrl: downloadURL,
            items: [checkoutItem], // Store as an array for future multi-item carts
            subtotal: subtotal,
            shippingCost: shippingCost,
            totalPrice: total,
            shippingDetails: shippingDetails
        };
        
        // Save to firestore
        await db.collection('orders').add(orderData);
        
        alert('Pesanan berhasil dibuat dan akan segera diproses!');
        hideAllViews();
        showOlshopView();

    } catch (error) {
        console.error("Error placing order:", error);
        alert('Gagal membuat pesanan: ' + error.message);
    } finally {
        placeOrderBtn.disabled = false;
        placeOrderBtn.textContent = 'Buat Pesanan';
    }
}


async function showOrderHistory() {
    const historyListEl = document.getElementById('order-history-list');
    historyListEl.innerHTML = '<p>Memuat riwayat pesanan...</p>';
    show(document.getElementById('order-history-overlay'));

    try {
        const q = db.collection('orders')
            .where('userId', '==', currentUser.uid)
            .orderBy('createdAt', 'desc');
            
        const snapshot = await q.get();

        if (snapshot.empty) {
            historyListEl.innerHTML = '<p>Anda belum memiliki riwayat pesanan.</p>';
            return;
        }

        let historyHtml = '';
        snapshot.forEach(doc => {
            const order = doc.data();
            const statusText = ORDER_STATUSES[order.status] || 'Unknown';
            
            let productDetails = '';
            if (order.items && order.items.length > 0) {
                 productDetails = order.items.map(item => {
                    let details = `<h4>${item.productName}</h4>`;
                     if (item.color) details += `<p><small>Warna: ${item.color}</small></p>`;
                     if (item.size) details += `<p><small>Ukuran: ${item.size}</small></p>`;
                     if (item.quantity > 1) details += `<p><small>Jumlah: ${item.quantity}</small></p>`;
                     return details;
                 }).join('');
            } else { // fallback for old data structure
                productDetails = `<h4>${order.productName}</h4>`;
            }


            historyHtml += `
                <div class="order-history-item">
                    ${productDetails}
                    <p>Tanggal: ${formatDate(order.createdAt)}</p>
                    <p>Total: ${formatCurrency(order.totalPrice || order.productPrice)}</p>
                    <p>Status: <span class="status ${order.status}">${statusText}</span></p>
                </div>
            `;
        });
        historyListEl.innerHTML = historyHtml;

    } catch (error) {
        console.error("Error fetching order history:", error);
        historyListEl.innerHTML = '<p>Gagal memuat riwayat pesanan.</p>';
    }
}
