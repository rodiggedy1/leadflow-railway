/**
 * useTypingIndicator
 * Broadcasts typing presence and returns who else is currently typing.
 *
 * Usage:
 *   const { typers, onKeyPress } = useTypingIndicator(channelKey);
 *   // attach onKeyPress to the composer textarea's onKeyDown
 *   // render typers in the UI
 */
import { useCallback, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";

export function useTypingIndicator(channelKey: string) {
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);

  const setTypingMutation = trpc.opsChat.setTyping.useMutation();

  // Poll who is typing every 1.5s
  const { data } = trpc.opsChat.getTyping.useQuery(
    { channelKey },
    {
      refetchInterval: 1500,
      enabled: !!channelKey,
      // Don't show stale data
      staleTime: 0,
    }
  );

  const typers: string[] = data?.typers ?? [];

  const sendTypingTrue = useCallback(() => {
    if (!isTypingRef.current) {
      isTypingRef.current = true;
      setTypingMutation.mutate({ channelKey, isTyping: true });
    }
    // Reset the auto-clear timer
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      isTypingRef.current = false;
      setTypingMutation.mutate({ channelKey, isTyping: false });
    }, 3000);
  }, [channelKey, setTypingMutation]);

  const sendTypingFalse = useCallback(() => {
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    if (isTypingRef.current) {
      isTypingRef.current = false;
      setTypingMutation.mutate({ channelKey, isTyping: false });
    }
  }, [channelKey, setTypingMutation]);

  // Clear typing on unmount
  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      if (isTypingRef.current) {
        setTypingMutation.mutate({ channelKey, isTyping: false });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelKey]);

  return { typers, onKeyPress: sendTypingTrue, onBlur: sendTypingFalse };
}
