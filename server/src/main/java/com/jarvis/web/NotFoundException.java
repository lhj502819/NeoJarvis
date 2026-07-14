package com.jarvis.web;

/** Thrown by services/controllers when a requested resource does not exist -> HTTP 404. */
public class NotFoundException extends RuntimeException {

    public NotFoundException(String message) {
        super(message);
    }
}
