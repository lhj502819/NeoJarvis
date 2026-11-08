package com.jarvis.domain;

import com.fasterxml.jackson.databind.JsonNode;

/** PUT /api/docs/{kind}/{key} body — the document body as arbitrary JSON. */
public record AgentDocUpsertRequest(JsonNode data) {
}
