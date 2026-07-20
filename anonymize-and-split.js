// anonymize-and-split.js
// Reads firestore-backup.json produced by export-firestore.js.
// Scrubs PII, splits per collection, writes small safe files into ./share/.
// Usage: node anonymize-and-split.js

const fs = require("fs");
const path = require("path");

const INPUT = "./firestore-backup.json";
const OUT_DIR = "./share";

if (!fs.existsSync(INPUT)) {
  console.error(`Missing ${INPUT}. Run \`node export-firestore.js\` first.`);
  process.exit(1);
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const raw = JSON.parse(fs.readFileSync(INPUT, "utf8"));

// Stable synthetic replacements so cross-references still link up.
const stableMap = new Map();
let counter = 0;
function stableFake(realValue, kind) {
  if (realValue == null || realValue === "") return realValue;
  const key = `${kind}:${String(realValue)}`;
  if (stableMap.has(key)) return stableMap.get(key);
  counter += 1;
  const idx = String(counter).padStart(4, "0");
  let fake;
  switch (kind) {
    case "name": fake = `Player ${idx}`; break;
    case "email": fake = `player${idx}@example.com`; break;
    case "phone": fake = `+91XXXXXX${idx}`; break;
    case "dob": fake = "1990-01-01"; break;
    case "address": fake = `Locality ${idx}`; break;
    case "photo": fake = "https://example.com/photo.jpg"; break;
    case "generic": fake = `redacted-${idx}`; break;
    default: fake = `redacted-${idx}`;
  }
  stableMap.set(key, fake);
  return fake;
}

// Field-name heuristics. Case-insensitive substring match.
const PII_RULES = [
  { match: /^name$|player.?name|full.?name|display.?name|author.?name|jersey.?name|guest.?name|user.?name/i, kind: "name" },
  { match: /email/i, kind: "email" },
  { match: /mobile|phone|contact/i, kind: "phone" },
  { match: /dob|birth/i, kind: "dob" },
  { match: /locality|address|city/i, kind: "address" },
  { match: /photo|avatar|image.?url/i, kind: "photo" },
  { match: /password|secret|token|apikey|api.?key/i, kind: "generic" },
];

function classify(fieldName) {
  for (const rule of PII_RULES) {
    if (rule.match.test(fieldName)) return rule.kind;
  }
  return null;
}

function scrub(value, fieldName) {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map((v) => scrub(v, fieldName));
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const kind = classify(k);
      if (kind && (typeof v === "string" || typeof v === "number")) {
        out[k] = stableFake(v, kind);
      } else {
        out[k] = scrub(v, k);
      }
    }
    return out;
  }
  return value;
}

const summary = [];
for (const [collection, docs] of Object.entries(raw)) {
  const cleaned = scrub(docs, collection);
  const outFile = path.join(OUT_DIR, `${collection}.json`);
  fs.writeFileSync(outFile, JSON.stringify(cleaned, null, 2));
  const sizeMB = (fs.statSync(outFile).size / (1024 * 1024)).toFixed(2);
  summary.push({ collection, docs: Array.isArray(docs) ? docs.length : 0, sizeMB });
  console.log(`  ${collection}: ${Array.isArray(docs) ? docs.length : 0} docs, ${sizeMB} MB`);
}

fs.writeFileSync(
  path.join(OUT_DIR, "_summary.json"),
  JSON.stringify({ collections: summary, totalUniqueReplacements: counter }, null, 2),
);

console.log(`\nDone. ${summary.length} collections written to ${OUT_DIR}/`);
console.log("Attach the files in ./share/ here.");
