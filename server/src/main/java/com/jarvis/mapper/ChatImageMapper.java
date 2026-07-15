package com.jarvis.mapper;

import com.jarvis.domain.ChatImage;
import java.util.Optional;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

/**
 * Chat image lookup backing {@code GET /api/chat-image/{id}} (ports the TS getChatImage).
 *
 * <p>v0.3 file-store change: {@code data} is now nullable (base64 payloads live on disk
 * under {@code ~/.jarvis/chat-images}) and a new {@code uri} column carries the file
 * URI. Selects return both so the controller can hand out whichever is present (legacy
 * rows keep {@code data}, new rows carry {@code uri}). Fully symmetric to the artifact
 * mapper (see {@code ArtifactMapper} v0.3 notes).
 */
@Mapper
public interface ChatImageMapper {

    /**
     * Detail read used by the {@code /api/chat-image/{id}} endpoint. Selects both
     * {@code data} (legacy TEXT, nullable now) and {@code uri} (new file pointer) so the
     * controller can decide which one to return as bytes.
     */
    @Select("SELECT media_type AS mediaType, data, uri FROM jarvis_chat_images "
            + "WHERE id = #{id} AND user_id = #{userId}")
    Optional<ChatImage> findByIdAndUser(@Param("id") String id, @Param("userId") String userId);

    /**
     * Store one image (ports TS saveChatImages); {@code createdAt} is BIGINT epoch-millis.
     * v0.3: always writes the payload to disk and stores only {@code uri}, so callers
     * pass {@code data=null, uri=file://...}. Legacy rows in the wild keep {@code data};
     * new inserts never populate the TEXT column.
     */
    @Insert("INSERT INTO jarvis_chat_images (id, user_id, media_type, data, uri, created_at) "
            + "VALUES (#{id}, #{userId}, #{mediaType}, #{data}, #{uri}, #{createdAt})")
    void insert(@Param("id") String id, @Param("userId") String userId,
            @Param("mediaType") String mediaType, @Param("data") String data,
            @Param("uri") String uri, @Param("createdAt") long createdAt);
}
