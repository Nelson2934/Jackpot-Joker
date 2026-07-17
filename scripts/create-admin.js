#!/usr/bin/env node
/**
 * scripts/create-admin.js
 * ----------------------------------------------------------------------
 * One-off helper to create (or update) an admin user in Firebase Auth so
 * you can sign in to /admin. This is the ONLY place you need
 * FIREBASE_ADMIN_* service-account credentials — the deployed web app
 * itself never uses them.
 *
 * Setup:
 *   1. Firebase console → Project settings → Service accounts →
 *      "Generate new private key". Save the JSON somewhere safe.
 *   2. Copy .env.example to .env and fill in the values from that JSON
 *      (or point FIREBASE_ADMIN_CREDENTIALS_FILE at the JSON file path).
 *   3. npm install firebase-admin dotenv   (run once, in this /scripts folder
 *      or the project root — this script is not part of the deployed site)
 *   4. node scripts/create-admin.js you@company.com "a-strong-password"
 * ----------------------------------------------------------------------
 */

require("dotenv").config();
const admin = require("firebase-admin");

function loadCredential() {
  if (process.env.FIREBASE_ADMIN_CREDENTIALS_FILE) {
    return admin.credential.cert(require(process.env.FIREBASE_ADMIN_CREDENTIALS_FILE));
  }
  const { FIREBASE_ADMIN_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL, FIREBASE_ADMIN_PRIVATE_KEY } = process.env;
  if (!FIREBASE_ADMIN_PROJECT_ID || !FIREBASE_ADMIN_CLIENT_EMAIL || !FIREBASE_ADMIN_PRIVATE_KEY) {
    console.error(
      "Missing Firebase Admin credentials. Set FIREBASE_ADMIN_PROJECT_ID, FIREBASE_ADMIN_CLIENT_EMAIL and " +
        "FIREBASE_ADMIN_PRIVATE_KEY in .env, or set FIREBASE_ADMIN_CREDENTIALS_FILE to a service-account JSON path."
    );
    process.exit(1);
  }
  return admin.credential.cert({
    projectId: FIREBASE_ADMIN_PROJECT_ID,
    clientEmail: FIREBASE_ADMIN_CLIENT_EMAIL,
    // .env stores the key with literal "\n" — convert back to real newlines.
    privateKey: FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, "\n"),
  });
}

async function main() {
  const [, , email, password] = process.argv;
  if (!email || !password) {
    console.error('Usage: node scripts/create-admin.js "you@company.com" "a-strong-password"');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(1);
  }

  admin.initializeApp({ credential: loadCredential() });

  try {
    const existing = await admin.auth().getUserByEmail(email).catch(() => null);
    if (existing) {
      await admin.auth().updateUser(existing.uid, { password });
      console.log(`✔ Updated password for existing admin: ${email}`);
    } else {
      const user = await admin.auth().createUser({ email, password, emailVerified: true });
      console.log(`✔ Created admin user: ${email} (uid: ${user.uid})`);
    }
    console.log("You can now sign in at /admin with these credentials.");
  } catch (err) {
    console.error("✖ Failed to create/update admin user:", err.message);
    process.exit(1);
  }
}

main();
