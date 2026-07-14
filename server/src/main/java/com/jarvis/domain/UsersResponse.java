package com.jarvis.domain;

import java.util.List;

/** Body for {@code GET /api/admin/users} (mirrors the TS {@code {users}} payload). */
public record UsersResponse(List<User> users) {
}
