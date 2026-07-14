package com.jarvis.web;

/** Thrown when an authenticated user lacks the required privilege (e.g. admin) -> HTTP 403. */
public class ForbiddenException extends RuntimeException {

    public ForbiddenException(String message) {
        super(message);
    }
}
