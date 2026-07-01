import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import fs from 'fs';

const config = JSON.parse(fs.readFileSync('firebase-applet-config.json', 'utf8'));
const app = initializeApp(config);
const db = getFirestore(app);

async function run() {
  const q = collection(db, 'polls');
  const snap = await getDocs(q);
  console.log("Polls count:", snap.size);
  snap.forEach(d => console.log(d.id, d.data()));
  process.exit(0);
}
run().catch(console.error);
