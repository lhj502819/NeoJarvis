package com.jarvis.util;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Locale;
import java.util.Map;

/**
 * On-disk artifact content store. Writes the artifact body under
 * {@code ~/.jarvis/artifacts/{userId}/{artifactId}.{ext}} and returns a {@code file://}
 * URI that is stored in the DB (column {@code jarvis_artifacts.uri}) in place of the
 * old TEXT {@code content} column.
 *
 * <p>Rationale (spec §"文件存本机 + MySQL 存 URI 引用"):
 * <ul>
 *   <li>keeps DB rows tiny + no 64KB TEXT truncation for long artifacts</li>
 *   <li>future OSS migration is a URI swap ({@code file://} -&gt; {@code https://});
 *       no schema/architecture change</li>
 *   <li>the desktop shell (Electron) reads local files via IPC; browser/OSS reads via
 *       fetch — the front-end adapter picks based on the URI scheme</li>
 * </ul>
 *
 * <p>The class is intentionally static — it is dependency-free, has no injected config,
 * and is called from the service layer (see {@code ArtifactService}).
 */
public final class ArtifactStore {

    /** Root directory for artifact files. Resolved from the JVM user home. */
    public static final String ARTIFACT_ROOT =
            System.getProperty("user.home") + "/.jarvis/artifacts";

    /** {@code file://} URI prefix used both when writing (returned) and reading (parsed). */
    public static final String FILE_URI_PREFIX = "file://";

    /**
     * Known code languages → file extension. Kept in sync with the front-end
     * (web/src/components/ArtifactPanel.tsx) for a consistent user-visible ext.
     */
    private static final Map<String, String> LANG_EXT = Map.ofEntries(
            Map.entry("typescript", "ts"),
            Map.entry("javascript", "js"),
            Map.entry("tsx", "tsx"),
            Map.entry("jsx", "jsx"),
            Map.entry("python", "py"),
            Map.entry("java", "java"),
            Map.entry("go", "go"),
            Map.entry("rust", "rs"),
            Map.entry("ruby", "rb"),
            Map.entry("json", "json"),
            Map.entry("yaml", "yaml"),
            Map.entry("bash", "sh"),
            Map.entry("shell", "sh"),
            Map.entry("sql", "sql"),
            Map.entry("css", "css"),
            Map.entry("html", "html"),
            Map.entry("markdown", "md"));

    private ArtifactStore() {
    }

    /**
     * Write {@code content} to
     * {@code {ARTIFACT_ROOT}/{userId}/{artifactId}.{ext}} (UTF-8, creating parents as
     * needed) and return the absolute {@code file://} URI. Called on every INSERT / PATCH
     * — PATCH reuses the same path so the file is overwritten in place.
     *
     * <p>The extension is inferred from {@code type} (markdown / html / mermaid / code) and,
     * for {@code type=code}, the optional {@code language}. Unknown languages / types fall
     * back to {@code .txt} so the file is still readable / previewable.
     */
    public static String write(String userId, String artifactId, String type, String language,
            String content) {
        if (userId == null || userId.isBlank()) {
            throw new IllegalArgumentException("userId is required");
        }
        if (artifactId == null || artifactId.isBlank()) {
            throw new IllegalArgumentException("artifactId is required");
        }
        String ext = inferExtension(type, language);
        Path file = Paths.get(ARTIFACT_ROOT, userId, artifactId + "." + ext);
        try {
            Files.createDirectories(file.getParent());
            Files.writeString(file, content == null ? "" : content, StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new UncheckedIOException(
                    "failed to write artifact file: " + file.toAbsolutePath(), e);
        }
        return FILE_URI_PREFIX + file.toAbsolutePath();
    }

    /**
     * Read the artifact body from a {@code file://} URI (written by {@link #write}).
     * Throws {@link IllegalArgumentException} for non-file schemes — remote URIs are the
     * caller's responsibility (front-end adapter fetches over HTTP; server does not proxy).
     */
    public static String read(String uri) {
        if (uri == null || uri.isBlank()) {
            throw new IllegalArgumentException("uri is required");
        }
        if (!uri.startsWith(FILE_URI_PREFIX)) {
            throw new IllegalArgumentException(
                    "unsupported artifact URI scheme (expected file://): " + uri);
        }
        Path file = Paths.get(uri.substring(FILE_URI_PREFIX.length()));
        try {
            return Files.readString(file, StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new UncheckedIOException(
                    "failed to read artifact file: " + file.toAbsolutePath(), e);
        }
    }

    /**
     * Extension inference (visible for tests). {@code type=code} respects the
     * {@code language} map; everything else has a fixed ext per artifact type.
     */
    public static String inferExtension(String type, String language) {
        String t = type == null ? "" : type.toLowerCase(Locale.ROOT);
        return switch (t) {
            case "markdown" -> "md";
            case "html" -> "html";
            case "mermaid" -> "mmd";
            case "code" -> languageExt(language);
            default -> "txt";
        };
    }

    private static String languageExt(String language) {
        if (language == null || language.isBlank()) {
            return "txt";
        }
        return LANG_EXT.getOrDefault(language.toLowerCase(Locale.ROOT), "txt");
    }
}
