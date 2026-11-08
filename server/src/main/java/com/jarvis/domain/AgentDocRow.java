package com.jarvis.domain;

/**
 * One row of {@code jarvis_agent_docs} — the generic document store behind the TS sidecar
 * migration (docs/superagent-design-v2.md P0). {@code data} is the raw JSONB text; the
 * service layer parses it so the REST surface speaks plain JSON.
 */
public record AgentDocRow(String docKey, String data) {
}
