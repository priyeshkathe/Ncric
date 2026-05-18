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
      console.error('CRITICAL: This domain is not authorized in Firebase Console.');
      console.error('Current Domain:', window.location.hostname);
      console.error('Please add this domain to Authentication > Settings > Authorized domains in Firebase Console.');
    }
    console.error('Sign-in error:', error.code, error.message);
    throw error;
  }
};
export const logOut = () => signOut(auth);
