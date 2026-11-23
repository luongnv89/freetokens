/*
 * clockshift: an LD_PRELOAD shim that moves the wall clock forward (#782).
 *
 * CI re-runs the Python and app test suites with this shim loaded so a test
 * that mixes a fixed calendar date with the real clock fails in the PR that
 * adds it, not on main months later. Use it through
 * scripts/ci/run-clock-shifted.sh rather than directly.
 *
 * Only wall-clock reads move: clock_gettime(CLOCK_REALTIME*), gettimeofday()
 * and time(). Monotonic clocks are untouched, so timers, timeouts and
 * durations behave normally. The offset comes from CLOCKSHIFT_DAYS (integer,
 * may be negative); unset or 0 means no shift.
 *
 * Python (time.time, date.today, datetime.now), Node (Date, Date.now) and git
 * all read the wall clock through these libc calls. Statically linked Go
 * binaries such as esbuild do not, which is fine: they never read dates.
 *
 * Known limits (none affects the suites today):
 *  - A child started with a scrubbed environment (no LD_PRELOAD or
 *    CLOCKSHIFT_DAYS) runs on the real clock: a coverage gap, never a false
 *    failure. Pass dict(os.environ, ...) / {...process.env} to keep the shift.
 *  - Absolute REALTIME deadlines (pthread_cond_timedwait on the default
 *    clock, sem_timedwait) are not compensated and would land N days out.
 *    Python and Node time their waits on monotonic clocks.
 *  - Only fixed dates less than the shift (400 days) ahead are caught; a
 *    fuse set further out still detonates later.
 */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <stdlib.h>
#include <sys/time.h>
#include <time.h>

static long long offset_seconds(void) {
    static long long cached = 0;
    static int ready = 0;
    if (!__atomic_load_n(&ready, __ATOMIC_ACQUIRE)) {
        const char *days = getenv("CLOCKSHIFT_DAYS");
        /* Racing first calls compute the same value; publish it before ready. */
        __atomic_store_n(&cached, days ? atoll(days) * 86400LL : 0, __ATOMIC_RELAXED);
        __atomic_store_n(&ready, 1, __ATOMIC_RELEASE);
    }
    return __atomic_load_n(&cached, __ATOMIC_RELAXED);
}

static int is_wall_clock(clockid_t id) {
    return id == CLOCK_REALTIME || id == CLOCK_REALTIME_COARSE;
}

int clock_gettime(clockid_t id, struct timespec *ts) {
    static int (*real)(clockid_t, struct timespec *) = NULL;
    if (!real) real = dlsym(RTLD_NEXT, "clock_gettime");
    int rc = real(id, ts);
    if (rc == 0 && ts && is_wall_clock(id)) ts->tv_sec += offset_seconds();
    return rc;
}

int gettimeofday(struct timeval *restrict tv, void *restrict tz) {
    static int (*real)(struct timeval *restrict, void *restrict) = NULL;
    if (!real) real = dlsym(RTLD_NEXT, "gettimeofday");
    int rc = real(tv, tz);
    if (rc == 0 && tv) tv->tv_sec += offset_seconds();
    return rc;
}

time_t time(time_t *out) {
    struct timespec ts;
    clock_gettime(CLOCK_REALTIME, &ts);
    if (out) *out = ts.tv_sec;
    return ts.tv_sec;
}
