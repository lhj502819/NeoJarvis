package com.jarvis.service;

import com.jarvis.domain.McpPrefsResponse;
import com.jarvis.mapper.McpPrefsMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * MCP enable/disable preferences (ports src/jarvis/mcp-prefs.ts). Server owns only the blacklist
 * table — it does NOT scan the user's local {@code ~/.claude.json} (client-side hub responsibility).
 * Sibling of {@link SkillPrefsService}: enabling deletes the row, disabling inserts it idempotently.
 */
@Service
public class McpPrefsService {

    private static final Logger log = LoggerFactory.getLogger(McpPrefsService.class);

    private final McpPrefsMapper mcpPrefsMapper;

    public McpPrefsService(McpPrefsMapper mcpPrefsMapper) {
        this.mcpPrefsMapper = mcpPrefsMapper;
    }

    @Transactional(readOnly = true)
    public McpPrefsResponse getDisabled(String userId) {
        log.debug("get_mcp_prefs userId={}", userId);
        return McpPrefsResponse.of(mcpPrefsMapper.listDisabled(userId));
    }

    @Transactional
    public void setEnabled(String userId, String name, boolean enabled) {
        if (enabled) {
            mcpPrefsMapper.delete(userId, name);
        } else {
            mcpPrefsMapper.insertIgnore(userId, name);
        }
        log.debug("set_mcp_enabled userId={} name={} enabled={}", userId, name, enabled);
    }
}
