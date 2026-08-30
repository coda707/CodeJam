import { useState } from "react";
import { shortId } from "./presentation";

interface CopyIdentifierProps {
  label: string;
  value: string;
  compact?: boolean;
}

export function CopyIdentifier({
  label,
  value,
  compact = false,
}: CopyIdentifierProps) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  const copy = async () => {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("failed");
    }
  };

  return (
    <span className="copy-identifier">
      <code title={value}>{compact ? shortId(value) : value}</code>
      <button
        type="button"
        aria-label={`Copy ${label} ${value}`}
        onClick={() => void copy()}
      >
        {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy"}
      </button>
    </span>
  );
}
