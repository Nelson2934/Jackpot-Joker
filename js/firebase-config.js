// js/firebase-config.js
//
// Firebase is initialised once here and re-exported so every other module
// shares the same app/auth/db instances.
//
// NOTE ON SECURITY: a Firebase *web* config (apiKey, appId, etc.) is not a
// secret — it's a public client identifier, safe to ship in a static site.
// Real access control lives in firestore.rules and Firebase Auth, not in
// hiding this object. See README.md "Security model" for details.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyC3FxRCWqap-2wsIAjZkAi3PIVEVCYEo_4",
  authDomain: "jackpot-joker-3d398.firebaseapp.com",
  projectId: "jackpot-joker-3d398",
  storageBucket: "jackpot-joker-3d398.firebasestorage.app",
  messagingSenderId: "462599941026",
  appId: "1:462599941026:web:e44a76bd6fadd69868e0fb",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Keep admins signed in across page reloads/tabs.
setPersistence(auth, browserLocalPersistence).catch((err) =>
  console.error("Auth persistence error:", err)
);
