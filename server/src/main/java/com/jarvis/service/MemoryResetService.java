package com.jarvis.service;

import com.jarvis.mapper.MemoryResetMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 清空一个用户的"记忆"—— 对话历史 + 执行痕迹(任务/子任务/轨迹/工具调用/A2A 沟通/聊天图片/
 * 小弟会话/运行态)。保留团队小弟、制品库、凭证、MCP/技能配置。
 *
 * <p>整个清除在一个事务里按固定顺序删,顺序见 {@link MemoryResetMapper}:turns 无 user_id
 * 必须最先删,父表删除靠 FK 级联清各自子表。
 */
@Service
public class MemoryResetService {

    private static final Logger log = LoggerFactory.getLogger(MemoryResetService.class);

    private final MemoryResetMapper memoryResetMapper;

    public MemoryResetService(MemoryResetMapper memoryResetMapper) {
        this.memoryResetMapper = memoryResetMapper;
    }

    @Transactional
    public void clearMemory(String userId) {
        memoryResetMapper.deleteSubtaskTurns(userId);
        memoryResetMapper.deleteTasks(userId);
        memoryResetMapper.deleteAgentThreads(userId);
        memoryResetMapper.deleteToolTraces(userId);
        memoryResetMapper.deleteChatImages(userId);
        memoryResetMapper.deleteClaudeSessions(userId);
        memoryResetMapper.deleteState(userId);
        memoryResetMapper.deleteConversationSessions(userId);
        log.info("clear_memory userId={}", userId);
    }
}
