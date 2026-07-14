package com.jarvis.domain;

import jakarta.validation.constraints.NotBlank;

/**
 * Body for {@code POST /api/auth/register}. {@code username} + {@code password} required
 * (mirrors the TS route's "用户名和密码不能为空" check); {@code displayName} defaults to
 * the username when omitted, {@code inviteCode} is validated only when a code is active.
 */
public record RegisterRequest(
        @NotBlank(message = "用户名不能为空") String username,
        @NotBlank(message = "密码不能为空") String password,
        String displayName,
        String inviteCode) {
}
