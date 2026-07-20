const fs = require('fs');
const config = JSON.parse(fs.readFileSync('firebase-applet-config.json'));
const url = `https://firestore.googleapis.com/v1/projects/${config.projectId}/databases/${config.firestoreDatabaseId}/documents/matches?key=${config.apiKey}`;
fetch(url).then(r=>r.json()).then(data => {
  if (data.documents) {
    const matches = data.documents.map(d => {
      const f = d.fields || {};
      return {
        id: d.name.split('/').pop(),
        date: f.date?.stringValue,
        opponent: f.opponent?.stringValue,
        isTentative: f.isTentative?.booleanValue,
        isArchived: f.isArchived?.booleanValue,
        format: f.format?.stringValue
      };
    });
    console.log(matches.filter(m => m.date && (m.date.includes('-08-') || m.date.includes('-09-') || m.date.includes('-07-'))));
  } else {
    console.log(data);
  }
});
