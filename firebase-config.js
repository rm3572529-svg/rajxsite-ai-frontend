/**
 * firebase-config.js
 * RajXSite AI — Firebase v10 Modular SDK
 * Place this file in the SAME folder as index.html.
 * Add this BEFORE your main script in index.html:
 *   <script type="module" src="firebase-config.js"></script>
 *
 * All auth functions are attached to window so non-module
 * inline onclick="" handlers can call them directly.
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  setPersistence,
  browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  collection,
  query,
  where,
  orderBy,
  getDocs,
  deleteDoc,
  serverTimestamp,
  increment,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ─────────────────────────────────────────────
// 1. FIREBASE CONFIG
// ─────────────────────────────────────────────
const firebaseConfig = {
  apiKey:            "AIzaSyAVGgXu7t0CiUJfM9PFWTH-cn2rUvDK7qg",
  authDomain:        "rajxsite-ai.firebaseapp.com",
  projectId:         "rajxsite-ai",
  storageBucket:     "rajxsite-ai.firebasestorage.app",
  messagingSenderId: "937509314343",
  appId:             "1:937509314343:web:ae27430fc900fbef495302",
};

// ─────────────────────────────────────────────
// 2. INIT APP, AUTH, FIRESTORE
// ─────────────────────────────────────────────
const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// Persist login across browser refresh / tab close
await setPersistence(auth, browserLocalPersistence);

// ─────────────────────────────────────────────
// 3. ADMIN EMAIL LIST (extend as needed)
// ─────────────────────────────────────────────
const ADMIN_EMAILS = ["admin@rajxsite.com", "rajxsite@gmail.com"];

// ─────────────────────────────────────────────
// 4. HELPER — write / merge user doc in Firestore
// ─────────────────────────────────────────────
async function persistUserProfile(firebaseUser, extraFields = {}) {
  const ref = doc(db, "users", firebaseUser.uid);
  const snap = await getDoc(ref);

  const base = {
    uid:        firebaseUser.uid,
    email:      firebaseUser.email || "",
    name:       firebaseUser.displayName || extraFields.name || firebaseUser.email?.split("@")[0] || "User",
    photoURL:   firebaseUser.photoURL || "",
    lastActive: serverTimestamp(),
  };

  if (!snap.exists()) {
    // First-time registration
    await setDoc(ref, { ...base, totalSites: 0, blocked: false, createdAt: serverTimestamp(), ...extraFields });
  } else {
    // Returning user — update activity only
    await setDoc(ref, { lastActive: serverTimestamp(), ...extraFields }, { merge: true });
  }
}

// ─────────────────────────────────────────────
// 5. HELPER — load user's sites from Firestore
// ─────────────────────────────────────────────
async function loadUserSites(uid) {
  try {
    const q   = query(
      collection(db, "websites"),
      where("userId", "==", uid),
      orderBy("createdAt", "desc")
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => {
      const data = d.data();
      return {
        id:        d.id,
        ...data,
        createdAt: data.createdAt?.toDate?.()?.toISOString?.() ?? null,
        url:       data.deployedUrl || data.url || "",
      };
    });
  } catch {
    // Index not ready or network issue — return empty
    return [];
  }
}

// ─────────────────────────────────────────────
// 6. CORE — called after every successful login
// ─────────────────────────────────────────────
async function onLoginSuccess(firebaseUser) {
  // Normalise user object for the rest of the app
  const user = {
    uid:      firebaseUser.uid,
    name:     firebaseUser.displayName || firebaseUser.email?.split("@")[0] || "User",
    email:    firebaseUser.email || "",
    photoURL: firebaseUser.photoURL || "",
    provider: firebaseUser.providerData?.[0]?.providerId || "password",
  };

  // Write to Firestore
  await persistUserProfile(firebaseUser);

  // Put into app state
  window.state.currentUser = user;
  window.state.isAdmin     = ADMIN_EMAILS.includes(user.email);
  window.state.sites       = await loadUserSites(user.uid);

  // Update UI
  const nameEl   = document.getElementById("userName");
  const emailEl  = document.getElementById("userEmail");
  const avatarEl = document.getElementById("userAvatar");
  const adminBtn = document.getElementById("adminBtn");

  if (nameEl)   nameEl.textContent   = user.name;
  if (emailEl)  emailEl.textContent  = user.email;
  if (avatarEl) avatarEl.textContent = user.name.charAt(0).toUpperCase();
  if (adminBtn) adminBtn.style.display = window.state.isAdmin ? "" : "none";

  window.updateNavForAuth(true);
  window.renderDashboard();
  window.showScreen("dashboard");
  window.showToast("✅ Welcome, " + user.name + "!", "success");
}

// ─────────────────────────────────────────────
// 7. AUTH FUNCTIONS — exposed on window
// ─────────────────────────────────────────────

/** Google Sign-in (popup) */
window.handleGoogleLogin = async function () {
  window.showToast("🔄 Connecting to Google...", "info");
  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    const result = await signInWithPopup(auth, provider);
    await onLoginSuccess(result.user);
  } catch (err) {
    console.error("[Google Login]", err);
    const msg = _friendlyError(err.code);
    window.showToast("❌ " + msg, "error");
  }
};

