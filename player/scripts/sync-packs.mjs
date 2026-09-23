// Canonical pack manifests live in player/src/packs/<id>/pack.json, where
// the bundle imports them. The runtime fetch path (loadPack) needs the same
// files under player/public/packs/, so this script copies them over and
// verifies each manifest id matches its directory. Runs automatically via
// the predev/prebuild hooks; public/packs/ is committed so Pages and offline
// checkouts serve the manifests even without running it.
import { cpSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "src", "packs");
const dest = join(root, "public", "packs");

for (const id of readdirSync(src)) {
  const from = join(src, id, "pack.json");
  const def = JSON.parse(readFileSync(from, "utf-8"));
  if (def.id !== id) {
    throw new Error(`pack id mismatch in ${from}: ${JSON.stringify(def.id)} !== ${JSON.stringify(id)}`);
  }
  mkdirSync(join(dest, id), { recursive: true });
  cpSync(from, join(dest, id, "pack.json"));
  console.log(`sync-packs: ${id} -> public/packs/${id}/pack.json`);
}
