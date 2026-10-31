import { mkdirSync, readFileSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, existsSync, unlinkSync, readdirSync, rmdirSync, realpathSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { hostname } from 'node:os';

const leases = new Map();
const ownerHost = hostname();
const ownershipError = () => Object.assign(new Error('Runtime is owned by another live process or application instance. Stop its server/import before retrying.'), { code: 'RUNTIME_BUSY' });
const alive = pid => {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code !== 'ESRCH'; }
};

/** One writer owns both queue and workspace, including independent owners in one PID. */
export function acquireRuntimeLease(runtimeDir) {
  mkdirSync(resolve(runtimeDir), { recursive: true });
  const directory = realpathSync(resolve(runtimeDir));
  const lock = join(directory, '.runtime-owner');
  const token = randomUUID(), marker = `${process.pid}-${token}.json`;
  const pending = `${lock}.pending-${marker}`;
  // Publish an already populated directory: there is no empty live-lock window.
  mkdirSync(pending);
  try {
    writeFileSync(join(pending, marker), JSON.stringify({ pid: process.pid, token, hostname: ownerHost, process_time_origin_ms: performance.timeOrigin, created_at: new Date().toISOString() }), { flag: 'wx', mode: 0o600 });
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        renameSync(pending, lock);
        let released = false;
        const lease = {
          assertOwned() { if (released) throw Object.assign(new Error('Runtime ownership has been released.'), { code: 'RUNTIME_CLOSED' }); },
          release() {
            if (released) return;
            released = true; process.removeListener('exit', lease.release);
            if (leases.get(directory) === lease) leases.delete(directory);
            // Never remove a replacement owner's marker or recursively remove a lock.
            try { unlinkSync(join(lock, marker)); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
            try { rmdirSync(lock); } catch (error) { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error; }
          },
        };
        leases.set(directory, lease); process.once('exit', lease.release);
        return lease;
      } catch (error) {
        if (!['EEXIST', 'ENOTEMPTY', 'EPERM', 'EACCES'].includes(error.code)) throw error;
      }
      let entries;
      try { entries = readdirSync(lock); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      if (!entries.length) {
        // Only stale cleanup produces an empty published directory.
        try { rmdirSync(lock); } catch (error) { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error; }
        continue;
      }
      if (entries.length !== 1 || !/^\d+-[0-9a-f-]{36}\.json$/u.test(entries[0])) throw ownershipError();
      const oldMarker = entries[0], pid = Number(oldMarker.split('-')[0]);
      if (!Number.isSafeInteger(pid) || pid < 1) throw ownershipError();
      let owner;
      try { owner = JSON.parse(readFileSync(join(lock, oldMarker), 'utf8')); }
      catch (error) { if (error.code === 'ENOENT') continue; throw ownershipError(); }
      // PID namespaces differ between containers sharing a volume. Never infer
      // another host/container's liveness from the local process namespace.
      if (owner.pid !== pid || `${owner.pid}-${owner.token}.json` !== oldMarker || owner.hostname !== ownerHost) throw ownershipError();
      if (alive(pid)) {
        // Docker PID 1 (or a recycled OS PID) can belong to a new process now.
        // Our own process origin is reliable without OS-specific probes. A
        // foreign live PID, missing identity or damaged marker fails closed.
        if (pid !== process.pid) throw ownershipError();
        if (!Number.isFinite(owner.process_time_origin_ms) || owner.process_time_origin_ms === performance.timeOrigin) throw ownershipError();
      }
      // Delete only the exact dead owner's token. A concurrent successor has a
      // different filename and its populated directory cannot be removed here.
      try { unlinkSync(join(lock, oldMarker)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      try { rmdirSync(lock); } catch (error) { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error; }
    }
    throw ownershipError();
  } finally {
    if (existsSync(join(pending, marker))) unlinkSync(join(pending, marker));
    if (existsSync(pending)) rmdirSync(pending);
  }
}

/** Small durable local store. A failed write never replaces the in-memory state. */
export function createStore({ runtimeDir, initialTickets = [] }) {
  return createJsonStore({ runtimeDir, filename: 'state.json', initial: { version: 1, tickets: initialTickets, feedback: [] }, validate: value => value.version === 1 && Array.isArray(value.tickets) && Array.isArray(value.feedback) });
}

/** Independent atomic stores keep the v1 state contract unchanged. */
export function createJsonStore({ runtimeDir, filename, initial, validate }) {
  const directory = resolve(runtimeDir);
  mkdirSync(directory, { recursive: true });
  const lease = leases.get(realpathSync(directory));
  const stateFile = join(directory, filename);
  let state;
  if (existsSync(stateFile)) {
    state = JSON.parse(readFileSync(stateFile, 'utf8'));
    if (!validate(state)) {
      throw new Error(`Unsupported or damaged runtime/${filename}. Preserve the file and restore a valid backup.`);
    }
  } else {
    state = structuredClone(initial);
    persist(state);
  }

  function persist(next) {
    lease?.assertOwned();
    const temporary = `${stateFile}.${process.pid}.tmp`;
    let descriptor;
    try {
      descriptor = openSync(temporary, 'w', 0o600);
      writeFileSync(descriptor, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      renameSync(temporary, stateFile);
    } catch (error) {
      if (descriptor !== undefined) closeSync(descriptor);
      if (existsSync(temporary)) unlinkSync(temporary);
      throw error;
    }
  }

  return {
    snapshot: () => structuredClone(state),
    transact(update) {
      const next = structuredClone(state);
      const result = update(next);
      persist(next);
      state = next;
      return structuredClone(result);
    },
    stateFile,
  };
}
