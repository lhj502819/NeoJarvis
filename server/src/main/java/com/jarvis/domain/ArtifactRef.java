package com.jarvis.domain;

/** Artifact reference attached to a conversation message ({@code {id,type,title}}). */
public record ArtifactRef(String id, String type, String title) {
}
