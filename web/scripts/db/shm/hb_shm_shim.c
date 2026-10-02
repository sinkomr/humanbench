/*
 * hb_shm_shim.c: System V shared memory and semaphores without the kernel's System V IPC (ROADMAP M2.0).
 *
 * Why: PostgreSQL asks the kernel for System V IPC even when its real shared memory is an anonymous
 * mmap (shared_memory_type=mmap): one 56-byte "header" segment that locks the data directory, and, on
 * macOS, its process semaphores (the binary imports semget, semctl and semop). On macOS the kernel's
 * accounting for those objects (kern.sysv.shmall, 1024 pages by default) leaks when a postmaster is
 * killed: `ipcs` shows nothing, and from then on every shmget() fails with ENOMEM ("could not create
 * shared memory segment: Cannot allocate memory") until the machine is rebooted; the semaphore sets of
 * a killed postmaster stay behind for good, because their keys come from the data directory's inode,
 * which is new for every run. This library gives the process the seven calls it needs, backed by
 * anonymous shared mappings that the kernel releases when the process dies, so nothing can leak.
 *
 * How: dyld interposing. Loaded with DYLD_INSERT_LIBRARIES into the Postgres binary (web/scripts/db/
 * shm.ts builds this file, re-signs a copy of the binary so macOS honours the variable, and writes
 * the wrapper that sets it), it replaces shmget, shmat, shmdt, shmctl, semget, semctl and semop in
 * that process.
 *
 * Scope, on purpose small:
 *   - A segment or semaphore set exists only inside the process that created it and the processes it
 *     forks (a MAP_SHARED|MAP_ANON mapping is inherited by fork). Postgres on Unix forks all its
 *     children and never re-attaches by id (that is EXEC_BACKEND, Windows), and it creates its
 *     semaphores in the postmaster before the first fork, so this is all it needs. The semaphore table
 *     is mapped when the library loads, so it is shared by every process the postmaster forks.
 *   - A shmget() or semget() with a key another process created therefore fails with ENOENT. For
 *     Postgres that means "no other postmaster uses this data directory" to its stale-lock checks; the
 *     postmaster.pid lock file still guards the directory. Two clusters never see each other's sets.
 *   - Only what Postgres calls. Segments: IPC_CREAT, IPC_EXCL, IPC_PRIVATE, IPC_STAT (size, attach
 *     count, owner) and IPC_RMID. Semaphores: IPC_CREAT, IPC_EXCL, IPC_PRIVATE, semop with one
 *     operation (sem_op +n, -n, 0, and IPC_NOWAIT), semctl GETVAL, GETPID, SETVAL, IPC_STAT and
 *     IPC_RMID. Anything else fails with EINVAL.
 *   - Semaphores are lock-free: the values are atomics in the shared mapping and a blocked semop()
 *     polls with a short, growing sleep (a signal ends the sleep and gives EINTR, as the real call
 *     does). So no process can die holding a lock that the others wait for, which a process-shared
 *     mutex would allow. Nothing here is on a hot path for the test database.
 *   - The segment table is not thread-safe; Postgres processes are single-threaded.
 *
 * Linux needs none of this (the kernel limits are large and nothing leaks); the harness loads this
 * library on macOS only.
 */

#include <errno.h>
#include <sched.h>
#include <stdarg.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>
#include <sys/ipc.h>
#include <sys/mman.h>
#include <sys/sem.h>
#include <sys/shm.h>
#include <time.h>
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

/* ---- Semaphores ------------------------------------------------------------------------------- */

#define HB_MAX_SEMSETS 128 /* Postgres with 100 connections needs about 8 sets of 20 */
#define HB_MAX_SEMS 128    /* semaphores per set; Postgres uses 20 */
#define HB_SEMVMX 32767    /* the largest value a System V semaphore can hold */

/*
 * One semaphore is one 64-bit atomic word: the value in the low 32 bits and, in the high 32 bits, the
 * pid of the last process that did a semop or SETVAL on it (what GETPID answers). One word, so that a
 * change of value and of pid is a single compare-and-swap, as in the kernel.
 */