/** Email + Password Login */
window.handleEmailLogin = async function () {
  const email = document.getElementById("loginEmailInput")?.value?.trim();
  const pass  = document.getElementById("loginPasswordInput")?.value;

  if (!email || !pass) { window.showToast("⚠️ Enter email and password", "error"); return; }
  if (!_validEmail(email)) { window.showToast("⚠️ Invalid email format", "error"); return; }
  if (!window.checkRateLimit()) { window.showToast("⚠️ Too many attempts. Wait 1 min.", "error"); return; }

  window.showToast("🔄 Logging in...", "info");
  try {
    const cred = await signInWithEmailAndPassword(auth, email, pass);
    await onLoginSuccess(cred.user);
  } catch (err) {
    console.error("[Email Login]", err);
    window.showToast("❌ " + _friendlyError(err.code), "error");
  }
};

/** Email + Password Sign-up */
window.handleSignup = async function () {
  const name  = document.getElementById("signupName")?.value?.trim();
  const email = document.getElementById("signupEmail")?.value?.trim();
  const pass  = document.getElementById("signupPassword")?.value;

  if (!name || !email || !pass) { window.showToast("⚠️ Fill all fields", "error"); return; }
  if (pass.length < 6)          { window.showToast("⚠️ Password min 6 chars", "error"); return; }
  if (!_validEmail(email))      { window.showToast("⚠️ Invalid email", "error"); return; }

  window.showToast("🔄 Creating your account...", "info");
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);

    // Set display name in Firebase Auth profile
    await updateProfile(cred.user, { displayName: name });

    // Persist name to Firestore on first write
    await persistUserProfile(cred.user, { name });

    await onLoginSuccess(cred.user);
  } catch (err) {
    console.error("[Signup]", err);
    window.showToast("❌ " + _friendlyError(err.code), "error");
  }
};

/** Phone OTP — Step 1: send OTP */
window.handlePhoneOTP = async function (mode) {
  const phoneInput = document.getElementById("loginPhoneInput");
  const phone      = phoneInput?.value?.trim();

  if (!phone) { window.showToast("⚠️ Enter phone number", "error"); return; }

  try {
    // Render invisible reCAPTCHA (required by Firebase Phone Auth)
    if (!window._recaptchaVerifier) {
      window._recaptchaVerifier = new RecaptchaVerifier(auth, "recaptcha-login", {
        size: "invisible",
        callback: () => {},
      });
    }
    window.showToast("📱 Sending OTP...", "info");
    const confirmationResult = await signInWithPhoneNumber(auth, phone, window._recaptchaVerifier);
    window._confirmationResult = confirmationResult;

    // Show OTP input field
    const otpDiv = document.getElementById("loginOtpDiv");
    if (otpDiv) otpDiv.style.display = "";

    // Change button to verify mode
    const otpBtn = document.querySelector("#loginPhone .btn-primary");
    if (otpBtn) {
      otpBtn.textContent = "Verify OTP";
      otpBtn.onclick     = window.verifyPhoneOTP;
    }

    window.showToast("✅ OTP sent! Check your messages.", "success");
  } catch (err) {
    console.error("[Phone OTP]", err);
    window.showToast("❌ " + _friendlyError(err.code), "error");
    // Reset reCAPTCHA on failure
    if (window._recaptchaVerifier) {
      window._recaptchaVerifier.clear();
      window._recaptchaVerifier = null;
    }
  }
};

