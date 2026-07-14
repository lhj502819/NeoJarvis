package com.jarvis.mapper;

import com.jarvis.domain.ChatImage;
import java.util.Optional;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

/** Chat image lookup backing {@code GET /api/chat-image/{id}} (ports the TS getChatImage). */
@Mapper
public interface ChatImageMapper {

    @Select("SELECT media_type AS mediaType, data FROM jarvis_chat_images "
            + "WHERE id = #{id} AND user_id = #{userId}")
    Optional<ChatImage> findByIdAndUser(@Param("id") String id, @Param("userId") String userId);

    /** Store one image (ports TS saveChatImages); {@code createdAt} is BIGINT epoch-millis. */
    @Insert("INSERT INTO jarvis_chat_images (id, user_id, media_type, data, created_at) "
            + "VALUES (#{id}, #{userId}, #{mediaType}, #{data}, #{createdAt})")
    void insert(@Param("id") String id, @Param("userId") String userId,
            @Param("mediaType") String mediaType, @Param("data") String data,
            @Param("createdAt") long createdAt);
}
