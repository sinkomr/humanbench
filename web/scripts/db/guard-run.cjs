'use strict'
/*
 * The guard process (ROADMAP M2.0); see guard.ts for what it is for. Plain CommonJS so that `node`
 * can run it directly, with no loader, in a process that has to start fast and survive its owner.
 *
 * argv: owner pid, cluster directory, directory prefix, marker file name, poll interval (ms).
 */

const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const [ownerArg, dir, prefix, markerName, intervalArg] = process.argv.slice(2)
const owner = Number(ownerArg)
const dataDir = path.join(dir, 'data')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return e.code === 'EPERM'
  }
}

function commandOf(pid) {
  try {
    return execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' })
  } catch {
    return ''
  }
}

/** Only a directory of this harness, whose marker names the owner this guard was started for. */
function markedForOwner() {
  if (!path.basename(dir).startsWith(prefix)) return false
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, markerName), 'utf8')).ownerPid === owner
  } catch {
    return false
  }
}

/**
 * Pids of the processes that have this data directory on their command line or, where `ps` shows it
 * (macOS `ps -E`), in their environment: initdb (`-D`), the postmaster (`-D`), and the bootstrap and
 * single-user postgres that initdb starts, which get the directory only as PGDATA. Same as
 * `processesUsing()` in proc.ts, repeated here because this file runs without a loader.
 */
function processesOfDataDir() {
  for (const args of [['-axwwE', '-o', 'pid=,command='], ['-axww', '-o', 'pid=,command=']]) {
    let table
    try {
      table = execFileSync('ps', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
    } catch {
      continue
    }
    const pids = []
    for (const raw of table.split('\n')) {
      const line = raw.trim()
      const space = line.indexOf(' ')
      if (space < 1) continue
      const pid = Number(line.slice(0, space))
      if (Number.isInteger(pid) && pid !== process.pid && line.slice(space + 1).includes(dataDir)) pids.push(pid)
    }
    return pids
  }
  return []
}

function kill(pid, signal) {
  try {
    process.kill(pid, signal)
  } catch {
    // Already gone.
  }
}

async function cleanup() {
  if (!markedForOwner()) return

  // The postmaster first, with an immediate shutdown: the data is throw-away.
  let postmaster
  try {
    postmaster = Number.parseInt(fs.readFileSync(path.join(dataDir, 'postmaster.pid'), 'utf8').split('\n')[0], 10)
  } catch {
    // No postmaster yet, or already gone.
  }
  if (Number.isInteger(postmaster) && postmaster > 1 && alive(postmaster) && /postgres/.test(commandOf(postmaster))) {
    kill(postmaster, 'SIGQUIT')
    for (let i = 0; i < 50 && alive(postmaster); i++) await sleep(100)
  }
  // Then anything else working in the directory (an initdb the owner started just before it died, and
  // the servers initdb started): left running it would keep writing into the directory while it is
  // removed, and the marker would be gone by then. A second look, in case one of them started another.
  for (let round = 0; round < 3; round++) {
    const pids = processesOfDataDir()
    for (const pid of pids) kill(pid, 'SIGKILL')
    await sleep(200)
    if (pids.length === 0) break
  }

  // The marker goes last: if anything is left over, the reaper still knows whose it was.
  for (let attempt = 0; attempt < 20 && fs.existsSync(dir); attempt++) {
    try {
      for (const name of fs.readdirSync(dir)) {
        if (name !== markerName) fs.rmSync(path.join(dir, name), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
      }
      fs.rmSync(path.join(dir, markerName), { force: true })
      fs.rmdirSync(dir)
    } catch {
      await sleep(100)
    }
  }
}

const timer = setInterval(async () => {
  // A normal stop() (or the owner's own exit handler) removed the directory: nothing left to guard.
  if (!fs.existsSync(dir)) process.exit(0)
  if (alive(owner)) return
  clearInterval(timer)
  try {
    await cleanup()
  } finally {
    process.exit(0)
  }
}, Number(intervalArg))
