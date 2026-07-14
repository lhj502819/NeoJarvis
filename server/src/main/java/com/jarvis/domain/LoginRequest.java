package com.jarvis.domain;

import jakarta.validation.constraints.NotBlank;

/** Body for {@code POST /api/auth/login} (mirrors the TS "用户名和密码不能为空" check). */
public record LoginRequest(
        @NotBlank(message = "用户名不能为空") String username,
        @NotBlank(message = "密码不能为空") String password) {
}
