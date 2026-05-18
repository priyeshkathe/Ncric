import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

// Check for missing keys (useful for debugging Netlify/Production issues)
if (!firebaseConfig.apiKey) {
  console.error("Firebase API Key is missing! Check your environment variables (VITE_FIREBASE_API_KEY).");
}

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, import.meta.env.VITE_FIREBASE_DATABASE_ID || '(default)');
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export const signIn = async () => {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result;
  } catch (error: any) {
    if (error.code === 'auth/popup-closed-by-user') {
      console.warn('Login popup was closed by the user or blocked by the browser.');
      return null;
    }
    if (error.code === 'auth/cancelled-popup-request') {
      console.warn('Sign-in popup was cancelled because another one was opened.');
      return null;
    }
    if (error.code === 'auth/unauthorized-domain') {
      const hostname = window.location.hostname;
      console.error('CRITICAL: This domain is not authorized in Firebase Console.');
      console.error('Current Domain:', hostname);
      console.error('ACTION REQUIRED: Go to https://console.firebase.google.com/ and find your project.');
      console.error('1. Go to "Authentication" > "Settings" > "Authorized domains"');
      console.error('2. Click "Add domain" and enter:', hostname);
      alert(`SETUP REQUIRED: This website (${hostname}) is not allowed to sign in with your Firebase project yet.\n\nPlease add this domain to "Authorized domains" in your Firebase Consol settings.`);
    }
    console.error('Sign-in error:', error.code, error.message);
    throw error;
  }
};
export const logOut = () => signOut(auth);
