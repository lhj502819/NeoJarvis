package com.jarvis.domain;

import jakarta.validation.constraints.NotNull;

/** Body for {@code PUT /api/admin/invite-code}. Empty string closes the invite gate. */
public record InviteCodeRequest(@NotNull(message = "code 字段必须是字符串") String code) {
}
