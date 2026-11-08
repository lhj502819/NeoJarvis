package com.jarvis.domain;

import java.util.List;

/** GET /api/docs/{kind} response — newest (highest id) first. */
public record AgentDocListResponse(List<AgentDocItem> items) {
}