typedef struct {
  uint64_t word;
} hb_sem;

static int hb_sem_value(uint64_t w) { return (int)(uint32_t)w; }
static int hb_sem_pid(uint64_t w) { return (int)(uint32_t)(w >> 32); }
static uint64_t hb_sem_pack(int value, int pid) { return ((uint64_t)(uint32_t)pid << 32) | (uint32_t)value; }

typedef struct {
  int used; /* atomic: 1 while the set exists; 0 once it is removed */
  int gen;  /* bumped for every set created in this slot; the id carries it, so a stale id never finds a newer set */
  int key;
  int nsems;
  hb_sem sems[HB_MAX_SEMS];
} hb_semset;

/* The union semctl() takes as its fourth argument (as a variadic argument, hence the va_arg below). */
union hb_semun {
  int val;
  struct semid_ds *buf;
  unsigned short *array;
};

/* All the sets, in one shared mapping made before the first fork: see hb_sem_init(). */
static hb_semset *semsets;

static int hb_sem_init(void) {
  if (semsets != NULL) return 1;
  void *p = mmap(NULL, sizeof(hb_semset) * HB_MAX_SEMSETS, PROT_READ | PROT_WRITE, MAP_SHARED | MAP_ANON, -1, 0);
  if (p == MAP_FAILED) return 0; /* errno from mmap (ENOMEM) */
  semsets = (hb_semset *)p;
  return 1;
}

/* The set an id names, or NULL (errno EINVAL) if there is none: never made, removed, or an older generation. */
static hb_semset *hb_sem_by_id(int id) {
  int index = (id & 0xff) - 1;
  if (semsets == NULL || id < 1 || index < 0 || index >= HB_MAX_SEMSETS) {
    errno = EINVAL;
    return NULL;
  }
  hb_semset *s = &semsets[index];
  if (!__atomic_load_n(&s->used, __ATOMIC_ACQUIRE) || (id >> 8) != s->gen) {
    errno = EINVAL;
    return NULL;
  }
  return s;
}

static int hb_semget(key_t key, int nsems, int flags) {
  if (!hb_sem_init()) return -1;
  if (key != IPC_PRIVATE) {
    for (int i = 0; i < HB_MAX_SEMSETS; i++) {
      hb_semset *s = &semsets[i];
      if (__atomic_load_n(&s->used, __ATOMIC_ACQUIRE) && s->key == (int)key) {
        if ((flags & IPC_CREAT) && (flags & IPC_EXCL)) {
          errno = EEXIST;
          return -1;
        }
        if (nsems > s->nsems) {
          errno = EINVAL;
          return -1;
        }
        return (s->gen << 8) | (i + 1);
      }
    }
    if (!(flags & IPC_CREAT)) {
      errno = ENOENT;
      return -1;
    }
  }
  if (nsems <= 0 || nsems > HB_MAX_SEMS) {
    errno = EINVAL;
    return -1;
  }
  for (int i = 0; i < HB_MAX_SEMSETS; i++) {
    hb_semset *s = &semsets[i];
    if (!__atomic_load_n(&s->used, __ATOMIC_ACQUIRE)) {
      memset(s->sems, 0, sizeof s->sems);
      s->gen++;
      s->key = (int)key;
      s->nsems = nsems;
      __atomic_store_n(&s->used, 1, __ATOMIC_RELEASE);
      return (s->gen << 8) | (i + 1);
    }
  }
  errno = ENOSPC;
  return -1;
}

/* One step of waiting for a semaphore: yield for a while, then sleep a little longer each time (10 us up to 320 us). */
static int hb_sem_wait_step(unsigned *round) {
  if (*round < 20) {
    (*round)++;
    sched_yield();
    return 0;
  }
  unsigned doublings = (*round - 20) / 2;
  long ns = 10000L << (doublings < 5 ? doublings : 5);
  (*round)++;
  struct timespec ts = {0, ns};
  if (nanosleep(&ts, NULL) != 0 && errno == EINTR) return -1;
  return 0;
}

