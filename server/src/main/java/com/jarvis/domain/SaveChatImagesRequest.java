package com.jarvis.domain;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import java.util.List;

/**
 * Body for {@code POST /api/chat-images} (ports the TS {@code saveChatImages}). Each image
 * carries its media type and base64 payload; the service assigns ids and returns them.
 */
public record SaveChatImagesRequest(
        @NotEmpty @Valid List<Image> images) {

    /** One inbound image: media type + base64-encoded data (stored in the TEXT column). */
    public record Image(
            @NotBlank String mediaType,
            @NotBlank String data) {
    }
}
