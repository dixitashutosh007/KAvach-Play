const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
initializeApp();
const db = getFirestore('ai-studio-cae01507-23c3-4ee4-92c8-848c4cf7d412');
db.collection('matches').get().then(snap => {
  const matches = snap.docs.map(d => {
    const f = d.data();
    return { id: d.id, date: f.date, opponent: f.opponent, isTentative: f.isTentative, isArchived: f.isArchived, format: f.format };
  });
  console.log(matches.filter(m => m.date && (m.date.includes('-08-') || m.date.includes('/08/') || m.date.includes('-09-') || m.date.includes('/09/'))));
}).catch(console.error);
