package com.jarvis.auth;

/**
 * Resolves the current request's authenticated user via a {@link ThreadLocal} populated
 * by {@link JwtAuthFilter}. The {@link #currentUserId()} call site is unchanged from the
 * A2 stub so controllers/services need no edits.
 *
 * <p>When nothing is bound (non-web threads, or web-slice tests that bypass the filter),
 * {@link #currentUserId()} falls back to {@link #LOCAL_USER}. The filter is the sole
 * writer and MUST call {@link #clear()} in a {@code finally} block to avoid leaking a
 * user id onto a pooled request thread.
 */
public final class UserContext {

    /** Fallback user id when no authenticated principal is bound (local single-user mode). */
    public static final String LOCAL_USER = "local";

    private static final ThreadLocal<Principal> CURRENT = new ThreadLocal<>();

    private UserContext() {
    }

    /** The authenticated user id, or {@link #LOCAL_USER} when nothing is bound. */
    public static String currentUserId() {
        Principal p = CURRENT.get();
        return p != null ? p.userId() : LOCAL_USER;
    }

    /** The authenticated username, or {@link #LOCAL_USER} when nothing is bound. */
    public static String currentUsername() {
        Principal p = CURRENT.get();
        return p != null ? p.username() : LOCAL_USER;
    }

    /** True when a real principal is bound to the current thread. */
    public static boolean isAuthenticated() {
        return CURRENT.get() != null;
    }

    /** Bind the resolved user to the current request thread (filter only). */
    public static void set(String userId, String username) {
        CURRENT.set(new Principal(userId, username));
    }

    /** Remove the bound user — MUST be called in the filter's {@code finally}. */
    public static void clear() {
        CURRENT.remove();
    }

    private record Principal(String userId, String username) {
    }
}
