import { execFile } from "node:child_process";
import { lstat, open, realpath } from "node:fs/promises";
import { watch } from "node:fs";
import { setImmediate as delayImmediate } from "node:timers/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { minimatch } from "minimatch";

const MAX_FILES = 100_000;
const MAX_PATH_BYTES = 4_096;
const MAX_PATH_LIST_BYTES = 32 * 1024 * 1024;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_SOURCE_BYTES = 512 * 1024 * 1024;
const MAX_REQUEST_BYTES = 32 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_LINE_CHARS = 1_000;
const FIND_LIMIT_MAX = 1_000;
const GREP_LIMIT_MAX = 100;
const GREP_CONTEXT_MAX = 10;
const RECONCILE_DELAY_MS = 150;

const rootArgument = process.argv[2];
if (!rootArgument) throw new Error("Indexed search worker requires a root path");
const root = await realpath(rootArgument);
const decoder = new TextDecoder("utf-8", { fatal: true });
let database;
let watcher;
let closed = false;
let indexing = false;
let available = false;
let dirty = true;
let forceAll = true;
let reconcileTimer;
let paths = [];
let metadataPaths = [];
let metadataFingerprints = new Map();
const forcedPaths = new Set();
const cancelled = new Set();

function send(message) {
  if (!process.connected || closed) return;
  const bytes = Buffer.byteLength(JSON.stringify(message), "utf8");
  try {
    if (bytes > MAX_RESPONSE_BYTES) {
      process.send({ id: message.id, ok: false, fallback: true, error: "Indexed search response exceeded its byte limit" });
      return;
    }
    process.send(message);
  } catch {
    void closeWorker(1);
  }
}

function sendEvent(event, data = {}) {
  send({ event, ...data });
}

function insideRoot(candidate) {
  const value = relative(root, candidate);
  return value === "" || (!isAbsolute(value) && value !== ".." && !value.startsWith(`..${sep}`));
}

function normalizedRelativePath(value) {
  return value.split(sep).join("/");
}

function fingerprint(stat) {
  return {
    mtimeNs: String(stat.mtimeNs),
    ctimeNs: String(stat.ctimeNs),
    size: Number(stat.size),
    dev: String(stat.dev),
    ino: String(stat.ino),
  };
}

function sameFingerprint(left, right) {
  return left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs &&
    left.size === right.size && left.dev === right.dev && left.ino === right.ino;
}

function runCommand(command, args, maxBuffer = MAX_PATH_LIST_BYTES) {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile(command, args, {
      cwd: root,
      encoding: null,
      maxBuffer,
      shell: false,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      if (error) {
        const diagnostic = Buffer.isBuffer(stderr) ? stderr.toString("utf8").trim() : String(stderr ?? "").trim();
        rejectPromise(new Error(diagnostic || error.message));
        return;
      }
      resolvePromise(Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout ?? ""));
    });
  });
}

function commandText(buffer) {
  try {
    return decoder.decode(buffer).trim();
  } catch {
    throw new Error("Git returned a path that is not valid UTF-8");
  }
}

async function configureMetadataPaths() {
  const top = resolve(commandText(await runCommand("git", ["rev-parse", "--show-toplevel"], 64 * 1024)));
  const gitDir = resolve(commandText(await runCommand("git", ["rev-parse", "--absolute-git-dir"], 64 * 1024)));
  const commonDir = resolve(root, commandText(await runCommand("git", ["rev-parse", "--git-common-dir"], 64 * 1024)));
  const candidates = [
    join(gitDir, "index"), join(gitDir, "config"), join(gitDir, "info", "exclude"),
    join(commonDir, "config"), join(commonDir, "info", "exclude"),
  ];
  for (let current = root;; current = dirname(current)) {
    candidates.push(join(current, ".gitignore"));
    if (current === top || dirname(current) === current) break;
  }
  try {
    const globalExclude = commandText(await runCommand("git", ["config", "--path", "--get", "core.excludesFile"], 64 * 1024));
    if (globalExclude) candidates.push(resolve(globalExclude));
  } catch {
    // Most repositories have no global excludes file.
  }
  metadataPaths = [...new Set(candidates)];
  metadataFingerprints = await readMetadataFingerprints();
}

