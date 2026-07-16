package com.jarvis.mapper;

import com.jarvis.domain.ConversationRow;
import java.util.List;
import java.util.Optional;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

/**
 * User↔Jarvis conversation reads (ports the TS chat route). Messages are pulled newest
 * first (capped at 500) then re-ordered ascending, joining the optional artifact for its
 * type/title. {@code timestamp} is quoted (reserved word in MySQL/H2).
 *
 * <p>A2.5-3 adds the write side (ports {@code addToBuffer}/{@code getOrCreateSession}):
 * session create/touch use ISO-8601 TEXT timestamps, while a message's {@code timestamp}
 * is a BIGINT epoch-millis — the two columns must never be confused.
 */
@Mapper
public interface ConversationMapper {

    @Select("SELECT id FROM user_jarvis_sessions WHERE user_id = #{userId} "
            + "ORDER BY updated_at DESC LIMIT 1")
    Optional<String> findLatestSessionId(@Param("userId") String userId);

    /** Create a fresh session (ISO-8601 TEXT created_at/updated_at), mirroring TS getOrCreateSession. */
    @Insert("INSERT INTO user_jarvis_sessions (id, user_id, created_at, updated_at) "
            + "VALUES (#{id}, #{userId}, #{createdAt}, #{updatedAt})")
    void insertSession(@Param("id") String id, @Param("userId") String userId,
            @Param("createdAt") String createdAt, @Param("updatedAt") String updatedAt);

    /** Bump a session's updated_at (ISO-8601 TEXT) after appending a message (mirrors TS). */
    @Update("UPDATE user_jarvis_sessions SET updated_at = #{updatedAt} WHERE id = #{id}")
    void touchSession(@Param("id") String id, @Param("updatedAt") String updatedAt);

    /**
     * Append one message (ports TS addToBuffer). {@code timestamp} is BIGINT epoch-millis
     * (quoted — reserved word); {@code artifactId}/{@code imageIds} are nullable.
     *
     * <p>PG 的 {@code RETURNING id} 让 INSERT 直接吐自增主键,MyBatis @Select 用来接
     * 单值返回。用于工具调用 traces 后续按 message_id 关联。
     */
    @Select("INSERT INTO user_jarvis_messages "
            + "(session_id, user_id, role, content, \"timestamp\", artifact_id, image_ids) "
            + "VALUES (#{sessionId}, #{userId}, #{role}, #{content}, #{timestamp}, "
            + "#{artifactId}, #{imageIds}) RETURNING id")
    long insertMessage(@Param("sessionId") String sessionId, @Param("userId") String userId,
            @Param("role") String role, @Param("content") String content,
            @Param("timestamp") long timestamp, @Param("artifactId") String artifactId,
            @Param("imageIds") String imageIds);

    @Select("""
            SELECT id, role, content, "timestamp",
                   artifact_id AS artifactId, artifact_type AS artifactType,
                   artifact_title AS artifactTitle, image_ids AS imageIds
            FROM (
              SELECT m.id, m.role, m.content, m."timestamp", m.artifact_id, m.image_ids,
                     a.type AS artifact_type, a.title AS artifact_title
              FROM user_jarvis_messages m
              LEFT JOIN jarvis_artifacts a ON m.artifact_id = a.id
              WHERE m.session_id = #{sessionId}
              ORDER BY m."timestamp" DESC LIMIT 500
            ) sub ORDER BY "timestamp" ASC
            """)
    List<ConversationRow> listMessages(@Param("sessionId") String sessionId);
}
