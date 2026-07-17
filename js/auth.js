// js/auth.js — thin wrapper around Firebase Auth for the admin dashboard.
import { auth } from "./firebase-config.js";
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

/** Signs an admin in with email + password. Throws on failure. */
export function login(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export function logout() {
  return signOut(auth);
}

export function resetPassword(email) {
  return sendPasswordResetEmail(auth, email);
}

/**
 * Subscribes to auth state. Calls back with the Firebase user (or null).
 * Returns the unsubscribe function.
 */
export function watchAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

/** Friendly copy for common Firebase Auth error codes. */
export function describeAuthError(err) {
  const code = err?.code || "";
  const map = {
    "auth/invalid-email": "That doesn't look like a valid email address.",
    "auth/user-disabled": "This admin account has been disabled.",
    "auth/user-not-found": "No admin account matches that email.",
    "auth/wrong-password": "Incorrect password. Try again or reset it.",
    "auth/invalid-credential": "Incorrect email or password.",
    "auth/too-many-requests": "Too many attempts. Please wait a moment and try again.",
    "auth/network-request-failed": "Network error — check your connection.",
  };
  return map[code] || "Sign-in failed. Please try again.";
}
