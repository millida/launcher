import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const FORMAT = 1;
const PAD_BYTES = 48 * 1024;
const DAY = 24 * 60 * 60;

export function canonical(list) {
  const lines = ["millida-edges-v1", `issued=${list.issued}`, `expires=${list.expires}`];
  for (const host of list.hosts) lines.push(`host=${host}`);
  for (const edge of list.edges) lines.push(`edge=${edge.id}|${edge.addrs.join(",")}|${(edge.hosts ?? []).join(",")}|${edge.rank ?? 0}`);
  return `${lines.join("\n")}\n`;
}

function rawPublicKey(privateKey) {
  return Buffer.from(createPublicKey(privateKey).export({ format: "jwk" }).x, "base64url");
}

function keyFile(path) {
  const stored = JSON.parse(readFileSync(path, "utf8"));
  return { keyId: Buffer.from(stored.keyId, "hex"), privateKey: createPrivateKey(stored.pem) };
}

function publicKeyText(keyId, privateKey) {
  const body = Buffer.concat([Buffer.from("Ed"), keyId, rawPublicKey(privateKey)]);
  const id = Buffer.from(keyId).reverse().toString("hex").toUpperCase();
  return `untrusted comment: minisign public key ${id}\n${body.toString("base64")}\n`;
}

export function signText(text, keyId, privateKey, trusted) {
  const digest = createHash("blake2b512").update(text).digest();
  const signature = sign(null, digest, privateKey);
  const global = sign(null, Buffer.concat([signature, Buffer.from(trusted)]), privateKey);
  const body = Buffer.concat([Buffer.from("ED"), keyId, signature]);
  return `untrusted comment: millida edge list\n${body.toString("base64")}\ntrusted comment: ${trusted}\n${global.toString("base64")}\n`;
}

function validate(source) {
  if (!Array.isArray(source.hosts) || source.hosts.length === 0) throw new Error("hosts must be a non-empty list");
  if (!Array.isArray(source.edges) || source.edges.length === 0) throw new Error("edges must be a non-empty list");
  const ids = new Set();
  for (const edge of source.edges) {
    if (!/^[a-z0-9-]{1,32}$/.test(edge.id ?? "")) throw new Error(`bad edge id: ${edge.id}`);
    if (ids.has(edge.id)) throw new Error(`duplicate edge id: ${edge.id}`);
    ids.add(edge.id);
    if (!Array.isArray(edge.addrs) || edge.addrs.length === 0) throw new Error(`${edge.id}: addrs must be a non-empty list`);
    if (!Number.isInteger(edge.rank ?? 0) || (edge.rank ?? 0) < 0 || (edge.rank ?? 0) > 9) throw new Error(`${edge.id}: rank must be 0..9`);
    for (const host of edge.hosts ?? []) {
      if (!source.hosts.includes(host)) throw new Error(`${edge.id}: host ${host} is not in the covered list`);
    }
  }
}

function keygen(dir) {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "edges.key");
  if (existsSync(path)) throw new Error(`${path} already exists`);
  const { privateKey } = generateKeyPairSync("ed25519");
  const keyId = randomBytes(8);
  writeFileSync(path, JSON.stringify({ keyId: keyId.toString("hex"), pem: privateKey.export({ format: "pem", type: "pkcs8" }) }), { mode: 0o600 });
  const text = publicKeyText(keyId, privateKey);
  writeFileSync(join(dir, "edges.pub"), text);
  console.log(Buffer.from(text).toString("base64"));
}

function signList(keyPath, sourcePath, outPath) {
  const source = JSON.parse(readFileSync(sourcePath, "utf8"));
  validate(source);
  const { keyId, privateKey } = keyFile(keyPath);
  const issued = Math.floor(Date.now() / 1000);
  const list = {
    format: FORMAT,
    issued,
    expires: issued + (source.ttlDays ?? 30) * DAY,
    hosts: source.hosts,
    edges: source.edges.map((e) => ({ id: e.id, addrs: e.addrs, hosts: e.hosts ?? [], rank: e.rank ?? 0 })),
  };
  const signature = signText(canonical(list), keyId, privateKey, `timestamp:${issued}\tfile:edges.json`);
  const out = { ...list, signature: Buffer.from(signature).toString("base64"), pad: randomBytes(PAD_BYTES).toString("base64") };
  writeFileSync(outPath, JSON.stringify(out));
  console.log(`signed ${list.edges.length} edges, expires ${new Date(list.expires * 1000).toISOString()}`);
}

const [command, ...args] = process.argv.slice(2);
if (command === "keygen" && args.length === 1) keygen(args[0]);
else if (command === "sign" && args.length === 3) signList(args[0], args[1], args[2]);
else if (command !== undefined || import.meta.main) {
  console.error("usage: edges-sign.mjs keygen <dir> | sign <edges.key> <source.json> <out.json>");
  process.exit(2);
}
