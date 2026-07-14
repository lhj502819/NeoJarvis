package com.jarvis.web;

/** Thrown when authentication is missing/invalid or credentials are wrong -> HTTP 401. */
public class UnauthorizedException extends RuntimeException {

    public UnauthorizedException(String message) {
        super(message);
    }
}
