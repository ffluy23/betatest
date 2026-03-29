import { initializeApp, getApps, cert } from "firebase-admin/app"
import { getFirestore } from "firebase-admin/firestore"

console.log("PROJECT_ID:", process.env.FIREBASE_PROJECT_ID)
console.log("CLIENT_EMAIL:", process.env.FIREBASE_CLIENT_EMAIL)

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    })
  })
}
export const db = getFirestore()