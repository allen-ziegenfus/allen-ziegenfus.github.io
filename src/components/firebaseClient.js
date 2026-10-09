import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { doc, getFirestore } from "firebase/firestore";

/** The Firestore test's Firebase app (FIRESTORE.md). Public by design. */
export const app = initializeApp({
  apiKey: "AIzaSyD_wF0plrxVM7LqX6cu7Ex74T2FH9wnIjQ",
  authDomain: "vollrad-werkverzeichnis.firebaseapp.com",
  projectId: "vollrad-werkverzeichnis",
  storageBucket: "vollrad-werkverzeichnis.firebasestorage.app",
  messagingSenderId: "47327094040",
  appId: "1:47327094040:web:9ef49f7586def8e0a7ea6d",
});
export const auth = getAuth(app);
export const db = getFirestore(app, "werkverzeichnis");
export const ARTIST = "kutscher";
export const artist = doc(db, "artists", ARTIST);
