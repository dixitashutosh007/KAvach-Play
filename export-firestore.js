// export-firestore.js
const fs = require('fs');

async function exportData() {
  console.log("=== Firestore to JSON Exporter ===\n");
  
  const serviceAccountPath = './serviceAccountKey.json';
  if (!fs.existsSync(serviceAccountPath)) {
    console.error("❌ Error: serviceAccountKey.json not found!");
    console.error("\nTo run this script:");
    console.error("1. Go to Firebase Console -> Project Settings -> Service Accounts.");
    console.error("2. Click 'Generate new private key'.");
    console.error("3. Save the downloaded file as 'serviceAccountKey.json' in this folder.");
    console.error("4. Run `npm install firebase-admin` if you haven't already.");
    console.error("5. Run `node export-firestore.js`\n");
    process.exit(1);
  }

  const { initializeApp, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const serviceAccount = require(serviceAccountPath);

  console.log("Initializing Firebase Admin...");
  const app = initializeApp({
    credential: cert(serviceAccount)
  });

  const dbId = 'ai-studio-cae01507-23c3-4ee4-92c8-848c4cf7d412';
  let db;
  try {
    db = getFirestore(app, dbId);
  } catch (e) {
    console.warn("Could not connect with named DB, trying default...");
    db = getFirestore(app);
  }

  const backupData = {};
  console.log(`Connecting to Firestore database: ${dbId}...\n`);

  try {
    // Get all root-level collections
    const collections = await db.listCollections();
    
    if (collections.length === 0) {
      console.log("No collections found in this database.");
    }
    
    for (const collection of collections) {
      console.log(`Fetching collection: ${collection.id}...`);
      backupData[collection.id] = [];
      const snapshot = await collection.get();
      
      snapshot.forEach(doc => {
        backupData[collection.id].push({
          _id: doc.id,
          ...doc.data()
        });
      });
      console.log(`✅ Exported ${snapshot.size} documents from ${collection.id}`);
    }

    const exportPath = './firestore-backup.json';
    fs.writeFileSync(exportPath, JSON.stringify(backupData, null, 2));
    console.log(`\n🎉 Success! Database exported to ${exportPath}`);
    console.log("This JSON file contains all your data in a clean format that can easily be mapped and uploaded to AWS (DynamoDB, RDS, etc.).");
  } catch (err) {
    console.error("\n❌ Error during export:", err);
  }
}

exportData();
