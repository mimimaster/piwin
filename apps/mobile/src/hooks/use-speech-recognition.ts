import { useCallback, useEffect, useRef, useState } from 'react';

// Type definitions for Web Speech API (supported by iOS WKWebView / Safari)
interface IWindowWithSpeech extends Window {
  SpeechRecognition?: any;
  webkitSpeechRecognition?: any;
}

export type UseSpeechRecognitionOptions = {
  lang?: string | undefined;
  onTranscript?: ((text: string, isFinal: boolean) => void) | undefined;
  onError?: ((error: string) => void) | undefined;
};

export function useSpeechRecognition(options: UseSpeechRecognitionOptions = {}) {
  const { lang = 'zh-CN', onTranscript, onError } = options;
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const recognitionRef = useRef<any>(null);
  const onTranscriptRef = useRef(onTranscript);
  const onErrorRef = useRef(onError);

  onTranscriptRef.current = onTranscript;
  onErrorRef.current = onError;

  useEffect(() => {
    const win = typeof window !== 'undefined' ? (window as unknown as IWindowWithSpeech) : undefined;
    const SpeechRecognitionClass = win?.SpeechRecognition ?? win?.webkitSpeechRecognition;
    setIsSupported(SpeechRecognitionClass !== undefined);
  }, []);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }
    setIsListening(false);
  }, []);

  const startListening = useCallback(() => {
    const win = typeof window !== 'undefined' ? (window as unknown as IWindowWithSpeech) : undefined;
    const SpeechRecognitionClass = win?.SpeechRecognition ?? win?.webkitSpeechRecognition;

    if (!SpeechRecognitionClass) {
      onErrorRef.current?.('当前系统环境暂不支持原生语音听写');
      return;
    }

    // Stop any existing instance
    if (recognitionRef.current) {
      stopListening();
    }

    try {
      const recognition = new SpeechRecognitionClass();
      recognition.lang = lang;
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        setIsListening(true);
      };

      recognition.onresult = (event: any) => {
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const result = event.results[i];
          if (result.isFinal) {
            finalTranscript += result[0].transcript;
          } else {
            interimTranscript += result[0].transcript;
          }
        }

        const text = finalTranscript || interimTranscript;
        if (text && onTranscriptRef.current) {
          onTranscriptRef.current(text, Boolean(finalTranscript));
        }
      };

      recognition.onerror = (event: any) => {
        const errorMsg = event.error || '语音识别出错';
        if (errorMsg !== 'no-speech') {
          onErrorRef.current?.(errorMsg);
        }
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
        recognitionRef.current = null;
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      const message = err instanceof Error ? err.message : '启动语音识别失败';
      onErrorRef.current?.(message);
      setIsListening(false);
    }
  }, [lang, stopListening]);

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // ignore
        }
        recognitionRef.current = null;
      }
    };
  }, []);

  return {
    isListening,
    isSupported,
    startListening,
    stopListening,
    toggleListening,
  };
}
