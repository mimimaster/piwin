import { useState, useEffect, useCallback, useRef } from 'react';

/** Strip markdown syntax to create clean readable plain text for TTS */
function cleanMarkdownForSpeech(md: string): string {
  return md
    // remove code blocks
    .replace(/```[\s\S]*?```/g, '代码块已省略')
    // remove inline code
    .replace(/`([^`]+)`/g, '$1')
    // remove markdown headers
    .replace(/^#+\s+/gm, '')
    // remove bold/italic
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1')
    // remove links
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // remove blockquotes
    .replace(/^>\s+/gm, '')
    // remove multiple spaces/newlines
    .replace(/\n{2,}/g, '。')
    .replace(/\s+/g, ' ')
    .trim();
}

export function useTts() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [currentSpeakingId, setCurrentSpeakingId] = useState<string | undefined>(undefined);
  const synthRef = useRef<SpeechSynthesis | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      synthRef.current = window.speechSynthesis;
    }
  }, []);

  const stop = useCallback(() => {
    if (synthRef.current) {
      synthRef.current.cancel();
      setIsSpeaking(false);
      setCurrentSpeakingId(undefined);
    }
  }, []);

  const speak = useCallback(
    (text: string, messageId?: string) => {
      if (!synthRef.current) {
        return;
      }

      // If already speaking this message, toggle stop
      if (isSpeaking && currentSpeakingId === messageId) {
        stop();
        return;
      }

      // Cancel previous speech
      synthRef.current.cancel();

      const plainText = cleanMarkdownForSpeech(text);
      if (!plainText) {
        return;
      }

      const utterance = new SpeechSynthesisUtterance(plainText);
      utterance.lang = 'zh-CN';
      utterance.rate = 1.05;
      utterance.pitch = 1.0;

      utterance.onstart = () => {
        setIsSpeaking(true);
        setCurrentSpeakingId(messageId);
      };

      utterance.onend = () => {
        setIsSpeaking(false);
        setCurrentSpeakingId(undefined);
      };

      utterance.onerror = () => {
        setIsSpeaking(false);
        setCurrentSpeakingId(undefined);
      };

      synthRef.current.speak(utterance);
    },
    [isSpeaking, currentSpeakingId, stop],
  );

  return {
    isSpeaking,
    currentSpeakingId,
    speak,
    stop,
  };
}
