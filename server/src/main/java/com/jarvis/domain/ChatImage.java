package com.jarvis.domain;

/** A stored chat image (base64) backing {@code GET /api/chat-image/{id}}. */
public record ChatImage(String mediaType, String data) {
}