async function readMetadataFingerprints() {
  const result = new Map();
  await Promise.all(metadataPaths.map(async (path) => {
    try {
      const information = await lstat(path, { bigint: true });
      result.set(path, JSON.stringify(fingerprint(information)));
    } catch {
      result.set(path, "missing");
    }
  }));
  return result;
}

async function metadataIsFresh() {
  const current = await readMetadataFingerprints();
  for (const path of metadataPaths) if (current.get(path) !== metadataFingerprints.get(path)) return false;
  return true;
}

async function enumerateFiles() {
  await runCommand("git", ["rev-parse", "--is-inside-work-tree"], 64 * 1024);
  const args = [
    "--hidden", "--color=never", "--print0", "--absolute-path", "--type", "f", "--type", "l", "--type", "d",
    "--exclude", ".git", "--search-path", root, "--", ".",
  ];
  let output;
  try {
    output = await runCommand("fd", args);
  } catch (fdError) {
    try {
      output = await runCommand("fdfind", args);
    } catch {
      throw fdError;
    }
  }
  const result = [];
  let pathBytes = 0;
  let start = 0;
  for (let index = 0; index <= output.length; index++) {
    if (index !== output.length && output[index] !== 0) continue;
    const bytes = output.subarray(start, index);
    start = index + 1;
    if (!bytes.length) continue;
    if (bytes.length > MAX_PATH_BYTES) throw new Error("Repository contains a path longer than 4096 bytes");
    let rawPath;
    try {
      rawPath = decoder.decode(bytes);
    } catch {
      throw new Error("Repository contains a path that is not valid UTF-8");
    }
    const directory = rawPath.endsWith("/") || rawPath.endsWith("\\");
    const absolute = resolve(rawPath.replace(/[\\/]$/, ""));
    if (!insideRoot(absolute) || absolute === root) continue;
    const path = normalizedRelativePath(relative(root, absolute));
    if (!path || path === ".." || path.startsWith("../")) continue;
    pathBytes += Buffer.byteLength(path, "utf8");
    if (pathBytes > MAX_PATH_LIST_BYTES) throw new Error("Repository path list exceeded 32MB");
    result.push(directory ? `${path}/` : path);
    if (result.length > MAX_FILES) throw new Error(`Repository has more than ${MAX_FILES} searchable paths`);
  }
  return [...new Set(result)].sort((left, right) => left.localeCompare(right));
}

async function readBoundedFile(absolute, expected) {
  const handle = await open(absolute, "r");
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) return { content: null, state: "other" };
    if (Number(before.size) > MAX_FILE_BYTES) return { content: null, state: "oversized" };
    const buffer = Buffer.alloc(Number(before.size) + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const read = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (read.bytesRead === 0) break;
      offset += read.bytesRead;
    }
    if (offset > MAX_FILE_BYTES) return { content: null, state: "oversized" };
    const after = await handle.stat({ bigint: true });
    if (!sameFingerprint(expected, fingerprint(after))) throw new Error("File changed while it was indexed");
    const content = buffer.subarray(0, offset);
    if (content.subarray(0, 8_192).includes(0)) return { content: null, state: "binary" };
    try {
      return { content: decoder.decode(content), state: "text" };
    } catch {
      return { content: null, state: "invalid" };
    }
  } finally {
    await handle.close();
  }
}

async function inspectFile(path) {
  const plainPath = path.endsWith("/") ? path.slice(0, -1) : path;
  const absolute = resolve(root, ...plainPath.split("/"));
  if (!insideRoot(absolute)) return null;
  const stat = await lstat(absolute, { bigint: true });
  const fileFingerprint = fingerprint(stat);
  if (stat.isDirectory()) return { path: `${plainPath}/`, ...fileFingerprint, content: null, state: "directory" };
  if (stat.isSymbolicLink()) return { path: plainPath, ...fileFingerprint, content: null, state: "symlink" };
  if (!stat.isFile()) return { path: plainPath, ...fileFingerprint, content: null, state: "other" };
  const canonical = await realpath(absolute);
  if (!insideRoot(canonical)) return { path: plainPath, ...fileFingerprint, content: null, state: "symlink" };
  const indexed = await readBoundedFile(canonical, fileFingerprint);
  return { path: plainPath, ...fileFingerprint, ...indexed };
}

