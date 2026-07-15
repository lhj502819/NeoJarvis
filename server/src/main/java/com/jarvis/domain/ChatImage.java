package com.jarvis.domain;

/**
 * A stored chat image backing {@code GET /api/chat-image/{id}}. v0.3 file-store shape:
 * a row carries either {@code data} (legacy base64 in TEXT) XOR {@code uri} (new file
 * pointer, {@code file://...} on disk). The controller returns bytes to the browser
 * either way — see {@code ChatImageStore} for the file layout.
 */
public record ChatImage(String mediaType, String data, String uri) {
}
