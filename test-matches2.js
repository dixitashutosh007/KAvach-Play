const admin = require("firebase-admin");
const serviceAccount = require("./firebase-applet-config.json");
// We can't use admin SDK easily without a service account.
