package com.jarvis.util;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Base64;
import java.util.Locale;
import java.util.Map;

/**
 * On-disk chat-image content store. Writes the decoded image bytes under
 * {@code ~/.jarvis/chat-images/{userId}/{imageId}.{ext}} and returns a {@code file://}
 * URI that is stored in the DB (column {@code jarvis_chat_images.uri}) in place of the
 * old TEXT {@code data} column.
 *
 * <p>Rationale (spec §"文件存本机 + MySQL 存 URI 引用" — symmetric to
 * {@link ArtifactStore}): the previous shape stored the base64 payload in a MySQL
 * {@code TEXT} column, whose 64KB ceiling truncated a plain 100KB PNG (base64 blows it
 * up ~33% to ~133KB) — producing the runtime {@code Data truncation: Data too long for
 * column 'data'} error. Files-on-disk keeps DB rows tiny, and a future OSS migration is
 * just a URI swap.
 *
 * <p>Unlike {@link ArtifactStore} (UTF-8 text), chat images are binary — write/read use
 * raw bytes and the caller supplies the base64 payload the browser POSTs.
 *
 * <p>The class is intentionally static — it is dependency-free, has no injected config,
 * and is called from the service layer (see {@code ConversationService}).
 */
public final class ChatImageStore {

    /** Root directory for chat-image files. Resolved from the JVM user home. */
    public static final String CHAT_IMAGE_ROOT =
            System.getProperty("user.home") + "/.jarvis/chat-images";

    /** {@code file://} URI prefix used both when writing (returned) and reading (parsed). */
    public static final String FILE_URI_PREFIX = "file://";

    /**
     * Media-type → file extension. Kept small on purpose — the frontend only ever
     * uploads the four common browser-image formats; everything else falls back to
     * {@code .bin} so the file is at least still recoverable.
     */
    private static final Map<String, String> MEDIA_EXT = Map.of(
            "image/png", "png",
            "image/jpeg", "jpg",
            "image/jpg", "jpg",
            "image/gif", "gif",
            "image/webp", "webp");

    private ChatImageStore() {
    }

    /**
     * Decode {@code base64Data} and write the raw bytes to
     * {@code {CHAT_IMAGE_ROOT}/{userId}/{imageId}.{ext}} (creating parents as needed),
     * returning the absolute {@code file://} URI. The extension is derived from
     * {@code mediaType} (falls back to {@code .bin} for unknown types).
     */
    public static String write(String userId, String imageId, String mediaType,
            String base64Data) {
        if (userId == null || userId.isBlank()) {
            throw new IllegalArgumentException("userId is required");
        }
        if (imageId == null || imageId.isBlank()) {
            throw new IllegalArgumentException("imageId is required");
        }
        if (base64Data == null) {
            throw new IllegalArgumentException("base64Data is required");
        }
        byte[] bytes = Base64.getDecoder().decode(base64Data);
        String ext = inferExtension(mediaType);
        Path file = Paths.get(CHAT_IMAGE_ROOT, userId, imageId + "." + ext);
        try {
            Files.createDirectories(file.getParent());
            Files.write(file, bytes);
        } catch (IOException e) {
            throw new UncheckedIOException(
                    "failed to write chat-image file: " + file.toAbsolutePath(), e);
        }
        return FILE_URI_PREFIX + file.toAbsolutePath();
    }

    /**
     * Read the image bytes from a {@code file://} URI (written by {@link #write}).
     * Throws {@link IllegalArgumentException} for non-file schemes — remote URIs are the
     * caller's responsibility (front-end fetches over HTTP; server does not proxy).
     */
    public static byte[] read(String uri) {
        if (uri == null || uri.isBlank()) {
            throw new IllegalArgumentException("uri is required");
        }
        if (!uri.startsWith(FILE_URI_PREFIX)) {
            throw new IllegalArgumentException(
                    "unsupported chat-image URI scheme (expected file://): " + uri);
        }
        Path file = Paths.get(uri.substring(FILE_URI_PREFIX.length()));
        try {
            return Files.readAllBytes(file);
        } catch (IOException e) {
            throw new UncheckedIOException(
                    "failed to read chat-image file: " + file.toAbsolutePath(), e);
        }
    }

    /**
     * Extension inference (visible for tests). Falls back to {@code bin} so an unknown
     * media type never blocks the write — the file is still recoverable and the URI is
     * still valid.
     */
    public static String inferExtension(String mediaType) {
        if (mediaType == null || mediaType.isBlank()) {
            return "bin";
        }
        return MEDIA_EXT.getOrDefault(mediaType.toLowerCase(Locale.ROOT), "bin");
    }
}
