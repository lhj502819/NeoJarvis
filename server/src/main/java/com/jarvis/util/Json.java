package com.jarvis.util;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.Map;

/**
 * Parses the JSON-in-TEXT columns (tools/skills/context/topics/depends_on) the way the
 * old TS data layer did. Kept tiny and dependency-free (reuses Jackson already on the
 * classpath) rather than pulling in MyBatis TypeHandlers — the mapping is simple and
 * the conversion belongs to the service layer that assembles the API records.
 */
public final class Json {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final TypeReference<List<String>> STRING_LIST = new TypeReference<>() {
    };
    private static final TypeReference<Map<String, Object>> STRING_MAP = new TypeReference<>() {
    };

    private Json() {
    }

    /** Parse a JSON array, returning an empty list when the column is null/blank. */
    public static List<String> stringList(String raw) {
        if (raw == null || raw.isBlank()) {
            return List.of();
        }
        try {
            return MAPPER.readValue(raw, STRING_LIST);
        } catch (Exception e) {
            throw new IllegalStateException("failed to parse JSON string array: " + raw, e);
        }
    }

    /**
     * Parse a JSON array, returning {@code null} when the column is null/blank so the
     * field is omitted from JSON (mirrors TS {@code value ? JSON.parse : undefined}).
     */
    public static List<String> stringListOrNull(String raw) {
        return (raw == null || raw.isBlank()) ? null : stringList(raw);
    }

    /**
     * Serialise a string list to JSON TEXT for storage, returning {@code null} when the
     * list is null so an absent {@code dependsOn} stays NULL (mirrors TS
     * {@code value ? JSON.stringify(value) : null}). An empty list serialises to {@code "[]"}.
     */
    public static String stringify(List<String> list) {
        if (list == null) {
            return null;
        }
        try {
            return MAPPER.writeValueAsString(list);
        } catch (Exception e) {
            throw new IllegalStateException("failed to serialise JSON string array", e);
        }
    }

    /** Parse a JSON object, returning an empty map when the column is null/blank. */
    public static Map<String, Object> map(String raw) {
        if (raw == null || raw.isBlank()) {
            return Map.of();
        }
        try {
            return MAPPER.readValue(raw, STRING_MAP);
        } catch (Exception e) {
            throw new IllegalStateException("failed to parse JSON object: " + raw, e);
        }
    }
}
