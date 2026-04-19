import { initializeApp, type FirebaseApp } from "firebase/app";
import { getFirestore, type Firestore } from "firebase/firestore";

/** Public web client config; access control is enforced in Firestore rules. */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCWuJPUQ70r6nwiJGQ0WWX0p8wLwsL7Gtw",
  authDomain: "fsadmin.firebaseapp.com",
  projectId: "fsadmin",
  storageBucket: "fsadmin.firebasestorage.app",
  messagingSenderId: "521780702179",
  appId: "1:521780702179:web:c2cd72f67cbad655c98ed6",
};

let app: FirebaseApp | null = null;
let db: Firestore | null = null;

export function getFirestoreDb(): Firestore {
  if (!db) {
    app = initializeApp(FIREBASE_CONFIG);
    db = getFirestore(app);
  }
  return db;
}
