"use client";
import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";

/** Applies the saved theme preference once per session (the device can still change it in Settings). */
export function ThemeSync({ theme }: { theme: "system" | "light" | "dark" }) {
  const { setTheme } = useTheme();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    setTheme(theme);
  }, [theme, setTheme]);
  return null;
}