function openDatabase() {
  const db = new DatabaseSync(":memory:", { allowExtension: false });
  db.exec("PRAGMA trusted_schema=OFF; PRAGMA foreign_keys=ON;");
  db.exec("CREATE VIRTUAL TABLE capability_probe USING fts5(content, tokenize='trigram');");
  db.prepare("INSERT INTO capability_probe(content) VALUES (?)").run("abc sentinel");
  const probe = db.prepare("SELECT count(*) AS count FROM capability_probe WHERE capability_probe MATCH ?").get('"abc"');
  db.exec("DROP TABLE capability_probe;");
  if (Number(probe?.count) !== 1) throw new Error("SQLite FTS5 trigram tokenizer is unavailable");
  db.exec(`
    CREATE TABLE files (
      id INTEGER PRIMARY KEY,
      path TEXT UNIQUE NOT NULL,
      mtime_ns TEXT NOT NULL,
      ctime_ns TEXT NOT NULL,
      size INTEGER NOT NULL,
      dev TEXT NOT NULL,
      ino TEXT NOT NULL,
      state TEXT NOT NULL,
      content TEXT
    );
    CREATE VIRTUAL TABLE files_fts USING fts5(
      content,
      content='files',
      content_rowid='id',
      tokenize='trigram'
    );
    CREATE TRIGGER files_ai AFTER INSERT ON files WHEN new.content IS NOT NULL BEGIN
      INSERT INTO files_fts(rowid, content) VALUES (new.id, new.content);
    END;
    CREATE TRIGGER files_ad AFTER DELETE ON files WHEN old.content IS NOT NULL BEGIN
      INSERT INTO files_fts(files_fts, rowid, content) VALUES ('delete', old.id, old.content);
    END;
    CREATE TRIGGER files_au AFTER UPDATE ON files BEGIN
      INSERT INTO files_fts(files_fts, rowid, content)
        SELECT 'delete', old.id, old.content WHERE old.content IS NOT NULL;
      INSERT INTO files_fts(rowid, content)
        SELECT new.id, new.content WHERE new.content IS NOT NULL;
    END;
  `);
  return db;
}

function rebuildPathList() {
  const entries = new Set();
  for (const row of database.prepare("SELECT path FROM files ORDER BY path").all()) {
    const path = String(row.path);
    entries.add(path);
    const parts = path.split("/");
    for (let index = 1; index < parts.length; index++) entries.add(`${parts.slice(0, index).join("/")}/`);
  }
  paths = [...entries].sort((left, right) => left.localeCompare(right));
}

function prepareFileUpsert() {
  return database.prepare(`
    INSERT INTO files(path, mtime_ns, ctime_ns, size, dev, ino, state, content)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET
      mtime_ns=excluded.mtime_ns,
      ctime_ns=excluded.ctime_ns,
      size=excluded.size,
      dev=excluded.dev,
      ino=excluded.ino,
      state=excluded.state,
      content=excluded.content
  `);
}

