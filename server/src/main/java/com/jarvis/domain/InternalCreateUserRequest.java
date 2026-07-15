package com.jarvis.domain;

import jakarta.validation.constraints.NotBlank;

/**
 * Body for {@code POST /api/internal/users} — the internal user-create call made by the TS
 * intelligence layer's {@code createUser} (src/auth/users.ts). Carries no invite code: the
 * invite gate lives in the caller (auth.ts / the public register route), not the data layer.
 */
public record InternalCreateUserRequest(
        @NotBlank(message = "用户名不能为空") String username,
        String displayName,
        @NotBlank(message = "密码不能为空") String password) {
}
