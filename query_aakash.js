const { initializeApp } = require("firebase/app");
const { getFirestore, collection, getDocs } = require("firebase/firestore");
const fs = require('fs');

const configString = fs.readFileSync('./firebase-applet-config.json', 'utf-8');
const configObj = JSON.parse(configString);

const firebaseConfig = {
  apiKey: configObj.apiKey,
  authDomain: configObj.authDomain,
  projectId: configObj.projectId,
  storageBucket: configObj.storageBucket,
  messagingSenderId: configObj.messagingSenderId,
  appId: configObj.appId,
  measurementId: configObj.measurementId
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app, configObj.firestoreDatabaseId || '(default)');

async function check() {
  const playersExp = await getDocs(collection(db, 'players'));
  playersExp.forEach(doc => {
    const data = doc.data();
    if (data.name && data.name.toLowerCase().includes('aakash')) {
      console.log('Player Found:', doc.id, data);
    }
  });

  const usersExp = await getDocs(collection(db, 'appUsers'));
  usersExp.forEach(doc => {
    const data = doc.data();
    if (data.name && data.name.toLowerCase().includes('aakash')) {
      console.log('AppUser Found:', doc.id, data);
    }
  });
  process.exit(0);
}
check();
