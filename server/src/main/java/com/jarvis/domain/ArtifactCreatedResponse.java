package com.jarvis.domain;

/** Response for {@code POST /api/artifacts}: the id of the newly stored artifact. */
public record ArtifactCreatedResponse(String id) {
}
