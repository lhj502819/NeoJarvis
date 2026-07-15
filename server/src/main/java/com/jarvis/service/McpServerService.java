package com.jarvis.service;

import com.jarvis.domain.AddMcpServerRequest;
import com.jarvis.domain.McpServer;
import com.jarvis.domain.McpServerRow;
import com.jarvis.domain.ResolvedMcpServer;
import com.jarvis.domain.UpdateMcpServerRequest;
import com.jarvis.mapper.McpServerMapper;
import com.jarvis.util.CryptoUtil;
import com.jarvis.util.Json;
import com.jarvis.web.BadRequestException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * User MCP server management. Ports src/auth/mcp-servers.ts. The stored {@code env} map is
 * AES-GCM encrypted via {@link CryptoUtil} and NEVER returned in full by the redacted views —
 * {@link #list}/{@link #add}/{@link #update} hand back the {@link McpServer} view carrying
 * only {@code envKeys}. The resolved (decrypted) view {@link #resolve} returns the plaintext
 * env map for the intelligence layer to assemble the SDK {@code mcpServers} dict; it is
 * exposed only via the internal resolve endpoint (never the public list), mirroring the C-6
 * credential resolve split.
 */
@Service
public class McpServerService {

    private static final Logger log = LoggerFactory.getLogger(McpServerService.class);

    private final McpServerMapper mcpServerMapper;

    public McpServerService(McpServerMapper mcpServerMapper) {
        this.mcpServerMapper = mcpServerMapper;
    }

    @Transactional(readOnly = true)
    public List<McpServer> list(String userId) {
        log.debug("list_mcp_servers userId={}", userId);
        return mcpServerMapper.listByUser(userId).stream().map(McpServerService::toServer).toList();
    }

    /**
     * Resolve all enabled MCP servers with their DECRYPTED env, for the intelligence layer to
     * assemble the SDK {@code mcpServers} dict. Ports src/auth/mcp-servers.ts#resolveMcpServers:
     * only {@code enabled} servers, {@code env_enc} decrypted to the plaintext map (empty map
     * when there is no env). A server whose env fails to decrypt is skipped with a warning
     * (never the plaintext), matching the TS {@code continue}.
     *
     * <p>SECURITY — INTERNAL ONLY: returns PLAINTEXT env secrets and must only be reached via
     * X-Internal-User / dev-bypass (single-machine mode). It must never be exposed to the
     * public internet. Under the eventual keychain architecture (Plan B) this resolution moves
     * to the client and the endpoint goes away.
     */
    @Transactional(readOnly = true)
    public List<ResolvedMcpServer> resolve(String userId) {
        log.debug("resolve_mcp_servers userId={}", userId);
        List<ResolvedMcpServer> out = new ArrayList<>();
        for (McpServerRow r : mcpServerMapper.listEnabledByUser(userId)) {
            Map<String, String> env = new LinkedHashMap<>();
            if (r.envEnc() != null && !r.envEnc().isEmpty()) {
                try {
                    Json.map(CryptoUtil.decrypt(r.envEnc()))
                            .forEach((k, v) -> env.put(k, String.valueOf(v)));
                } catch (RuntimeException e) {
                    log.warn("resolve_mcp_servers decrypt failed name={}, skipping", r.name());
                    continue;
                }
            }
            out.add(new ResolvedMcpServer(r.name(), r.transport(), emptyToNull(r.command()),
                    Json.stringListOrNull(r.argsJson()), emptyToNull(r.url()), env,
                    emptyToNull(r.description())));
        }
        return out;
    }

    @Transactional
    public McpServer add(String userId, AddMcpServerRequest req) {
        validateTransport(req.transport(), req.command(), req.url());
        String now = Instant.now().toString();
        String id = UUID.randomUUID().toString();
        String envEnc = encryptEnv(req.env());
        String argsJson = serialiseArgs(req.args());

        mcpServerMapper.insert(id, userId, req.name(), req.transport(), emptyToNull(req.command()),
                argsJson, emptyToNull(req.url()), envEnc, emptyToNull(req.description()), now, now);
        log.debug("add_mcp_server userId={} name={}", userId, req.name());

        return mcpServerMapper.findByUserAndName(userId, req.name())
                .map(McpServerService::toServer)
                .orElseThrow(() -> new IllegalStateException("mcp insert lost the row"));
    }

    @Transactional
    public Optional<McpServer> update(String userId, String name, UpdateMcpServerRequest req) {
        Optional<McpServerRow> existing = mcpServerMapper.findByUserAndName(userId, name);
        if (existing.isEmpty()) {
            return Optional.empty();
        }
        McpServerRow row = existing.get();

        // Null field keeps the stored value (TS ??). env/args present -> replace (empty clears
        // to NULL); absent (null) -> keep the existing ciphertext / JSON untouched.
        String transport = req.transport() != null ? req.transport() : row.transport();
        String command = req.command() != null ? emptyToNull(req.command()) : row.command();
        String url = req.url() != null ? emptyToNull(req.url()) : row.url();
        String description = req.description() != null ? emptyToNull(req.description())
                : row.description();
        String envEnc = req.env() != null ? encryptEnv(req.env()) : row.envEnc();
        String argsJson = req.args() != null ? serialiseArgs(req.args()) : row.argsJson();
        int enabled = req.enabled() != null ? (req.enabled() ? 1 : 0) : row.enabled();
        String now = Instant.now().toString();

        mcpServerMapper.update(userId, name, transport, command, argsJson, url, envEnc,
                description, enabled, now);
        log.debug("update_mcp_server userId={} name={}", userId, name);

        return mcpServerMapper.findByUserAndName(userId, name).map(McpServerService::toServer);
    }

    @Transactional
    public boolean remove(String userId, String name) {
        boolean removed = mcpServerMapper.delete(userId, name) > 0;
        log.debug("remove_mcp_server userId={} name={} removed={}", userId, name, removed);
        return removed;
    }

    /** stdio must carry a command; sse/http must carry a url (mirrors TS addMcpServer). */
    private static void validateTransport(String transport, String command, String url) {
        if ("stdio".equals(transport) && (command == null || command.isBlank())) {
            throw new BadRequestException("stdio 类型必须提供 command");
        }
        if (("sse".equals(transport) || "http".equals(transport)) && (url == null || url.isBlank())) {
            throw new BadRequestException(transport + " 类型必须提供 url");
        }
    }

    /** Encrypt a non-empty env map to ciphertext; null/empty -> NULL column (TS parity). */
    private static String encryptEnv(Map<String, String> env) {
        if (env == null || env.isEmpty()) {
            return null;
        }
        return CryptoUtil.encrypt(Json.stringify(new LinkedHashMap<String, Object>(env)));
    }

    /** Serialise a non-empty args list to JSON; null/empty -> NULL column (TS parity). */
    private static String serialiseArgs(List<String> args) {
        return (args == null || args.isEmpty()) ? null : Json.stringify(args);
    }

    private static String emptyToNull(String value) {
        return (value == null || value.isEmpty()) ? null : value;
    }

    /** Redacted mapping: decrypt env only to expose its key names, never the values. */
    private static McpServer toServer(McpServerRow r) {
        List<String> envKeys = new ArrayList<>();
        if (r.envEnc() != null && !r.envEnc().isEmpty()) {
            try {
                envKeys = new ArrayList<>(Json.map(CryptoUtil.decrypt(r.envEnc())).keySet());
            } catch (RuntimeException e) {
                log.warn("mcp env decrypt failed name={}, redacting to empty keys", r.name());
                envKeys = List.of();
            }
        }
        return new McpServer(r.id(), r.userId(), r.name(), r.transport(),
                r.command() != null && !r.command().isEmpty() ? r.command() : null,
                Json.stringListOrNull(r.argsJson()),
                r.url() != null && !r.url().isEmpty() ? r.url() : null,
                envKeys,
                r.description() != null && !r.description().isEmpty() ? r.description() : null,
                r.enabled() == 1, r.createdAt(), r.updatedAt());
    }
}
