package com.jarvis.mapper;

import com.jarvis.domain.ConversationRow;
import java.util.List;
import java.util.Optional;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

/**
 * User↔Jarvis conversation reads (ports the TS chat route). Messages are pulled newest
 * first (capped at 500) then re-ordered ascending, joining the optional artifact for its
 * type/title. {@code timestamp} is quoted (reserved word in MySQL/H2).
 */
@Mapper
public interface ConversationMapper {

    @Select("SELECT id FROM user_jarvis_sessions WHERE user_id = #{userId} "
            + "ORDER BY updated_at DESC LIMIT 1")
    Optional<String> findLatestSessionId(@Param("userId") String userId);

    @Select("""
            SELECT role, content, `timestamp`,
                   artifact_id AS artifactId, artifact_type AS artifactType,
                   artifact_title AS artifactTitle, image_ids AS imageIds
            FROM (
              SELECT m.role, m.content, m.`timestamp`, m.artifact_id, m.image_ids,
                     a.type AS artifact_type, a.title AS artifact_title
              FROM user_jarvis_messages m
              LEFT JOIN jarvis_artifacts a ON m.artifact_id = a.id
              WHERE m.session_id = #{sessionId}
              ORDER BY m.`timestamp` DESC LIMIT 500
            ) sub ORDER BY `timestamp` ASC
            """)
    List<ConversationRow> listMessages(@Param("sessionId") String sessionId);
}
