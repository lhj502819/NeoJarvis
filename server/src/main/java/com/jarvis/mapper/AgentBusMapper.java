package com.jarvis.mapper;

import com.jarvis.domain.AgentMessageRow;
import com.jarvis.domain.AgentThreadRow;
import java.util.List;
import java.util.Optional;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

/**
 * Jarvis↔Agent message-bus persistence (ports the {@code pool.query} calls in the TS
 * {@code MessageBus}). Explicit column projections (never {@code SELECT *}) so binding never
 * relies on ordering; {@code timestamp} is quoted (reserved word in MySQL/H2) and is ISO-8601
 * TEXT, so an ASC/DESC ORDER BY on it is chronological. All reads are global (the old TS bus
 * never scoped conversations by user), so no {@code user_id} appears in any WHERE clause.
 */
@Mapper
public interface AgentBusMapper {

    // ─── thread reads ───

    @Select("SELECT id, user_id, participants, created_at, updated_at "
            + "FROM jarvis_agent_threads WHERE id = #{id}")
    Optional<AgentThreadRow> findThread(@Param("id") String id);

    /** Threads whose JSON participants array contains {@code agentId} (LIKE %"agentId"%). */
    @Select("SELECT id, user_id, participants, created_at, updated_at "
            + "FROM jarvis_agent_threads WHERE participants LIKE #{pattern}")
    List<AgentThreadRow> findThreadsByParticipant(@Param("pattern") String pattern);

    @Select("SELECT id, user_id, participants, created_at, updated_at "
            + "FROM jarvis_agent_threads ORDER BY updated_at DESC LIMIT #{limit}")
    List<AgentThreadRow> listThreads(@Param("limit") int limit);

    // ─── message reads ───

    @Select("SELECT id, thread_id, sender, receiver, role, parts, \"timestamp\", metadata "
            + "FROM jarvis_agent_messages WHERE thread_id = #{threadId} ORDER BY \"timestamp\" ASC")
    List<AgentMessageRow> listMessagesAsc(@Param("threadId") String threadId);

    @Select("SELECT id, thread_id, sender, receiver, role, parts, \"timestamp\", metadata "
            + "FROM jarvis_agent_messages WHERE thread_id = #{threadId} "
            + "ORDER BY \"timestamp\" DESC LIMIT #{limit}")
    List<AgentMessageRow> listRecentMessages(@Param("threadId") String threadId,
            @Param("limit") int limit);

    // ─── writes ───

    @Insert("INSERT INTO jarvis_agent_threads (id, user_id, participants, created_at, updated_at) "
            + "VALUES (#{id}, #{userId}, #{participants}, #{createdAt}, #{updatedAt})")
    void insertThread(@Param("id") String id, @Param("userId") String userId,
            @Param("participants") String participants, @Param("createdAt") String createdAt,
            @Param("updatedAt") String updatedAt);

    @Update("UPDATE jarvis_agent_threads SET participants = #{participants}, updated_at = #{updatedAt} "
            + "WHERE id = #{id}")
    void updateThreadParticipants(@Param("id") String id, @Param("participants") String participants,
            @Param("updatedAt") String updatedAt);

    @Update("UPDATE jarvis_agent_threads SET updated_at = #{updatedAt} WHERE id = #{id}")
    void touchThread(@Param("id") String id, @Param("updatedAt") String updatedAt);

    @Insert("INSERT INTO jarvis_agent_messages "
            + "(id, thread_id, sender, receiver, role, parts, \"timestamp\", metadata) "
            + "VALUES (#{id}, #{threadId}, #{sender}, #{receiver}, #{role}, #{parts}, "
            + "#{timestamp}, #{metadata})")
    void insertMessage(@Param("id") String id, @Param("threadId") String threadId,
            @Param("sender") String sender, @Param("receiver") String receiver,
            @Param("role") String role, @Param("parts") String parts,
            @Param("timestamp") String timestamp, @Param("metadata") String metadata);

    @Select("SELECT COUNT(*) FROM jarvis_agent_threads")
    long countThreads();

    /**
     * Delete the {@code n} oldest threads (by updated_at ASC); their messages cascade via the
     * FK. The derived-table wrapper is required because MySQL forbids referencing the target
     * table directly in a DELETE subquery (mirrors the TS trim under MAX_CONVERSATIONS).
     */
    @Delete("DELETE FROM jarvis_agent_threads WHERE id IN ("
            + "SELECT id FROM (SELECT id FROM jarvis_agent_threads "
            + "ORDER BY updated_at ASC LIMIT #{n}) AS oldest)")
    void deleteOldest(@Param("n") int n);
}
