import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

// FIX-16: fail loudly and helpfully when config is missing — a blank screen is
// undebuggable for a new contributor. All keys must exist before init.
const REQUIRED_ENV_KEYS = [
	"VITE_FIREBASE_API_KEY",
	"VITE_FIREBASE_AUTH_DOMAIN",
	"VITE_FIREBASE_PROJECT_ID",
	"VITE_FIREBASE_STORAGE_BUCKET",
	"VITE_FIREBASE_MESSAGING_SENDER_ID",
	"VITE_FIREBASE_APP_ID",
];

const missingKeys = REQUIRED_ENV_KEYS.filter(
	(key) => !import.meta.env[key] || import.meta.env[key] === "undefined",
);
if (missingKeys.length > 0) {
	throw new Error(
		`Missing Firebase config in .env: ${missingKeys.join(", ")}. Copy .env.example to .env, fill in the VITE_FIREBASE_* values, and restart the dev server.`,
	);
}

const firebaseConfig = {
	apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
	authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
	projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
	storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
	messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
	appId: import.meta.env.VITE_FIREBASE_APP_ID,
	measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
