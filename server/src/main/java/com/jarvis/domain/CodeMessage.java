package com.jarvis.domain;

/**
 * {@code { code, message }} error body used by the artifact-detail route, matching the
 * TS chat route's bespoke 404 {@code { code: 404, message: "制品不存在" }} (distinct from
 * the global {@code { error }} shape used elsewhere).
 */
public record CodeMessage(int code, String message) {
}
