import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs } from "firebase/firestore";
import fs from "fs";

const firebaseConfig = JSON.parse(fs.readFileSync("./firebase-applet-config.json"));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function run() {
  const matchesSnap = await getDocs(collection(db, "matches"));
  const matches = matchesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  
  const augMatches = matches.filter(m => m.date.includes("-08-"));
  console.log(JSON.stringify(augMatches, null, 2));
}

run();
