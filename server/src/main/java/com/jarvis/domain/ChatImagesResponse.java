package com.jarvis.domain;

import java.util.List;

/** Response for {@code POST /api/chat-images}: the generated image ids, in input order. */
public record ChatImagesResponse(List<String> ids) {
}
