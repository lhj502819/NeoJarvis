package com.jarvis.auth;

/**
 * Resolves the current request's user id. Temporary A2 stub — always returns
 * {@code "local"} (single-user desktop mode). A4 will replace {@link #currentUserId()}
 * with a real per-request lookup (auth filter + thread-local), keeping this call site
 * stable so controllers/services need no changes.
 */
public final class UserContext {

    /** Fixed placeholder user id until A4 wires real authentication. */
    public static final String LOCAL_USER = "local";

    private UserContext() {
    }

    public static String currentUserId() {
        return LOCAL_USER;
    }
}
