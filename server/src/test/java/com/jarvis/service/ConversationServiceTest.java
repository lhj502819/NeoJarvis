package com.jarvis.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.jarvis.domain.SaveChatImagesRequest;
import com.jarvis.mapper.ChatImageMapper;
import com.jarvis.mapper.ConversationMapper;
import com.jarvis.util.ChatImageStore;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.MockedStatic;
import org.mockito.Mockito;
import org.mockito.junit.jupiter.MockitoExtension;

/** Unit tests for the conversation write side (ports of addToBuffer/saveConversation/saveChatImages). */
@ExtendWith(MockitoExtension.class)
class ConversationServiceTest {

    @Mock
    private ConversationMapper conversationMapper;
    @Mock
    private ChatImageMapper chatImageMapper;
    @InjectMocks
    private ConversationService service;

    @Test
    void addToBufferReusesLatestSessionAndBumpsIt() {
        // Given a user with an existing session
        when(conversationMapper.findLatestSessionId("u1")).thenReturn(Optional.of("sess-1"));

        // When
        service.addToBuffer("u1", "user", "hello", null, null);

        // Then: no new session, message stored on the reused one, session touched
        verify(conversationMapper, never()).insertSession(anyString(), anyString(), anyString(), anyString());
        verify(conversationMapper).insertMessage(eq("sess-1"), eq("u1"), eq("user"), eq("hello"),
                anyLong(), isNull(), isNull());
        verify(conversationMapper).touchSession(eq("sess-1"), anyString());
    }

    @Test
    void addToBufferCreatesSessionWhenNoneExists() {
        // Given no session for the user
        when(conversationMapper.findLatestSessionId("u1")).thenReturn(Optional.empty());

        // When
        service.addToBuffer("u1", "jarvis", "hi", null, null);

        // Then: a session is created and the message stored on that same generated id
        ArgumentCaptor<String> newSession = ArgumentCaptor.forClass(String.class);
        verify(conversationMapper).insertSession(newSession.capture(), eq("u1"), anyString(), anyString());
        verify(conversationMapper).insertMessage(eq(newSession.getValue()), eq("u1"), eq("jarvis"),
                eq("hi"), anyLong(), isNull(), isNull());
    }

    @Test
    void addToBufferSerialisesImageIdsButStoresNullForEmpty() {
        when(conversationMapper.findLatestSessionId("u1")).thenReturn(Optional.of("s"));

        // non-empty -> JSON array
        service.addToBuffer("u1", "user", "m", "art-1", List.of("i1", "i2"));
        verify(conversationMapper).insertMessage(eq("s"), eq("u1"), eq("user"), eq("m"),
                anyLong(), eq("art-1"), eq("[\"i1\",\"i2\"]"));

        // empty list -> NULL (mirrors TS imageIds && length ? stringify : null)
        service.addToBuffer("u1", "user", "m2", null, List.of());
        verify(conversationMapper).insertMessage(eq("s"), eq("u1"), eq("user"), eq("m2"),
                anyLong(), isNull(), isNull());
    }

    @Test
    void saveConversationWritesUserThenJarvis() {
        when(conversationMapper.findLatestSessionId("u1")).thenReturn(Optional.of("s"));

        service.saveConversation("u1", "the question", "the answer");

        // Two messages, user first then jarvis (ordering matters for the transcript)
        InOrder inOrder = Mockito.inOrder(conversationMapper);
        inOrder.verify(conversationMapper).insertMessage(eq("s"), eq("u1"), eq("user"),
                eq("the question"), anyLong(), isNull(), isNull());
        inOrder.verify(conversationMapper).insertMessage(eq("s"), eq("u1"), eq("jarvis"),
                eq("the answer"), anyLong(), isNull(), isNull());
    }

    /**
     * v0.3 file-store: saveChatImages writes each payload to disk via {@link ChatImageStore}
     * and INSERTs the row with {@code data=null, uri=file://...}. Static write is stubbed to
     * keep this a pure unit test — the on-disk behaviour is covered by ChatImageStoreTest.
     */
    @Test
    void saveChatImagesWritesFilesThenInsertsWithUriAndNullData() {
        List<SaveChatImagesRequest.Image> images = List.of(
                new SaveChatImagesRequest.Image("image/png", "AAA="),
                new SaveChatImagesRequest.Image("image/jpeg", "BBB="));

        List<String> ids;
        try (MockedStatic<ChatImageStore> store = mockStatic(ChatImageStore.class)) {
            store.when(() -> ChatImageStore.write(eq("u1"), any(), eq("image/png"), eq("AAA=")))
                    .thenReturn("file:///tmp/u1/one.png");
            store.when(() -> ChatImageStore.write(eq("u1"), any(), eq("image/jpeg"), eq("BBB=")))
                    .thenReturn("file:///tmp/u1/two.jpg");

            ids = service.saveChatImages("u1", images);

            assertThat(ids).hasSize(2);
            assertThat(ids).doesNotContainNull();
            assertThat(ids).doesNotHaveDuplicates();
            store.verify(() -> ChatImageStore.write(eq("u1"), eq(ids.get(0)), eq("image/png"),
                    eq("AAA=")));
            store.verify(() -> ChatImageStore.write(eq("u1"), eq(ids.get(1)), eq("image/jpeg"),
                    eq("BBB=")));
        }
        // data=null (never stored in TEXT); uri is the file:// pointer returned by the store.
        verify(chatImageMapper).insert(eq(ids.get(0)), eq("u1"), eq("image/png"), eq(null),
                eq("file:///tmp/u1/one.png"), anyLong());
        verify(chatImageMapper).insert(eq(ids.get(1)), eq("u1"), eq("image/jpeg"), eq(null),
                eq("file:///tmp/u1/two.jpg"), anyLong());
    }
}
