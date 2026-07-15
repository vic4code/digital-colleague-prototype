import { useRef, useState } from "react";

type RecorderState = "idle" | "requesting" | "recording" | "transcribing";

interface UseVoiceRecorderOptions {
  supported?: boolean;
  onTranscript: (transcript: string) => void;
  onError: (message: string) => void;
}

export function useVoiceRecorder({
  supported,
  onTranscript,
  onError,
}: UseVoiceRecorderOptions) {
  const [state, setState] = useState<RecorderState>("idle");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const browserSupportsRecording =
    supported ??
    (typeof MediaRecorder !== "undefined" &&
      typeof navigator.mediaDevices?.getUserMedia === "function");

  async function transcribe(blob: Blob) {
    setState("transcribing");
    try {
      const body = new FormData();
      body.append("audio", blob, "voice-message.webm");
      const response = await fetch("/api/v1/audio/transcriptions", {
        method: "POST",
        body,
      });
      if (!response.ok) throw new Error(`Transcription failed (${response.status})`);
      const data = (await response.json()) as { transcript?: string };
      if (!data.transcript?.trim()) throw new Error("No transcript returned");
      onTranscript(data.transcript.trim());
    } catch {
      onError("We couldn't transcribe that recording. Text chat still works.");
    } finally {
      setState("idle");
    }
  }

  async function start() {
    if (!browserSupportsRecording) {
      onError("Voice recording is unavailable in this browser. Text chat still works.");
      return;
    }

    try {
      setState("requesting");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        void transcribe(blob);
      };
      recorder.start();
      setState("recording");
    } catch {
      setState("idle");
      onError("Microphone access was denied. You can keep using text chat.");
    }
  }

  function stop() {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }

  return {
    state,
    isRecording: state === "recording",
    isBusy: state === "requesting" || state === "transcribing",
    toggle: state === "recording" ? stop : start,
  };
}
