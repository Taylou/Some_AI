import React, { useState, useRef } from "react";
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Modal,
  ScrollView,
  Image,
  Alert,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";

import { AIService } from "./service";

// ─── Available models ────────────────────────────────────────────────────────
const MODELS = [
  { label: "DeepSeek R1 1.5b", value: "deepseek-r1:1.5b" },
  { label: "DeepSeek R1 14b",   value: "deepseek-r1:14b" },
  { label: "Llama 3.2 Vision 11b",     value: "llama3.2-vision:11b" },
  { label: "Llama 3.1 8b",     value: "llama3.1:8b" },
  { label: "LLaVA (vision)",   value: "llava:7b" },
  { label: "Mistral 7b",       value: "mistral:7b" },
  { label: "Gemma 3 4b",       value: "gemma3:4b" },
  { label: "Phi-4 14b",        value: "phi4:14b" },
];

const ATTACH_TYPES = { IMAGE: "image", FILE: "file" };

/**
 * A reusable chat view component that can be embedded anywhere.
 *
 * Props:
 *   service              - an AIService instance (defaults to a new one)
 *   containerStyle       - style applied to the outermost view
 *   showHeader           - whether to render the header
 *   defaultModel         - initial model value
 *   onSend(message)      - callback when the user sends a message
 *   onReceive(msg)       - callback when the assistant replies
 *   onModelChange(model) - callback when the user switches model
 */
