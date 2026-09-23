// Canonical pack content lives in player/src/packs/<id>/ (pack.json plus
// sample docs and, eventually, recordings). The runtime fetch path needs the
// same tree under player/public/packs/, so this script mirrors each pack
// directory wholesale and verifies the manifest id matches its directory.
// Runs automatically via the predev/prebuild hooks; public/packs/ is
// committed so Pages and offline checkouts serve it even without running it.
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "src", "packs");
const dest = join(root, "public", "packs");

const srcIds = new Set(readdirSync(src));
mkdirSync(dest, { recursive: true });
// Drop mirrors of packs deleted from src (e.g. retired skeletons).
for (const id of readdirSync(dest)) {
  if (!srcIds.has(id)) {
    rmSync(join(dest, id), { recursive: true, force: true });
    console.log(`sync-packs: removed stale public/packs/${id}/`);
  }
} 

for (const id of srcIds) {
  const from = join(src, id);
  const manifest = join(from, "pack.json");
  const def = JSON.parse(readFileSync(manifest, "utf-8"));
  if (def.id !== id) {
    throw new Error(`pack id mismatch in ${manifest}: ${JSON.stringify(def.id)} !== ${JSON.stringify(id)}`);
  }
  const to = join(dest, id);
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
  const entries = readdirSync(to);
  console.log(`sync-packs: ${id}/ (${entries.length} top-level entries) -> public/packs/${id}/`);
}
