package com.jarvis.domain;

import com.fasterxml.jackson.databind.JsonNode;

/** One document in a list response: its key within the kind plus the parsed JSON body. */
public record AgentDocItem(String key, JsonNode data) {
}