export default function ChatView({
  service,
  containerStyle,
  showHeader = true,
  defaultModel = MODELS[0].value,
  onSend,
  onReceive,
  onModelChange,
}) {
  const [messages, setMessages]           = useState([]);
  const [inputText, setInputText]         = useState("");
  const [isLoading, setIsLoading]         = useState(false);
  const [selectedModel, setSelectedModel] = useState(defaultModel);
  const [dropdownVisible, setDropdownVisible]   = useState(false);
  const [attachMenuVisible, setAttachMenuVisible] = useState(false);
  const [attachments, setAttachments]     = useState([]); // pending for next message

  const aiRef = useRef(null);
  const getAI = () => {
    if (service) return service;
    if (!aiRef.current || aiRef.current.model !== selectedModel) {
      aiRef.current = new AIService({ model: selectedModel });
      aiRef.current.model = selectedModel;
    }
    return aiRef.current;
  };

  const handleModelSelect = (modelValue) => {
    setSelectedModel(modelValue);
    aiRef.current = null;
    setDropdownVisible(false);
    onModelChange && onModelChange(modelValue);
  };

  // ── Clear chat ───────────────────────────────────────────────────────────────
  // Wipes the conversation from Redis (Exercise 2's DELETE endpoint), clears the
  // on-screen messages, and resets the session so the next message starts fresh.
  const clearChat = async () => {
    if (isLoading) return;
    try {
      await getAI().clearSession();
    } catch (error) {
      console.error("Failed to clear session:", error);
      Alert.alert("Error", "Could not clear the conversation on the server.");
    }
    setMessages([]);
  };

  const selectedLabel =
    MODELS.find((m) => m.value === selectedModel)?.label ?? selectedModel;

  // ── Attachment handlers ────────────────────────────────────────────────────

  const pickImage = async () => {
    setAttachMenuVisible(false);
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Allow photo library access to attach images.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      base64: true,
      quality: 0.8,
    });
    if (!result.canceled) {
      const next = result.assets.map((asset) => ({
        type: ATTACH_TYPES.IMAGE,
        uri: asset.uri,
        name: asset.fileName ?? "image.jpg",
        base64: asset.base64,
        mimeType: asset.mimeType ?? "image/jpeg",
      }));
      setAttachments((prev) => [...prev, ...next]);
    }
  };

  const takePhoto = async () => {
    setAttachMenuVisible(false);
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Allow camera access to take photos.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ base64: true, quality: 0.8 });
    if (!result.canceled) {
      const asset = result.assets[0];
      setAttachments((prev) => [
        ...prev,
        {
          type: ATTACH_TYPES.IMAGE,
          uri: asset.uri,
          name: "photo.jpg",
          base64: asset.base64,
          mimeType: "image/jpeg",
        },
      ]);
    }
  };

  const pickDocument = async () => {
    setAttachMenuVisible(false);
    const result = await DocumentPicker.getDocumentAsync({
      type: "*/*",
      copyToCacheDirectory: true,
      multiple: true,
    });
    if (!result.canceled) {
      const next = await Promise.all(
        result.assets.map(async (asset) => {
          const base64 = await FileSystem.readAsStringAsync(asset.uri, {
            encoding: FileSystem.EncodingType.Base64,
          });
          return {
            type: ATTACH_TYPES.FILE,
            uri: asset.uri,
            name: asset.name,
            base64,
            mimeType: asset.mimeType ?? "application/octet-stream",
          };
        })
      );
      setAttachments((prev) => [...prev, ...next]);
    }
  };

  const removeAttachment = (index) =>
    setAttachments((prev) => prev.filter((_, i) => i !== index));

  // ── Send ──────────────────────────────────────────────────────────────────

  const sendMessage = async () => {
    if ((!inputText.trim() && attachments.length === 0) || isLoading) return;

    const userMessage = {
      role: "user",
      content: inputText.trim(),
      attachments: attachments.length > 0 ? [...attachments] : undefined,
    };

    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInputText("");
    setAttachments([]);
    setIsLoading(true);

    try {
      const replyContent = await getAI().chat(newMessages);
      const assistantMessage = { role: "assistant", content: replyContent };
      setMessages([...newMessages, assistantMessage]);
      onSend && onSend(userMessage);
      onReceive && onReceive(assistantMessage);
    } catch (error) {
      console.error("Error:", error);
      Alert.alert("Error", "Failed to get response. Make sure Ollama is running on your PC.");
    } finally {
      setIsLoading(false);
    }
  };

  // ── Render helpers ─────────────────────────────────────────────────────────

  const renderAttachmentChip = (item, index, removable = false) => {
    const isImage = item.type === ATTACH_TYPES.IMAGE;
    return (
      <View key={index} style={styles.attachPreview}>
        {isImage ? (
          <Image source={{ uri: item.uri }} style={styles.attachImage} />
        ) : (
          <View style={styles.fileChip}>
            <Text style={styles.fileChipIcon}>📄</Text>
            <Text style={styles.fileChipName} numberOfLines={1}>{item.name}</Text>
          </View>
        )}
        {removable && (
          <TouchableOpacity style={styles.attachRemove} onPress={() => removeAttachment(index)}>
            <Text style={styles.attachRemoveText}>✕</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  const renderMessage = ({ item }) => {
    const isUser = item.role === "user";
    return (
      <View style={[styles.messageWrapper, isUser && styles.messageWrapperUser]}>
        {item.attachments?.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.messageAttachRow}
          >
            {item.attachments.map((a, i) => renderAttachmentChip(a, i, false))}
          </ScrollView>
        )}
        {item.content ? (
          <View style={[styles.messageBubble, isUser ? styles.userBubble : styles.assistantBubble]}>
            <Text style={styles.messageText}>{item.content}</Text>
          </View>
        ) : null}
      </View>
    );
  };

  const canSend = (inputText.trim().length > 0 || attachments.length > 0) && !isLoading;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <KeyboardAvoidingView
      style={[styles.container, containerStyle]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={100}
    >
      <View style={styles.container}>

        {/* ── Header ── */}
        {showHeader && (
          <View style={styles.header}>
            <Text style={styles.title}>AI Chat</Text>
            <View style={styles.headerActions}>
              <TouchableOpacity
                testID="clear-chat-button"
                style={styles.clearButton}
                onPress={clearChat}
                disabled={isLoading}
              >
                <Text style={styles.clearButtonText}>🗑 Clear</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="model-button"
                style={styles.modelButton}
                onPress={() => setDropdownVisible(true)}
                disabled={isLoading}
              >
                <Text style={styles.modelButtonText}>⚙ {selectedLabel}</Text>
                <Text style={styles.chevron}>▾</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── Model picker modal ── */}
        <Modal
          visible={dropdownVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setDropdownVisible(false)}
        >
          <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setDropdownVisible(false)}>
            <View style={styles.dropdown}>
              <Text style={styles.dropdownTitle}>Select Model</Text>
              <ScrollView>
                {MODELS.map((model) => {
                  const isActive = model.value === selectedModel;
                  return (
                    <TouchableOpacity
                      key={model.value}
                      style={[styles.dropdownItem, isActive && styles.dropdownItemActive]}
                      onPress={() => handleModelSelect(model.value)}
                    >
                      <Text style={[styles.dropdownItemText, isActive && styles.dropdownItemTextActive]}>
                        {model.label}
                      </Text>
                      {isActive && <Text style={styles.checkmark}>✓</Text>}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          </TouchableOpacity>
        </Modal>

        {/* ── Attach action sheet ── */}
        <Modal
          visible={attachMenuVisible}
          transparent
          animationType="slide"
          onRequestClose={() => setAttachMenuVisible(false)}
        >
          <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setAttachMenuVisible(false)}>
            <View style={styles.attachSheet}>
              <Text style={styles.attachSheetTitle}>Add Attachment</Text>

              <TouchableOpacity style={styles.attachOption} onPress={pickImage}>
                <Text style={styles.attachOptionIcon}>🖼️</Text>
                <View>
                  <Text style={styles.attachOptionLabel}>Photo Library</Text>
                  <Text style={styles.attachOptionSub}>Pick images from your device</Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity style={styles.attachOption} onPress={takePhoto}>
                <Text style={styles.attachOptionIcon}>📷</Text>
                <View>
                  <Text style={styles.attachOptionLabel}>Camera</Text>
                  <Text style={styles.attachOptionSub}>Take a photo right now</Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity style={styles.attachOption} onPress={pickDocument}>
                <Text style={styles.attachOptionIcon}>📄</Text>
                <View>
                  <Text style={styles.attachOptionLabel}>File</Text>
                  <Text style={styles.attachOptionSub}>PDFs, text files, and more</Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity style={styles.attachCancel} onPress={() => setAttachMenuVisible(false)}>
                <Text style={styles.attachCancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>

        {/* ── Message list ── */}
        <FlatList
          data={messages}
          renderItem={renderMessage}
          keyExtractor={(_, index) => index.toString()}
          contentContainerStyle={styles.messageList}
        />

        {isLoading && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color="#007AFF" />
            <Text style={styles.loadingText}>{selectedLabel} is thinking...</Text>
          </View>
        )}

        {/* ── Pending attachment strip ── */}
        {attachments.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.pendingAttachRow}
            contentContainerStyle={styles.pendingAttachContent}
          >
            {attachments.map((a, i) => renderAttachmentChip(a, i, true))}
          </ScrollView>
        )}

        {/* ── Input bar ── */}
        <View style={styles.inputContainer}>
          <TouchableOpacity
            style={styles.attachButton}
            onPress={() => setAttachMenuVisible(true)}
            disabled={isLoading}
          >
            <Text style={styles.attachButtonText}>＋</Text>
          </TouchableOpacity>

          <TextInput
            testID="message-input"
            style={styles.input}
            value={inputText}
            onChangeText={setInputText}
            placeholder={attachments.length > 0 ? "Add a caption..." : "Type a message..."}
            placeholderTextColor="#999"
            multiline
            maxLength={500}
            editable={!isLoading}
          />

          <TouchableOpacity
            testID="send-button"
            style={[styles.sendButton, !canSend && styles.sendButtonDisabled]}
            onPress={sendMessage}
            disabled={!canSend}
          >
            <Text style={styles.sendButtonText}>Send</Text>
          </TouchableOpacity>
        </View>

      </View>
    </KeyboardAvoidingView>
  );
}

export { MODELS };

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#333",
    backgroundColor: "#000",
  },
  title: { fontSize: 24, fontWeight: "bold", color: "#FFF" },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  clearButton: {
    backgroundColor: "#222",
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  clearButtonText: { color: "#FF3B30", fontSize: 13, fontWeight: "600" },
  modelButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#222",
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 4,
  },
  modelButtonText: { color: "#007AFF", fontSize: 13, fontWeight: "600" },
  chevron: { color: "#007AFF", fontSize: 12 },

  // Shared modal overlay
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
  },

  // Model dropdown
  dropdown: {
    width: 280,
    backgroundColor: "#1a1a1a",
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#333",
  },
  dropdownTitle: {
    color: "#999",
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#333",
  },
  dropdownItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#222",
  },
  dropdownItemActive:     { backgroundColor: "#0a1f3a" },
  dropdownItemText:       { color: "#FFF", fontSize: 15 },
  dropdownItemTextActive: { color: "#007AFF", fontWeight: "600" },
  checkmark:              { color: "#007AFF", fontSize: 16, fontWeight: "bold" },

  // Attach sheet (slides up from bottom)
  attachSheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#1a1a1a",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    paddingBottom: 36,
    borderTopWidth: 1,
    borderTopColor: "#333",
  },
  attachSheetTitle: {
    color: "#999",
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 12,
    textAlign: "center",
  },
  attachOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#2a2a2a",
  },
  attachOptionIcon:  { fontSize: 28 },
  attachOptionLabel: { color: "#FFF", fontSize: 15, fontWeight: "600" },
  attachOptionSub:   { color: "#777", fontSize: 12, marginTop: 2 },
  attachCancel: {
    marginTop: 12,
    alignItems: "center",
    paddingVertical: 14,
    backgroundColor: "#222",
    borderRadius: 12,
  },
  attachCancelText: { color: "#FF3B30", fontWeight: "600", fontSize: 15 },

  // Pending attachment strip (above input bar)
  pendingAttachRow: {
    borderTopWidth: 1,
    borderTopColor: "#222",
    backgroundColor: "#111",
    maxHeight: 110,
  },
  pendingAttachContent: {
    padding: 8,
    gap: 8,
    flexDirection: "row",
    alignItems: "center",
  },

  // Attachment chips (both in strip and in message history)
  messageAttachRow: { marginBottom: 4, maxHeight: 110 },
  attachPreview:    { position: "relative", marginRight: 8 },
  attachImage: {
    width: 90,
    height: 90,
    borderRadius: 10,
    backgroundColor: "#222",
  },
  fileChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#222",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 6,
    maxWidth: 140,
    height: 44,
  },
  fileChipIcon: { fontSize: 18 },
  fileChipName: { color: "#FFF", fontSize: 12, flex: 1 },
  attachRemove: {
    position: "absolute",
    top: -6,
    right: -6,
    backgroundColor: "#FF3B30",
    borderRadius: 10,
    width: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  attachRemoveText: { color: "#FFF", fontSize: 11, fontWeight: "bold" },

  // Messages
  messageList:        { padding: 16, gap: 12 },
  messageWrapper:     { alignItems: "flex-start" },
  messageWrapperUser: { alignItems: "flex-end" },
  messageBubble: { padding: 12, borderRadius: 16, maxWidth: "80%" },
  userBubble:      { backgroundColor: "#007AFF" },
  assistantBubble: { backgroundColor: "#333" },
  messageText:     { color: "#FFF" },

  // Loading
  loadingContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 8,
    gap: 8,
  },
  loadingText: { fontSize: 14, opacity: 0.7, color: "#FFF" },

  // Input bar
  inputContainer: {
    flexDirection: "row",
    padding: 12,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: "#333",
    backgroundColor: "#000",
    alignItems: "flex-end",
  },
  attachButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#222",
    alignItems: "center",
    justifyContent: "center",
  },
  attachButtonText: { color: "#007AFF", fontSize: 22, lineHeight: 26 },
  input: {
    flex: 1,
    backgroundColor: "#222",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: "#FFF",
    maxHeight: 100,
  },
  sendButton: {
    backgroundColor: "#007AFF",
    borderRadius: 20,
    paddingHorizontal: 20,
    height: 40,
    justifyContent: "center",
  },
  sendButtonDisabled: { opacity: 0.5 },
  sendButtonText: { color: "#FFF", fontWeight: "600" },
});
