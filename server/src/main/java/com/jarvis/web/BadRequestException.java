package com.jarvis.web;

/** Thrown for invalid input the client can fix (e.g. duplicate username) -> HTTP 400. */
public class BadRequestException extends RuntimeException {

    public BadRequestException(String message) {
        super(message);
    }
}