async function reconcileChangedFiles(changedPaths) {
  if (!await metadataIsFresh()) return undefined;
  const changed = [];
  for (const path of changedPaths) {
    const previous = database.prepare(`
      SELECT state, mtime_ns AS mtimeNs, ctime_ns AS ctimeNs, size, dev, ino,
        coalesce(length(cast(content AS blob)), 0) AS contentBytes
      FROM files WHERE path = ?
    `).get(path);
    if (!previous) return undefined;
    try {
      const file = await inspectFile(path);
      if (!file || file.path !== path) return undefined;
      if (previous.state === "directory") {
        if (file.state !== "directory" || !sameFingerprint(previous, file)) return undefined;
        continue;
      }
      if (file.state === "directory") return undefined;
      changed.push({ file, previousBytes: Number(previous.contentBytes) });
    } catch {
      return undefined;
    }
  }

  let sourceBytes = Number(database.prepare(
    "SELECT coalesce(sum(length(cast(content AS blob))), 0) AS bytes FROM files",
  ).get()?.bytes ?? 0);
  for (const { file, previousBytes } of changed) {
    const contentBytes = file.content === null ? 0 : Buffer.byteLength(file.content, "utf8");
    sourceBytes = sourceBytes - previousBytes + contentBytes;
    if (sourceBytes > MAX_SOURCE_BYTES) throw new Error("Searchable source exceeds the 512MB session index limit");
  }

  database.exec("BEGIN IMMEDIATE");
  try {
    const upsert = prepareFileUpsert();
    for (const { file } of changed) {
      upsert.run(file.path, file.mtimeNs, file.ctimeNs, file.size, file.dev, file.ino, file.state, file.content);
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }

  const files = Number(database.prepare("SELECT count(*) AS count FROM files").get()?.count ?? 0);
  return { files, sourceBytes };
}

async function reconcile(passForceAll, passForcedPaths) {
  if (!passForceAll && passForcedPaths.size > 0) {
    const changed = await reconcileChangedFiles(passForcedPaths);
    if (changed) return changed;
  }

  const listed = await enumerateFiles();
  const listedSet = new Set(listed);
  const existing = new Map(database.prepare(`
    SELECT path, mtime_ns AS mtimeNs, ctime_ns AS ctimeNs, size, dev, ino,
      coalesce(length(cast(content AS blob)), 0) AS contentBytes
    FROM files
  `).all().map((row) => [String(row.path), {
    mtimeNs: String(row.mtimeNs),
    ctimeNs: String(row.ctimeNs),
    size: Number(row.size),
    dev: String(row.dev),
    ino: String(row.ino),
    contentBytes: Number(row.contentBytes),
  }]));
  let sourceBytes = Number(database.prepare(
    "SELECT coalesce(sum(length(cast(content AS blob))), 0) AS bytes FROM files",
  ).get()?.bytes ?? 0);

  database.exec("BEGIN IMMEDIATE");
  try {
    const remove = database.prepare("DELETE FROM files WHERE path = ?");
    for (const [path, metadata] of existing) {
      if (listedSet.has(path)) continue;
      remove.run(path);
      sourceBytes -= metadata.contentBytes;
    }
    const upsert = prepareFileUpsert();
    for (let offset = 0; offset < listed.length; offset += 16) {
      const chunk = listed.slice(offset, offset + 16);
      const inspected = await Promise.all(chunk.map(async (path) => {
        const plainPath = path.endsWith("/") ? path.slice(0, -1) : path;
        const absolute = resolve(root, ...plainPath.split("/"));
        let stat;
        try {
          stat = await lstat(absolute, { bigint: true });
        } catch {
          return { missing: path };
        }
        const current = fingerprint(stat);
        if (!passForceAll && !passForcedPaths.has(path) && existing.has(path) && sameFingerprint(existing.get(path), current)) return undefined;
        try {
          return await inspectFile(path);
        } catch {
          dirty = true;
          forcedPaths.add(path);
          return undefined;
        }
      }));
      for (const file of inspected) {
        if (!file) continue;
        if ("missing" in file) {
          const previous = existing.get(file.missing);
          if (previous) {
            remove.run(file.missing);
            sourceBytes -= previous.contentBytes;
          }
          dirty = true;
          continue;
        }
        const previous = existing.get(file.path);
        const contentBytes = file.content === null ? 0 : Buffer.byteLength(file.content, "utf8");
        const projectedBytes = sourceBytes - (previous?.contentBytes ?? 0) + contentBytes;
        if (projectedBytes > MAX_SOURCE_BYTES) throw new Error("Searchable source exceeds the 512MB session index limit");
        upsert.run(file.path, file.mtimeNs, file.ctimeNs, file.size, file.dev, file.ino, file.state, file.content);
        sourceBytes = projectedBytes;
      }
      if (offset % 256 === 0) {
        sendEvent("progress", { scannedFiles: Math.min(offset + chunk.length, listed.length), totalFiles: listed.length });
        await delayImmediate();
      }
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }

  metadataFingerprints = await readMetadataFingerprints();
  rebuildPathList();
  return { files: listed.length, sourceBytes };
}

async function reconcileUntilStable(initial = false) {
  if (indexing || closed) return;
  indexing = true;
  available = false;
  let stats;
  try {
    for (let pass = 0; pass < 3; pass++) {
      const passForceAll = forceAll;
      const passForcedPaths = new Set(forcedPaths);
      forceAll = false;
      forcedPaths.clear();
      dirty = false;
      stats = await reconcile(passForceAll, passForcedPaths);
      if (!dirty) break;
    }
    if (dirty) throw new Error("Search index could not stabilize after three scans");
    available = true;
    sendEvent(initial ? "ready" : "updated", stats);
  } catch (error) {
    available = false;
    sendEvent(initial ? "failed" : "invalid", { error: error instanceof Error ? error.message : String(error) });
  } finally {
    indexing = false;
  }
}

function scheduleReconcile() {
  if (closed || reconcileTimer) return;
  reconcileTimer = setTimeout(() => {
    reconcileTimer = undefined;
    void reconcileUntilStable(false);
  }, RECONCILE_DELAY_MS);
  reconcileTimer.unref?.();
}

function invalidate(eventType, filename) {
  if (closed) return;
  if (typeof filename === "string" && filename) {
    const normalized = normalizedRelativePath(filename);
    const exact = database?.prepare("SELECT state FROM files WHERE path = ?").get(normalized);
    if (eventType === "change" && normalized === basename(root) && !exact) return;
    if (normalized === ".git" || normalized.startsWith(".git/")) {
      if (normalized !== ".git/index" && normalized !== ".git/config" && normalized !== ".git/info/exclude") return;
      available = false;
      dirty = true;
      forceAll = true;
    } else {
      available = false;
      dirty = true;
      const name = normalized.split("/").at(-1);
      let indexedPath = normalized;
      let current = exact;
      if (!current) {
        indexedPath = `${normalized.replace(/\/$/, "")}/`;
        current = database?.prepare("SELECT state FROM files WHERE path = ?").get(indexedPath);
      }
      if (name === ".gitignore" || name === ".ignore" || name === ".fdignore" || !current) {
        forceAll = true;
      } else {
        forcedPaths.add(indexedPath);
      }
    }
  } else {
    available = false;
    dirty = true;
    forceAll = true;
  }
  scheduleReconcile();
}

function checkRequest(id) {
  if (cancelled.has(id)) throw new Error("Operation aborted");
  if (!available || indexing || dirty) return false;
  return true;
}

async function checkFreshRequest(id) {
  if (!checkRequest(id)) return false;
  if (await metadataIsFresh()) return checkRequest(id);
  available = false;
  dirty = true;
  forceAll = true;
  scheduleReconcile();
  return false;
}

function requestString(value, name, maximum, allowEmpty = false) {
  if (typeof value !== "string" || (!allowEmpty && !value) || Buffer.byteLength(value, "utf8") > maximum) {
    throw new Error(`${name} is invalid`);
  }
  return value;
}

function requestInteger(value, name, maximum) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error(`${name} is invalid`);
  return value;
}

function scopeIsIndexed(searchRelative, searchType) {
  if (!searchRelative) return true;
  const expected = searchType === "file" ? searchRelative : `${searchRelative.replace(/\/$/, "")}/`;
  return paths.includes(expected);
}

function pathUnderSearch(path, searchRelative, searchType) {
  const plain = path.endsWith("/") ? path.slice(0, -1) : path;
  if (!searchRelative) return { relative: path };
  if (searchType === "file") return plain === searchRelative ? { relative: searchRelative.split("/").pop() } : null;
  const prefix = `${searchRelative.replace(/\/$/, "")}/`;
  if (!plain.startsWith(prefix)) return null;
  return { relative: path.slice(prefix.length) };
}

function globMatches(path, pattern, allowNegation) {
  const directory = path.endsWith("/");
  const candidate = directory ? path.slice(0, -1) : path;
  if (pattern === "" || pattern === "**" || pattern === "**/*") return true;
  const effectivePattern = !allowNegation && pattern.includes("/") && !pattern.startsWith("/") && !pattern.startsWith("**/")
    ? `**/${pattern}`
    : pattern;
  return minimatch(candidate, effectivePattern, {
    dot: true,
    platform: "linux",
    matchBase: !effectivePattern.includes("/"),
    nocase: allowNegation ? false : pattern.toLowerCase() === pattern,
    nocomment: true,
    nonegate: !allowNegation,
    windowsPathsNoEscape: false,
  });
}

async function findFiles(id, params) {
  if (!await checkFreshRequest(id)) return { available: false };
  const pattern = requestString(params.pattern, "pattern", 1_024, true);
  const searchRelative = requestString(params.searchRelative, "searchRelative", MAX_PATH_BYTES, true);
  const searchType = params.searchType === "file" ? "file" : "directory";
  const limit = requestInteger(params.limit, "limit", FIND_LIMIT_MAX);
  if (!scopeIsIndexed(searchRelative, searchType)) return { available: false };
  const items = [];
  let hasMore = false;
  let considered = 0;
  for (const path of paths) {
    const scoped = pathUnderSearch(path, searchRelative, searchType);
    if (scoped && globMatches(scoped.relative, pattern, false)) {
      if (items.length >= limit) {
        hasMore = true;
        break;
      }
      items.push(scoped.relative);
    }
    considered++;
    if (considered % 256 === 0) {
      await delayImmediate();
      if (!checkRequest(id)) return { available: false };
    }
  }
  return { available: true, items, hasMore: hasMore || items.length >= limit };
}

function ftsPhrase(pattern) {
  return `"${pattern.replaceAll('"', '""')}"`;
}

function lineMatches(line, pattern, ignoreCase) {
  return ignoreCase ? line.toLowerCase().includes(pattern.toLowerCase()) : line.includes(pattern);
}

function boundedLine(line) {
  const characters = Array.from(line);
  return characters.length <= MAX_LINE_CHARS ? line : `${characters.slice(0, MAX_LINE_CHARS - 3).join("")}...`;
}

async function grepFiles(id, params) {
  if (!await checkFreshRequest(id)) return { available: false };
  const pattern = requestString(params.pattern, "pattern", 1_024);
  const searchRelative = requestString(params.searchRelative, "searchRelative", MAX_PATH_BYTES, true);
  const searchType = params.searchType === "file" ? "file" : "directory";
  const glob = params.glob === undefined ? undefined : requestString(params.glob, "glob", 1_024);
  const ignoreCase = params.ignoreCase === true;
  const context = Number.isSafeInteger(params.context) && params.context >= 0 && params.context <= GREP_CONTEXT_MAX
    ? params.context
    : (() => { throw new Error("context is invalid"); })();
  const limit = requestInteger(params.limit, "limit", GREP_LIMIT_MAX);
  if (!scopeIsIndexed(searchRelative, searchType)) return { available: false };
  for (const row of database.prepare("SELECT path FROM files WHERE state IN ('oversized', 'invalid') ORDER BY path").iterate()) {
    const path = String(row.path);
    const scoped = pathUnderSearch(path, searchRelative, searchType);
    if (scoped && (!glob || globMatches(scoped.relative, glob, true))) return { available: false };
  }
  const useTrigrams = Array.from(pattern).length >= 3 && (!ignoreCase || /^[\x00-\x7f]+$/.test(pattern));
  const rows = useTrigrams
    ? database.prepare(`
        SELECT files.path AS path, files.content AS content
        FROM files_fts JOIN files ON files.id = files_fts.rowid
        WHERE files_fts MATCH ?
        ORDER BY files.path
      `).iterate(ftsPhrase(pattern))
    : database.prepare("SELECT path, content FROM files WHERE state = 'text' ORDER BY path").iterate();
  const items = [];
  let hasMore = false;
  let responseBytes = 0;
  let scanned = 0;
  for (const row of rows) {
    const path = String(row.path);
    const scoped = pathUnderSearch(path, searchRelative, searchType);
    if (!scoped || path.endsWith("/") || (glob && !globMatches(scoped.relative, glob, true))) continue;
    const lines = String(row.content ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    for (let index = 0; index < lines.length; index++) {
      if (!lineMatches(lines[index], pattern, ignoreCase)) continue;
      if (items.length >= limit) {
        hasMore = true;
        break;
      }
      const item = {
        path: scoped.relative,
        lineNumber: index + 1,
        line: boundedLine(lines[index]),
        before: lines.slice(Math.max(0, index - context), index).map(boundedLine),
        after: lines.slice(index + 1, index + 1 + context).map(boundedLine),
      };
      const itemBytes = Buffer.byteLength(JSON.stringify(item), "utf8");
      if (responseBytes + itemBytes > MAX_RESPONSE_BYTES - 4_096) {
        hasMore = true;
        break;
      }
      responseBytes += itemBytes;
      items.push(item);
    }
    if (hasMore) break;
    scanned++;
    if (scanned % 32 === 0) {
      await delayImmediate();
      if (!checkRequest(id)) return { available: false };
    }
  }
  return { available: true, items, hasMore: hasMore || items.length >= limit };
}

function status() {
  const row = database?.prepare(
    "SELECT count(*) AS files, coalesce(sum(length(cast(content AS blob))), 0) AS sourceBytes FROM files",
  ).get();
  return {
    available,
    indexing,
    dirty,
    files: Number(row?.files ?? 0),
    sourceBytes: Number(row?.sourceBytes ?? 0),
  };
}

async function closeWorker(exitCode = 0) {
  if (closed) return;
  closed = true;
  available = false;
  if (reconcileTimer) clearTimeout(reconcileTimer);
  watcher?.close();
  try {
    database?.close();
  } catch {
    // The database may already be closed after a startup failure.
  }
  process.disconnect?.();
  setImmediate(() => process.exit(exitCode));
}

let requestQueue = Promise.resolve();
process.on("message", (message) => {
  if (!message || typeof message !== "object") return;
  let bytes;
  try {
    bytes = Buffer.byteLength(JSON.stringify(message), "utf8");
  } catch {
    return;
  }
  if (bytes > MAX_REQUEST_BYTES) return;
  if (message.method === "cancel" && Number.isSafeInteger(message.target)) {
    cancelled.add(message.target);
    return;
  }
  const id = message.id;
  if (!Number.isSafeInteger(id) || id < 1) return;
  requestQueue = requestQueue.then(async () => {
    try {
      let value;
      if (message.method === "find") value = await findFiles(id, message.params ?? {});
      else if (message.method === "grep") value = await grepFiles(id, message.params ?? {});
      else if (message.method === "status") value = status();
      else if (message.method === "rescan") {
        forceAll = true;
        dirty = true;
        await reconcileUntilStable(false);
        value = status();
      } else if (message.method === "shutdown") {
        send({ id, ok: true, value: { stopped: true } });
        await closeWorker(0);
        return;
      } else throw new Error("Unknown indexed search request");
      send({ id, ok: true, value });
    } catch (error) {
      send({
        id,
        ok: false,
        fallback: true,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      cancelled.delete(id);
    }
  });
});

process.on("disconnect", () => void closeWorker(0));
process.on("SIGTERM", () => void closeWorker(0));
process.on("SIGINT", () => void closeWorker(0));

try {
  database = openDatabase();
  await configureMetadataPaths();
  watcher = watch(root, { recursive: true }, (event, filename) => invalidate(event, filename));
  watcher.on("error", (error) => {
    available = false;
    sendEvent("invalid", { error: error.message });
  });
  await reconcileUntilStable(true);
} catch (error) {
  sendEvent("failed", { error: error instanceof Error ? error.message : String(error) });
}