/** Phone OTP — Step 2: verify code */
window.verifyPhoneOTP = async function () {
  const code = document.getElementById("loginOtpInput")?.value?.trim();
  if (!code || code.length < 6) { window.showToast("⚠️ Enter 6-digit OTP", "error"); return; }

  window.showToast("🔄 Verifying OTP...", "info");
  try {
    const result = await window._confirmationResult.confirm(code);
    await onLoginSuccess(result.user);
  } catch (err) {
    console.error("[OTP Verify]", err);
    window.showToast("❌ " + _friendlyError(err.code), "error");
  }
};

/** Sign out */
window.logout = async function () {
  try {
    await signOut(auth);
    // onAuthStateChanged will handle state cleanup below
  } catch (err) {
    console.error("[Logout]", err);
    window.showToast("❌ Logout failed", "error");
  }
};

// ─────────────────────────────────────────────
// 8. AUTH STATE OBSERVER
//    This is the single source of truth.
//    Runs on every page load + every auth change.
// ─────────────────────────────────────────────
window.onAuthStateChangedFirebase = onAuthStateChanged;   // exposed for external use

onAuthStateChanged(auth, async (firebaseUser) => {
  // Hide the loading screen first
  const loader = document.getElementById("loadingScreen");
  if (loader) {
    loader.style.transition = "opacity 0.4s";
    loader.style.opacity    = "0";
    setTimeout(() => { loader.style.display = "none"; }, 450);
  }

  if (firebaseUser) {
    // User is signed in (either fresh login or persisted session)
    await onLoginSuccess(firebaseUser);
  } else {
    // User is signed out — reset state, show landing
    window.state.currentUser = null;
    window.state.isAdmin     = false;
    window.state.sites       = [];

    window.updateNavForAuth(false);
    window.showScreen("landing");
    window.showToast("👋 Logged out successfully", "info");
  }
});

// ─────────────────────────────────────────────
// 9. FIRESTORE SITE OPERATIONS
//    Override the localStorage-based stubs so
//    dashboard CRUD hits real Firestore.
// ─────────────────────────────────────────────

/** Delete a site from Firestore (called by deleteSite in main script) */
window.deleteSiteFromDB = async function (siteId) {
  await deleteDoc(doc(db, "websites", siteId));
};

/** Expose db so the main script can write new sites */
window.firestoreDB = db;
window.firestoreHelpers = {
  doc, setDoc, serverTimestamp, increment, collection, getDoc, getDocs, query, where, orderBy
};

// ─────────────────────────────────────────────
// 10. EXPOSE RAW FIREBASE REFS (for advanced use)
// ─────────────────────────────────────────────
window.firebaseAuth          = auth;
window.GoogleAuthProvider    = GoogleAuthProvider;
window.signInWithPopup       = signInWithPopup;
window.signInWithEmailAndPassword    = signInWithEmailAndPassword;
window.createUserWithEmailAndPassword = createUserWithEmailAndPassword;
window.signOut               = signOut;

// ─────────────────────────────────────────────
// 11. PRIVATE HELPERS
// ─────────────────────────────────────────────
function _validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function _friendlyError(code) {
  const map = {
    "auth/user-not-found":           "No account found with this email.",
    "auth/wrong-password":           "Incorrect password. Try again.",
    "auth/invalid-credential":       "Invalid email or password.",
    "auth/email-already-in-use":     "Email already registered. Please login.",
    "auth/weak-password":            "Password is too weak. Use 6+ characters.",
    "auth/invalid-email":            "Invalid email address.",
    "auth/too-many-requests":        "Too many attempts. Account temporarily locked.",
    "auth/network-request-failed":   "Network error. Check your connection.",
    "auth/popup-closed-by-user":     "Sign-in popup closed. Please try again.",
    "auth/popup-blocked":            "Popup blocked by browser. Allow popups and retry.",
    "auth/account-exists-with-different-credential":
                                     "Account exists with a different sign-in method.",
    "auth/invalid-verification-code":"Invalid OTP code. Please try again.",
    "auth/invalid-phone-number":     "Invalid phone number. Use international format (+91...).",
    "auth/missing-phone-number":     "Enter a phone number first.",
    "auth/quota-exceeded":           "SMS quota exceeded. Try later.",
    "auth/captcha-check-failed":     "reCAPTCHA check failed. Refresh and try again.",
  };
  return map[code] || "Something went wrong. Please try again.";
}

// Signal to the main (non-module) script that Firebase is fully ready
window._fbReady = true;
