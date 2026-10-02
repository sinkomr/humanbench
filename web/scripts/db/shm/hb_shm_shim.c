/*
 * hb_shm_shim.c: System V shared memory without the kernel's System V shared memory (ROADMAP M2.0).
 *
 * Why: PostgreSQL asks the kernel for one System V segment even when its real shared memory is an
 * anonymous mmap (shared_memory_type=mmap): a 56-byte "header" that locks the data directory. On
 * macOS the kernel's accounting for those segments (kern.sysv.shmall, 1024 pages by default) leaks
 * when a postmaster is killed, `ipcs` shows nothing, and from then on every shmget() fails with
 * ENOMEM ("could not create shared memory segment: Cannot allocate memory") until the machine is
 * rebooted. This library gives the process the four calls it needs, backed by anonymous shared
 * mappings that the kernel releases when the process dies, so nothing can leak.
 *
 * How: dyld interposing. Loaded with DYLD_INSERT_LIBRARIES into the Postgres binary (web/scripts/db/
 * shm.ts builds this file, re-signs a copy of the binary so macOS honours the variable, and writes
 * the wrapper that sets it), it replaces shmget, shmat, shmdt and shmctl in that process.
 *
 * Scope, on purpose small:
 *   - A segment exists only inside the process that created it and the processes it forks (a
 *     MAP_SHARED|MAP_ANON mapping is inherited by fork). Postgres on Unix forks all its children
 *     and never re-attaches by id (that is EXEC_BACKEND, Windows), so this is all it needs.
 *   - A shmget() with a key another process created therefore fails with ENOENT. For Postgres that
 *     means "no other postmaster uses this data directory" to its stale-lock check; the
 *     postmaster.pid lock file still guards the directory.
 *   - Only what Postgres calls: IPC_CREAT, IPC_EXCL, IPC_PRIVATE, IPC_STAT (size, attach count,
 *     owner) and IPC_RMID. Anything else fails with EINVAL.
 *   - Not thread-safe; Postgres processes are single-threaded.
 *
 * Linux needs none of this (the kernel limits are large and nothing leaks); the harness loads this
 * library on macOS only.
 */

#include <errno.h>
#include <stddef.h>
#include <string.h>
#include <sys/ipc.h>
#include <sys/mman.h>
#include <sys/shm.h>
#include <unistd.h>

#define HB_MAX_SEGMENTS 64

typedef struct {
  int used;
  key_t key;
  size_t size;
  void *addr; /* NULL once detached in this process */
  int attached;
  int removed; /* IPC_RMID seen: no lookup by key any more; freed when the last attach is gone */
} hb_segment;

static hb_segment segments[HB_MAX_SEGMENTS];

static hb_segment *hb_by_id(int id) {
  if (id < 1 || id > HB_MAX_SEGMENTS || !segments[id - 1].used) {
    errno = EINVAL;
    return NULL;
  }
  return &segments[id - 1];
}

static void hb_free_if_unused(hb_segment *s) {
  if (s->removed && s->attached == 0) {
    if (s->addr != NULL) munmap(s->addr, s->size);
    memset(s, 0, sizeof *s);
  }
}

static int hb_shmget(key_t key, size_t size, int flags) {
  if (key != IPC_PRIVATE) {
    for (int i = 0; i < HB_MAX_SEGMENTS; i++) {
      if (segments[i].used && !segments[i].removed && segments[i].key == key) {
        if ((flags & IPC_CREAT) && (flags & IPC_EXCL)) {
          errno = EEXIST;
          return -1;
        }
        if (size > segments[i].size) {
          errno = EINVAL;
          return -1;
        }
        return i + 1;
      }
    }
    if (!(flags & IPC_CREAT)) {
      errno = ENOENT;
      return -1;
    }
  }
  if (size == 0) {
    errno = EINVAL;
    return -1;
  }
  for (int i = 0; i < HB_MAX_SEGMENTS; i++) {
    if (!segments[i].used) {
      size_t page = (size_t)sysconf(_SC_PAGESIZE);
      size_t len = (size + page - 1) / page * page;
      void *p = mmap(NULL, len, PROT_READ | PROT_WRITE, MAP_SHARED | MAP_ANON, -1, 0);
      if (p == MAP_FAILED) return -1; /* errno from mmap (ENOMEM) */
      segments[i].used = 1;
      segments[i].key = key;
      segments[i].size = len;
      segments[i].addr = p;
      segments[i].attached = 0;
      segments[i].removed = 0;
      return i + 1;
    }
  }
  errno = ENOSPC;
  return -1;
}

static void *hb_shmat(int id, const void *requested, int flags) {
  (void)requested;
  (void)flags;
  hb_segment *s = hb_by_id(id);
  if (s == NULL || s->addr == NULL) {
    errno = EINVAL;
    return (void *)-1;
  }
  s->attached++;
  return s->addr;
}

static int hb_shmdt(const void *addr) {
  for (int i = 0; i < HB_MAX_SEGMENTS; i++) {
    if (segments[i].used && segments[i].addr == addr && addr != NULL) {
      munmap(segments[i].addr, segments[i].size);
      segments[i].addr = NULL;
      if (segments[i].attached > 0) segments[i].attached--;
      hb_free_if_unused(&segments[i]);
      return 0;
    }
  }
  errno = EINVAL;
  return -1;
}

static int hb_shmctl(int id, int cmd, struct shmid_ds *buf) {
  hb_segment *s = hb_by_id(id);
  if (s == NULL) return -1;
  if (cmd == IPC_RMID) {
    s->removed = 1;
    hb_free_if_unused(s);
    return 0;
  }
  if (cmd == IPC_STAT && buf != NULL) {
    memset(buf, 0, sizeof *buf);
    buf->shm_segsz = s->size;
    buf->shm_nattch = (shmatt_t)s->attached;
    buf->shm_perm.uid = geteuid();
    buf->shm_perm.cuid = geteuid();
    buf->shm_perm.gid = getegid();
    buf->shm_perm.cgid = getegid();
    buf->shm_perm.mode = 0600;
    return 0;
  }
  errno = EINVAL;
  return -1;
}

/* Lets a test (or a curious human, with dlsym) see that this library is loaded into a process. */
__attribute__((visibility("default"), used)) const int hb_shm_shim_loaded = 1;

/* What <mach-o/dyld-interposing.h> defines, written out so the file builds with plain `cc`. */
#define HB_INTERPOSE(replacement, replacee)                                                         \
  __attribute__((used)) static struct {                                                             \
    const void *replacement_fn;                                                                     \
    const void *replacee_fn;                                                                        \
  } hb_interpose_##replacee __attribute__((section("__DATA,__interpose"))) = {                      \
      (const void *)(unsigned long)&replacement, (const void *)(unsigned long)&replacee}

HB_INTERPOSE(hb_shmget, shmget);
HB_INTERPOSE(hb_shmat, shmat);
HB_INTERPOSE(hb_shmdt, shmdt);
HB_INTERPOSE(hb_shmctl, shmctl);