static int hb_semop(int id, struct sembuf *sops, size_t nsops) {
  if (nsops != 1 || sops == NULL) {
    errno = EINVAL;
    return -1;
  }
  hb_semset *s = hb_sem_by_id(id);
  if (s == NULL) return -1;
  if (sops->sem_num >= s->nsems) {
    errno = EFBIG;
    return -1;
  }
  hb_sem *m = &s->sems[sops->sem_num];
  int op = sops->sem_op;
  unsigned round = 0;
  for (;;) {
    if (!__atomic_load_n(&s->used, __ATOMIC_ACQUIRE) || (id >> 8) != s->gen) {
      errno = EIDRM; /* removed while we waited */
      return -1;
    }
    uint64_t w = __atomic_load_n(&m->word, __ATOMIC_ACQUIRE);
    int cur = hb_sem_value(w);
    if (op > 0) {
      if (cur + op > HB_SEMVMX) {
        errno = ERANGE;
        return -1;
      }
      if (__atomic_compare_exchange_n(&m->word, &w, hb_sem_pack(cur + op, (int)getpid()), 0, __ATOMIC_ACQ_REL, __ATOMIC_ACQUIRE)) return 0;
      continue; /* somebody else changed it: look again */
    }
    if (op < 0 && cur >= -op) {
      if (__atomic_compare_exchange_n(&m->word, &w, hb_sem_pack(cur + op, (int)getpid()), 0, __ATOMIC_ACQ_REL, __ATOMIC_ACQUIRE)) return 0;
      continue;
    }
    if (op == 0 && cur == 0) return 0;
    if (sops->sem_flg & IPC_NOWAIT) {
      errno = EAGAIN;
      return -1;
    }
    if (hb_sem_wait_step(&round) != 0) {
      errno = EINTR;
      return -1;
    }
  }
}

static int hb_semctl(int id, int semnum, int cmd, ...) {
  union hb_semun arg;
  va_list ap;
  va_start(ap, cmd);
  arg = va_arg(ap, union hb_semun);
  va_end(ap);

  hb_semset *s = hb_sem_by_id(id);
  if (s == NULL) return -1;
  if (cmd == IPC_RMID) {
    __atomic_store_n(&s->used, 0, __ATOMIC_RELEASE);
    return 0;
  }
  if (cmd == IPC_STAT) {
    if (arg.buf == NULL) {
      errno = EFAULT;
      return -1;
    }
    memset(arg.buf, 0, sizeof *arg.buf);
    arg.buf->sem_nsems = (unsigned short)s->nsems;
    arg.buf->sem_perm.uid = geteuid();
    arg.buf->sem_perm.cuid = geteuid();
    arg.buf->sem_perm.gid = getegid();
    arg.buf->sem_perm.cgid = getegid();
    arg.buf->sem_perm.mode = 0600;
    return 0;
  }
  if (cmd != GETVAL && cmd != GETPID && cmd != SETVAL) {
    errno = EINVAL;
    return -1;
  }
  if (semnum < 0 || semnum >= s->nsems) {
    errno = EINVAL;
    return -1;
  }
  hb_sem *m = &s->sems[semnum];
  if (cmd == GETVAL) return hb_sem_value(__atomic_load_n(&m->word, __ATOMIC_ACQUIRE));
  if (cmd == GETPID) return hb_sem_pid(__atomic_load_n(&m->word, __ATOMIC_ACQUIRE));
  if (arg.val < 0 || arg.val > HB_SEMVMX) {
    errno = ERANGE;
    return -1;
  }
  __atomic_store_n(&m->word, hb_sem_pack(arg.val, (int)getpid()), __ATOMIC_RELEASE);
  return 0;
}

/* The semaphore table has to exist before Postgres forks its first child, so make it as the library loads. */
__attribute__((constructor)) static void hb_shim_init(void) {
  hb_sem_init();
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
HB_INTERPOSE(hb_semget, semget);
HB_INTERPOSE(hb_semop, semop);
HB_INTERPOSE(hb_semctl, semctl);
